from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class IngestionConfig:
    database_path: Path
    runs_dir: Path
    logs_dir: Path
    allowed_source_roots: tuple[Path, ...]
    transcription_python: Path
    transcription_script: Path
    model_dir: Path
    vault_root: Path
    host: str = "127.0.0.1"
    port: int = 8766

    @classmethod
    def from_environment(cls) -> "IngestionConfig":
        runtime_root = Path(
            os.environ.get(
                "PERSONAL_DASHBOARD_INGESTION_RUNTIME_ROOT",
                str(Path.home() / ".personal-ai-dashboard" / "ingestion"),
            )
        ).expanduser()
        roots_value = os.environ.get(
            "PERSONAL_DASHBOARD_INGESTION_ALLOWED_ROOTS",
            "",
        )
        allowed_roots = tuple(
            Path(value).expanduser()
            for value in roots_value.split(os.pathsep)
            if value.strip()
        )
        repository_root = Path(__file__).resolve().parents[3]
        return cls(
            database_path=Path(
                os.environ.get(
                    "PERSONAL_DASHBOARD_INGESTION_DATABASE_PATH",
                    str(runtime_root / "Data" / "ingestion.db"),
                )
            ).expanduser(),
            runs_dir=runtime_root / "Runs",
            logs_dir=runtime_root / "Logs",
            allowed_source_roots=allowed_roots,
            transcription_python=Path(
                os.environ.get("PERSONAL_DASHBOARD_TRANSCRIPTION_PYTHON", sys.executable)
            ).expanduser(),
            transcription_script=Path(
                os.environ.get(
                    "PERSONAL_DASHBOARD_TRANSCRIPTION_SCRIPT",
                    str(runtime_root / "transcribe_video.py"),
                )
            ).expanduser(),
            model_dir=Path(
                os.environ.get(
                    "PERSONAL_DASHBOARD_TRANSCRIPTION_MODEL_DIR",
                    str(runtime_root / "models" / "faster-whisper-small"),
                )
            ).expanduser(),
            vault_root=Path(
                os.environ.get(
                    "PERSONAL_DASHBOARD_VAULT_ROOT",
                    str(repository_root / "个人知识库"),
                )
            ).expanduser(),
            host=os.environ.get("PERSONAL_DASHBOARD_INGESTION_HOST", "127.0.0.1"),
            port=int(os.environ.get("PERSONAL_DASHBOARD_INGESTION_PORT", "8766")),
        )

    @classmethod
    def for_testing(
        cls,
        root: Path,
        allowed_source_roots: tuple[Path, ...],
    ) -> "IngestionConfig":
        return cls(
            database_path=root / "Data" / "ingestion.db",
            runs_dir=root / "Runs",
            logs_dir=root / "Logs",
            allowed_source_roots=allowed_source_roots,
            transcription_python=root / "python.exe",
            transcription_script=root / "transcribe_video.py",
            model_dir=root / "model",
            vault_root=root / "vault",
        )
