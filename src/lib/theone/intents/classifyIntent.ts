import type { ClassifiedIntent, IntentInput } from '../types';

export async function classifyIntent(input: IntentInput): Promise<ClassifiedIntent> {
  const raw = input.raw.toLowerCase();

  if (raw.includes('赚钱') || raw.includes('profit') || raw.includes('trade') || raw.includes('money')) {
    return {
      type: 'financial',
      objective: input.raw,
      entities: ['trading', 'capital'],
      constraints: ['guarded execution'],
      priority: 'high',
      confidence: 0.92,
      requiresApproval: true,
    };
  }

  if (raw.includes('x ') || raw.includes('twitter') || raw.includes('followers') || raw.includes('粉丝') || raw.includes('grow')) {
    return {
      type: 'growth',
      objective: input.raw,
      entities: ['social', 'audience'],
      constraints: ['brand-safe'],
      priority: 'high',
      confidence: 0.89,
      requiresApproval: true,
    };
  }

  if (raw.includes('mission') || raw.includes('任务') || raw.includes('leaderboard')) {
    return {
      type: 'mission',
      objective: input.raw,
      entities: ['mission', 'reward'],
      constraints: [],
      priority: 'normal',
      confidence: 0.86,
      requiresApproval: false,
    };
  }

  if (raw.includes('research') || raw.includes('knowledge') || raw.includes('总结') || raw.includes('positioning')) {
    return {
      type: 'knowledge',
      objective: input.raw,
      entities: ['knowledge'],
      constraints: [],
      priority: 'normal',
      confidence: 0.83,
      requiresApproval: false,
    };
  }

  return {
    type: 'general',
    objective: input.raw,
    entities: [],
    constraints: [],
    priority: 'normal',
    confidence: 0.74,
    requiresApproval: false,
  };
}
