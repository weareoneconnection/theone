import { getCrossDeviceBridgeMeshOS } from '@/lib/theone/final-state/os-hardening';

export async function GET() {
  try {
    return Response.json(await getCrossDeviceBridgeMeshOS());
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Bridge mesh unavailable' }, { status: 500 });
  }
}
