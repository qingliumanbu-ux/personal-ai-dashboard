from __future__ import annotations

import re


CLASSIFICATION_VERSION = "v1"

DOMAINS = (
    "AI与智能体",
    "程序开发",
    "自媒体",
    "AI视频",
    "小说剧本",
    "学习考试",
    "个人成长",
    "其他",
)

CONTENT_KINDS = (
    "方法",
    "教程",
    "案例",
    "观点",
    "数据",
    "清单",
    "参考资料",
)

USE_CASES = (
    "项目",
    "学习",
    "内容创作",
    "决策",
    "复盘",
)

TOPIC_ALIASES = {
    "人工智能": "AI",
    "大模型": "LLM",
    "大型语言模型": "LLM",
    "智能体": "Agent",
    "ai agent": "Agent",
    "模型上下文协议": "MCP",
}

MAX_TOPICS = 12
MAX_TOPIC_LENGTH = 40


class ClassificationValidationError(ValueError):
    pass


def _clean_scalar(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_topic(value: object) -> str:
    topic = _clean_scalar(value).lstrip("#").strip()
    if not topic:
        return ""
    alias = TOPIC_ALIASES.get(topic.casefold())
    return alias or topic


def normalize_topics(values: object) -> list[str]:
    if not isinstance(values, list):
        values = []
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        topic = normalize_topic(raw)
        if not topic or topic == "待人工补充":
            continue
        if len(topic) > MAX_TOPIC_LENGTH:
            raise ClassificationValidationError(
                f"单个主题不能超过 {MAX_TOPIC_LENGTH} 个字符。"
            )
        key = topic.casefold()
        if key not in seen:
            seen.add(key)
            result.append(topic)
    if len(result) > MAX_TOPICS:
        raise ClassificationValidationError(f"主题最多保留 {MAX_TOPICS} 个。")
    return result


def validate_classification(
    *,
    domain: object,
    topics: object,
    content_kind: object,
    use_cases: object,
) -> dict[str, object]:
    normalized_domain = _clean_scalar(domain)
    if normalized_domain not in DOMAINS:
        raise ClassificationValidationError("请选择一个受控的顶层领域。")

    normalized_kind = _clean_scalar(content_kind)
    if normalized_kind not in CONTENT_KINDS:
        raise ClassificationValidationError("请选择一个受控的内容类型。")

    normalized_topics = normalize_topics(topics)

    if not isinstance(use_cases, list):
        use_cases = []
    normalized_use_cases: list[str] = []
    seen_use_cases: set[str] = set()
    for raw in use_cases:
        item = _clean_scalar(raw)
        if not item:
            continue
        if item not in USE_CASES:
            raise ClassificationValidationError(f"不支持的复用方向：{item}")
        if item not in seen_use_cases:
            seen_use_cases.add(item)
            normalized_use_cases.append(item)

    return {
        "version": CLASSIFICATION_VERSION,
        "domain": normalized_domain,
        "topics": normalized_topics,
        "content_kind": normalized_kind,
        "use_cases": normalized_use_cases,
    }


def _section(content: str, heading: str) -> str:
    pattern = re.compile(
        rf"^{re.escape(heading)}\s*$\n(?P<body>.*?)(?=^##\s|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(content)
    return match.group("body").strip() if match else ""


def _list_items(content: str, heading: str) -> list[str]:
    body = _section(content, heading)
    if not body:
        return []
    items = []
    for line in body.splitlines():
        value = re.sub(r"^[-*+]\s+", "", line.strip()).strip()
        if value:
            items.append(value)
    return items


def _first_value(content: str, heading: str) -> str:
    values = _list_items(content, heading)
    if values:
        return values[0]
    return _clean_scalar(_section(content, heading))


def classification_suggestion_from_summary(content: str) -> dict[str, object]:
    domain = _first_value(content, "## 建议领域")
    content_kind = _first_value(content, "## 建议内容类型")
    topics = _list_items(content, "## 建议标签")
    use_cases = _list_items(content, "## 建议用途")

    return {
        "domain": domain if domain in DOMAINS else None,
        "topics": normalize_topics(topics),
        "content_kind": content_kind if content_kind in CONTENT_KINDS else None,
        "use_cases": [item for item in use_cases if item in USE_CASES],
    }


def classification_options() -> dict[str, list[str]]:
    return {
        "domains": list(DOMAINS),
        "content_kinds": list(CONTENT_KINDS),
        "use_cases": list(USE_CASES),
    }
