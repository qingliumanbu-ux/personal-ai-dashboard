import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import IngestionConfig
from app.main import create_app
from app.provider import ArtifactDraft, ProviderResult, VadCapability
from app.worker import Worker


class ApiFakeProvider:
    def run(self, job, control) -> ProviderResult:
        job.output_dir.mkdir(parents=True, exist_ok=True)
        drafts = []
        for kind, name, content in (
            ("transcript", "transcript.txt", "hello"),
            ("subtitles", "transcript.srt", "subtitle"),
            ("metadata", "transcript.json", "{}"),
        ):
            path = job.output_dir / name
            path.write_text(content, encoding="utf-8")
            drafts.append(ArtifactDraft(kind, path))
        return ProviderResult(tuple(drafts), None)


class ApiTests(unittest.TestCase):
    def test_accepts_web_source_and_rejects_video_only_options(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = IngestionConfig.for_testing(root, ())

            with TestClient(create_app(config, start_worker=False)) as client:
                created = client.post(
                    "/api/jobs",
                    json={
                        "source_type": "web-page",
                        "source_url": "https://example.com/article",
                    },
                )
                rejected = client.post(
                    "/api/jobs",
                    json={
                        "source_type": "web-page",
                        "source_url": "https://example.com/article-2",
                        "vad": True,
                    },
                )

            self.assertEqual(created.status_code, 201)
            self.assertEqual(created.json()["source_type"], "web-page")
            self.assertEqual(
                created.json()["source_url"],
                "https://example.com/article",
            )
            self.assertIsNone(created.json()["source_path"])
            self.assertEqual(rejected.status_code, 422)

    def test_health_exposes_vad_capability_and_rejects_unavailable_vad(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))
            capability = VadCapability(False, "onnxruntime could not be loaded")

            with TestClient(
                create_app(config, start_worker=False, vad_capability=capability)
            ) as client:
                health = client.get("/api/health")
                rejected = client.post(
                    "/api/jobs",
                    json={"source_path": str(source), "vad": True},
                )
                accepted = client.post(
                    "/api/jobs",
                    json={"source_path": str(source), "vad": False},
                )

            self.assertEqual(
                health.json()["capabilities"]["vad"],
                {"available": False, "reason": "onnxruntime could not be loaded"},
            )
            self.assertEqual(rejected.status_code, 422)
            self.assertEqual(accepted.status_code, 201)

    def test_retry_can_disable_vad_when_runtime_is_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))
            app = create_app(
                config,
                start_worker=False,
                vad_capability=VadCapability(False, "onnxruntime could not be loaded"),
            )
            job = app.state.queue.submit(source, {"vad": "true"})
            app.state.queue.cancel(job.id)

            with TestClient(app) as client:
                unchanged = client.post(f"/api/jobs/{job.id}/retry", json={})
                retried = client.post(
                    f"/api/jobs/{job.id}/retry",
                    json={"vad": False},
                )

            self.assertEqual(unchanged.status_code, 422)
            self.assertEqual(retried.status_code, 200)
            self.assertEqual(retried.json()["params"]["vad"], "false")

    def test_rejects_paths_outside_approved_source_roots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            outside = root / "outside.mp4"
            outside.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))

            with TestClient(create_app(config, start_worker=False)) as client:
                response = client.post("/api/jobs", json={"source_path": str(outside)})

            self.assertEqual(response.status_code, 400)

    def test_duplicate_active_source_returns_existing_job_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))

            with TestClient(create_app(config, start_worker=False)) as client:
                first = client.post("/api/jobs", json={"source_path": str(source)})
                duplicate = client.post("/api/jobs", json={"source_path": str(source)})

            self.assertEqual(duplicate.status_code, 409)
            self.assertEqual(duplicate.json()["detail"]["job_id"], first.json()["id"])

    def test_rejects_disallowed_host_and_origin(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            config = IngestionConfig.for_testing(root, (source_root,))

            with TestClient(create_app(config, start_worker=False)) as client:
                bad_host = client.get("/api/health", headers={"host": "example.com"})
                bad_origin = client.get(
                    "/api/health",
                    headers={"origin": "https://example.com"},
                )

            self.assertEqual(bad_host.status_code, 403)
            self.assertEqual(bad_origin.status_code, 403)

    def test_accepts_loopback_dashboard_origin_on_an_alternate_dev_port(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            config = IngestionConfig.for_testing(root, (source_root,))

            with TestClient(create_app(config, start_worker=False)) as client:
                response = client.get(
                    "/api/health",
                    headers={"origin": "http://127.0.0.1:5174"},
                )

            self.assertEqual(response.status_code, 200)

    def test_submit_and_list_jobs_through_http_interface(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))

            with TestClient(create_app(config, start_worker=False)) as client:
                created = client.post(
                    "/api/jobs",
                    json={"source_path": str(source), "language": "zh", "model": "small"},
                )
                listed = client.get("/api/jobs")

            self.assertEqual(created.status_code, 201)
            self.assertEqual(created.json()["status"], "queued")
            self.assertEqual(listed.status_code, 200)
            self.assertEqual([job["id"] for job in listed.json()], [created.json()["id"]])

    def test_cancelled_queued_job_can_be_retried_through_http(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))

            with TestClient(create_app(config, start_worker=False)) as client:
                created = client.post("/api/jobs", json={"source_path": str(source)}).json()
                cancelled = client.post(f"/api/jobs/{created['id']}/cancel")
                retried = client.post(f"/api/jobs/{created['id']}/retry")

            self.assertEqual(cancelled.status_code, 200)
            self.assertEqual(cancelled.json()["status"], "cancelled")
            self.assertEqual(retried.status_code, 200)
            self.assertEqual(retried.json()["status"], "queued")

    def test_job_detail_exposes_attempts_and_registered_artifact_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))
            app = create_app(config, start_worker=False)

            with TestClient(app) as client:
                created = client.post("/api/jobs", json={"source_path": str(source)}).json()
                Worker(app.state.queue, ApiFakeProvider(), "worker-a").run_once()
                detail = client.get(f"/api/jobs/{created['id']}")
                artifact = detail.json()["artifacts"][0]
                downloaded = client.get(
                    f"/api/jobs/{created['id']}/artifacts/{artifact['id']}"
                )

            self.assertEqual(detail.status_code, 200)
            self.assertEqual(len(detail.json()["attempts"]), 1)
            self.assertEqual(detail.json()["attempts"][0]["exit_code"], 0)
            self.assertEqual(len(detail.json()["artifacts"]), 3)
            self.assertEqual(downloaded.status_code, 200)
            self.assertGreater(len(downloaded.content), 0)

    def test_user_can_approve_a_completed_transcript_through_http(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))
            app = create_app(config, start_worker=False)

            with TestClient(app) as client:
                created = client.post("/api/jobs", json={"source_path": str(source)}).json()
                Worker(app.state.queue, ApiFakeProvider(), "worker-a").run_once()
                reviewed = client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "approved", "note": "内容通过"},
                )
                detail = client.get(f"/api/jobs/{created['id']}")

            self.assertEqual(reviewed.status_code, 200)
            self.assertEqual(reviewed.json()["status"], "succeeded")
            self.assertEqual(reviewed.json()["current_step"], "Transcript approved")
            self.assertEqual(
                detail.json()["reviews"],
                [
                    {
                        "decision": "approved",
                        "note": "内容通过",
                        "created_at": detail.json()["reviews"][0]["created_at"],
                    }
                ],
            )

    def test_approved_transcript_requires_explicit_publish_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))
            config.vault_root.mkdir()
            app = create_app(config, start_worker=False)

            with TestClient(app) as client:
                created = client.post("/api/jobs", json={"source_path": str(source)}).json()
                Worker(app.state.queue, ApiFakeProvider(), "worker-a").run_once()
                client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "approved", "note": "内容通过"},
                )
                missing_confirmation = client.post(
                    f"/api/jobs/{created['id']}/publish",
                    json={"confirm": False},
                )
                published = client.post(
                    f"/api/jobs/{created['id']}/publish",
                    json={"confirm": True},
                )
                repeated = client.post(
                    f"/api/jobs/{created['id']}/publish",
                    json={"confirm": True},
                )

            self.assertEqual(missing_confirmation.status_code, 400)
            self.assertEqual(published.status_code, 200)
            self.assertEqual(published.json(), repeated.json())
            self.assertTrue(published.json()["relative_path"].startswith("04-来源资料/视频/"))
            self.assertTrue((config.vault_root / Path(published.json()["relative_path"])).is_file())

    def test_changes_requested_requires_a_note_and_allows_a_new_job(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))
            app = create_app(config, start_worker=False)

            with TestClient(app) as client:
                created = client.post("/api/jobs", json={"source_path": str(source)}).json()
                Worker(app.state.queue, ApiFakeProvider(), "worker-a").run_once()
                missing_note = client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "changes_requested", "note": ""},
                )
                reviewed = client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "changes_requested", "note": "人名需要修正"},
                )
                replacement = client.post(
                    "/api/jobs",
                    json={"source_path": str(source)},
                )

            self.assertEqual(missing_note.status_code, 409)
            self.assertEqual(reviewed.status_code, 200)
            self.assertEqual(reviewed.json()["status"], "changes_requested")
            self.assertEqual(replacement.status_code, 201)
            self.assertEqual(replacement.json()["status"], "queued")
            self.assertNotEqual(replacement.json()["id"], created["id"])

    def test_rejection_requires_a_note_and_cannot_be_reviewed_twice(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            config = IngestionConfig.for_testing(root, (source_root,))
            app = create_app(config, start_worker=False)

            with TestClient(app) as client:
                created = client.post("/api/jobs", json={"source_path": str(source)}).json()
                Worker(app.state.queue, ApiFakeProvider(), "worker-a").run_once()
                missing_note = client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "rejected", "note": ""},
                )
                rejected = client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "rejected", "note": "内容不可用"},
                )
                repeated = client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "approved", "note": ""},
                )

            self.assertEqual(missing_note.status_code, 409)
            self.assertEqual(rejected.status_code, 200)
            self.assertEqual(rejected.json()["status"], "rejected")
            self.assertEqual(repeated.status_code, 409)


if __name__ == "__main__":
    unittest.main()
