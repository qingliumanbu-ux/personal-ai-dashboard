# Unify ingestion in Dashboard

Dashboard is the only user-facing product and repository. The proven Python transcription queue remains an internal Ingestion Service because rewriting it in Node would add migration risk without user value; its standalone frontend is retired, and all review and publication actions are exposed through Dashboard. The former Workbench repository is retained locally as rollback material and its GitHub repository is archived only after migration verification.
