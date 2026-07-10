import { runCodeWorkflowApp } from '@/lib/theone/apps/code-workflow';
import { saveRunResult } from '@/lib/theone/state/run-store';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await runCodeWorkflowApp({
      workspacePath: body.workspacePath ? String(body.workspacePath) : undefined,
      objective: String(body.objective || ''),
      focus: String(body.focus || 'Prepare patch'),
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
        error: error instanceof Error ? error.message : 'Code workflow failed',
      },
      { status: 500 }
    );
  }
}
