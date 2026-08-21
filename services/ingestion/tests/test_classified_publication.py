import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.publisher import PublicationStateError, Publisher
from app.queue import JobQueue


SUMMARY_V2 = """## AI 候选摘要

这份资料用于验证分类发布流程。

## 核心要点

- 发布前需要人工确认分类。

## 建议标签

- 个人知识库
- MCP

## 可复用方向

- 用于项目实施。

## 不确定内容

- 暂未发现。

## 建议领域

AI与智能体

## 建议内容类型

方法

## 建议用途

- 项目
- 学习
"""


class ClassifiedPublicationTests(unittest.TestCase):
    def test_new_job_requires_confirmed_classification_before_publish(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "分类验证视频.mp4"
            source.write_bytes(b"synthetic-video")

            queue = JobQueue(
                root / "runtime" / "ingestion.db",
                root / "runs",
                (source_root,),
            )
            job = queue.submit(
                source,
                {
                    "summary_required": "true",
                    "classification_required": "true",
                },
            )
            claimed = queue.claim_next("worker-a", 60)
            self.assertIsNotNone(claimed)

            claimed.output_dir.mkdir(parents=True, exist_ok=True)
            transcript = claimed.output_dir / "transcript.txt"
            subtitles = claimed.output_dir / "transcript.srt"
            metadata = claimed.output_dir / "transcript.json"
            transcript.write_text("这是用于分类发布验证的完整转写。", encoding="utf-8")
            subtitles.write_text("1\n00:00:00,000 --> 00:00:01,000\n分类验证\n", encoding="utf-8")
            metadata.write_text("{}", encoding="utf-8")
            queue.complete(
                job.id,
                "worker-a",
                (
                    SimpleNamespace(kind="transcript", path=transcript),
                    SimpleNamespace(kind="subtitles", path=subtitles),
                    SimpleNamespace(kind="metadata", path=metadata),
                ),
                None,
            )
            queue.save_candidate_summary(job.id, SUMMARY_V2)
            queue.review(job.id, "approved", "内容通过")

            vault = root / "vault"
            vault.mkdir()
            publisher = Publisher(queue, vault)

            with self.assertRaisesRegex(PublicationStateError, "确认资料分类"):
                publisher.publish(job.id)

            queue.save_classification(
                job.id,
                {
                    "version": "v1",
                    "domain": "AI与智能体",
                    "topics": ["个人知识库", "MCP"],
                    "content_kind": "方法",
                    "use_cases": ["项目", "学习"],
                },
            )

            publication = publisher.publish(job.id)
            markdown = (vault / publication.relative_path).read_text(encoding="utf-8")

            self.assertIn('domain: "AI与智能体"', markdown)
            self.assertIn('topics: ["个人知识库", "MCP"]', markdown)
            self.assertIn('content_kind: "方法"', markdown)
            self.assertIn('use_cases: ["项目", "学习"]', markdown)
            self.assertIn("## 分类", markdown)
            self.assertIn("- 领域：AI与智能体", markdown)
            self.assertIn('summary_prompt_version: "manual-v2"', markdown)


if __name__ == "__main__":
    unittest.main()
