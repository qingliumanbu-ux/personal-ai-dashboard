import json
import tempfile
import unittest
from pathlib import Path

from app.provider import ArtifactDraft, ProviderResult
from app.publisher import PublicationConflictError, PublicationNotAllowedError, Publisher
from app.queue import JobQueue
from app.worker import Worker
from app.web import FetchedPage, WebPageProvider


VALID_SUMMARY = """## AI 候选摘要

这是一份经过人工核对的候选摘要。

## 核心要点

- 保留完整来源正文。

## 建议标签

- 测试

## 可复用方向

- 验证来源资料发布契约。

## 不确定内容

- 无。
"""


class FakeProvider:
    def run(self, job, control) -> ProviderResult:
        job.output_dir.mkdir(parents=True, exist_ok=True)
        drafts = []
        for kind, name, content in (
            ("transcript", "transcript.txt", "第一段转写。\n\n第二段转写。"),
            ("subtitles", "transcript.srt", "subtitle"),
            ("metadata", "transcript.json", "{}"),
        ):
            path = job.output_dir / name
            path.write_text(content, encoding="utf-8")
            drafts.append(ArtifactDraft(kind, path))
        return ProviderResult(tuple(drafts), None)


class PublisherTests(unittest.TestCase):
    def test_approved_douyin_video_publishes_markdown_without_media(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            queue = JobQueue(root / "runtime" / "ingestion.db", root / "runs", ())
            job = queue.submit_douyin(
                "https://v.douyin.com/AbCdEf12/",
                {
                    "capture_reason": "补充知识采集方案",
                    "summary_required": "true",
                },
            )

            class FakeDouyinProvider:
                def run(self, queued_job, control) -> ProviderResult:
                    queued_job.output_dir.mkdir(parents=True)
                    files = (
                        ("transcript", "transcript.txt", "抖音视频的本地转写正文。"),
                        ("subtitles", "transcript.srt", "subtitle"),
                        ("metadata", "transcript.json", "{}"),
                        ("source_media", "source.mp4", b"temporary-video"),
                        (
                            "source_metadata",
                            "source.json",
                            json.dumps(
                                {
                                    "source_type": "douyin-video",
                                    "video_id": "1234567890",
                                    "title": "收藏夹知识库方案",
                                    "final_url": "https://www.iesdouyin.com/share/video/1234567890",
                                    "captured_at": "2026-08-15T00:00:00+00:00",
                                },
                                ensure_ascii=False,
                            ),
                        ),
                    )
                    drafts = []
                    for kind, name, content in files:
                        path = queued_job.output_dir / name
                        if isinstance(content, bytes):
                            path.write_bytes(content)
                        else:
                            path.write_text(content, encoding="utf-8")
                        drafts.append(ArtifactDraft(kind, path))
                    return ProviderResult(tuple(drafts), None)

            Worker(queue, FakeDouyinProvider(), "worker-a").run_once()
            queue.save_candidate_summary(job.id, VALID_SUMMARY)
            queue.review(job.id, "approved", "内容通过")
            vault = root / "vault"
            vault.mkdir()

            publication = Publisher(queue, vault).publish(job.id)

            target = vault / Path(publication.relative_path)
            markdown = target.read_text(encoding="utf-8")
            self.assertTrue(publication.relative_path.startswith("04-来源资料/视频/"))
            self.assertIn("source_type: douyin-video", markdown)
            self.assertIn('source_url: "https://v.douyin.com/AbCdEf12/"', markdown)
            self.assertIn("# 收藏夹知识库方案", markdown)
            self.assertIn('summary_origin: "manual-import"', markdown)
            self.assertIn("## AI 候选摘要", markdown)
            self.assertIn("## 全文转写", markdown)
            self.assertIn("抖音视频的本地转写正文。", markdown)
            self.assertEqual(list(vault.rglob("*.mp4")), [])

    def test_approved_webpage_publishes_to_raw_web_layer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            queue = JobQueue(root / "runtime" / "ingestion.db", root / "runs", ())
            job = queue.submit_web(
                "https://example.com/article",
                {
                    "capture_tags": '["AI", "Obsidian"]',
                    "capture_reason": "补充网页采集方案",
                    "summary_required": "true",
                },
            )
            provider = WebPageProvider(
                fetcher=lambda _: FetchedPage(
                    final_url="https://example.com/article",
                    html=(
                        "<html><head><title>Example Article</title></head>"
                        "<body><article><p>Useful source text with enough detail.</p></article></body></html>"
                    ),
                    captured_at="2026-08-15T00:00:00+00:00",
                )
            )
            Worker(queue, provider, "worker-a").run_once()
            queue.save_candidate_summary(job.id, VALID_SUMMARY)
            queue.review(job.id, "approved", "内容通过")
            vault = root / "vault"
            vault.mkdir()

            publication = Publisher(queue, vault).publish(job.id)

            self.assertTrue(publication.relative_path.startswith("04-来源资料/网页/"))
            markdown = (vault / Path(publication.relative_path)).read_text(encoding="utf-8")
            self.assertIn("source_type: web-page", markdown)
            self.assertIn("source_url: \"https://example.com/article\"", markdown)
            self.assertIn('tags: ["AI", "Obsidian"]', markdown)
            self.assertIn('capture_reason: "补充网页采集方案"', markdown)
            self.assertIn("## 收藏上下文", markdown)
            self.assertIn("- 标签：AI、Obsidian", markdown)
            self.assertIn("- 收藏原因：补充网页采集方案", markdown)
            self.assertIn("# Example Article", markdown)
            self.assertIn('summary_origin: "manual-import"', markdown)
            self.assertIn("## AI 候选摘要", markdown)
            self.assertIn("## 网页正文", markdown)
            self.assertIn("Useful source text with enough detail.", markdown)
            self.assertNotIn("<html>", markdown)

    def create_job(self, root: Path):
        source_root = root / "sources"
        source_root.mkdir()
        source = source_root / "示例视频.mp4"
        source.write_bytes(b"video-content")
        queue = JobQueue(root / "runtime" / "ingestion.db", root / "runs", (source_root,))
        job = queue.submit(source)
        Worker(queue, FakeProvider(), "worker-a").run_once()
        vault = root / "vault"
        vault.mkdir()
        return queue, job, vault

    def test_only_approved_job_can_publish(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue, job, vault = self.create_job(Path(directory))
            publisher = Publisher(queue, vault)

            with self.assertRaises(PublicationNotAllowedError):
                publisher.publish(job.id)

            self.assertEqual(list(vault.rglob("*.md")), [])

    def test_approved_job_publishes_once_to_raw_video_layer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue, job, vault = self.create_job(Path(directory))
            queue.review(job.id, "approved", "内容通过")
            publisher = Publisher(queue, vault)

            first = publisher.publish(job.id)
            second = publisher.publish(job.id)

            self.assertEqual(first, second)
            self.assertTrue(first.relative_path.startswith("04-来源资料/视频/"))
            published_files = list((vault / "04-来源资料" / "视频").glob("*.md"))
            self.assertEqual(len(published_files), 1)
            markdown = published_files[0].read_text(encoding="utf-8")
            self.assertIn("type: raw-source", markdown)
            self.assertIn("第一段转写。", markdown)
            self.assertNotIn(str(queue.get(job.id).source_path.parent), markdown)
            self.assertEqual(queue.get_publication(job.id), first)

    def test_conflicting_target_is_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue, job, vault = self.create_job(Path(directory))
            queue.review(job.id, "approved", "内容通过")
            publisher = Publisher(queue, vault)
            preview = publisher.preview(job.id)
            target = vault / Path(preview.relative_path)
            target.parent.mkdir(parents=True)
            target.write_text("keep me", encoding="utf-8")

            with self.assertRaises(PublicationConflictError):
                publisher.publish(job.id)

            self.assertEqual(target.read_text(encoding="utf-8"), "keep me")
            self.assertIsNone(queue.get_publication(job.id))

    def test_failed_atomic_link_leaves_no_partial_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue, job, vault = self.create_job(Path(directory))
            queue.review(job.id, "approved", "内容通过")

            def fail_link(source, target):
                raise OSError("simulated link failure")

            publisher = Publisher(queue, vault, link_file=fail_link)

            with self.assertRaises(OSError):
                publisher.publish(job.id)

            target_dir = vault / "04-来源资料" / "视频"
            self.assertEqual(list(target_dir.iterdir()), [])
            self.assertIsNone(queue.get_publication(job.id))


if __name__ == "__main__":
    unittest.main()
