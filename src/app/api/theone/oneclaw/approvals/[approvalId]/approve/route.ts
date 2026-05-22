import { approveOneClawApproval } from '@/lib/theone/providers/oneclaw';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ approvalId: string }> }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const { approvalId } = await params;
    const result = await approveOneClawApproval({
      approvalId,
      decidedBy: body.decidedBy ? String(body.decidedBy) : 'theone',
      decisionNote: body.decisionNote
        ? String(body.decisionNote)
        : 'Approved from TheOne control plane.',
    });

    return Response.json({
      ok: true,
      source: 'oneclaw',
      result,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        source: 'oneclaw',
        error: error instanceof Error ? error.message : 'OneClaw approval failed',
      },
      { status: 400 }
    );
  }
}
