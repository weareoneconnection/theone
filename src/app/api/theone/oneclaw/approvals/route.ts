import { listOneClawPendingApprovals } from '@/lib/theone/providers/oneclaw';

export async function GET() {
  try {
    const approvals = await listOneClawPendingApprovals();
    return Response.json({
      ok: true,
      approvals,
      count: approvals.length,
      source: 'oneclaw',
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        approvals: [],
        count: 0,
        source: 'oneclaw',
        error: error instanceof Error ? error.message : 'OneClaw approval lookup failed',
      },
      { status: 502 }
    );
  }
}
