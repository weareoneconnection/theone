import { getCodeWorkspace, updateCodeWorkspace } from '@/lib/theone/code/code-workspace-store';
import type { CodeWorkspaceStage } from '@/lib/theone/code/code-workspace-store';

const stages = new Set<CodeWorkspaceStage>([
  'registered', 'inspected', 'diff_ready', 'applied', 'tested', 'verified',
  'delivery_ready', 'rolled_back', 'failed',
]);

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const workspace = await getCodeWorkspace(id);
  return workspace
    ? Response.json({ ok: true, workspace })
    : Response.json({ ok: false, error: 'Code workspace not found.' }, { status: 404 });
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const current = await getCodeWorkspace(id);
  if (!current) {
    return Response.json({ ok: false, error: 'Code workspace not found.' }, { status: 404 });
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const stage = String(body.stage || '').trim() as CodeWorkspaceStage;
  if (stage && !stages.has(stage)) {
    return Response.json({ ok: false, error: 'Invalid code workspace stage.' }, { status: 400 });
  }
  const workspace = await updateCodeWorkspace(id, {
    ...(stage ? { stage } : {}),
    ...(body.runtimeStatus === 'ready' || body.runtimeStatus === 'blocked'
      ? { runtimeStatus: body.runtimeStatus }
      : {}),
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.repo === 'string' ? { repo: body.repo || null } : {}),
    ...(typeof body.branch === 'string' ? { branch: body.branch || null } : {}),
    ...(typeof body.latestRunId === 'string' ? { latestRunId: body.latestRunId || null } : {}),
    ...(typeof body.rollbackToken === 'string' ? { rollbackToken: body.rollbackToken || null } : {}),
    ...(body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? { metadata: body.metadata as Record<string, unknown> }
      : {}),
    ...(body.event && typeof body.event === 'object' && !Array.isArray(body.event)
      ? { event: {
          type: String((body.event as Record<string, unknown>).type || 'workspace.updated'),
          stage: stage || current.stage,
          detail: String((body.event as Record<string, unknown>).detail || 'Code workspace updated.'),
          metadata: (body.event as Record<string, unknown>).metadata as Record<string, unknown> | undefined,
        } }
      : {}),
  });
  return workspace
    ? Response.json({ ok: true, workspace })
    : Response.json({ ok: false, error: 'Code workspace not found.' }, { status: 404 });
}
