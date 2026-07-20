// Shared guards for TheOne API routes: admin auth + per-IP rate limiting.

export type GuardResult = { allowed: true; actor: string } | { allowed: false; response: Response };

// Admin-only endpoints (approvals, policy, learning apply) require
// THEONE_ADMIN_KEY when it is configured. Without the env var the guard is a
// no-op so local development keeps working.
export function requireAdmin(req: Request): GuardResult {
  const adminKey = String(process.env.THEONE_ADMIN_KEY || '').trim();
  const actor = req.headers.get('x-theone-actor')?.trim() || 'anonymous';

  if (!adminKey) return { allowed: true, actor };

  const header = req.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : req.headers.get('x-theone-admin-key') || '';

  if (provided === adminKey) return { allowed: true, actor };

  return {
    allowed: false,
    response: Response.json({ ok: false, error: 'Unauthorized: admin key required.' }, { status: 401 }),
  };
}

// Simple sliding-window rate limiter (per-instance memory; enough to stop
// accidental loops and casual abuse on serverless instances).
const buckets = new Map<string, number[]>();

export function rateLimit(req: Request, options: { key: string; limit: number; windowMs: number }): GuardResult {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  const bucketKey = `${options.key}:${ip}`;
  const nowMs = Date.now();
  const windowStart = nowMs - options.windowMs;

  const hits = (buckets.get(bucketKey) || []).filter((t) => t > windowStart);
  if (hits.length >= options.limit) {
    return {
      allowed: false,
      response: Response.json(
        { ok: false, error: 'Rate limit exceeded. Try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(options.windowMs / 1000)) } },
      ),
    };
  }

  hits.push(nowMs);
  buckets.set(bucketKey, hits);

  // Bound the map so long-lived instances don't grow unbounded.
  if (buckets.size > 5000) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }

  return { allowed: true, actor: ip };
}

export function inputTooLarge(text: string, maxChars = 20_000): Response | null {
  if (text.length <= maxChars) return null;
  return Response.json(
    { ok: false, error: `Input exceeds ${maxChars} characters.` },
    { status: 413 },
  );
}
