import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.queue import DuplicateJobError, InvalidSourcePathError, JobQueue


class JobQueueTests(unittest.TestCase):
    def test_existing_local_video_database_is_upgraded_in_place(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "workbench.db"
            source = root / "legacy.mp4"
            source.write_bytes(b"video")
            with sqlite3.connect(database) as connection:
                connection.execute(
                    """
                    CREATE TABLE jobs (
                        id TEXT PRIMARY KEY,
                        source_path TEXT NOT NULL,
                        status TEXT NOT NULL,
                        output_dir TEXT NOT NULL,
                        params_json TEXT NOT NULL,
                        progress REAL NOT NULL,
                        current_step TEXT NOT NULL,
                        attempt_count INTEGER NOT NULL,
                        lease_owner TEXT,
                        lease_expires_at TEXT,
                        pid INTEGER,
                        error TEXT,
                        cancel_requested INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    INSERT INTO jobs VALUES (
                        'legacy', ?, 'succeeded', ?, ?, 1, 'Transcript approved',
                        1, NULL, NULL, NULL, NULL, 0, ?, ?
                    )
                    """,
                    (
                        str(source),
                        str(root / "runs" / "legacy"),
                        json.dumps({"vad": "false"}),
                        "2026-08-15T00:00:00+00:00",
                        "2026-08-15T00:00:00+00:00",
                    ),
                )
            connection.close()

            queue = JobQueue(database, root / "runs", (root,))
            migrated = queue.get("legacy")

            self.assertEqual(migrated.source_type, "local-video")
            self.assertEqual(migrated.source_path, source)
            self.assertIsNone(migrated.source_url)

    def test_job_queue_persists_web_source_without_local_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            queue = JobQueue(root / "workbench.db", root / "runs", ())

            created = queue.submit_web("https://example.com/article")

            self.assertEqual(created.source_type, "web-page")
            self.assertEqual(created.source_url, "https://example.com/article")
            self.assertIsNone(created.source_path)
            self.assertEqual(queue.get(created.id), created)
            with self.assertRaises(DuplicateJobError):
                queue.submit_web("https://example.com/article")

    def test_retry_can_override_vad_parameter(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            queue = JobQueue(root / "workbench.db", root / "runs", (source_root,))
            job = queue.submit(source, {"vad": "true"})
            queue.cancel(job.id)

            retried = queue.retry(job.id, {"vad": "false"})

            self.assertEqual(retried.params["vad"], "false")

    def test_heartbeat_progress_is_monotonic_and_emits_progress_event(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            queue = JobQueue(root / "workbench.db", root / "runs", (source_root,))
            submitted = queue.submit(source)
            claimed = queue.claim_next("worker-a", 30)
            assert claimed is not None
            cursor = queue.list_events(0)[-1].id

            queue.heartbeat(submitted.id, "worker-a", 30, 0.5, "Transcribing 00:10 / 00:20")
            queue.heartbeat(submitted.id, "worker-a", 30, 0.25, "Transcribing 00:05 / 00:20")

            current = queue.get(submitted.id)
            events = queue.list_events(cursor)
            self.assertEqual(current.progress, 0.5)
            self.assertEqual(current.current_step, "Transcribing 00:10 / 00:20")
            self.assertEqual(events[-1].event_type, "progress")
            self.assertEqual(events[-1].payload["progress"], 0.5)

    def test_job_queue_accepts_source_inside_approved_root(self) -> None:
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

            created = queue.submit(source)

            self.assertEqual(created.status, "queued")
            self.assertEqual(created.source_path, source.resolve())
            self.assertEqual(queue.get(created.id), created)

    def test_job_queue_rejects_source_outside_approved_roots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            outside = root / "private.mp4"
            outside.write_bytes(b"video")
            queue = JobQueue(
                database_path=root / "workbench.db",
                runs_dir=root / "runs",
                allowed_source_roots=(source_root,),
            )

            with self.assertRaises(InvalidSourcePathError):
                queue.submit(outside)

    def test_job_queue_rejects_duplicate_active_source(self) -> None:
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

            original = queue.submit(source)

            with self.assertRaises(DuplicateJobError) as raised:
                queue.submit(source)
            self.assertEqual(raised.exception.existing_job_id, original.id)

    def test_claim_next_assigns_a_job_only_once(self) -> None:
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

            claimed = queue.claim_next("worker-a", lease_seconds=30)

            self.assertIsNotNone(claimed)
            assert claimed is not None
            self.assertEqual(claimed.id, submitted.id)
            self.assertEqual(claimed.status, "running")
            self.assertEqual(claimed.lease_owner, "worker-a")
            self.assertEqual(claimed.attempt_count, 1)
            self.assertIsNone(queue.claim_next("worker-b", lease_seconds=30))

    def test_recovery_promotes_finished_orphan_when_artifacts_are_complete(self) -> None:
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
            queue.submit(source)
            claimed = queue.claim_next("old-worker", lease_seconds=1)
            assert claimed is not None
            claimed.output_dir.mkdir(parents=True)
            (claimed.output_dir / "transcript.txt").write_text("hello", encoding="utf-8")
            (claimed.output_dir / "transcript.srt").write_text("subtitle", encoding="utf-8")
            (claimed.output_dir / "transcript.json").write_text("{}", encoding="utf-8")
            queue.set_pid(claimed.id, "old-worker", 999_999)

            recovered = queue.recover_running(lambda pid: False)

            self.assertEqual(recovered, 1)
            self.assertEqual(queue.get(claimed.id).status, "waiting_review")
            self.assertEqual(len(queue.list_artifacts(claimed.id)), 3)

    def test_recovery_recognizes_completed_webpage_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            queue = JobQueue(root / "workbench.db", root / "runs", ())
            queue.submit_web("https://example.com/article")
            claimed = queue.claim_next("old-worker", lease_seconds=1)
            assert claimed is not None
            claimed.output_dir.mkdir(parents=True)
            (claimed.output_dir / "content.md").write_text(
                "# Article\n\nReadable content.",
                encoding="utf-8",
            )
            (claimed.output_dir / "metadata.json").write_text("{}", encoding="utf-8")
            (claimed.output_dir / "source.html").write_text(
                "<html><body>Readable content.</body></html>",
                encoding="utf-8",
            )
            queue.set_pid(claimed.id, "old-worker", 999_999)

            recovered = queue.recover_running(lambda pid: False)

            self.assertEqual(recovered, 1)
            self.assertEqual(queue.get(claimed.id).status, "waiting_review")
            self.assertEqual(
                {artifact.kind for artifact in queue.list_artifacts(claimed.id)},
                {"content", "metadata", "source_snapshot"},
            )

    def test_status_changes_are_available_as_ordered_events(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            queue = JobQueue(root / "workbench.db", root / "runs", (source_root,))

            submitted = queue.submit(source)
            queue.claim_next("worker-a", lease_seconds=30)
            events = queue.list_events(after_id=0)

            self.assertEqual([event.event_type for event in events], ["queued", "running"])
            self.assertEqual({event.job_id for event in events}, {submitted.id})
            self.assertLess(events[0].id, events[1].id)


if __name__ == "__main__":
    unittest.main()
