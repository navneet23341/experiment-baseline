# Handoff

## Built

All three spec chunks are implemented.

- **Chunk 1 — Foundation:** TypeScript and Express app, PostgreSQL pool, `/health` endpoint, `node-pg-migrate`, and Project, Phase, Task, and Memory schema. The migrations enable pgvector and define the memory enums and fields.
- **Chunk 2 — Memory Store Core:** Direct-call memory create/read/list/update/delete functions and manual supersession. FAILURE and OBSERVATION memories get semantic hashes and deduplicate within a task.
- **Chunk 3 — Lifecycle:** Project, Phase, and Task CRUD; task state transitions; and structured, task-linked handoffs with completed items, remaining items, current issue, and next action.

The migrations have been applied to `experiment_baseline_db`. Do not use the separate `agentrelay` database for this repository. The local `.env` contains the connection string and is ignored by Git; credentials are intentionally not recorded here.

## Design decisions

- **Dedup normalization:** Normalize content with Unicode NFKC, trim leading and trailing whitespace, lowercase, and collapse whitespace. Preserve punctuation and wording to avoid merging distinct observations. Hash the normalized text with SHA-256. Deduplication applies only to FAILURE and OBSERVATION memories with a task ID and an ACTIVE memory row.
- **Race safety:** A partial unique index covers `(task_id, type, semantic_hash)` for active FAILURE and OBSERVATION memories. Insert uses `ON CONFLICT` to increment `hit_count` and refresh `last_seen_at` atomically. Superseded rows leave the index, allowing a later active memory with the same hash.
- **Task transitions:**
  - TODO → IN_PROGRESS, CANCELLED
  - IN_PROGRESS → BLOCKED, COMPLETED, FAILED, CANCELLED
  - BLOCKED → IN_PROGRESS, FAILED, CANCELLED
  - FAILED → TODO, IN_PROGRESS, CANCELLED
  - COMPLETED and CANCELLED are terminal

  Transitions lock the task row before checking and updating its state.
- **Handoffs:** Handoffs are stored as records linked to a task. Completed and remaining items are JSON arrays; `getLatestHandoff` retrieves the newest record.

## Verification

- `npm run build` passes.
- `npm test` passes: 2 database-backed tests covering memory CRUD, concurrent deduplication, task scoping, supersession, Phase/Task CRUD, legal and illegal transitions, handoffs, and cleanup.

## Not done yet

- There are no HTTP routes for project, phase, task, memory, or handoff operations; those features are available through direct TypeScript function calls. Express currently exposes only `/health`.
- Embeddings can be stored in pgvector, but this project does not generate embeddings or implement similarity search.
- API input validation and authentication are not implemented.

## Next step

Add validated HTTP routes over the existing service functions, keeping the direct-call layer as the source of business rules. Then add route-level tests.
