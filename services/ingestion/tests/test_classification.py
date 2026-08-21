import unittest

from app.classification import (
    ClassificationValidationError,
    classification_suggestion_from_summary,
    normalize_topics,
    validate_classification,
)


SUMMARY_V2 = """## AI 候选摘要

这份资料讨论个人知识库的分类与检索。

## 核心要点

- 分类应与物理目录解耦。

## 建议标签

- 人工智能
- 模型上下文协议
- 个人知识库

## 可复用方向

- 可用于改进知识库工作台。

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


class ClassificationTests(unittest.TestCase):
    def test_summary_suggestion_uses_controlled_values_and_normalizes_topics(self) -> None:
        suggestion = classification_suggestion_from_summary(SUMMARY_V2)

        self.assertEqual(suggestion["domain"], "AI与智能体")
        self.assertEqual(suggestion["content_kind"], "方法")
        self.assertEqual(suggestion["topics"], ["AI", "MCP", "个人知识库"])
        self.assertEqual(suggestion["use_cases"], ["项目", "学习"])

    def test_confirmed_classification_is_deduplicated(self) -> None:
        payload = validate_classification(
            domain="AI与智能体",
            topics=["智能体", "Agent", "MCP"],
            content_kind="教程",
            use_cases=["项目", "项目", "学习"],
        )

        self.assertEqual(payload["topics"], ["Agent", "MCP"])
        self.assertEqual(payload["use_cases"], ["项目", "学习"])

    def test_invalid_top_level_domain_is_rejected(self) -> None:
        with self.assertRaisesRegex(ClassificationValidationError, "顶层领域"):
            validate_classification(
                domain="随手新建领域",
                topics=[],
                content_kind="观点",
                use_cases=[],
            )

    def test_topic_limits_are_enforced(self) -> None:
        with self.assertRaisesRegex(ClassificationValidationError, "最多保留"):
            normalize_topics([f"主题{i}" for i in range(13)])


if __name__ == "__main__":
    unittest.main()
