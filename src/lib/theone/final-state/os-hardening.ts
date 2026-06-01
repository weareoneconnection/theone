import { listAutomationJobs, listAutomationRuns, resetAutomationCircuits } from '../automation/scheduler';
import { listTheOneEvents } from '../events/event-ledger';
import { listLearningInsights, runLearningCycle } from '../learning/learning-engine';
import { packageRegistrySummary } from '../packages/package-registry';
import { listMemory, listProof, queryMemoryGraph } from '../state/run-store';
import { listWorkerRuntimes } from '../workers/runtime-registry';
import { getFinalStateBlueprint } from './os-blueprint';

function statusFromScore(score: number) {
  if (score >= 80) return 'ready';
  if (score >= 55) return 'guarded';
  if (score >= 35) return 'partial';
  return 'planned';
}

export async function getDurableRuntimeRecoveryOS() {
  const [jobs, runs, events] = await Promise.all([
    listAutomationJobs(),
    listAutomationRuns({ limit: 120 }),
    listTheOneEvents(120),
  ]);
  const failedRuns = runs.filter((run) => run.status === 'failed');
  const skippedRuns = runs.filter((run) => run.status === 'skipped');
  const circuitJobs = jobs.filter((job) => job.circuitOpen);
  const recoverable = failedRuns.slice(0, 20).map((run) => ({
    id: run.id,
    jobId: run.jobId,
    runId: run.runId,
    summary: run.summary,
    recovery: run.runId ? 'replay_or_resume_run' : 'rerun_workspace_job',
    priority: /approval|permission|blocked/i.test(run.summary) ? 'operator_review' : 'retry_after_cooldown',
    createdAt: run.createdAt,
  }));

  return {
    ok: true,
    level: 'L27',
    status: statusFromScore(42 + jobs.length * 3 + Math.max(0, 12 - failedRuns.length)),
    queue: {
      jobs: jobs.length,
      active: jobs.filter((job) => job.status === 'active').length,
      paused: jobs.filter((job) => job.status === 'paused').length,
      circuitOpen: circuitJobs.length,
    },
    recovery: {
      failedRuns: failedRuns.length,
      skippedRuns: skippedRuns.length,
      recoverable,
      deadLetterPreview: failedRuns.filter((run) => !run.runId).slice(0, 10),
    },
    traces: events.filter((event) => /automation|run|execution|replay|resume/i.test(event.type)).slice(0, 20),
    controls: ['cooldown', 'daily limit', 'failure streak', 'circuit breaker', 'replay/resume', 'Mission Control diagnostics'],
    nextActions: ['persist retry schedule', 'add dead-letter queue table', 'add one-click circuit reset'],
  };
}

export async function executeDurableRuntimeRecovery(input: { action?: string; jobId?: string } = {}) {
  if (input.action === 'reset_circuits') {
    const reset = await resetAutomationCircuits({ jobId: input.jobId });
    return {
      ok: true,
      level: 'L27',
      action: 'reset_circuits',
      result: reset,
      runtime: await getDurableRuntimeRecoveryOS(),
    };
  }

  return {
    ok: false,
    level: 'L27',
    error: 'Unsupported runtime recovery action.',
  };
}

export async function getTenantIdentityRoleOS() {
  const packages = await packageRegistrySummary();
  const highScopePackages = packages.packages.filter((item: any) => {
    const scopes = item.manifest?.os?.permissionScopes || [];
    return scopes.some((scope: string) => ['send_message', 'write_file', 'transact', 'submit_external'].includes(scope));
  });

  return {
    ok: true,
    level: 'L28',
    status: 'partial',
    boundary: {
      tenantScope: 'planned',
      userScope: 'planned',
      roleScope: 'planned',
      credentialScope: 'scoped_and_redacted_manifest',
      consentScope: 'approval_gate',
    },
    defaultRoles: [
      { key: 'owner', permissions: ['admin', 'install_package', 'approve_high_risk', 'manage_credentials'] },
      { key: 'operator', permissions: ['run_workspace', 'approve_medium_risk', 'view_proof'] },
      { key: 'viewer', permissions: ['view_runs', 'view_proof', 'view_memory'] },
    ],
    packageExposure: {
      total: packages.total,
      highScope: highScopePackages.length,
      examples: highScopePackages.slice(0, 8).map((item: any) => ({ id: item.id, title: item.title })),
    },
    controls: ['approval gates', 'permission scopes', 'credential redaction', 'package manifests'],
    nextActions: ['add tenantId columns', 'add role assignment store', 'bind package installs to tenant'],
  };
}

export async function getSignedPackageMarketplaceOS() {
  const registry = await packageRegistrySummary();
  const runtime = registry.runtime || {};
  return {
    ok: true,
    level: 'L29',
    status: statusFromScore(40 + Number(runtime.installable || 0)),
    registry: {
      total: registry.total,
      installed: registry.installed,
      enabled: registry.enabled,
      byKind: registry.byKind,
      runtime,
    },
    marketplace: registry.packages.map((item: any) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      version: item.version,
      status: item.status,
      enabled: item.enabled,
      source: item.source,
      signature: item.manifest?.os?.signature || null,
      installContract: item.manifest?.os?.installContract || null,
      sandbox: item.manifest?.os?.sandboxProfile || null,
    })),
    controls: ['manifest', 'install contract', 'version lock', 'sandbox profile', 'permission scopes', 'rollback plan'],
    nextActions: ['replace development signatures with cryptographic signatures', 'add package publish flow', 'add compatibility solver'],
  };
}

export async function simulateAgentPlan(input: { objective?: string; mode?: string }) {
  const objective = String(input.objective || 'Complete a governed TheOne workflow').trim();
  const riskSignals = [
    /post|publish|send|email|message|tweet|x\b/i.test(objective) ? 'external_communication' : '',
    /desktop|click|type|computer|browser/i.test(objective) ? 'local_or_browser_operation' : '',
    /pay|trade|buy|sell|transfer|delete|write/i.test(objective) ? 'high_impact_action' : '',
  ].filter(Boolean);
  const score = Math.max(30, 88 - riskSignals.length * 16 - (objective.length < 12 ? 12 : 0));
  return {
    ok: true,
    level: 'L30',
    status: statusFromScore(score),
    simulation: {
      objective,
      mode: input.mode || 'assist',
      score,
      verdict: score >= 72 ? 'can_run_guarded' : score >= 52 ? 'requires_approval_or_more_context' : 'block_until_clarified',
      riskSignals,
      agents: [
        { role: 'planner', verdict: objective.length >= 12 ? 'pass' : 'warn' },
        { role: 'policy', verdict: riskSignals.includes('high_impact_action') ? 'block' : riskSignals.length ? 'warn' : 'pass' },
        { role: 'critic', verdict: riskSignals.length ? 'warn' : 'pass' },
        { role: 'operator', verdict: riskSignals.includes('local_or_browser_operation') ? 'guarded' : 'pass' },
        { role: 'memory', verdict: 'store_after_run' },
      ],
    },
    controls: ['quality gate', 'critic verdict', 'policy verdict', 'risk signal extraction', 'approval routing'],
    nextActions: ['connect simulator to Run preflight', 'add golden eval set', 'persist simulation receipts'],
  };
}

export async function getCrossDeviceBridgeMeshOS() {
  const workers = await listWorkerRuntimes();
  const local = workers.filter((worker: any) => /desktop|browser|file/i.test(`${worker.domain} ${(worker.actions || []).join(' ')}`));
  const cloud = workers.filter((worker: any) => worker.provider === 'oneclaw');
  return {
    ok: true,
    level: 'L31',
    status: local.length ? 'partial' : 'planned',
    mesh: {
      workers: workers.length,
      cloudWorkers: cloud.length,
      localCapableWorkers: local.length,
      devices: [
        { key: 'local_mac_bridge', status: local.length ? 'available_when_oneclaw_local_runs' : 'planned', workers: local.map((worker: any) => worker.key).slice(0, 8) },
        { key: 'oneclaw_cloud', status: cloud.length ? 'available' : 'planned', workers: cloud.map((worker: any) => worker.key).slice(0, 8) },
      ],
    },
    controls: ['bridge heartbeat', 'device policy', 'worker capability map', 'local proof', 'connector allowlist'],
    nextActions: ['add bridge heartbeat endpoint', 'add device enrollment registry', 'add per-device action allowlist'],
  };
}

export async function getMemoryGraphKnowledgeOS(input: { query?: string } = {}) {
  const [memory, proof, hits] = await Promise.all([
    listMemory(120),
    listProof(120),
    queryMemoryGraph({ query: input.query || 'TheOne workspaces packages workers proof memory', limit: 12 }),
  ]);
  const entities = new Map<string, number>();
  for (const item of memory as any[]) {
    for (const token of `${item.kind} ${item.title} ${item.summary}`.split(/\W+/).filter((part) => part.length > 4).slice(0, 12)) {
      entities.set(token.toLowerCase(), (entities.get(token.toLowerCase()) || 0) + 1);
    }
  }

  return {
    ok: true,
    level: 'L32',
    status: memory.length || proof.length ? 'partial' : 'planned',
    graph: {
      memoryRecords: memory.length,
      proofRecords: proof.length,
      entityPreview: Array.from(entities.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count })),
      recallHits: hits,
      links: proof.slice(0, 20).map((item: any) => ({ source: item.runId, target: item.type, title: item.title })),
    },
    controls: ['memory ledger', 'proof ledger', 'semantic recall', 'entity preview', 'run links'],
    nextActions: ['add first-class entity table', 'add project/person/file linking', 'add memory graph UI'],
  };
}

export async function getSelfEvolvingOS() {
  const [insights, blueprint] = await Promise.all([
    listLearningInsights(80),
    Promise.resolve(getFinalStateBlueprint()),
  ]);
  const proposals = insights.slice(0, 20).map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    confidence: item.confidence,
    status: item.status,
    upgradePlan: {
      simulate: true,
      requiresApproval: true,
      rollback: `revert_${item.targetType}_${item.targetId || 'target'}`,
      target: item.targetId || item.targetType,
    },
  }));

  return {
    ok: true,
    level: 'L33',
    status: insights.length ? 'partial' : 'planned',
    evolution: {
      insightCount: insights.length,
      suggested: insights.filter((item) => item.status === 'suggested').length,
      applied: insights.filter((item) => item.status === 'applied').length,
      proposals,
      targetLayers: blueprint.layers.map((layer) => layer.level),
    },
    controls: ['learning insights', 'upgrade proposal', 'simulation required', 'approval required', 'rollback bundle placeholder'],
    nextActions: ['generate concrete code/policy patches', 'run simulation before apply', 'monitor post-upgrade regressions'],
  };
}

export async function executeSelfEvolutionCycle() {
  const cycle = await runLearningCycle();
  return {
    ok: true,
    level: 'L33',
    action: 'learning_cycle',
    result: cycle,
    evolution: await getSelfEvolvingOS(),
  };
}

export async function getUniversalAIOSReadiness() {
  const [runtime, identity, marketplace, bridge, memory, evolution] = await Promise.all([
    getDurableRuntimeRecoveryOS(),
    getTenantIdentityRoleOS(),
    getSignedPackageMarketplaceOS(),
    getCrossDeviceBridgeMeshOS(),
    getMemoryGraphKnowledgeOS(),
    getSelfEvolvingOS(),
  ]);
  return {
    ok: true,
    level: 'L34',
    foundation: 'L26',
    readiness: {
      runtime: runtime.status,
      identity: identity.status,
      marketplace: marketplace.status,
      bridge: bridge.status,
      memory: memory.status,
      evolution: evolution.status,
    },
    layers: { runtime, identity, marketplace, bridge, memory, evolution },
  };
}
