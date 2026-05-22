import { runTheOne } from '@/lib/theone/orchestrator';
import { getRunReplayInput, saveRunResult } from '@/lib/theone/state/run-store';

export async function POST(
  _req: Request,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await context.params;
    const input = await getRunReplayInput(runId);
    if (!input) {
      return Response.json({ ok: false, error: 'Run not found' }, { status: 404 });
    }

    const result = await runTheOne(input);
    const stored = await saveRunResult(result);
    return Response.json({ ok: true, replayOf: runId, result: stored });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Run replay failed' },
      { status: 500 }
    );
  }
}
