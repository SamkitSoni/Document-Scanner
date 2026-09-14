import type { Document } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { jobQueue } from '../../src/config/queue.js';
import type { DocumentProcessor, ProcessorResult } from '../../src/processing/mock-processor.js';
import {
  processDocument,
  processNextDocument,
} from '../../src/services/processing.service.js';
import { makePdf } from '../fixtures/pdf.js';
import { prisma, resetDatabase } from '../helpers/db.js';

/**
 * These tests drive the state machine directly rather than starting the worker
 * loop: the loop's only job is to call `processNextDocument` on a timer, and
 * waiting on real timers would make the suite slow and flaky. The claim path
 * itself is exercised here too, so the queue's atomicity is covered.
 */

const app = buildApp();

beforeEach(resetDatabase);
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

async function upload(filename: string, marker = filename): Promise<string> {
  const res = await request(app)
    .post('/api/documents')
    .field('documentType', 'FINANCIAL_STATEMENT')
    .attach('file', makePdf(marker), filename)
    .expect(201);

  return res.body.documentId as string;
}

function getDocument(id: string): Promise<Document> {
  return prisma.document.findUniqueOrThrow({ where: { id } });
}

function events(id: string) {
  return prisma.documentEvent.findMany({
    where: { documentId: id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** A processor whose outcome is scripted per attempt, for retry scenarios. */
function scriptedProcessor(script: ProcessorResult[]): DocumentProcessor {
  let call = 0;
  return {
    async extract(): Promise<ProcessorResult> {
      const result = script[Math.min(call, script.length - 1)] as ProcessorResult;
      call += 1;
      return result;
    },
  };
}

const goodData = {
  companyName: 'ABC Construction Pvt Ltd',
  registrationNumber: 'U12345DL2020PTC123456',
  address: 'New Delhi',
  annualRevenue: 12_500_000,
  documentDate: '2026-08-15',
};

/** Runs attempts until the document reaches a terminal state, ignoring backoff. */
async function drainDocument(id: string, processor: DocumentProcessor, max = 5): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const before = await getDocument(id);
    if (['PROCESSED', 'VALIDATION_FAILED', 'FAILED'].includes(before.status)) return;

    // Retries are scheduled into the future; make the document due now so the
    // test does not sleep through the real backoff.
    await prisma.document.update({
      where: { id },
      data: { nextAttemptAt: new Date() },
    });

    const claimed = await jobQueue.claimNext();
    if (!claimed) return;
    await prisma.documentEvent.create({
      data: { documentId: id, status: 'PROCESSING', attempt: claimed.attemptCount },
    });
    await processDocument(claimed, { processor });
  }
}

describe('successful processing', () => {
  it('moves an uploaded document to PROCESSED with extracted data', async () => {
    const id = await upload('success-statement.pdf');

    const claimed = await jobQueue.claimNext();
    expect(claimed?.id).toBe(id);
    expect(claimed?.status).toBe('PROCESSING');
    // The claim increments the attempt counter in the same statement.
    expect(claimed?.attemptCount).toBe(1);

    await processDocument(claimed as Document);

    const document = await getDocument(id);
    expect(document.status).toBe('PROCESSED');
    expect(document.failureReason).toBeNull();
    expect(document.validationErrors).toBeNull();
    expect(document.extractedData).toMatchObject({
      companyName: expect.any(String),
      registrationNumber: expect.any(String),
      annualRevenue: expect.any(Number),
      documentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });

    // No longer claimable.
    expect(document.nextAttemptAt).toBeNull();
    expect(document.lockedAt).toBeNull();
    expect(await jobQueue.claimNext()).toBeNull();
  });

  it('exposes the result through the detail API', async () => {
    const id = await upload('success-api.pdf');
    await processNextDocument();

    const res = await request(app).get(`/api/documents/${id}`).expect(200);

    expect(res.body.status).toBe('PROCESSED');
    expect(res.body.attemptCount).toBe(1);
    expect(res.body.result).not.toBeNull();
    expect(res.body.failureReason).toBeNull();
  });

  it('records UPLOADED → PROCESSING → PROCESSED in the history', async () => {
    const id = await upload('success-history.pdf');
    await processNextDocument();

    expect((await events(id)).map((e) => e.status)).toEqual([
      'UPLOADED',
      'PROCESSING',
      'PROCESSED',
    ]);
  });
});

describe('invalid extracted data', () => {
  it('lands in VALIDATION_FAILED rather than being marked processed', async () => {
    const id = await upload('invalid-scan.pdf');
    await processNextDocument();

    const document = await getDocument(id);
    // The crucial assertion of requirement 4: bad content is not a success.
    expect(document.status).toBe('VALIDATION_FAILED');
    expect(document.failureReason).toBe('EXTRACTED_DATA_INVALID');
    expect(Array.isArray(document.validationErrors)).toBe(true);
    expect((document.validationErrors as unknown[]).length).toBeGreaterThan(0);
  });

  it('is never retried, because the same input yields the same bad output', async () => {
    const id = await upload('invalid-noretry.pdf');
    await processNextDocument();

    const document = await getDocument(id);
    expect(document.attemptCount).toBe(1);
    expect(document.nextAttemptAt).toBeNull();
    // Nothing left for a worker to pick up.
    expect(await jobQueue.claimNext()).toBeNull();
  });

  it('reports the failing fields and rules through the API', async () => {
    const id = await upload('invalid-api.pdf');
    await processNextDocument();

    const res = await request(app).get(`/api/documents/${id}`).expect(200);

    expect(res.body.status).toBe('VALIDATION_FAILED');
    // Rejected data is never presented as a usable result...
    expect(res.body.result).toBeNull();
    // ...but it is still visible, because "what did we read?" is the first
    // question when triaging a validation failure.
    expect(res.body.rejectedData).not.toBeNull();
    expect(res.body.validationErrors[0]).toMatchObject({
      field: expect.any(String),
      rule: expect.any(String),
      message: expect.any(String),
    });
  });

});

describe('processor failure', () => {
  it('exhausts its attempts and then fails terminally', async () => {
    const id = await upload('timeout-always.pdf');
    const processor = scriptedProcessor([{ outcome: 'TIMEOUT', durationMs: 5 }]);

    await drainDocument(id, processor);

    const document = await getDocument(id);
    expect(document.status).toBe('FAILED');
    expect(document.attemptCount).toBe(3);
    expect(document.failureReason).toBe('ATTEMPTS_EXHAUSTED');
    expect(document.nextAttemptAt).toBeNull();
    expect(await jobQueue.claimNext()).toBeNull();
  });

  it('records every attempt in the history', async () => {
    const id = await upload('timeout-history.pdf');
    await drainDocument(id, scriptedProcessor([{ outcome: 'TIMEOUT', durationMs: 5 }]));

    const log = await events(id);
    expect(log.filter((e) => e.status === 'PROCESSING')).toHaveLength(3);
    expect(log.filter((e) => e.status === 'FAILED')).toHaveLength(3);
    // The last FAILED is terminal; the earlier two are followed by a retry.
    expect(log.at(-1)?.status).toBe('FAILED');
    expect(log.at(-1)?.reason).toBe('ATTEMPTS_EXHAUSTED');
  });

  it('schedules the first retry into the future with backoff', async () => {
    const id = await upload('timeout-backoff.pdf');

    const claimed = await jobQueue.claimNext();
    await processDocument(claimed as Document, {
      processor: scriptedProcessor([{ outcome: 'TIMEOUT', durationMs: 5 }]),
    });

    const document = await getDocument(id);
    expect(document.status).toBe('RETRY_PENDING');
    expect(document.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
    // Not yet due, so a worker polling right now must not take it.
    expect(await jobQueue.claimNext()).toBeNull();
  });

});

describe('failure followed by a successful retry', () => {
  it('recovers on the second attempt and ends PROCESSED', async () => {
    const id = await upload('retry-recovers.pdf');

    const processor = scriptedProcessor([
      { outcome: 'TIMEOUT', durationMs: 5 },
      { outcome: 'SUCCESS', data: goodData, durationMs: 5 },
    ]);

    await drainDocument(id, processor);

    const document = await getDocument(id);
    expect(document.status).toBe('PROCESSED');
    // Two attempts used, and the earlier failure left no residue.
    expect(document.attemptCount).toBe(2);
    expect(document.failureReason).toBeNull();
    expect(document.extractedData).toMatchObject({ companyName: goodData.companyName });
  });

  it('tells the whole story in the history, failure included', async () => {
    const id = await upload('retry-history.pdf');

    await drainDocument(
      id,
      scriptedProcessor([
        { outcome: 'TIMEOUT', durationMs: 5 },
        { outcome: 'SUCCESS', data: goodData, durationMs: 5 },
      ]),
    );

    const log = await events(id);
    expect(log.map((e) => e.status)).toEqual([
      'UPLOADED',
      'PROCESSING',
      'FAILED',
      'RETRY_PENDING',
      'PROCESSING',
      'PROCESSED',
    ]);

    // The failure keeps its cause, and the retry is attributed to attempt 2.
    expect(log[2]?.reason).toBe('PROCESSOR_TIMEOUT');
    expect(log[4]?.attempt).toBe(2);
  });

});

describe('queue claiming', () => {
  it('never hands the same document to two workers', async () => {
    await upload('concurrent-a.pdf');
    await upload('concurrent-b.pdf');

    // Both claims run at once: SKIP LOCKED must give them different rows.
    const [first, second] = await Promise.all([jobQueue.claimNext(), jobQueue.claimNext()]);

    expect(first?.id).toBeDefined();
    expect(second?.id).toBeDefined();
    expect(first?.id).not.toBe(second?.id);
  });

  it('does not claim a document that is already terminal', async () => {
    await upload('success-terminal.pdf');
    await processNextDocument();

    expect(await jobQueue.claimNext()).toBeNull();
  });

});

describe('crash recovery', () => {
  it('reclaims a document abandoned in PROCESSING', async () => {
    const id = await upload('crash-reclaim-success.pdf');

    // Simulate a worker that claimed the document and then died: the row stays
    // PROCESSING with a lease that nobody will ever release.
    await jobQueue.claimNext();
    await prisma.document.update({
      where: { id },
      data: { lockedAt: new Date(Date.now() - 300_000) },
    });

    // Not claimable while it looks like someone is working on it.
    expect(await jobQueue.claimNext()).toBeNull();

    const reclaimed = await jobQueue.reclaimExpired(120_000);
    expect(reclaimed).toContain(id);

    const document = await getDocument(id);
    expect(document.status).toBe('RETRY_PENDING');
    expect(document.lockedAt).toBeNull();
    // The consumed attempt still counts, so a document that kills workers
    // cannot loop forever.
    expect(document.attemptCount).toBe(1);

    // And it can now be picked up and finished.
    expect(await processNextDocument()).toBe(true);
    expect((await getDocument(id)).status).toBe('PROCESSED');
  });

  it('leaves a healthy in-flight document alone', async () => {
    await upload('crash-inflight.pdf');
    await jobQueue.claimNext(); // lease is fresh

    expect(await jobQueue.reclaimExpired(120_000)).toEqual([]);
  });
});
