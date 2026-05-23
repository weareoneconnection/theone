import { runApiOperationApp } from '@/lib/theone/apps/api-operation';
import { saveRunResult } from '@/lib/theone/state/run-store';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await runApiOperationApp({
      url: String(body.url || ''),
      method: String(body.method || 'GET'),
      body: body.body ? String(body.body) : undefined,
      mode: (body.mode || 'assist') as TheOneMode,
    });
    const stored = await saveRunResult(result);
    return Response.json({ ...stored, appResult: result.appResult, appMemoryPack: result.appMemoryPack }, { status: stored.ok ? 200 : 500 });
  } catch (error) {
    return Response.json({ ok: false, appResult: null, error: error instanceof Error ? error.message : 'API workflow failed' }, { status: 500 });
  }
}
