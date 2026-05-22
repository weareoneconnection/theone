import { ensureTheOneDatabase, prisma } from '../db/prisma';
import { executeAutomationJob, listAutomationJobs, type AutomationJob, type AutomationRouteEvent } from '../automation/scheduler';
import { recordTheOneEvent } from './event-ledger';
import { runOneClawAction } from '../providers/oneclaw';

export type ExternalEventInput = {
  source: string;
  eventType: string;
  externalId?: string | null;
  summary: string;
  payload?: unknown;
};

export type ExternalEventRecord = ExternalEventInput & {
  id: string;
  status: string;
  createdAt?: string;
};

export const eventSourceDefinitions = [
  {
    key: 'x.recent_search',
    title: 'X Recent Search',
    status: 'live',
    worker: 'x_growth_worker',
    action: 'x.searchRecentTweets',
    defaultInput: { query: 'AI agents workflow', maxResults: 10 },
  },
  {
    key: 'github.actions',
    title: 'GitHub Actions Runs',
    status: 'live',
    worker: 'github_worker',
    action: 'git.actions.runs',
    defaultInput: { repo: 'weareoneconnection/oneaitradingbot', branch: 'main' },
  },
  {
    key: 'email.inbox',
    title: 'Email Inbox',
    status: 'prepared',
    worker: 'email_worker',
    action: 'email.search',
    defaultInput: { query: 'newer_than:1d' },
  },
  {
    key: 'calendar.event',
    title: 'Calendar Events',
    status: 'prepared',
    worker: 'calendar_worker',
    action: 'calendar.availability.check',
    defaultInput: {},
  },
  {
    key: 'database.change',
    title: 'Database Change',
    status: 'prepared',
    worker: 'database_worker',
    action: 'database.query',
    defaultInput: { sql: 'select 1 as health_check' },
  },
  {
    key: 'webhook.generic',
    title: 'Generic Webhook',
    status: 'live',
    worker: 'webhook_worker',
    action: 'event.ingest',
    defaultInput: {},
  },
];

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

function extractEvents(sourceKey: string, response: any): ExternalEventInput[] {
  if (sourceKey === 'x.recent_search') {
    const tweets = response?.steps?.[0]?.output?.tweets || response?.tweets || response?.response?.tweets || [];
    return Array.isArray(tweets)
      ? tweets.slice(0, 10).map((tweet: any) => ({
        source: sourceKey,
        eventType: 'x.tweet_found',
        externalId: String(tweet.id || ''),
        summary: String(tweet.text || '').slice(0, 180) || 'X tweet found',
        payload: tweet,
      }))
      : [];
  }

  if (sourceKey === 'github.actions') {
    const runs = response?.steps?.[0]?.output?.response?.workflow_runs || response?.response?.workflow_runs || [];
    return Array.isArray(runs)
      ? runs.slice(0, 10).map((run: any) => ({
        source: sourceKey,
        eventType: 'github.workflow_run',
        externalId: String(run.id || run.run_number || ''),
        summary: `${run.name || 'GitHub workflow'} ${run.status || ''} ${run.conclusion || ''}`.trim(),
        payload: run,
      }))
      : [];
  }

  return [{
    source: sourceKey,
    eventType: `${sourceKey}.polled`,
    externalId: id('external'),
    summary: `${sourceKey} source polled.`,
    payload: response,
  }];
}

export async function ingestExternalEvent(input: ExternalEventInput) {
  await ensureTheOneDatabase();
  const eventId = id('ext');

  await prisma.$executeRawUnsafe(
    `insert into "TheOneExternalEvent" (id, source, eventType, externalId, status, summary, payloadJson)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (id) do nothing`,
    eventId,
    input.source,
    input.eventType,
    input.externalId || null,
    'received',
    input.summary,
    input.payload === undefined ? null : safeJson(input.payload)
  );

  await recordTheOneEvent({
    id: `evt_${eventId}`,
    type: `external.${input.eventType}`,
    provider: input.source,
    status: 'received',
    summary: input.summary,
    payload: input.payload,
  });

  return { ...input, id: eventId, status: 'received' };
}

export async function listExternalEvents(limit = 30) {
  await ensureTheOneDatabase();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `select * from "TheOneExternalEvent" order by createdAt desc limit $1`,
    Math.max(1, Math.min(limit, 100))
  );

  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    eventType: row.eventtype ?? row.eventType,
    externalId: row.externalid ?? row.externalId,
    status: row.status,
    summary: row.summary,
    payload: parsePayload(row.payloadjson ?? row.payloadJson),
    createdAt: row.createdat?.toISOString?.() || row.createdAt?.toISOString?.() || row.createdat || row.createdAt,
  }));
}

function sourceMatches(trigger: Record<string, unknown>, event: ExternalEventRecord) {
  const source = trigger.source;
  const sources = Array.isArray(trigger.sources) ? trigger.sources.map(String) : [];
  return source === event.source || sources.includes(event.source);
}

function eventTypeMatches(trigger: Record<string, unknown>, event: ExternalEventRecord) {
  const eventType = trigger.eventType;
  const eventTypes = Array.isArray(trigger.eventTypes) ? trigger.eventTypes.map(String) : [];
  return !eventType && eventTypes.length === 0
    ? true
    : eventType === event.eventType || eventTypes.includes(event.eventType);
}

function matchesJob(job: AutomationJob, event: ExternalEventRecord) {
  return job.status === 'active' &&
    job.triggerType === 'event' &&
    !job.circuitOpen &&
    sourceMatches(job.trigger, event) &&
    eventTypeMatches(job.trigger, event);
}

async function markEventStatus(eventId: string, status: string) {
  await prisma.$executeRawUnsafe(
    `update "TheOneExternalEvent" set status = $2 where id = $1`,
    eventId,
    status
  );
}

export async function routeExternalEvents(input: { limit?: number; force?: boolean } = {}) {
  await ensureTheOneDatabase();
  const jobs = await listAutomationJobs();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    input.force
      ? `select * from "TheOneExternalEvent" where status in ('received','routed','unmatched') order by createdAt asc limit $1`
      : `select * from "TheOneExternalEvent" where status = 'received' order by createdAt asc limit $1`,
    Math.max(1, Math.min(input.limit || 10, 50))
  );
  const events = rows.map((row) => ({
    id: row.id,
    source: row.source,
    eventType: row.eventtype ?? row.eventType,
    externalId: row.externalid ?? row.externalId,
    status: row.status,
    summary: row.summary,
    payload: parsePayload(row.payloadjson ?? row.payloadJson),
    createdAt: row.createdat?.toISOString?.() || row.createdAt?.toISOString?.() || row.createdat || row.createdAt,
  })) as ExternalEventRecord[];
  const results = [];

  for (const event of events) {
    const matches = jobs.filter((job) => matchesJob(job, event));
    if (matches.length === 0) {
      await markEventStatus(event.id, 'unmatched');
      results.push({ event, status: 'unmatched', matches: 0 });
      continue;
    }

    const routeResults = [];
    for (const job of matches.slice(0, 3)) {
      const routeEvent: AutomationRouteEvent = {
        id: event.id,
        source: event.source,
        eventType: event.eventType,
        externalId: event.externalId,
        summary: event.summary,
        payload: event.payload,
      };
      routeResults.push(await executeAutomationJob(job, routeEvent));
    }
    await markEventStatus(event.id, routeResults.some((item: any) => item.runId) ? 'routed' : 'failed');
    await recordTheOneEvent({
      type: 'external.event_routed',
      provider: event.source,
      status: routeResults.some((item: any) => item.runId) ? 'routed' : 'failed',
      summary: `${event.eventType} matched ${matches.length} automation job(s).`,
      payload: { event, routeResults },
    });
    results.push({ event, status: 'routed', matches: matches.length, routeResults });
  }

  return {
    ok: true,
    checked: events.length,
    results,
  };
}

export async function pollEventSource(input: { source: string; sourceInput?: Record<string, unknown> }) {
  const source = eventSourceDefinitions.find((item) => item.key === input.source);
  if (!source) throw new Error(`Unknown event source: ${input.source}`);

  if (source.action === 'event.ingest') {
    return {
      ok: true,
      source,
      events: [],
      note: 'Webhook sources ingest events through POST /api/theone/events/ingest.',
    };
  }

  const response = await runOneClawAction({
    action: source.action,
    input: { ...source.defaultInput, ...(input.sourceInput || {}) },
    approvalMode: 'auto',
    idempotencyKey: `theone-event-source-${source.key}-${Date.now()}`,
  });
  const events = extractEvents(source.key, response);
  const stored = [];
  for (const event of events) {
    stored.push(await ingestExternalEvent(event));
  }

  return {
    ok: true,
    source,
    checked: events.length,
    events: stored,
    raw: response,
  };
}

export async function pollEventSources(input: { sources?: string[]; limit?: number } = {}) {
  const sourceKeys = input.sources?.length
    ? input.sources
    : eventSourceDefinitions.filter((source) => source.status === 'live').map((source) => source.key);
  const results = [];

  for (const source of sourceKeys.slice(0, Math.max(1, Math.min(input.limit || 3, 6)))) {
    try {
      results.push(await pollEventSource({ source }));
    } catch (error) {
      results.push({
        ok: false,
        source,
        error: error instanceof Error ? error.message : 'Event source poll failed.',
      });
    }
  }

  return {
    ok: true,
    results,
  };
}
