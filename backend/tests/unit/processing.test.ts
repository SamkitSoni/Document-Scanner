import { describe, expect, it } from 'vitest';
import { classify } from '../../src/processing/error-classifier.js';
import { MockProcessor, resolveOutcome } from '../../src/processing/mock-processor.js';
import { backoffMs } from '../../src/services/processing.service.js';

const hash = 'a'.repeat(64);

describe('error classifier', () => {
  it('retries transport failures', () => {
    expect(classify('TIMEOUT')).toMatchObject({
      retryable: true,
      reason: 'PROCESSOR_TIMEOUT',
      terminalStatus: 'FAILED',
    });
    expect(classify('ERROR')).toMatchObject({
      retryable: true,
      reason: 'PROCESSOR_ERROR',
      terminalStatus: 'FAILED',
    });
  });

  it('does not retry an invalid result', () => {
    // Deterministic: the same bytes produce the same bad extraction, so a retry
    // could only waste the budget.
    expect(classify('INVALID_RESULT')).toMatchObject({
      retryable: false,
      reason: 'EXTRACTED_DATA_INVALID',
      terminalStatus: 'VALIDATION_FAILED',
    });
  });
});

describe('retry backoff', () => {
  it('grows exponentially across attempts', () => {
    // No jitter: the midpoint of the range.
    const noJitter = () => 0.5;
    expect(backoffMs(1, noJitter)).toBe(2_000);
    expect(backoffMs(2, noJitter)).toBe(4_000);
    expect(backoffMs(3, noJitter)).toBe(8_000);
  });

  it('applies jitter within ±25% so a failing burst does not retry in lockstep', () => {
    expect(backoffMs(1, () => 0)).toBe(1_500);
    expect(backoffMs(1, () => 1)).toBe(2_500);
  });

});

describe('mock processor', () => {
  it('honours filename hints so every path is demonstrable', () => {
    expect(resolveOutcome('q3-timeout.pdf', hash)).toBe('TIMEOUT');
    expect(resolveOutcome('invalid-scan.pdf', hash)).toBe('INVALID_RESULT');
    expect(resolveOutcome('error-case.pdf', hash)).toBe('ERROR');
    expect(resolveOutcome('success.pdf', hash)).toBe('SUCCESS');
  });

  it('extracts different-looking companies for different documents', async () => {
    const processor = new MockProcessor();

    const a = await processor.extract({
      documentId: 'DOC-AAAAAAAAAA',
      filename: 'success-a.pdf',
      contentHash: 'b'.repeat(64),
    });
    const b = await processor.extract({
      documentId: 'DOC-BBBBBBBBBB',
      filename: 'success-b.pdf',
      contentHash: '1234567890abcdef'.repeat(4),
    });

    expect(a.outcome).toBe('SUCCESS');
    expect(b.outcome).toBe('SUCCESS');
    expect(a.data?.companyName).not.toBe(b.data?.companyName);
  });

  it('returns no data at all when the processor never completed', async () => {
    const result = await new MockProcessor().extract({
      documentId: 'DOC-CCCCCCCCCC',
      filename: 'timeout.pdf',
      contentHash: hash,
    });

    expect(result.outcome).toBe('TIMEOUT');
    expect(result.data).toBeUndefined();
  });

  it('returns data that fails validation for INVALID_RESULT', async () => {
    const result = await new MockProcessor().extract({
      documentId: 'DOC-DDDDDDDDDD',
      filename: 'invalid.pdf',
      contentHash: hash,
    });

    // The processor "worked" — it is the validator that rejects this.
    expect(result.outcome).toBe('INVALID_RESULT');
    expect(result.data).toBeDefined();
  });
});
