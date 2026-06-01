import { getAutonomousWorkspaceDetail, runAutonomousWorkspaceNow } from '@/lib/theone/workspaces/autonomous-workspaces';

export async function GET(_req: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const params = await context.params;
    return Response.json(await getAutonomousWorkspaceDetail({ key: params.key }));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Workspace detail unavailable' }, { status: 500 });
  }
}

export async function POST(req: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const [body, params] = await Promise.all([req.json().catch(() => ({})), context.params]);
    if (body.action === 'run_now') {
      return Response.json(await runAutonomousWorkspaceNow({ key: params.key }));
    }
    return Response.json({ ok: false, error: 'Unsupported workspace action' }, { status: 400 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Workspace action failed' }, { status: 500 });
  }
}
