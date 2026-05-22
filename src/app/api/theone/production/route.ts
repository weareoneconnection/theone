import { getProductionMaturityReport } from '@/lib/theone/production/maturity';

export async function GET() {
  try {
    return Response.json(await getProductionMaturityReport());
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Production maturity report unavailable' },
      { status: 500 }
    );
  }
}
