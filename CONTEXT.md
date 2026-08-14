# Personal AI Dashboard

Personal AI Dashboard is the single local product for collecting source material and reading the resulting knowledge base.

## Language

**Dashboard**:
The sole user-facing product and main interface for the personal knowledge workflow.
_Avoid_: Workbench, separate ingestion app

**Ingestion Service**:
The internal capability that queues sources, transcribes media, records review decisions, and publishes approved source material.
_Avoid_: Workbench backend, standalone service product

**Raw Publication**:
Reviewed source material explicitly added to the source layer of the knowledge base. It is evidence, not formal knowledge.
_Avoid_: Formal knowledge, Wiki publication

**Knowledge View**:
The read-only index, search, and reader for the connected knowledge base.
_Avoid_: Vault editor, publisher
