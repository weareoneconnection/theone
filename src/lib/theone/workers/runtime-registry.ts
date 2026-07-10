import { getOneClawCapabilityManifest } from '../providers/oneclaw';
import type { OneClawCapabilityDefinition, OneClawConnectorReadiness } from '../types';

export type WorkerRuntimeDefinition = {
  key: string;
  title: string;
  provider: 'theone' | 'oneai' | 'oneclaw';
  domain: string;
  status: 'live' | 'guarded' | 'prepared' | 'missing';
  actions: string[];
  eventSources: string[];
  policy: string;
};

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function workerStatus(input: {
  provider: WorkerRuntimeDefinition['provider'];
  configured: boolean;
  capabilities: OneClawCapabilityDefinition[];
  fallback: WorkerRuntimeDefinition['status'];
}) {
  if (input.provider === 'theone') return input.fallback;
  if (input.capabilities.length === 0) return 'missing';
  if (!input.configured) {
    return input.capabilities.some((capability) => capability.liveMode === 'prepared')
      ? 'prepared'
      : 'guarded';
  }
  if (input.capabilities.every((capability) => capability.liveMode === 'live')) return 'live';
  if (input.capabilities.some((capability) => capability.liveMode === 'prepared')) return 'prepared';
  return 'guarded';
}

function eventSourcesFor(domain: string, connectorKey: string) {
  const map: Record<string, string[]> = {
    social: ['x.recent_search', 'webhook.x'],
    x: ['x.recent_search', 'webhook.x'],
    git: ['github.actions', 'github.webhook'],
    code: ['github.actions', 'github.webhook'],
    email: ['email.inbox', 'webhook.email'],
    calendar: ['calendar.event', 'webhook.calendar'],
    database: ['database.change', 'webhook.database'],
    browser: ['webhook.browser'],
    api: ['webhook.api'],
    payment: ['webhook.payment'],
    knowledge: ['webhook.knowledge'],
    file: ['webhook.file'],
  };
  return map[connectorKey] || map[domain] || [`webhook.${connectorKey || domain}`];
}

function policyFor(domain: string, capabilities: OneClawCapabilityDefinition[]) {
  const highRisk = capabilities.filter((capability) => capability.risk === 'high' || capability.approvalRequired).length;
  const reads = capabilities.filter((capability) => capability.risk === 'low' && !capability.approvalRequired).length;
  if (highRisk > 0 && reads > 0) return 'Read actions can be automated after preflight; write or high-risk actions stay approval-gated.';
  if (highRisk > 0) return 'High-risk actions stay approval-gated until production policy and connector scope are explicit.';
  if (domain === 'browser' || domain === 'api') return 'Guarded operation can run with allowlists, preflight, and proof capture.';
  return 'Low-risk actions can run automatically when connector readiness and policy checks pass.';
}

function buildDynamicWorkers(input: {
  capabilities: OneClawCapabilityDefinition[];
  connectors: OneClawConnectorReadiness[];
}) {
  const connectorByKey = new Map(input.connectors.map((connector) => [connector.key, connector]));
  const groups = new Map<string, OneClawCapabilityDefinition[]>();

  for (const capability of input.capabilities) {
    const key = capability.connectorKey || capability.domain || 'general';
    groups.set(key, [...(groups.get(key) || []), capability]);
  }

  return Array.from(groups.entries()).map(([key, capabilities]) => {
    const connector = connectorByKey.get(key);
    const domain = connector?.domain || capabilities[0]?.domain || key;
    const configured = connector?.status === 'connected' || connector?.mode === 'live';
    const worker: WorkerRuntimeDefinition = {
      key: `${key}_worker`,
      title: `${connector?.title || titleCase(key)} Worker`,
      provider: 'oneclaw',
      domain,
      status: workerStatus({ provider: 'oneclaw', configured, capabilities, fallback: 'prepared' }),
      actions: capabilities.map((capability) => capability.action).sort(),
      eventSources: eventSourcesFor(domain, key),
      policy: policyFor(domain, capabilities),
    };

    return {
      ...worker,
      source: 'oneclaw_manifest',
      connector: connector || null,
      maturity: capabilities.reduce<Record<string, number>>((summary, capability) => {
        summary[capability.maturity] = (summary[capability.maturity] || 0) + 1;
        return summary;
      }, {}),
      risk: capabilities.reduce<Record<string, number>>((summary, capability) => {
        summary[capability.risk] = (summary[capability.risk] || 0) + 1;
        return summary;
      }, {}),
      liveActions: capabilities.filter((capability) => capability.liveMode === 'live').map((capability) => capability.action),
      preparedActions: capabilities.filter((capability) => capability.liveMode === 'prepared').map((capability) => capability.action),
      approvalActions: capabilities.filter((capability) => capability.approvalRequired).map((capability) => capability.action),
      missingActions: [],
    };
  });
}

const baseWorkers: WorkerRuntimeDefinition[] = [
  {
    key: 'x_growth_worker',
    title: 'X Growth Worker',
    provider: 'oneclaw',
    domain: 'social',
    status: 'guarded',
    actions: ['x.searchRecentTweets', 'social.post'],
    eventSources: ['x.recent_search', 'webhook.x'],
    policy: 'Read automatically; reply_only can auto-run when strict safeguards pass; public posts stay approval-gated.',
  },
  {
    key: 'github_worker',
    title: 'GitHub Worker',
    provider: 'oneclaw',
    domain: 'code',
    status: 'guarded',
    actions: ['git.repo.get', 'git.actions.runs', 'git.checks.list', 'git.issue.create'],
    eventSources: ['github.actions', 'github.webhook'],
    policy: 'Read automatically; issue/PR creation is approval-gated.',
  },
  {
    key: 'code_workspace_worker',
    title: 'Code Workspace Worker',
    provider: 'theone',
    domain: 'code',
    status: 'live',
    actions: ['code.workspace.scan', 'code.plan.change', 'code.patch.prepare', 'code.patch.apply', 'code.validate.run', 'code.delivery.prepare', 'code.review.risk'],
    eventSources: ['filesystem.change', 'github.actions', 'code.review'],
    policy: 'Repository reading, change planning, and patch drafting can run automatically; applying patches, shell commands, commits, pushes, and PRs require approval.',
  },
  {
    key: 'email_worker',
    title: 'Email Worker',
    provider: 'oneclaw',
    domain: 'email',
    status: 'prepared',
    actions: ['email.search', 'email.draft', 'email.send'],
    eventSources: ['email.inbox', 'webhook.email'],
    policy: 'Search and draft can be assisted; sends require approval.',
  },
  {
    key: 'calendar_worker',
    title: 'Calendar Worker',
    provider: 'oneclaw',
    domain: 'calendar',
    status: 'prepared',
    actions: ['calendar.availability.check', 'calendar.event.create', 'calendar.event.update'],
    eventSources: ['calendar.event', 'webhook.calendar'],
    policy: 'Availability can run automatically; event creation/update requires approval.',
  },
  {
    key: 'database_worker',
    title: 'Database Worker',
    provider: 'oneclaw',
    domain: 'database',
    status: 'guarded',
    actions: ['database.schema.inspect', 'database.query', 'database.write'],
    eventSources: ['database.change', 'webhook.database'],
    policy: 'Read-only query can run with allowlists; writes are blocked or approval-gated.',
  },
  {
    key: 'webhook_worker',
    title: 'Webhook Worker',
    provider: 'theone',
    domain: 'event',
    status: 'live',
    actions: ['event.ingest', 'automation.tick'],
    eventSources: ['webhook.generic'],
    policy: 'Inbound events are normalized first, then routed through policy before execution.',
  },
  {
    key: 'oneai_bot_worker',
    title: 'OneAI Bot Worker',
    provider: 'theone',
    domain: 'community',
    status: 'prepared',
    actions: ['oneai.bot.status', 'oneai.bot.community_context', 'oneai.bot.oneclaw_bridge'],
    eventSources: ['telegram.webhook', 'bot.community_event', 'bot.oneclaw_execution'],
    policy: 'TheOne may inspect bot readiness and route community context; Telegram sends and bot-triggered OneClaw execution stay approval and bot-context gated.',
  },
];

export async function listWorkerRuntimes() {
  const manifest = await getOneClawCapabilityManifest();
  const actionSet = new Set((manifest.capabilities || []).map((capability) => capability.action));
  const connectorByDomain = new Map((manifest.connectors || []).map((connector) => [connector.domain, connector]));
  const dynamicWorkers = buildDynamicWorkers({
    capabilities: manifest.capabilities || [],
    connectors: manifest.connectors || [],
  });

  const curatedWorkers = baseWorkers.map((worker) => {
    const liveActions = worker.actions.filter((action) => actionSet.has(action));
    const connector = connectorByDomain.get(worker.domain);
    const connected = connector?.status === 'connected' || connector?.mode === 'live';

    return {
      ...worker,
      status: worker.provider === 'theone'
        ? worker.status
        : liveActions.length === worker.actions.length && connected
          ? 'live'
          : liveActions.length > 0
            ? worker.status
            : 'missing',
      liveActions,
      missingActions: worker.actions.filter((action) => !actionSet.has(action)),
      connector: connector || null,
    };
  });

  const existing = new Set(curatedWorkers.map((worker) => worker.key));
  return [
    ...curatedWorkers.map((worker) => ({ ...worker, source: 'theone_curated' })),
    ...dynamicWorkers.filter((worker) => !existing.has(worker.key)),
  ].sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    return a.title.localeCompare(b.title);
  });
}
