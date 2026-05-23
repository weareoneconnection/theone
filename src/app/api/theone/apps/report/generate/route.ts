import { runReportGenerateApp } from '@/lib/theone/apps/report-generate';
import { saveRunResult } from '@/lib/theone/state/run-store';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await runReportGenerateApp({
      topic: String(body.topic || ''),
      source: String(body.source || ''),
      format: String(body.format || 'Brief'),
      mode: (body.mode || 'assist') as TheOneMode,
      language: String(body.language || 'en'),
    });
    const stored = await saveRunResult(result);
    return Response.json({ ...stored, appResult: result.appResult, appMemoryPack: result.appMemoryPack }, { status: stored.ok ? 200 : 500 });
  } catch (error) {
    return Response.json({ ok: false, appResult: null, error: error instanceof Error ? error.message : 'Report workflow failed' }, { status: 500 });
  }
}
