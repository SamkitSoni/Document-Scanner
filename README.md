# Document Processing Service

A document ingestion and processing pipeline. Users upload documents, the system
processes them asynchronously with retries and validation, and users can inspect
the extracted data and the full processing history through a web UI.

Built for the SuretySeven SDE-1 take-home assignment.

> **Status:** complete and deployed. Upload, async processing, validation,
> retries, crash recovery, the full read API, and the web UI — with 60 backend
> tests.

| | |
| --- | --- |
| **Live demo** | **https://document-scanner-jet.vercel.app** |
| API | https://document-scanner-api-2g4r.onrender.com/api |
| Health | https://document-scanner-api-2g4r.onrender.com/api/health |

> The API is on Render's free tier and sleeps after 15 minutes idle. **The first
> request takes about 50 seconds** while the service wakes; the UI may show an
> error state until it responds. Reload and it is fast.

---

## Documentation

This file covers what the service is, what it is built with, and how to run it.
Everything else — the architecture, the API reference, the design reasoning and
the engineering answers — is in **[docs/TECHNICAL.md](docs/TECHNICAL.md)**.

| | |
| --- | --- |
| [Architecture](docs/TECHNICAL.md#architecture) | Services, layering, and the diagram |
| [Data Model](docs/TECHNICAL.md#data-model) | Tables, states, and the event log |
| [Processing Lifecycle](docs/TECHNICAL.md#processing-lifecycle) | Claim, process, validate, retry |
| [Design Decisions](docs/TECHNICAL.md#design-decisions) | Why Postgres is the queue, why five states |
| [API Reference](docs/TECHNICAL.md#api-reference) | Every endpoint, with request and response shapes |
| [Frontend](docs/TECHNICAL.md#frontend) | The four screens and how they poll |
| [Observability](docs/TECHNICAL.md#observability) | Logging, correlation ids, health |
| [Testing Strategy](docs/TECHNICAL.md#testing-strategy) | 60 tests, and what they target |
| [Deployment](docs/TECHNICAL.md#deployment) | The live topology and its constraints |
| [Engineering Questions](docs/TECHNICAL.md#engineering-questions) | The assignment's written answers |
| [Limitations](docs/TECHNICAL.md#limitations) | Where the system is thin, stated plainly |

Also in the repository: **[AI_USAGE.md](AI_USAGE.md)** — the AI tooling
disclosure, including what was rejected and why.

---

## Overview

The service accepts a PDF upload along with a document type and optional metadata.
The upload returns immediately; processing happens in the background. A mock
processor extracts structured fields (company name, registration number, annual
revenue, and so on), those fields are validated against business rules, and the
document reaches one of three terminal states: `PROCESSED`, `VALIDATION_FAILED`,
or `FAILED`.

Every state transition is recorded in an append-only event log, so a user can see
exactly what happened to a document — including failed attempts and retries.

### Core capabilities

| Requirement | Approach |
| --- | --- |
| Upload | `POST /api/documents`, multipart, PDF validated by magic bytes |
| Async processing | Postgres-backed job queue, separate worker process |
| Status inspection | `GET /api/documents/:id` with extracted data and failure info |
| Validation | Zod schema over extracted fields, distinct terminal state |
| Retry | 3 attempts, exponential backoff, error-class aware |
| Duplicate detection | SHA-256 content hash, unique constraint, idempotent response |
| History | Append-only `document_events` table |
| Search and filtering | Status, type, date range, filename search, paginated |
| UI | Next.js — dashboard, upload, list, detail with timeline |
| Observability | Structured JSON logs keyed by `documentId` and attempt |
| Testing | 60 tests — unit for rules, integration through the real HTTP stack and database |

---

## Tech Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript | One language across backend and frontend; shared domain types prevent contract drift |
| API | Express 5 | Small, explicit, well understood; Express 5 propagates async errors natively |
| Database | PostgreSQL 16 | Relational data with strong consistency needs; `jsonb` for flexible extracted fields; unique constraints enforce dedupe at the storage layer |
| ORM | Prisma | Typed queries, versioned migrations, schema file doubles as documentation |
| Queue | PostgreSQL (`FOR UPDATE SKIP LOCKED`) | Durable jobs without a second datastore; retry scheduling and backoff as explicit columns; see [the rationale](docs/TECHNICAL.md#why-a-postgres-backed-queue) |
| Validation | Zod | One schema definition reused for request validation, extracted-data validation, and TypeScript types |
| Logging | pino | Structured JSON, low overhead, child loggers for per-document context |
| Frontend | Next.js 15 (App Router) | File-based routing, first-class Vercel deployment. Screens are client components: every view polls or filters live, which is client state either way |
| UI | Tailwind CSS | Utility classes; no component library, so nothing to explain that I did not write |
| Data fetching | `fetch` in client components | Polling while a document is in flight is a `setInterval` and a state update; a cache library would be more to justify than it saves at four screens |
| Testing | Vitest + Supertest | Fast runner; integration tests drive the real HTTP stack and database |
| Local orchestration | Docker Compose | Single-command startup as the assignment suggests |

Everything above is open source and free. See [Deployment](docs/TECHNICAL.md#deployment) for the
hosting choices, which are also free-tier.

---

## Running Locally

### Prerequisites

Docker Desktop with WSL integration enabled, or Node 20+ with a local
PostgreSQL instance.

### With Docker Compose

```bash
git clone <repo-url>
cd Document_processing_pipeline
cp .env.example .env
UID=$(id -u) GID=$(id -g) docker compose up --build
```

| Service | URL |
| --- | --- |
| Frontend | http://localhost:3000 |
| API | http://localhost:4000/api |
| Health | http://localhost:4000/api/health |

Compose starts four services: `postgres`, `api`, `worker`, and `web`. Migrations
run automatically on API startup, and the worker waits for the API's healthcheck
before polling — without that gate it would race the migrations on a fresh
database and exit before the schema exists.

`UID`/`GID` are passed so the containers run as you rather than root — without
them, the bind-mounted `uploads/` directory is created root-owned and every
upload fails with `EACCES`.

To run only the backend (for example when working on the API):

```bash
docker compose up -d postgres api worker
curl -s localhost:4000/api/health
```

> **Note on `UID`/`GID`:** `UID` is a readonly variable in bash, so
> `UID=$(id -u) docker compose …` fails there. The compose file defaults both to
> `1000`, which matches the first user on most Linux systems. If your ids differ
> (`id -u`), export them from a shell that allows it or set them in `.env`.

After a schema change, add `-V --build`: `prisma generate` runs at image build
time into a container-only `node_modules` volume, and Docker does not repopulate
an anonymous volume that already exists, so a plain `--build` would leave the
old client in place.

#### Keeping uploaded documents between sessions

Documents and their files live in two named volumes, `postgres_data` and
`uploads_data`. Stopping the stack keeps both:

```bash
docker compose down     # keeps your documents
docker compose down -v  # DELETES every uploaded document and its file
```

`-v` destroys the volumes. That is what the clean-slate check below is for, and
it is the right command when verifying a fresh start — but run it expecting to
lose everything uploaded so far, because the database is the source of truth and
a stored file with no row is invisible to the application.

### Without Docker

> **A second, separate environment.** Running on the host does not share state
> with Docker: files go to `backend/uploads/` instead of the `uploads_data`
> volume, and `backend/.env` points at a local PostgreSQL rather than the
> `postgres` container. Documents uploaded in one mode never appear in the
> other. `npm test` also truncates whatever database `backend/.env` names, so
> that database must not be one holding documents worth keeping.

```bash
# PostgreSQL must be running locally
cd backend
npm install
npx prisma migrate dev
npm run dev        # API on :4000
npm run dev:worker # worker, separate terminal

cd ../frontend
npm install
npm run dev        # UI on :3000
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | Postgres connection string |
| `PORT` | `4000` | API port |
| `STORAGE_PATH` | `./uploads` | Where uploaded files are written |
| `MAX_UPLOAD_BYTES` | `10485760` | Upload size cap |
| `MAX_PROCESSING_ATTEMPTS` | `3` | Automatic retry budget |
| `WORKER_POLL_INTERVAL_MS` | `1000` | Queue poll interval |
| `WORKER_CONCURRENCY` | `2` | Documents processed in parallel per worker |
| `JOB_LEASE_TIMEOUT_MS` | `120000` | Lease window before the reaper reclaims a job |
| `MOCK_PROCESSOR_MODE` | `random` | Processor behaviour override |
| `MOCK_PROCESSOR_DELAY_MS` | `1500` | Simulated processing latency |
| `RUN_WORKER_IN_PROCESS` | `false` | Run the worker inside the API process |
| `LOG_LEVEL` | `info` | pino level |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed frontend origin |

### Demonstrating each path

```bash
curl -F file=@sample.pdf          -F documentType=FINANCIAL_STATEMENT http://localhost:4000/api/documents
curl -F file=@sample-timeout.pdf  -F documentType=FINANCIAL_STATEMENT http://localhost:4000/api/documents
curl -F file=@sample-invalid.pdf  -F documentType=FINANCIAL_STATEMENT http://localhost:4000/api/documents
```

---

## Deliverables

```
Document_processing_pipeline/
├── README.md                  # this file — overview, stack, running locally
├── AI_USAGE.md                # AI tooling disclosure
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── scripts/
│   │   └── migrate-deploy.sh  # applies migrations before the server starts
│   ├── src/                   # layered as described above
│   └── tests/
│       ├── unit/              # validation rules, classifier, backoff
│       ├── integration/       # health, upload, processing, read API
│       ├── fixtures/
│       └── helpers/
├── frontend/                  # Next.js App Router
│   └── src/
│       ├── app/               # dashboard · upload · list · detail
│       ├── components/        # nav, filters, timeline, toasts, primitives
│       └── lib/               # api client, display mapping, polling hook
└── docs/
    ├── TECHNICAL.md           # architecture, API reference, engineering answers
    ├── architecture.png
    └── architecture.svg       # source for the diagram
```
