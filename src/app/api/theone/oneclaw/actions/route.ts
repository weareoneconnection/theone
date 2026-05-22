import { runOneClawAction } from '@/lib/theone/providers/oneclaw';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || '').trim();

    if (!action) {
      return Response.json({ ok: false, error: 'action is required' }, { status: 400 });
    }

    const result = await runOneClawAction({
      action,
      input: body.input && typeof body.input === 'object' ? body.input : {},
      approvalMode: body.approvalMode === 'manual' ? 'manual' : 'auto',
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
    });

    return Response.json({
      ok: true,
      source: 'oneclaw',
      result,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        source: 'oneclaw',
        error: error instanceof Error ? error.message : 'OneClaw action failed',
      },
      { status: 400 }
    );
  }
}
