import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { makeNonPdf, makePdf } from '../fixtures/pdf.js';
import { prisma, resetDatabase } from '../helpers/db.js';

const app = buildApp();

beforeEach(resetDatabase);
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

function upload(file: Buffer, filename = 'statement.pdf', type = 'FINANCIAL_STATEMENT') {
  return request(app)
    .post('/api/documents')
    .field('documentType', type)
    .attach('file', file, filename);
}

describe('POST /api/documents — valid upload', () => {
  it('accepts a PDF and returns an id with UPLOADED status', async () => {
    const res = await upload(makePdf('valid')).expect(201);

    expect(res.body.documentId).toMatch(/^DOC-[0-9A-Z]{10}$/);
    expect(res.body.status).toBe('UPLOADED');
    expect(res.body.duplicate).toBeUndefined();
  });

  it('persists the document with its metadata and content hash', async () => {
    const res = await request(app)
      .post('/api/documents')
      .field('documentType', 'BANK_STATEMENT')
      .field('metadata', JSON.stringify({ brokerId: 'BR-90' }))
      .attach('file', makePdf('meta'), 'acme.pdf')
      .expect(201);

    const row = await prisma.document.findUniqueOrThrow({
      where: { id: res.body.documentId },
    });

    expect(row.filename).toBe('acme.pdf');
    expect(row.documentType).toBe('BANK_STATEMENT');
    expect(row.contentHash).toHaveLength(64);
    expect(row.metadata).toEqual({ brokerId: 'BR-90' });
    expect(row.attemptCount).toBe(0);
    // Must be immediately claimable by the worker.
    expect(row.nextAttemptAt).not.toBeNull();
  });

  it('writes an UPLOADED event in the same transaction', async () => {
    const res = await upload(makePdf('event')).expect(201);

    const events = await prisma.documentEvent.findMany({
      where: { documentId: res.body.documentId },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('UPLOADED');
  });
});

describe('POST /api/documents — rejected uploads', () => {
  it('rejects a non-PDF even when the content type claims otherwise', async () => {
    // The declared mime type is a lie; the magic-byte check must catch it.
    const res = await request(app)
      .post('/api/documents')
      .field('documentType', 'FINANCIAL_STATEMENT')
      .attach('file', makeNonPdf(), {
        filename: 'fake.pdf',
        contentType: 'application/pdf',
      })
      .expect(415);

    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await prisma.document.count()).toBe(0);
  });

  it('rejects an unknown document type', async () => {
    const res = await upload(makePdf('bad-type'), 'x.pdf', 'NOT_A_REAL_TYPE').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a request with no file', async () => {
    const res = await request(app)
      .post('/api/documents')
      .field('documentType', 'FINANCIAL_STATEMENT')
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed metadata', async () => {
    const res = await request(app)
      .post('/api/documents')
      .field('documentType', 'OTHER')
      .field('metadata', 'not-json{')
      .attach('file', makePdf('bad-meta'), 'x.pdf')
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('never leaks internals in an error response', async () => {
    const res = await upload(makeNonPdf(), 'x.pdf').expect(415);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|prisma/i);
    expect(res.body.error.correlationId).toBeDefined();
  });
});

describe('POST /api/documents — duplicate detection', () => {
  it('returns the original document when the same file is uploaded twice', async () => {
    const pdf = makePdf('duplicate-case');

    const first = await upload(pdf, 'original.pdf').expect(201);
    const second = await upload(pdf, 'renamed-copy.pdf').expect(200);

    expect(second.body.documentId).toBe(first.body.documentId);
    expect(second.body.duplicate).toBe(true);

    // One row, one event chain — the second upload created nothing.
    expect(await prisma.document.count()).toBe(1);
    expect(
      await prisma.documentEvent.count({ where: { documentId: first.body.documentId } }),
    ).toBe(1);
  });

  it('treats different content as distinct documents', async () => {
    const a = await upload(makePdf('alpha'), 'a.pdf').expect(201);
    const b = await upload(makePdf('beta'), 'b.pdf').expect(201);

    expect(a.body.documentId).not.toBe(b.body.documentId);
    expect(await prisma.document.count()).toBe(2);
  });

  it('resolves concurrent uploads of identical bytes to one document', async () => {
    const pdf = makePdf('race');

    const results = await Promise.all([
      upload(pdf, 'one.pdf'),
      upload(pdf, 'two.pdf'),
      upload(pdf, 'three.pdf'),
    ]);

    const ids = new Set(results.map((r) => r.body.documentId));
    expect(ids.size).toBe(1);
    expect(await prisma.document.count()).toBe(1);
  });
});

describe('GET /api/documents/:id', () => {
  it('returns the document detail shape', async () => {
    const created = await upload(makePdf('detail'), 'detail.pdf').expect(201);

    const res = await request(app)
      .get(`/api/documents/${created.body.documentId}`)
      .expect(200);

    expect(res.body).toMatchObject({
      documentId: created.body.documentId,
      status: 'UPLOADED',
      documentType: 'FINANCIAL_STATEMENT',
      filename: 'detail.pdf',
      attemptCount: 0,
      result: null,
      failureReason: null,
      validationErrors: null,
    });
    expect(res.body.createdAt).toBeDefined();
  });

  it('returns 404 for an unknown document', async () => {
    const res = await request(app).get('/api/documents/DOC-AAAAAAAAAA').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed id', async () => {
    const res = await request(app).get('/api/documents/not-an-id').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
