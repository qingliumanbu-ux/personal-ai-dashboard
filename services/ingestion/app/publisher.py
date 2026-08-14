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


RAW_VIDEO_DIRECTORY = Path("04-来源资料") / "视频"


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
        output_directory = self._ensure_output_directory()
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
        transcript = artifacts.get("transcript")
        if transcript is None:
            raise PublicationStateError("Approved job has no transcript artifact")
        transcript_text = transcript.path.read_text(encoding="utf-8").strip()
        if not transcript_text:
            raise PublicationStateError("Transcript artifact is empty")

        source_sha256 = _sha256_file(job.source_path)
        identity = "\0".join(
            ("raw-video-v1", job.id, source_sha256, transcript.sha256)
        ).encode("utf-8")
        publication_id = hashlib.sha256(identity).hexdigest()[:24]
        title = job.source_path.stem.strip() or "未命名视频"
        filename = f"{_safe_filename(title)}-{publication_id[:8]}.md"
        relative_path = (RAW_VIDEO_DIRECTORY / filename).as_posix()
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
                "---",
                "",
                f"# {title}",
                "",
                "## 来源",
                "",
                "- 类型：本地视频",
                f"- 原文件：`{job.source_path.name}`",
                "",
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

    def _approved_review(self, job_id: str):
        reviews = self.queue.list_reviews(job_id)
        if not reviews or reviews[-1].decision != "approved":
            raise PublicationNotAllowedError("Only an approved job can be published")
        return reviews[-1]

    def _ensure_output_directory(self) -> Path:
        try:
            vault_root = self.vault_root.resolve(strict=True)
        except OSError as error:
            raise PublicationStateError("Vault root does not exist") from error
        if not vault_root.is_dir():
            raise PublicationStateError("Vault root is not a directory")

        current = vault_root
        for part in RAW_VIDEO_DIRECTORY.parts:
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
        expected_directory = (vault_root / RAW_VIDEO_DIRECTORY).resolve(strict=True)
        if target.parent != expected_directory or not target.is_file():
            raise PublicationStateError("Recorded publication is outside the Raw video layer")
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
