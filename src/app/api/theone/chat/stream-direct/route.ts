import { getOneAIConfig } from '@/lib/theone/providers/oneai';
import { rateLimit } from '@/lib/theone/security/api-guard';

// True token streaming for conversational turns via OneAI's
// theone_chat_direct SSE endpoint. Task-shaped messages should use
// /api/theone/chat/stream (full pipeline) instead — the chat UI decides.

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const limited = rateLimit(req, { key: 'chat-stream-direct', limit: 60, windowMs: 60_000 });
  if (!limited.allowed) return limited.response;

  const config = getOneAIConfig();
  if (!config.apiKey) {
    return Response.json({ ok: false, error: 'ONEAI_API_KEY is not configured' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return Response.json({ ok: false, error: 'message is required' }, { status: 400 });

  const conversation = Array.isArray(body?.conversation)
    ? body.conversation.slice(-8).map((item: Record<string, unknown>) => ({
        role: typeof item?.role === 'string' ? item.role : 'user',
        content: typeof item?.content === 'string' ? item.content.slice(0, 2_000) : '',
      }))
    : [];

  const upstream = await fetch(`${config.baseUrl}/v1/generate/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify({
      type: 'theone_chat_direct',
      input: {
        message,
        conversation,
        responseLanguage: typeof body?.language === 'string' ? body.language : undefined,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return Response.json({
      ok: false,
      error: `OneAI stream failed (${upstream.status}): ${detail.slice(0, 300)}`,
    }, { status: 502 });
  }

  // Pass the SSE bytes straight through to the browser.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
