# Dashboard Ingestion Service

This internal loopback service owns local source queuing, webpage capture, video transcription, review decisions, and approved Raw publication. It has no standalone frontend; Dashboard reaches it through `/api/ingestion/*`.

The service writes runtime queue data outside the repository. Publishing is a separate confirmed action after approval and writes one Markdown file to `04-来源资料/视频` or `04-来源资料/网页`. Source media and raw HTML snapshots remain outside the Vault.

Web capture accepts public `http` and `https` pages only. It rejects credentials in URLs, credential-like query parameters, non-standard ports, localhost, private/link-local/reserved addresses, unsafe redirects, non-HTML responses, and documents larger than 5 MB. It does not use browser login state.

## Development

Create a service-specific virtual environment, install `requirements-dev.txt`, then run:

```text
python -m unittest discover -s tests -v
python run_server.py
```

Use the sanitized variables in `Workbench/.env.example` for local paths. Do not commit the real `.env`, runtime database, logs, source files, or Vault content.

When migrating from the former Workbench service, set `PERSONAL_DASHBOARD_INGESTION_DATABASE_PATH` to its existing `Data/workbench.db`. The schema is upgraded in place with the publication table; back up the runtime directory before moving it between machines.

VAD requires `onnxruntime` in the Python environment selected by `PERSONAL_DASHBOARD_TRANSCRIPTION_PYTHON`. The currently verified Windows combination is Python 3.12, faster-whisper 1.2.1, CTranslate2 4.6.0, and onnxruntime 1.20.1. Dashboard reports this capability through `/api/health`, blocks unavailable VAD before transcription starts, and lets a failed job retry with VAD disabled.
