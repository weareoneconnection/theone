import { runTheOneChatRuntime, type TheOneChatRuntimeInput } from '@/lib/theone/chat/chat-runtime';
import { saveRunResult } from '@/lib/theone/state/run-store';
import type { TheOneMode } from '@/lib/theone/types';

type ChatRole = 'user' | 'assistant' | 'system';

function normalizeMessages(value: unknown): TheOneChatRuntimeInput['messages'] {
  if (!Array.isArray(value)) return [];

  return value
    .map((message) => {
      if (!message || typeof message !== 'object') return null;
      const record = message as Record<string, unknown>;
      const role: ChatRole = record.role === 'assistant' || record.role === 'system' || record.role === 'user'
        ? record.role
        : 'user';
      const content = typeof record.content === 'string' ? record.content.trim() : '';
      if (!content) return null;
      return { role, content };
    })
    .filter((message): message is NonNullable<typeof message> => Boolean(message));
}

function normalizeMode(value: unknown): TheOneMode {
  return value === 'manual' || value === 'auto' || value === 'assist' ? value : 'assist';
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await runTheOneChatRuntime({
      messages: normalizeMessages(body.messages),
      input: typeof body.input === 'string' ? body.input : undefined,
      mode: normalizeMode(body.mode),
      userId: typeof body.userId === 'string' ? body.userId : undefined,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
    });
    const stored = await saveRunResult(result);

    return Response.json({
      ...stored,
      chat: result.chat,
    }, {
      status: stored.ok ? 200 : 500,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'TheOne Chat Runtime failed.',
      chat: {
        runtime: 'theone.chat_runtime.v1',
        assistant: {
          role: 'assistant',
          content: 'TheOne could not start the intelligent chat workflow.',
          createdAt: new Date().toISOString(),
        },
      },
    }, {
      status: 500,
    });
  }
}
