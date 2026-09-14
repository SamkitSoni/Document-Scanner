import type { ExtractedData } from '../common/types.js';
import { env } from '../config/env.js';

/**
 * Stand-in for the real OCR/extraction service.
 *
 * The brief asks for random outcomes, but random behaviour makes tests flaky.
 * Both needs are met by resolving the outcome in a fixed order of precedence:
 *
 *   1. `MOCK_PROCESSOR_MODE` — an explicit override for tests and demos.
 *   2. Filename hints (`*timeout*`, `*invalid*`, `*error*`) — so every path can
 *      be demonstrated on command with a suitably named file.
 *   3. A weighted draw seeded by the document's content hash — random-looking
 *      across documents, yet identical for the same file on every attempt.
 *
 * Because the seed is the content hash, a retry of a genuinely broken document
 * reproduces the same failure, which is what makes the retry tests meaningful.
 */

/** What the processor reports back. Only the transport-level outcome lives here. */
export type ProcessorOutcome = 'SUCCESS' | 'TIMEOUT' | 'ERROR' | 'INVALID_RESULT';

export interface ProcessorResult {
  outcome: ProcessorOutcome;
  /** Present for SUCCESS and INVALID_RESULT; the validator decides which is which. */
  data?: Partial<ExtractedData>;
  /** How long the attempt took, for the processing log. */
  durationMs: number;
}

export interface ProcessorInput {
  documentId: string;
  filename: string;
  contentHash: string;
  /** The stored bytes. Unused by the mock, but present so the signature matches a real processor. */
  file?: Buffer;
}

/**
 * The worker depends on this interface, not on the concrete mock. Replacing the
 * mock with a real extraction service is then a single binding change.
 */
export interface DocumentProcessor {
  extract(input: ProcessorInput): Promise<ProcessorResult>;
}

const COMPANY_PREFIXES = ['ABC', 'Meridian', 'Northgate', 'Sunrise', 'Vertex', 'Kailash'];
const COMPANY_SUFFIXES = ['Construction', 'Infrastructure', 'Engineering', 'Builders', 'Logistics'];
const CITIES = ['New Delhi', 'Mumbai', 'Bengaluru', 'Pune', 'Chennai', 'Hyderabad'];
const STATE_CODES = ['DL', 'MH', 'KA', 'TN', 'TG', 'GJ'];

/**
 * Deterministic pseudo-random stream seeded from the content hash. Taking hex
 * slices rather than calling Math.random is the whole point: the same document
 * always produces the same extraction.
 */
function seededValues(contentHash: string): (index: number) => number {
  return (index: number) => {
    const offset = (index * 4) % (contentHash.length - 4);
    return parseInt(contentHash.slice(offset, offset + 4), 16);
  };
}

function pick<T>(values: readonly T[], seed: number): T {
  return values[seed % values.length] as T;
}

/** Synthesises a plausible, fully valid extraction for a document. */
function buildExtraction(contentHash: string): ExtractedData {
  const at = seededValues(contentHash);

  const prefix = pick(COMPANY_PREFIXES, at(0));
  const suffix = pick(COMPANY_SUFFIXES, at(1));
  const cityIndex = at(2) % CITIES.length;

  // Shaped like a real CIN: U + 5 digits + state + year + PTC + 6 digits.
  const registrationNumber = [
    'U',
    String(at(3) % 100000).padStart(5, '0'),
    STATE_CODES[cityIndex],
    2015 + (at(4) % 11),
    'PTC',
    String(at(5) % 1000000).padStart(6, '0'),
  ].join('');

  // Between ~1M and ~100M, rounded to a realistic-looking figure.
  const annualRevenue = (1 + (at(6) % 100)) * 1_250_000;

  const month = 1 + (at(7) % 12);
  const day = 1 + (at(8) % 28);
  const documentDate = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return {
    companyName: `${prefix} ${suffix} Pvt Ltd`,
    registrationNumber,
    address: CITIES[cityIndex] as string,
    annualRevenue,
    documentDate,
  };
}

/**
 * An extraction that is structurally present but semantically wrong — exactly
 * what a real OCR pass produces on a smudged or truncated scan. The validator,
 * not the processor, is what turns this into VALIDATION_FAILED.
 */
function buildInvalidExtraction(contentHash: string): Partial<ExtractedData> {
  const at = seededValues(contentHash);
  const base = buildExtraction(contentHash);

  // Rotate through the failure shapes so different documents fail differently.
  switch (at(9) % 4) {
    case 0:
      return { ...base, registrationNumber: '' };
    case 1:
      return { ...base, annualRevenue: -1 * base.annualRevenue };
    case 2:
      return { ...base, documentDate: '15-08-2026' }; // not ISO-8601
    default:
      return { ...base, companyName: '' };
  }
}

/** Filename hints, so any outcome can be demonstrated without changing config. */
function outcomeFromFilename(filename: string): ProcessorOutcome | undefined {
  const name = filename.toLowerCase();
  if (name.includes('timeout')) return 'TIMEOUT';
  if (name.includes('invalid')) return 'INVALID_RESULT';
  if (name.includes('error')) return 'ERROR';
  if (name.includes('success')) return 'SUCCESS';
  return undefined;
}

function outcomeFromMode(): ProcessorOutcome | undefined {
  switch (env.MOCK_PROCESSOR_MODE) {
    case 'always_success':
      return 'SUCCESS';
    case 'always_timeout':
      return 'TIMEOUT';
    case 'always_invalid':
      return 'INVALID_RESULT';
    default:
      return undefined;
  }
}

/**
 * Weighted draw seeded by content hash: ~70% success, with the remainder split
 * across the three failure modes. Deterministic per document.
 */
function outcomeFromHash(contentHash: string): ProcessorOutcome {
  const roll = seededValues(contentHash)(10) % 100;
  if (roll < 70) return 'SUCCESS';
  if (roll < 82) return 'TIMEOUT';
  if (roll < 92) return 'ERROR';
  return 'INVALID_RESULT';
}

export function resolveOutcome(filename: string, contentHash: string): ProcessorOutcome {
  return outcomeFromMode() ?? outcomeFromFilename(filename) ?? outcomeFromHash(contentHash);
}

export class MockProcessor implements DocumentProcessor {
  async extract(input: ProcessorInput): Promise<ProcessorResult> {
    const startedAt = Date.now();
    const outcome = resolveOutcome(input.filename, input.contentHash);

    // Simulated work. Zero in tests, so the suite is not paced by a sleep.
    if (env.MOCK_PROCESSOR_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, env.MOCK_PROCESSOR_DELAY_MS));
    }

    const durationMs = Date.now() - startedAt;

    switch (outcome) {
      case 'SUCCESS':
        return { outcome, data: buildExtraction(input.contentHash), durationMs };
      case 'INVALID_RESULT':
        return { outcome, data: buildInvalidExtraction(input.contentHash), durationMs };
      default:
        // TIMEOUT and ERROR produce no data at all: the processor never ran to completion.
        return { outcome, durationMs };
    }
  }
}

export const mockProcessor: DocumentProcessor = new MockProcessor();
