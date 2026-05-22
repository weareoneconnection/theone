import { listTheOneEvents } from '@/lib/theone/events/event-ledger';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get('limit') || 50);
    return Response.json({
      ok: true,
      items: await listTheOneEvents(limit),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Event ledger failed' },
      { status: 500 }
    );
  }
}
