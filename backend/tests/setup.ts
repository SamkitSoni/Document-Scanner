/**
 * Loads environment for tests before any module reads it. Node 20.6+ can do
 * this with --env-file, but doing it here keeps the test command portable and
 * lets TEST_DATABASE_URL override the development database.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function loadEnvFile(path: string): void {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return; // absent in CI, where variables come from the environment
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] ??= value;
  }
}

loadEnvFile(resolve(process.cwd(), '.env'));

process.env.NODE_ENV = 'test';

// Tests write uploads to an isolated temp directory: the development uploads
// folder must never be polluted by a test run, and a directory created by a
// Docker volume mount may not even be writable by this user.
process.env.STORAGE_PATH = mkdtempSync(join(tmpdir(), 'docpipeline-test-'));
// Tests must never run against the development database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// The suite truncates every table, so it must never point at a remote database.
// `.env` legitimately holds a deployed DATABASE_URL — that is what applies
// migrations — and `npm test` would then wipe production. A local host is the
// only safe target: refuse anything else rather than discover it afterwards.
{
  const url = process.env.DATABASE_URL ?? '';
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const isLocal =
    host === '' || host === 'localhost' || host === '127.0.0.1' || host === 'postgres';
  if (!isLocal) {
    throw new Error(
      `Refusing to run tests against a non-local database (host: ${host}).\n` +
        'The suite truncates every table. Set TEST_DATABASE_URL to a local ' +
        'database, or point DATABASE_URL at one.',
    );
  }
}

// Processing must be deterministic and instant in tests. The mock's simulated
// delay is what makes a run feel realistic in a demo and slow in a suite; the
// outcome is then decided by filename hints and content hash, never by chance.
process.env.MOCK_PROCESSOR_DELAY_MS = '0';
process.env.MOCK_PROCESSOR_MODE ??= 'random';
process.env.MAX_PROCESSING_ATTEMPTS ??= '3';

