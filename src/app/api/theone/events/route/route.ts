import { routeExternalEvents } from '@/lib/theone/events/event-sources';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await routeExternalEvents({
      limit: Number(body.limit || 10),
      force: body.force === true,
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Event routing failed' }, { status: 500 });
  }
}
