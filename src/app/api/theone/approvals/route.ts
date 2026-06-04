import { listApprovalInbox } from '@/lib/theone/state/run-store';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') || 50);
    return Response.json({
      ok: true,
      items: await listApprovalInbox(limit),
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Approval inbox unavailable.',
      items: [],
    }, { status: 500 });
  }
}
