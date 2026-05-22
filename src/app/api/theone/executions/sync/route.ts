import { syncRunExecution } from '@/lib/theone/state/run-store';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await syncRunExecution({
      runId: String(body.runId || ''),
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Execution sync failed',
      },
      { status: 400 }
    );
  }
}
