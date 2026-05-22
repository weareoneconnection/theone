import type { ClassifiedIntent } from '../types';

export function normalizeIntent(intent: ClassifiedIntent): ClassifiedIntent {
  return {
    ...intent,
    objective: intent.objective.trim(),
    entities: Array.from(new Set(intent.entities)),
    constraints: Array.from(new Set(intent.constraints)),
  };
}
