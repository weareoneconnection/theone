import { executeDurableRuntimeRecovery, executeSelfEvolutionCycle, getCrossDeviceBridgeMeshOS, getDurableRuntimeRecoveryOS, getMemoryGraphKnowledgeOS, getSignedPackageMarketplaceOS, getTenantIdentityRoleOS, simulateAgentPlan } from '../final-state/os-hardening';
import { packageRegistrySummary, setPackageInstalled } from '../packages/package-registry';

export type TheOneActionCenter = {
  level: string;
  title: string;
  status: 'ready' | 'guarded' | 'partial' | 'planned';
  purpose: string;
  actions: Array<{
    key: string;
    label: string;
    risk: 'low' | 'medium' | 'high';
    available: boolean;
    description: string;
  }>;
  metrics: Record<string, string | number>;
  nextActions: string[];
};

function centerStatus(value?: string): TheOneActionCenter['status'] {
  if (value === 'ready') return 'ready';
  if (value === 'guarded') return 'guarded';
  if (value === 'partial') return 'partial';
  return 'planned';
}

export async function listFinalActionCenters() {
  const [runtime, identity, marketplace, bridge, memory] = await Promise.all([
    getDurableRuntimeRecoveryOS(),
    getTenantIdentityRoleOS(),
    getSignedPackageMarketplaceOS(),
    getCrossDeviceBridgeMeshOS(),
    getMemoryGraphKnowledgeOS(),
  ]);
  const packages = await packageRegistrySummary();

  const centers: TheOneActionCenter[] = [
    {
      level: 'L27.5',
      title: 'Recovery Action Center',
      status: centerStatus(runtime.status),
      purpose: 'Repair blocked automation, failed runs, circuit breakers, and recovery routes.',
      metrics: {
        failed: runtime.recovery.failedRuns,
        skipped: runtime.recovery.skippedRuns,
        circuits: runtime.queue.circuitOpen,
      },
      actions: [
        { key: 'reset_circuits', label: 'Reset circuits', risk: 'medium', available: true, description: 'Clear failure streaks and reopen automation jobs.' },
        { key: 'open_recovery_report', label: 'Open recovery report', risk: 'low', available: true, description: 'Refresh failed, skipped, and recoverable run inventory.' },
      ],
      nextActions: runtime.nextActions,
    },
    {
      level: 'L28.5',
      title: 'Identity & Permission Center',
      status: centerStatus(identity.status),
      purpose: 'Prepare tenant, role, consent, and credential boundaries before multi-user rollout.',
      metrics: {
        roles: identity.defaultRoles.length,
        highScopePackages: identity.packageExposure.highScope,
        packages: identity.packageExposure.total,
      },
      actions: [
        { key: 'audit_permissions', label: 'Audit permissions', risk: 'low', available: true, description: 'Review high-scope packages and default roles.' },
        { key: 'prepare_tenant_boundary', label: 'Prepare tenant boundary', risk: 'medium', available: false, description: 'Generate tenant-scoped migration plan.' },
      ],
      nextActions: identity.nextActions,
    },
    {
      level: 'L29.5',
      title: 'Package Install / Upgrade Center',
      status: centerStatus(marketplace.status),
      purpose: 'Install, enable, disable, review, and prepare package rollback plans.',
      metrics: {
        total: marketplace.registry.total,
        enabled: marketplace.registry.enabled,
        installable: Number(marketplace.registry.runtime?.installable || 0),
      },
      actions: [
        { key: 'enable_core_packages', label: 'Enable core packages', risk: 'medium', available: true, description: 'Enable installed core packages with manifests and sandbox contracts.' },
        { key: 'verify_package_contracts', label: 'Verify package contracts', risk: 'low', available: true, description: 'Refresh marketplace contract and signature readiness.' },
      ],
      nextActions: marketplace.nextActions,
    },
    {
      level: 'L30.5',
      title: 'Simulation Before Run',
      status: 'guarded',
      purpose: 'Score a target outcome before execution and route risky work to approval.',
      metrics: {
        agents: 5,
        gate: 'quality',
        mode: 'assist',
      },
      actions: [
        { key: 'simulate_objective', label: 'Simulate objective', risk: 'low', available: true, description: 'Run Planner, Policy, Critic, Operator, and Memory simulation.' },
      ],
      nextActions: ['connect simulator to Run preflight', 'persist simulation receipts', 'block low-score autonomous runs'],
    },
    {
      level: 'L31.5',
      title: 'Bridge Device Manager',
      status: centerStatus(bridge.status),
      purpose: 'Manage cloud workers, local desktop bridge, browser, file, and device-side execution surfaces.',
      metrics: {
        workers: bridge.mesh.workers,
        cloud: bridge.mesh.cloudWorkers,
        local: bridge.mesh.localCapableWorkers,
      },
      actions: [
        { key: 'refresh_bridge_mesh', label: 'Refresh bridge mesh', risk: 'low', available: true, description: 'Refresh worker and local-capable device inventory.' },
        { key: 'prepare_device_registry', label: 'Prepare device registry', risk: 'medium', available: false, description: 'Create enrollment plan for multiple local bridges.' },
      ],
      nextActions: bridge.nextActions,
    },
    {
      level: 'L32.5',
      title: 'Memory Graph UI',
      status: centerStatus(memory.status),
      purpose: 'Search and connect proof, memory, entities, projects, and run history.',
      metrics: {
        memory: memory.graph.memoryRecords,
        proof: memory.graph.proofRecords,
        entities: memory.graph.entityPreview.length,
      },
      actions: [
        { key: 'refresh_memory_graph', label: 'Refresh memory graph', risk: 'low', available: true, description: 'Refresh memory/proof graph preview.' },
        { key: 'search_memory_graph', label: 'Search memory graph', risk: 'low', available: true, description: 'Query TheOne memory graph for a target phrase.' },
      ],
      nextActions: memory.nextActions,
    },
    {
      level: 'L33.5',
      title: 'Self-Evolution Proposal Center',
      status: 'partial',
      purpose: 'Generate learning insights and turn them into reviewed upgrade proposals.',
      metrics: {
        mode: 'governed',
        simulation: 'required',
        approval: 'required',
      },
      actions: [
        { key: 'run_learning_cycle', label: 'Run learning cycle', risk: 'medium', available: true, description: 'Inspect recent runs/events/packages and generate improvement insights.' },
      ],
      nextActions: ['generate concrete code/policy patches', 'simulate before apply', 'monitor post-upgrade regressions'],
    },
    {
      level: 'L34.5',
      title: 'Outcome OS',
      status: 'partial',
      purpose: 'Turn a plain user outcome into composed Apps, agents, workers, policy, memory, proof, and recovery.',
      metrics: {
        command: 'outcome',
        composition: 'apps+agents+workers',
        closure: 'proof+memory',
      },
      actions: [
        { key: 'simulate_outcome_os', label: 'Simulate outcome OS', risk: 'low', available: true, description: 'Simulate a full outcome-level OS route.' },
      ],
      nextActions: ['connect outcome simulator to Run', 'add mission templates', 'add end-to-end outcome closure score'],
    },
  ];

  return {
    ok: true,
    level: 'L34.5',
    centers,
    packages: {
      total: packages.total,
      enabled: packages.enabled,
      runtime: packages.runtime,
    },
  };
}

export async function executeFinalActionCenter(input: { action: string; objective?: string; query?: string }) {
  switch (input.action) {
    case 'reset_circuits':
      return executeDurableRuntimeRecovery({ action: 'reset_circuits' });
    case 'open_recovery_report':
      return getDurableRuntimeRecoveryOS();
    case 'audit_permissions':
      return getTenantIdentityRoleOS();
    case 'enable_core_packages': {
      const registry = await packageRegistrySummary();
      const corePackages = registry.packages
        .filter((item: any) => item.status === 'installed')
        .slice(0, 12);
      for (const item of corePackages) {
        await setPackageInstalled({ id: item.id, enabled: true });
      }
      return {
        ok: true,
        level: 'L29.5',
        action: input.action,
        enabled: corePackages.length,
        marketplace: await getSignedPackageMarketplaceOS(),
      };
    }
    case 'verify_package_contracts':
      return getSignedPackageMarketplaceOS();
    case 'simulate_objective':
    case 'simulate_outcome_os':
      return simulateAgentPlan({ objective: input.objective || 'Complete a governed TheOne outcome', mode: 'assist' });
    case 'refresh_bridge_mesh':
      return getCrossDeviceBridgeMeshOS();
    case 'refresh_memory_graph':
      return getMemoryGraphKnowledgeOS({ query: input.query });
    case 'search_memory_graph':
      return getMemoryGraphKnowledgeOS({ query: input.query || input.objective || 'TheOne memory graph' });
    case 'run_learning_cycle':
      return executeSelfEvolutionCycle();
    default:
      return {
        ok: false,
        error: 'Unsupported action center action.',
      };
  }
}
