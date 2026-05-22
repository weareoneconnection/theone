import { getOneClawTask } from '@/lib/theone/providers/oneclaw';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const task = await getOneClawTask(taskId);

    return Response.json({
      ok: true,
      source: 'oneclaw',
      task,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        source: 'oneclaw',
        error: error instanceof Error ? error.message : 'OneClaw task lookup failed',
      },
      { status: 400 }
    );
  }
}
