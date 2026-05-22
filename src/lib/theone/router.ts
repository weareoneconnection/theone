import type { ClassifiedIntent } from './types';
import { getAgentByIntent } from './registry';

export async function routeIntent(intent: ClassifiedIntent) {
  const agent = getAgentByIntent(intent.type);

  return {
    target: intent.type,
    agent,
  };
}
