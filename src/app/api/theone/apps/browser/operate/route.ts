import { runBrowserOperationApp } from '@/lib/theone/apps/browser-operation';
import { saveRunResult } from '@/lib/theone/state/run-store';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await runBrowserOperationApp({
      url: String(body.url || ''),
      operation: body.operation || 'extract',
      mode: (body.mode || 'assist') as TheOneMode,
    });
    const stored = await saveRunResult(result);
    return Response.json({ ...stored, appResult: result.appResult, appMemoryPack: result.appMemoryPack }, { status: stored.ok ? 200 : 500 });
  } catch (error) {
    return Response.json({ ok: false, appResult: null, error: error instanceof Error ? error.message : 'Browser workflow failed' }, { status: 500 });
  }
}
