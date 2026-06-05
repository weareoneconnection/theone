import { listChatSessions } from '@/lib/theone/state/chat-session-store';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(80, Math.max(1, Number(url.searchParams.get('limit') || 30)));
  const sessions = await listChatSessions(limit);

  return Response.json({
    ok: true,
    items: sessions,
  });
}
