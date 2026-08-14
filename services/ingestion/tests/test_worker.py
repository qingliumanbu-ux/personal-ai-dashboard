import tempfile
import unittest
from pathlib import Path

from app.provider import ArtifactDraft, ProviderCancelled, ProviderResult
from app.queue import JobQueue
from app.worker import Worker


class FakeTranscriptionProvider:
    def run(self, job, control) -> ProviderResult:
        job.output_dir.mkdir(parents=True, exist_ok=True)
        artifacts = []
        for kind, filename, content in (
            ("transcript", "transcript.txt", "hello"),
            ("subtitles", "transcript.srt", "1\n00:00:00,000 --> 00:00:01,000\nhello"),
            ("metadata", "transcript.json", '{"text":"hello"}'),
        ):
            path = job.output_dir / filename
            path.write_text(content, encoding="utf-8")
            artifacts.append(ArtifactDraft(kind=kind, path=path))
        return ProviderResult(artifacts=tuple(artifacts), log_path=None)


class FailingTranscriptionProvider:
    def run(self, job, control) -> ProviderResult:
        raise RuntimeError("decoder stopped")


class CancelledTranscriptionProvider:
    def run(self, job, control) -> ProviderResult:
        raise ProviderCancelled()


class WorkerTests(unittest.TestCase):
    def test_worker_stops_completed_transcription_at_waiting_review(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            queue = JobQueue(
                database_path=root / "workbench.db",
                runs_dir=root / "runs",
                allowed_source_roots=(source_root,),
            )
            submitted = queue.submit(source)
            worker = Worker(queue=queue, provider=FakeTranscriptionProvider(), worker_id="worker-a")

            self.assertTrue(worker.run_once())

            completed = queue.get(submitted.id)
            self.assertEqual(completed.status, "waiting_review")
            self.assertEqual(completed.progress, 1)
            self.assertEqual(
                {artifact.kind for artifact in queue.list_artifacts(submitted.id)},
                {"transcript", "subtitles", "metadata"},
            )

    def test_failed_transcription_can_be_retried_manually(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            queue = JobQueue(
                database_path=root / "workbench.db",
                runs_dir=root / "runs",
                allowed_source_roots=(source_root,),
            )
            submitted = queue.submit(source)
            worker = Worker(queue, FailingTranscriptionProvider(), "worker-a")

            worker.run_once()
            failed = queue.get(submitted.id)
            self.assertEqual(failed.status, "failed")
            self.assertIn("decoder stopped", failed.error or "")

            retried = queue.retry(submitted.id)
            self.assertEqual(retried.status, "queued")
            self.assertIsNone(retried.error)

    def test_cancelled_provider_is_not_recorded_as_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            queue = JobQueue(
                database_path=root / "workbench.db",
                runs_dir=root / "runs",
                allowed_source_roots=(source_root,),
            )
            submitted = queue.submit(source)
            worker = Worker(queue, CancelledTranscriptionProvider(), "worker-a")

            worker.run_once()

            cancelled = queue.get(submitted.id)
            self.assertEqual(cancelled.status, "cancelled")
            self.assertIsNone(cancelled.error)
