from __future__ import annotations

import asyncio
import json
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import IngestionConfig
from .provider import (
    FasterWhisperProvider,
    TranscriptionProvider,
    VadCapability,
    probe_vad_runtime,
)
from .publisher import (
    PublicationConflictError,
    PublicationNotAllowedError,
    PublicationStateError,
    Publisher,
)
from .queue import (
    DuplicateJobError,
    InvalidSourcePathError,
    Job,
    JobNotFoundError,
    JobQueue,
    Publication,
)
from .worker import Worker


class CreateJobRequest(BaseModel):
    source_path: str
    language: str = "zh"
    model: str = "small"
    vad: bool = False


class ReviewJobRequest(BaseModel):
    decision: Literal["approved", "changes_requested", "rejected"]
    note: str = ""


class PublishJobRequest(BaseModel):
    confirm: bool = False


class RetryJobRequest(BaseModel):
    vad: bool | None = None


def create_app(
    config: IngestionConfig,
    start_worker: bool = True,
    provider: TranscriptionProvider | None = None,
    vad_capability: VadCapability | None = None,
) -> FastAPI:
    queue = JobQueue(config.database_path, config.runs_dir, config.allowed_source_roots)
    publisher = Publisher(queue, config.vault_root)
    config.logs_dir.mkdir(parents=True, exist_ok=True)
    stop_event = threading.Event()
    worker_thread: threading.Thread | None = None
    active_vad_capability = vad_capability or probe_vad_runtime(
        config.transcription_python
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        nonlocal worker_thread
        if start_worker:
            active_provider = provider or FasterWhisperProvider(
                config.transcription_python,
                config.transcription_script,
                config.model_dir,
            )
            worker = Worker(queue, active_provider, "local-worker")
            worker_thread = threading.Thread(
                target=worker.run_forever,
                args=(stop_event,),
                name="workbench-worker",
                daemon=True,
            )
            worker_thread.start()
        yield
        stop_event.set()
        if worker_thread is not None:
            worker_thread.join(timeout=5)

    app = FastAPI(title="Personal AI Dashboard Ingestion", version="0.2.0", lifespan=lifespan)
    app.state.queue = queue
    app.state.publisher = publisher
    app.state.config = config
    app.state.start_worker = start_worker
    app.state.vad_capability = active_vad_capability
    allowed_origins = [
        f"http://127.0.0.1:{config.port}",
        f"http://localhost:{config.port}",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_origin_regex=r"^http://(?:127\.0\.0\.1|localhost)(?::\d+)?$",
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Last-Event-ID"],
    )

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        host = (request.headers.get("host") or "").split(":", 1)[0].lower()
        if host not in {"127.0.0.1", "localhost", "testserver"}:
            return _error_response(403, "Host is not allowed")
        origin = request.headers.get("origin")
        if origin and not _is_loopback_http_origin(origin):
            return _error_response(403, "Origin is not allowed")
        return await call_next(request)

    @app.get("/api/health")
    def health() -> dict:
        return {
            "status": "ok",
            "capabilities": {
                "vad": {
                    "available": active_vad_capability.available,
                    "reason": active_vad_capability.reason,
                }
            },
        }

    @app.get("/api/jobs")
    def list_jobs(job_status: str | None = None) -> list[dict]:
        payloads = []
        for job in queue.list(job_status):
            payload = _job_payload(job)
            publication = queue.get_publication(job.id)
            payload["publication"] = (
                _publication_payload(publication) if publication is not None else None
            )
            payloads.append(payload)
        return payloads

    @app.post("/api/jobs", status_code=status.HTTP_201_CREATED)
    def create_job(payload: CreateJobRequest) -> dict:
        if payload.vad and not active_vad_capability.available:
            raise HTTPException(
                status_code=422,
                detail=active_vad_capability.reason or "VAD runtime is unavailable",
            )
        try:
            job = queue.submit(
                Path(payload.source_path),
                {
                    "language": payload.language,
                    "model": payload.model,
                    "vad": "true" if payload.vad else "false",
                },
            )
        except InvalidSourcePathError as error:
            raise HTTPException(
                status_code=400,
                detail="路径不在批准的来源目录内，或文件不存在。",
            ) from error
        except DuplicateJobError as error:
            raise HTTPException(
                status_code=409,
                detail={"message": "Source already has an active job", "job_id": error.existing_job_id},
            ) from error
        return _job_payload(job)

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict:
        try:
            job = queue.get(job_id)
            payload = _job_payload(job)
            payload["attempts"] = [
                {
                    "attempt_number": attempt.attempt_number,
                    "started_at": attempt.started_at,
                    "ended_at": attempt.ended_at,
                    "exit_code": attempt.exit_code,
                    "error": attempt.error,
                }
                for attempt in queue.list_attempts(job_id)
            ]
            payload["artifacts"] = [
                {
                    "id": artifact.id,
                    "kind": artifact.kind,
                    "name": artifact.path.name,
                    "size": artifact.size,
                    "sha256": artifact.sha256,
                    "download_url": f"/api/jobs/{job_id}/artifacts/{artifact.id}",
                }
                for artifact in queue.list_artifacts(job_id)
            ]
            payload["reviews"] = [
                {
                    "decision": review.decision,
                    "note": review.note,
                    "created_at": review.created_at,
                }
                for review in queue.list_reviews(job_id)
            ]
            publication = queue.get_publication(job_id)
            payload["publication"] = (
                _publication_payload(publication) if publication is not None else None
            )
            preview = (
                publisher.preview(job_id)
                if publication is None and job.status == "succeeded"
                else None
            )
            payload["publication_preview"] = (
                {
                    "id": preview.id,
                    "relative_path": preview.relative_path,
                }
                if preview is not None
                else None
            )
            return payload
        except JobNotFoundError as error:
            raise HTTPException(status_code=404, detail="Job not found") from error

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str) -> dict:
        try:
            return _job_payload(queue.cancel(job_id))
        except JobNotFoundError as error:
            raise HTTPException(status_code=404, detail="Job not found") from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.post("/api/jobs/{job_id}/retry")
    def retry_job(job_id: str, payload: RetryJobRequest | None = None) -> dict:
        try:
            job = queue.get(job_id)
            requested_vad = (
                payload.vad
                if payload is not None and payload.vad is not None
                else job.params.get("vad") == "true"
            )
            if requested_vad and not active_vad_capability.available:
                raise HTTPException(
                    status_code=422,
                    detail=active_vad_capability.reason or "VAD runtime is unavailable",
                )
            params_override = (
                {"vad": "true" if payload.vad else "false"}
                if payload is not None and payload.vad is not None
                else None
            )
            return _job_payload(queue.retry(job_id, params_override))
        except JobNotFoundError as error:
            raise HTTPException(status_code=404, detail="Job not found") from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.post("/api/jobs/{job_id}/review")
    def review_job(job_id: str, payload: ReviewJobRequest) -> dict:
        try:
            return _job_payload(queue.review(job_id, payload.decision, payload.note))
        except JobNotFoundError as error:
            raise HTTPException(status_code=404, detail="Job not found") from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.post("/api/jobs/{job_id}/publish")
    def publish_job(job_id: str, payload: PublishJobRequest) -> dict:
        if not payload.confirm:
            raise HTTPException(status_code=400, detail="Explicit publication confirmation is required")
        try:
            return _publication_payload(publisher.publish(job_id))
        except JobNotFoundError as error:
            raise HTTPException(status_code=404, detail="Job not found") from error
        except (
            PublicationNotAllowedError,
            PublicationConflictError,
            PublicationStateError,
        ) as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.get("/api/jobs/{job_id}/artifacts/{artifact_id}")
    def download_artifact(job_id: str, artifact_id: str) -> FileResponse:
        try:
            artifact = queue.get_artifact(job_id, artifact_id)
        except (JobNotFoundError, OSError) as error:
            raise HTTPException(status_code=404, detail="Artifact not found") from error
        if artifact.kind == "transcript":
            return FileResponse(artifact.path, media_type="text/plain; charset=utf-8")
        return FileResponse(artifact.path, filename=artifact.path.name)

    @app.get("/api/events")
    async def events(request: Request, after: int = 0) -> StreamingResponse:
        header_id = request.headers.get("last-event-id")
        cursor = max(after, int(header_id)) if header_id and header_id.isdigit() else after

        async def stream():
            nonlocal cursor
            while not await request.is_disconnected():
                batch = queue.list_events(cursor)
                if not batch:
                    yield ": keepalive\n\n"
                    await asyncio.sleep(1)
                    continue
                for event in batch:
                    cursor = event.id
                    data = json.dumps(
                        {
                            "job_id": event.job_id,
                            "event_type": event.event_type,
                            "payload": event.payload,
                            "created_at": event.created_at,
                        },
                        ensure_ascii=False,
                    )
                    yield f"id: {event.id}\nevent: job\ndata: {data}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    return app


def _job_payload(job: Job) -> dict:
    return {
        "id": job.id,
        "source_path": str(job.source_path),
        "status": job.status,
        "output_dir": str(job.output_dir),
        "params": job.params,
        "progress": job.progress,
        "current_step": job.current_step,
        "attempt_count": job.attempt_count,
        "pid": job.pid,
        "error": job.error,
        "cancel_requested": job.cancel_requested,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _publication_payload(publication: Publication) -> dict:
    return {
        "id": publication.id,
        "job_id": publication.job_id,
        "source_sha256": publication.source_sha256,
        "content_sha256": publication.content_sha256,
        "relative_path": publication.relative_path,
        "created_at": publication.created_at,
    }


def _error_response(status_code: int, detail: str):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=status_code, content={"detail": detail})


def _is_loopback_http_origin(origin: str) -> bool:
    parsed = urlparse(origin)
    return parsed.scheme == "http" and parsed.hostname in {
        "127.0.0.1",
        "localhost",
        "::1",
    }
