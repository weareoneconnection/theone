import { ensureTheOneDatabase, isPgVectorAvailable, prisma } from '../db/prisma';

export type ObservabilityReport = {
  ok: boolean;
  generatedAt: string;
  window: { hours: number };
  runs: {
    total: number;
    failed: number;
    pendingApproval: number;
    successRate: number;
  };
  agents: {
    runsWithLlm: number;
    runsRuleOnly: number;
    llmAdoptionRate: number;
  };
  executions: {
    total: number;
    byStatus: Record<string, number>;
    inFlight: number;
  };
  memory: {
    total: number;
    withEmbedding: number;
    embeddingCoverage: number;
    pgVector: boolean;
  };
  automation: {
    tickEvents: number;
    lastTickAt: string | null;
    learningCycles: number;
    executionSyncs: number;
  };
  error?: string;
};

function emptyReport(hours: number, error?: string): ObservabilityReport {
  return {
    ok: false,
    generatedAt: new Date().toISOString(),
    window: { hours },
    runs: { total: 0, failed: 0, pendingApproval: 0, successRate: 0 },
    agents: { runsWithLlm: 0, runsRuleOnly: 0, llmAdoptionRate: 0 },
    executions: { total: 0, byStatus: {}, inFlight: 0 },
    memory: { total: 0, withEmbedding: 0, embeddingCoverage: 0, pgVector: false },
    automation: { tickEvents: 0, lastTickAt: null, learningCycles: 0, executionSyncs: 0 },
    error,
  };
}

export async function buildObservabilityReport(hours = 24): Promise<ObservabilityReport> {
  const windowHours = Math.max(1, Math.min(hours, 168));
  const since = new Date(Date.now() - windowHours * 3_600_000);

  try {
    await ensureTheOneDatabase();

    const [runs, executions, memoryTotal, memoryWithEmbedding, events] = await Promise.all([
      prisma.theOneRun.findMany({
        where: { createdAt: { gte: since } },
        select: { ok: true, resultJson: true, approvals: { select: { required: true, status: true } } },
        take: 500,
      }),
      prisma.theOneExecution.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true },
        take: 1000,
      }),
      prisma.theOneMemory.count(),
      prisma.theOneMemory.count({ where: { embeddingJson: { not: null } } }),
      prisma.$queryRawUnsafe<{ type: string; createdat: Date | string }[]>(
        `select type, createdAt as createdat from "TheOneEvent"
         where createdAt >= $1 and type in ('automation.tick', 'learning.cycle', 'execution.synced', 'execution.submitted')
         order by createdAt desc limit 500`,
        since,
      ).catch(() => []),
    ]);

    const failed = runs.filter((run) => !run.ok).length;
    const pendingApproval = runs.filter((run) =>
      run.approvals.some((approval) => approval.required && approval.status === 'pending'),
    ).length;

    let runsWithLlm = 0;
    for (const run of runs) {
      try {
        const parsed = JSON.parse(run.resultJson) as {
          multiAgentRuntime?: { proof?: { metadata?: { llmAgents?: number } }[] };
        };
        const llmAgents = parsed.multiAgentRuntime?.proof?.[0]?.metadata?.llmAgents ?? 0;
        if (llmAgents > 0) runsWithLlm += 1;
      } catch {
        // unparseable result — count as rule-only
      }
    }

    const byStatus: Record<string, number> = {};
    for (const execution of executions) {
      byStatus[execution.status] = (byStatus[execution.status] || 0) + 1;
    }
    const inFlight = (byStatus.submitted || 0) + (byStatus.running || 0) + (byStatus.pending || 0) + (byStatus.queued || 0);

    const learningCycles = events.filter((event) => event.type === 'learning.cycle').length;
    const executionSyncs = events.filter((event) => event.type === 'execution.synced').length;
    const tickLike = events.filter((event) => event.type === 'automation.tick' || event.type === 'learning.cycle' || event.type === 'execution.synced');
    const lastTick = tickLike[0]?.createdat ?? null;

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      window: { hours: windowHours },
      runs: {
        total: runs.length,
        failed,
        pendingApproval,
        successRate: runs.length > 0 ? Math.round(((runs.length - failed) / runs.length) * 100) / 100 : 0,
      },
      agents: {
        runsWithLlm,
        runsRuleOnly: runs.length - runsWithLlm,
        llmAdoptionRate: runs.length > 0 ? Math.round((runsWithLlm / runs.length) * 100) / 100 : 0,
      },
      executions: { total: executions.length, byStatus, inFlight },
      memory: {
        total: memoryTotal,
        withEmbedding: memoryWithEmbedding,
        embeddingCoverage: memoryTotal > 0 ? Math.round((memoryWithEmbedding / memoryTotal) * 100) / 100 : 0,
        pgVector: isPgVectorAvailable(),
      },
      automation: {
        tickEvents: tickLike.length,
        lastTickAt: lastTick ? new Date(lastTick).toISOString() : null,
        learningCycles,
        executionSyncs,
      },
    };
  } catch (error) {
    return emptyReport(windowHours, error instanceof Error ? error.message : 'observability report failed');
  }
}
