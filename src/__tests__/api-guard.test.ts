import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requireAdmin, rateLimit, inputTooLarge } from '@/lib/theone/security/api-guard';

const makeReq = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/test', { headers });

describe('requireAdmin', () => {
  const original = process.env.THEONE_ADMIN_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.THEONE_ADMIN_KEY;
    else process.env.THEONE_ADMIN_KEY = original;
  });

  it('allows everything when no admin key is configured', () => {
    delete process.env.THEONE_ADMIN_KEY;
    const result = requireAdmin(makeReq());
    expect(result.allowed).toBe(true);
  });

  it('rejects requests without the key when configured', () => {
    process.env.THEONE_ADMIN_KEY = 'secret123';
    const result = requireAdmin(makeReq());
    expect(result.allowed).toBe(false);
  });

  it('accepts a valid Bearer token and records the actor', () => {
    process.env.THEONE_ADMIN_KEY = 'secret123';
    const result = requireAdmin(makeReq({ authorization: 'Bearer secret123', 'x-theone-actor': 'ops@example.com' }));
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.actor).toBe('ops@example.com');
  });

  it('accepts the x-theone-admin-key header', () => {
    process.env.THEONE_ADMIN_KEY = 'secret123';
    const result = requireAdmin(makeReq({ 'x-theone-admin-key': 'secret123' }));
    expect(result.allowed).toBe(true);
  });
});

describe('rateLimit', () => {
  it('allows up to the limit then rejects with 429', () => {
    const key = `test_${Date.now()}`;
    const req = makeReq({ 'x-forwarded-for': '10.0.0.1' });

    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit(req, { key, limit: 3, windowMs: 60_000 }).allowed).toBe(true);
    }
    const fourth = rateLimit(req, { key, limit: 3, windowMs: 60_000 });
    expect(fourth.allowed).toBe(false);
    if (!fourth.allowed) expect(fourth.response.status).toBe(429);
  });

  it('tracks different IPs independently', () => {
    const key = `test_ip_${Date.now()}`;
    const reqA = makeReq({ 'x-forwarded-for': '10.0.0.2' });
    const reqB = makeReq({ 'x-forwarded-for': '10.0.0.3' });

    expect(rateLimit(reqA, { key, limit: 1, windowMs: 60_000 }).allowed).toBe(true);
    expect(rateLimit(reqA, { key, limit: 1, windowMs: 60_000 }).allowed).toBe(false);
    expect(rateLimit(reqB, { key, limit: 1, windowMs: 60_000 }).allowed).toBe(true);
  });
});

describe('inputTooLarge', () => {
  it('passes small input and rejects oversized input', () => {
    expect(inputTooLarge('hello')).toBeNull();
    const response = inputTooLarge('x'.repeat(30_000));
    expect(response?.status).toBe(413);
  });
});
