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
  level: 'L22';
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
  const connectedApps = ['web', 'x', 'github', 'desktop', 'files'];
  const liveOrGuardedWorkers = workerStats.live + workerStats.guarded;

  const osLevels: ProductionMaturityCapability[] = [
    {
      key: 'l19_multi_app_automation_os',
      title: 'L19 Multi-App Automation OS',
      level: 'L19',
      status: connectedApps.length >= 5 && liveOrGuardedWorkers >= 4 ? 'guarded' : 'partial',
      score: Math.min(88, 48 + connectedApps.length * 7 + liveOrGuardedWorkers * 3),
      current: `${connectedApps.length} user-facing app(s) are connected to OneClaw actions: Web, X, GitHub, Desktop, and Files.`,
      target: 'Every proven OneClaw worker has a focused App, Run can route to the right App automatically, and each result writes proof.',
      controls: ['Run entrypoint', 'Apps directory', 'OneClaw action bridge', 'approval-gated writes', 'proof-ready results'],
      gaps: ['Run does not yet deep-link every intent into the matching App', 'Report/API/Browser apps are not fully productized yet'],
      nextActions: ['add Browser and API apps', 'route Run intents into app templates', 'persist app-specific receipts into proof'],
    },
    {
      key: 'l20_parallel_agent_runtime',
      title: 'L20 Parallel Agent Runtime',
      level: 'L20',
      status: 'partial',
      score: 62,
      current: 'TheOne has Planner, Policy, Critic, Operator, and Memory role concepts with proof and replay hooks.',
      target: 'Planner, Executor, Reviewer, Memory, and Policy agents run in parallel with leases, cancellation, merge rules, and shared trace IDs.',
      controls: ['multi-agent quorum', 'policy verdict', 'critic verdict', 'run replay', 'proof ledger'],
      gaps: ['no durable per-agent lease table', 'parallel worker merge is not yet exposed in product UI', 'no per-agent quality score'],
      nextActions: ['add agent run table', 'add parallel execution board', 'score and merge agent outputs'],
    },
    {
      key: 'l21_installable_os',
      title: 'L21 Installable App / Worker / Connector OS',
      level: 'L21',
      status: packages.total > 0 ? 'guarded' : 'partial',
      score: Math.min(84, 46 + pct(packages.enabled, packages.total) / 2 + Object.keys(packageKinds).length * 5),
      current: `${packages.total} package(s) are registered across apps, workers, connectors, and policy packs.`,
      target: 'Apps, workers, connectors, policy packs, memory packs, and UI schemas are installable, versioned, scoped, and composable.',
      controls: ['package registry', 'manifest', 'dependencies', 'enabled flag', 'install endpoint'],
      gaps: ['no signature verification', 'no compatibility solver', 'limited tenant-scoped installs'],
      nextActions: ['add signed package manifests', 'add compatibility constraints', 'add package-level sandbox profiles'],
    },
    {
      key: 'l22_self_evolving_os',
      title: 'L22 Self-Evolving OS',
      level: 'L22',
      status: learningStats.total > 0 ? 'partial' : 'planned',
      score: Math.min(78, 36 + learningStats.suggested * 6 + learningStats.applied * 12 + (eventStats.traces > 0 ? 8 : 0)),
      current: 'The learning engine can inspect runs, events, approvals, package state, and failures to produce improvement insights.',
      target: 'TheOne proposes safe upgrades to apps, policies, workers, prompts, memory rules, and automation loops, then simulates before applying.',
      controls: ['learning insights', 'evidence records', 'apply/dismiss state', 'policy registry', 'event ledger'],
      gaps: ['learning does not yet generate executable diffs', 'no simulation gate before applying suggestions', 'no rollback bundle per upgrade'],
      nextActions: ['generate policy/app diffs from insights', 'run simulations before apply', 'attach rollback plans to every self-upgrade'],
    },
  ];

  const hardeningCapabilities: ProductionMaturityCapability[] = [
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

  const capabilities = [...osLevels, ...hardeningCapabilities];
  const score = Math.round(osLevels.reduce((sum, item) => sum + item.score, 0) / osLevels.length);

  return {
    ok: true,
    level: 'L22',
    label: 'Agent OS Evolution Layer',
    score,
    readiness: readiness(score),
    summary: 'TheOne now has the L19-L22 foundation: multi-app automation, parallel agent runtime concepts, installable OS packages, and a self-evolution loop. The next gap is durable runtime hardening and deeper App execution.',
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
