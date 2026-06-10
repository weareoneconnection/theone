import type {
  OneAIGeneratePayload,
  OneAIGenerateResult,
  OneClawTask,
  ProviderConnectionCheck,
  ProviderStatus,
} from '../types';

function cleanBaseUrl(value: string | undefined) {
  return (value || '').trim().replace(/\/+$/, '');
}

export function getOneAIConfig() {
  return {
    baseUrl: cleanBaseUrl(process.env.ONEAI_BASE_URL) || 'https://oneai-api-production.up.railway.app',
    apiKey: String(process.env.ONEAI_API_KEY || '').trim(),
    healthPath: String(process.env.ONEAI_HEALTH_PATH || '/health').trim() || '/health',
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function createNotConfiguredCheck(config: ReturnType<typeof getOneAIConfig>): ProviderConnectionCheck {
  return {
    key: 'oneai',
    label: 'OneAI',
    configured: false,
    mode: 'mock',
    ok: false,
    status: 'not_configured',
    baseUrl: config.baseUrl,
    endpoint: joinUrl(config.baseUrl, config.healthPath),
    checkedAt: new Date().toISOString(),
    message: 'ONEAI_API_KEY is not configured; TheOne is using mock intelligence.',
  };
}

function mockOneClawTask(payload: OneAIGeneratePayload): OneClawTask {
  return {
    taskName: 'theone_mock_task',
    approvalMode: 'manual',
    metadata: {
      source: 'theone',
      mock: true,
      oneAiTask: payload.type,
    },
    steps: [
      {
        id: 'step_1',
        action: payload.type.includes('growth') || payload.type.includes('oneclaw')
          ? 'social.post'
          : 'message.draft',
        input: {
          content: `Prepared by TheOne for: ${JSON.stringify(payload.input).slice(0, 180)}`,
        },
        dependsOn: [],
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function listValue(value: unknown) {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => textValue(item))
    .filter(Boolean)
    .join(', ');
}

function objectiveFromInput(input: unknown) {
  if (typeof input === 'string') return input.trim();
  if (!isRecord(input)) return 'TheOne universal objective';

  return textValue(input.objective) ||
    textValue(input.goal) ||
    textValue(input.message) ||
    textValue(input.prompt) ||
    textValue(input.query) ||
    'TheOne universal objective';
}

function compactJson(value: unknown, maxLength = 900) {
  try {
    const json = JSON.stringify(value);
    return json.length > maxLength ? `${json.slice(0, maxLength)}...` : json;
  } catch {
    return String(value);
  }
}

function normalizeAgentPlanInput(payload: OneAIGeneratePayload) {
  const input = isRecord(payload.input) ? payload.input : {};
  const objective = objectiveFromInput(payload.input);
  const capabilities = listValue(input.capabilities);
  const connectors = listValue(input.connectors);
  const permissionSummary = isRecord(input.contextFrame)
    ? compactJson(input.contextFrame, 420)
    : '';

  const goal = [
    objective,
    `TheOne task: ${payload.type}`,
    textValue(input.intentType) ? `Intent type: ${textValue(input.intentType)}` : '',
    textValue(input.skillKey) ? `Skill: ${textValue(input.skillKey)}` : '',
    capabilities ? `Capabilities: ${capabilities}` : '',
    connectors ? `Connectors: ${connectors}` : '',
    textValue(input.mode) ? `Mode: ${textValue(input.mode)}` : '',
    permissionSummary ? `Context: ${permissionSummary}` : '',
  ].filter(Boolean).join('\n');

  return {
    goal,
    brand: 'TheOne Universal AI OS',
    chain: 'universal',
    audience: 'operator, builder, and governed execution providers',
    tone: 'clear, execution-focused, governed, high-signal',
  };
}

function objectOrDefault<T extends Record<string, unknown>>(value: unknown, fallback: T) {
  return isRecord(value) ? value : fallback;
}

function normalizeMarketDecisionInput(payload: OneAIGeneratePayload) {
  const input = isRecord(payload.input) ? payload.input : {};
  const objective = objectiveFromInput(payload.input);

  return {
    marketIntelligence: objectOrDefault(input.marketIntelligence, {
      source: 'theone',
      objective,
      status: 'insufficient_live_market_data',
      guidance: 'Prefer HOLD unless structured market evidence is supplied.',
    }),
    assetAnalysis: objectOrDefault(input.assetAnalysis, {
      objective,
      trend: 'unknown',
      setup: 'guarded_by_theone',
      confidence: 0,
    }),
    account: objectOrDefault(input.account, {
      equity: 0,
      freeBalance: 0,
      accountMode: 'spot',
      preferredSizeMode: 'quote',
      maxPositionSize: 0,
    }),
    risk: objectOrDefault(input.risk, {
      maxRiskPerTrade: 0,
      dailyLossLimit: 0,
      currentExposure: 0,
      maxExposure: 0,
      blockedDirections: ['BUY', 'SELL'],
    }),
    executionContext: objectOrDefault(input.executionContext, {
      symbol: textValue(input.symbol) || 'UNKNOWN',
      exchange: textValue(input.exchange) || 'UNKNOWN',
      allowedOrderTypes: [],
      preferredTimeHorizon: 'swing',
    }),
  };
}

function normalizeOneClawExecuteInput(payload: OneAIGeneratePayload) {
  const input = isRecord(payload.input) ? payload.input : {};
  const message = textValue(input.message) || objectiveFromInput(payload.input);

  return {
    ...input,
    message,
    lang: textValue(input.lang) || 'mixed',
  };
}

function firstAvailableAction(payload: OneAIGeneratePayload, fallback: string, preferred: string[] = []) {
  const input = isRecord(payload.input) ? payload.input : {};
  const availableActions = Array.isArray(input.availableActions) ? input.availableActions : [];
  const normalized = availableActions.filter(isRecord);
  for (const candidate of preferred) {
    const match = normalized.find((item) => textValue(item.action) === candidate && textValue(item.liveMode) !== 'disabled' && textValue(item.maturity) !== 'stub');
    if (match) return textValue(match.action) || candidate;
  }
  const match = availableActions.find((item) => {
    if (!isRecord(item)) return false;
    const action = textValue(item.action);
    const liveMode = textValue(item.liveMode);
    const maturity = textValue(item.maturity);
    return action && liveMode !== 'disabled' && maturity !== 'stub';
  });

  return isRecord(match) ? textValue(match.action) || fallback : fallback;
}

function inferChatDomain(message: string) {
  if (/github|repo|repository|ci|workflow|仓库|代码库/i.test(message)) return 'github';
  if (/tweet|twitter|\bx\b|推文|发帖|回复/i.test(message)) return 'x';
  if (/desktop|computer|chrome|电脑|本地|截图|hotkey|输入/i.test(message)) return 'desktop';
  if (/file|folder|文件|目录|read|write|list|浏览文件/i.test(message)) return 'files';
  if (/api|webhook|接口|sync|同步/i.test(message)) return 'api';
  if (/report|brief|memo|报告|简报/i.test(message)) return 'report';
  if (/website|web page|browse|网页|网站|浏览|https?:\/\//i.test(message)) return 'web';
  return 'general';
}

function extractUrl(input: string) {
  const match = input.match(/https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/i);
  if (!match) return 'https://weareoneconnection.org';
  const value = match[0];
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function mockTheOneChatWorkflow(payload: OneAIGeneratePayload) {
  const input = isRecord(payload.input) ? payload.input : {};
  const message = textValue(input.message) || objectiveFromInput(payload.input);
  const domain = inferChatDomain(message);
  const action = domain === 'web'
    ? firstAvailableAction(payload, 'browser.extract', ['browser.extract', 'browser.scrape', 'browser.open'])
    : domain === 'github'
      ? firstAvailableAction(payload, 'git.repo.get', ['git.repo.get', 'git.actions.runs', 'git.checks.list'])
      : domain === 'x'
        ? firstAvailableAction(payload, 'x.searchRecentTweets', /post|tweet|发帖|发布/i.test(message)
          ? ['social.post', 'x.searchRecentTweets']
          : ['x.searchRecentTweets', 'x.getUserByUsername', 'x.getUserTweetsByUsername'])
        : domain === 'desktop'
          ? firstAvailableAction(payload, 'desktop.app.state', ['desktop.app.state', 'desktop.screenshot', 'desktop.hotkey', 'desktop.click', 'desktop.type'])
          : domain === 'files'
            ? firstAvailableAction(payload, 'file.list', ['document.parse', 'spreadsheet.read', 'image.extractText', 'file.read', 'file.list'])
            : domain === 'api'
              ? firstAvailableAction(payload, 'api.request', ['api.request', 'api.webhook'])
              : '';
  const hasExternalAction = Boolean(action);
  const actionInput = action === 'browser.extract'
    ? { url: extractUrl(message) }
    : action === 'social.post'
      ? {
          channel: 'x',
          content: Array.from(message.replace(/^.*?:\s*/i, '').replace(/\s+/g, ' ').trim() || 'TheOne is becoming an AI operating system for real-world work.').slice(0, 260).join(''),
        }
    : action === 'git.repo.get'
      ? { repo: message.match(/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/)?.[0] || 'weareoneconnection/theone' }
      : action === 'x.searchRecentTweets'
        ? { query: message.replace(/^(search|find|搜索|查找)\s*/i, '') || 'AI agents workflow', maxResults: 10 }
        : action === 'desktop.app.state'
          ? { app: /chrome/i.test(message) ? 'Google Chrome' : 'Google Chrome' }
          : action === 'file.list'
            ? { path: message.match(/(?:\/Users|\/tmp|\/private|~\/|\.\/)[^\s]+/)?.[0] || '/tmp' }
            : action === 'api.request'
              ? { url: extractUrl(message), method: 'GET' }
              : {};
  const externalStep = hasExternalAction ? {
    id: 'step_1',
    title: `Run ${action}`,
    worker: 'oneclaw',
    action,
    input: actionInput,
    approvalMode: action.startsWith('desktop.') || action === 'social.post' ? 'manual' : 'auto',
    dependsOn: [],
  } : null;
  const steps = [
    ...(externalStep ? [externalStep] : []),
    {
      id: externalStep ? 'step_2' : 'step_1',
      title: 'Reason over the result',
      worker: 'oneai',
      action: 'oneai.generate',
      input: { objective: message },
      approvalMode: 'auto',
      dependsOn: externalStep ? [externalStep.id] : [],
    },
  ];

  return {
    assistantReply: hasExternalAction
      ? `I prepared a ${domain} workflow and will let TheOne validate policy before any worker runs.`
      : 'I prepared a reasoning workflow. No external worker is needed yet.',
    oneAiBrain: {
      role: 'OneAI planning brain',
      understanding: message,
      selectedApp: domain,
      workerRoute: steps.map((step) => step.action),
      confidence: hasExternalAction ? 0.78 : 0.62,
      responseStyle: 'direct, outcome-focused, Codex-like',
      executionBoundary: 'OneAI only proposes the workflow; TheOne validates policy and dispatches OneClaw.',
      reasoningSummary: hasExternalAction
        ? `The message maps to the ${domain} app and ${action} worker candidate.`
        : 'No safe external worker route was inferred, so this remains a reasoning workflow.',
    },
    intent: {
      objective: message,
      domain,
      risk: action.startsWith('desktop.') || action === 'social.post' ? 'high' : hasExternalAction ? 'medium' : 'low',
      requiresApproval: action.startsWith('desktop.') || action === 'social.post',
    },
    workflow: {
      id: `mock_theone_chat_workflow_${Date.now()}`,
      summary: `Mock OneAI chat workflow for ${domain}.`,
      steps,
    },
    requiredWorkers: Array.from(new Set(steps.map((step) => step.worker))),
    oneclawTask: externalStep ? {
      taskName: `mock_chat_${domain}`,
      approvalMode: externalStep.approvalMode,
      steps: [{
        id: externalStep.id,
        action: externalStep.action,
        input: externalStep.input,
        dependsOn: [],
      }],
      metadata: {
        source: 'mock.oneai.theone_chat_workflow',
      },
    } : null,
    safety: {
      requiresApproval: action.startsWith('desktop.') || action === 'social.post',
      reason: hasExternalAction ? 'TheOne must validate manifest, inputs, and approval policy.' : 'No external action was produced.',
    },
  };
}

function adaptOneAIPayload(payload: OneAIGeneratePayload): OneAIGeneratePayload {
  switch (payload.type) {
    case 'objective_analysis':
    case 'knowledge_retrieval':
    case 'general_plan':
      return {
        ...payload,
        type: 'agent_plan',
        input: normalizeAgentPlanInput(payload),
      };
    case 'trade_decision':
      return {
        ...payload,
        type: 'market_decision',
        input: normalizeMarketDecisionInput(payload),
      };
    case 'oneclaw_execute':
      return {
        ...payload,
        input: normalizeOneClawExecuteInput(payload),
      };
    default:
      return payload;
  }
}

function createMockResult<T = unknown>(payload: OneAIGeneratePayload): OneAIGenerateResult<T> {
  if (payload.type === 'theone_chat_workflow') {
    return {
      success: true,
      attempts: 1,
      usage: null,
      usageTotal: null,
      mock: true,
      data: mockTheOneChatWorkflow(payload) as T,
      raw: {
        provider: 'oneai',
        payload,
      },
    };
  }

  const oneclawTask = payload.type.includes('oneclaw') ? mockOneClawTask(payload) : null;

  return {
    success: true,
    attempts: 1,
    usage: null,
    usageTotal: null,
    mock: true,
    data: {
      reply: oneclawTask ? 'Mock OneAI produced an executable OneClaw task.' : 'Mock OneAI produced a structured plan.',
      shouldExecute: Boolean(oneclawTask),
      oneclawTask,
      summary: 'TheOne mock intelligence route completed.',
      objective: payload.input,
    } as T,
    raw: {
      provider: 'oneai',
      payload,
    },
  };
}

export function getOneAIProviderStatus(): ProviderStatus {
  const config = getOneAIConfig();

  return {
    key: 'oneai',
    label: 'OneAI',
    role: 'Default intelligence and planning driver',
    configured: Boolean(config.apiKey),
    mode: config.apiKey ? 'live' : 'mock',
    baseUrl: config.baseUrl,
    status: config.apiKey ? 'ready' : 'mock',
    capabilities: [
      { name: 'generate', kind: 'intelligence', risk: 'low' },
      { name: 'plan.workflow', kind: 'intelligence', risk: 'medium' },
      { name: 'plan.oneclawTask', kind: 'intelligence', risk: 'medium' },
    ],
    warnings: config.apiKey ? [] : ['ONEAI_API_KEY is not configured; using mock intelligence.'],
  };
}

export async function checkOneAIConnection(): Promise<ProviderConnectionCheck> {
  const config = getOneAIConfig();
  if (!config.apiKey) return createNotConfiguredCheck(config);

  const endpoint = joinUrl(config.baseUrl, config.healthPath);
  const startedAt = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'x-api-key': config.apiKey,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });

    return {
      key: 'oneai',
      label: 'OneAI',
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
        ? 'OneAI health endpoint is reachable.'
        : `OneAI health endpoint returned ${res.status}.`,
    };
  } catch (error) {
    return {
      key: 'oneai',
      label: 'OneAI',
      configured: true,
      mode: 'live',
      ok: false,
      status: 'error',
      baseUrl: config.baseUrl,
      endpoint,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : 'OneAI connection check failed.',
    };
  }
}

export function extractOneAIData<T = unknown>(result: unknown): T | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as { data?: unknown; success?: boolean };
  if ('data' in record) return (record.data ?? null) as T | null;
  return result as T;
}

export function extractOneAIPlannedOneClawTask(data: unknown): OneClawTask | null {
  if (!isRecord(data)) return null;

  const envelope = isRecord(data.theoneTask) ? data.theoneTask : null;
  const task = isRecord(envelope?.oneclawTask)
    ? envelope.oneclawTask
    : data.oneclawTask;

  if (!isRecord(task)) return null;

  const rawPolicy = isRecord(envelope?.automationPolicy) ? envelope.automationPolicy : null;
  const approvalMode = rawPolicy?.approvalMode === 'auto' || rawPolicy?.approvalMode === 'manual'
    ? rawPolicy.approvalMode
    : task.approvalMode === 'auto' || task.approvalMode === 'manual'
      ? task.approvalMode
      : undefined;

  const steps = Array.isArray(task.steps)
    ? task.steps
        .map((step, index) => {
          if (!isRecord(step)) return null;
          const input = isRecord(step.input) ? step.input : {};
          return {
            id: textValue(step.id) || `step_${index + 1}`,
            action: textValue(step.action),
            input,
            dependsOn: Array.isArray(step.dependsOn)
              ? step.dependsOn.map((item) => textValue(item)).filter(Boolean)
              : [],
          };
        })
        .filter((step): step is NonNullable<typeof step> => Boolean(step?.action))
    : [];

  if (!steps.length) return null;

  return {
    taskName: textValue(task.taskName) || 'oneclaw_task',
    ...(approvalMode ? { approvalMode } : {}),
    steps,
    metadata: {
      ...(isRecord(task.metadata) ? task.metadata : {}),
      ...(envelope ? { theoneTask: envelope } : {}),
    },
  };
}

export async function runOneAI<T = unknown>(payload: OneAIGeneratePayload): Promise<OneAIGenerateResult<T>> {
  const { baseUrl, apiKey } = getOneAIConfig();
  const upstreamPayload = adaptOneAIPayload(payload);

  if (!apiKey) {
    return createMockResult<T>(payload);
  }

  const res = await fetch(`${baseUrl}/v1/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(upstreamPayload),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ONEAI request failed (${payload.type} -> ${upstreamPayload.type}): ${res.status} ${text}`);
  }

  const json = await res.json();
  if (json && typeof json === 'object' && 'success' in json) {
    return {
      ...(json as OneAIGenerateResult<T>),
      raw: {
        provider: 'oneai',
        requestedTask: payload.type,
        upstreamTask: upstreamPayload.type,
        adapted: payload.type !== upstreamPayload.type,
        request: upstreamPayload,
        response: json,
      },
    };
  }

  return {
    success: true,
    attempts: 1,
    data: json as T,
    usage: null,
    usageTotal: null,
    raw: {
      provider: 'oneai',
      requestedTask: payload.type,
      upstreamTask: upstreamPayload.type,
      adapted: payload.type !== upstreamPayload.type,
      request: upstreamPayload,
      response: json,
    },
  };
}
