import { randomUUID } from 'node:crypto';
import { ensureTheOneDatabase, prisma } from '../db/prisma';
import type { CodeRuntimeTarget } from './code-task-contract';

export type CodeWorkspaceStage =
  | 'registered'
  | 'inspected'
  | 'diff_ready'
  | 'applied'
  | 'tested'
  | 'verified'
  | 'delivery_ready'
  | 'rolled_back'
  | 'failed';

export type CodeWorkspaceEvent = {
  id: string;
  type: string;
  stage: CodeWorkspaceStage;
  detail: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type CodeWorkspaceRecord = {
  id: string;
  name: string;
  workspacePath: string | null;
  runtimeTarget: CodeRuntimeTarget;
  runtimeStatus: 'ready' | 'blocked';
  stage: CodeWorkspaceStage;
  repo: string | null;
  branch: string | null;
  latestRunId: string | null;
  rollbackToken: string | null;
  metadata: Record<string, unknown>;
  events: CodeWorkspaceEvent[];
  createdAt: string;
  updatedAt: string;
};

const offlineWorkspaces = new Map<string, CodeWorkspaceRecord>();

function isSqlite() {
  return String(process.env.DATABASE_URL || '').startsWith('file:');
}

function now() {
  return new Date().toISOString();
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function ensureCodeWorkspaceTable() {
  await ensureTheOneDatabase();
  if (isSqlite()) {
    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneCodeWorkspace (
        id text primary key not null,
        name text not null,
        workspacePath text,
        runtimeTarget text not null,
        runtimeStatus text not null,
        stage text not null,
        repo text,
        branch text,
        latestRunId text,
        rollbackToken text,
        metadataJson text not null default '{}',
        eventsJson text not null default '[]',
        createdAt datetime not null default current_timestamp,
        updatedAt datetime not null default current_timestamp
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneCodeWorkspace_updatedAt_idx on TheOneCodeWorkspace(updatedAt)`);
    return;
  }

  await prisma.$executeRawUnsafe(`
    create table if not exists "TheOneCodeWorkspace" (
      id text primary key not null,
      name text not null,
      workspacePath text,
      runtimeTarget text not null,
      runtimeStatus text not null,
      stage text not null,
      repo text,
      branch text,
      latestRunId text,
      rollbackToken text,
      metadataJson text not null default '{}',
      eventsJson text not null default '[]',
      createdAt timestamptz not null default now(),
      updatedAt timestamptz not null default now()
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneCodeWorkspace_updatedAt_idx" on "TheOneCodeWorkspace"(updatedAt)`);
}

function mapRow(row: Record<string, unknown>): CodeWorkspaceRecord {
  const value = (camel: string, lower: string = camel.toLowerCase()) => row[camel] ?? row[lower];
  return {
    id: String(row.id),
    name: String(row.name),
    workspacePath: value('workspacePath') ? String(value('workspacePath')) : null,
    runtimeTarget: String(value('runtimeTarget')) as CodeRuntimeTarget,
    runtimeStatus: String(value('runtimeStatus')) === 'ready' ? 'ready' : 'blocked',
    stage: String(row.stage) as CodeWorkspaceStage,
    repo: row.repo ? String(row.repo) : null,
    branch: row.branch ? String(row.branch) : null,
    latestRunId: value('latestRunId') ? String(value('latestRunId')) : null,
    rollbackToken: value('rollbackToken') ? String(value('rollbackToken')) : null,
    metadata: safeJson(String(value('metadataJson') || '{}'), {}),
    events: safeJson(String(value('eventsJson') || '[]'), []),
    createdAt: new Date(String(value('createdAt'))).toISOString(),
    updatedAt: new Date(String(value('updatedAt'))).toISOString(),
  };
}

async function persist(record: CodeWorkspaceRecord) {
  offlineWorkspaces.set(record.id, structuredClone(record));
  try {
    await ensureCodeWorkspaceTable();
    const values = [
      record.id,
      record.name,
      record.workspacePath,
      record.runtimeTarget,
      record.runtimeStatus,
      record.stage,
      record.repo,
      record.branch,
      record.latestRunId,
      record.rollbackToken,
      JSON.stringify(record.metadata),
      JSON.stringify(record.events.slice(-200)),
    ];
    if (isSqlite()) {
      await prisma.$executeRawUnsafe(
        `insert into TheOneCodeWorkspace
          (id, name, workspacePath, runtimeTarget, runtimeStatus, stage, repo, branch, latestRunId, rollbackToken, metadataJson, eventsJson, updatedAt)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
         on conflict(id) do update set
          name=excluded.name, workspacePath=excluded.workspacePath, runtimeTarget=excluded.runtimeTarget,
          runtimeStatus=excluded.runtimeStatus, stage=excluded.stage, repo=excluded.repo, branch=excluded.branch,
          latestRunId=excluded.latestRunId, rollbackToken=excluded.rollbackToken,
          metadataJson=excluded.metadataJson, eventsJson=excluded.eventsJson, updatedAt=current_timestamp`,
        ...values
      );
    } else {
      await prisma.$executeRawUnsafe(
        `insert into "TheOneCodeWorkspace"
          (id, name, workspacePath, runtimeTarget, runtimeStatus, stage, repo, branch, latestRunId, rollbackToken, metadataJson, eventsJson, updatedAt)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
         on conflict(id) do update set
          name=excluded.name, workspacePath=excluded.workspacePath, runtimeTarget=excluded.runtimeTarget,
          runtimeStatus=excluded.runtimeStatus, stage=excluded.stage, repo=excluded.repo, branch=excluded.branch,
          latestRunId=excluded.latestRunId, rollbackToken=excluded.rollbackToken,
          metadataJson=excluded.metadataJson, eventsJson=excluded.eventsJson, updatedAt=now()`,
        ...values
      );
    }
  } catch {
    // The in-process fallback keeps local development usable when the database is offline.
  }
  return record;
}

export async function createCodeWorkspace(input: {
  name: string;
  workspacePath?: string;
  runtimeTarget: CodeRuntimeTarget;
  runtimeStatus: 'ready' | 'blocked';
  repo?: string;
  branch?: string;
  metadata?: Record<string, unknown>;
}) {
  const timestamp = now();
  const id = `codews_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const event: CodeWorkspaceEvent = {
    id: `codeevt_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    type: 'workspace.registered',
    stage: 'registered',
    detail: 'Code workspace registered with TheOne.',
    createdAt: timestamp,
  };
  return persist({
    id,
    name: input.name.trim().slice(0, 120),
    workspacePath: input.workspacePath?.trim() || null,
    runtimeTarget: input.runtimeTarget,
    runtimeStatus: input.runtimeStatus,
    stage: 'registered',
    repo: input.repo?.trim() || null,
    branch: input.branch?.trim() || null,
    latestRunId: null,
    rollbackToken: null,
    metadata: input.metadata || {},
    events: [event],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function listCodeWorkspaces(limit = 50) {
  try {
    await ensureCodeWorkspaceTable();
    const rows = isSqlite()
      ? await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`select * from TheOneCodeWorkspace order by updatedAt desc limit ?`, limit)
      : await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`select * from "TheOneCodeWorkspace" order by updatedAt desc limit $1`, limit);
    return rows.map(mapRow);
  } catch {
    return [...offlineWorkspaces.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
}

export async function getCodeWorkspace(id: string) {
  try {
    await ensureCodeWorkspaceTable();
    const rows = isSqlite()
      ? await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`select * from TheOneCodeWorkspace where id = ? limit 1`, id)
      : await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`select * from "TheOneCodeWorkspace" where id = $1 limit 1`, id);
    return rows[0] ? mapRow(rows[0]) : offlineWorkspaces.get(id) || null;
  } catch {
    return offlineWorkspaces.get(id) || null;
  }
}

export async function updateCodeWorkspace(id: string, input: Partial<Pick<
  CodeWorkspaceRecord,
  'name' | 'runtimeStatus' | 'stage' | 'repo' | 'branch' | 'latestRunId' | 'rollbackToken' | 'metadata'
>> & { event?: Omit<CodeWorkspaceEvent, 'id' | 'createdAt'> }) {
  const current = await getCodeWorkspace(id);
  if (!current) return null;
  const timestamp = now();
  const { event: eventInput, ...updates } = input;
  const events = eventInput ? [...current.events, {
    ...eventInput,
    id: `codeevt_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    createdAt: timestamp,
  }] : current.events;
  return persist({
    ...current,
    ...updates,
    events: events.slice(-200),
    updatedAt: timestamp,
  });
}
