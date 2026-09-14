/**
 * Loads environment for tests before any module reads it. Node 20.6+ can do
 * this with --env-file, but doing it here keeps the test command portable and
 * lets TEST_DATABASE_URL override the development database.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
// Tests must never run against the development database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
