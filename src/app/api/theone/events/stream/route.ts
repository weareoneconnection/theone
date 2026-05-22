import { listTheOneEvents } from '@/lib/theone/events/event-ledger';

export async function GET() {
  const events = await listTheOneEvents(20);
  const payload = [
    'event: snapshot',
    `data: ${JSON.stringify({ ok: true, events })}`,
    '',
  ].join('\n');

  return new Response(payload, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
