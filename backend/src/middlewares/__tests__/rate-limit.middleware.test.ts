import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';
import { CLIENT_IP_HEADERS } from '@gireapp/shared';

const SECRET = 'test-client-ip-secret';
const AUTH_ATTEMPTS = 10;

/**
 * Every request in these tests arrives from the same socket, as all learner
 * traffic arrives from the frontend's server in production. Only the
 * forwarded headers and the session tell learners apart.
 */
describe('rate limiting behind the frontend server', () => {
  let server: Server;
  let url: string;
  let signSession: (userId: string) => string;

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv('CLIENT_IP_SECRET', SECRET);
    const { globalLimiter, authLimiter, clientIpOf } = await import('../rateLimit.middleware');
    const { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } = await import('../../config/env');
    signSession = (userId) =>
      jwt.sign({ userId }, JWT_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });

    const ok: RequestHandler = (_req, res) => {
      res.json({ ok: true });
    };
    const app = express();
    app.use(cookieParser());
    app.get('/global', globalLimiter, ok);
    app.post('/auth', authLimiter, ok);
    app.get('/ip', (req, res) => {
      res.json({ ip: clientIpOf(req, SECRET) });
    });
    app.get('/ip-without-secret', (req, res) => {
      res.json({ ip: clientIpOf(req, undefined) });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const forwardedFor = (ip: string, secret = SECRET): Record<string, string> => ({
    [CLIENT_IP_HEADERS.IP]: ip,
    [CLIENT_IP_HEADERS.SECRET]: secret,
  });

  const exhaustAuthBudget = async (headers: Record<string, string>): Promise<void> => {
    for (let attempt = 0; attempt < AUTH_ATTEMPTS; attempt += 1) {
      const response = await fetch(`${url}/auth`, { method: 'POST', headers });
      expect(response.status).toBe(200);
    }
  };

  const authStatus = async (headers: Record<string, string>): Promise<number> =>
    (await fetch(`${url}/auth`, { method: 'POST', headers })).status;

  it('gives each forwarded learner IP its own auth budget', async () => {
    await exhaustAuthBudget(forwardedFor('203.0.113.1'));

    expect(await authStatus(forwardedFor('203.0.113.1'))).toBe(429);
    expect(await authStatus(forwardedFor('203.0.113.2'))).toBe(200);
  });

  it('ignores a forwarded IP sent with the wrong secret', async () => {
    await exhaustAuthBudget(forwardedFor('198.51.100.1', 'guessed'));

    // Both fell back to the socket address, so they share one bucket.
    expect(await authStatus(forwardedFor('198.51.100.2', 'guessed'))).toBe(429);
  });

  it('ignores a forwarded value that is not an IP address', async () => {
    const response = await fetch(`${url}/ip`, {
      headers: forwardedFor('not-an-ip'),
    });
    expect((await response.json()).ip).toMatch(/127\.0\.0\.1$/);
  });

  it('ignores forwarded IPs entirely when no secret is configured', async () => {
    const response = await fetch(`${url}/ip-without-secret`, {
      headers: forwardedFor('192.0.2.7'),
    });
    expect((await response.json()).ip).toMatch(/127\.0\.0\.1$/);
  });

  const globalHeaders = async (headers: Record<string, string>) => {
    const response = await fetch(`${url}/global`, { headers });
    return {
      limit: Number(response.headers.get('RateLimit-Limit')),
      remaining: Number(response.headers.get('RateLimit-Remaining')),
    };
  };

  it('limits signed-in traffic per account, with a larger budget', async () => {
    const first = await globalHeaders({ Cookie: `token=${signSession('user-a')}` });
    const second = await globalHeaders({ Cookie: `token=${signSession('user-a')}` });
    const otherAccount = await globalHeaders({ Cookie: `token=${signSession('user-b')}` });

    expect(first.limit).toBeGreaterThan((await globalHeaders(forwardedFor('192.0.2.50'))).limit);
    expect(second.remaining).toBe(first.remaining - 1);
    expect(otherAccount.remaining).toBe(first.remaining);
  });

  it('treats a forged session as anonymous traffic from its IP', async () => {
    const forged = jwt.sign({ userId: 'user-a' }, 'not-the-secret');

    const anonymous = await globalHeaders(forwardedFor('192.0.2.60'));
    const withForgedSession = await globalHeaders({
      ...forwardedFor('192.0.2.60'),
      Cookie: `token=${forged}`,
    });

    expect(withForgedSession.limit).toBe(anonymous.limit);
    expect(withForgedSession.remaining).toBe(anonymous.remaining - 1);
  });
});
