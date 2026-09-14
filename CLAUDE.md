# CLAUDE.md

Working context for the SuretySeven SDE-1 take-home: a document processing
pipeline with asynchronous extraction, validation, and retries.

`README.md` is the submission document — architecture, API reference, and the
engineering answers. **This file is the build log**: what exists, what is next,
and the decisions worth not re-deriving.

**Last updated:** end of phase 3 (async processing and retries).

---

## Current state

| Phase | Status | Verified by |
| --- | --- | --- |
| 1. Foundation | **Done** | 3 tests; `docker compose up` healthy |
| 2. Upload + persistence | **Done** | 14 tests; upload + dedupe confirmed via Docker |
| 3. Async processing + retries | **Done** | 41 tests; full lifecycle + crash recovery confirmed via Docker |
| 4. Validation + read APIs | Partial — validation done; read APIs pending | — |
| 5. Testing | Partial (58 tests) | 5 of 6 required scenarios covered |
| 6. Frontend | Not started | — |
| 7. Deployment + docs | Not started | — |

**58 tests passing, typecheck clean.**

### Verification commands

```bash
cd backend
npm test            # 58 passing
npx tsc --noEmit    # clean
npm run dev         # API on :4000

# Full stack (web service fails until phase 6 — start services explicitly)
UID=$(id -u) GID=$(id -g) docker compose up -d postgres api worker
curl -s localhost:4000/api/health

# Demonstrate a path on command: filename hints beat the hash-seeded draw.
curl -X POST localhost:4000/api/documents \
  -F documentType=FINANCIAL_STATEMENT -F file=@timeout.pdf
```

---

## What works today

- `GET /api/health` — database reachability plus queue depth
- `POST /api/documents` — multipart upload, magic-byte PDF check, metadata
  parsing, SHA-256 hashing, duplicate detection, transactional document+event write
- `GET /api/documents/:id` — full detail shape
- Structured error envelope with correlation ids; no raw errors reach clients
- **Full async lifecycle**: upload → worker claims → `PROCESSED` /
  `VALIDATION_FAILED` / `FAILED`, unattended
- Postgres queue: atomic `FOR UPDATE SKIP LOCKED` claim, concurrent workers
  never collide
- Retries: 3 attempts, 2s/4s/8s backoff with ±25% jitter, classifier decides
  what is worth retrying
- Stale-job reaper reclaims documents abandoned in `PROCESSING`; graceful
  shutdown drains in-flight work
- Processing logs answer "why did DOC-X fail?" — attempt, reason, backoff,
  terminal state, with no document contents

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
├── worker.ts                    # poll loop (concurrency slots) + reaper + drain-on-SIGTERM
├── app.ts                       # buildApp() — no listen(), so Supertest can drive it
├── config/       env.ts · logger.ts · db.ts · queue.ts   # queue.ts = the Postgres JobQueue
├── routes/       index.ts · health.routes.ts · documents.routes.ts
├── controllers/  documents.controller.ts
├── services/     documents.service.ts · processing.service.ts  # the state machine
├── processing/   mock-processor.ts · validator.ts · error-classifier.ts
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
- **`$queryRaw` returns raw snake_case columns, not Prisma's camelCase.** The
  claim statement must be raw (`FOR UPDATE SKIP LOCKED` has no query-builder
  form), so its result is *not* a `Document`: `attempt_count` arrives, and
  `document.attemptCount` reads `undefined`. This failed silently and
  nonsensically — every document went terminal on attempt 1 with
  `ATTEMPTS_EXHAUSTED`, because `undefined < 3` is false. `toDocument()` in
  `config/queue.ts` is the one place the column names are allowed to exist.

---

## Next: phase 4 — read APIs

Validation landed with phase 3 (`processing/validator.ts` → `VALIDATION_FAILED`),
so what remains of phase 4 is the read surface the UI needs:

1. **`GET /documents`** — list with `status` / `documentType` (both repeatable),
   `search`, `from`/`to`, `page`/`pageSize` (default 20, cap 100), `sort`.
   `documents.repo.list()` already implements the query; it needs a controller,
   a Zod query schema and the `{ data, pagination }` envelope.
2. **`GET /documents/:id/history`** — `events.repo.listForDocument()` exists;
   map it to `{ status, timestamp, attempt, reason }`.
3. **`GET /documents/stats`** — `countByStatus()` exists; the dashboard needs it.
4. **`GET /documents/:id/file`** — stream the PDF for the preview.
5. **`POST /documents/:id/retry`** — manual retry. `resetForManualRetry()` is
   written; it needs the `409` guard for a document that is not terminally
   `FAILED`.

Note the route-order trap: `/documents/stats` must be registered **before**
`/documents/:id`, or `stats` is parsed as an id and rejected by the id regex.

**Done when:** the UI could be built against the API without further backend work.

### Then

- **Phase 5:** one test file naming the six required scenarios explicitly. Five
  are already covered by `tests/integration/processing.test.ts`; the sixth
  (same document twice) lives in `upload.test.ts`. The gap worth closing is
  list/filter/pagination coverage once phase 4 lands.
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
- [ ] README documents the detail response as `result: null` on failure; the
      implementation also returns `rejectedData` (the extraction that failed
      validation, kept so an operator can see what was read). Update the API
      reference to match.
