import { listAppBundles } from '../apps/registry';
import { listConnectors } from '../connectors/registry';
import { ensureTheOneDatabase, prisma } from '../db/prisma';
import { listAutomationPolicyRules } from '../policy/policy-registry';
import { listWorkerRuntimes } from '../workers/runtime-registry';

export type TheOnePackageKind = 'app' | 'worker' | 'connector' | 'policy_pack';

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
    manifest: app as unknown as Record<string, unknown>,
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
    manifest: connector as unknown as Record<string, unknown>,
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
    manifest: worker,
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
    manifest: {
      rules,
      summary: 'Default governance pack for read, reply, publish, and critical actions.',
    },
  };

  return [...apps, ...connectors, ...workerPackages, policyPack];
}

async function syncPackageSeeds() {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>('select id from "TheOnePackage"');
  const existing = new Set(rows.map((row) => row.id));

  for (const item of await packageSeeds()) {
    if (!existing.has(item.id)) {
      await upsertTheOnePackage(item);
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
    manifest: input.manifest || {},
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
  return {
    total: packages.length,
    installed: packages.filter((item) => item.status === 'installed').length,
    enabled: packages.filter((item) => item.enabled).length,
    byKind: packages.reduce<Record<string, number>>((summary, item) => {
      summary[item.kind] = (summary[item.kind] || 0) + 1;
      return summary;
    }, {}),
    packages,
  };
}
