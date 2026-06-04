import { listAppBundles } from '../apps/registry';
import { listConnectors } from '../connectors/registry';
import { ensureTheOneDatabase, prisma } from '../db/prisma';
import { listAutomationPolicyRules } from '../policy/policy-registry';
import { listWorkerRuntimes } from '../workers/runtime-registry';

export type TheOnePackageKind = 'app' | 'worker' | 'connector' | 'policy_pack' | 'agent_runtime' | 'memory_pack' | 'ui_schema';

export type TheOnePackage = {
  id: string;
  kind: TheOnePackageKind;
  name: string;
  title: string;
  version: string;
  status: 'available' | 'installed' | 'disabled';
  enabled: boolean;
  source: string;
  dependencies: string[];
  manifest: Record<string, unknown>;
  installedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseJson(value: string | null | undefined, fallback: unknown) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function iso(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value);
}

function sandboxProfile(kind: TheOnePackageKind, name: string, dependencies: string[]) {
  const dependencyText = dependencies.join(' ');
  const highRisk = /payment|trading|finance|legal|desktop|shell|database\.write|web3|social\.post|file\.write|file\.append/i.test(`${name} ${dependencyText}`);
  const local = /desktop|file|browser/i.test(`${name} ${dependencyText}`);
  const network = /api|webhook|github|x\.|social|email|calendar|browser|search/i.test(`${name} ${dependencyText}`);

  return {
    id: `${kind}.${name}.sandbox.v1`,
    isolation: highRisk ? 'approval_gated' : 'standard',
    egress: network ? 'allowlisted' : 'none',
    filesystem: local ? 'allowlisted' : 'none',
    credentials: highRisk ? 'scoped_and_redacted' : 'scoped',
    approvals: highRisk ? 'required_for_writes' : 'required_for_high_risk_only',
    rollback: highRisk ? 'receipt_and_manual_rollback' : 'receipt_only',
  };
}

function permissionScopes(kind: TheOnePackageKind, dependencies: string[]) {
  const scopes = new Set<string>(['read_context']);
  const text = dependencies.join(' ');
  if (kind === 'worker' || kind === 'connector') scopes.add('use_connector');
  if (/social\.post|email\.send|message\.send|notification\.broadcast/i.test(text)) scopes.add('send_message');
  if (/file\.read|document\.parse|spreadsheet\.read/i.test(text)) scopes.add('read_file');
  if (/file\.write|file\.append|document\.generate|spreadsheet\.write/i.test(text)) scopes.add('write_file');
  if (/payment|commerce\.order|web3\.transfer|trading|finance/i.test(text)) scopes.add('transact');
  if (/desktop|browser|api|git|x\.|social|database|calendar|email/i.test(text)) scopes.add('submit_external');
  if (/memory|proof|learning/i.test(text)) scopes.add('write_memory');
  return Array.from(scopes);
}

function installContract(kind: TheOnePackageKind, name: string, dependencies: string[]) {
  const scopes = permissionScopes(kind, dependencies);
  const highImpact = scopes.some((scope) => ['send_message', 'write_file', 'transact', 'submit_external'].includes(scope));
  return {
    id: `${kind}.${name}.install.v1`,
    versionPolicy: 'locked',
    compatibilityCheck: 'required',
    dependencyMode: dependencies.length ? 'declared' : 'standalone',
    rollbackPlan: highImpact ? 'disable_package_and_pause_jobs' : 'disable_package',
    rollout: highImpact ? 'manual_first_run' : 'immediate_when_enabled',
    audit: ['manifest', 'dependencies', 'permissions', 'sandbox', 'receipts'],
  };
}

function osManifest(kind: TheOnePackageKind, name: string, dependencies: string[], manifest: Record<string, unknown>) {
  const scopes = permissionScopes(kind, dependencies);
  const sandbox = sandboxProfile(kind, name, dependencies);
  return {
    ...manifest,
    os: {
      level: kind === 'agent_runtime' ? 'L20' : kind === 'memory_pack' ? 'L22' : 'L21',
      sandboxProfile: sandbox,
      permissionScopes: scopes,
      installContract: installContract(kind, name, dependencies),
      composition: {
        provides: [kind, name],
        consumes: dependencies,
        canComposeWith: ['app', 'worker', 'connector', 'policy_pack', 'memory_pack'].filter((item) => item !== kind),
      },
      compatibility: {
        theone: '>=1.0.0',
        oneclaw: dependencies.some((item) => /oneclaw|social|git|desktop|file|browser|api|email|calendar/i.test(item)) ? '>=5.0.0' : 'optional',
      },
      signature: {
        status: 'development_unsigned',
        digest: `${kind}:${name}:${dependencies.length}:${scopes.length}`,
      },
      versionLock: true,
    },
  };
}

function parsePackage(row: any): TheOnePackage {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    title: row.title,
    version: row.version,
    status: row.status,
    enabled: Boolean(row.enabled),
    source: row.source,
    dependencies: parseJson(row.dependenciesjson ?? row.dependenciesJson, []) as string[],
    manifest: parseJson(row.manifestjson ?? row.manifestJson, {}) as Record<string, unknown>,
    installedAt: iso(row.installedat ?? row.installedAt),
    createdAt: iso(row.createdat ?? row.createdAt) || undefined,
    updatedAt: iso(row.updatedat ?? row.updatedAt) || undefined,
  };
}

async function packageSeeds(): Promise<TheOnePackage[]> {
  const [workers, rules] = await Promise.all([
    listWorkerRuntimes(),
    listAutomationPolicyRules(),
  ]);
  const apps = listAppBundles().map((app) => ({
    id: `app.${app.key}`,
    kind: 'app' as const,
    name: app.key,
    title: app.title,
    version: '1.0.0',
    status: app.status === 'planned' ? 'available' as const : 'installed' as const,
    enabled: app.status !== 'planned',
    source: 'theone.core',
    dependencies: app.requiredProviders,
    manifest: osManifest('app', app.key, app.requiredProviders, app as unknown as Record<string, unknown>),
  }));
  const connectors = listConnectors().map((connector) => ({
    id: `connector.${connector.key}`,
    kind: 'connector' as const,
    name: connector.key,
    title: connector.title,
    version: '1.0.0',
    status: connector.status === 'available' ? 'installed' as const : 'available' as const,
    enabled: connector.status === 'available',
    source: connector.provider,
    dependencies: connector.actions,
    manifest: osManifest('connector', connector.key, connector.actions, connector as unknown as Record<string, unknown>),
  }));
  const workerPackages = workers.map((worker: any) => ({
    id: `worker.${worker.key}`,
    kind: 'worker' as const,
    name: worker.key,
    title: worker.title,
    version: '1.0.0',
    status: worker.status === 'missing' ? 'available' as const : 'installed' as const,
    enabled: worker.status === 'live' || worker.status === 'guarded',
    source: worker.provider,
    dependencies: worker.actions || [],
    manifest: osManifest('worker', worker.key, worker.actions || [], worker),
  }));
  const policyPack = {
    id: 'policy_pack.theone.default',
    kind: 'policy_pack' as const,
    name: 'theone.default',
    title: 'TheOne Default Policy Pack',
    version: '1.0.0',
    status: 'installed' as const,
    enabled: true,
    source: 'theone.policy',
    dependencies: rules.map((rule) => rule.id),
    manifest: osManifest('policy_pack', 'theone.default', rules.map((rule) => rule.id), {
      rules,
      summary: 'Default governance pack for read, reply, publish, and critical actions.',
    }),
  };
  const agentRuntimePack = {
    id: 'agent_runtime.theone.parallel',
    kind: 'agent_runtime' as const,
    name: 'theone.parallel',
    title: 'TheOne Parallel Agent Runtime',
    version: '0.1.0',
    status: 'installed' as const,
    enabled: true,
    source: 'theone.agent_runtime',
    dependencies: ['planner', 'executor', 'reviewer', 'policy', 'memory'],
    manifest: osManifest('agent_runtime', 'theone.parallel', ['planner', 'executor', 'reviewer', 'policy', 'memory'], {
      level: 'L20',
      roles: ['planner', 'executor', 'reviewer', 'policy', 'memory'],
      summary: 'Parallel agent runtime contract for planning, execution, review, governance, and memory.',
    }),
  };
  const memoryPack = {
    id: 'memory_pack.theone.default',
    kind: 'memory_pack' as const,
    name: 'theone.default',
    title: 'TheOne Default Memory Pack',
    version: '0.1.0',
    status: 'installed' as const,
    enabled: true,
    source: 'theone.memory',
    dependencies: ['proof', 'runs', 'events', 'learning'],
    manifest: osManifest('memory_pack', 'theone.default', ['proof', 'runs', 'events', 'learning'], {
      level: 'L22',
      policies: ['summarize runs', 'preserve proof', 'learn from failures', 'suggest upgrades'],
      summary: 'Default memory and learning contract for self-evolving OS behavior.',
    }),
  };
  const uiSchemaPack = {
    id: 'ui_schema.theone.apps',
    kind: 'ui_schema' as const,
    name: 'theone.apps',
    title: 'TheOne App UI Schema Pack',
    version: '0.1.0',
    status: 'installed' as const,
    enabled: true,
    source: 'theone.ui',
    dependencies: ['apps', 'workers', 'policy_pack.theone.default'],
    manifest: osManifest('ui_schema', 'theone.apps', ['apps', 'workers', 'policy_pack.theone.default'], {
      level: 'L21',
      surfaces: ['run', 'apps', 'workers', 'runs', 'proof', 'settings', 'advanced'],
      summary: 'Installable UI schema contract for app workspaces and worker-backed forms.',
    }),
  };

  return [...apps, ...connectors, ...workerPackages, policyPack, agentRuntimePack, memoryPack, uiSchemaPack];
}

async function syncPackageSeeds() {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>('select id from "TheOnePackage"');
  const existing = new Set(rows.map((row) => row.id));

  for (const item of await packageSeeds()) {
    if (!existing.has(item.id)) {
      await upsertTheOnePackage(item);
    } else {
      await prisma.$executeRawUnsafe(
        `update "TheOnePackage"
         set kind = $2,
             name = $3,
             title = $4,
             version = $5,
             source = $6,
             dependenciesJson = $7,
             manifestJson = $8,
             updatedAt = now()
         where id = $1`,
        item.id,
        item.kind,
        item.name,
        item.title,
        item.version,
        item.source,
        safeJson(item.dependencies),
        safeJson(item.manifest)
      );
    }
  }
}

export async function listTheOnePackages() {
  await ensureTheOneDatabase();
  await syncPackageSeeds();
  const rows = await prisma.$queryRawUnsafe<any[]>('select * from "TheOnePackage" order by kind asc, title asc');
  return rows.map(parsePackage);
}

export async function upsertTheOnePackage(input: Partial<TheOnePackage>) {
  await ensureTheOneDatabase();
  const item: TheOnePackage = {
    id: String(input.id || `${input.kind}.${input.name}`),
    kind: input.kind || 'app',
    name: String(input.name || input.id || 'custom'),
    title: String(input.title || input.name || 'Custom Package'),
    version: String(input.version || '1.0.0'),
    status: input.status || 'available',
    enabled: input.enabled === true,
    source: String(input.source || 'theone.custom'),
    dependencies: input.dependencies || [],
    manifest: osManifest(input.kind || 'app', String(input.name || input.id || 'custom'), input.dependencies || [], input.manifest || {}),
    installedAt: input.installedAt || null,
  };

  await prisma.$executeRawUnsafe(
    `insert into "TheOnePackage" (id, kind, name, title, version, status, enabled, source, dependenciesJson, manifestJson, installedAt)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (id) do update set
       kind = excluded.kind,
       name = excluded.name,
       title = excluded.title,
       version = excluded.version,
       status = excluded.status,
       enabled = excluded.enabled,
       source = excluded.source,
       dependenciesJson = excluded.dependenciesJson,
       manifestJson = excluded.manifestJson,
       installedAt = excluded.installedAt,
       updatedAt = now()`,
    item.id,
    item.kind,
    item.name,
    item.title,
    item.version,
    item.status,
    item.enabled,
    item.source,
    safeJson(item.dependencies),
    safeJson(item.manifest),
    item.installedAt
  );
  return item;
}

export async function setPackageInstalled(input: { id: string; enabled?: boolean }) {
  await ensureTheOneDatabase();
  const enabled = input.enabled !== false;
  await prisma.$executeRawUnsafe(
    `update "TheOnePackage" set status = $2, enabled = $3, installedAt = case when $3 then now() else installedAt end, updatedAt = now() where id = $1`,
    input.id,
    enabled ? 'installed' : 'disabled',
    enabled
  );
  return listTheOnePackages();
}

export async function packageRegistrySummary() {
  const packages = await listTheOnePackages();
  const osFor = (item: TheOnePackage) => (item.manifest?.os || {}) as Record<string, any>;
  const sandboxed = packages.filter((item) => osFor(item).sandboxProfile).length;
  const gated = packages.filter((item) => osFor(item).sandboxProfile?.isolation === 'approval_gated').length;
  const versionLocked = packages.filter((item) => osFor(item).versionLock === true).length;
  const scoped = packages.filter((item) => Array.isArray(osFor(item).permissionScopes)).length;
  const healthy = packages.filter((item) => {
    const os = osFor(item);
    return item.enabled && item.status === 'installed' && os.versionLock === true && os.installContract && os.sandboxProfile;
  }).length;
  const runtimeContracts = packages.map((item) => {
    const os = osFor(item);
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      version: item.version,
      status: item.status,
      enabled: item.enabled,
      permissions: os.permissionScopes || [],
      sandbox: os.sandboxProfile || null,
      install: os.installContract || null,
      composition: os.composition || null,
      health: item.enabled && item.status === 'installed' && os.versionLock === true && os.installContract && os.sandboxProfile
        ? 'ready'
        : item.status === 'disabled'
          ? 'disabled'
          : 'available',
    };
  });
  return {
    total: packages.length,
    installed: packages.filter((item) => item.status === 'installed').length,
    enabled: packages.filter((item) => item.enabled).length,
    byKind: packages.reduce<Record<string, number>>((summary, item) => {
      summary[item.kind] = (summary[item.kind] || 0) + 1;
      return summary;
    }, {}),
    runtime: {
      level: 'L28',
      sandboxed,
      approvalGated: gated,
      versionLocked,
      scoped,
      healthy,
      composableKinds: Array.from(new Set(packages.map((item) => item.kind))),
      installable: packages.filter((item) => osFor(item).installContract).length,
      unsigned: packages.filter((item) => osFor(item).signature?.status === 'development_unsigned').length,
      packageRuntime: {
        schemaVersion: 'theone.package_runtime.v1',
        supportsInstall: true,
        supportsDisable: true,
        supportsVersionLock: true,
        supportsPermissionScopes: true,
        supportsSandboxProfiles: true,
        supportsComposition: true,
      },
    },
    runtimeContracts,
    packages,
  };
}
