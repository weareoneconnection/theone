import { rejectRun } from '@/lib/theone/state/run-store';
import { requireAdmin } from '@/lib/theone/security/api-guard';
import { recordTheOneEvent } from '@/lib/theone/events/event-ledger';

export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (!guard.allowed) return guard.response;

  try {
    const body = await req.json();
    const runId = String(body.runId || '');
    const approvalId = body.approvalId ? String(body.approvalId) : undefined;
    const rejectAll = Boolean(body.rejectAll);

    const result = await rejectRun({ runId, approvalId, rejectAll });

    // Audit trail: who rejected what, when.
    await recordTheOneEvent({
      runId,
      type: 'approval.decision',
      provider: 'theone',
      status: 'rejected',
      summary: `Approval ${rejectAll ? 'ALL' : approvalId || 'unknown'} rejected by ${guard.actor}.`,
      payload: { actor: guard.actor, approvalId: approvalId || null, rejectAll },
    }).catch(() => undefined);

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
