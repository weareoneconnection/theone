import { ensureTheOneDatabase, prisma } from '../db/prisma';

export type TheOneChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  sourceId?: string;
  contentRef?: string;
  textHash?: string;
  path?: string;
  text?: string;
  textPreview?: string;
  reportContext?: string;
  summary?: string;
  insights?: Record<string, unknown>;
  status?: 'uploading' | 'ready' | 'failed';
  error?: string;
};

export type TheOneChatSessionMessage = {
  role: string;
  content: string;
  createdAt?: string;
};

export type TheOneChatSessionSnapshot = {
  sessionId: string;
  runId?: string;
  mode?: string;
  title?: string;
  summary?: string;
  status?: string;
  messages?: TheOneChatSessionMessage[];
  attachments?: TheOneChatAttachment[];
  metadata?: unknown;
};

const offlineSessions = new Map<string, TheOneChatSessionSnapshot & {
  createdAt: string;
  updatedAt: string;
}>();

function now() {
  return new Date().toISOString();
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isSqlite() {
  return String(process.env.DATABASE_URL || '').startsWith('file:');
}

async function ensureChatSessionTable() {
  await ensureTheOneDatabase();
  if (isSqlite()) {
    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneChatSession (
        id text primary key not null,
        title text not null,
        mode text not null default 'assist',
        status text not null default 'active',
        latestRunId text,
        summary text not null default '',
        messagesJson text not null default '[]',
        attachmentsJson text not null default '[]',
        metadataJson text,
        createdAt datetime not null default current_timestamp,
        updatedAt datetime not null default current_timestamp
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneChatSession_updatedAt_idx on TheOneChatSession(updatedAt)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneChatSession_latestRunId_idx on TheOneChatSession(latestRunId)`);
    return;
  }

  await prisma.$executeRawUnsafe(`
    create table if not exists "TheOneChatSession" (
      id text primary key not null,
      title text not null,
      mode text not null default 'assist',
      status text not null default 'active',
      latestRunId text,
      summary text not null default '',
      messagesJson text not null default '[]',
      attachmentsJson text not null default '[]',
      metadataJson text,
      createdAt timestamptz not null default now(),
      updatedAt timestamptz not null default now()
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneChatSession_updatedAt_idx" on "TheOneChatSession"(updatedAt)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneChatSession_latestRunId_idx" on "TheOneChatSession"(latestRunId)`);
}

function normalizeSnapshot(input: TheOneChatSessionSnapshot) {
  return {
    sessionId: input.sessionId,
    runId: input.runId || null,
    mode: input.mode || 'assist',
    title: (input.title || input.messages?.find((message) => message.role === 'user')?.content || 'TheOne chat').slice(0, 160),
    summary: input.summary || '',
    status: input.status || 'active',
    messages: (input.messages || []).slice(-80),
    attachments: (input.attachments || []).slice(-20),
    metadata: input.metadata ?? null,
  };
}

export async function saveChatSessionSnapshot(input: TheOneChatSessionSnapshot) {
  const item = normalizeSnapshot(input);
  const updatedAt = now();

  try {
    await ensureChatSessionTable();
    if (isSqlite()) {
      await prisma.$executeRawUnsafe(
        `insert into TheOneChatSession (id, title, mode, status, latestRunId, summary, messagesJson, attachmentsJson, metadataJson, updatedAt)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
         on conflict(id) do update set
           title = excluded.title,
           mode = excluded.mode,
           status = excluded.status,
           latestRunId = excluded.latestRunId,
           summary = excluded.summary,
           messagesJson = excluded.messagesJson,
           attachmentsJson = excluded.attachmentsJson,
           metadataJson = excluded.metadataJson,
           updatedAt = current_timestamp`,
        item.sessionId,
        item.title,
        item.mode,
        item.status,
        item.runId,
        item.summary,
        safeStringify(item.messages),
        safeStringify(item.attachments),
        safeStringify(item.metadata)
      );
    } else {
      await prisma.$executeRawUnsafe(
        `insert into "TheOneChatSession" (id, title, mode, status, latestRunId, summary, messagesJson, attachmentsJson, metadataJson, updatedAt)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         on conflict(id) do update set
           title = excluded.title,
           mode = excluded.mode,
           status = excluded.status,
           latestRunId = excluded.latestRunId,
           summary = excluded.summary,
           messagesJson = excluded.messagesJson,
           attachmentsJson = excluded.attachmentsJson,
           metadataJson = excluded.metadataJson,
           updatedAt = now()`,
        item.sessionId,
        item.title,
        item.mode,
        item.status,
        item.runId,
        item.summary,
        safeStringify(item.messages),
        safeStringify(item.attachments),
        safeStringify(item.metadata)
      );
    }
  } catch {
    const existing = offlineSessions.get(item.sessionId);
    offlineSessions.set(item.sessionId, {
      ...item,
      sessionId: item.sessionId,
      runId: item.runId || undefined,
      metadata: item.metadata,
      createdAt: existing?.createdAt || updatedAt,
      updatedAt,
    });
  }
}

function mapRow(row: Record<string, any>) {
  return {
    sessionId: row.id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    latestRunId: row.latestRunId || row.latestrunid,
    summary: row.summary,
    messages: safeParse<TheOneChatSessionMessage[]>(row.messagesJson, []),
    attachments: safeParse<TheOneChatAttachment[]>(row.attachmentsJson, []),
    metadata: safeParse<Record<string, unknown> | null>(row.metadataJson, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getChatSession(sessionId: string) {
  try {
    await ensureChatSessionTable();
    const rows = isSqlite()
      ? await prisma.$queryRawUnsafe<any[]>(`select * from TheOneChatSession where id = ? limit 1`, sessionId)
      : await prisma.$queryRawUnsafe<any[]>(`select * from "TheOneChatSession" where id = $1 limit 1`, sessionId);
    return rows[0] ? mapRow(rows[0]) : null;
  } catch {
    return offlineSessions.get(sessionId) || null;
  }
}

export async function listChatSessions(limit = 30) {
  try {
    await ensureChatSessionTable();
    const rows = isSqlite()
      ? await prisma.$queryRawUnsafe<any[]>(`select * from TheOneChatSession order by updatedAt desc limit ?`, limit)
      : await prisma.$queryRawUnsafe<any[]>(`select * from "TheOneChatSession" order by updatedAt desc limit $1`, limit);
    return rows.map(mapRow);
  } catch {
    return [...offlineSessions.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
}
