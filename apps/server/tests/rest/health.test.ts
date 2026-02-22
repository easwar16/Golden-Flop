import request from 'supertest';
import { TestServer, createTestServer } from '../helpers/server';

describe('GET /health', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 200 with status ok', async () => {
    const res = await request(server.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns a numeric timestamp', async () => {
    const before = Date.now();
    const res = await request(server.app).get('/health');
    const after = Date.now();
    expect(typeof res.body.timestamp).toBe('number');
    expect(res.body.timestamp).toBeGreaterThanOrEqual(before);
    expect(res.body.timestamp).toBeLessThanOrEqual(after);
  });

  it('returns JSON content-type', async () => {
    const res = await request(server.app).get('/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(server.app).get('/nonexistent');
    expect(res.status).toBe(404);
  });
});
