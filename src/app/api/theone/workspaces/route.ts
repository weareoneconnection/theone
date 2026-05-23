import { activateAutonomousWorkspace, listAutonomousWorkspaces, runAutonomousWorkspaceNow } from '@/lib/theone/workspaces/autonomous-workspaces';

export async function GET() {
  try {
    return Response.json(await listAutonomousWorkspaces());
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Autonomous workspaces unavailable' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.action === 'run_now') {
      return Response.json(await runAutonomousWorkspaceNow({ key: String(body.key || '') }));
    }
    return Response.json(await activateAutonomousWorkspace({
      key: String(body.key || ''),
      status: body.status === 'paused' ? 'paused' : 'active',
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Workspace update failed' }, { status: 500 });
  }
}
