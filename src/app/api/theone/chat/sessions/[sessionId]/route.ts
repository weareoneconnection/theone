import { getChatSession } from '@/lib/theone/state/chat-session-store';

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = await getChatSession(sessionId);

  if (!session) {
    return Response.json({ ok: false, error: 'Chat session not found.' }, { status: 404 });
  }

  return Response.json({
    ok: true,
    session,
  });
}
