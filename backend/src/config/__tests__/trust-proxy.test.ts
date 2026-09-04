import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { TRUST_PROXY } from '../trust-proxy';

/**
 * Render forwards through more than one hop, all on private addresses. These
 * assert the client IP survives that — the rate limiter keys on `req.ip`, so
 * when this regresses every visitor shares a bucket and strangers lock each
 * other out. A hop count (`1`) fails the multi-hop cases below.
 */
describe('trust proxy — client IP resolution behind Render', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const app = express();
    app.set('trust proxy', TRUST_PROXY);
    app.get('/', (req, res) => res.json({ ip: req.ip }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const ipFor = async (forwardedFor?: string): Promise<string> => {
    const response = await fetch(url, {
      headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {},
    });
    return (await response.json()).ip;
  };

  it('falls back to the socket address when there is no proxy', async () => {
    // Plain or IPv6-mapped depending on how the socket bound; either is loopback.
    expect(await ipFor()).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });

  it('sees past a single private hop', async () => {
    expect(await ipFor('203.0.113.5, 10.194.87.130')).toBe('203.0.113.5');
  });

  it('sees past several private hops, however many Render adds', async () => {
    expect(await ipFor('203.0.113.5, 10.194.87.130, 10.197.58.130')).toBe(
      '203.0.113.5',
    );
    expect(
      await ipFor('203.0.113.5, 10.1.2.3, 172.16.0.1, 192.168.1.1'),
    ).toBe('203.0.113.5');
  });

  it('ignores a client-forged X-Forwarded-For entry', async () => {
    // The attacker sends "6.6.6.6"; Render appends their real address to the
    // right of it. Reading right-to-left reaches the real one first.
    expect(await ipFor('6.6.6.6, 198.51.100.77, 10.194.87.130')).toBe(
      '198.51.100.77',
    );
  });

  it('does not collapse different clients onto one proxy address', async () => {
    const first = await ipFor('203.0.113.5, 10.194.87.130');
    const second = await ipFor('198.51.100.77, 10.194.87.130');

    expect(first).not.toBe(second);
    expect([first, second]).not.toContain('10.194.87.130');
  });
});
