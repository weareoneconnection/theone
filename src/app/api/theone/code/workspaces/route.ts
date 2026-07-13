import { createCodeWorkspace, listCodeWorkspaces } from '@/lib/theone/code/code-workspace-store';
import { resolveCodeRuntimeRoute } from '@/lib/theone/code/code-task-contract';

export async function GET(req: Request) {
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get('limit') || 50)));
  return Response.json({
    ok: true,
    schemaVersion: 'theone.code_workspaces.v1',
    workspaces: await listCodeWorkspaces(limit),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const name = String(body.name || '').trim();
  const workspacePath = String(body.workspacePath || '').trim();
  if (!name) {
    return Response.json({ ok: false, error: 'name is required' }, { status: 400 });
  }
  const runtime = resolveCodeRuntimeRoute({
    workspacePath: workspacePath || undefined,
    requestedTarget: String(body.runtimeTarget || '').trim() || undefined,
  });
  const workspace = await createCodeWorkspace({
    name,
    workspacePath: workspacePath || undefined,
    runtimeTarget: runtime.target,
    runtimeStatus: runtime.status,
    repo: String(body.repo || '').trim() || undefined,
    branch: String(body.branch || '').trim() || undefined,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {},
  });
  return Response.json({ ok: true, workspace }, { status: 201 });
}
