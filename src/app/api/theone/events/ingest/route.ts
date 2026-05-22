import { ingestExternalEvent } from '@/lib/theone/events/event-sources';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const event = await ingestExternalEvent({
      source: String(body.source || 'webhook.generic'),
      eventType: String(body.eventType || body.type || 'webhook.received'),
      externalId: body.externalId ? String(body.externalId) : null,
      summary: String(body.summary || body.message || 'External event received.'),
      payload: body.payload ?? body,
    });
    return Response.json({ ok: true, event });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Event ingest failed' }, { status: 500 });
  }
}
