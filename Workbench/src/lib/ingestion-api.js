const API_ROOT = "/api/ingestion";
const DEFAULT_TIMEOUT = 12_000;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeout ?? DEFAULT_TIMEOUT);
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = `请求失败（${response.status}）`;
      try {
        const payload = await response.json();
        detail = typeof payload.detail === "string"
          ? payload.detail
          : payload.detail?.message || detail;
      } catch {
        // Keep the status-based message when the service did not return JSON.
      }
      throw new Error(detail);
    }
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("采集服务响应超时");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function loadIngestionHealth() {
  return request("/health", { timeout: 3_000 });
}

export function loadIngestionJobs() {
  return request("/jobs");
}

export function loadIngestionJob(jobId) {
  return request(`/jobs/${encodeURIComponent(jobId)}`);
}

export function createIngestionJob(payload) {
  return request("/jobs", { method: "POST", body: JSON.stringify(payload) });
}

export function reviewIngestionJob(jobId, decision, note) {
  return request(`/jobs/${encodeURIComponent(jobId)}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  });
}

export function publishIngestionJob(jobId) {
  return request(`/jobs/${encodeURIComponent(jobId)}/publish`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
}

export function cancelIngestionJob(jobId) {
  return request(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function retryIngestionJob(jobId, vad) {
  return request(`/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: JSON.stringify(typeof vad === "boolean" ? { vad } : {}),
  });
}

export async function loadTranscriptText(jobId, artifactId) {
  const response = await fetch(
    `${API_ROOT}/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`,
    { headers: { Accept: "text/plain" } },
  );
  if (!response.ok) throw new Error("无法读取候选正文");
  return response.text();
}
