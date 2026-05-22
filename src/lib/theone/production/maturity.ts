import { listAutomationJobs } from '../automation/scheduler';
import { listTheOneEvents } from '../events/event-ledger';
import { listLearningInsights } from '../learning/learning-engine';
import { packageRegistrySummary } from '../packages/package-registry';
import { listAutomationPolicyRules } from '../policy/policy-registry';
import { listWorkerRuntimes } from '../workers/runtime-registry';

export type ProductionMaturityCapability = {
  key: string;
  title: string;
  level: string;
  status: 'live' | 'guarded' | 'partial' | 'planned';
  score: number;
  current: string;
  target: string;
  controls: string[];
  gaps: string[];
  nextActions: string[];
};

export type ProductionMaturityReport = {
  ok: true;
  level: 'L17';
  label: string;
  score: number;
  readiness: 'prototype' | 'alpha' | 'production_candidate';
  summary: string;
  capabilities: ProductionMaturityCapability[];
  evidence: {
    workers: { total: number; live: number; guarded: number; prepared: number; missing: number };
    automation: { total: number; active: number; paused: number; circuitOpen: number };
    packages: { total: number; installed: number; enabled: number; byKind: Record<string, number> };
    policyRules: number;
    learning: { total: number; suggested: number; applied: number; dismissed: number };
    events: { total: number; failures: number; traces: number };
  };
};

function pct(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function readiness(score: number): ProductionMaturityReport['readiness'] {
  if (score >= 82) return 'production_candidate';
  if (score >= 58) return 'alpha';
  return 'prototype';
}

export async function getProductionMaturityReport(): Promise<ProductionMaturityReport> {
  const [workers, jobs, packages, rules, insights, events] = await Promise.all([
    listWorkerRuntimes(),
    listAutomationJobs(),
    packageRegistrySummary(),
    listAutomationPolicyRules(),
    listLearningInsights(50),
    listTheOneEvents(120),
  ]);

  const workerStats = {
    total: workers.length,
    live: workers.filter((item: any) => item.status === 'live').length,
    guarded: workers.filter((item: any) => item.status === 'guarded').length,
    prepared: workers.filter((item: any) => item.status === 'prepared').length,
    missing: workers.filter((item: any) => item.status === 'missing').length,
  };
  const automationStats = {
    total: jobs.length,
    active: jobs.filter((item) => item.status === 'active').length,
    paused: jobs.filter((item) => item.status === 'paused').length,
    circuitOpen: jobs.filter((item) => item.circuitOpen).length,
  };
  const learningStats = {
    total: insights.length,
    suggested: insights.filter((item) => item.status === 'suggested').length,
    applied: insights.filter((item) => item.status === 'applied').length,
    dismissed: insights.filter((item) => item.status === 'dismissed').length,
  };
  const eventStats = {
    total: events.length,
    failures: events.filter((item: any) => /failed|error|blocked|rejected/i.test(`${item.status} ${item.summary}`)).length,
    traces: events.filter((item: any) => /run|execution|automation|learning|event/i.test(String(item.type))).length,
  };

  const packageKinds = packages.byKind || {};
  const capabilities: ProductionMaturityCapability[] = [
    {
      key: 'stable_worker_queue',
      title: 'Stable Worker Queue',
      level: 'L17.1',
      status: jobs.length > 0 ? 'guarded' : 'planned',
      score: Math.min(82, 42 + automationStats.active * 12 + jobs.length * 6 - automationStats.circuitOpen * 8),
      current: 'Automation jobs, cooldowns, daily limits, failure streaks, and circuit breakers are registered.',
      target: 'Durable distributed queue with lease, retry, dead-letter, replay, and per-worker concurrency limits.',
      controls: ['daily run limit', 'cooldown', 'failure streak', 'circuit breaker', 'event-triggered routing'],
      gaps: ['no external queue backend yet', 'no dead-letter table yet', 'limited concurrency isolation'],
      nextActions: ['add durable queue backend', 'persist retry schedule', 'add per-worker concurrency cap'],
    },
    {
      key: 'sandboxed_execution',
      title: 'Sandboxed Execution',
      level: 'L17.2',
      status: 'partial',
      score: 55,
      current: 'Execution is guarded by policy, preflight, connector readiness, approval modes, and OneClaw action manifests.',
      target: 'Every worker runs in a declared sandbox with egress, file, credential, network, and rollback boundaries.',
      controls: ['preflight', 'connector readiness', 'approval gates', 'risk levels', 'dry-run metadata'],
      gaps: ['sandbox is policy-level, not runtime-isolated', 'no per-package credential scope enforcement yet'],
      nextActions: ['add sandbox profile to packages', 'block unknown egress by default', 'attach rollback plan to write actions'],
    },
    {
      key: 'policy_pack_effective',
      title: 'Policy Pack Runtime',
      level: 'L17.3',
      status: rules.length > 0 ? 'guarded' : 'planned',
      score: Math.min(88, 50 + rules.length * 4),
      current: `${rules.length} automation policy rule(s) are loaded and used by TheOne before OneClaw execution.`,
      target: 'Installable policy packs with version pinning, tests, rollout windows, and package-level overrides.',
      controls: ['automation rules', 'mode matching', 'action matching', 'condition matching', 'risk escalation'],
      gaps: ['no policy pack version migration tests yet', 'limited simulation before activation'],
      nextActions: ['add policy pack test endpoint', 'add staged rollout', 'record policy decision receipts'],
    },
    {
      key: 'learning_policy_loop',
      title: 'Learning Insight To Policy',
      level: 'L17.4',
      status: learningStats.total > 0 ? 'partial' : 'planned',
      score: Math.min(80, 38 + learningStats.suggested * 6 + learningStats.applied * 12),
      current: 'Learning Engine generates and stores improvement insights from runs, events, approvals, and package state.',
      target: 'Approved learning insights can safely propose policy diffs, run simulations, and apply with rollback.',
      controls: ['learning cycle', 'insight evidence', 'confidence score', 'apply/dismiss state'],
      gaps: ['applied insight is not yet a generated policy diff', 'no automated rollback for learning changes'],
      nextActions: ['convert applied insights into draft policy rules', 'simulate before apply', 'record rollback recipe'],
    },
    {
      key: 'agent_eval_rollback',
      title: 'Agent Eval And Rollback',
      level: 'L17.5',
      status: 'partial',
      score: 58,
      current: 'Multi-agent quorum runs Planner, Policy, Critic, Operator, and Memory roles before final execution.',
      target: 'Every agent plan receives eval score, regression check, rollback route, and post-run quality review.',
      controls: ['multi-agent quorum', 'critic verdict', 'policy verdict', 'proof ledger', 'run replay/resume'],
      gaps: ['no formal eval dataset', 'rollback is replay/resume-level, not state-level'],
      nextActions: ['add golden task evals', 'score every plan', 'require rollback plan for high-risk actions'],
    },
    {
      key: 'package_isolation',
      title: 'Package Isolation',
      level: 'L17.6',
      status: packages.total > 0 ? 'guarded' : 'planned',
      score: Math.min(82, 46 + pct(packages.enabled, packages.total) / 2),
      current: `${packages.total} package(s) are registered across apps, workers, connectors, and policy packs.`,
      target: 'Packages install with signed manifests, compatibility constraints, tenant scope, sandbox profile, and version lock.',
      controls: ['package kind', 'version', 'enabled flag', 'manifest', 'dependencies'],
      gaps: ['no signature verification', 'no compatibility solver', 'no tenant-specific package install table'],
      nextActions: ['add package signature field', 'add sandbox profile', 'add tenant install scope'],
    },
    {
      key: 'end_to_end_trace',
      title: 'TheOne / OneAI / OneClaw Trace',
      level: 'L17.7',
      status: eventStats.traces > 0 ? 'guarded' : 'partial',
      score: Math.min(86, 44 + pct(eventStats.traces, Math.max(1, eventStats.total)) / 2),
      current: 'Run, event, proof, approval, automation, and learning records are written into TheOne ledgers.',
      target: 'Single trace ID across intent, OneAI planning, policy, OneClaw execution, provider receipts, and memory.',
      controls: ['runId', 'event ledger', 'proof ledger', 'provider receipts', 'sandbox log panel'],
      gaps: ['trace IDs are not yet propagated to every provider call', 'no distributed timeline export'],
      nextActions: ['propagate traceId headers', 'normalize provider spans', 'add trace export endpoint'],
    },
    {
      key: 'tenant_permission_boundary',
      title: 'Tenant And Permission Boundary',
      level: 'L17.8',
      status: 'planned',
      score: 36,
      current: 'TheOne has a permission model and identity connector concept, but runtime data is still global.',
      target: 'Every run, package, worker, credential, memory, approval, and proof record is scoped to tenant, user, and role.',
      controls: ['permission model', 'identity connector', 'approval gates', 'connector scopes'],
      gaps: ['no tenantId on persisted records', 'no role assignment store', 'no per-tenant secret binding'],
      nextActions: ['add tenant context middleware', 'add tenantId columns', 'bind package installs and credentials to tenant'],
    },
  ];

  const score = Math.round(capabilities.reduce((sum, item) => sum + item.score, 0) / capabilities.length);

  return {
    ok: true,
    level: 'L17',
    label: 'Production Maturity Layer',
    score,
    readiness: readiness(score),
    summary: 'TheOne has advanced from self-evolving OS prototype toward production-grade OS control plane. The next gap is runtime hardening rather than architecture.',
    capabilities,
    evidence: {
      workers: workerStats,
      automation: automationStats,
      packages: {
        total: packages.total,
        installed: packages.installed,
        enabled: packages.enabled,
        byKind: packageKinds,
      },
      policyRules: rules.length,
      learning: learningStats,
      events: eventStats,
    },
  };
}
