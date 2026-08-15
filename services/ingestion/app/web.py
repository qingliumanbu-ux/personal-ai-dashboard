from __future__ import annotations

import hashlib
import ipaddress
import json
import socket
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
import re
from typing import Callable
from urllib.parse import parse_qsl, urljoin, urlsplit, urlunsplit

import httpx

from .provider import ArtifactDraft, ExecutionControl, ProviderCancelled, ProviderResult
from .queue import Job


MAX_RESPONSE_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
_SENSITIVE_QUERY_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "auth",
    "authorization",
    "code",
    "credential",
    "key",
    "password",
    "secret",
    "signature",
    "sig",
    "token",
}
_BLOCK_ELEMENTS = {
    "article",
    "aside",
    "blockquote",
    "br",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "li",
    "main",
    "nav",
    "p",
    "section",
    "table",
    "td",
    "th",
    "tr",
    "ul",
    "ol",
}
_IGNORED_ELEMENTS = {
    "aside",
    "button",
    "dialog",
    "footer",
    "form",
    "nav",
    "noscript",
    "script",
    "style",
    "svg",
    "template",
}
_VOID_ELEMENTS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "source",
    "track",
    "wbr",
}
_NOISE_HINTS = {
    "advert",
    "advertisement",
    "breadcrumb",
    "comment",
    "comments",
    "cookie",
    "menu",
    "modal",
    "navigation",
    "operations",
    "pagination",
    "popup",
    "recommend",
    "related",
    "report",
    "share",
    "sidebar",
    "sibling",
    "social",
    "tags",
    "toolbar",
    "zoom",
}
_ARTICLE_HINTS = {"article", "entry", "post", "story"}
_SECONDARY_CONTENT_HINTS = {"detail", "news"}
_LIST_HINTS = {"list", "recommend", "related", "sibling"}
_NON_BODY_HINTS = {"author", "byline", "info", "infos", "meta", "source", "title"}
_SHARED_URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
_TRAILING_SHARE_PUNCTUATION = ".,;:!?，。；：！？、）)]}】》」』"


class InvalidWebSourceError(ValueError):
    pass


@dataclass(frozen=True)
class FetchedPage:
    final_url: str
    html: str
    captured_at: str


def extract_shared_url(value: str) -> str:
    raw = value.strip()
    match = _SHARED_URL_PATTERN.search(raw)
    if match is None:
        raise InvalidWebSourceError("没有找到可采集的 http 或 https 链接。")
    return normalize_web_url(match.group(0).rstrip(_TRAILING_SHARE_PUNCTUATION))


def normalize_web_url(value: str) -> str:
    raw = value.strip()
    if not raw:
        raise InvalidWebSourceError("请输入网页链接。")
    if any(character == " " or ord(character) < 32 for character in raw):
        raise InvalidWebSourceError("网页链接中不能包含空格或控制字符。")
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as error:
        raise InvalidWebSourceError("网页链接格式无效。") from error
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise InvalidWebSourceError("仅支持 http 或 https 网页链接。")
    if parsed.username is not None or parsed.password is not None:
        raise InvalidWebSourceError("网页链接中不能包含用户名或密码。")
    hostname = parsed.hostname
    if not hostname:
        raise InvalidWebSourceError("网页链接缺少有效域名。")
    hostname = hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith((".localhost", ".local")):
        raise InvalidWebSourceError("不能采集本机或局域网地址。")
    if port not in {None, 80, 443}:
        raise InvalidWebSourceError("网页采集仅支持标准 HTTP/HTTPS 端口。")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        if "." not in hostname:
            raise InvalidWebSourceError("不能采集本机或局域网主机名。")
        ascii_hostname = hostname.encode("idna").decode("ascii")
    else:
        if not address.is_global:
            raise InvalidWebSourceError("不能采集本机或局域网地址。")
        ascii_hostname = f"[{hostname}]" if address.version == 6 else hostname
    for key, _ in parse_qsl(parsed.query, keep_blank_values=True):
        if key.casefold() in _SENSITIVE_QUERY_KEYS:
            raise InvalidWebSourceError("网页链接包含疑似密钥参数，已拒绝采集。")
    default_port = 80 if scheme == "http" else 443
    netloc = ascii_hostname if port in {None, default_port} else f"{ascii_hostname}:{port}"
    return urlunsplit((scheme, netloc, parsed.path, parsed.query, ""))


def validate_public_web_url(
    value: str,
    resolver: Callable = socket.getaddrinfo,
) -> str:
    normalized = normalize_web_url(value)
    parsed = urlsplit(normalized)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        addresses = resolver(parsed.hostname, port, type=socket.SOCK_STREAM)
    except OSError as error:
        raise InvalidWebSourceError("无法解析网页域名。") from error
    if not addresses:
        raise InvalidWebSourceError("无法解析网页域名。")
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address[4][0])
        except (ValueError, IndexError) as error:
            raise InvalidWebSourceError("网页域名解析结果无效。") from error
        if not ip.is_global:
            raise InvalidWebSourceError("网页域名指向本机或局域网地址，已拒绝采集。")
    return normalized


def fetch_public_html(value: str) -> FetchedPage:
    current = normalize_web_url(value)
    headers = {"User-Agent": "Personal-AI-Dashboard/0.3 (+local ingestion)"}
    with httpx.Client(headers=headers, timeout=15, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            current = validate_public_web_url(current)
            with client.stream("GET", current) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise RuntimeError("网页重定向缺少目标地址。")
                    current = normalize_web_url(urljoin(current, location))
                    continue
                if response.status_code < 200 or response.status_code >= 300:
                    raise RuntimeError(f"网页请求失败，状态码 {response.status_code}。")
                content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if content_type not in {"text/html", "application/xhtml+xml"}:
                    raise RuntimeError("该链接返回的不是 HTML 网页。")
                chunks = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise RuntimeError("网页内容超过 5 MB 限制。")
                    chunks.append(chunk)
                encoding = response.charset_encoding or "utf-8"
                html = b"".join(chunks).decode(encoding, errors="replace")
                return FetchedPage(
                    final_url=current,
                    html=html,
                    captured_at=datetime.now(UTC).isoformat(),
                )
    raise RuntimeError("网页重定向次数过多。")


class WebPageProvider:
    def __init__(self, fetcher: Callable[[str], FetchedPage] = fetch_public_html) -> None:
        self.fetcher = fetcher

    def run(self, job: Job, control: ExecutionControl) -> ProviderResult:
        if job.source_type != "web-page" or not job.source_url:
            raise ValueError("Web provider requires a web-page job")
        if control.is_cancel_requested():
            raise ProviderCancelled()
        control.heartbeat(0.05, "Fetching webpage")
        page = self.fetcher(job.source_url)
        if control.is_cancel_requested():
            raise ProviderCancelled()
        control.heartbeat(0.7, "Extracting webpage content")
        title, text = _extract_page_text(page.html, page.final_url)
        job.output_dir.mkdir(parents=True, exist_ok=True)
        snapshot_path = job.output_dir / "source.html"
        content_path = job.output_dir / "content.md"
        metadata_path = job.output_dir / "metadata.json"
        snapshot_path.write_text(page.html, encoding="utf-8")
        content_path.write_text(f"# {title}\n\n{text}\n", encoding="utf-8")
        metadata_path.write_text(
            json.dumps(
                {
                    "source_type": "web-page",
                    "requested_url": job.source_url,
                    "final_url": page.final_url,
                    "title": title,
                    "captured_at": page.captured_at,
                    "snapshot_sha256": hashlib.sha256(
                        page.html.encode("utf-8")
                    ).hexdigest(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        control.heartbeat(0.98, "Validating webpage artifacts")
        artifacts = (
            ArtifactDraft("content", content_path),
            ArtifactDraft("metadata", metadata_path),
            ArtifactDraft("source_snapshot", snapshot_path),
        )
        for artifact in artifacts:
            if not artifact.path.is_file() or artifact.path.stat().st_size <= 0:
                raise RuntimeError(f"Expected artifact is missing or empty: {artifact.path.name}")
        return ProviderResult(artifacts=artifacts, log_path=None)


@dataclass
class _TextCandidate:
    tag: str
    depth: int
    priority: int
    parts: list[str]
    heading_parts: list[str]


def _attribute_tokens(attrs) -> set[str]:
    values = " ".join(
        value for name, value in attrs if name in {"class", "id", "role"} and value
    )
    return {token for token in re.split(r"[^a-z0-9]+", values.casefold()) if token}


def _candidate_priority(tag: str, attrs) -> int:
    tokens = _attribute_tokens(attrs)
    if tokens & _LIST_HINTS or (
        tokens & _NON_BODY_HINTS and not tokens & {"body", "content", "main"}
    ):
        return 0
    if tag == "article":
        return 4
    if tokens & _ARTICLE_HINTS:
        return 3
    if "content" in tokens and tokens & _SECONDARY_CONTENT_HINTS:
        return 2
    if tag == "main" or "main" in tokens:
        return 1
    return 0


def _is_noise_element(tag: str, attrs) -> bool:
    return tag in _IGNORED_ELEMENTS or bool(_attribute_tokens(attrs) & _NOISE_HINTS)


def _normalized_lines(parts: list[str]) -> list[str]:
    lines = []
    for block in "".join(parts).splitlines():
        normalized = re.sub(r"\s+", " ", block).strip()
        if normalized and (not lines or normalized != lines[-1]):
            lines.append(normalized)
    return lines


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.suppressed_depth: int | None = None
        self.in_title = False
        self.title_parts: list[str] = []
        self.parts: list[str] = []
        self.heading_depth: int | None = None
        self.heading_parts: list[str] = []
        self.capture_document_heading = False
        self.heading_targets: list[_TextCandidate] = []
        self.candidates: list[_TextCandidate] = []
        self.active_candidates: list[_TextCandidate] = []

    def _append(self, value: str) -> None:
        self.parts.append(value)
        for candidate in self.active_candidates:
            candidate.parts.append(value)

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        is_void = tag in _VOID_ELEMENTS
        if not is_void:
            self.depth += 1
        if self.suppressed_depth is not None:
            return
        if _is_noise_element(tag, attrs):
            if not is_void:
                self.suppressed_depth = self.depth
            return
        if tag == "title":
            self.in_title = True
        priority = _candidate_priority(tag, attrs)
        if priority:
            candidate = _TextCandidate(tag, self.depth, priority, [], [])
            self.active_candidates.append(candidate)
        if tag == "h1" and self.heading_depth is None:
            self.heading_depth = self.depth
            self.capture_document_heading = not self.heading_parts
            self.heading_targets = [
                candidate
                for candidate in self.active_candidates
                if not candidate.heading_parts
            ]
        if tag in _BLOCK_ELEMENTS:
            self._append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _VOID_ELEMENTS:
            return
        if self.suppressed_depth is not None:
            if self.depth == self.suppressed_depth:
                self.suppressed_depth = None
            self.depth = max(0, self.depth - 1)
            return
        if tag == "title":
            self.in_title = False
        if tag in _BLOCK_ELEMENTS:
            self._append("\n")
        if tag == "h1" and self.heading_depth == self.depth:
            self.heading_depth = None
            self.capture_document_heading = False
            self.heading_targets = []
        closed = [
            candidate
            for candidate in self.active_candidates
            if candidate.tag == tag and candidate.depth == self.depth
        ]
        for candidate in closed:
            self.active_candidates.remove(candidate)
            self.candidates.append(candidate)
        self.depth = max(0, self.depth - 1)

    def handle_data(self, data: str) -> None:
        if self.suppressed_depth is not None:
            return
        if self.in_title:
            self.title_parts.append(data)
        else:
            self._append(data)
        if self.heading_depth is not None:
            if self.capture_document_heading:
                self.heading_parts.append(data)
            for candidate in self.heading_targets:
                candidate.heading_parts.append(data)


def _extract_page_text(html: str, source_url: str) -> tuple[str, str]:
    parser = _VisibleTextParser()
    parser.feed(html)
    candidates = parser.candidates + parser.active_candidates
    selected = max(
        candidates,
        key=lambda candidate: (
            candidate.priority,
            len(" ".join(_normalized_lines(candidate.parts))),
        ),
        default=None,
    )
    selected_parts = selected.parts if selected is not None else parser.parts
    selected_heading = selected.heading_parts if selected is not None else []
    heading = re.sub(r"\s+", " ", " ".join(selected_heading)).strip()
    document_title = re.sub(r"\s+", " ", " ".join(parser.title_parts)).strip()
    title = heading or document_title
    if not title:
        title = urlsplit(source_url).hostname or "未命名网页"
    title = title[:200]
    lines = _normalized_lines(selected_parts)
    for index, line in enumerate(lines[:3]):
        if line == title:
            del lines[index]
            break
    text = "\n\n".join(lines).strip()
    if len(text) < 20:
        raise RuntimeError("网页中没有足够的可读正文。")
    return title, text[:1_000_000]
