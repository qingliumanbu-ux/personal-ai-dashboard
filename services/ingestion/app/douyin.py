from __future__ import annotations

import base64
from dataclasses import dataclass, replace
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
from typing import Callable
from urllib.parse import urljoin, urlsplit
from uuid import uuid4

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
_DOUYIN_IMAGE_HOST_SUFFIXES = (
    ".douyinpic.com",
    ".douyinstatic.com",
    ".byteimg.com",
    ".pstatp.com",
)
_ROUTER_DATA_PATTERN = re.compile(
    r"window\._ROUTER_DATA\s*=\s*(.*?)</script>",
    re.DOTALL,
)
_REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
_MAX_REDIRECTS = 5
_MAX_PAGE_BYTES = 5 * 1024 * 1024
_MAX_MEDIA_BYTES = 512 * 1024 * 1024
_MAX_IMAGE_COUNT = 12
_MAX_IMAGE_BYTES = 20 * 1024 * 1024
_MAX_IMAGE_TOTAL_BYTES = 80 * 1024 * 1024
_IMAGE_CONTENT_TYPES = {
    "image/avif": ".avif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class InvalidDouyinSourceError(ValueError):
    pass


class DouyinExtractionError(RuntimeError):
    pass


class DouyinPageDataUnavailableError(DouyinExtractionError):
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


@dataclass(frozen=True)
class DouyinImagePost:
    post_id: str
    title: str
    description: str
    image_urls: tuple[str, ...]


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


def _validate_douyin_image_url(
    value: str,
    resolver: Callable = socket.getaddrinfo,
) -> str:
    normalized = _normalize_douyin_image_url(value)
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


def _normalize_douyin_image_url(value: str) -> str:
    try:
        normalized = extract_shared_url(value)
    except InvalidWebSourceError as error:
        raise DouyinExtractionError("抖音图片地址无效。") from error
    parsed = urlsplit(normalized)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not any(
        hostname.endswith(suffix) for suffix in _DOUYIN_IMAGE_HOST_SUFFIXES
    ):
        raise DouyinExtractionError("抖音页面返回了不受信任的图片地址。")
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
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.douyin.com/",
    }
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


def download_douyin_image(
    value: str,
    target: Path,
    control: ExecutionControl | None,
    resolver: Callable = socket.getaddrinfo,
    transport: httpx.BaseTransport | None = None,
) -> Path:
    current = _validate_douyin_image_url(value, resolver=resolver)
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = target.with_suffix(".part")
    temporary_path.unlink(missing_ok=True)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.douyin.com/",
    }
    try:
        with httpx.Client(
            headers=headers,
            timeout=30,
            follow_redirects=False,
            transport=transport,
        ) as client:
            for _ in range(_MAX_REDIRECTS + 1):
                current = _validate_douyin_image_url(current, resolver=resolver)
                with client.stream("GET", current) as response:
                    if response.status_code in _REDIRECT_STATUS_CODES:
                        location = response.headers.get("location")
                        if not location:
                            raise DouyinExtractionError("抖音图片重定向缺少目标地址。")
                        current = _validate_douyin_image_url(
                            urljoin(current, location),
                            resolver=resolver,
                        )
                        continue
                    if response.status_code < 200 or response.status_code >= 300:
                        raise DouyinExtractionError(
                            f"抖音图片下载失败，状态码 {response.status_code}。"
                        )
                    content_type = response.headers.get("content-type", "").split(";", 1)[0]
                    extension = _IMAGE_CONTENT_TYPES.get(content_type.lower())
                    if extension is None:
                        raise DouyinExtractionError("抖音图片地址没有返回支持的图片内容。")
                    try:
                        expected_size = int(response.headers.get("content-length", "0"))
                    except ValueError:
                        expected_size = 0
                    if expected_size > _MAX_IMAGE_BYTES:
                        raise DouyinExtractionError("单张抖音图片超过 20 MB 限制。")
                    downloaded = 0
                    with temporary_path.open("wb") as handle:
                        for chunk in response.iter_bytes():
                            if control is not None and control.is_cancel_requested():
                                raise ProviderCancelled()
                            downloaded += len(chunk)
                            if downloaded > _MAX_IMAGE_BYTES:
                                raise DouyinExtractionError("单张抖音图片超过 20 MB 限制。")
                            handle.write(chunk)
                    if downloaded <= 0:
                        raise DouyinExtractionError("抖音图片下载失败，图片内容为空。")
                    completed_path = target.with_suffix(extension)
                    temporary_path.replace(completed_path)
                    return completed_path
        raise DouyinExtractionError("抖音图片重定向次数过多。")
    finally:
        temporary_path.unlink(missing_ok=True)


def parse_douyin_post(page: DouyinPage) -> DouyinVideo | DouyinImagePost:
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
    except (KeyError, StopIteration, TypeError, ValueError) as error:
        raise DouyinExtractionError("抖音帖子数据不完整，无法继续处理。") from error
    if not isinstance(page_payload, dict) or "videoInfoRes" not in page_payload:
        raise DouyinPageDataUnavailableError(
            "抖音页面未提供内嵌视频数据，需要使用公开页面渲染。"
        )
    try:
        item = page_payload["videoInfoRes"]["item_list"][0]
    except (KeyError, IndexError, TypeError) as error:
        raise DouyinExtractionError("抖音帖子数据不完整，无法继续处理。") from error

    if not isinstance(item, dict):
        raise DouyinExtractionError("抖音帖子数据不完整，无法继续处理。")

    image_urls = _image_urls_from_item(item)
    if image_urls:
        post_id = _douyin_post_id(item, page.final_url)
        description = str(item.get("desc") or "").strip()
        title = str(item.get("title") or description or f"抖音图文-{post_id}").strip()
        return _create_image_post(post_id, title, description, image_urls)

    video = item.get("video")
    play_address = video.get("play_addr") if isinstance(video, dict) else None
    urls = play_address.get("url_list") if isinstance(play_address, dict) else None
    if not urls:
        raise DouyinExtractionError("抖音视频没有可用的公开媒体地址。")

    video_id = _douyin_post_id(item, page.final_url)
    title = str(item.get("desc") or f"抖音视频-{video_id}").strip()[:200]
    media_url = str(urls[0]).replace("playwm", "play")
    return DouyinVideo(
        video_id=video_id,
        title=title,
        media_url=_normalize_douyin_media_url(media_url),
    )


def _douyin_post_id(item: dict, final_url: str) -> str:
    post_id = str(item.get("aweme_id") or item.get("item_id") or "").strip()
    if post_id:
        return post_id
    final_path = urlsplit(final_url).path.rstrip("/")
    return final_path.rsplit("/", 1)[-1]


def _image_urls_from_item(item: dict) -> list[str]:
    image_urls = []
    for image in item.get("images") or ():
        if not isinstance(image, dict):
            continue
        candidates = image.get("url_list") or image.get("download_url_list") or ()
        if not isinstance(candidates, list):
            continue
        selected = next(
            (str(value) for value in candidates if str(value).startswith("https://")),
            "",
        )
        if selected and selected not in image_urls:
            image_urls.append(selected)
    return image_urls


def _create_image_post(
    post_id: str,
    title: str,
    description: str,
    image_urls,
) -> DouyinImagePost:
    normalized_urls = []
    for value in image_urls:
        normalized = _normalize_douyin_image_url(str(value))
        if normalized not in normalized_urls:
            normalized_urls.append(normalized)
    if not normalized_urls:
        raise DouyinExtractionError("抖音图文帖没有可用的公开图片。")
    if len(normalized_urls) > _MAX_IMAGE_COUNT:
        raise DouyinExtractionError(f"抖音图文帖图片超过 {_MAX_IMAGE_COUNT} 张限制。")
    normalized_id = str(post_id).strip()
    if not normalized_id:
        raise DouyinExtractionError("抖音图文帖缺少内容 ID。")
    normalized_title = re.sub(r"\s+", " ", str(title)).strip()[:200]
    normalized_description = str(description).strip()
    return DouyinImagePost(
        post_id=normalized_id,
        title=normalized_title or f"抖音图文-{normalized_id}",
        description=normalized_description,
        image_urls=tuple(normalized_urls),
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


_BROWSER_POST_SCRIPT = """(async () => {
  const preferredHosts = [
    '.douyinvod.com',
    '.bytevcloud.com',
    '.pstatp.com',
  ];
  const isPreferredSource = (value) => {
    try {
      const hostname = new URL(value, location.href).hostname.toLowerCase();
      return preferredHosts.some((suffix) => hostname.endsWith(suffix));
    } catch {
      return false;
    }
  };
  const preferredImageHosts = [
    '.douyinpic.com',
    '.douyinstatic.com',
    '.byteimg.com',
    '.pstatp.com',
  ];
  const isPreferredImage = (value) => {
    try {
      const hostname = new URL(value, location.href).hostname.toLowerCase();
      return preferredImageHosts.some((suffix) => hostname.endsWith(suffix));
    } catch {
      return false;
    }
  };
  const parts = location.pathname.split('/').filter(Boolean);
  const loaderData = window._ROUTER_DATA?.loaderData || {};
  const pagePayload = Object.entries(loaderData).find(([key]) => (
    key === 'video_(id)/page' || key === 'note_(id)/page'
  ))?.[1] || {};
  const item = pagePayload.videoInfoRes?.item_list?.[0] || {};
  const postKind = parts[0] === 'note' || Array.isArray(item.images) ? 'image' : 'video';
  const deadline = Date.now() + 30000;
  let source = '';
  while (postKind === 'video' && !source && Date.now() < deadline) {
    const video = Array.from(document.querySelectorAll('video')).find((item) => (
      item.readyState >= 1
      && Number.isFinite(item.duration)
      && item.duration > 1
      && item.videoWidth > 0
      && item.videoHeight > 0
      && isPreferredSource(item.currentSrc)
    ));
    source = video?.currentSrc || '';
    if (!source) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const title = document.querySelector('meta[property="og:title"]')?.content
    || item.title
    || item.desc
    || document.querySelector('h1')?.textContent
    || document.title
    || '';
  const description = item.desc
    || document.querySelector('meta[property="og:description"]')?.content
    || document.querySelector('meta[name="description"]')?.content
    || '';
  const itemImages = Array.isArray(item.images) ? item.images.flatMap((image) => (
    image?.url_list || image?.download_url_list || []
  )) : [];
  const domImages = Array.from(document.querySelectorAll('img'))
    .filter((image) => image.naturalWidth >= 300 && image.naturalHeight >= 300)
    .map((image) => image.currentSrc || image.src);
  const imageUrls = Array.from(new Set([...itemImages, ...domImages]))
    .filter((value) => typeof value === 'string' && isPreferredImage(value));
  return {
    media_url: source,
    video_id: parts.at(-1) || '',
    title,
    post_kind: postKind,
    description,
    image_urls: imageUrls,
  };
})()"""


def resolve_douyin_post_in_browser(
    value: str,
    runner: Callable = subprocess.run,
    executable: str | None = None,
) -> DouyinVideo | DouyinImagePost:
    source_url = extract_douyin_url(value)
    command = _resolve_agent_browser_executable(executable or "agent-browser")
    if command is None:
        raise DouyinExtractionError("隔离浏览器不可用，无法解析当前抖音页面。")
    session = f"personal-ai-dashboard-douyin-{uuid4().hex}"
    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

    def run_browser(
        arguments: list[str],
        timeout: int,
        capture_stdout: bool = False,
    ) -> str:
        output = tempfile.TemporaryFile(mode="w+b") if capture_stdout else None
        try:
            result = runner(
                [command, "--session", session, *arguments],
                stdout=output if output is not None else subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=timeout,
                creationflags=creation_flags,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            if output is not None:
                output.close()
            raise DouyinExtractionError("隔离浏览器处理抖音页面失败。") from error
        if output is not None:
            output.flush()
        try:
            if result.returncode != 0:
                raise DouyinExtractionError(
                    f"公开抖音页面未能在隔离浏览器中完成加载（{arguments[0]}）。"
                )
            if output is None:
                return ""
            output.seek(0)
            return output.read().decode("utf-8", errors="replace")
        finally:
            if output is not None:
                output.close()

    try:
        run_browser(["open", source_url], 45)
        raw_result = run_browser(
            [
                "eval",
                "-b",
                base64.b64encode(_BROWSER_POST_SCRIPT.encode("utf-8")).decode("ascii"),
            ],
            35,
            capture_stdout=True,
        )
    finally:
        try:
            runner(
                [command, "--session", session, "close"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
                creationflags=creation_flags,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass

    try:
        payload = json.loads(raw_result.strip())
        media_url = str(payload["media_url"])
        post_id = str(payload.get("post_id") or payload["video_id"]).strip()
        title = str(payload.get("title") or "").strip()[:200]
        post_kind = str(payload.get("post_kind") or "").strip()
    except (KeyError, TypeError, ValueError) as error:
        raise DouyinExtractionError("隔离浏览器返回的抖音视频数据无效。") from error
    if post_kind == "image":
        return _create_image_post(
            post_id,
            title,
            str(payload.get("description") or ""),
            payload.get("image_urls") or (),
        )
    if not media_url:
        raise DouyinExtractionError("公开抖音页面未提供可下载的视频媒体地址。")
    if not re.fullmatch(r"\d{5,}", post_id):
        raise DouyinExtractionError("隔离浏览器未能识别抖音视频 ID。")
    return DouyinVideo(
        video_id=post_id,
        title=title or f"抖音视频-{post_id}",
        media_url=_normalize_douyin_media_url(media_url),
    )


def _resolve_agent_browser_executable(value: str) -> str | None:
    command = shutil.which(value)
    if command is None or os.name != "nt" or Path(command).suffix.lower() == ".exe":
        return command
    try:
        shim = Path(command).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return command
    match = re.search(r"cmd-shim-target=([^\r\n]+agent-browser\.js)", shim)
    if match is None:
        return command
    native = Path(match.group(1)).with_name("agent-browser-win32-x64.exe")
    return str(native) if native.is_file() else command


class DouyinProvider:
    def __init__(
        self,
        transcriber: TranscriptionProvider,
        fetcher: Callable[[str], DouyinPage] = fetch_douyin_page,
        downloader: Callable[[str, Path, ExecutionControl], None] = download_douyin_media,
        image_downloader: Callable[
            [str, Path, ExecutionControl], Path
        ] = download_douyin_image,
        browser_resolver: Callable[
            [str], DouyinVideo | DouyinImagePost
        ] = resolve_douyin_post_in_browser,
    ) -> None:
        self.transcriber = transcriber
        self.fetcher = fetcher
        self.downloader = downloader
        self.image_downloader = image_downloader
        self.browser_resolver = browser_resolver

    def run(self, job: Job, control: ExecutionControl) -> ProviderResult:
        if job.source_type != "douyin" or not job.source_url:
            raise ValueError("Douyin provider requires a douyin job")
        if control.is_cancel_requested():
            raise ProviderCancelled()

        control.heartbeat(0.05, "Resolving Douyin post")
        page = self.fetcher(job.source_url)
        try:
            post = parse_douyin_post(page)
        except DouyinPageDataUnavailableError:
            control.heartbeat(0.1, "Rendering public Douyin page")
            post = self.browser_resolver(job.source_url)
        if control.is_cancel_requested():
            raise ProviderCancelled()

        if isinstance(post, DouyinImagePost):
            return self._run_image_post(job, page, post, control)

        job.output_dir.mkdir(parents=True, exist_ok=True)
        media_path = job.output_dir / "source.mp4"
        control.heartbeat(0.2, "Downloading Douyin video")
        self.downloader(post.media_url, media_path, control)
        if not media_path.is_file() or media_path.stat().st_size <= 0:
            raise DouyinExtractionError("抖音视频下载失败，临时媒体文件为空。")

        source_metadata_path = job.output_dir / "source.json"
        source_metadata_path.write_text(
            json.dumps(
                {
                    "source_type": "douyin-video",
                    "requested_url": job.source_url,
                    "final_url": page.final_url,
                    "video_id": post.video_id,
                    "title": post.title,
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

    def _run_image_post(
        self,
        job: Job,
        page: DouyinPage,
        post: DouyinImagePost,
        control: ExecutionControl,
    ) -> ProviderResult:
        job.output_dir.mkdir(parents=True, exist_ok=True)
        images_dir = job.output_dir / "images"
        images_dir.mkdir(exist_ok=True)
        image_drafts = []
        image_records = []
        total_size = 0
        image_count = len(post.image_urls)
        for index, image_url in enumerate(post.image_urls, start=1):
            if control.is_cancel_requested():
                raise ProviderCancelled()
            control.heartbeat(
                0.15 + (index - 1) / image_count * 0.55,
                f"Downloading Douyin images {index}/{image_count}",
            )
            image_path = self.image_downloader(
                image_url,
                images_dir / f"{index:03d}",
                control,
            )
            if not image_path.is_file() or image_path.stat().st_size <= 0:
                raise DouyinExtractionError("抖音图片下载失败，图片文件为空。")
            total_size += image_path.stat().st_size
            if total_size > _MAX_IMAGE_TOTAL_BYTES:
                image_path.unlink(missing_ok=True)
                raise DouyinExtractionError("抖音图文图片合计超过 80 MB 限制。")
            digest = _sha256_file(image_path)
            image_drafts.append(ArtifactDraft(f"source_image_{index:03d}", image_path))
            image_records.append(
                {
                    "url": image_url,
                    "filename": image_path.name,
                    "size": image_path.stat().st_size,
                    "sha256": digest,
                }
            )

        control.heartbeat(0.75, "Preparing Douyin image post")
        content_path = job.output_dir / "content.md"
        source_metadata_path = job.output_dir / "source.json"
        description = post.description.strip()
        body = description if description != post.title else ""
        content_path.write_text(
            "\n".join((f"# {post.title}", "", body)).rstrip() + "\n",
            encoding="utf-8",
        )
        source_metadata_path.write_text(
            json.dumps(
                {
                    "source_type": "douyin-image",
                    "requested_url": job.source_url,
                    "final_url": page.final_url,
                    "post_id": post.post_id,
                    "title": post.title,
                    "description": post.description,
                    "captured_at": page.captured_at,
                    "images": image_records,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        control.heartbeat(0.98, "Validating Douyin image artifacts")
        return ProviderResult(
            artifacts=(
                ArtifactDraft("content", content_path),
                ArtifactDraft("source_metadata", source_metadata_path),
                *image_drafts,
            ),
            log_path=None,
        )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
