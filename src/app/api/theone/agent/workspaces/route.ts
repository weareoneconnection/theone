import { rateLimit } from '@/lib/theone/security/api-guard';

// Lists the repositories the agent can actually open (the allowlisted
// workspace roots on the OneClaw runtime and their repo subdirectories), so
// the chat UI can offer real paths instead of the user guessing.

export const runtime = 'nodejs';

function bridgeBaseUrl() {
  return String(
    process.env.THEONE_CODE_LOCAL_BRIDGE_URL ||
    process.env.ONECLAW_LOCAL_BRIDGE_URL ||
    process.env.ONECLAW_BASE_URL ||
    process.env.ONECLAW_API_BASE_URL ||
    ''
  ).trim().replace(/\/+$/, '');
}

function bridgeHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = String(
    process.env.THEONE_CODE_LOCAL_BRIDGE_TOKEN ||
    process.env.ONECLAW_LOCAL_BRIDGE_TOKEN ||
    process.env.ONECLAW_TOKEN ||
    ''
  ).trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['x-api-key'] = token;
  }
  return headers;
}

export async function GET(req: Request) {
  const limited = rateLimit(req, { key: 'agent-workspaces', limit: 60, windowMs: 60_000 });
  if (!limited.allowed) return limited.response;

  const base = bridgeBaseUrl();
  if (!base) {
    return Response.json({
      ok: false,
      error: 'code_runtime_not_configured',
      hint: '未配置 THEONE_CODE_LOCAL_BRIDGE_URL,聊天无法连到执行引擎。',
    }, { status: 503 });
  }

  try {
    const response = await fetch(`${base}/v1/code/workspaces`, {
      headers: bridgeHeaders(),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok === false) {
      return Response.json({ ok: false, error: body?.error || `bridge returned ${response.status}` }, { status: 502 });
    }
    return Response.json({
      ok: true,
      roots: Array.isArray(body?.roots) ? body.roots : [],
      workspaces: Array.isArray(body?.workspaces) ? body.workspaces : [],
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
