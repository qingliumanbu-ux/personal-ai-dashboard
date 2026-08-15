import json
import socket
import tempfile
import unittest
from pathlib import Path

from app.queue import JobQueue
from app.web import (
    _extract_page_text,
    extract_shared_url,
    FetchedPage,
    InvalidWebSourceError,
    WebPageProvider,
    normalize_web_url,
    validate_public_web_url,
)
from app.worker import Worker


class RecordingControl:
    def __init__(self) -> None:
        self.steps = []

    def set_pid(self, pid: int) -> None:
        raise AssertionError("Web ingestion must not create a subprocess")

    def heartbeat(self, progress: float, current_step: str) -> None:
        self.steps.append((progress, current_step))

    def is_cancel_requested(self) -> bool:
        return False


class WebSourceTests(unittest.TestCase):
    def test_extracts_article_without_surrounding_site_chrome(self) -> None:
        title, text = _extract_page_text(
            """
            <html>
              <head><title>Synthetic update - Example Community</title></head>
              <body>
                <header><nav>Home Products Search</nav></header>
                <main>
                  <section class="layout-main">
                    <section class="col-article">
                      <h1>Synthetic update</h1>
                      <div class="article-infos">Source: Example Desk</div>
                      <div class="article-content">
                        <p>The first useful paragraph explains the change.</p>
                        <p>The second useful paragraph records its impact.</p>
                      </div>
                      <ul class="article-source">
                        <li>Published: 2026-08-15</li>
                        <li>Original: https://example.com/original</li>
                      </ul>
                      <div class="share-operations">Share this article</div>
                    </section>
                    <ul class="sibling-articles"><li>Previous: unrelated story</li></ul>
                    <section class="related-news">Related news item</section>
                  </section>
                </main>
                <footer>Copyright Example Community</footer>
              </body>
            </html>
            """,
            "https://example.com/news/1",
        )

        self.assertEqual(title, "Synthetic update")
        self.assertNotIn("Synthetic update", text)
        self.assertIn("The first useful paragraph", text)
        self.assertIn("Source: Example Desk", text)
        self.assertIn("Published: 2026-08-15", text)
        self.assertIn("Original: https://example.com/original", text)
        self.assertNotIn("Home Products Search", text)
        self.assertNotIn("Share this article", text)
        self.assertNotIn("Previous: unrelated story", text)
        self.assertNotIn("Related news item", text)
        self.assertNotIn("Copyright Example Community", text)

    def test_extracts_the_first_public_url_from_shared_text(self) -> None:
        shared_text = (
            "4.20 复制打开抖音，看看【知识库示例】 "
            "https://v.douyin.com/abc123/ 复制此链接，打开 App"
        )

        self.assertEqual(
            extract_shared_url(shared_text),
            "https://v.douyin.com/abc123/",
        )

    def test_normalizes_public_http_url_without_fragment(self) -> None:
        normalized = normalize_web_url("HTTPS://Example.COM/article?q=notes#section")

        self.assertEqual(normalized, "https://example.com/article?q=notes")

    def test_rejects_unsafe_or_secret_bearing_urls(self) -> None:
        for value in (
            "ftp://example.com/file",
            "http://localhost/admin",
            "http://127.0.0.1/admin",
            "http://169.254.169.254/latest/meta-data",
            "https://user:password@example.com/article",
            "https://example.com/article?access_token=secret",
        ):
            with self.subTest(value=value):
                with self.assertRaises(InvalidWebSourceError):
                    normalize_web_url(value)

    def test_rejects_hostname_that_resolves_to_private_address(self) -> None:
        def private_resolver(host, port, type=0):
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", port))
            ]

        with self.assertRaises(InvalidWebSourceError):
            validate_public_web_url(
                "https://internal.example/article",
                resolver=private_resolver,
            )

    def test_web_provider_extracts_reviewable_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            queue = JobQueue(root / "ingestion.db", root / "runs", ())
            job = queue.submit_web("https://example.com/article")
            page = FetchedPage(
                final_url="https://example.com/article",
                html=(
                    "<html><head><title>Example Article</title>"
                    "<script>privateNoise()</script></head>"
                    "<body><main><h1>Example Article</h1>"
                    "<p>First useful paragraph.</p>"
                    "<p>Second useful paragraph.</p></main></body></html>"
                ),
                captured_at="2026-08-15T00:00:00+00:00",
            )
            provider = WebPageProvider(fetcher=lambda _: page)
            control = RecordingControl()

            claimed = queue.claim_next("worker-a", 30)
            assert claimed is not None
            result = provider.run(claimed, control)
            queue.complete(claimed.id, "worker-a", result.artifacts, result.log_path)

            artifacts = {item.kind: item for item in queue.list_artifacts(job.id)}
            self.assertEqual(
                set(artifacts),
                {"content", "metadata", "source_snapshot"},
            )
            content = artifacts["content"].path.read_text(encoding="utf-8")
            metadata = json.loads(
                artifacts["metadata"].path.read_text(encoding="utf-8")
            )
            self.assertIn("# Example Article", content)
            self.assertIn("First useful paragraph.", content)
            self.assertNotIn("privateNoise", content)
            self.assertEqual(metadata["source_type"], "web-page")
            self.assertEqual(metadata["final_url"], "https://example.com/article")
            self.assertEqual(queue.get(job.id).status, "waiting_review")
            self.assertEqual(control.steps[-1], (0.98, "Validating webpage artifacts"))


if __name__ == "__main__":
    unittest.main()
