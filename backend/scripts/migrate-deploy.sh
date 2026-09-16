#!/bin/sh
# Applies pending migrations, then the caller starts the server.
#
# Two deployment-specific settings, both about Prisma's migration advisory lock:
#
# 1. DIRECT_DATABASE_URL. Prisma takes a session-scoped advisory lock around
#    `migrate deploy`. Neon's pooled host (`-pooler`, pgbouncer) hands sessions
#    to shared backends, so the lock can be released on a different backend
#    than took it — it then outlives the migration, pgbouncer recycles that
#    backend into the pool, and the running app holds the lock open
#    indefinitely. Every later deploy waits 10s and fails with P1002.
#
# 2. PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK. The lock only guards against two
#    migrations racing. This service runs a single instance, so that race
#    cannot happen, while the leak above demonstrably can. Skipping the lock
#    removes the failure mode rather than working around it. Revisit if this
#    ever scales past one instance, where an ordered release would be needed.
#
# With DIRECT_DATABASE_URL unset (local, docker compose) DATABASE_URL is used
# as-is: no pooler is involved there.
set -e

export PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=true

if [ -n "$DIRECT_DATABASE_URL" ]; then
  echo "migrate: using DIRECT_DATABASE_URL (bypassing the pooler)"
  DATABASE_URL="$DIRECT_DATABASE_URL" prisma migrate deploy
else
  echo "migrate: using DATABASE_URL"
  prisma migrate deploy
fi
