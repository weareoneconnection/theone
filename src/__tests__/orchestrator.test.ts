import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntentInput } from '@/lib/theone/types';

// ── Provider mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/theone/providers/oneai', () => ({
  runOneAI: vi.fn().mockResolvedValue({
    success: true,
    mock: false,
    data: { reply: 'Mock OneAI response', shouldExecute: false, oneclawTask: null },
  }),
  extractOneAIData: vi.fn().mockImplementation((r: { data?: unknown }) => r?.data ?? null),
  getOneAIProviderStatus: vi.fn().mockReturnValue({
    key: 'oneai', label: 'OneAI', configured: true, mode: 'live', status: 'ready', capabilities: [],
  }),
  checkOneAIConnection: vi.fn().mockResolvedValue({ ok: true, status: 'connected' }),
  extractOneAIPlannedOneClawTask: vi.fn().mockReturnValue(null),
  embedText: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2], model: 'mock', mock: true }),
}));

vi.mock('@/lib/theone/providers/oneclaw', () => ({
  getOneClawConfig: vi.fn().mockReturnValue({ baseUrl: 'http://mock', token: 'mock-token', configured: false }),
  getOneClawCapabilityManifest: vi.fn().mockResolvedValue({
    ok: true, service: 'oneclaw', version: '1.0', capabilities: [], source: 'fallback',
    fetchedAt: new Date().toISOString(),
  }),
  getOneClawBridgeStatus: vi.fn().mockResolvedValue({
    ok: true, bridge: { id: 'bridge_mock', name: 'Mock Bridge', mode: 'api', role: 'api_service', online: true, platform: 'test' },
  }),
  runOneClawTask: vi.fn().mockResolvedValue({ id: 'task_mock', status: 'success', mock: true }),
  getOneClawTask: vi.fn().mockResolvedValue({ status: 'success' }),
  getOneClawProviderStatus: vi.fn().mockReturnValue({
    key: 'oneclaw', label: 'OneClaw', configured: true, mode: 'live', status: 'ready', capabilities: [],
  }),
  checkOneClawConnection: vi.fn().mockResolvedValue({ ok: true, status: 'connected' }),
  listOneClawApprovals: vi.fn().mockResolvedValue([]),
  runOneClaw: vi.fn().mockResolvedValue({ ok: true }),
  runOneClawAction: vi.fn().mockResolvedValue({ ok: true }),
  listOneClawPendingApprovals: vi.fn().mockResolvedValue([]),
  approveOneClawApproval: vi.fn().mockResolvedValue({ ok: true }),
  rejectOneClawApproval: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/theone/providers/onefield', () => ({
  pushNetworkSignals: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/theone/providers/mission', () => ({
  recordMissionProof: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/theone/memory', () => ({
  storeRunMemory: vi.fn().mockResolvedValue({ ok: true, stored: true }),
}));

vi.mock('@/lib/theone/state/run-store', () => ({
  saveRunResult: vi.fn().mockImplementation((r: { runId?: string }) => Promise.resolve({ ...r, runId: r.runId || 'run_saved' })),
  queryMemoryGraph: vi.fn().mockResolvedValue([]),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runTheOne — orchestrator happy path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ok: true for a well-formed general intent', async () => {
    const { runTheOne } = await import('@/lib/theone/orchestrator');
    const input: IntentInput = {
      raw: 'Analyze the website and summarize the main topics',
      mode: 'assist',
    };

    const result = await runTheOne(input);

    expect(result.ok).toBe(true);
    expect(result.runId).toMatch(/^run_/);
    expect(result.intent).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.plan.steps.length).toBeGreaterThan(0);
  });

  it('returns ok: false and a non-empty error when input is empty', async () => {
    const { runTheOne } = await import('@/lib/theone/orchestrator');
    const result = await runTheOne({ raw: '   ' });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('always includes proof records on success', async () => {
    const { runTheOne } = await import('@/lib/theone/orchestrator');
    const result = await runTheOne({ raw: 'Prepare a weekly content brief', mode: 'assist' });

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.proof)).toBe(true);
  });

  it('populates os.workflow with steps matching the plan', async () => {
    const { runTheOne } = await import('@/lib/theone/orchestrator');
    const result = await runTheOne({ raw: 'Summarize the team mission', mode: 'manual' });

    expect(result.ok).toBe(true);
    expect(result.os?.workflow).toBeDefined();
    expect(result.os?.workflow.steps.length).toBeGreaterThan(0);
  });

  it('populates multiAgentRuntime with 5 agents', async () => {
    const { runTheOne } = await import('@/lib/theone/orchestrator');
    const result = await runTheOne({ raw: 'Research the latest trends in AI automation', mode: 'assist' });

    expect(result.ok).toBe(true);
    const mar = result.multiAgentRuntime as { agents?: unknown[] } | undefined;
    expect(mar?.agents).toBeDefined();
    expect((mar?.agents as unknown[]).length).toBe(5);
  });

  it('sets pendingOneClawTask to null when no external execution needed', async () => {
    const { runTheOne } = await import('@/lib/theone/orchestrator');
    const result = await runTheOne({ raw: 'Write a brief summary of AI trends', mode: 'manual' });

    expect(result.ok).toBe(true);
    // In mock mode with no oneclawTask from OneAI, should be null
    expect(result.pendingOneClawTask).toBeNull();
  });

  it('includes context frame with resource summary', async () => {
    const { runTheOne } = await import('@/lib/theone/orchestrator');
    const result = await runTheOne({ raw: 'Prepare a mission brief for the team', mode: 'assist' });

    expect(result.ok).toBe(true);
    expect(result.contextFrame).toBeDefined();
    expect(typeof result.contextFrame?.summary.resourceCount).toBe('number');
  });

  it('classifies growth intent correctly', async () => {
    const { runTheOne } = await import('@/lib/theone/orchestrator');
    const result = await runTheOne({ raw: 'Grow our X followers and increase engagement', mode: 'assist' });

    expect(result.ok).toBe(true);
    expect(result.intent.type).toBe('growth');
  });

  it('classifies knowledge intent correctly', async () => {
    const { runTheOne } = await import('@/lib/theone/orchestrator');
    const result = await runTheOne({ raw: 'Research and summarize the latest papers on LLM agents', mode: 'assist' });

    expect(result.ok).toBe(true);
    expect(result.intent.type).toBe('knowledge');
  });
});
