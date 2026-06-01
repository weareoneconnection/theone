import { simulateAgentPlan } from '@/lib/theone/final-state/os-hardening';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await simulateAgentPlan({
      objective: body.objective,
      mode: body.mode,
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Simulation unavailable' }, { status: 500 });
  }
}
