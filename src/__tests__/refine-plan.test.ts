import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClassifiedIntent, ExecutionPlan } from '@/lib/theone/types';

vi.mock('@/lib/theone/providers/oneai', () => ({
  runOneAI: vi.fn(),
  extractOneAIData: vi.fn().mockImplementation((r: { data?: unknown }) => r?.data ?? null),
  embedText: vi.fn().mockResolvedValue({ embedding: [], model: 'mock', mock: true }),
}));

const intent: ClassifiedIntent = {
  type: 'general',
  objective: 'Analyze the website',
  entities: [],
  constraints: [],
  priority: 'normal',
  confidence: 0.9,
  requiresApproval: false,
};

const plan: ExecutionPlan = {
  id: 'plan_1',
  intent,
  summary: 'Analyze website',
  steps: [
    { id: 's1', title: 'Analyze objective', action: 'oneai.generate', status: 'pending' },
    { id: 's2', title: 'Extract content', action: 'browser.extract', status: 'pending', dependsOn: ['s1'] },
  ],
  estimatedRisk: 'low',
};

describe('refinePlanWithLLM', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the original plan when the LLM declines to revise', async () => {
    const { runOneAI } = await import('@/lib/theone/providers/oneai');
    vi.mocked(runOneAI).mockResolvedValue({ success: true, data: { revise: false, reason: 'plan is fine' } } as never);

    const { refinePlanWithLLM } = await import('@/lib/theone/planners/refinePlan');
    const result = await refinePlanWithLLM({ intent, plan });

    expect(result.refined).toBe(false);
    expect(result.plan).toBe(plan);
  });

  it('applies a valid LLM revision', async () => {
    const { runOneAI } = await import('@/lib/theone/providers/oneai');
    vi.mocked(runOneAI).mockResolvedValue({
      success: true,
      data: {
        revise: true,
        reason: 'add extraction dependency ordering',
        steps: [
          { id: 's1', title: 'Extract content first', action: 'browser.extract' },
          { id: 's2', title: 'Then analyze', action: 'oneai.generate', dependsOn: ['s1'] },
        ],
      },
    } as never);

    const { refinePlanWithLLM } = await import('@/lib/theone/planners/refinePlan');
    const result = await refinePlanWithLLM({ intent, plan });

    expect(result.refined).toBe(true);
    expect(result.plan.steps[0].action).toBe('browser.extract');
    expect(result.plan.steps[1].dependsOn).toEqual(['s1']);
  });

  it('rejects revisions using disallowed actions', async () => {
    const { runOneAI } = await import('@/lib/theone/providers/oneai');
    vi.mocked(runOneAI).mockResolvedValue({
      success: true,
      data: {
        revise: true,
        reason: 'try a forbidden action',
        steps: [{ id: 's1', title: 'Transfer funds', action: 'web3.transfer' }],
      },
    } as never);

    const { refinePlanWithLLM } = await import('@/lib/theone/planners/refinePlan');
    const result = await refinePlanWithLLM({ intent, plan });

    expect(result.refined).toBe(false);
    expect(result.plan).toBe(plan);
  });

  it('rejects revisions with dangling dependencies', async () => {
    const { runOneAI } = await import('@/lib/theone/providers/oneai');
    vi.mocked(runOneAI).mockResolvedValue({
      success: true,
      data: {
        revise: true,
        reason: 'broken deps',
        steps: [{ id: 's1', title: 'Analyze', action: 'oneai.generate', dependsOn: ['s99'] }],
      },
    } as never);

    const { refinePlanWithLLM } = await import('@/lib/theone/planners/refinePlan');
    const result = await refinePlanWithLLM({ intent, plan });

    expect(result.refined).toBe(false);
  });

  it('returns the original plan when the LLM call fails', async () => {
    const { runOneAI } = await import('@/lib/theone/providers/oneai');
    vi.mocked(runOneAI).mockRejectedValue(new Error('network down'));

    const { refinePlanWithLLM } = await import('@/lib/theone/planners/refinePlan');
    const result = await refinePlanWithLLM({ intent, plan });

    expect(result.refined).toBe(false);
    expect(result.plan).toBe(plan);
  });
});
