# CLAUDE.md

Working context for the SuretySeven SDE-1 take-home: a document processing
pipeline with asynchronous extraction, validation, and retries.

`README.md` is the submission document — architecture, API reference, and the
engineering answers. **This file is the build log**: what exists, what is next,
and the decisions worth not re-deriving.

**Last updated:** end of phase 4 (read APIs). Backend complete.

---

## Current state

| Phase | Status | Verified by |
| --- | --- | --- |
| 1. Foundation | **Done** | 3 tests; `docker compose up` healthy |
| 2. Upload + persistence | **Done** | 14 tests; upload + dedupe confirmed via Docker |
| 3. Async processing + retries | **Done** | full lifecycle + crash recovery confirmed via Docker |
| 4. Validation + read APIs | **Done** | 10 tests; all endpoints verified live |
| 5. Testing | **Done enough** | all 6 required scenarios covered; see [Test inventory](#test-inventory) |
| 6. Frontend | Not started | — |
| 7. Deployment + docs | Not started | — |

**59 tests passing, typecheck clean.**

### Verification commands

```bash
cd backend
npm test            # 59 passing
npx tsc --noEmit    # clean
npm run dev         # API on :4000

# Full stack (web service fails until phase 6 — start services explicitly)
UID=$(id -u) GID=$(id -g) docker compose up -d postgres api worker
# After any schema change, add -V --build (see Gotchas)
curl -s localhost:4000/api/health

# Demonstrate a path on command: filename hints beat the hash-seeded draw.
curl -X POST localhost:4000/api/documents \
  -F documentType=FINANCIAL_STATEMENT -F file=@timeout.pdf
```

---

## What works today

Grouped by the phase that built it, so a resumed session knows what it can rely
on without re-reading the source.

### Phase 1 — foundation

- **`GET /api/health`** (`routes/health.routes.ts`) — database reachability plus
  queue depth. Depth is reported because "is anything stuck?" is the first
  question when documents stop progressing.
- **Config fails fast** (`config/env.ts`) — Zod parses `process.env` once at
  boot and exits on anything invalid, rather than discovering a missing variable
  midway through processing a document.
- **`buildApp()` / `listen()` split** (`app.ts`, `server.ts`) — what lets
  Supertest drive the full middleware stack without binding ports.
- **Error envelope** (`middleware/error-handler.ts`) — one terminal 4-arg
  handler maps the `AppError` hierarchy to status codes; anything unrecognised
  becomes a generic 500 with the cause logged only. Correlation ids come from
  `AsyncLocalStorage` in `middleware/request-context.ts`.
- **Data model** (`prisma/schema.prisma`) — `documents` + append-only
  `document_events`. Events are never updated or deleted, so history cannot
  drift from current state.

### Phase 2 — upload and persistence

- **`POST /api/documents`** (`services/documents.service.ts`) — multipart via
  multer memory storage, 10MB cap.
- **Magic-byte PDF check** — the file must start with `%PDF-`. The declared
  `Content-Type` is client-controlled and is not trusted.
- **Duplicate detection** — SHA-256 of the bytes, with a unique constraint on
  `content_hash` as the authority. Returns the *original* document as `200` with
  `duplicate: true`; the `P2002` catch path resolves a concurrent race to the
  winner's document rather than failing.
- **Storage behind an interface** (`storage/file-storage.ts`) — disk driver
  only. The interface exists because a deployed filesystem is ephemeral, so an
  S3/R2 driver is a second implementation and no caller change.
- **`GET /api/documents/:id`** (`controllers/documents.controller.ts`) — detail
  shape. Note `result` vs `rejectedData` (see phase 3).
- Documents land in `UPLOADED` with `nextAttemptAt` set, so the worker picks
  them up on its next poll.

### Phase 3 — async processing, validation, retries

- **Full lifecycle, unattended**: upload → claim → `PROCESSED` /
  `VALIDATION_FAILED` / `FAILED`.
- **Postgres queue** (`config/queue.ts`) — atomic `FOR UPDATE SKIP LOCKED`
  claim; concurrent workers never collide. `toDocument()` maps raw columns.
- **Mock processor** (`processing/mock-processor.ts`) — deterministic by content
  hash, filename hints (`*timeout*`, `*invalid*`, `*error*`, `*success*`),
  `MOCK_PROCESSOR_MODE` override. No test depends on chance.
- **Validator** (`processing/validator.ts`) — Zod over extracted fields; one
  message per field, worded for an operator, not a developer.
- **Classifier** (`processing/error-classifier.ts`) — `TIMEOUT`/`ERROR` retry;
  `INVALID_RESULT` does not.
- **Retries** (`services/processing.service.ts`) — 3 attempts, 2s/4s/8s backoff
  with ±25% jitter.
- **Reaper + graceful shutdown** (`worker.ts`) — reclaims documents abandoned in
  `PROCESSING`; `SIGTERM` drains in-flight work.
- **Processing logs** answer "why did DOC-X fail?" — attempt, reason, backoff,
  terminal state, with no document contents.

### Phase 4 — read APIs

The surface the UI is built against. Every endpoint maps to a screen in §8.

- **`GET /documents`** — repeatable `status`/`documentType`, `search`, `from`/`to`,
  `page`/`pageSize` (default 20, **cap 100**), `sort`. Returns
  `{ data, pagination }` with a summary shape, not the full detail row.
- **`GET /documents/stats`** — dashboard counts. Absent statuses are filled in
  as zero so the UI renders a stable set of tiles.
- **`GET /documents/:id/history`** — the §7 shape. `404` for an unknown
  document rather than an empty array, which would be ambiguous.
- **`GET /documents/:id/file`** — the stored PDF, `Content-Disposition: inline`
  for preview rather than download.
- **`POST /documents/:id/retry`** — manual retry, `409` for anything not
  terminally `FAILED`. `VALIDATION_FAILED` is refused with an explanation, not
  just a status code: retrying it would deterministically reproduce the
  rejection. Writes a `MANUAL_RETRY` event and resets the attempt budget.

### Every endpoint, in one place

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | db reachability + queue depth; `503` when down |
| `POST` | `/api/documents` | multipart; `201`, or `200` + `duplicate: true` |
| `GET` | `/api/documents` | filters, search, date range, pagination, sort |
| `GET` | `/api/documents/stats` | **registered before `/:id`** |
| `GET` | `/api/documents/:id` | detail; `result` vs `rejectedData` |
| `GET` | `/api/documents/:id/history` | `404` if the document is unknown |
| `GET` | `/api/documents/:id/file` | PDF, `Content-Disposition: inline` |
| `POST` | `/api/documents/:id/retry` | `409` unless terminally `FAILED` |

---

## Test inventory

59 tests, 6 files. Integration over unit wherever a route exists.

| File | Tests | Covers |
| --- | --- | --- |
| `tests/integration/health.test.ts` | 3 | health envelope, degraded path |
| `tests/integration/upload.test.ts` | 14 | upload, rejections, **duplicates** |
| `tests/integration/processing.test.ts` | 15 | lifecycle, retries, claiming, crash recovery |
| `tests/unit/validator.test.ts` | 9 | each rule + boundaries (`0` passes, `-1` fails) |
| `tests/unit/processing.test.ts` | 8 | classifier, backoff, filename hints |
| `tests/integration/read-api.test.ts` | 10 | filters, pagination boundary, stats routing, retry guards |

### The brief's six required scenarios

| # | Scenario | Where | Status |
| --- | --- | --- | --- |
| 1 | Valid document upload | `upload.test.ts` | Done |
| 2 | Invalid extracted data | `processing.test.ts` → "invalid extracted data" | Done |
| 3 | Successful processing | `processing.test.ts` → "successful processing" | Done |
| 4 | Processor failure | `processing.test.ts` → "processor failure" | Done |
| 5 | Failure then successful retry | `processing.test.ts` → "failure followed by a successful retry" | Done |
| 6 | Same document twice | `upload.test.ts` → "duplicate detection" | Done |

All six are covered, and README's Testing Strategy maps this table to the files
so a reviewer can find them. **No further test work is planned** — see
[Scope discipline](#scope-discipline).

### How the tests avoid flakiness

- `tests/setup.ts` forces `MOCK_PROCESSOR_DELAY_MS=0` and an isolated temp
  `STORAGE_PATH`; outcomes come from filename hints or content hash, never chance.
- Integration tests drive `processDocument` / `processNextDocument` directly
  rather than starting the worker loop — the loop only calls them on a timer,
  and waiting on real timers would be slow and flaky.
- `drainDocument()` in `processing.test.ts` sets `nextAttemptAt` to now between
  attempts, so a retry test does not sleep through the real backoff.
- `vitest.config.ts` pins a single fork: integration tests share one database.

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
├── routes/       index.ts · health.routes.ts · documents.routes.ts  # /stats before /:id
├── controllers/  documents.controller.ts
├── services/     documents.service.ts · processing.service.ts  # the state machine
├── processing/   mock-processor.ts · validator.ts · error-classifier.ts
├── repositories/ documents.repo.ts · events.repo.ts
├── storage/      file-storage.ts      # disk driver behind an interface
├── middleware/   upload · validate · request-context · error-handler · not-found
└── common/       errors.ts · types.ts · async-handler.ts
```

Layering is one-directional: **routes → controllers → services → repositories**.

The empty `packages/shared/` scaffold was removed — types are shared by importing
from `backend/src/common/types.ts`, and a workspace package for one consumer was
ceremony. The frontend will define its own API response types.
Routes never touch the database; services never see `req`/`res`.

---

## Scope discipline

**The constraint: two days, and every line must be explainable in the technical
discussion.** The brief budgets 15–20 hours and says twice that a polished UI
over a weak backend scores lower than the reverse — but the inverse is also
true, and §8 makes the UI *required*. The backend is done. The risk now is
spending remaining time deepening it instead of building the UI.

### Cut, and why

| Removed | Reason |
| --- | --- |
| Postgres storage driver (`bytea` + `file_data` column) | Never enabled in any environment — `STORAGE_DRIVER=disk` everywhere. A second implementation of an interface with one real user. The interface stays; that is the explainable part. |
| `STORAGE_DRIVER` env var | Nothing left to switch between. |
| `TxClient`, `isTerminal`, `CLAIMABLE_STATUSES` | Exported, never called. |
| 9 tests (58 → 49) | Each tested Zod's behaviour, Postgres's behaviour, or something another test already asserted. |
| README "Build Roadmap" | Internal planning. A reviewer wants what exists, not the plan that got there. |

### Deliberately kept

- **`rejectedData`** — not in the brief, but three lines, and the detail view
  needs it to show validation errors beside the values that caused them.
  Explainable in one sentence: rejected data is not a result, but an operator
  still has to see what was read.
- **The reaper** — answers Q15's "what happens if the application crashes during
  processing" directly.
- **Jitter** — one line, and it is the answer to the 1M-documents/day question.
- **Five states** — §4 requires that invalid data not be "marked as
  successfully processed".

### Testing from here

Decided deliberately, not by default: **the backend is tested, the UI is not.**

- **Phase 4: done** — 10 tests, written *with* the endpoints. Estimated ~6; the
  retry and file endpoints each needed a success *and* a rejection case. They
  target where the bugs hide (`req.query` is a getter in Express 5; repeatable
  params; the `pageSize` cap; the `/stats` route-order trap) — all invisible in
  a browser, where page 2 looks fine even when it silently skips a row.
- **UI: no automated tests.** Manual verification. The brief does not ask for
  frontend tests and a Playwright setup would cost hours the UI itself needs.
- **Then stop.** 59 tests is the submission number unless something breaks.

The reason they are written alongside rather than at the end: deferred tests
land in the final hours competing with deployment, `AI_USAGE.md` and the
architecture diagram, and §13 makes them a graded requirement. The risk is not
that late tests are worse — it is that they do not get written.

### The rule from here

Build what §8 and §11 require, then stop. Before adding anything to the backend,
ask: *does the UI need this, or does the brief name it?* If neither, it does not
go in. Depth in the half nobody sees is the expensive mistake.

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

### One storage driver, kept behind an interface
The postgres/`bytea` driver was deleted: it was never enabled anywhere, and
storing file bytes in the document row is the wrong answer at real volume
regardless. `FileStorage` stays an interface because that is the part worth
defending — an S3 driver slots in without touching a caller.

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
- **Docs move with the code.** Every change updates **both** files in the same
  commit as the change itself, never as a catch-up pass afterwards:
  - **`CLAUDE.md`** — the build log. Current state, test counts, what the new
    code does and why, any gotcha hit on the way, and what is next.
  - **`README.md`** — the submission document. The API reference, the
    architecture, the engineering answers, and the deliverables list.

  A change that touches an endpoint, a status, a schema, an env var or a test
  count has almost certainly invalidated a line in one of them. Check rather
  than assume: an audit of these two files found a fabricated log example, two
  libraries named in the stack but never installed, a directory that did not
  exist, and an engineering answer describing a guard the code does not have.
  Every one of those came from letting the docs lag a commit.

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
- **A schema change needs `docker compose up -d -V --build`.** `prisma generate`
  runs at *image build* time into the container-only `node_modules` volume, and
  Docker populates an anonymous volume only when it first creates it — so a
  plain `--build` leaves the **old** generated client in place and every query
  fails with "the column `documents.x` does not exist". `-V` renews the
  anonymous volumes. Do *not* "fix" this by running `prisma generate` in the
  container's start command: the volume is root-owned from the image build, and
  a container running as the host user gets `EACCES` trying to rewrite it.
- **`$queryRaw` returns raw snake_case columns, not Prisma's camelCase.** The
  claim statement must be raw (`FOR UPDATE SKIP LOCKED` has no query-builder
  form), so its result is *not* a `Document`: `attempt_count` arrives, and
  `document.attemptCount` reads `undefined`. This failed silently and
  nonsensically — every document went terminal on attempt 1 with
  `ATTEMPTS_EXHAUSTED`, because `undefined < 3` is false. `toDocument()` in
  `config/queue.ts` is the one place the column names are allowed to exist.

---

## Next: phase 6 — the frontend

**The backend is done. Nothing more goes into it** — see
[Scope discipline](#scope-discipline). Remaining time belongs to the UI, which
§8 makes a requirement and §10 rewards.

Next.js 15 App Router, `frontend/`. Four screens, each backed by an endpoint
that already exists and is verified:

| Route | Endpoint | Contents |
| --- | --- | --- |
| `/` | `GET /documents/stats` | Dashboard tiles: total, in progress, processed, failed |
| `/upload` | `POST /documents` | File picker, type selector, optional metadata; explicit success / failure / **duplicate** states |
| `/documents` | `GET /documents` | Table with status + type filters, search, pagination |
| `/documents/[id]` | detail + `/history` + `/file` | Info, extracted fields, validation errors, timeline, PDF preview, manual retry |

Notes worth having before starting:

- **Filter state belongs in the URL** (`?status=FAILED&page=2`), so a view is
  shareable and survives a refresh. The API takes repeatable params, which maps
  onto `URLSearchParams` directly.
- **Poll while anything is non-terminal.** A document in `UPLOADED`,
  `RETRY_PENDING` or `PROCESSING` will change without user action; stop polling
  once every row is terminal so an idle tab is not hitting the API forever.
- **The timeline is the showpiece.** `GET /:id/history` already returns
  attempt-numbered events including `MANUAL_RETRY`, which renders as the
  §8C "✓ Uploaded → ✕ Failed → ✓ Retried → ✓ Processed" story directly.
- **`rejectedData` exists for the detail view** — show the extraction that
  failed beside the errors that rejected it.
- **Never render `error.message` from a 500.** The envelope's `code` is what the
  UI branches on; §9 forbids exposing raw backend errors.
- **No frontend tests** — decided in [Testing from here](#testing-from-here).

**Done when:** a user can upload a document, watch it process, filter for it,
and understand why it failed — without reading a single API response.

### Then

- **Phase 7:** Neon + Render + Vercel (all free, no card); `docs/architecture.png`;
  `AI_USAGE.md`.

---

## Before submitting

- [ ] `AI_USAGE.md` — tools used, what was generated, what was **changed or
      rejected** (the Prisma 7 rejection and the BullMQ rejection are good
      material: both were AI suggestions overturned by checking real constraints)
- [ ] `docs/architecture.png`
- [ ] Verify a clean clone runs with `docker compose up`
- [ ] Note the Render cold-start delay next to the live demo link
- [ ] Keep README's engineering answers in sync with what the code actually does
      — this should already be true if [Conventions](#conventions) was followed;
      treat a discrepancy found here as a sign the habit slipped
- [ ] Re-read README end to end once the UI exists — the Frontend section
      currently describes what is being built, and must describe what shipped.
