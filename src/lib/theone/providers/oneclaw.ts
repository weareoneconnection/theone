import { listOneClawCapabilities } from '../execution/oneclaw-capabilities';
import type {
  OneClawCapabilityDefinition,
  OneClawCapabilityManifest,
  OneClawConnectorReadiness,
  OneClawApprovalRecord,
  OneClawTask,
  OneClawTaskRun,
  ProviderConnectionCheck,
  ProviderStatus,
} from '../types';

function cleanBaseUrl(value: string | undefined) {
  return (value || '').trim().replace(/\/+$/, '');
}

export function getOneClawConfig() {
  return {
    baseUrl: cleanBaseUrl(process.env.ONECLAW_BASE_URL || process.env.ONECLAW_API_BASE_URL)
      || 'https://oneclaw-production.up.railway.app',
    token: String(
      process.env.ONECLAW_TOKEN ||
      process.env.ONECLAW_INTERNAL_TOKEN ||
      process.env.ONECLAW_ADMIN_TOKEN ||
      process.env.ONECLAW_API_KEY ||
      ''
    ).trim(),
    healthPath: String(process.env.ONECLAW_HEALTH_PATH || '/health').trim() || '/health',
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function getHeaders(token: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['x-api-key'] = token;
  }

  return headers;
}

function normalizeRisk(value: unknown): OneClawCapabilityDefinition['risk'] {
  if (value === 'critical' || value === 'high') return 'high';
  if (value === 'medium') return 'medium';
  return 'low';
}

function normalizeMaturity(value: unknown): OneClawCapabilityDefinition['maturity'] {
  if (value === 'production' || value === 'guarded' || value === 'prepared' || value === 'planned' || value === 'stub') {
    return value;
  }
  return 'guarded';
}

function normalizeCapabilities(items: any[]): OneClawCapabilityDefinition[] {
  return items.map((item) => {
    const action = String(item.action || '');
    const domain = String(item.domain || action.split('.')[0] || 'custom');
    return {
      action,
      title: String(item.title || item.description || action),
      domain,
      capabilities: [],
      connectorKey: item.connectorKey ? String(item.connectorKey) : domain,
      maturity: normalizeMaturity(item.maturity),
      liveMode: item.liveMode,
      risk: normalizeRisk(item.risk),
      approvalRequired: Boolean(item.approvalRequired),
      supportsDryRun: Boolean(item.supportsDryRun),
      supportsRollback: Boolean(item.supportsRollback),
      inputRequired: Array.isArray(item.inputSchema?.required) ? item.inputSchema.required.map(String) : [],
      outputContract: Array.isArray(item.outputContract) ? item.outputContract.map(String) : [],
      productionNote: String(item.description || `${action} via OneClaw`),
    };
  }).filter((item) => item.action);
}

function fallbackManifest(error?: string): OneClawCapabilityManifest {
  return {
    ok: false,
    service: 'oneclaw',
    version: 'fallback.static',
    capabilities: listOneClawCapabilities(),
    connectors: [],
    plugins: [],
    source: 'fallback',
    fetchedAt: new Date().toISOString(),
    error,
  };
}

export async function getOneClawCapabilityManifest(): Promise<OneClawCapabilityManifest> {
  const { baseUrl, token } = getOneClawConfig();
  if (!token) return fallbackManifest('ONECLAW token is not configured.');

  try {
    const res = await fetch(`${baseUrl}/v1/capabilities`, {
      method: 'GET',
      headers: getHeaders(token),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      return fallbackManifest(`OneClaw manifest returned ${res.status}.`);
    }

    const raw = await res.json() as any;
    return {
      ok: Boolean(raw.ok),
      service: String(raw.service || 'oneclaw'),
      version: String(raw.version || 'capability-manifest.v1'),
      maturity: raw.maturity && typeof raw.maturity === 'object' ? raw.maturity : undefined,
      capabilities: normalizeCapabilities(Array.isArray(raw.capabilities) ? raw.capabilities : []),
      connectors: Array.isArray(raw.connectors) ? raw.connectors as OneClawConnectorReadiness[] : [],
      plugins: Array.isArray(raw.plugins) ? raw.plugins : [],
      source: 'live',
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return fallbackManifest(error instanceof Error ? error.message : 'OneClaw manifest fetch failed.');
  }
}

function createNotConfiguredCheck(config: ReturnType<typeof getOneClawConfig>): ProviderConnectionCheck {
  return {
    key: 'oneclaw',
    label: 'OneClaw',
    configured: false,
    mode: 'mock',
    ok: false,
    status: 'not_configured',
    baseUrl: config.baseUrl,
    endpoint: joinUrl(config.baseUrl, config.healthPath),
    checkedAt: new Date().toISOString(),
    message: 'ONECLAW token is not configured; TheOne is using mock execution.',
  };
}

function mockTaskRun(task: OneClawTask): OneClawTaskRun {
  return {
    id: `mock_oneclaw_${Date.now()}`,
    status: 'mock',
    taskName: task.taskName,
    mock: true,
    raw: {
      provider: 'oneclaw',
      task,
    },
  };
}

export function getOneClawProviderStatus(): ProviderStatus {
  const config = getOneClawConfig();

  return {
    key: 'oneclaw',
    label: 'OneClaw',
    role: 'Default real-world execution driver',
    configured: Boolean(config.token),
    mode: config.token ? 'live' : 'mock',
    baseUrl: config.baseUrl,
    status: config.token ? 'ready' : 'mock',
    capabilities: [
      { name: 'tasks.run', kind: 'execution', risk: 'medium' },
      { name: 'tasks.get', kind: 'execution', risk: 'low' },
      { name: 'actions.execute', kind: 'execution', risk: 'high' },
      { name: 'social.post', kind: 'execution', risk: 'high' },
      { name: 'browser.extract', kind: 'execution', risk: 'medium' },
      { name: 'api.request', kind: 'execution', risk: 'medium' },
    ],
    warnings: config.token ? [] : ['ONECLAW token is not configured; using mock execution.'],
  };
}

export async function checkOneClawConnection(): Promise<ProviderConnectionCheck> {
  const config = getOneClawConfig();
  if (!config.token) return createNotConfiguredCheck(config);

  const endpoint = joinUrl(config.baseUrl, config.healthPath);
  const startedAt = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: getHeaders(config.token),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });

    return {
      key: 'oneclaw',
      label: 'OneClaw',
      configured: true,
      mode: 'live',
      ok: res.ok,
      status: res.ok ? 'connected' : 'unreachable',
      baseUrl: config.baseUrl,
      endpoint,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      statusCode: res.status,
      message: res.ok
        ? 'OneClaw health endpoint is reachable.'
        : `OneClaw health endpoint returned ${res.status}.`,
    };
  } catch (error) {
    return {
      key: 'oneclaw',
      label: 'OneClaw',
      configured: true,
      mode: 'live',
      ok: false,
      status: 'error',
      baseUrl: config.baseUrl,
      endpoint,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : 'OneClaw connection check failed.',
    };
  }
}

export async function runOneClawTask<T = OneClawTaskRun>(task: OneClawTask): Promise<T> {
  const { baseUrl, token } = getOneClawConfig();

  if (!token) {
    return mockTaskRun(task) as T;
  }

  const res = await fetch(`${baseUrl}/v1/tasks/run`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(task),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ONECLAW task request failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

export async function getOneClawTask<T = unknown>(taskId: string): Promise<T> {
  const { baseUrl, token } = getOneClawConfig();

  if (!token) {
    return {
      id: taskId,
      status: 'mock',
      mock: true,
    } as T;
  }

  const res = await fetch(`${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: getHeaders(token),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ONECLAW task lookup failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

export async function runOneClaw<T = unknown>(actions: unknown[]): Promise<T> {
  const task: OneClawTask = {
    taskName: 'theone_legacy_action_task',
    approvalMode: 'manual',
    metadata: {
      source: 'theone.legacy-actions',
    },
    steps: actions.map((action, index) => ({
      id: `step_${index + 1}`,
      action: 'message.draft',
      input: {
        action,
      },
      dependsOn: [],
    })),
  };

  return runOneClawTask<T>(task);
}

export async function runOneClawAction<T = unknown>(payload: {
  action: string;
  input: Record<string, unknown>;
  approvalMode?: 'auto' | 'manual';
  idempotencyKey?: string;
}): Promise<T> {
  const { baseUrl, token } = getOneClawConfig();

  if (!token) {
    return mockTaskRun({
      taskName: `action:${payload.action}`,
      approvalMode: payload.approvalMode,
      steps: [{ id: 'step_1', action: payload.action, input: payload.input }],
    }) as T;
  }

  const res = await fetch(`${baseUrl}/v1/actions/execute`, {
    method: 'POST',
    headers: {
      ...getHeaders(token),
      ...(payload.idempotencyKey ? { 'Idempotency-Key': payload.idempotencyKey } : {}),
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ONECLAW action request failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

export async function listOneClawPendingApprovals(): Promise<OneClawApprovalRecord[]> {
  const { baseUrl, token } = getOneClawConfig();
  if (!token) return [];

  const res = await fetch(`${baseUrl}/v1/approvals/pending`, {
    method: 'GET',
    headers: getHeaders(token),
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ONECLAW approval lookup failed: ${res.status} ${text}`);
  }

  const raw = await res.json();
  return Array.isArray(raw) ? raw as OneClawApprovalRecord[] : [];
}

export async function approveOneClawApproval<T = unknown>(payload: {
  approvalId: string;
  decidedBy?: string;
  decisionNote?: string;
}): Promise<T> {
  const { baseUrl, token } = getOneClawConfig();
  if (!token) {
    throw new Error('ONECLAW token is not configured.');
  }

  const res = await fetch(`${baseUrl}/v1/approvals/${encodeURIComponent(payload.approvalId)}/approve`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({
      decidedBy: payload.decidedBy || 'theone',
      decisionNote: payload.decisionNote || 'Approved from TheOne control plane.',
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ONECLAW approval failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

export async function rejectOneClawApproval<T = unknown>(payload: {
  approvalId: string;
  decidedBy?: string;
  decisionNote?: string;
}): Promise<T> {
  const { baseUrl, token } = getOneClawConfig();
  if (!token) {
    throw new Error('ONECLAW token is not configured.');
  }

  const res = await fetch(`${baseUrl}/v1/approvals/${encodeURIComponent(payload.approvalId)}/reject`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({
      decidedBy: payload.decidedBy || 'theone',
      decisionNote: payload.decisionNote || 'Rejected from TheOne control plane.',
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ONECLAW rejection failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}
