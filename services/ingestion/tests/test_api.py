import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import IngestionConfig
from app.main import create_app
from app.provider import ArtifactDraft, ProviderResult, VadCapability
from app.worker import Worker


VALID_SUMMARY = """## AI 候选摘要

这是一份测试摘要。

## 核心要点

- 保留完整来源。

## 建议标签

- 测试

## 可复用方向

- 验证发布流程。

## 不确定内容

- 无。
"""


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


class ApiFakeDouyinVideoProvider:
    def run(self, job, control) -> ProviderResult:
        job.output_dir.mkdir(parents=True, exist_ok=True)
        drafts = []
        for kind, name, content in (
            ("transcript", "transcript.txt", b"douyin transcript"),
            ("subtitles", "transcript.srt", b"subtitle"),
            ("metadata", "transcript.json", b"{}"),
            ("source_media", "source.mp4", b"temporary-video"),
            (
                "source_metadata",
                "source.json",
                json.dumps(
                    {
                        "source_type": "douyin-video",
                        "video_id": "123456",
                        "title": "测试抖音视频",
                        "final_url": job.source_url,
                        "captured_at": "2026-08-15T10:00:00+08:00",
                    },
                    ensure_ascii=False,
                ).encode("utf-8"),
            ),
        ):
            path = job.output_dir / name
            path.write_bytes(content)
            drafts.append(ArtifactDraft(kind, path))
        return ProviderResult(tuple(drafts), None)


class ApiTests(unittest.TestCase):
    def test_douyin_share_text_creates_a_queued_douyin_job(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = IngestionConfig.for_testing(root, ())
            shared_text = (
                "7.30 复制打开抖音，看看这个视频 "
                "https://v.douyin.com/AbCdEf12/ 重点看知识采集流程"
            )

            with TestClient(create_app(config, start_worker=False)) as client:
                created = client.post(
                    "/api/jobs",
                    json={
                        "source_type": "douyin",
                        "source_text": shared_text,
                        "tags": ["抖音", "知识库"],
                        "capture_reason": "补充采集方案",
                    },
                )

            self.assertEqual(created.status_code, 201)
            payload = created.json()
            self.assertEqual(payload["source_type"], "douyin")
            self.assertEqual(payload["status"], "queued")
            self.assertEqual(payload["source_url"], "https://v.douyin.com/AbCdEf12/")
            self.assertEqual(payload["params"]["capture_text"], shared_text)

    def test_douyin_source_rejects_non_douyin_links(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = IngestionConfig.for_testing(root, ())

            with TestClient(create_app(config, start_worker=False)) as client:
                rejected = client.post(
                    "/api/jobs",
                    json={
                        "source_type": "douyin",
                        "source_text": "伪装分享 https://example.com/video/123",
                    },
                )

            self.assertEqual(rejected.status_code, 400)
            self.assertIn("不是受支持的抖音公开链接", rejected.json()["detail"])

    def test_shared_text_creates_a_queued_job_with_capture_context(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = IngestionConfig.for_testing(root, ())
            shared_text = (
                "收藏这篇文章 https://example.com/article#notes "
                "稍后整理"
            )

            with TestClient(create_app(config, start_worker=False)) as client:
                created = client.post(
                    "/api/jobs",
                    json={
                        "source_type": "web-page",
                        "source_text": shared_text,
                        "tags": ["AI", " Obsidian ", "AI"],
                        "capture_reason": "补充移动端收藏流程",
                    },
                )

            self.assertEqual(created.status_code, 201)
            payload = created.json()
            self.assertEqual(payload["status"], "queued")
            self.assertEqual(payload["source_url"], "https://example.com/article")
            self.assertEqual(
                json.loads(payload["params"]["capture_tags"]),
                ["AI", "Obsidian"],
            )
            self.assertEqual(
                payload["params"]["capture_reason"],
                "补充移动端收藏流程",
            )
            self.assertEqual(payload["params"]["capture_text"], shared_text)

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

    def test_douyin_image_summary_prompt_omits_image_urls(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = IngestionConfig.for_testing(root, ())
            app = create_app(config, start_worker=False)
            queue = app.state.queue
            job = queue.submit_douyin("https://v.douyin.com/ImagePost1/")
            claimed = queue.claim_next("worker-a", lease_seconds=30)
            assert claimed is not None
            claimed.output_dir.mkdir(parents=True)
            content = claimed.output_dir / "content.md"
            metadata = claimed.output_dir / "source.json"
            image = claimed.output_dir / "001.webp"
            content.write_text(
                "# 图文标题\n\n正文内容。\n\n## 图片\n\n"
                "![图 1](<https://p3-sign.douyinpic.com/tos-cn-i/image-1>)\n",
                encoding="utf-8",
            )
            metadata.write_text('{"source_type":"douyin-image"}', encoding="utf-8")
            image.write_bytes(b"image")
            queue.complete(
                job.id,
                "worker-a",
                (
                    ArtifactDraft("content", content),
                    ArtifactDraft("source_metadata", metadata),
                    ArtifactDraft("source_image_001", image),
                ),
                None,
            )

            with TestClient(app) as client:
                response = client.get(f"/api/jobs/{job.id}/summary-prompt")
                detail = client.get(f"/api/jobs/{job.id}").json()
                image_artifact = next(
                    artifact
                    for artifact in detail["artifacts"]
                    if artifact["kind"] == "source_image_001"
                )
                image_response = client.get(image_artifact["download_url"])

            self.assertEqual(response.status_code, 200)
            self.assertIn("正文内容。", response.json()["prompt"])
            self.assertNotIn("douyinpic.com", response.json()["prompt"])
            self.assertEqual(image_response.headers["content-type"], "image/webp")

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
            self.assertEqual(
                health.json()["capabilities"]["douyin"],
                {
                    "available": True,
                    "reason": "仅支持无需登录即可访问的公开抖音视频或图文",
                },
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
                prompt = client.get(f"/api/jobs/{created['id']}/summary-prompt")
                saved = client.post(
                    f"/api/jobs/{created['id']}/candidate-summary",
                    json={"content": VALID_SUMMARY},
                )
                reviewed = client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "approved", "note": "内容通过"},
                )
                detail = client.get(f"/api/jobs/{created['id']}")

            self.assertEqual(prompt.status_code, 200)
            self.assertIn("hello", prompt.json()["prompt"])
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.json()["kind"], "candidate_summary")
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
                blocked = client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "approved", "note": "内容通过"},
                )
                client.post(
                    f"/api/jobs/{created['id']}/candidate-summary",
                    json={"content": VALID_SUMMARY},
                )
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
            self.assertEqual(blocked.status_code, 409)
            self.assertIn("AI 候选摘要", blocked.json()["detail"])
            self.assertEqual(published.status_code, 200)
            self.assertEqual(published.json(), repeated.json())
            self.assertTrue(published.json()["relative_path"].startswith("04-来源资料/视频/"))
            published_path = config.vault_root / Path(published.json()["relative_path"])
            self.assertTrue(published_path.is_file())
            markdown = published_path.read_text(encoding="utf-8")
            self.assertIn("## AI 候选摘要", markdown)
            self.assertIn("## 全文转写", markdown)

    def test_published_douyin_video_supports_confirmed_media_retention(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = IngestionConfig.for_testing(root, ())
            config.vault_root.mkdir()
            app = create_app(config, start_worker=False)

            with TestClient(app) as client:
                created = client.post(
                    "/api/jobs",
                    json={
                        "source_type": "douyin",
                        "source_url": "https://www.douyin.com/video/123456",
                    },
                ).json()
                Worker(
                    app.state.queue,
                    ApiFakeDouyinVideoProvider(),
                    "worker-a",
                ).run_once()
                client.post(
                    f"/api/jobs/{created['id']}/candidate-summary",
                    json={"content": VALID_SUMMARY},
                )
                client.post(
                    f"/api/jobs/{created['id']}/review",
                    json={"decision": "approved", "note": "内容通过"},
                )
                blocked_before_publish = client.post(
                    f"/api/jobs/{created['id']}/media-retention",
                    json={"policy": "keep_30_days", "confirm": True},
                )
                client.post(
                    f"/api/jobs/{created['id']}/publish",
                    json={"confirm": True},
                )
                missing_confirmation = client.post(
                    f"/api/jobs/{created['id']}/media-retention",
                    json={"policy": "keep_30_days", "confirm": False},
                )
                permanent = client.post(
                    f"/api/jobs/{created['id']}/media-retention",
                    json={"policy": "keep_forever", "confirm": True},
                )
                retained = client.post(
                    f"/api/jobs/{created['id']}/media-retention",
                    json={"policy": "keep_30_days", "confirm": True},
                )
                cleaned = client.post(
                    f"/api/jobs/{created['id']}/media-retention",
                    json={"policy": "delete_now", "confirm": True},
                )
                repeated = client.post(
                    f"/api/jobs/{created['id']}/media-retention",
                    json={"policy": "delete_now", "confirm": True},
                )
                detail = client.get(f"/api/jobs/{created['id']}").json()

            self.assertEqual(blocked_before_publish.status_code, 409)
            self.assertEqual(missing_confirmation.status_code, 400)
            self.assertEqual(permanent.status_code, 200)
            self.assertEqual(permanent.json()["policy"], "keep_forever")
            self.assertIsNone(permanent.json()["delete_after"])
            self.assertEqual(retained.status_code, 200)
            self.assertEqual(retained.json()["policy"], "keep_30_days")
            self.assertEqual(retained.json()["state"], "retained")
            self.assertTrue(retained.json()["media_present"])
            self.assertIsNotNone(retained.json()["delete_after"])
            self.assertEqual(cleaned.status_code, 200)
            self.assertEqual(cleaned.json()["policy"], "delete_now")
            self.assertEqual(cleaned.json()["state"], "cleaned")
            self.assertFalse(cleaned.json()["media_present"])
            self.assertIsNotNone(cleaned.json()["cleaned_at"])
            self.assertEqual(repeated.json(), cleaned.json())
            self.assertNotIn(
                "source_media",
                {artifact["kind"] for artifact in detail["artifacts"]},
            )
            self.assertIn(
                "transcript",
                {artifact["kind"] for artifact in detail["artifacts"]},
            )

    def test_media_retention_never_deletes_douyin_image_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = IngestionConfig.for_testing(root, ())
            config.vault_root.mkdir()
            app = create_app(config, start_worker=False)
            queue = app.state.queue
            job = queue.submit_douyin("https://www.douyin.com/note/987654")
            claimed = queue.claim_next("worker-a", lease_seconds=30)
            assert claimed is not None
            claimed.output_dir.mkdir(parents=True)
            content = claimed.output_dir / "content.md"
            metadata = claimed.output_dir / "source.json"
            image = claimed.output_dir / "001.webp"
            content.write_text("# 测试图文\n\n图文正文。", encoding="utf-8")
            metadata.write_text(
                json.dumps(
                    {
                        "source_type": "douyin-image",
                        "post_id": "987654",
                        "title": "测试图文",
                        "final_url": job.source_url,
                        "captured_at": "2026-08-15T10:00:00+08:00",
                        "images": [{"url": "https://p3-sign.douyinpic.com/image-1"}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            image.write_bytes(b"synthetic-image")
            queue.complete(
                job.id,
                "worker-a",
                (
                    ArtifactDraft("content", content),
                    ArtifactDraft("source_metadata", metadata),
                    ArtifactDraft("source_image_001", image),
                ),
                None,
            )

            with TestClient(app) as client:
                client.post(
                    f"/api/jobs/{job.id}/candidate-summary",
                    json={"content": VALID_SUMMARY},
                )
                client.post(
                    f"/api/jobs/{job.id}/review",
                    json={"decision": "approved", "note": "内容通过"},
                )
                client.post(f"/api/jobs/{job.id}/publish", json={"confirm": True})
                rejected = client.post(
                    f"/api/jobs/{job.id}/media-retention",
                    json={"policy": "delete_now", "confirm": True},
                )
                detail = client.get(f"/api/jobs/{job.id}").json()

            self.assertEqual(rejected.status_code, 409)
            self.assertTrue(image.is_file())
            self.assertIsNone(detail["media_retention"])
            self.assertIn(
                "source_image_001",
                {artifact["kind"] for artifact in detail["artifacts"]},
            )

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
