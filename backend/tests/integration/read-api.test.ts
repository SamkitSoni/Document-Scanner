import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { makePdf } from '../fixtures/pdf.js';
import { prisma, resetDatabase } from '../helpers/db.js';

/**
 * Covers the read surface the UI is built against. Deliberately small: these
 * target where the bugs actually hide — query parsing and pagination
 * arithmetic — rather than restating what the detail endpoint already returns.
 *
 * The fixture is seeded once for the whole file: these are read-only endpoints,
 * so there is nothing for one test to leak into another.
 */

const app = buildApp();

let processedId = '';
let failedId = '';

beforeAll(async () => {
  await resetDatabase();

  // Five documents across two types, with distinct filenames for search.
  const seed = [
    { name: 'acme-fy25.pdf', type: 'FINANCIAL_STATEMENT' },
    { name: 'acme-bank.pdf', type: 'BANK_STATEMENT' },
    { name: 'globex-fy25.pdf', type: 'FINANCIAL_STATEMENT' },
    { name: 'globex-bank.pdf', type: 'BANK_STATEMENT' },
    { name: 'initech-tax.pdf', type: 'TAX_RETURN' },
  ];

  for (const { name, type } of seed) {
    await request(app)
      .post('/api/documents')
      .field('documentType', type)
      .attach('file', makePdf(name), name)
      .expect(201);
  }

  // Put two documents into terminal states so status filters and stats have
  // something to distinguish. Written directly: the point here is the read
  // surface, not re-testing the state machine.
  const rows = await prisma.document.findMany({ orderBy: { filename: 'asc' } });
  processedId = rows[0]!.id;
  failedId = rows[1]!.id;

  await prisma.document.update({
    where: { id: processedId },
    data: { status: 'PROCESSED', attemptCount: 1, nextAttemptAt: null },
  });
  await prisma.document.update({
    where: { id: failedId },
    data: {
      status: 'FAILED',
      attemptCount: 3,
      failureReason: 'ATTEMPTS_EXHAUSTED',
      nextAttemptAt: null,
    },
  });
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('GET /api/documents — filtering and pagination', () => {
  it('filters by a repeated status parameter', async () => {
    // Express gives a single value as a string and repeats as an array; both
    // must reach the query the same way.
    const single = await request(app).get('/api/documents?status=PROCESSED').expect(200);
    expect(single.body.data).toHaveLength(1);
    expect(single.body.data[0].documentId).toBe(processedId);

    const repeated = await request(app)
      .get('/api/documents?status=PROCESSED&status=FAILED')
      .expect(200);
    expect(repeated.body.data.map((d: { documentId: string }) => d.documentId).sort()).toEqual(
      [processedId, failedId].sort(),
    );
  });

  it('combines a type filter with a filename search', async () => {
    const res = await request(app)
      .get('/api/documents?documentType=FINANCIAL_STATEMENT&search=globex')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].filename).toBe('globex-fy25.pdf');
    expect(res.body.pagination.totalItems).toBe(1);
  });

  it('paginates without dropping or repeating a row at the boundary', async () => {
    // The off-by-one that a browser hides: page 2 looks plausible even when it
    // has silently skipped a document.
    const first = await request(app).get('/api/documents?pageSize=2&page=1').expect(200);
    const second = await request(app).get('/api/documents?pageSize=2&page=2').expect(200);
    const third = await request(app).get('/api/documents?pageSize=2&page=3').expect(200);

    expect(first.body.pagination).toMatchObject({
      page: 1,
      pageSize: 2,
      totalItems: 5,
      totalPages: 3,
    });
    expect(first.body.data).toHaveLength(2);
    expect(second.body.data).toHaveLength(2);
    expect(third.body.data).toHaveLength(1);

    const ids = [...first.body.data, ...second.body.data, ...third.body.data].map(
      (d: { documentId: string }) => d.documentId,
    );
    expect(new Set(ids).size).toBe(5);
  });

  it('rejects a page size above the cap instead of honouring it', async () => {
    // Uncapped, one request could read the entire table.
    const res = await request(app).get('/api/documents?pageSize=5000').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/documents/:id/history', () => {
  it('returns the transitions in order', async () => {
    const res = await request(app).get(`/api/documents/${processedId}/history`).expect(200);

    expect(res.body[0]).toMatchObject({ status: 'UPLOADED' });
    expect(res.body[0].timestamp).toBeDefined();
  });

  it('returns 404 for an unknown document rather than an empty list', async () => {
    // An empty array would be indistinguishable from a document with no events.
    const res = await request(app).get('/api/documents/DOC-AAAAAAAAAA/history').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/documents/stats', () => {
  it('is routed as a literal, not parsed as a document id', async () => {
    // Registration order matters: '/:id' would otherwise swallow this and the
    // id regex would reject "stats" as malformed.
    const res = await request(app).get('/api/documents/stats').expect(200);

    expect(res.body.total).toBe(5);
    expect(res.body.byStatus.PROCESSED).toBe(1);
    expect(res.body.byStatus.FAILED).toBe(1);
    // Absent statuses are still present as zero, so the dashboard can render a
    // stable set of tiles.
    expect(res.body.byStatus.PROCESSING).toBe(0);
  });
});

describe('POST /api/documents/:id/retry', () => {
  it('makes a terminally failed document claimable again', async () => {
    const res = await request(app).post(`/api/documents/${failedId}/retry`).expect(200);

    expect(res.body.status).toBe('RETRY_PENDING');
    // The budget resets: an operator retrying by hand is asserting the
    // underlying problem is fixed.
    expect(res.body.attemptCount).toBe(0);

    const row = await prisma.document.findUniqueOrThrow({ where: { id: failedId } });
    expect(row.failureReason).toBeNull();
    expect(row.nextAttemptAt).not.toBeNull();
  });

  it('refuses to retry a document that succeeded', async () => {
    const res = await request(app).post(`/api/documents/${processedId}/retry`).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('GET /api/documents/:id/file', () => {
  it('serves the stored PDF inline for preview', async () => {
    const res = await request(app).get(`/api/documents/${processedId}/file`).expect(200);

    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
