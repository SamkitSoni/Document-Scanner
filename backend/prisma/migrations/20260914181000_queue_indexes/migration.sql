-- Partial index on the queue's hot path: the worker's claim query only ever
-- looks at documents that are claimable and due. Indexing just those rows keeps
-- the index small regardless of how many processed documents accumulate.
CREATE INDEX IF NOT EXISTS "documents_claimable_idx"
  ON "documents" ("next_attempt_at")
  WHERE "status" IN ('UPLOADED', 'RETRY_PENDING');

-- Supports the stale-job reaper, which scans for leases that have expired.
CREATE INDEX IF NOT EXISTS "documents_locked_idx"
  ON "documents" ("locked_at")
  WHERE "status" = 'PROCESSING';

-- Trigram index for case-insensitive filename search (requirement 11).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "documents_filename_trgm_idx"
  ON "documents" USING gin ("filename" gin_trgm_ops);
