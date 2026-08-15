import json
import socket
import tempfile
import unittest
from pathlib import Path

import httpx

from app.douyin import (
    DouyinPage,
    DouyinProvider,
    InvalidDouyinSourceError,
    download_douyin_media,
    fetch_douyin_page,
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
