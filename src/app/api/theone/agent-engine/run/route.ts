import path from 'node:path';
import { runAgentTask } from '@/lib/theone/agent-engine/loop';
import { requireAdmin, rateLimit } from '@/lib/theone/security/api-guard';

export const maxDuration = 300;

// Workspaces the agent may operate on, from AGENT_ENGINE_WORKSPACES
// (comma-separated absolute paths). Empty = agent engine disabled over HTTP.
function allowedWorkspaces(): string[] {
  return String(process.env.AGENT_ENGINE_WORKSPACES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (!guard.allowed) return guard.response;
  const limited = rateLimit(req, { key: 'agent-engine', limit: 10, windowMs: 60_000 });
  if (!limited.allowed) return limited.response;

  try {
    const body = await req.json();
    const objective = String(body.objective || '').trim();
    const workspace = path.resolve(String(body.workspace || '').trim());
    if (!objective) {
      return Response.json({ ok: false, error: 'objective is required' }, { status: 400 });
    }

    const allowed = allowedWorkspaces();
    if (allowed.length === 0) {
      return Response.json(
        { ok: false, error: 'Agent engine is disabled: set AGENT_ENGINE_WORKSPACES to enable.' },
        { status: 403 },
      );
    }
    if (!allowed.some((root) => workspace === root || workspace.startsWith(root + path.sep))) {
      return Response.json({ ok: false, error: `Workspace not allowed: ${workspace}` }, { status: 403 });
    }

    const result = await runAgentTask({
      objective,
      workspace,
      maxTurns: Number(body.maxTurns) || undefined,
      maxToolCalls: Number(body.maxToolCalls) || undefined,
      model: body.model ? String(body.model) : undefined,
    });

    return Response.json({ ok: result.status === 'completed', ...result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Agent run failed' },
      { status: 500 },
    );
  }
}
