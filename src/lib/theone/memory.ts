import { ensureTheOneDatabase, prisma } from './db/prisma';
import { embedText } from './providers/oneai';
import type { ClassifiedIntent } from './types';

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeJson(value: unknown) {
  try { return JSON.stringify(value); } catch { return null; }
}

export async function storeRunMemory(input: {
  runId: string;
  intent: ClassifiedIntent;
  summary: string;
}): Promise<{ ok: boolean; stored: boolean; memoryId?: string }> {
  const title = input.intent.objective.slice(0, 200);
  const summary = input.summary?.trim() || input.intent.objective;
  const kind = input.intent.type;

  const embeddingText = `${kind}: ${title}. ${summary}`.slice(0, 2000);

  try {
    await ensureTheOneDatabase();

    const embeddingResult = await embedText(embeddingText).catch(() => null);
    const embeddingJson = embeddingResult ? safeJson(embeddingResult.embedding) : null;

    const memoryId = id('mem');
    await prisma.theOneMemory.create({
      data: {
        id: memoryId,
        runId: input.runId,
        kind,
        title,
        summary,
        contentJson: safeJson({
          intentType: input.intent.type,
          entities: input.intent.entities,
          constraints: input.intent.constraints,
          priority: input.intent.priority,
          confidence: input.intent.confidence,
        }),
        embeddingJson,
      },
    });

    return { ok: true, stored: true, memoryId };
  } catch (error) {
    // Offline fallback — don't crash the run
    console.warn('[theone] storeRunMemory failed, skipping:', error instanceof Error ? error.message : error);
    return { ok: false, stored: false };
  }
}
