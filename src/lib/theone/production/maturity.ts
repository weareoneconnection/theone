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
  level: 'L34';
  label: string;
  score: number;
  readiness: 'prototype' | 'alpha' | 'production_candidate';
  summary: string;
  capabilities: ProductionMaturityCapability[];
  evidence: {
    workers: { total: number; live: number; guarded: number; prepared: number; missing: number };
    automation: { total: number; active: number; paused: number; circuitOpen: number };
    packages: { total: number; installed: number; enabled: number; byKind: Record<string, number>; runtime?: Record<string, unknown> };
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

function fallback<T>(result: PromiseSettledResult<T>, value: T): T {
  return result.status === 'fulfilled' ? result.value : value;
}

export async function getProductionMaturityReport(): Promise<ProductionMaturityReport> {
  const [workersResult, jobsResult, packagesResult, rulesResult, insightsResult, eventsResult] = await Promise.allSettled([
    listWorkerRuntimes(),
    listAutomationJobs(),
    packageRegistrySummary(),
    listAutomationPolicyRules(),
    listLearningInsights(50),
    listTheOneEvents(120),
  ]);
  const workers = fallback(workersResult, [] as Awaited<ReturnType<typeof listWorkerRuntimes>>);
  const jobs = fallback(jobsResult, [] as Awaited<ReturnType<typeof listAutomationJobs>>);
  const packages = fallback(packagesResult, {
    total: 0,
    installed: 0,
    enabled: 0,
    byKind: {},
    runtime: {
      level: 'L26',
      sandboxed: 0,
      approvalGated: 0,
      versionLocked: 0,
      scoped: 0,
      composableKinds: [],
      installable: 0,
      unsigned: 0,
    },
    packages: [],
  } as Awaited<ReturnType<typeof packageRegistrySummary>>);
  const rules = fallback(rulesResult, [] as Awaited<ReturnType<typeof listAutomationPolicyRules>>);
  const insights = fallback(insightsResult, [] as Awaited<ReturnType<typeof listLearningInsights>>);
  const events = fallback(eventsResult, [] as Awaited<ReturnType<typeof listTheOneEvents>>);

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
      key: 'l34_universal_ai_operating_system',
      title: 'L34 Universal AI Operating System',
      level: 'L34',
      status: 'partial',
      score: Math.min(72, 38 + pct(packages.enabled, Math.max(1, packages.total)) / 5 + Math.min(18, workerStats.total)),
      current: 'TheOne has the product surface for a universal AI OS: unified Run, Apps, Workspaces, Workers, Proof, Settings, package runtime, OneAI planning, OneClaw execution, memory, policy, and autonomous workspaces.',
      target: 'A normal user states an outcome once; TheOne selects Apps, agents, workers, connectors, packages, policies, memory, proof, and recovery paths automatically until the real-world task is complete.',
      controls: ['unified command', 'app routing', 'worker routing', 'policy gates', 'memory graph', 'proof ledger', 'package runtime', 'workspace mission control'],
      gaps: ['not every worker has a polished App yet', 'full real-world autonomy still requires operator approval for high-risk actions'],
      nextActions: ['connect every proven worker to an App', 'add outcome-level mission templates', 'ship production-grade recovery'],
    },
    {
      key: 'l33_self_evolving_os',
      title: 'L33 Self-Evolving OS',
      level: 'L33',
      status: learningStats.total > 0 ? 'partial' : 'planned',
      score: Math.min(68, 34 + learningStats.suggested * 5 + learningStats.applied * 10 + (eventStats.traces ? 8 : 0)),
      current: 'The learning engine can inspect runs, events, approvals, packages, and failures, then store improvement insights for operator review.',
      target: 'TheOne proposes upgrades, generates patches, simulates impact, requests approval, deploys, monitors, and rolls back without breaking the OS.',
      controls: ['learning insights', 'evidence', 'apply/dismiss', 'package state', 'event ledger', 'production maturity report'],
      gaps: ['insights do not yet generate code patches automatically', 'simulation and rollback are metadata-level'],
      nextActions: ['add upgrade proposal bundles', 'add dry-run simulation reports', 'attach rollback recipes to every applied upgrade'],
    },
    {
      key: 'l32_memory_graph_knowledge_os',
      title: 'L32 Memory Graph / Knowledge OS',
      level: 'L32',
      status: 'partial',
      score: 64,
      current: 'TheOne stores proof, run memory, App Memory Packs, and workspace-linked memory that can be recalled by Apps and Mission Control.',
      target: 'People, projects, files, decisions, tasks, receipts, preferences, packages, and workers become a queryable relationship graph.',
      controls: ['memory ledger', 'app memory packs', 'proof links', 'workspace memory', 'query memory endpoint'],
      gaps: ['memory is record-oriented rather than graph-native', 'no entity resolution layer yet'],
      nextActions: ['add entity graph schema', 'link memory to people/projects/packages', 'add graph visual search'],
    },
    {
      key: 'l31_cross_device_bridge_mesh',
      title: 'L31 Cross-Device / Local Bridge Mesh',
      level: 'L31',
      status: workerStats.live + workerStats.guarded > 0 ? 'partial' : 'planned',
      score: Math.min(66, 36 + liveOrGuardedWorkers * 4),
      current: 'The local desktop bridge, browser operations, cloud OneClaw, and worker catalog can be surfaced through TheOne.',
      target: 'Mac, browser, server, cloud workers, phones, and remote operator machines form a secure execution mesh with device-specific permissions.',
      controls: ['local bridge', 'desktop actions', 'browser actions', 'worker catalog', 'connector allowlists'],
      gaps: ['no multi-device enrollment registry', 'desktop control requires local OneClaw running'],
      nextActions: ['add device registry', 'add bridge heartbeat', 'add per-device worker scopes'],
    },
    {
      key: 'l30_agent_evaluation_simulation_os',
      title: 'L30 Agent Evaluation / Simulation OS',
      level: 'L30',
      status: 'partial',
      score: 65,
      current: 'The multi-agent runtime produces consensus, quality gate, recovery mode, sandbox signal, and proof; production maturity records gaps and next actions.',
      target: 'Every autonomous plan is simulated, scored, compared with golden tasks, and blocked or routed for approval before impact.',
      controls: ['quality gate', 'critic agent', 'policy agent', 'recovery mode', 'proof ledger', 'maturity scoring'],
      gaps: ['no golden eval set', 'no plan simulator UI yet'],
      nextActions: ['add eval datasets', 'add simulation endpoint', 'block low-score autonomous runs'],
    },
    {
      key: 'l29_signed_package_marketplace',
      title: 'L29 Signed Package Marketplace',
      level: 'L29',
      status: packages.total > 0 ? 'partial' : 'planned',
      score: Math.min(67, 36 + Object.keys(packageKinds).length * 4 + pct(packages.enabled, Math.max(1, packages.total)) / 5),
      current: 'Apps, workers, connectors, policy packs, memory packs, UI schemas, and agent runtimes are registered as packages with manifests, install contracts, sandbox profiles, version locks, and composition metadata.',
      target: 'Packages can be signed, published, verified, installed, upgraded, disabled, rolled back, and composed from a marketplace.',
      controls: ['package registry', 'install contract', 'version lock', 'sandbox profile', 'permission scopes', 'composition metadata'],
      gaps: ['signature is development metadata', 'no marketplace publishing flow'],
      nextActions: ['add signature verification', 'add package publish endpoint', 'add compatibility solver'],
    },
    {
      key: 'l28_tenant_identity_role_os',
      title: 'L28 Tenant / Identity / Role OS',
      level: 'L28',
      status: 'planned',
      score: 42,
      current: 'TheOne has permission decisions, approval gates, identity connector concepts, and guarded action modes, but persisted records are still global.',
      target: 'Every run, package, worker, connector, memory, proof, approval, credential, workspace, and device is scoped to tenant, user, role, and consent.',
      controls: ['permission model', 'approval gates', 'identity connector', 'connector scopes', 'redacted credentials'],
      gaps: ['no tenantId on ledgers', 'no role assignment store', 'no per-tenant secret scope'],
      nextActions: ['add tenant context middleware', 'add role registry', 'bind installs and credentials to tenant'],
    },
    {
      key: 'l27_durable_runtime_recovery_os',
      title: 'L27 Durable Runtime / Recovery OS',
      level: 'L27',
      status: jobs.length > 0 ? 'partial' : 'planned',
      score: Math.min(70, 40 + automationStats.active * 5 + jobs.length * 2 - automationStats.circuitOpen * 4),
      current: 'Automation jobs, workspace runs, cooldowns, daily limits, failure streaks, circuit breakers, replay/resume endpoints, and Mission Control diagnostics are present.',
      target: 'A durable queue with leases, retry policy, dead-letter handling, recovery plans, cross-App handoff, and long-running task restoration.',
      controls: ['automation jobs', 'workspace timeline', 'circuit breaker', 'run replay', 'run resume', 'failure diagnostics'],
      gaps: ['no dead-letter table', 'queue is database/scheduler-level rather than distributed runtime'],
      nextActions: ['add dead-letter queue', 'add retry schedules', 'add cross-App handoff DAG'],
    },
    {
      key: 'l26_mission_control_runtime',
      title: 'L26 Workspace Mission Control Runtime',
      level: 'L26',
      status: automationStats.total > 0 && packages.total > 0 ? 'guarded' : 'partial',
      score: Math.min(86, 60 + automationStats.active * 4 + Object.keys(packageKinds).length * 3),
      current: 'Autonomous workspaces now have Mission Control detail surfaces with timeline, policy, proof, memory, package runtime, and failure diagnostics.',
      target: 'Every workspace becomes a durable mission control room with queue leases, package-level sandbox enforcement, recovery actions, and cross-App handoffs.',
      controls: ['workspace detail', 'timeline', 'policy card', 'proof', 'memory', 'package runtime', 'failure diagnostics'],
      gaps: ['workspace recovery is diagnostic, not one-click reset yet', 'package signature is development metadata, not cryptographic verification'],
      nextActions: ['add reset circuit action', 'add signed package manifests', 'add workspace DAG handoffs'],
    },
    {
      key: 'l25_autonomous_workspace_os',
      title: 'L25 Autonomous Workspace OS',
      level: 'L25',
      status: automationStats.total > 0 ? 'guarded' : 'partial',
      score: Math.min(82, 58 + automationStats.active * 5 + Math.max(0, 5 - automationStats.circuitOpen) * 2),
      current: 'TheOne can turn App workflows into ongoing autonomous workspaces backed by scheduler jobs, cadence, daily limits, proof, memory, and circuit breakers.',
      target: 'Every App can become a durable workspace with triggers, queue leases, cross-App handoffs, escalation, replay, and operator-visible controls.',
      controls: ['workspace templates', 'automation jobs', 'cooldown', 'daily limits', 'failure circuit breaker', 'proof and memory'],
      gaps: ['workspace queue still runs through the simple scheduler', 'cross-App handoff chains are template-level, not visual DAGs yet'],
      nextActions: ['add workspace run timeline', 'add cross-App handoff DAGs', 'add per-workspace memory recall and evaluation'],
    },
    {
      key: 'l24_app_memory_os',
      title: 'L24 App Memory OS',
      level: 'L24',
      status: 'guarded',
      score: 76,
      current: 'Report, API, Browser, Web, GitHub, X, Desktop, Files, and Bot Apps now have product workflows, and new App workflows can attach memory packs to run storage.',
      target: 'Every App result becomes structured reusable context with facts, decisions, next actions, source receipts, and app-specific recall.',
      controls: ['app-specific API', 'appMemoryPack', 'proof ledger', 'memory store', 'Run router'],
      gaps: ['memory recall is not yet app-specific in the UI', 'memory packs do not yet have versioned schemas per App'],
      nextActions: ['add app memory recall panels', 'version memory pack schemas', 'connect Reports to selected prior proof records'],
    },
    {
      key: 'l23_app_workflow_closure',
      title: 'L23 App Workflow Closure',
      level: 'L23',
      status: 'guarded',
      score: 88,
      current: 'The Web, GitHub, X, Desktop, Files, Bot, Report, API, and Browser Apps have dedicated workflow closures that route input through TheOne policy, OneClaw or bridge workers, proof, and readable product results.',
      target: 'Every core App has a dedicated product workflow, app-specific API, proof receipt, memory write, and next-action output.',
      controls: ['app-specific API', 'OneClaw worker receipt', 'OneAI summarization', 'proof save', 'plain result panel'],
      gaps: ['Calendar, Email, Database, and vertical Apps are still capability paths', 'Some App results still use summary-level memory'],
      nextActions: ['upgrade Email and Calendar App closures', 'add Database App closure', 'deepen app result memory packs'],
    },
    {
      key: 'l19_multi_app_automation_os',
      title: 'L19 Multi-App Automation OS',
      level: 'L19',
      status: connectedApps.length >= 5 && liveOrGuardedWorkers >= 4 ? 'guarded' : 'partial',
      score: Math.min(88, 48 + connectedApps.length * 7 + liveOrGuardedWorkers * 3),
      current: `${connectedApps.length} core user-facing app(s) are connected to OneClaw actions; additional Report, API, and Browser apps now have full product workflow closures and Run can route into them.`,
      target: 'Every proven OneClaw worker has a focused App, Run can route to the right App automatically, and each result writes proof.',
      controls: ['Run entrypoint', 'Apps directory', 'OneClaw action bridge', 'approval-gated writes', 'proof-ready results'],
      gaps: ['Run does not yet deep-link every intent into the matching App', 'Report/API/Browser apps are not fully productized yet'],
      nextActions: ['add Email and Calendar apps', 'turn vertical Apps into product workflows', 'add app-specific memory recall'],
    },
    {
      key: 'l20_parallel_agent_runtime',
      title: 'L20 Parallel Agent Runtime',
      level: 'L20',
      status: 'guarded',
      score: 72,
      current: 'TheOne has Planner, Policy, Critic, Operator, and Memory roles with leases, quality gate, recovery mode, sandbox signal, proof, and replay hooks.',
      target: 'Planner, Executor, Reviewer, Memory, and Policy agents run in parallel with leases, cancellation, merge rules, and shared trace IDs.',
      controls: ['multi-agent quorum', 'policy verdict', 'critic verdict', 'lease release', 'quality gate', 'recovery signal', 'proof ledger'],
      gaps: ['no durable per-agent lease table', 'parallel worker merge is not yet exposed in product UI'],
      nextActions: ['add agent run table', 'add parallel execution board', 'add per-agent historical evals'],
    },
    {
      key: 'l21_installable_os',
      title: 'L21 Installable App / Worker / Connector OS',
      level: 'L21',
      status: packages.total > 0 ? 'guarded' : 'partial',
      score: Math.min(84, 46 + pct(packages.enabled, packages.total) / 2 + Object.keys(packageKinds).length * 5),
      current: `${packages.total} package(s) are registered across apps, workers, connectors, policy packs, memory packs, UI schemas, and agent runtimes with install contracts and sandbox profiles.`,
      target: 'Apps, workers, connectors, policy packs, memory packs, and UI schemas are installable, versioned, scoped, and composable.',
      controls: ['package registry', 'manifest', 'dependencies', 'enabled flag', 'install endpoint', 'install contract', 'version lock', 'sandbox profile'],
      gaps: ['signature is development metadata, not cryptographic verification', 'limited tenant-scoped installs'],
      nextActions: ['add signed package manifests', 'add compatibility solver', 'add tenant install scope'],
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
    level: 'L34',
    label: 'Universal AI Operating System Roadmap',
    score,
    readiness: readiness(score),
    summary: 'TheOne now carries the L19-L34 OS blueprint in-system: durable runtime, identity boundary, package marketplace, simulation, bridge mesh, memory graph, self-evolution, and universal AI OS target layered over the existing L26 Mission Control foundation.',
    capabilities,
    evidence: {
      workers: workerStats,
      automation: automationStats,
      packages: {
        total: packages.total,
        installed: packages.installed,
        enabled: packages.enabled,
        byKind: packageKinds,
        runtime: packages.runtime,
      },
      policyRules: rules.length,
      learning: learningStats,
      events: eventStats,
    },
  };
}
