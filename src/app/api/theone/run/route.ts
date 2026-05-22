import { runTheOne } from '@/lib/theone/orchestrator';
import { saveRunResult } from '@/lib/theone/state/run-store';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const result = await runTheOne({
      raw: String(body.input ?? ''),
      userId: body.userId,
      sessionId: body.sessionId,
      language: body.language || 'en',
      mode: body.mode || 'assist',
    });
    const stored = await saveRunResult(result);

    return Response.json(stored, {
      status: stored.ok ? 200 : 500,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'TheOne run failed',
      },
      { status: 500 }
    );
  }
}
