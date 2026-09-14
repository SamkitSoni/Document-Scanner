# CLAUDE.md

Working context for the SuretySeven SDE-1 take-home: a document processing
pipeline with asynchronous extraction, validation, and retries.

`README.md` is the submission document — architecture, API reference, and the
engineering answers. **This file is the build log**: what exists, what is next,
and the decisions worth not re-deriving.

**Last updated:** end of phase 2 (commit `7c79ed8`).

---

## Current state

| Phase | Status | Verified by |
| --- | --- | --- |
| 1. Foundation | **Done** | 3 tests; `docker compose up` healthy |
| 2. Upload + persistence | **Done** | 14 tests; upload + dedupe confirmed via Docker |
| 3. Async processing + retries | Not started | — |
| 4. Validation + read APIs | Not started | — |
| 5. Testing | Partial (17 tests) | — |
| 6. Frontend | Not started | — |
| 7. Deployment + docs | Not started | — |

**17 tests passing, typecheck clean.**

### Verification commands

```bash
cd backend
npm test            # 17 passing
npx tsc --noEmit    # clean
npm run dev         # API on :4000

# Full stack (web service fails until phase 6 — start services explicitly)
docker compose up -d postgres api worker
curl -s localhost:4000/api/health
```

---

## What works today

- `GET /api/health` — database reachability plus queue depth
- `POST /api/documents` — multipart upload, magic-byte PDF check, metadata
  parsing, SHA-256 hashing, duplicate detection, transactional document+event write
- `GET /api/documents/:id` — full detail shape
- Structured error envelope with correlation ids; no raw errors reach clients
- Documents land in `UPLOADED` with `nextAttemptAt` set — **nothing consumes them
  yet**; the worker idles until phase 3

---

## Stack

TypeScript · Express 5 · PostgreSQL 16 + Prisma 6 · Zod · pino · Vitest +
Supertest · Next.js 15 (phase 6) · Docker Compose.

**No Redis, no BullMQ** — the queue is Postgres. See [Key decisions](#key-decisions).

---

## Layout

```
backend/src/
├── server.ts                    # API entrypoint
├── worker.ts                    # worker entrypoint (idles; phase 3 fills in)
├── app.ts                       # buildApp() — no listen(), so Supertest can drive it
├── config/       env.ts · logger.ts · db.ts
├── routes/       index.ts · health.routes.ts · documents.routes.ts
├── controllers/  documents.controller.ts
├── services/     documents.service.ts
├── repositories/ documents.repo.ts · events.repo.ts
├── storage/      file-storage.ts      # disk + postgres drivers behind an interface
├── middleware/   upload · validate · request-context · error-handler · not-found
└── common/       errors.ts · types.ts · async-handler.ts
```

Layering is one-directional: **routes → controllers → services → repositories**.
Routes never touch the database; services never see `req`/`res`.

---

## Key decisions

Each of these was reasoned through once; don't relitigate without a new reason.

### Five states, not four
`VALIDATION_FAILED` is separate from `FAILED`. `FAILED` means the *processor*
broke (retryable); `VALIDATION_FAILED` means the processor worked and the
*content* is bad (retrying is pointless — same input, same bad output).
Collapsing them would burn retries on documents that can never succeed.

### Postgres as the queue, not BullMQ
Free Redis is a bad fit: Render's free Key Value has **no persistence** (loses
queued jobs on restart), and Upstash bills per command while BullMQ polls
continuously even when idle. Postgres keeps durability, backoff, concurrency and
crash recovery — and makes claiming a job and updating document state *the same
transaction*. Claim via `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP
LOCKED LIMIT 1)`.

### Duplicates: SHA-256 content hash, unique constraint
Returns the **original** document as `200` with `duplicate: true` — idempotent,
not an error. The constraint is the authority, so concurrent uploads of identical
bytes resolve to one document (a read-then-write check would race). Known limit:
byte-level only; a re-scanned copy is not caught.

### Prisma pinned to 6.x
Prisma 7 makes the CLI a runtime dependency of `@prisma/client`, pulling
`mysql2` and two high-severity advisories into the **production** tree of a
Postgres-only project. Every 7.x release does this. One advisory remains
(`deepmerge-ts` via Prisma's config loader) — dev-only, not reachable at runtime;
the npm "fix" downgrades to an older Prisma with worse problems.

### `buildApp()` never calls `listen()`
Entrypoints listen; the app factory does not. This is what lets Supertest drive
the full middleware stack without binding ports.

---

## Conventions

- **Errors:** throw an `AppError` subclass; the terminal handler maps it. Never
  `res.status(500)` at a call site. Unknown exceptions become a generic 500 with
  the cause logged only.
- **Logging:** structured pino. Log document *field names* and rule ids, never
  extracted values or metadata (those are redacted). Every processing line
  carries `documentId` and `attempt`.
- **Validation:** Zod at the edge. `validate()` puts parsed query on
  `res.locals.query` — Express 5 makes `req.query` a getter.
- **Tests:** integration over unit where a route exists. Tests write to an
  isolated temp `STORAGE_PATH`; never the dev uploads directory.
- **Failure reasons:** stable codes from `FailureReason` in `common/types.ts`,
  never free text.

---

## Gotchas already hit

Do not rediscover these.

- **Root-owned `uploads/`.** Docker volume mounts created it as root → every
  upload failed `EACCES`, locally too. Fixed by running containers as the host
  user, pre-creating the dir in the image as `node`, and isolating test storage.
  If it recurs: `docker compose down -v` and rebuild — a stale volume keeps its
  old ownership even after the compose file is fixed.
- **`.env` is not auto-loaded.** tsx/node need `--env-file-if-exists` (already in
  the npm scripts). Tests load it via `tests/setup.ts`.
- **Prisma `Bytes` ≠ `Buffer`.** Normalize with `new Uint8Array(buf)` at the
  repository boundary.
- **`rootDir` vs tests.** Base tsconfig has no `rootDir`; only
  `tsconfig.build.json` sets it, or including `tests/**` fails to compile.
- **`docker compose up` with no arguments fails** until phase 6 — the `web`
  service points at an empty `frontend/`.

---

## Next: phase 3 — async processing and retries

The interesting phase. Aim:

1. **`JobQueue` interface** (`claimNext`, `complete`, `scheduleRetry`) with the
   Postgres implementation — the atomic `FOR UPDATE SKIP LOCKED` claim.
2. **Mock processor** — deterministic by content hash so tests are reproducible,
   with filename hints (`*timeout*`, `*invalid*`, `*error*`) and a
   `MOCK_PROCESSOR_MODE` override. Never real randomness in tests.
3. **State machine** in `processing.service.ts`: `PROCESSING` → terminal, each
   transition writing document row + event in one transaction.
4. **Error classifier** — `TIMEOUT`/`ERROR` retry; `INVALID_RESULT` does not.
5. **Retry** — 3 attempts, exponential backoff 2s/4s/8s **with jitter** (a burst
   failing together must not retry in lockstep).
6. **Stale-job reaper** — reclaim `PROCESSING` rows past `JOB_LEASE_TIMEOUT_MS`.
7. **Graceful shutdown** — finish in-flight work on `SIGTERM`.

**Done when:** a document moves through the full lifecycle unattended, and a
worker killed mid-processing has its document reclaimed and completed.

### Then

- **Phase 4:** Zod validator over extracted fields → `VALIDATION_FAILED`;
  list/history/stats/file endpoints; filtering, search, pagination; manual retry.
- **Phase 5:** the six required test scenarios named explicitly (upload, invalid
  data, success, processor failure, failure-then-retry, same document twice).
- **Phase 6:** Next.js — dashboard, upload, list, detail with timeline. Only
  after the backend is done: the brief says twice that a polished UI over a weak
  backend scores lower.
- **Phase 7:** Neon + Render + Vercel (all free, no card); `docs/architecture.png`;
  `AI_USAGE.md`.

---

## Before submitting

- [ ] Strip the "planning document" framing and *(planned)* markers from README
- [ ] `AI_USAGE.md` — tools used, what was generated, what was **changed or
      rejected** (the Prisma 7 rejection and the BullMQ rejection are good
      material: both were AI suggestions overturned by checking real constraints)
- [ ] `docs/architecture.png`
- [ ] Verify a clean clone runs with `docker compose up`
- [ ] Note the Render cold-start delay next to the live demo link
- [ ] Keep README's engineering answers in sync with what the code actually does
