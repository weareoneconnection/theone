import { approveRun } from '@/lib/theone/state/run-store';
import { requireAdmin } from '@/lib/theone/security/api-guard';
import { recordTheOneEvent } from '@/lib/theone/events/event-ledger';

export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (!guard.allowed) return guard.response;

  try {
    const body = await req.json();
    const runId = String(body.runId || '');
    const approvalId = body.approvalId ? String(body.approvalId) : undefined;
    const approveAll = Boolean(body.approveAll);

    const result = await approveRun({ runId, approvalId, approveAll });

    // Audit trail: who approved what, when.
    await recordTheOneEvent({
      runId,
      type: 'approval.decision',
      provider: 'theone',
      status: 'approved',
      summary: `Approval ${approveAll ? 'ALL' : approvalId || 'unknown'} granted by ${guard.actor}.`,
      payload: { actor: guard.actor, approvalId: approvalId || null, approveAll },
    }).catch(() => undefined);

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
