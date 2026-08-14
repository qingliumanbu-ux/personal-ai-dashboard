import tempfile
import unittest
from pathlib import Path

from app.provider import ArtifactDraft, ProviderResult
from app.publisher import PublicationConflictError, PublicationNotAllowedError, Publisher
from app.queue import JobQueue
from app.worker import Worker


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
