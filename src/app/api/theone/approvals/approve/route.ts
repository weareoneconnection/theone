import { approveRun } from '@/lib/theone/state/run-store';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await approveRun({
      runId: String(body.runId || ''),
      approvalId: body.approvalId ? String(body.approvalId) : undefined,
      approveAll: Boolean(body.approveAll),
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Approval failed',
      },
      { status: 400 }
    );
  }
}
