import { getStoredRun } from '@/lib/theone/state/run-store';

export async function GET(
  _req: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId } = await context.params;
  const run = await getStoredRun(runId);

  if (!run) {
    return Response.json({ ok: false, error: 'Run not found' }, { status: 404 });
  }

  return Response.json(run);
}
