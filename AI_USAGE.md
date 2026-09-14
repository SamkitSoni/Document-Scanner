# AI Usage

Required by section 16 of the assignment. This is an honest account of where AI
was used, what it produced, and — more usefully — what it got wrong and how that
was caught.

---

## Tools used

| Tool | Used for |
| --- | --- |
| **Claude (Claude Code)** | The main tool. Scaffolding, first drafts of most modules, the frontend, test cases, and documentation. Run as an agent with shell access, so it could run the tests and containers it was reasoning about. |

No other AI tools were used.

---

## What AI was used for

- **Scaffolding and boilerplate.** Project structure, Docker Compose, the Prisma
  schema, Express wiring, Tailwind setup. This is where it saved the most time
  and where the output needed the least correction.
- **First drafts of most modules.** The retry/backoff logic, the error
  classifier, the validator, the mock processor, and all four frontend screens
  started as generated drafts.
- **Test cases.** Particularly the boundary cases — `annualRevenue: 0` passing
  while `-1` fails, a date matching the pattern but not being a real calendar
  date. Prompting for "the boundaries of each rule" produced cases worth keeping.
- **Documentation.** README and CLAUDE.md drafts, and the architecture diagram
  (authored as SVG and rendered to PNG).
- **Rubber-ducking design decisions.** Queue choice, state modelling, duplicate
  detection strategy. Useful for enumerating options; the decisions themselves
  are argued in the README on their merits.

---

## Significant AI-generated code

Most of the codebase began as an AI draft. The parts that survived closest to
their generated form:

- The **`FOR UPDATE SKIP LOCKED` claim statement**. This is a well-established
  pattern (Que, Oban, River, GoodJob all use it) and the generated version was
  correct. I verified the concurrency claim with a test that runs two claims
  against one row rather than trusting it.
- The **error-handler middleware** and the `AppError` hierarchy.
- **Layout and styling** across the frontend — Tailwind class soup is exactly
  the kind of work worth generating.
- The **validator's Zod schema**, though the *messages* were rewritten (see
  below).

I can explain every file in this repository. Where I could not explain
something, it was removed rather than left in — which is how several modules
came to be deleted (see "Trim scope" in the commit history).

---

## AI output I changed or rejected

This is the part worth reading. Four cases, each caught differently.

### 1. Rejected: Prisma 7 (caught by checking, not by testing)

The suggestion was to use the latest Prisma. Prisma 7 makes the CLI a runtime
dependency of `@prisma/client`, which pulls `mysql2` and two high-severity
advisories into the **production** dependency tree of a Postgres-only project.
Every 7.x release does this.

Pinned to 6.x. Nothing in the tests would have caught this — it took actually
reading what the dependency change pulled in.

### 2. Rejected: BullMQ + Redis (caught by checking hosting constraints)

The default recommendation for "async job processing in Node" is BullMQ on
Redis, and it was suggested confidently. It is a bad fit here:

- Render's free Key Value instance has **no persistence** and loses queued jobs
  on restart.
- Upstash's free plan bills per command, and BullMQ polls Redis continuously
  even when idle — an always-on worker would burn the monthly budget doing
  nothing.

Postgres-as-queue keeps durability, backoff, concurrency and crash recovery,
and makes claiming a job and updating document state the *same transaction*.
The generated answer was the industry-standard one; it was still wrong for this
project's actual constraints.

### 3. Changed: validation messages written for developers

The generated validator emitted Zod's defaults — `String must contain at least
1 character(s)`. These are shown directly in the document detail view, so they
were rewritten for the person reading them: *"Registration number is missing."*

The `rule` identifier was kept stable and separate from the message, so the UI
and logs can group by rule even when the wording changes.

### 4. Changed: the date validator reported two errors for one problem

The generated `documentDate` rule chained `.regex().refine()`, so a malformed
date produced both "must be YYYY-MM-DD" *and* "is not a real calendar date".
Rewritten with `superRefine` to report one thing at a time — an operator should
be told what is wrong with a field, not given two overlapping complaints.

---

## What I learned reviewing AI output

**Confident and wrong is the common failure mode.** The BullMQ and Prisma 7
suggestions were both delivered without hedging, and both were defensible in
general — they were wrong *here*, for reasons only visible after checking the
actual hosting and dependency constraints. The useful habit was asking "what
does this assume?" rather than "is this idiomatic?".

**Generated tests assert what the code does, not what it should do.** Several
first-draft tests restated the implementation — asserting Zod's behaviour or
Postgres's behaviour rather than this system's rules. Nine such tests were
deleted. A test that cannot fail for an interesting reason is a maintenance cost
with no benefit.

**Two bugs AI wrote that only real execution caught**, both of which typecheck
cleanly and return `200`:

1. **The raw-SQL casing bug.** The claim query has to be raw (`FOR UPDATE SKIP
   LOCKED` has no query-builder form), so it returns Postgres's snake_case
   columns rather than Prisma's camelCase mapping. `document.attemptCount` read
   `undefined`, and since `undefined < 3` is false, *every* document went
   terminal on its first attempt. Only an assertion on `attemptCount` after a
   retry exposed it.

2. **The PDF preview blocked by its own security headers.** Helmet sets
   `frame-ancestors 'self'`, so the detail view's cross-origin `<object>` embed
   was refused. The request returned `200` and the frame rendered empty — not
   visible in the API response, in the tests, or in `curl`. It took driving the
   page in a real browser to see it, and the fix (narrowing the policy for that
   one route) now has a test.

The general lesson: **AI is good at the code and bad at knowing whether the code
actually works in its environment.** Running it — the real containers, a real
browser — is what found the defects that review did not.

---

## What was written without AI

- Every decision recorded in the README's *Design Decisions* and *Engineering
  Questions*, including the argument for five states rather than four.
- The scope cuts — which modules were deleted, and why depth in an unused
  abstraction is a cost rather than a virtue.
- The judgement calls about what to verify and how, which is where most of the
  defects above were found.
