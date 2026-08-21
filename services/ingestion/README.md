# Dashboard Ingestion Service

This internal loopback service owns local source queuing, webpage capture, video transcription, review decisions, and approved Raw publication. It has no standalone frontend; Dashboard reaches it through `/api/ingestion/*`.

The service writes runtime queue data outside the repository. Publishing is a separate confirmed action after approval and writes one Markdown file to `04-来源资料/视频` or `04-来源资料/网页`. Source media and raw HTML snapshots remain outside the Vault.

Web capture accepts public `http` and `https` pages only. It rejects credentials in URLs, credential-like query parameters, non-standard ports, localhost, private/link-local/reserved addresses, unsafe redirects, non-HTML responses, and documents larger than 5 MB. It does not use browser login state.

Quick capture accepts either a public URL or platform share text containing a public URL. It extracts and de-duplicates the normalized URL while keeping optional tags, the capture reason, and the original share text in the runtime job. After approval, tags and the capture reason are included in the Raw Markdown; the original share text remains outside the Vault.

Douyin capture accepts public share text or links from supported Douyin domains. It follows only Douyin page redirects, extracts public video metadata from the page, downloads the media into that job's Run directory, and reuses the configured local faster-whisper transcription provider. It does not use login state or cloud transcription. Image posts, login/verification pages, and unsupported page structures fail explicitly. Publishing writes reviewed Markdown only; the temporary video is never copied into the Vault.

## AI candidate summary

New jobs require an AI candidate summary before approval. The ingestion service remains provider-neutral: it generates a versioned prompt containing the extracted text or transcript and its SHA-256 hash, validates the reviewed summary, and stores the accepted artifact. The Workbench UI may, only after the user explicitly clicks “生成 AI 总结”, send that prompt to its configured controlled AI Provider and place the result into an editable draft. The draft is never saved automatically. Manual copy/paste to another AI remains the fallback when the configured Provider is unavailable or the user prefers another model.

The saved Markdown must contain these sections in order: `AI 候选摘要`, `核心要点`, `建议标签`, `可复用方向`, and `不确定内容`. It is stored as `candidate-summary.md` in the job Run directory and registered as a `candidate_summary` artifact. Approval remains blocked until the summary is saved. Existing jobs created before this requirement remain compatible.

Publishing is still a separate confirmed action. The Raw Markdown records the summary origin, prompt version, source-content hash, and summary hash, then includes both the candidate summary and the complete transcript or webpage body. A candidate summary is explanatory source material, not formal knowledge. Published jobs cannot replace their saved summary through the ingestion API.

## Development

Create a service-specific virtual environment, install `requirements-dev.txt`, then run:

```text
python -m unittest discover -s tests -v
python run_server.py
```

Use the sanitized variables in `Workbench/.env.example` for local paths. Do not commit the real `.env`, runtime database, logs, source files, or Vault content.

When migrating from the former Workbench service, set `PERSONAL_DASHBOARD_INGESTION_DATABASE_PATH` to its existing `Data/workbench.db`. The schema is upgraded in place with the publication table; back up the runtime directory before moving it between machines.

VAD requires `onnxruntime` in the Python environment selected by `PERSONAL_DASHBOARD_TRANSCRIPTION_PYTHON`. The currently verified Windows combination is Python 3.12, faster-whisper 1.2.1, CTranslate2 4.6.0, and onnxruntime 1.20.1. Dashboard reports this capability through `/api/health`, blocks unavailable VAD before transcription starts, and lets a failed job retry with VAD disabled.
