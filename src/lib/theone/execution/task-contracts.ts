import type { ClassifiedIntent, OneClawTask } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = textValue(value);
    if (text) return text;
  }
  return '';
}

function nestedText(value: unknown, keys: string[]) {
  if (!isRecord(value)) return '';
  for (const key of keys) {
    const text = textValue(value[key]);
    if (text) return text;
  }
  return '';
}

function inferSocialContent(input: {
  stepInput: Record<string, unknown>;
  oneAiData: Record<string, unknown> | null | undefined;
  intent: ClassifiedIntent;
}) {
  const data = input.oneAiData || {};
  const draft = isRecord(data.draft) ? data.draft : null;
  const output = isRecord(data.output) ? data.output : null;
  const post = isRecord(data.post) ? data.post : null;
  const socialPost = isRecord(data.socialPost) ? data.socialPost : null;
  const content = isRecord(data.content) ? data.content : null;

  return firstText(
    input.stepInput.content,
    input.stepInput.text,
    input.stepInput.message,
    input.stepInput.body,
    data.content,
    data.text,
    data.message,
    data.body,
    data.reply,
    data.summary,
    nestedText(draft, ['content', 'text', 'message', 'body', 'tweet']),
    nestedText(output, ['content', 'text', 'message', 'body', 'tweet']),
    nestedText(post, ['content', 'text', 'message', 'body', 'tweet']),
    nestedText(socialPost, ['content', 'text', 'message', 'body', 'tweet']),
    nestedText(content, ['content', 'text', 'message', 'body', 'tweet']),
    input.intent.objective
  );
}

function trimXContent(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 280) return normalized;
  return `${normalized.slice(0, 276).trimEnd()}...`;
}

export function normalizeOneClawTaskContract(input: {
  task: OneClawTask | null | undefined;
  intent: ClassifiedIntent;
  oneAiData?: Record<string, unknown> | null;
}) {
  if (!input.task) return null;
  let repaired = false;
  const repairs: string[] = [];

  const steps = input.task.steps.map((step) => {
    const stepInput = isRecord(step.input) ? step.input : {};

    if (step.action === 'social.post') {
      const content = inferSocialContent({
        stepInput,
        oneAiData: input.oneAiData,
        intent: input.intent,
      });

      if (content) {
        const normalizedContent = trimXContent(content);
        const hasContent = textValue(stepInput.content);
        const needsRepair = !hasContent || hasContent !== normalizedContent;
        if (needsRepair) {
          repaired = true;
          repairs.push(`${step.id}.input.content`);
        }
        if (needsRepair || !textValue(stepInput.channel)) {
          return {
            ...step,
            input: {
              ...stepInput,
              channel: textValue(stepInput.channel) || 'x',
              content: normalizedContent,
            },
          };
        }
      }
    }

    return {
      ...step,
      input: stepInput,
    };
  });

  return {
    ...input.task,
    steps,
    metadata: {
      ...(input.task.metadata || {}),
      contract: {
        ...(isRecord(input.task.metadata?.contract) ? input.task.metadata.contract : {}),
        normalizedBy: 'theone.task_contracts.v1',
        repaired,
        repairs,
      },
    },
  };
}
