import { getFinalStateBlueprint } from '@/lib/theone/final-state/os-blueprint';
import { getUniversalAIOSReadiness } from '@/lib/theone/final-state/os-hardening';

export async function GET() {
  try {
    const [blueprint, readiness] = await Promise.all([
      Promise.resolve(getFinalStateBlueprint()),
      getUniversalAIOSReadiness(),
    ]);
    return Response.json({ ...blueprint, readiness });
  } catch (error) {
    return Response.json({ ...getFinalStateBlueprint(), readiness: { ok: false, error: error instanceof Error ? error.message : 'Final-state readiness unavailable' } });
  }
}
