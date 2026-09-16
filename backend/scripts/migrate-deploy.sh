#!/bin/sh
# Applies pending migrations before the server starts.
#
# Migrations run over DIRECT_DATABASE_URL when it is set, because Prisma guards
# `migrate deploy` with a session-scoped advisory lock and a connection pooler
# (Neon's `-pooler` host, pgbouncer) can release that lock on a different
# backend than the one that took it. The lock then outlives the migration and
# every subsequent deploy fails with P1002. The app itself still connects via
# the pooled DATABASE_URL, which is what a pooler is for.
#
# When DIRECT_DATABASE_URL is unset (local, docker compose) DATABASE_URL is
# used as-is: there is no pooler in front of those databases.
set -e

if [ -n "$DIRECT_DATABASE_URL" ]; then
  echo "migrate: using DIRECT_DATABASE_URL (bypassing the pooler)"
  DATABASE_URL="$DIRECT_DATABASE_URL" prisma migrate deploy
else
  echo "migrate: using DATABASE_URL"
  prisma migrate deploy
fi
