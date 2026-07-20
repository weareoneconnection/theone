import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/theone/db/prisma', () => ({
  ensureTheOneDatabase: vi.fn().mockResolvedValue(undefined),
  isPgVectorAvailable: vi.fn().mockReturnValue(true),
  embeddingDimension: vi.fn().mockReturnValue(128),
  prisma: {
    theOneRun: {
      findMany: vi.fn().mockResolvedValue([
        {
          ok: true,
          resultJson: JSON.stringify({ multiAgentRuntime: { proof: [{ metadata: { llmAgents: 3 } }] } }),
          approvals: [],
        },
        {
          ok: false,
          resultJson: JSON.stringify({}),
          approvals: [{ required: true, status: 'pending' }],
        },
      ]),
    },
    theOneExecution: {
      findMany: vi.fn().mockResolvedValue([
        { status: 'success' },
        { status: 'running' },
      ]),
    },
    theOneMemory: {
      count: vi.fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([
      { type: 'automation.tick', createdat: new Date('2026-07-19T10:00:00Z') },
      { type: 'learning.cycle', createdat: new Date('2026-07-19T10:00:00Z') },
    ]),
  },
}));

describe('buildObservabilityReport', () => {
  it('aggregates runs, executions, memory, and automation metrics', async () => {
    const { buildObservabilityReport } = await import('@/lib/theone/observability/metrics-report');
    const report = await buildObservabilityReport(24);

    expect(report.ok).toBe(true);
    expect(report.runs.total).toBe(2);
    expect(report.runs.failed).toBe(1);
    expect(report.runs.pendingApproval).toBe(1);
    expect(report.runs.successRate).toBe(0.5);
    expect(report.agents.runsWithLlm).toBe(1);
    expect(report.agents.llmAdoptionRate).toBe(0.5);
    expect(report.executions.inFlight).toBe(1);
    expect(report.memory.embeddingCoverage).toBe(0.8);
    expect(report.memory.pgVector).toBe(true);
    expect(report.automation.learningCycles).toBe(1);
    expect(report.automation.lastTickAt).toBe('2026-07-19T10:00:00.000Z');
  });

  it('returns a safe empty report when the database is unavailable', async () => {
    const { ensureTheOneDatabase } = await import('@/lib/theone/db/prisma');
    vi.mocked(ensureTheOneDatabase).mockRejectedValueOnce(new Error('no database'));

    const { buildObservabilityReport } = await import('@/lib/theone/observability/metrics-report');
    const report = await buildObservabilityReport(24);

    expect(report.ok).toBe(false);
    expect(report.error).toBeTruthy();
    expect(report.runs.total).toBe(0);
  });
});
