import { eventSourceDefinitions, listExternalEvents } from '@/lib/theone/events/event-sources';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') || 20);
  return Response.json({
    ok: true,
    sources: eventSourceDefinitions,
    events: await listExternalEvents(limit),
  });
}
