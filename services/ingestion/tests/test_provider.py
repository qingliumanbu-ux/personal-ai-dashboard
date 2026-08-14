import importlib.util
import sys
import tempfile
import unittest
import wave
from pathlib import Path

from app.provider import FasterWhisperProvider
from app.queue import JobQueue


class RecordingControl:
    def __init__(self) -> None:
        self.pid = None
        self.steps = []

    def set_pid(self, pid: int) -> None:
        self.pid = pid

    def heartbeat(self, progress: float, current_step: str) -> None:
        self.steps.append((progress, current_step))

    def is_cancel_requested(self) -> bool:
        return False


class ProviderTests(unittest.TestCase):
    def test_default_duration_probe_reports_real_seconds(self) -> None:
        if importlib.util.find_spec("av") is None:
            self.skipTest("PyAV is unavailable in the active Python environment")
        transcription_python = Path(sys.executable)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "two-seconds.wav"
            with wave.open(str(source), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(8000)
                audio.writeframes(b"\x00\x00" * 16000)
            script = root / "fake_transcribe.py"
            script.write_text(
                """
import pathlib
import sys

output = pathlib.Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
print('[00:00:00.000 - 00:00:01.000] half', flush=True)
(output / 'transcript.txt').write_text('hello', encoding='utf-8')
(output / 'transcript.srt').write_text('subtitle', encoding='utf-8')
(output / 'transcript.json').write_text('{}', encoding='utf-8')
""".strip(),
                encoding="utf-8",
            )
            queue = JobQueue(root / "workbench.db", root / "runs", (source_root,))
            queue.submit(source, {"language": "zh", "model": "small"})
            job = queue.claim_next("worker-a", 30)
            assert job is not None
            control = RecordingControl()
            provider = FasterWhisperProvider(
                python_path=transcription_python,
                script_path=script,
                model_dir=root / "model",
                poll_interval=0.01,
            )

            provider.run(job, control)

            reported = [progress for progress, _ in control.steps]
            self.assertTrue(any(abs(progress - 0.5) < 0.02 for progress in reported))

    def test_provider_reports_media_progress_from_segment_timestamps(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            script = root / "fake_transcribe.py"
            script.write_text(
                """
import pathlib
import sys

output = pathlib.Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
print('[00:00:00.000 - 00:00:05.000] first', flush=True)
print('[00:00:05.000 - 00:00:10.000] second', flush=True)
(output / 'transcript.txt').write_text('hello', encoding='utf-8')
(output / 'transcript.srt').write_text('subtitle', encoding='utf-8')
(output / 'transcript.json').write_text('{}', encoding='utf-8')
""".strip(),
                encoding="utf-8",
            )
            queue = JobQueue(root / "workbench.db", root / "runs", (source_root,))
            queue.submit(source, {"language": "zh", "model": "small"})
            job = queue.claim_next("worker-a", 30)
            assert job is not None
            control = RecordingControl()
            provider = FasterWhisperProvider(
                python_path=Path(sys.executable),
                script_path=script,
                model_dir=root / "model",
                poll_interval=0.01,
                duration_probe=lambda _: 20.0,
            )

            provider.run(job, control)

            reported = [progress for progress, _ in control.steps]
            self.assertEqual(reported, sorted(reported))
            self.assertTrue(any(abs(progress - 0.25) < 0.001 for progress in reported))
            self.assertTrue(any(abs(progress - 0.5) < 0.001 for progress in reported))

    def test_subprocess_provider_uses_existing_script_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "sources"
            source_root.mkdir()
            source = source_root / "clip.mp4"
            source.write_bytes(b"video")
            script = root / "fake_transcribe.py"
            script.write_text(
                """
import pathlib
import sys

output = pathlib.Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
(output / 'transcript.txt').write_text('hello', encoding='utf-8')
(output / 'transcript.srt').write_text('subtitle', encoding='utf-8')
(output / 'transcript.json').write_text('{}', encoding='utf-8')
print('done', flush=True)
""".strip(),
                encoding="utf-8",
            )
            queue = JobQueue(root / "workbench.db", root / "runs", (source_root,))
            queue.submit(source, {"language": "zh", "model": "small"})
            job = queue.claim_next("worker-a", 30)
            assert job is not None
            control = RecordingControl()
            provider = FasterWhisperProvider(
                python_path=Path(sys.executable),
                script_path=script,
                model_dir=root / "model",
                poll_interval=0.01,
            )

            result = provider.run(job, control)

            self.assertIsNotNone(control.pid)
            self.assertEqual(
                {artifact.kind for artifact in result.artifacts},
                {"transcript", "subtitles", "metadata"},
            )
            self.assertIsNotNone(result.log_path)
            assert result.log_path is not None
            self.assertIn("done", result.log_path.read_text(encoding="utf-8"))
