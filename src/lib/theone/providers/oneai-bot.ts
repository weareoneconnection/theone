function cleanBaseUrl(value: string | undefined) {
  return (value || '').trim().replace(/\/+$/, '');
}

export function getOneAIBotConfig() {
  return {
    baseUrl: cleanBaseUrl(
      process.env.ONEAI_BOT_BASE_URL ||
      process.env.WAOC_ONEAI_BOT_BASE_URL ||
      process.env.ONEAI_TG_BOT_BASE_URL
    ),
    healthPath: String(process.env.ONEAI_BOT_HEALTH_PATH || '/').trim() || '/',
    mode: String(process.env.ONEAI_BOT_MODE || 'external').trim() || 'external',
    repoPath: String(
      process.env.ONEAI_BOT_REPO_PATH ||
      '/Users/maqing/Desktop/建筑操作系统/waoc-oneai-tg-bot'
    ).trim(),
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function checkOneAIBotBridge() {
  const config = getOneAIBotConfig();
  const endpoint = config.baseUrl ? joinUrl(config.baseUrl, config.healthPath) : '';

  if (!config.baseUrl) {
    return {
      key: 'oneai_bot',
      label: 'OneAI Bot',
      configured: false,
      mode: config.mode,
      ok: false,
      status: 'not_configured',
      baseUrl: '',
      endpoint: '',
      repoPath: config.repoPath,
      checkedAt: new Date().toISOString(),
      message: 'ONEAI_BOT_BASE_URL is not configured. The bot repo can still be registered as an installed local runtime.',
      capabilities: ['telegram.community', 'oneai.chat', 'oneclaw.execute.bridge', 'community.graph'],
      bridge: {
        kind: 'external_http',
        mutatesBotCode: false,
        safeEntry: 'health_check',
        executionEntry: 'telegram_context_or_bot_internal_bridge',
      },
    };
  }

  const started = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text().catch(() => '');

    return {
      key: 'oneai_bot',
      label: 'OneAI Bot',
      configured: true,
      mode: config.mode,
      ok: res.ok,
      status: res.ok ? 'connected' : 'error',
      baseUrl: config.baseUrl,
      endpoint,
      repoPath: config.repoPath,
      latencyMs: Date.now() - started,
      statusCode: res.status,
      checkedAt: new Date().toISOString(),
      message: res.ok ? (text || 'OneAI Bot is reachable.') : `OneAI Bot returned ${res.status}.`,
      capabilities: ['telegram.community', 'oneai.chat', 'oneclaw.execute.bridge', 'community.graph'],
      bridge: {
        kind: 'external_http',
        mutatesBotCode: false,
        safeEntry: 'health_check',
        executionEntry: 'telegram_context_or_bot_internal_bridge',
      },
    };
  } catch (error) {
    return {
      key: 'oneai_bot',
      label: 'OneAI Bot',
      configured: true,
      mode: config.mode,
      ok: false,
      status: 'unreachable',
      baseUrl: config.baseUrl,
      endpoint,
      repoPath: config.repoPath,
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : 'OneAI Bot bridge check failed.',
      capabilities: ['telegram.community', 'oneai.chat', 'oneclaw.execute.bridge', 'community.graph'],
      bridge: {
        kind: 'external_http',
        mutatesBotCode: false,
        safeEntry: 'health_check',
        executionEntry: 'telegram_context_or_bot_internal_bridge',
      },
    };
  }
}
