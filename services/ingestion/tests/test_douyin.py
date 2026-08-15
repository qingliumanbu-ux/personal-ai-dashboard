import base64
import json
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import httpx

from app.douyin import (
    DouyinPage,
    DouyinProvider,
    DouyinVideo,
    InvalidDouyinSourceError,
    UnsupportedDouyinPostError,
    download_douyin_media,
    fetch_douyin_page,
    resolve_douyin_video_in_browser,
)
from app.provider import ArtifactDraft, ProviderResult
from app.queue import JobQueue
from app.worker import Worker


class FakeLocalTranscriber:
    def __init__(self) -> None:
        self.source_path = None

    def run(self, job, control) -> ProviderResult:
        self.source_path = job.source_path
        self.assert_local_job(job)
        drafts = []
        for kind, name, content in (
            ("transcript", "transcript.txt", "这是一段本地转写。"),
            ("subtitles", "transcript.srt", "subtitle"),
            ("metadata", "transcript.json", "{}"),
        ):
            path = job.output_dir / name
            path.write_text(content, encoding="utf-8")
            drafts.append(ArtifactDraft(kind, path))
        return ProviderResult(tuple(drafts), None)

    @staticmethod
    def assert_local_job(job) -> None:
        if job.source_type != "local-video":
            raise AssertionError("Douyin provider did not adapt to the local transcriber")
        if job.source_path != job.output_dir / "source.mp4":
            raise AssertionError("Downloaded media is not in the job Run directory")


class DouyinProviderTests(unittest.TestCase):
    def test_browser_fallback_uses_an_isolated_session_without_saved_state(self) -> None:
        calls = []

        def runner(command, **kwargs):
            calls.append((command, kwargs))
            if command[-2] == "-b":
                script = base64.b64decode(command[-1]).decode("utf-8")
                self.assertIn("document.querySelectorAll('video')", script)
                self.assertIn("douyinvod.com", script)
                self.assertNotIn("douyinstatic.com", script)
                self.assertNotIn("byteimg.com", script)
                self.assertIn("readyState >= 1", script)
                kwargs["stdout"].write(
                    json.dumps(
                        {
                            "media_url": "https://v26-web.douyinvod.com/video/play/rendered",
                            "video_id": "1234567890",
                            "title": "公开页面标题",
                        }
                    ).encode("utf-8")
                )
            return subprocess.CompletedProcess(command, 0)

        video = resolve_douyin_video_in_browser(
            "https://v.douyin.com/Rendered1/",
            runner=runner,
            executable=sys.executable,
        )

        commands = [call[0] for call in calls]
        session_ids = {command[2] for command in commands}
        flattened = [part for command in commands for part in command]
        self.assertEqual(video.video_id, "1234567890")
        self.assertEqual(len(session_ids), 1)
        self.assertNotIn("--profile", flattened)
        self.assertNotIn("--restore", flattened)
        self.assertEqual([command[3] for command in commands], ["open", "eval", "close"])
        self.assertEqual(commands[1][4], "-b")

    def test_browser_fallback_reports_an_image_post_explicitly(self) -> None:
        def runner(command, **kwargs):
            if command[-2] == "-b":
                kwargs["stdout"].write(
                    json.dumps(
                        {
                            "media_url": "",
                            "video_id": "7673485154678249971",
                            "title": "公开图文帖",
                            "post_kind": "image",
                        }
                    ).encode("utf-8")
                )
            return subprocess.CompletedProcess(command, 0)

        with self.assertRaisesRegex(UnsupportedDouyinPostError, "图文帖"):
            resolve_douyin_video_in_browser(
                "https://v.douyin.com/ImagePost1/",
                runner=runner,
                executable=sys.executable,
            )

    def test_provider_falls_back_to_rendered_page_when_html_data_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            queue = JobQueue(root / "ingestion.db", root / "runs", ())
            job = queue.submit_douyin("https://v.douyin.com/Rendered1/")
            router_data = {
                "loaderData": {
                    "video_(id)/page": {
                        "itemId": "1234567890",
                        "renderInSSR": 1,
                        "isSpider": False,
                    }
                }
            }
            page = DouyinPage(
                final_url="https://www.iesdouyin.com/share/video/1234567890",
                html=(
                    "<script>window._ROUTER_DATA = "
                    f"{json.dumps(router_data)}"
                    "</script>"
                ),
                captured_at="2026-08-15T00:00:00+00:00",
            )
            browser_calls = []

            def resolve_in_browser(source_url):
                browser_calls.append(source_url)
                return DouyinVideo(
                    video_id="1234567890",
                    title="浏览器渲染后的视频标题",
                    media_url="https://v26-web.douyinvod.com/video/play/rendered",
                )

            def download(url, target, control) -> None:
                target.write_bytes(b"temporary-video")

            provider = DouyinProvider(
                transcriber=FakeLocalTranscriber(),
                fetcher=lambda _: page,
                downloader=download,
                browser_resolver=resolve_in_browser,
            )

            Worker(queue, provider, "worker-a").run_once()

            completed = queue.get(job.id)
            metadata = {
                artifact.kind: artifact for artifact in queue.list_artifacts(job.id)
            }["source_metadata"]
            self.assertEqual(completed.status, "waiting_review")
            self.assertEqual(browser_calls, [job.source_url])
            self.assertEqual(
                json.loads(metadata.path.read_text(encoding="utf-8"))["title"],
                "浏览器渲染后的视频标题",
            )

    def test_image_post_failure_is_explicit_and_never_downloads_media(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            queue = JobQueue(root / "ingestion.db", root / "runs", ())
            job = queue.submit_douyin("https://v.douyin.com/ImageNote1/")
            router_data = {
                "loaderData": {
                    "note_(id)/page": {
                        "videoInfoRes": {
                            "item_list": [
                                {
                                    "aweme_id": "9988",
                                    "desc": "一篇图文",
                                    "images": [{"url_list": ["https://example.com/image"]}],
                                }
                            ]
                        }
                    }
                }
            }
            page = DouyinPage(
                final_url="https://www.douyin.com/note/9988",
                html=(
                    "<script>window._ROUTER_DATA = "
                    f"{json.dumps(router_data)}"
                    "</script>"
                ),
                captured_at="2026-08-15T00:00:00+00:00",
            )
            download_called = False

            def download(url, target, control) -> None:
                nonlocal download_called
                download_called = True

            provider = DouyinProvider(
                transcriber=FakeLocalTranscriber(),
                fetcher=lambda _: page,
                downloader=download,
            )

            Worker(queue, provider, "worker-a").run_once()

            failed = queue.get(job.id)
            self.assertEqual(failed.status, "failed")
            self.assertIn("图文帖", failed.error)
            self.assertFalse(download_called)

    def test_media_download_writes_only_the_requested_run_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "runs" / "job-1" / "source.mp4"

            def handler(request: httpx.Request) -> httpx.Response:
                self.assertEqual(request.headers["referer"], "https://www.douyin.com/")
                self.assertIn("Chrome/", request.headers["user-agent"])
                return httpx.Response(
                    200,
                    headers={
                        "content-type": "video/mp4",
                        "content-length": "11",
                    },
                    content=b"video-bytes",
                )

            def resolver(host, port, type=0):
                return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

            download_douyin_media(
                "https://v3-web.douyinvod.com/video/play/test?x-signature=temporary",
                target,
                control=None,
                resolver=resolver,
                transport=httpx.MockTransport(handler),
            )

            self.assertEqual(target.read_bytes(), b"video-bytes")
            self.assertEqual(list(target.parent.iterdir()), [target])

    def test_page_redirect_cannot_escape_douyin_domains(self) -> None:
        requested = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append(str(request.url))
            return httpx.Response(
                302,
                headers={"location": "https://example.com/private-target"},
            )

        def resolver(host, port, type=0):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

        with self.assertRaises(InvalidDouyinSourceError):
            fetch_douyin_page(
                "https://v.douyin.com/AbCdEf12/",
                resolver=resolver,
                transport=httpx.MockTransport(handler),
            )

        self.assertEqual(requested, ["https://v.douyin.com/AbCdEf12/"])

    def test_video_is_downloaded_into_run_and_enters_review_queue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            queue = JobQueue(root / "ingestion.db", root / "runs", ())
            job = queue.submit_douyin("https://v.douyin.com/AbCdEf12/")
            router_data = {
                "loaderData": {
                    "video_(id)/page": {
                        "videoInfoRes": {
                            "item_list": [
                                {
                                    "aweme_id": "1234567890",
                                    "desc": "收藏夹知识库方案",
                                    "video": {
                                        "play_addr": {
                                            "url_list": [
                                                "https://v3-web.douyinvod.com/video/playwm/test"
                                            ]
                                        }
                                    },
                                }
                            ]
                        }
                    }
                }
            }
            page = DouyinPage(
                final_url="https://www.iesdouyin.com/share/video/1234567890",
                html=(
                    "<script>window._ROUTER_DATA = "
                    f"{json.dumps(router_data)}"
                    "</script>"
                ),
                captured_at="2026-08-15T00:00:00+00:00",
            )
            downloaded_urls = []

            def download(url, target, control) -> None:
                downloaded_urls.append(url)
                target.write_bytes(b"temporary-video")

            transcriber = FakeLocalTranscriber()
            provider = DouyinProvider(
                transcriber=transcriber,
                fetcher=lambda _: page,
                downloader=download,
            )

            Worker(queue, provider, "worker-a").run_once()

            completed = queue.get(job.id)
            artifacts = {artifact.kind: artifact for artifact in queue.list_artifacts(job.id)}
            self.assertEqual(completed.status, "waiting_review")
            self.assertEqual(transcriber.source_path, job.output_dir / "source.mp4")
            self.assertEqual(downloaded_urls, ["https://v3-web.douyinvod.com/video/play/test"])
            self.assertEqual(artifacts["source_media"].path, job.output_dir / "source.mp4")
            self.assertEqual(
                json.loads(artifacts["source_metadata"].path.read_text(encoding="utf-8"))["title"],
                "收藏夹知识库方案",
            )


if __name__ == "__main__":
    unittest.main()
