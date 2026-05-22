import { tickAutomationScheduler } from '@/lib/theone/automation/scheduler';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await tickAutomationScheduler({
      limit: Number(body.limit || 3),
      force: body.force === true,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Automation tick failed' }, { status: 500 });
  }
}
