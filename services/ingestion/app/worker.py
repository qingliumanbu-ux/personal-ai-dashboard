from __future__ import annotations

import threading

import psutil

from .provider import ExecutionControl, ProviderCancelled, TranscriptionProvider
from .queue import JobQueue


class _QueueExecutionControl(ExecutionControl):
    def __init__(self, queue: JobQueue, job_id: str, worker_id: str, lease_seconds: int) -> None:
        self.queue = queue
        self.job_id = job_id
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds

    def set_pid(self, pid: int) -> None:
        self.queue.set_pid(self.job_id, self.worker_id, pid)

    def heartbeat(self, progress: float, current_step: str) -> None:
        self.queue.heartbeat(
            self.job_id,
            self.worker_id,
            self.lease_seconds,
            progress,
            current_step,
        )

    def is_cancel_requested(self) -> bool:
        return self.queue.is_cancel_requested(self.job_id)


class Worker:
    def __init__(
        self,
        queue: JobQueue,
        provider: TranscriptionProvider,
        worker_id: str,
        lease_seconds: int = 60,
    ) -> None:
        self.queue = queue
        self.provider = provider
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds

    def run_once(self) -> bool:
        job = self.queue.claim_next(self.worker_id, self.lease_seconds)
        if job is None:
            return False
        control = _QueueExecutionControl(
            self.queue,
            job.id,
            self.worker_id,
            self.lease_seconds,
        )
        try:
            result = self.provider.run(job, control)
            self.queue.complete(job.id, self.worker_id, result.artifacts, result.log_path)
        except ProviderCancelled:
            self.queue.mark_cancelled(job.id, self.worker_id)
        except Exception as error:
            self.queue.fail(job.id, self.worker_id, str(error))
        return True

    def run_forever(self, stop_event: threading.Event, idle_seconds: float = 0.5) -> None:
        while not stop_event.is_set():
            self.queue.recover_running(psutil.pid_exists)
            if self.queue.list("running"):
                stop_event.wait(idle_seconds)
                continue
            if not self.run_once():
                stop_event.wait(idle_seconds)
