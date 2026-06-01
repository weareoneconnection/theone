import { executeDurableRuntimeRecovery, getDurableRuntimeRecoveryOS } from '@/lib/theone/final-state/os-hardening';

export async function GET() {
  try {
    return Response.json(await getDurableRuntimeRecoveryOS());
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Runtime recovery unavailable' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await executeDurableRuntimeRecovery({
      action: body.action,
      jobId: body.jobId,
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Runtime recovery action failed' }, { status: 500 });
  }
}
