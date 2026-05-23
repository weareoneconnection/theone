import { runWebAnalysisApp } from '@/lib/theone/apps/web-analysis';
import { saveRunResult } from '@/lib/theone/state/run-store';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await runWebAnalysisApp({
      url: String(body.url || ''),
      focus: String(body.focus || 'Useful findings'),
      mode: (body.mode || 'assist') as TheOneMode,
      language: String(body.language || 'en'),
    });
    const stored = await saveRunResult(result);

    return Response.json({
      ...stored,
      appResult: result.appResult,
    }, {
      status: stored.ok ? 200 : 500,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        appResult: null,
        error: error instanceof Error ? error.message : 'Web analysis failed',
      },
      { status: 500 }
    );
  }
}
