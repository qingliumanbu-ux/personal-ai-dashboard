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
_IGNORED_ELEMENTS = {"script", "style", "noscript", "svg", "template"}
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


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ignored_depth = 0
        self.in_title = False
        self.title_parts: list[str] = []
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag in _IGNORED_ELEMENTS:
            self.ignored_depth += 1
            return
        if self.ignored_depth:
            return
        if tag == "title":
            self.in_title = True
        if tag in _BLOCK_ELEMENTS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _IGNORED_ELEMENTS:
            self.ignored_depth = max(0, self.ignored_depth - 1)
            return
        if self.ignored_depth:
            return
        if tag == "title":
            self.in_title = False
        if tag in _BLOCK_ELEMENTS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.ignored_depth:
            return
        if self.in_title:
            self.title_parts.append(data)
        else:
            self.parts.append(data)


def _extract_page_text(html: str, source_url: str) -> tuple[str, str]:
    parser = _VisibleTextParser()
    parser.feed(html)
    title = re.sub(r"\s+", " ", " ".join(parser.title_parts)).strip()
    if not title:
        title = urlsplit(source_url).hostname or "未命名网页"
    title = title[:200]
    lines = []
    for block in "".join(parser.parts).splitlines():
        normalized = re.sub(r"\s+", " ", block).strip()
        if normalized and (not lines or normalized != lines[-1]):
            lines.append(normalized)
    text = "\n\n".join(lines).strip()
    if len(text) < 20:
        raise RuntimeError("网页中没有足够的可读正文。")
    return title, text[:1_000_000]
