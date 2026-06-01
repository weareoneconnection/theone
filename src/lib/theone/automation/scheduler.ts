import { ensureTheOneDatabase, prisma } from '../db/prisma';
import { recordTheOneEvent } from '../events/event-ledger';
import { runTheOne } from '../orchestrator';
import { saveRunResult } from '../state/run-store';
import type { TheOneMode } from '../types';

export type AutomationJob = {
  id: string;
  name: string;
  triggerType: 'interval' | 'event' | 'manual';
  trigger: Record<string, unknown>;
  command: string;
  mode: TheOneMode;
  status: 'active' | 'paused';
  maxRunsPerDay: number;
  cooldownMinutes: number;
  failureStreak: number;
  circuitOpen: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AutomationRouteEvent = {
  id: string;
  source: string;
  eventType: string;
  externalId?: string | null;
  summary: string;
  payload?: unknown;
};

export type AutomationRunRecord = {
  id: string;
  jobId: string;
  runId?: string | null;
  status: string;
  summary: string;
  payload?: unknown;
  createdAt?: string;
};

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseJson(value: string | null | undefined) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function iso(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value);
}

function parseJob(row: any): AutomationJob {
  return {
    id: row.id,
    name: row.name,
    triggerType: row.triggertype ?? row.triggerType,
    trigger: parseJson(row.triggerjson ?? row.triggerJson),
    command: row.command,
    mode: row.mode,
    status: row.status,
    maxRunsPerDay: Number(row.maxrunsperday ?? row.maxRunsPerDay ?? 3),
    cooldownMinutes: Number(row.cooldownminutes ?? row.cooldownMinutes ?? 60),
    failureStreak: Number(row.failurestreak ?? row.failureStreak ?? 0),
    circuitOpen: Boolean(row.circuitopen ?? row.circuitOpen),
    lastRunAt: iso(row.lastrunat ?? row.lastRunAt),
    nextRunAt: iso(row.nextrunat ?? row.nextRunAt),
    createdAt: iso(row.createdat ?? row.createdAt) || undefined,
    updatedAt: iso(row.updatedat ?? row.updatedAt) || undefined,
  };
}

function parseRun(row: any): AutomationRunRecord {
  return {
    id: row.id,
    jobId: row.jobid ?? row.jobId,
    runId: row.runid ?? row.runId,
    status: row.status,
    summary: row.summary,
    payload: parseJson(row.payloadjson ?? row.payloadJson),
    createdAt: iso(row.createdat ?? row.createdAt) || undefined,
  };
}

function nextRunDate(job: Pick<AutomationJob, 'cooldownMinutes'>) {
  return new Date(Date.now() + Math.max(5, job.cooldownMinutes) * 60 * 1000).toISOString();
}

async function seedDefaultsIfEmpty() {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>('select count(*) as count from "TheOneAutomationJob"');
  if (Number(rows[0]?.count || 0) > 0) return;

  await upsertAutomationJob({
    id: 'job_x_growth_guarded',
    name: 'Guarded X Growth Loop',
    triggerType: 'interval',
    trigger: { source: 'x', intervalMinutes: 240, dailyPostLimit: 3, dailyReplyLimit: 6, circuitBreakerFailures: 2 },
    command: 'Monitor X for safe reply opportunities, only prepare strict reply_only tasks, and avoid public posting unless manually approved.',
    mode: 'assist',
    status: 'paused',
    maxRunsPerDay: 3,
    cooldownMinutes: 240,
    failureStreak: 0,
    circuitOpen: false,
    nextRunAt: nextRunDate({ cooldownMinutes: 240 }),
  });

  await upsertAutomationJob({
    id: 'job_x_event_reply_guarded',
    name: 'X Event Reply Router',
    triggerType: 'event',
    trigger: { source: 'x.recent_search', eventType: 'x.tweet_found', worker: 'x_growth_worker' },
    command: 'Review this X event, decide if it is safe and relevant, and prepare only a strict reply_only OneClaw task. Do not publish a standalone post.',
    mode: 'assist',
    status: 'paused',
    maxRunsPerDay: 6,
    cooldownMinutes: 60,
    failureStreak: 0,
    circuitOpen: false,
    nextRunAt: nextRunDate({ cooldownMinutes: 60 }),
  });

  await upsertAutomationJob({
    id: 'job_github_actions_event',
    name: 'GitHub Actions Event Router',
    triggerType: 'event',
    trigger: { source: 'github.actions', eventType: 'github.workflow_run', worker: 'github_worker' },
    command: 'Inspect this GitHub Actions event, summarize status, identify blockers, and create a guarded follow-up only if needed.',
    mode: 'assist',
    status: 'paused',
    maxRunsPerDay: 10,
    cooldownMinutes: 30,
    failureStreak: 0,
    circuitOpen: false,
    nextRunAt: nextRunDate({ cooldownMinutes: 30 }),
  });
}

export async function listAutomationJobs() {
  await ensureTheOneDatabase();
  await seedDefaultsIfEmpty();
  const rows = await prisma.$queryRawUnsafe<any[]>('select * from "TheOneAutomationJob" order by createdAt desc');
  return rows.map(parseJob);
}

export async function listAutomationRuns(input: { jobIds?: string[]; limit?: number } = {}) {
  await ensureTheOneDatabase();
  const limit = Math.max(1, Math.min(input.limit || 50, 200));
  const jobIds = (input.jobIds || []).filter(Boolean);
  const rows = jobIds.length
    ? await prisma.$queryRawUnsafe<any[]>(
      `select * from "TheOneAutomationRun" where jobId = any($1::text[]) order by createdAt desc limit $2`,
      jobIds,
      limit
    )
    : await prisma.$queryRawUnsafe<any[]>(`select * from "TheOneAutomationRun" order by createdAt desc limit $1`, limit);
  return rows.map(parseRun);
}

export async function upsertAutomationJob(input: Partial<AutomationJob>) {
  await ensureTheOneDatabase();
  const job: AutomationJob = {
    id: input.id || id('job'),
    name: String(input.name || 'Untitled automation').trim(),
    triggerType: input.triggerType || 'manual',
    trigger: input.trigger || {},
    command: String(input.command || '').trim(),
    mode: input.mode || 'assist',
    status: input.status || 'paused',
    maxRunsPerDay: Number(input.maxRunsPerDay || 3),
    cooldownMinutes: Number(input.cooldownMinutes || 60),
    failureStreak: Number(input.failureStreak || 0),
    circuitOpen: input.circuitOpen === true,
    lastRunAt: input.lastRunAt || null,
    nextRunAt: input.nextRunAt || nextRunDate({ cooldownMinutes: Number(input.cooldownMinutes || 60) }),
  };

  if (!job.command) throw new Error('Automation command is required.');

  await prisma.$executeRawUnsafe(
    `insert into "TheOneAutomationJob" (id, name, triggerType, triggerJson, command, mode, status, maxRunsPerDay, cooldownMinutes, failureStreak, circuitOpen, lastRunAt, nextRunAt)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (id) do update set
       name = excluded.name,
       triggerType = excluded.triggerType,
       triggerJson = excluded.triggerJson,
       command = excluded.command,
       mode = excluded.mode,
       status = excluded.status,
       maxRunsPerDay = excluded.maxRunsPerDay,
       cooldownMinutes = excluded.cooldownMinutes,
       failureStreak = excluded.failureStreak,
       circuitOpen = excluded.circuitOpen,
       lastRunAt = excluded.lastRunAt,
       nextRunAt = excluded.nextRunAt,
       updatedAt = now()`,
    job.id,
    job.name,
    job.triggerType,
    safeJson(job.trigger),
    job.command,
    job.mode,
    job.status,
    job.maxRunsPerDay,
    job.cooldownMinutes,
    job.failureStreak,
    job.circuitOpen,
    job.lastRunAt,
    job.nextRunAt
  );

  return job;
}

async function countRunsToday(jobId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `select count(*) as count from "TheOneAutomationRun" where jobId = $1 and createdAt >= date_trunc('day', now())`,
    jobId
  );
  return Number(rows[0]?.count || 0);
}

async function recordAutomationRun(input: { jobId: string; runId?: string | null; status: string; summary: string; payload?: unknown }) {
  await prisma.$executeRawUnsafe(
    `insert into "TheOneAutomationRun" (id, jobId, runId, status, summary, payloadJson)
     values ($1,$2,$3,$4,$5,$6)`,
    id('autorun'),
    input.jobId,
    input.runId || null,
    input.status,
    input.summary,
    input.payload === undefined ? null : safeJson(input.payload)
  );
}

function eventContextCommand(job: AutomationJob, event?: AutomationRouteEvent) {
  if (!event) return job.command;
  return [
    job.command,
    '',
    'TheOne external event context:',
    `source=${event.source}`,
    `eventType=${event.eventType}`,
    event.externalId ? `externalId=${event.externalId}` : '',
    `summary=${event.summary}`,
    `payload=${safeJson(event.payload).slice(0, 4000)}`,
  ].filter(Boolean).join('\n');
}

export async function executeAutomationJob(job: AutomationJob, event?: AutomationRouteEvent) {
  const runsToday = await countRunsToday(job.id);
  if (runsToday >= job.maxRunsPerDay) {
    await recordAutomationRun({ jobId: job.id, status: 'skipped', summary: 'Daily automation run limit reached.', payload: { event } });
    return { job, status: 'skipped', reason: 'daily_limit' };
  }

  try {
    const result = await runTheOne({
      raw: eventContextCommand(job, event),
      mode: job.mode,
      language: 'en',
    });
    const stored = await saveRunResult(result);
    await recordAutomationRun({
      jobId: job.id,
      runId: stored.runId,
      status: stored.ok ? 'success' : 'failed',
      summary: stored.intent.objective,
      payload: { stored, event },
    });
    await prisma.$executeRawUnsafe(
      `update "TheOneAutomationJob" set lastRunAt = now(), nextRunAt = $2, failureStreak = $3, circuitOpen = $4, updatedAt = now() where id = $1`,
      job.id,
      nextRunDate(job),
      stored.ok ? 0 : job.failureStreak + 1,
      stored.ok ? false : job.failureStreak + 1 >= 2
    );
    await recordTheOneEvent({
      runId: stored.runId,
      type: event ? 'automation.event_routed' : 'automation.tick',
      provider: 'theone',
      status: stored.ok ? 'success' : 'failed',
      summary: event ? `${job.name} routed ${event.eventType}.` : `${job.name} triggered TheOne.`,
      payload: { jobId: job.id, command: job.command, event },
    });
    return { job, status: stored.ok ? 'success' : 'failed', runId: stored.runId };
  } catch (error) {
    const failureStreak = job.failureStreak + 1;
    await recordAutomationRun({
      jobId: job.id,
      status: 'failed',
      summary: error instanceof Error ? error.message : 'Automation failed.',
      payload: { event },
    });
    await prisma.$executeRawUnsafe(
      `update "TheOneAutomationJob" set lastRunAt = now(), nextRunAt = $2, failureStreak = $3, circuitOpen = $4, updatedAt = now() where id = $1`,
      job.id,
      nextRunDate(job),
      failureStreak,
      failureStreak >= 2
    );
    return { job, status: 'failed', error: error instanceof Error ? error.message : 'Automation failed.' };
  }
}

export async function tickAutomationScheduler({ limit = 3, force = false } = {}) {
  await ensureTheOneDatabase();
  await seedDefaultsIfEmpty();

  const rows = await prisma.$queryRawUnsafe<any[]>(
    force
      ? `select * from "TheOneAutomationJob" where status = 'active' and circuitOpen = false order by nextRunAt asc nulls first limit $1`
      : `select * from "TheOneAutomationJob" where status = 'active' and circuitOpen = false and (nextRunAt is null or nextRunAt <= now()) order by nextRunAt asc nulls first limit $1`,
    Math.max(1, Math.min(limit, 10))
  );
  const jobs = rows.map(parseJob);
  const results = [];

  for (const job of jobs) {
    results.push(await executeAutomationJob(job));
  }

  return {
    ok: true,
    checked: jobs.length,
    results,
  };
}

export async function resetAutomationCircuits(input: { jobId?: string } = {}) {
  await ensureTheOneDatabase();
  await seedDefaultsIfEmpty();

  if (input.jobId) {
    await prisma.$executeRawUnsafe(
      `update "TheOneAutomationJob" set failureStreak = 0, circuitOpen = false, nextRunAt = now(), updatedAt = now() where id = $1`,
      input.jobId
    );
    await recordTheOneEvent({
      type: 'automation.circuit_reset',
      provider: 'theone',
      status: 'completed',
      summary: `Reset automation circuit for ${input.jobId}.`,
      payload: { jobId: input.jobId },
    });
  } else {
    await prisma.$executeRawUnsafe(
      `update "TheOneAutomationJob" set failureStreak = 0, circuitOpen = false, nextRunAt = now(), updatedAt = now() where circuitOpen = true or failureStreak > 0`
    );
    await recordTheOneEvent({
      type: 'automation.circuit_reset',
      provider: 'theone',
      status: 'completed',
      summary: 'Reset all automation circuits.',
      payload: { scope: 'all' },
    });
  }

  return {
    ok: true,
    jobs: await listAutomationJobs(),
  };
}
