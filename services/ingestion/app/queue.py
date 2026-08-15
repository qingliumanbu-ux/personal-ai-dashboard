from __future__ import annotations

import sqlite3
import json
import hashlib
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Iterator
from uuid import uuid4


@dataclass(frozen=True)
class Job:
    id: str
    source_type: str
    source_path: Path | None
    source_url: str | None
    status: str
    output_dir: Path
    params: dict[str, str]
    progress: float
    current_step: str
    attempt_count: int
    lease_owner: str | None
    lease_expires_at: str | None
    pid: int | None
    error: str | None
    cancel_requested: bool
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class Artifact:
    id: str
    job_id: str
    kind: str
    path: Path
    size: int
    sha256: str


@dataclass(frozen=True)
class Attempt:
    attempt_number: int
    started_at: str
    ended_at: str | None
    exit_code: int | None
    error: str | None
    log_path: Path | None


@dataclass(frozen=True)
class Review:
    decision: str
    note: str
    created_at: str


@dataclass(frozen=True)
class Publication:
    id: str
    job_id: str
    source_sha256: str
    content_sha256: str
    relative_path: str
    created_at: str


@dataclass(frozen=True)
class JobEvent:
    id: int
    job_id: str
    event_type: str
    payload: dict[str, object]
    created_at: str


class JobNotFoundError(LookupError):
    pass


class InvalidSourcePathError(ValueError):
    pass


class DuplicateJobError(ValueError):
    def __init__(self, existing_job_id: str) -> None:
        super().__init__(existing_job_id)
        self.existing_job_id = existing_job_id


class JobQueue:
    def __init__(
        self,
        database_path: Path,
        runs_dir: Path,
        allowed_source_roots: tuple[Path, ...],
    ) -> None:
        self.database_path = Path(database_path)
        self.runs_dir = Path(runs_dir)
        self.allowed_source_roots = tuple(Path(root).resolve() for root in allowed_source_roots)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def submit(self, source_path: Path, params: dict[str, str] | None = None) -> Job:
        try:
            source = Path(source_path).resolve(strict=True)
        except OSError as error:
            raise InvalidSourcePathError(str(source_path)) from error
        if not source.is_file() or not any(root in source.parents for root in self.allowed_source_roots):
            raise InvalidSourcePathError(str(source))
        return self._submit(
            source_type="local-video",
            source_path=source,
            source_url=None,
            params=params,
        )

    def submit_web(self, source_url: str, params: dict[str, str] | None = None) -> Job:
        normalized_url = source_url.strip()
        if not normalized_url:
            raise ValueError("Web source URL is required")
        return self._submit(
            source_type="web-page",
            source_path=None,
            source_url=normalized_url,
            params=params,
        )

    def _submit(
        self,
        source_type: str,
        source_path: Path | None,
        source_url: str | None,
        params: dict[str, str] | None,
    ) -> Job:
        now = datetime.now(UTC).isoformat()
        job_id = str(uuid4())
        job = Job(
            id=job_id,
            source_type=source_type,
            source_path=source_path,
            source_url=source_url,
            status="queued",
            output_dir=self.runs_dir / job_id,
            params=dict(params or {}),
            progress=0,
            current_step="Waiting in queue",
            attempt_count=0,
            lease_owner=None,
            lease_expires_at=None,
            pid=None,
            error=None,
            cancel_requested=False,
            created_at=now,
            updated_at=now,
        )
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            source_column = "source_path" if source_type == "local-video" else "source_url"
            source_value = str(source_path) if source_path is not None else source_url
            duplicate = connection.execute(
                f"""
                SELECT id
                FROM jobs
                WHERE source_type = ? AND {source_column} = ?
                    AND status IN ('queued', 'running', 'waiting_review')
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (source_type, source_value),
            ).fetchone()
            if duplicate is not None:
                raise DuplicateJobError(duplicate["id"])
            connection.execute(
                """
                INSERT INTO jobs (
                    id, source_type, source_path, source_url, status, output_dir, params_json, progress,
                    current_step, attempt_count, lease_owner, lease_expires_at,
                    pid, error, cancel_requested, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job.id,
                    job.source_type,
                    str(job.source_path) if job.source_path is not None else "",
                    job.source_url,
                    job.status,
                    str(job.output_dir),
                    json.dumps(job.params, ensure_ascii=False),
                    job.progress,
                    job.current_step,
                    job.attempt_count,
                    job.lease_owner,
                    job.lease_expires_at,
                    job.pid,
                    job.error,
                    int(job.cancel_requested),
                    job.created_at,
                    job.updated_at,
                ),
            )
            self._insert_event(connection, job.id, "queued", {"status": "queued"})
        return job

    def get(self, job_id: str) -> Job:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT *
                FROM jobs
                WHERE id = ?
                """,
                (job_id,),
            ).fetchone()
        if row is None:
            raise JobNotFoundError(job_id)
        return self._row_to_job(row)

    def list(self, status: str | None = None) -> list[Job]:
        with self._connect() as connection:
            if status is None:
                rows = connection.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC",
                    (status,),
                ).fetchall()
        return [self._row_to_job(row) for row in rows]

    def claim_next(self, worker_id: str, lease_seconds: int) -> Job | None:
        now = datetime.now(UTC)
        lease_expires_at = (now + timedelta(seconds=lease_seconds)).isoformat()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT id, source_type FROM jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            job_id = row["id"]
            starting_step = (
                "Starting transcription"
                if row["source_type"] == "local-video"
                else "Starting ingestion"
            )
            connection.execute(
                """
                UPDATE jobs
                SET status = 'running', progress = 0, current_step = ?,
                    attempt_count = attempt_count + 1, lease_owner = ?, lease_expires_at = ?,
                    error = NULL, cancel_requested = 0, updated_at = ?
                WHERE id = ? AND status = 'queued'
                """,
                (starting_step, worker_id, lease_expires_at, now.isoformat(), job_id),
            )
            attempt_number = connection.execute(
                "SELECT attempt_count FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()["attempt_count"]
            connection.execute(
                """
                INSERT INTO attempts (job_id, attempt_number, started_at)
                VALUES (?, ?, ?)
                """,
                (job_id, attempt_number, now.isoformat()),
            )
            self._insert_event(connection, job_id, "running", {"status": "running"})
            claimed = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._row_to_job(claimed)

    def set_pid(self, job_id: str, worker_id: str, pid: int) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE jobs SET pid = ?, updated_at = ? WHERE id = ? AND lease_owner = ?",
                (pid, datetime.now(UTC).isoformat(), job_id, worker_id),
            )

    def heartbeat(
        self,
        job_id: str,
        worker_id: str,
        lease_seconds: int,
        progress: float,
        current_step: str,
    ) -> None:
        now = datetime.now(UTC)
        normalized_progress = min(max(progress, 0), 1)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            previous = connection.execute(
                """
                SELECT progress, current_step FROM jobs
                WHERE id = ? AND status = 'running' AND lease_owner = ?
                """,
                (job_id, worker_id),
            ).fetchone()
            if previous is None:
                return
            previous_progress = float(previous["progress"])
            if normalized_progress < previous_progress:
                effective_progress = previous_progress
                effective_step = previous["current_step"]
            else:
                effective_progress = normalized_progress
                effective_step = current_step
            connection.execute(
                """
                UPDATE jobs
                SET progress = ?, current_step = ?, lease_expires_at = ?, updated_at = ?
                WHERE id = ? AND status = 'running' AND lease_owner = ?
                """,
                (
                    effective_progress,
                    effective_step,
                    (now + timedelta(seconds=lease_seconds)).isoformat(),
                    now.isoformat(),
                    job_id,
                    worker_id,
                ),
            )
            previous_stage = previous["current_step"].partition(" ")[0]
            effective_stage = effective_step.partition(" ")[0]
            if effective_progress - previous_progress >= 0.005 or effective_stage != previous_stage:
                self._insert_event(
                    connection,
                    job_id,
                    "progress",
                    {"progress": effective_progress, "current_step": effective_step},
                )

    def is_cancel_requested(self, job_id: str) -> bool:
        return self.get(job_id).cancel_requested

    def complete(self, job_id: str, worker_id: str, artifact_drafts, log_path: Path | None) -> None:
        job = self.get(job_id)
        drafts = list(artifact_drafts)
        if log_path is not None:
            from .provider import ArtifactDraft

            drafts.append(ArtifactDraft(kind="log", path=log_path))
        required = (
            {"transcript", "subtitles", "metadata"}
            if job.source_type == "local-video"
            else {"content", "metadata", "source_snapshot"}
        )
        if not required.issubset({draft.kind for draft in drafts}):
            raise ValueError("Provider did not produce all required source artifacts")
        artifacts = [self._build_artifact(job, draft.kind, draft.path) for draft in drafts]
        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for artifact in artifacts:
                connection.execute(
                    """
                    INSERT INTO artifacts (id, job_id, kind, path, size, sha256)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        artifact.id,
                        artifact.job_id,
                        artifact.kind,
                        str(artifact.path),
                        artifact.size,
                        artifact.sha256,
                    ),
                )
            connection.execute(
                """
                UPDATE jobs
                SET status = 'waiting_review', progress = 1, current_step = 'Ready for review',
                    lease_owner = NULL, lease_expires_at = NULL, pid = NULL, updated_at = ?
                WHERE id = ? AND status = 'running' AND lease_owner = ?
                """,
                (now, job_id, worker_id),
            )
            connection.execute(
                """
                UPDATE attempts SET ended_at = ?, exit_code = 0, log_path = ?
                WHERE job_id = ? AND attempt_number = ?
                """,
                (now, str(log_path) if log_path else None, job_id, job.attempt_count),
            )
            self._insert_event(
                connection,
                job_id,
                "waiting_review",
                {"status": "waiting_review"},
            )

    def fail(self, job_id: str, worker_id: str, error: str) -> None:
        job = self.get(job_id)
        now = datetime.now(UTC).isoformat()
        failure_step = (
            "Transcription failed" if job.source_type == "local-video" else "Ingestion failed"
        )
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET status = 'failed', current_step = ?, error = ?,
                    lease_owner = NULL, lease_expires_at = NULL, pid = NULL, updated_at = ?
                WHERE id = ? AND lease_owner = ?
                """,
                (failure_step, error, now, job_id, worker_id),
            )
            connection.execute(
                """
                UPDATE attempts SET ended_at = ?, exit_code = 1, error = ?
                WHERE job_id = ? AND attempt_number = ?
                """,
                (now, error, job_id, job.attempt_count),
            )
            self._insert_event(connection, job_id, "failed", {"status": "failed"})

    def mark_cancelled(self, job_id: str, worker_id: str) -> None:
        job = self.get(job_id)
        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET status = 'cancelled', current_step = 'Cancelled', error = NULL,
                    cancel_requested = 0, lease_owner = NULL, lease_expires_at = NULL,
                    pid = NULL, updated_at = ?
                WHERE id = ? AND lease_owner = ?
                """,
                (now, job_id, worker_id),
            )
            connection.execute(
                """
                UPDATE attempts SET ended_at = ?, exit_code = -1, error = NULL
                WHERE job_id = ? AND attempt_number = ?
                """,
                (now, job_id, job.attempt_count),
            )
            self._insert_event(connection, job_id, "cancelled", {"status": "cancelled"})

    def retry(self, job_id: str, params_override: dict[str, str] | None = None) -> Job:
        job = self.get(job_id)
        if job.status not in {"failed", "cancelled"}:
            raise ValueError(f"Job in {job.status} cannot be retried")
        params = dict(job.params)
        if params_override:
            params.update(params_override)
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET status = 'queued', progress = 0, current_step = 'Waiting in queue',
                    lease_owner = NULL, lease_expires_at = NULL, pid = NULL,
                    error = NULL, cancel_requested = 0, params_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (json.dumps(params, ensure_ascii=False), datetime.now(UTC).isoformat(), job_id),
            )
            self._insert_event(connection, job_id, "queued", {"status": "queued"})
        return self.get(job_id)

    def cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            if job.status == "queued":
                connection.execute(
                    """
                    UPDATE jobs
                    SET status = 'cancelled', current_step = 'Cancelled', updated_at = ?
                    WHERE id = ?
                    """,
                    (now, job_id),
                )
                self._insert_event(connection, job_id, "cancelled", {"status": "cancelled"})
            elif job.status == "running":
                connection.execute(
                    """
                    UPDATE jobs
                    SET cancel_requested = 1, current_step = 'Cancellation requested', updated_at = ?
                    WHERE id = ?
                    """,
                    (now, job_id),
                )
                self._insert_event(
                    connection,
                    job_id,
                    "cancel_requested",
                    {"status": "running", "cancel_requested": True},
                )
            else:
                raise ValueError(f"Job in {job.status} cannot be cancelled")
        return self.get(job_id)

    def review(self, job_id: str, decision: str, note: str = "") -> Job:
        job = self.get(job_id)
        subject = "Transcript" if job.source_type == "local-video" else "Content"
        transitions = {
            "approved": ("succeeded", f"{subject} approved"),
            "changes_requested": ("changes_requested", "Changes requested"),
            "rejected": ("rejected", f"{subject} rejected"),
        }
        if decision not in transitions:
            raise ValueError(f"Unknown review decision: {decision}")
        normalized_note = note.strip()
        if decision != "approved" and not normalized_note:
            raise ValueError("A review note is required for this decision")
        status, current_step = transitions[decision]
        now = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT status FROM jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            if row is None:
                raise JobNotFoundError(job_id)
            if row["status"] != "waiting_review":
                raise ValueError(f"Job in {row['status']} cannot be reviewed")
            connection.execute(
                """
                INSERT INTO reviews (job_id, decision, note, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (job_id, decision, normalized_note, now),
            )
            connection.execute(
                """
                UPDATE jobs
                SET status = ?, current_step = ?, updated_at = ?
                WHERE id = ? AND status = 'waiting_review'
                """,
                (status, current_step, now, job_id),
            )
            self._insert_event(
                connection,
                job_id,
                "reviewed",
                {"status": status, "decision": decision},
            )
        return self.get(job_id)

    def recover_running(self, process_is_alive) -> int:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM jobs WHERE status = 'running'").fetchall()
        changed = 0
        for row in rows:
            job = self._row_to_job(row)
            if job.pid is not None and process_is_alive(job.pid):
                continue
            expected = (
                (
                    ("transcript", job.output_dir / "transcript.txt"),
                    ("subtitles", job.output_dir / "transcript.srt"),
                    ("metadata", job.output_dir / "transcript.json"),
                )
                if job.source_type == "local-video"
                else (
                    ("content", job.output_dir / "content.md"),
                    ("metadata", job.output_dir / "metadata.json"),
                    ("source_snapshot", job.output_dir / "source.html"),
                )
            )
            if all(path.is_file() and path.stat().st_size > 0 for _, path in expected):
                from .provider import ArtifactDraft

                drafts = tuple(ArtifactDraft(kind=kind, path=path) for kind, path in expected)
                log_path = job.output_dir / "transcription.log"
                self.complete(
                    job.id,
                    job.lease_owner or "recovery",
                    drafts,
                    log_path if log_path.is_file() and log_path.stat().st_size > 0 else None,
                )
            else:
                with self._connect() as connection:
                    connection.execute(
                        """
                        UPDATE jobs
                        SET status = 'queued', progress = 0, current_step = 'Recovered after restart',
                            lease_owner = NULL, lease_expires_at = NULL, pid = NULL,
                            error = NULL, updated_at = ?
                        WHERE id = ? AND status = 'running'
                        """,
                        (datetime.now(UTC).isoformat(), job.id),
                    )
                    self._insert_event(
                        connection,
                        job.id,
                        "queued",
                        {"status": "queued", "recovered": True},
                    )
            changed += 1
        return changed

    def list_artifacts(self, job_id: str) -> list[Artifact]:
        self.get(job_id)
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, job_id, kind, path, size, sha256 FROM artifacts WHERE job_id = ? ORDER BY kind",
                (job_id,),
            ).fetchall()
        return [
            Artifact(
                id=row["id"],
                job_id=row["job_id"],
                kind=row["kind"],
                path=Path(row["path"]),
                size=int(row["size"]),
                sha256=row["sha256"],
            )
            for row in rows
        ]

    def get_artifact(self, job_id: str, artifact_id: str) -> Artifact:
        job = self.get(job_id)
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, job_id, kind, path, size, sha256
                FROM artifacts WHERE id = ? AND job_id = ?
                """,
                (artifact_id, job_id),
            ).fetchone()
        if row is None:
            raise JobNotFoundError(artifact_id)
        path = Path(row["path"]).resolve(strict=True)
        if job.output_dir.resolve() not in path.parents or not path.is_file():
            raise JobNotFoundError(artifact_id)
        return Artifact(
            id=row["id"],
            job_id=row["job_id"],
            kind=row["kind"],
            path=path,
            size=int(row["size"]),
            sha256=row["sha256"],
        )

    def list_attempts(self, job_id: str) -> list[Attempt]:
        self.get(job_id)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT attempt_number, started_at, ended_at, exit_code, error, log_path
                FROM attempts WHERE job_id = ? ORDER BY attempt_number DESC
                """,
                (job_id,),
            ).fetchall()
        return [
            Attempt(
                attempt_number=int(row["attempt_number"]),
                started_at=row["started_at"],
                ended_at=row["ended_at"],
                exit_code=row["exit_code"],
                error=row["error"],
                log_path=Path(row["log_path"]) if row["log_path"] else None,
            )
            for row in rows
        ]

    def list_reviews(self, job_id: str) -> list[Review]:
        self.get(job_id)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT decision, note, created_at
                FROM reviews WHERE job_id = ? ORDER BY id
                """,
                (job_id,),
            ).fetchall()
        return [
            Review(
                decision=row["decision"],
                note=row["note"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def get_publication(self, job_id: str) -> Publication | None:
        self.get(job_id)
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, job_id, source_sha256, content_sha256, relative_path, created_at
                FROM publications WHERE job_id = ?
                """,
                (job_id,),
            ).fetchone()
        return self._row_to_publication(row) if row is not None else None

    def record_publication(self, publication: Publication) -> Publication:
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    """
                    INSERT INTO publications (
                        id, job_id, source_sha256, content_sha256, relative_path, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        publication.id,
                        publication.job_id,
                        publication.source_sha256,
                        publication.content_sha256,
                        publication.relative_path,
                        publication.created_at,
                    ),
                )
                self._insert_event(
                    connection,
                    publication.job_id,
                    "published",
                    {
                        "publication_id": publication.id,
                        "relative_path": publication.relative_path,
                    },
                )
        except sqlite3.IntegrityError:
            existing = self.get_publication(publication.job_id)
            if existing is not None:
                return existing
            raise
        return publication

    def list_events(self, after_id: int, limit: int = 100) -> list[JobEvent]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, job_id, event_type, payload_json, created_at
                FROM job_events WHERE id > ? ORDER BY id LIMIT ?
                """,
                (after_id, limit),
            ).fetchall()
        return [
            JobEvent(
                id=int(row["id"]),
                job_id=row["job_id"],
                event_type=row["event_type"],
                payload=json.loads(row["payload_json"]),
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    source_type TEXT NOT NULL DEFAULT 'local-video',
                    source_path TEXT NOT NULL,
                    source_url TEXT,
                    status TEXT NOT NULL,
                    output_dir TEXT NOT NULL,
                    params_json TEXT NOT NULL,
                    progress REAL NOT NULL,
                    current_step TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL,
                    lease_owner TEXT,
                    lease_expires_at TEXT,
                    pid INTEGER,
                    error TEXT,
                    cancel_requested INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            job_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(jobs)").fetchall()
            }
            if "source_type" not in job_columns:
                connection.execute(
                    "ALTER TABLE jobs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'local-video'"
                )
            if "source_url" not in job_columns:
                connection.execute("ALTER TABLE jobs ADD COLUMN source_url TEXT")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL,
                    path TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    UNIQUE(job_id, kind)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    attempt_number INTEGER NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    exit_code INTEGER,
                    error TEXT,
                    log_path TEXT,
                    UNIQUE(job_id, attempt_number)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    decision TEXT NOT NULL,
                    note TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS publications (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
                    source_sha256 TEXT NOT NULL,
                    content_sha256 TEXT NOT NULL,
                    relative_path TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                )
                """
            )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _row_to_job(row: sqlite3.Row) -> Job:
        return Job(
            id=row["id"],
            source_type=row["source_type"],
            source_path=Path(row["source_path"]) if row["source_path"] else None,
            source_url=row["source_url"],
            status=row["status"],
            output_dir=Path(row["output_dir"]),
            params=json.loads(row["params_json"]),
            progress=float(row["progress"]),
            current_step=row["current_step"],
            attempt_count=int(row["attempt_count"]),
            lease_owner=row["lease_owner"],
            lease_expires_at=row["lease_expires_at"],
            pid=row["pid"],
            error=row["error"],
            cancel_requested=bool(row["cancel_requested"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_publication(row: sqlite3.Row) -> Publication:
        return Publication(
            id=row["id"],
            job_id=row["job_id"],
            source_sha256=row["source_sha256"],
            content_sha256=row["content_sha256"],
            relative_path=row["relative_path"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _build_artifact(job: Job, kind: str, path: Path) -> Artifact:
        artifact_path = Path(path).resolve(strict=True)
        output_dir = job.output_dir.resolve()
        if output_dir not in artifact_path.parents or not artifact_path.is_file():
            raise ValueError("Artifact is outside the job output directory")
        size = artifact_path.stat().st_size
        if size <= 0:
            raise ValueError("Artifact is empty")
        digest = hashlib.sha256()
        with artifact_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return Artifact(
            id=str(uuid4()),
            job_id=job.id,
            kind=kind,
            path=artifact_path,
            size=size,
            sha256=digest.hexdigest(),
        )

    @staticmethod
    def _insert_event(
        connection: sqlite3.Connection,
        job_id: str,
        event_type: str,
        payload: dict[str, object],
    ) -> None:
        connection.execute(
            """
            INSERT INTO job_events (job_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                job_id,
                event_type,
                json.dumps(payload, ensure_ascii=False),
                datetime.now(UTC).isoformat(),
            ),
        )
