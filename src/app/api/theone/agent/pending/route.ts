import { rateLimit } from '@/lib/theone/security/api-guard';

// Lists OneClaw-side pending approvals grouped by task — the chat UI uses
// this right after TheOne dispatches a task to find the OneClaw task id and
// clear its approval gate in the same user action.

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
  const limited = rateLimit(req, { key: 'agent-pending', limit: 120, windowMs: 60_000 });
  if (!limited.allowed) return limited.response;

  const base = bridgeBaseUrl();
  if (!base) return Response.json({ ok: false, error: 'code_runtime_not_configured' }, { status: 503 });

  try {
    const response = await fetch(`${base}/v1/approvals/pending`, {
      headers: bridgeHeaders(),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    const list = await response.json().catch(() => []);
    const grouped = new Map<string, Array<{ id: string; action: string }>>();
    for (const item of Array.isArray(list) ? list : []) {
      const record = item as Record<string, unknown>;
      const taskId = String(record.taskId || '');
      if (!taskId) continue;
      const bucket = grouped.get(taskId) || [];
      bucket.push({ id: String(record.id || ''), action: String(record.action || '') });
      grouped.set(taskId, bucket);
    }
    return Response.json({
      ok: true,
      tasks: Array.from(grouped.entries()).map(([taskId, approvals]) => ({ taskId, approvals })),
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
