import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MultiAgentInput } from '@/lib/theone/agents/multi-agent-runtime';

// Mock OneAI so tests never hit the real API
vi.mock('@/lib/theone/providers/oneai', () => ({
  runOneAI: vi.fn().mockResolvedValue({ success: false, data: null, mock: true }),
  extractOneAIData: vi.fn().mockReturnValue(null),
  embedText: vi.fn().mockResolvedValue({ embedding: [], model: 'mock', mock: true }),
}));

// Mock receipts
vi.mock('@/lib/theone/providers/receipts', () => ({
  receiptForTheOne: vi.fn().mockReturnValue({ id: 'receipt_mock' }),
}));

// Mock workflow-runtime helpers
vi.mock('@/lib/theone/runtime/workflow-runtime', () => ({
  createExecutionRecord: vi.fn().mockImplementation((input: Record<string, unknown>) => ({
    id: `exec_${Date.now()}`,
    provider: input.provider,
    status: input.status,
    summary: input.summary,
    raw: input.raw,
  })),
}));

// Mock approval-policy
vi.mock('@/lib/theone/policy/approval-policy', () => ({
  getActionRisk: vi.fn().mockImplementation((action: string) => {
    if (['social.post', 'code.patch.apply', 'trading.place'].includes(action)) return 'high';
    if (['browser.open', 'api.request'].includes(action)) return 'medium';
    return 'low';
  }),
}));

const buildInput = (overrides: Partial<MultiAgentInput> = {}): MultiAgentInput => ({
  runId: 'run_test_001',
  mode: 'assist',
  intent: {
    type: 'general',
    objective: 'Analyze the website and prepare a content report',
    entities: ['website'],
    constraints: [],
    priority: 'normal',
    confidence: 0.85,
    requiresApproval: false,
  },
  plan: {
    id: 'plan_001',
    intent: {
      type: 'general',
      objective: 'Analyze the website and prepare a content report',
      entities: [],
      constraints: [],
      priority: 'normal',
      confidence: 0.85,
      requiresApproval: false,
    },
    summary: 'Analyze website content',
    steps: [
      { id: 's1', title: 'Extract content', action: 'browser.extract', status: 'pending' },
      { id: 's2', title: 'Generate report', action: 'oneai.generate', status: 'pending', dependsOn: ['s1'] },
    ],
    estimatedRisk: 'medium',
  },
  approvals: [],
  permissions: [],
  memoryContext: [],
  contextFrame: {
    id: 'ctx_001',
    runId: 'run_test_001',
    mode: 'assist',
    objective: 'Analyze website',
    createdAt: new Date().toISOString(),
    resources: [],
    summary: {
      resourceCount: 0,
      connectorCount: 0,
      memoryHitCount: 0,
      approvalCount: 0,
      executionCount: 0,
      permissionSummary: { allowed: 0, requiresApproval: 0, denied: 0 },
    },
  },
  ...overrides,
});

describe('runMultiAgentRuntime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a valid runtime result with all 5 agents', async () => {
    const { runMultiAgentRuntime } = await import('@/lib/theone/agents/multi-agent-runtime');
    const result = await runMultiAgentRuntime(buildInput());

    expect(result.agents).toHaveLength(5);
    expect(result.agents.map((a) => a.role)).toEqual(
      expect.arrayContaining(['planner', 'policy', 'critic', 'operator', 'memory']),
    );
    expect(['pass', 'warn', 'block']).toContain(result.status);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it('blocks when a permission is denied', async () => {
    const { runMultiAgentRuntime } = await import('@/lib/theone/agents/multi-agent-runtime');
    const input = buildInput({
      permissions: [{
        id: 'perm_1',
        scope: 'submit_external',
        resourceId: 'oneclaw',
        resourceKind: 'provider',
        provider: 'oneclaw',
        status: 'denied',
        risk: 'high',
        mode: 'assist',
        reason: 'Auto mode not enabled',
      }],
    });

    const result = await runMultiAgentRuntime(input);
    const policyAgent = result.agents.find((a) => a.role === 'policy');
    expect(policyAgent?.status).toBe('block');
    expect(result.consensus.status).toBe('block');
  });

  it('warns when plan has high-risk actions', async () => {
    const { runMultiAgentRuntime } = await import('@/lib/theone/agents/multi-agent-runtime');
    const input = buildInput({
      plan: {
        id: 'plan_risky',
        intent: {
          type: 'growth',
          objective: 'Post marketing content to X',
          entities: [],
          constraints: [],
          priority: 'high',
          confidence: 0.9,
          requiresApproval: true,
        },
        summary: 'Social media growth',
        steps: [
          { id: 's1', title: 'Post tweet', action: 'social.post', status: 'pending' },
        ],
        estimatedRisk: 'high',
      },
    });

    const result = await runMultiAgentRuntime(input);
    const criticAgent = result.agents.find((a) => a.role === 'critic');
    expect(criticAgent?.status).toBe('warn');
  });

  it('falls back to rule-based agents when LLM returns null (mock mode)', async () => {
    const { runMultiAgentRuntime } = await import('@/lib/theone/agents/multi-agent-runtime');
    const result = await runMultiAgentRuntime(buildInput());

    // All agents should have llm: false in mock mode (runOneAI returns success: false)
    result.agents.forEach((agent) => {
      expect(agent.llm).toBe(false);
    });
  });

  it('returns proof record with consensus summary', async () => {
    const { runMultiAgentRuntime } = await import('@/lib/theone/agents/multi-agent-runtime');
    const result = await runMultiAgentRuntime(buildInput());

    expect(result.proof).toHaveLength(1);
    expect(result.proof[0].type).toBe('system');
    expect(result.proof[0].title).toBe('Multi-agent runtime consensus');
    expect(typeof result.proof[0].value).toBe('string');
  });

  it('assigns leases to all agents and marks them released', async () => {
    const { runMultiAgentRuntime } = await import('@/lib/theone/agents/multi-agent-runtime');
    const result = await runMultiAgentRuntime(buildInput());

    expect(result.leases).toHaveLength(5);
    result.leases.forEach((lease) => {
      expect(lease.status).toBe('released');
      expect(lease.scope).toContain('run:run_test_001');
    });
  });

  it('sets memory agent to warn when no memory hits exist', async () => {
    const { runMultiAgentRuntime } = await import('@/lib/theone/agents/multi-agent-runtime');
    const result = await runMultiAgentRuntime(buildInput({ memoryContext: [] }));
    const memAgent = result.agents.find((a) => a.role === 'memory');
    expect(memAgent?.status).toBe('warn');
  });

  it('sets memory agent to pass when memory hits exist', async () => {
    const { runMultiAgentRuntime } = await import('@/lib/theone/agents/multi-agent-runtime');
    const input = buildInput({
      memoryContext: [{
        id: 'mem_1', kind: 'general', title: 'Prior run', summary: 'Previous analysis',
        score: 8, matchedTerms: ['analyze'], createdAt: new Date().toISOString(), runId: 'run_0',
        run: { id: 'run_0', intentType: 'general', objective: 'Previous' },
      }],
    });
    const result = await runMultiAgentRuntime(input);
    const memAgent = result.agents.find((a) => a.role === 'memory');
    expect(memAgent?.status).toBe('pass');
  });
});
