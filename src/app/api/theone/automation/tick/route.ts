import { tickAutomationScheduler } from '@/lib/theone/automation/scheduler';
import { NextRequest } from 'next/server';

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // No secret configured — allow all (dev mode)

  // Vercel sets this header automatically when CRON_SECRET is configured
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

async function runTick(req: NextRequest, body?: { limit?: number; force?: boolean }) {
  if (!verifyCronSecret(req)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const limit = Number(body?.limit ?? 3);
    const force = body?.force === true;
    const result = await tickAutomationScheduler({ limit, force });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Automation tick failed' },
      { status: 500 },
    );
  }
}

// GET — called by Vercel Cron every 15 minutes
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') || 3);
  const force = url.searchParams.get('force') === 'true';
  return runTick(req, { limit, force });
}

// POST — called manually or by internal APIs
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return runTick(req, { limit: body.limit, force: body.force });
}
