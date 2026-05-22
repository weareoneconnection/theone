import { ensureTheOneDatabase, prisma } from '../db/prisma';
import { recordTheOneEvent } from '../events/event-ledger';
import { packageRegistrySummary } from '../packages/package-registry';

export type LearningInsight = {
  id: string;
  category: 'policy' | 'worker' | 'connector' | 'automation' | 'memory' | 'package';
  title: string;
  summary: string;
  recommendation: string;
  targetType: string;
  targetId?: string | null;
  confidence: number;
  status: 'suggested' | 'applied' | 'dismissed';
  evidence: Record<string, unknown>;
  createdAt?: string;
  appliedAt?: string | null;
};

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseJson(value: string | null | undefined) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function iso(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value);
}

function parseInsight(row: any): LearningInsight {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    summary: row.summary,
    recommendation: row.recommendation,
    targetType: row.targettype ?? row.targetType,
    targetId: row.targetid ?? row.targetId,
    confidence: Number(row.confidence || 0.5),
    status: row.status,
    evidence: parseJson(row.evidencejson ?? row.evidenceJson) as Record<string, unknown>,
    createdAt: iso(row.createdat ?? row.createdAt) || undefined,
    appliedAt: iso(row.appliedat ?? row.appliedAt),
  };
}

async function upsertInsight(input: Omit<LearningInsight, 'createdAt' | 'appliedAt'>) {
  await prisma.$executeRawUnsafe(
    `insert into "TheOneLearningInsight" (id, category, title, summary, recommendation, targetType, targetId, confidence, status, evidenceJson)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set
       category = excluded.category,
       title = excluded.title,
       summary = excluded.summary,
       recommendation = excluded.recommendation,
       targetType = excluded.targetType,
       targetId = excluded.targetId,
       confidence = excluded.confidence,
       status = excluded.status,
       evidenceJson = excluded.evidenceJson`,
    input.id,
    input.category,
    input.title,
    input.summary,
    input.recommendation,
    input.targetType,
    input.targetId || null,
    input.confidence,
    input.status,
    safeJson(input.evidence)
  );
}

async function recentRunStats() {
  const rows = await prisma.theOneRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      ok: true,
      intentType: true,
      objective: true,
      resultJson: true,
      createdAt: true,
    },
  });
  const runs = rows.map((row) => ({
    ok: Boolean(row.ok),
    intentType: row.intentType,
    objective: row.objective,
    result: parseJson(row.resultJson) as any,
    createdAt: row.createdAt,
  }));
  const failed = runs.filter((run) => !run.ok || run.result?.error);
  const pendingApproval = runs.filter((run) => (run.result?.approvals || []).some((approval: any) => approval.required && approval.status === 'pending'));
  const blocked = runs.filter((run) => String(run.result?.os?.workflow?.status || '').toLowerCase() === 'blocked' || (run.result?.executions || []).some((execution: any) => execution.status === 'blocked' || execution.status === 'failed'));
  return { runs, failed, pendingApproval, blocked };
}

async function recentEventStats() {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `select type, provider, status, summary, payloadJson, createdAt from "TheOneEvent" order by createdAt desc limit 80`
  );
  const events = rows.map((row) => ({
    type: row.type,
    provider: row.provider,
    status: row.status,
    summary: row.summary,
    payload: parseJson(row.payloadjson ?? row.payloadJson),
    createdAt: row.createdat ?? row.createdAt,
  }));
  const failures = events.filter((event) => /failed|error|blocked|rejected/i.test(`${event.status} ${event.summary}`));
  const external = events.filter((event) => String(event.type).startsWith('external.'));
  return { events, failures, external };
}

function uniqueInsights(items: Array<Omit<LearningInsight, 'createdAt' | 'appliedAt'>>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.category}:${item.targetType}:${item.targetId}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runLearningCycle() {
  await ensureTheOneDatabase();
  const [runs, events, packages] = await Promise.all([
    recentRunStats(),
    recentEventStats(),
    packageRegistrySummary(),
  ]);
  const insights: Array<Omit<LearningInsight, 'createdAt' | 'appliedAt'>> = [];

  if (runs.failed.length >= 2) {
    insights.push({
      id: 'learn_failure_recovery_policy',
      category: 'policy',
      title: 'Repeated run failures detected',
      summary: `${runs.failed.length} of the last ${runs.runs.length} runs failed or returned errors.`,
      recommendation: 'Tighten auto-run policy for the affected actions and require preflight proof before execution.',
      targetType: 'policy_pack',
      targetId: 'policy_pack.theone.default',
      confidence: Math.min(0.95, 0.55 + runs.failed.length * 0.08),
      status: 'suggested',
      evidence: { failed: runs.failed.slice(0, 5).map((run) => ({ intentType: run.intentType, objective: run.objective, error: run.result?.error })) },
    });
  }

  if (runs.pendingApproval.length >= 3) {
    insights.push({
      id: 'learn_approval_bottleneck',
      category: 'automation',
      title: 'Approval bottleneck detected',
      summary: `${runs.pendingApproval.length} recent runs are waiting for approval.`,
      recommendation: 'Create narrower auto policies for low-risk read/reply actions, while keeping public writes manual.',
      targetType: 'automation',
      targetId: 'approval_queue',
      confidence: 0.78,
      status: 'suggested',
      evidence: { pending: runs.pendingApproval.slice(0, 5).map((run) => run.objective) },
    });
  }

  if (events.failures.length >= 2) {
    insights.push({
      id: 'learn_event_failure_circuit',
      category: 'worker',
      title: 'Worker or event failure pattern detected',
      summary: `${events.failures.length} recent event ledger entries indicate failure, block, or rejection.`,
      recommendation: 'Open circuit breakers earlier for the related worker and add a recovery run before retry.',
      targetType: 'worker',
      targetId: String(events.failures[0]?.provider || 'unknown_worker'),
      confidence: 0.74,
      status: 'suggested',
      evidence: { failures: events.failures.slice(0, 6) },
    });
  }

  const disabledPackages = packages.packages.filter((item: any) => item.status === 'installed' && !item.enabled);
  if (disabledPackages.length > 0) {
    insights.push({
      id: 'learn_disabled_installed_packages',
      category: 'package',
      title: 'Installed packages are disabled',
      summary: `${disabledPackages.length} installed package(s) are currently disabled.`,
      recommendation: 'Review disabled installed packages and either re-enable them or mark them explicitly unavailable.',
      targetType: 'package',
      targetId: disabledPackages[0].id,
      confidence: 0.66,
      status: 'suggested',
      evidence: { packages: disabledPackages.slice(0, 8).map((item: any) => ({ id: item.id, title: item.title })) },
    });
  }

  if (events.external.length > 0 && runs.runs.length > 0) {
    insights.push({
      id: 'learn_event_to_run_feedback',
      category: 'memory',
      title: 'Event-to-run feedback loop is active',
      summary: `${events.external.length} external event(s) and ${runs.runs.length} run(s) are available for learning.`,
      recommendation: 'Preserve event summaries as memory hints so future routing can use prior outcomes.',
      targetType: 'memory',
      targetId: 'event_feedback',
      confidence: 0.7,
      status: 'suggested',
      evidence: { externalEvents: events.external.slice(0, 5), recentRuns: runs.runs.slice(0, 5).map((run) => run.objective) },
    });
  }

  const finalInsights = uniqueInsights(insights);
  for (const insight of finalInsights) {
    await upsertInsight(insight);
  }
  await recordTheOneEvent({
    type: 'learning.cycle',
    provider: 'theone',
    status: 'completed',
    summary: `Learning cycle generated ${finalInsights.length} insight(s).`,
    payload: { insights: finalInsights },
  });

  return {
    ok: true,
    generated: finalInsights.length,
    insights: finalInsights,
  };
}

export async function listLearningInsights(limit = 30) {
  await ensureTheOneDatabase();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `select * from "TheOneLearningInsight" order by createdAt desc limit $1`,
    Math.max(1, Math.min(limit, 100))
  );
  return rows.map(parseInsight);
}

export async function updateLearningInsight(input: { id: string; status: 'applied' | 'dismissed' | 'suggested' }) {
  await ensureTheOneDatabase();
  await prisma.$executeRawUnsafe(
    `update "TheOneLearningInsight" set status = $2, appliedAt = case when $2 = 'applied' then current_timestamp else appliedAt end where id = $1`,
    input.id,
    input.status
  );
  await recordTheOneEvent({
    type: 'learning.insight_updated',
    provider: 'theone',
    status: input.status,
    summary: `Learning insight ${input.id} marked ${input.status}.`,
    payload: input,
  });
  return listLearningInsights();
}
