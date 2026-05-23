import { runFilesWorkflowApp } from '@/lib/theone/apps/files-workflow';
import { saveRunResult } from '@/lib/theone/state/run-store';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await runFilesWorkflowApp({
      path: String(body.path || '/tmp'),
      operation: body.operation || 'list',
      content: body.content ? String(body.content) : undefined,
      mode: (body.mode || 'assist') as TheOneMode,
    });
    const stored = await saveRunResult(result);
    return Response.json({ ...stored, appResult: result.appResult }, { status: stored.ok ? 200 : 500 });
  } catch (error) {
    return Response.json({ ok: false, appResult: null, error: error instanceof Error ? error.message : 'Files workflow failed' }, { status: 500 });
  }
}
