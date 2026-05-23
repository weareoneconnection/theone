import { getOneClawBridgeStatus } from '@/lib/theone/providers/oneclaw';

export async function GET() {
  try {
    const status = await getOneClawBridgeStatus();
    return Response.json({
      ok: status.ok,
      source: 'oneclaw',
      bridge: status,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      source: 'oneclaw',
      error: error instanceof Error ? error.message : 'OneClaw bridge status unavailable',
    }, { status: 500 });
  }
}
