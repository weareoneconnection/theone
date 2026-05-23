import { runBotBridgeApp } from '@/lib/theone/apps/bot-bridge';
import { saveRunResult } from '@/lib/theone/state/run-store';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await runBotBridgeApp({ mode: (body.mode || 'assist') as TheOneMode });
    const stored = await saveRunResult(result);
    return Response.json({ ...stored, appResult: result.appResult }, { status: 200 });
  } catch (error) {
    return Response.json({ ok: false, appResult: null, error: error instanceof Error ? error.message : 'Bot bridge workflow failed' }, { status: 500 });
  }
}
