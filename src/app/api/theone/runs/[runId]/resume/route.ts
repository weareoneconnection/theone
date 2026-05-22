import { resumeRun } from '@/lib/theone/state/run-store';

export async function POST(
  _req: Request,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await context.params;
    const result = await resumeRun({ runId });
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Run resume failed' },
      { status: 500 }
    );
  }
}
