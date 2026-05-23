import { runDesktopControlApp } from '@/lib/theone/apps/desktop-control';
import { saveRunResult } from '@/lib/theone/state/run-store';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await runDesktopControlApp({
      app: String(body.app || 'Google Chrome'),
      operation: body.operation || 'state',
      text: body.text ? String(body.text) : undefined,
      keys: Array.isArray(body.keys) ? body.keys.map(String) : undefined,
      mode: (body.mode || 'assist') as TheOneMode,
    });
    const stored = await saveRunResult(result);
    return Response.json({ ...stored, appResult: result.appResult }, { status: stored.ok ? 200 : 500 });
  } catch (error) {
    return Response.json({ ok: false, appResult: null, error: error instanceof Error ? error.message : 'Desktop workflow failed' }, { status: 500 });
  }
}
