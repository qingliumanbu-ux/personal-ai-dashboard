from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .queue import JobQueue, Publication
from .summary import SUMMARY_PROMPT_VERSION, validate_candidate_summary


RAW_VIDEO_DIRECTORY = Path("04-来源资料") / "视频"
RAW_WEB_DIRECTORY = Path("04-来源资料") / "网页"


class PublicationError(RuntimeError):
    pass


class PublicationNotAllowedError(PublicationError):
    pass


class PublicationConflictError(PublicationError):
    pass


class PublicationStateError(PublicationError):
    pass


@dataclass(frozen=True)
class PublicationPreview:
    id: str
    job_id: str
    relative_path: str


class Publisher:
    def __init__(
        self,
        queue: JobQueue,
        vault_root: Path,
        link_file: Callable[[str | bytes | os.PathLike, str | bytes | os.PathLike], None] = os.link,
    ) -> None:
        self.queue = queue
        self.vault_root = Path(vault_root)
        self.link_file = link_file

    def preview(self, job_id: str) -> PublicationPreview:
        preview, _, _, _ = self._build_publication(job_id)
        return preview

    def publish(self, job_id: str) -> Publication:
        existing = self.queue.get_publication(job_id)
        if existing is not None:
            self._verify_existing(existing)
            return existing

        preview, payload, source_sha256, content_sha256 = self._build_publication(job_id)
        output_directory = self._ensure_output_directory(Path(preview.relative_path).parent)
        target = output_directory / Path(preview.relative_path).name
        created_target = False

        if target.exists():
            if not target.is_file() or _sha256_file(target) != content_sha256:
                raise PublicationConflictError(
                    f"Publication target already exists with different content: {preview.relative_path}"
                )
        else:
            temporary_path: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    prefix=f".{preview.id}.",
                    suffix=".tmp",
                    dir=output_directory,
                    delete=False,
                ) as temporary:
                    temporary.write(payload)
                    temporary.flush()
                    os.fsync(temporary.fileno())
                    temporary_path = Path(temporary.name)
                self.link_file(temporary_path, target)
                created_target = True
            finally:
                if temporary_path is not None:
                    temporary_path.unlink(missing_ok=True)

        publication = Publication(
            id=preview.id,
            job_id=job_id,
            source_sha256=source_sha256,
            content_sha256=content_sha256,
            relative_path=preview.relative_path,
            created_at=self._approved_review(job_id).created_at,
        )
        try:
            recorded = self.queue.record_publication(publication)
        except Exception:
            if created_target:
                target.unlink(missing_ok=True)
            raise
        if recorded != publication:
            if created_target and recorded.relative_path != publication.relative_path:
                target.unlink(missing_ok=True)
            self._verify_existing(recorded)
        return recorded

    def _build_publication(
        self,
        job_id: str,
    ) -> tuple[PublicationPreview, bytes, str, str]:
        job = self.queue.get(job_id)
        review = self._approved_review(job_id)
        if job.status != "succeeded":
            raise PublicationNotAllowedError("Only an approved job can be published")

        artifacts = {artifact.kind: artifact for artifact in self.queue.list_artifacts(job_id)}
        if job.source_type == "web-page":
            return self._build_web_publication(job, review, artifacts)
        if job.source_type == "douyin":
            return self._build_douyin_publication(job, review, artifacts)
        transcript = artifacts.get("transcript")
        if transcript is None:
            raise PublicationStateError("Approved job has no transcript artifact")
        transcript_text = transcript.path.read_text(encoding="utf-8").strip()
        if not transcript_text:
            raise PublicationStateError("Transcript artifact is empty")

        if job.source_path is None:
            raise PublicationStateError("Local video job has no source path")
        source_sha256 = _sha256_file(job.source_path)
        identity = "\0".join(
            ("raw-video-v1", job.id, source_sha256, transcript.sha256)
        ).encode("utf-8")
        publication_id = hashlib.sha256(identity).hexdigest()[:24]
        title = job.source_path.stem.strip() or "未命名视频"
        filename = f"{_safe_filename(title)}-{publication_id[:8]}.md"
        relative_path = (RAW_VIDEO_DIRECTORY / filename).as_posix()
        capture_frontmatter, capture_body = _capture_markdown(job.params)
        summary_frontmatter, summary_body = _summary_markdown(job, artifacts, transcript)
        markdown = "\n".join(
            (
                "---",
                "type: raw-source",
                "source_type: local-video",
                "status: reviewed",
                "review_decision: approved",
                f"publication_id: {json.dumps(publication_id)}",
                f"source_file: {json.dumps(job.source_path.name, ensure_ascii=False)}",
                f"source_sha256: {json.dumps(source_sha256)}",
                f"transcript_sha256: {json.dumps(transcript.sha256)}",
                f"published_at: {json.dumps(review.created_at)}",
                *capture_frontmatter,
                *summary_frontmatter,
                "---",
                "",
                f"# {title}",
                "",
                "## 来源",
                "",
                "- 类型：本地视频",
                f"- 原文件：`{job.source_path.name}`",
                "",
                *capture_body,
                *summary_body,
                "## 全文转写",
                "",
                transcript_text,
                "",
            )
        )
        payload = markdown.encode("utf-8")
        content_sha256 = hashlib.sha256(payload).hexdigest()
        return (
            PublicationPreview(publication_id, job_id, relative_path),
            payload,
            source_sha256,
            content_sha256,
        )

    def _build_web_publication(self, job, review, artifacts):
        content = artifacts.get("content")
        metadata = artifacts.get("metadata")
        snapshot = artifacts.get("source_snapshot")
        if content is None or metadata is None or snapshot is None:
            raise PublicationStateError("Approved webpage job is missing source artifacts")
        if not job.source_url:
            raise PublicationStateError("Webpage job has no source URL")
        content_text = content.path.read_text(encoding="utf-8").strip()
        if not content_text:
            raise PublicationStateError("Webpage content artifact is empty")
        try:
            metadata_payload = json.loads(metadata.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise PublicationStateError("Webpage metadata artifact is invalid") from error
        title = str(metadata_payload.get("title") or "未命名网页").strip()[:200]
        captured_at = str(metadata_payload.get("captured_at") or "")
        source_sha256 = snapshot.sha256
        identity = "\0".join(
            ("raw-web-v1", job.id, job.source_url, source_sha256, content.sha256)
        ).encode("utf-8")
        publication_id = hashlib.sha256(identity).hexdigest()[:24]
        filename = f"{_safe_filename(title)}-{publication_id[:8]}.md"
        relative_path = (RAW_WEB_DIRECTORY / filename).as_posix()
        body = _without_leading_title(content_text, title)
        capture_frontmatter, capture_body = _capture_markdown(job.params)
        summary_frontmatter, summary_body = _summary_markdown(job, artifacts, content)
        markdown = "\n".join(
            (
                "---",
                "type: raw-source",
                "source_type: web-page",
                "status: reviewed",
                "review_decision: approved",
                f"publication_id: {json.dumps(publication_id)}",
                f"source_url: {json.dumps(job.source_url, ensure_ascii=False)}",
                f"source_sha256: {json.dumps(source_sha256)}",
                f"content_sha256: {json.dumps(content.sha256)}",
                f"captured_at: {json.dumps(captured_at)}",
                f"published_at: {json.dumps(review.created_at)}",
                *capture_frontmatter,
                *summary_frontmatter,
                "---",
                "",
                f"# {title}",
                "",
                "## 来源",
                "",
                "- 类型：公开网页",
                f"- 原网页：{job.source_url}",
                f"- 采集时间：{captured_at}",
                "",
                *capture_body,
                *summary_body,
                "## 网页正文",
                "",
                body,
                "",
            )
        )
        payload = markdown.encode("utf-8")
        content_sha256 = hashlib.sha256(payload).hexdigest()
        return (
            PublicationPreview(publication_id, job.id, relative_path),
            payload,
            source_sha256,
            content_sha256,
        )

    def _build_douyin_publication(self, job, review, artifacts):
        source_metadata = artifacts.get("source_metadata")
        if source_metadata is None:
            raise PublicationStateError("Approved Douyin job is missing source metadata")
        if not job.source_url:
            raise PublicationStateError("Douyin job has no source URL")
        try:
            metadata_payload = json.loads(source_metadata.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise PublicationStateError("Douyin source metadata artifact is invalid") from error
        if metadata_payload.get("source_type") == "douyin-image":
            return self._build_douyin_image_publication(
                job,
                review,
                artifacts,
                source_metadata,
                metadata_payload,
            )

        transcript = artifacts.get("transcript")
        source_media = artifacts.get("source_media")
        if transcript is None or source_media is None:
            raise PublicationStateError("Approved Douyin video is missing source artifacts")
        transcript_text = transcript.path.read_text(encoding="utf-8").strip()
        if not transcript_text:
            raise PublicationStateError("Transcript artifact is empty")

        video_id = str(metadata_payload.get("video_id") or "").strip()
        title = str(metadata_payload.get("title") or "未命名抖音视频").strip()[:200]
        final_url = str(metadata_payload.get("final_url") or job.source_url)
        captured_at = str(metadata_payload.get("captured_at") or "")
        source_sha256 = source_media.sha256
        identity = "\0".join(
            ("raw-douyin-video-v1", job.id, job.source_url, source_sha256, transcript.sha256)
        ).encode("utf-8")
        publication_id = hashlib.sha256(identity).hexdigest()[:24]
        filename = f"{_safe_filename(title)}-{publication_id[:8]}.md"
        relative_path = (RAW_VIDEO_DIRECTORY / filename).as_posix()
        capture_frontmatter, capture_body = _capture_markdown(job.params)
        summary_frontmatter, summary_body = _summary_markdown(job, artifacts, transcript)
        markdown = "\n".join(
            (
                "---",
                "type: raw-source",
                "source_type: douyin-video",
                "status: reviewed",
                "review_decision: approved",
                f"publication_id: {json.dumps(publication_id)}",
                f"source_url: {json.dumps(job.source_url, ensure_ascii=False)}",
                f"final_url: {json.dumps(final_url, ensure_ascii=False)}",
                f"video_id: {json.dumps(video_id, ensure_ascii=False)}",
                f"source_sha256: {json.dumps(source_sha256)}",
                f"transcript_sha256: {json.dumps(transcript.sha256)}",
                f"captured_at: {json.dumps(captured_at)}",
                f"published_at: {json.dumps(review.created_at)}",
                *capture_frontmatter,
                *summary_frontmatter,
                "---",
                "",
                f"# {title}",
                "",
                "## 来源",
                "",
                "- 类型：公开抖音视频",
                f"- 原链接：{job.source_url}",
                f"- 视频 ID：`{video_id}`",
                f"- 采集时间：{captured_at}",
                "- 媒体保留：仅保存在任务 Run 目录，不复制到知识库",
                "",
                *capture_body,
                *summary_body,
                "## 全文转写",
                "",
                transcript_text,
                "",
            )
        )
        payload = markdown.encode("utf-8")
        content_sha256 = hashlib.sha256(payload).hexdigest()
        return (
            PublicationPreview(publication_id, job.id, relative_path),
            payload,
            source_sha256,
            content_sha256,
        )

    def _build_douyin_image_publication(
        self,
        job,
        review,
        artifacts,
        source_metadata,
        metadata_payload,
    ):
        content = artifacts.get("content")
        image_artifacts = sorted(
            (
                artifact
                for kind, artifact in artifacts.items()
                if kind.startswith("source_image_")
            ),
            key=lambda artifact: artifact.kind,
        )
        if content is None or not image_artifacts:
            raise PublicationStateError("Approved Douyin image post is missing source artifacts")
        content_text = content.path.read_text(encoding="utf-8").strip()
        if not content_text:
            raise PublicationStateError("Douyin image post content artifact is empty")

        post_id = str(metadata_payload.get("post_id") or "").strip()
        title = str(metadata_payload.get("title") or "未命名抖音图文").strip()[:200]
        final_url = str(metadata_payload.get("final_url") or job.source_url)
        captured_at = str(metadata_payload.get("captured_at") or "")
        metadata_images = metadata_payload.get("images")
        if not isinstance(metadata_images, list) or len(metadata_images) != len(image_artifacts):
            raise PublicationStateError("Douyin image metadata does not match source artifacts")
        image_urls = [
            str(image.get("url") or "").strip()
            for image in metadata_images
            if isinstance(image, dict)
        ]
        if len(image_urls) != len(image_artifacts) or any(
            not value.startswith("https://") for value in image_urls
        ):
            raise PublicationStateError("Douyin image metadata contains invalid source URLs")
        image_hashes = [artifact.sha256 for artifact in image_artifacts]
        source_sha256 = source_metadata.sha256
        identity = "\0".join(
            (
                "raw-douyin-image-v1",
                job.id,
                job.source_url,
                source_sha256,
                content.sha256,
                *image_hashes,
            )
        ).encode("utf-8")
        publication_id = hashlib.sha256(identity).hexdigest()[:24]
        filename = f"{_safe_filename(title)}-{publication_id[:8]}.md"
        relative_path = (RAW_VIDEO_DIRECTORY / filename).as_posix()
        capture_frontmatter, capture_body = _capture_markdown(job.params)
        summary_frontmatter, summary_body = _summary_markdown(job, artifacts, content)
        body = _without_leading_title(content_text, title).partition("\n## 图片")[0].strip()
        image_body = tuple(
            line
            for index, image_url in enumerate(image_urls, start=1)
            for line in (f"![图 {index}](<{image_url}>)", "")
        )
        markdown = "\n".join(
            (
                "---",
                "type: raw-source",
                "source_type: douyin-image",
                "status: reviewed",
                "review_decision: approved",
                f"publication_id: {json.dumps(publication_id)}",
                f"source_url: {json.dumps(job.source_url, ensure_ascii=False)}",
                f"final_url: {json.dumps(final_url, ensure_ascii=False)}",
                f"post_id: {json.dumps(post_id, ensure_ascii=False)}",
                f"source_sha256: {json.dumps(source_sha256)}",
                f"content_sha256: {json.dumps(content.sha256)}",
                f"source_images_sha256: {json.dumps(image_hashes)}",
                f"captured_at: {json.dumps(captured_at)}",
                f"published_at: {json.dumps(review.created_at)}",
                *capture_frontmatter,
                *summary_frontmatter,
                "---",
                "",
                f"# {title}",
                "",
                "## 来源",
                "",
                "- 类型：公开抖音图文",
                f"- 原链接：{job.source_url}",
                f"- 内容 ID：`{post_id}`",
                f"- 采集时间：{captured_at}",
                f"- 图片数量：{len(image_artifacts)}",
                "- 图片保留：审核副本位于任务 Run 目录，知识库 Markdown 引用公开原图",
                "",
                *capture_body,
                *summary_body,
                "## 图文正文",
                "",
                body,
                "",
                "## 图片",
                "",
                *image_body,
            )
        )
        payload = markdown.encode("utf-8")
        content_sha256 = hashlib.sha256(payload).hexdigest()
        return (
            PublicationPreview(publication_id, job.id, relative_path),
            payload,
            source_sha256,
            content_sha256,
        )

    def _approved_review(self, job_id: str):
        reviews = self.queue.list_reviews(job_id)
        if not reviews or reviews[-1].decision != "approved":
            raise PublicationNotAllowedError("Only an approved job can be published")
        return reviews[-1]

    def _ensure_output_directory(self, relative_directory: Path) -> Path:
        try:
            vault_root = self.vault_root.resolve(strict=True)
        except OSError as error:
            raise PublicationStateError("Vault root does not exist") from error
        if not vault_root.is_dir():
            raise PublicationStateError("Vault root is not a directory")

        current = vault_root
        if relative_directory not in {RAW_VIDEO_DIRECTORY, RAW_WEB_DIRECTORY}:
            raise PublicationStateError("Unsupported publication directory")
        for part in relative_directory.parts:
            current = current / part
            current.mkdir(exist_ok=True)
            if current.is_symlink():
                raise PublicationStateError("Publication directory cannot be a symlink")
            resolved = current.resolve(strict=True)
            if not resolved.is_relative_to(vault_root) or not resolved.is_dir():
                raise PublicationStateError("Publication path escapes the Vault")
            current = resolved
        return current

    def _verify_existing(self, publication: Publication) -> None:
        vault_root = self.vault_root.resolve(strict=True)
        target = (vault_root / Path(publication.relative_path)).resolve(strict=True)
        job = self.queue.get(publication.job_id)
        expected_relative = (
            RAW_WEB_DIRECTORY if job.source_type == "web-page" else RAW_VIDEO_DIRECTORY
        )
        expected_directory = (vault_root / expected_relative).resolve(strict=True)
        if target.parent != expected_directory or not target.is_file():
            raise PublicationStateError("Recorded publication is outside its Raw source layer")
        if _sha256_file(target) != publication.content_sha256:
            raise PublicationStateError("Recorded publication content has changed")


def _safe_filename(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    safe = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", normalized, flags=re.UNICODE)
    safe = re.sub(r"-+", "-", safe).strip("-_.")
    return safe[:60] or "未命名视频"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _without_leading_title(content: str, title: str) -> str:
    lines = content.splitlines()
    if lines and lines[0].strip() == f"# {title}":
        lines = lines[1:]
    return "\n".join(lines).strip()


def _capture_markdown(params: dict[str, str]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    try:
        parsed_tags = json.loads(params.get("capture_tags", "[]"))
    except ValueError:
        parsed_tags = []
    if not isinstance(parsed_tags, list):
        parsed_tags = []
    tags = [str(tag).strip() for tag in parsed_tags if str(tag).strip()]
    reason = params.get("capture_reason", "").strip()
    if not tags and not reason:
        return (), ()

    frontmatter = []
    if tags:
        frontmatter.append(f"tags: {json.dumps(tags, ensure_ascii=False)}")
    if reason:
        frontmatter.append(f"capture_reason: {json.dumps(reason, ensure_ascii=False)}")

    body = ["## 收藏上下文", ""]
    if tags:
        body.append(f"- 标签：{'、'.join(tags)}")
    if reason:
        body.append(f"- 收藏原因：{re.sub(r'\s+', ' ', reason)}")
    body.append("")
    return tuple(frontmatter), tuple(body)


def _summary_markdown(job, artifacts, source_artifact) -> tuple[tuple[str, ...], tuple[str, ...]]:
    summary = artifacts.get("candidate_summary")
    if summary is None:
        if job.params.get("summary_required") == "true":
            raise PublicationStateError("发布前必须先保存 AI 候选摘要。")
        return (), ()
    content = validate_candidate_summary(summary.path.read_text(encoding="utf-8"))
    frontmatter = (
        'summary_origin: "manual-import"',
        f'summary_prompt_version: {json.dumps(SUMMARY_PROMPT_VERSION)}',
        f'summary_source_sha256: {json.dumps(source_artifact.sha256)}',
        f'summary_sha256: {json.dumps(summary.sha256)}',
    )
    body = (
        "## 摘要说明",
        "",
        "> 以下内容由用户选择的 AI 生成并在发布前人工核对；它是来源资料的候选说明，不等于正式知识。",
        "",
        content,
        "",
    )
    return frontmatter, body
