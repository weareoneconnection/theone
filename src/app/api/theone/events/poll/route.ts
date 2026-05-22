import { pollEventSources } from '@/lib/theone/events/event-sources';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sources = Array.isArray(body.sources) ? body.sources.map(String) : undefined;
    return Response.json(await pollEventSources({ sources, limit: Number(body.limit || 3) }));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Event poll failed' }, { status: 500 });
  }
}
