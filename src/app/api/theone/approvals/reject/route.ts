import { rejectRun } from '@/lib/theone/state/run-store';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await rejectRun({
      runId: String(body.runId || ''),
      approvalId: body.approvalId ? String(body.approvalId) : undefined,
      rejectAll: Boolean(body.rejectAll),
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Rejection failed',
      },
      { status: 400 }
    );
  }
}
