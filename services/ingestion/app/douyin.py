from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import re
import socket
from typing import Callable
from urllib.parse import urljoin, urlsplit

import httpx

from .provider import (
    ArtifactDraft,
    ExecutionControl,
    ProviderCancelled,
    ProviderResult,
    TranscriptionProvider,
)
from .queue import Job
from .web import InvalidWebSourceError, extract_shared_url, validate_public_web_url


_DOUYIN_SOURCE_HOSTS = {
    "douyin.com",
    "www.douyin.com",
    "m.douyin.com",
    "v.douyin.com",
    "iesdouyin.com",
    "www.iesdouyin.com",
}
_DOUYIN_MEDIA_HOST_SUFFIXES = (
    ".douyinvod.com",
    ".douyinstatic.com",
    ".bytevcloud.com",
    ".pstatp.com",
    ".byteimg.com",
)
_ROUTER_DATA_PATTERN = re.compile(
    r"window\._ROUTER_DATA\s*=\s*(.*?)</script>",
    re.DOTALL,
)
_REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
_MAX_REDIRECTS = 5
_MAX_PAGE_BYTES = 5 * 1024 * 1024
_MAX_MEDIA_BYTES = 512 * 1024 * 1024


class InvalidDouyinSourceError(ValueError):
    pass


class DouyinExtractionError(RuntimeError):
    pass


class UnsupportedDouyinPostError(DouyinExtractionError):
    pass


@dataclass(frozen=True)
class DouyinPage:
    final_url: str
    html: str
    captured_at: str


@dataclass(frozen=True)
class DouyinVideo:
    video_id: str
    title: str
    media_url: str


def extract_douyin_url(value: str) -> str:
    try:
        source_url = extract_shared_url(value)
    except InvalidWebSourceError as error:
        raise InvalidDouyinSourceError(str(error)) from error
    hostname = (urlsplit(source_url).hostname or "").lower()
    if hostname not in _DOUYIN_SOURCE_HOSTS:
        raise InvalidDouyinSourceError("链接不是受支持的抖音公开链接。")
    return source_url


def _validate_douyin_page_url(
    value: str,
    resolver: Callable = socket.getaddrinfo,
) -> str:
    normalized = extract_douyin_url(value)
    try:
        return validate_public_web_url(normalized, resolver=resolver)
    except InvalidWebSourceError as error:
        raise InvalidDouyinSourceError(str(error)) from error


def _validate_douyin_media_url(
    value: str,
    resolver: Callable = socket.getaddrinfo,
) -> str:
    normalized = _normalize_douyin_media_url(value)
    try:
        return validate_public_web_url(normalized, resolver=resolver)
    except InvalidWebSourceError as error:
        raise DouyinExtractionError(str(error)) from error


def _normalize_douyin_media_url(value: str) -> str:
    try:
        normalized = extract_shared_url(value)
    except InvalidWebSourceError as error:
        raise DouyinExtractionError("抖音媒体地址无效。") from error
    parsed = urlsplit(normalized)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not any(
        hostname.endswith(suffix) for suffix in _DOUYIN_MEDIA_HOST_SUFFIXES
    ):
        raise DouyinExtractionError("抖音页面返回了不受信任的媒体地址。")
    return normalized


def fetch_douyin_page(
    value: str,
    resolver: Callable = socket.getaddrinfo,
    transport: httpx.BaseTransport | None = None,
) -> DouyinPage:
    current = extract_douyin_url(value)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
            "AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
        )
    }
    with httpx.Client(
        headers=headers,
        timeout=20,
        follow_redirects=False,
        transport=transport,
    ) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            current = _validate_douyin_page_url(current, resolver=resolver)
            with client.stream("GET", current) as response:
                if response.status_code in _REDIRECT_STATUS_CODES:
                    location = response.headers.get("location")
                    if not location:
                        raise DouyinExtractionError("抖音页面重定向缺少目标地址。")
                    current = extract_douyin_url(urljoin(current, location))
                    continue
                if response.status_code < 200 or response.status_code >= 300:
                    raise DouyinExtractionError(
                        f"抖音页面请求失败，状态码 {response.status_code}。"
                    )
                content_type = response.headers.get("content-type", "").split(";", 1)[0]
                if content_type.lower() not in {"text/html", "application/xhtml+xml"}:
                    raise DouyinExtractionError("抖音链接返回的不是 HTML 页面。")
                chunks = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > _MAX_PAGE_BYTES:
                        raise DouyinExtractionError("抖音页面超过 5 MB 限制。")
                    chunks.append(chunk)
                encoding = response.charset_encoding or "utf-8"
                return DouyinPage(
                    final_url=current,
                    html=b"".join(chunks).decode(encoding, errors="replace"),
                    captured_at=datetime.now(UTC).isoformat(),
                )
    raise DouyinExtractionError("抖音页面重定向次数过多。")


def download_douyin_media(
    value: str,
    target: Path,
    control: ExecutionControl | None,
    resolver: Callable = socket.getaddrinfo,
    transport: httpx.BaseTransport | None = None,
) -> None:
    current = _validate_douyin_media_url(value, resolver=resolver)
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = target.with_suffix(f"{target.suffix}.part")
    temporary_path.unlink(missing_ok=True)
    headers = {"User-Agent": "Personal-AI-Dashboard/0.3 (+local ingestion)"}
    try:
        with httpx.Client(
            headers=headers,
            timeout=60,
            follow_redirects=False,
            transport=transport,
        ) as client:
            for _ in range(_MAX_REDIRECTS + 1):
                current = _validate_douyin_media_url(current, resolver=resolver)
                with client.stream("GET", current) as response:
                    if response.status_code in _REDIRECT_STATUS_CODES:
                        location = response.headers.get("location")
                        if not location:
                            raise DouyinExtractionError("抖音媒体重定向缺少目标地址。")
                        current = _validate_douyin_media_url(
                            urljoin(current, location),
                            resolver=resolver,
                        )
                        continue
                    if response.status_code < 200 or response.status_code >= 300:
                        raise DouyinExtractionError(
                            f"抖音视频下载失败，状态码 {response.status_code}。"
                        )
                    content_type = response.headers.get("content-type", "").split(";", 1)[0]
                    if content_type and content_type.lower() not in {
                        "video/mp4",
                        "application/octet-stream",
                    }:
                        raise DouyinExtractionError("抖音媒体地址没有返回视频内容。")
                    try:
                        expected_size = int(response.headers.get("content-length", "0"))
                    except ValueError:
                        expected_size = 0
                    if expected_size > _MAX_MEDIA_BYTES:
                        raise DouyinExtractionError("抖音视频超过 512 MB 限制。")
                    downloaded = 0
                    with temporary_path.open("wb") as handle:
                        for chunk in response.iter_bytes():
                            if control is not None and control.is_cancel_requested():
                                raise ProviderCancelled()
                            downloaded += len(chunk)
                            if downloaded > _MAX_MEDIA_BYTES:
                                raise DouyinExtractionError("抖音视频超过 512 MB 限制。")
                            handle.write(chunk)
                            if control is not None and expected_size > 0:
                                progress = min(downloaded / expected_size, 1)
                                control.heartbeat(
                                    0.2 + progress * 0.28,
                                    f"Downloading Douyin video {round(progress * 100)}%",
                                )
                    if downloaded <= 0:
                        raise DouyinExtractionError("抖音视频下载失败，媒体内容为空。")
                    temporary_path.replace(target)
                    return
        raise DouyinExtractionError("抖音媒体重定向次数过多。")
    finally:
        temporary_path.unlink(missing_ok=True)


def parse_douyin_video(page: DouyinPage) -> DouyinVideo:
    extract_douyin_url(page.final_url)
    match = _ROUTER_DATA_PATTERN.search(page.html)
    if match is None:
        lowered = page.html.casefold()
        if any(marker in lowered for marker in ("captcha", "verify", "login")):
            raise DouyinExtractionError("抖音页面需要登录或验证，当前不使用登录态。")
        raise DouyinExtractionError("无法从抖音页面解析帖子数据，页面结构可能已变化。")
    try:
        router_data = json.loads(match.group(1).strip().removesuffix(";"))
        loader_data = router_data["loaderData"]
        page_payload = next(
            payload
            for key, payload in loader_data.items()
            if key in {"video_(id)/page", "note_(id)/page"}
        )
        item = page_payload["videoInfoRes"]["item_list"][0]
    except (KeyError, IndexError, StopIteration, TypeError, ValueError) as error:
        raise DouyinExtractionError("抖音帖子数据不完整，无法继续处理。") from error

    video = item.get("video") if isinstance(item, dict) else None
    play_address = video.get("play_addr") if isinstance(video, dict) else None
    urls = play_address.get("url_list") if isinstance(play_address, dict) else None
    if not urls:
        if isinstance(item, dict) and item.get("images"):
            raise UnsupportedDouyinPostError("该链接是抖音图文帖，当前 MVP 暂不支持图文提取。")
        raise DouyinExtractionError("抖音视频没有可用的公开媒体地址。")

    video_id = str(item.get("aweme_id") or "").strip()
    if not video_id:
        final_path = urlsplit(page.final_url).path.rstrip("/")
        video_id = final_path.rsplit("/", 1)[-1]
    title = str(item.get("desc") or f"抖音视频-{video_id}").strip()[:200]
    media_url = str(urls[0]).replace("playwm", "play")
    return DouyinVideo(
        video_id=video_id,
        title=title,
        media_url=_normalize_douyin_media_url(media_url),
    )


class _TranscriptionControl:
    def __init__(self, control: ExecutionControl) -> None:
        self.control = control

    def set_pid(self, pid: int) -> None:
        self.control.set_pid(pid)

    def heartbeat(self, progress: float, current_step: str) -> None:
        self.control.heartbeat(0.5 + progress * 0.5, current_step)

    def is_cancel_requested(self) -> bool:
        return self.control.is_cancel_requested()


class DouyinProvider:
    def __init__(
        self,
        transcriber: TranscriptionProvider,
        fetcher: Callable[[str], DouyinPage] = fetch_douyin_page,
        downloader: Callable[[str, Path, ExecutionControl], None] = download_douyin_media,
    ) -> None:
        self.transcriber = transcriber
        self.fetcher = fetcher
        self.downloader = downloader

    def run(self, job: Job, control: ExecutionControl) -> ProviderResult:
        if job.source_type != "douyin" or not job.source_url:
            raise ValueError("Douyin provider requires a douyin job")
        if control.is_cancel_requested():
            raise ProviderCancelled()

        control.heartbeat(0.05, "Resolving Douyin post")
        page = self.fetcher(job.source_url)
        video = parse_douyin_video(page)
        if control.is_cancel_requested():
            raise ProviderCancelled()

        job.output_dir.mkdir(parents=True, exist_ok=True)
        media_path = job.output_dir / "source.mp4"
        control.heartbeat(0.2, "Downloading Douyin video")
        self.downloader(video.media_url, media_path, control)
        if not media_path.is_file() or media_path.stat().st_size <= 0:
            raise DouyinExtractionError("抖音视频下载失败，临时媒体文件为空。")

        source_metadata_path = job.output_dir / "source.json"
        source_metadata_path.write_text(
            json.dumps(
                {
                    "source_type": "douyin-video",
                    "requested_url": job.source_url,
                    "final_url": page.final_url,
                    "video_id": video.video_id,
                    "title": video.title,
                    "captured_at": page.captured_at,
                    "media_sha256": _sha256_file(media_path),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        control.heartbeat(0.5, "Starting local transcription")
        local_job = replace(job, source_type="local-video", source_path=media_path)
        result = self.transcriber.run(local_job, _TranscriptionControl(control))
        return ProviderResult(
            artifacts=(
                *result.artifacts,
                ArtifactDraft("source_media", media_path),
                ArtifactDraft("source_metadata", source_metadata_path),
            ),
            log_path=result.log_path,
        )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
