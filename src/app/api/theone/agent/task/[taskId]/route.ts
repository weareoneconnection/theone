import { rateLimit } from '@/lib/theone/security/api-guard';

// Server-side proxy to the OneClaw bridge for the chat stream UI: task
// status + agent event log + pending approvals, and one-click approve-all.
// The bridge URL and token stay on the server.

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

async function bridgeFetch(path: string, init?: RequestInit) {
  const base = bridgeBaseUrl();
  if (!base) throw new Error('code_runtime_not_configured');
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...bridgeHeaders(), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`bridge ${path} returned ${response.status}`);
  }
  return body;
}

function compactTask(raw: unknown) {
  const task = (raw && typeof raw === 'object' && 'task' in (raw as object)
    ? (raw as { task: unknown }).task
    : raw) as Record<string, unknown> | null;
  if (!task || typeof task !== 'object') return null;

  const logs = Array.isArray(task.logs) ? task.logs.slice(-120).map((line) => String(line)) : [];
  const steps = Array.isArray(task.steps)
    ? task.steps.map((step) => {
        const record = step as Record<string, unknown>;
        const output = (record.output || {}) as Record<string, unknown>;
        return {
          stepId: String(record.stepId || ''),
          action: String(record.action || ''),
          status: String(record.status || ''),
          output: {
            status: String(output.status || ''),
            mode: String(output.mode || ''),
            verified: output.verified === true,
            summary: String(output.summary || '').slice(0, 4_000),
            diff: String(output.diff || '').slice(0, 60_000),
            diffStat: String(output.diffStat || '').slice(0, 2_000),
            rollbackToken: String(output.rollbackToken || ''),
            note: String(output.note || '').slice(0, 500),
          },
        };
      })
    : [];

  return {
    id: String(task.id || ''),
    status: String(task.status || ''),
    taskName: String(task.taskName || ''),
    logs,
    steps,
  };
}

async function pendingApprovalsFor(taskId: string) {
  const pending = await bridgeFetch('/v1/approvals/pending');
  const list = Array.isArray(pending) ? pending : [];
  return list
    .filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).taskId === taskId)
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: String(record.id || ''),
        stepId: String(record.stepId || ''),
        action: String(record.action || ''),
        reason: String(record.reason || '').slice(0, 300),
      };
    });
}

export async function GET(req: Request, context: { params: Promise<{ taskId: string }> }) {
  const limited = rateLimit(req, { key: 'agent-task', limit: 120, windowMs: 60_000 });
  if (!limited.allowed) return limited.response;

  const { taskId } = await context.params;
  const cleanId = String(taskId || '').trim();
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(cleanId)) {
    return Response.json({ ok: false, error: 'invalid task id' }, { status: 400 });
  }

  try {
    const [task, approvals] = await Promise.all([
      bridgeFetch(`/v1/tasks/${encodeURIComponent(cleanId)}`),
      pendingApprovalsFor(cleanId).catch(() => []),
    ]);
    const compact = compactTask(task);
    if (!compact) return Response.json({ ok: false, error: 'task not found' }, { status: 404 });
    return Response.json({ ok: true, task: compact, approvals });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'code_runtime_not_configured' ? 503 : 502;
    return Response.json({ ok: false, error: message }, { status });
  }
}

export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  const limited = rateLimit(req, { key: 'agent-task-action', limit: 30, windowMs: 60_000 });
  if (!limited.allowed) return limited.response;

  const { taskId } = await context.params;
  const cleanId = String(taskId || '').trim();
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(cleanId)) {
    return Response.json({ ok: false, error: 'invalid task id' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '').trim();

  try {
    if (action === 'approve_all') {
      const approvals = await pendingApprovalsFor(cleanId);
      let approved = 0;
      for (const approval of approvals) {
        await bridgeFetch(`/v1/approvals/${encodeURIComponent(approval.id)}/approve`, {
          method: 'POST',
          body: JSON.stringify({ approver: 'theone-chat' }),
        });
        approved += 1;
      }
      return Response.json({ ok: true, approved, total: approvals.length });
    }

    if (action === 'abort') {
      await bridgeFetch(`/v1/tasks/${encodeURIComponent(cleanId)}/agent/abort`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return Response.json({ ok: true, aborted: true });
    }

    return Response.json({ ok: false, error: 'unsupported action' }, { status: 400 });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
