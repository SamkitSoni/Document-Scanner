# AI Usage

Required by section 16 of the assignment: where AI was used, what it produced,
and how its output was verified before it shipped.

**Summary.** I used Claude Code as an implementation tool throughout — it wrote
first drafts of most modules, the frontend, and the test cases. I made the
architectural decisions, set the verification standard, and reviewed everything
that landed. Four significant suggestions were overruled after checking them
against this project's real constraints, and I can explain every file in the
repository.

---

## Tools used

| Tool | Used for |
| --- | --- |
| **Claude Code** | Scaffolding, first drafts of most modules, the frontend, test cases, documentation. Run with shell access, so it could execute the tests and containers it was reasoning about. |

No other AI tools were used.

---

## Where it was used, and how much survived

| Area | AI contribution | What I did |
| --- | --- | --- |
| Scaffolding — project structure, Compose, Prisma schema, Express wiring, Tailwind | High; little correction needed | Reviewed and accepted |
| The `FOR UPDATE SKIP LOCKED` claim | Generated, essentially unchanged | Verified with a test running two concurrent claims against one row, rather than trusting the pattern |
| Retry/backoff, error classifier, validator, mock processor | First drafts | Restructured; rewrote every user-facing message |
| All four frontend screens | First drafts, plus the Tailwind styling | Kept the layout work, rewrote the state and polling logic |
| Test cases | Strong on boundaries (`annualRevenue: 0` passes, `-1` fails) | Deleted nine that asserted Zod's or Postgres's behaviour rather than this system's rules |
| Architecture, state model, queue choice, scope | Used to enumerate options | Decided and argued myself — see [Design Decisions](docs/TECHNICAL.md#design-decisions) |

Where I could not explain something, it was removed rather than left in. That is
how several modules came to be deleted — see `759d0f1 Trim scope to what the
assignment asks for`.

---

## Four suggestions I overruled

Each was the conventional answer, and each was wrong for this project. These are
the decisions I would most want to discuss.

### 1. Prisma 7 → pinned to 6.x

The suggestion was to use the latest Prisma. Prisma 7 makes the CLI a runtime
dependency of `@prisma/client`, pulling `mysql2` and two high-severity
advisories into the **production** dependency tree of a Postgres-only project.
Every 7.x release does this.

No test would have caught this. It took reading what the dependency change
actually pulled in.

### 2. BullMQ + Redis → Postgres as the queue

The standard recommendation for async jobs in Node, suggested confidently. It
does not fit the constraints:

- Render's free Key Value instance has **no persistence** — it loses queued jobs
  on restart.
- Upstash's free plan bills per command, and BullMQ polls continuously even when
  idle, so an always-on worker would burn the monthly budget doing nothing.

Postgres-as-queue keeps durability, backoff, concurrency and crash recovery, and
makes claiming a job and updating document state the *same transaction*.

### 3. Validation messages written for developers

The generated validator emitted Zod's defaults — `String must contain at least 1
character(s)`. These render directly in the detail view, so I rewrote them for
the person reading them: *"Registration number is missing."* The `rule`
identifier stays stable and separate from the message, so the UI and logs can
group by rule even when wording changes.

### 4. `directUrl` — the documented fix that would have broken local development

When deployment hit a migration-locking problem (below), Prisma's documented
answer is the `directUrl` datasource field. It hard-errors when its environment
variable is unset, which would have broken `docker compose` for anyone cloning
the repo, where there is no connection pooler to work around. I backed it out in
favour of a shell script that falls back cleanly, and left a comment in
`schema.prisma` explaining why not to re-add it.

---

## How I verified the work

The interesting defects were not type errors or failing tests — they were code
that compiled, returned `200`, and was wrong. Three examples, and what caught
each:

**A raw-SQL casing bug, caught by asserting state after a retry.** The claim
query must be raw (`FOR UPDATE SKIP LOCKED` has no query-builder form), so it
returns Postgres's snake_case columns rather than Prisma's camelCase mapping.
`document.attemptCount` read `undefined`, and since `undefined < 3` is false,
*every* document went terminal on its first attempt. Retries were silently dead.
Only an assertion on `attemptCount` after a retry exposed it; `toDocument()` now
isolates the mapping in one place.

**A PDF preview blocked by its own security headers, caught in a browser.**
Helmet sets `frame-ancestors 'self'`, so the detail view's cross-origin
`<object>` embed was refused. The request returned `200` with correct bytes and
the frame rendered empty — invisible in the API response, the tests, and `curl`.
I found it by driving the page in headless Chromium against the running stack,
which is also how the mobile-overflow and column-width issues surfaced. The fix
narrows the policy for that one route and has a test.

**A migration that leaked a database lock, caught by querying `pg_locks`.**
Deploying to Render, migrations had to run at container start (the free plan has
no pre-deploy hook, and a Dockerfile build makes the dashboard's build command a
no-op). That worked on the first deploy and failed on the next with `P1002:
timed out trying to acquire a postgres advisory lock`. Prisma's migration lock is
session-scoped, and Neon's pooled endpoint can release it on a different backend
than acquired it — so the lock leaks and the running application holds it open.
The diagnosis came from inspecting the lock holder: a pgbouncer session running
the *worker's* UPDATE, not a migration at all. Migrations now run over a direct
connection, and I reproduced the failure deliberately — holding the lock in a
background session — to confirm the fix rather than trusting one green deploy.

Each of these is documented where the next person will hit it, so the knowledge
lives with the code rather than in my memory.

---

## What I take from it

**The generated code is usually fine; the assumptions behind it are what need
checking.** BullMQ and Prisma 7 were both delivered without hedging and both
defensible in general — they were wrong *here*, for reasons only visible after
checking this project's hosting and dependency constraints. The useful question
was "what does this assume?", not "is this idiomatic?".

**Verification has to run in the real environment.** Tests and typechecks pass on
code that is broken in a browser or on a deployed host. Two of the defects above
survived review and a passing suite; what found them was a real browser and a
real deploy. One survived a green verification run, because that run only
exercised the path that worked the first time.

**Speed is not the same as understanding.** Generating a module takes seconds;
being able to defend it takes reading it. I treated anything I could not explain
as a liability and deleted it, which is why the final codebase is smaller than
what was generated.

---

## What I wrote without AI

- Every decision in [Design Decisions](docs/TECHNICAL.md#design-decisions) and
  [Engineering Questions](docs/TECHNICAL.md#engineering-questions), including
  the argument for five states rather than four.
- The scope cuts — which modules were deleted, and why depth in an unused
  abstraction is a cost rather than a virtue.
- The verification strategy: what to check, in which environment, and what
  counts as evidence. That is where most of the defects above were found.
