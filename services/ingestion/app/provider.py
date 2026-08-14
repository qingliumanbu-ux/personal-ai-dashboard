from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
from typing import Callable, Protocol

from .queue import Job


class ProviderCancelled(Exception):
    pass


@dataclass(frozen=True)
class ArtifactDraft:
    kind: str
    path: Path


@dataclass(frozen=True)
class ProviderResult:
    artifacts: tuple[ArtifactDraft, ...]
    log_path: Path | None


class ExecutionControl(Protocol):
    def set_pid(self, pid: int) -> None: ...

    def heartbeat(self, progress: float, current_step: str) -> None: ...

    def is_cancel_requested(self) -> bool: ...


class TranscriptionProvider(Protocol):
    def run(self, job: Job, control: ExecutionControl) -> ProviderResult: ...


class FasterWhisperProvider:
    def __init__(
        self,
        python_path: Path,
        script_path: Path,
        model_dir: Path,
        poll_interval: float = 0.5,
        duration_probe: Callable[[Path], float | None] | None = None,
    ) -> None:
        self.python_path = Path(python_path)
        self.script_path = Path(script_path)
        self.model_dir = Path(model_dir)
        self.poll_interval = poll_interval
        self.duration_probe = duration_probe or self._probe_duration

    def run(self, job: Job, control: ExecutionControl) -> ProviderResult:
        if not self.python_path.is_file():
            raise FileNotFoundError(f"Transcription Python not found: {self.python_path}")
        if not self.script_path.is_file():
            raise FileNotFoundError(f"Transcription script not found: {self.script_path}")
        job.output_dir.mkdir(parents=True, exist_ok=True)
        log_path = job.output_dir / "transcription.log"
        command = [
            str(self.python_path),
            str(self.script_path),
            str(job.source_path),
            str(job.output_dir),
            str(self.model_dir),
            "--model",
            job.params.get("model", "small"),
            "--language",
            job.params.get("language", "zh"),
        ]
        if job.params.get("vad") == "true":
            command.append("--vad")
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        duration = self.duration_probe(job.source_path)
        with log_path.open("wb") as log:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                creationflags=creation_flags,
            )
            assert process.stdout is not None
            output: queue.Queue[bytes | None] = queue.Queue()

            def read_output() -> None:
                for line in iter(process.stdout.readline, b""):
                    output.put(line)
                output.put(None)

            reader = threading.Thread(target=read_output, name="transcription-output", daemon=True)
            reader.start()
            control.set_pid(process.pid)
            current_progress = 0.02
            current_step = "Loading local model"
            control.heartbeat(current_progress, current_step)
            output_closed = False
            try:
                while process.poll() is None or not output_closed:
                    if control.is_cancel_requested():
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=5)
                        raise ProviderCancelled()
                    try:
                        line = output.get(timeout=self.poll_interval)
                    except queue.Empty:
                        control.heartbeat(current_progress, current_step)
                        continue
                    if line is None:
                        output_closed = True
                        continue
                    log.write(line)
                    log.flush()
                    processed = _segment_end_seconds(line)
                    if duration and processed is not None:
                        current_progress = min(0.95, max(current_progress, processed / duration))
                        current_step = (
                            f"Transcribing {_clock(processed)} / {_clock(duration)}"
                        )
                    control.heartbeat(current_progress, current_step)
            finally:
                reader.join(timeout=1)
                process.stdout.close()
        if process.returncode != 0:
            raise RuntimeError(
                f"Transcription process exited with code {process.returncode}. See the job log."
            )
        control.heartbeat(0.98, "Validating artifacts")
        artifacts = (
            ArtifactDraft("transcript", job.output_dir / "transcript.txt"),
            ArtifactDraft("subtitles", job.output_dir / "transcript.srt"),
            ArtifactDraft("metadata", job.output_dir / "transcript.json"),
        )
        for artifact in artifacts:
            if not artifact.path.is_file() or artifact.path.stat().st_size <= 0:
                raise RuntimeError(f"Expected artifact is missing or empty: {artifact.path.name}")
        return ProviderResult(artifacts=artifacts, log_path=log_path)

    def _probe_duration(self, source_path: Path) -> float | None:
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        probe = (
            "import av, sys; "
            "container = av.open(sys.argv[1]); "
            "print(float(container.duration / av.time_base) if container.duration else 0); "
            "container.close()"
        )
        try:
            result = subprocess.run(
                [str(self.python_path), "-c", probe, str(source_path)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
                creationflags=creation_flags,
                check=False,
            )
            duration = float(result.stdout.strip()) if result.returncode == 0 else 0
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return None
        return duration if duration > 0 else None


_SEGMENT_TIMESTAMP = re.compile(
    rb"\[\d{2}:\d{2}:\d{2}\.\d{3}\s+-\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]"
)


def _segment_end_seconds(line: bytes) -> float | None:
    match = _SEGMENT_TIMESTAMP.search(line)
    if match is None:
        return None
    hours, minutes, seconds, milliseconds = (int(value) for value in match.groups())
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000


def _clock(seconds: float) -> str:
    whole_seconds = max(0, round(seconds))
    minutes, remaining = divmod(whole_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{remaining:02d}"
