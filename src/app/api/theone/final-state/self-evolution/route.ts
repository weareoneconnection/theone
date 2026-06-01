import { executeSelfEvolutionCycle, getSelfEvolvingOS } from '@/lib/theone/final-state/os-hardening';

export async function GET() {
  try {
    return Response.json(await getSelfEvolvingOS());
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Self-evolution unavailable' }, { status: 500 });
  }
}

export async function POST() {
  try {
    return Response.json(await executeSelfEvolutionCycle());
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Self-evolution action failed' }, { status: 500 });
  }
}
