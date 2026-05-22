import { ensureTheOneDatabase, prisma } from '../db/prisma';

export type TheOneLedgerEvent = {
  id?: string;
  runId?: string | null;
  type: string;
  provider?: string;
  status?: string;
  summary: string;
  payload?: unknown;
  createdAt?: string;
};

function eventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parsePayload(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function recordTheOneEvent(input: TheOneLedgerEvent) {
  await ensureTheOneDatabase();
  const id = input.id || eventId();
  await prisma.$executeRawUnsafe(
    `insert into "TheOneEvent" (id, runId, type, provider, status, summary, payloadJson)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do nothing`,
    id,
    input.runId || null,
    input.type,
    input.provider || 'theone',
    input.status || 'recorded',
    input.summary,
    input.payload === undefined ? null : safeJson(input.payload)
  );
  return { ...input, id };
}

export async function listTheOneEvents(limit = 50) {
  await ensureTheOneDatabase();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `select * from "TheOneEvent" order by createdAt desc limit $1`,
    Math.max(1, Math.min(limit, 200))
  );

  return rows.map((row) => ({
    id: row.id,
    runId: row.runid ?? row.runId ?? null,
    type: row.type,
    provider: row.provider,
    status: row.status,
    summary: row.summary,
    payload: parsePayload(row.payloadjson ?? row.payloadJson),
    createdAt: row.createdat?.toISOString?.() || row.createdAt?.toISOString?.() || row.createdat || row.createdAt,
  }));
}
