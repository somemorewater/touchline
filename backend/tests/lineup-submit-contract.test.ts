import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://touchline:touchline@127.0.0.1:5432/touchline_test';
process.env.JWT_ACCESS_SECRET = 'test-secret-with-at-least-32-characters';
process.env.COOKIE_SECURE = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.TRUST_PROXY = 'false';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.REFRESH_TOKEN_DAYS = '30';

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe('lineup submission request contract', () => {
  it('allows the documented bodyless submit request to reach authorization', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/lineups/00000000-0000-4000-8000-000000000001/submit',
    });

    // Missing authentication is checked after request validation. A 401
    // confirms Fastify did not reject the intentionally absent request body.
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });
});
