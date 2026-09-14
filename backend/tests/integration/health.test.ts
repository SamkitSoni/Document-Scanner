import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

const app = buildApp();

describe('GET /api/health', () => {
  it('reports ok when the database is reachable', async () => {
    const res = await request(app).get('/api/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toBe('up');
    expect(res.body.checks.queueDepth).toBeTypeOf('number');
  });

  it('returns a correlation id header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-correlation-id']).toMatch(/^req_/);
  });
});

describe('unknown routes', () => {
  it('returns a structured 404 rather than an HTML error page', async () => {
    const res = await request(app).get('/api/nope').expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.correlationId).toBeDefined();
    // The envelope must never leak internals.
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules/i);
  });
});
