import { listLearningInsights, runLearningCycle } from '@/lib/theone/learning/learning-engine';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') || 30);
    return Response.json({ ok: true, insights: await listLearningInsights(limit) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Learning insights unavailable' }, { status: 500 });
  }
}

export async function POST() {
  try {
    return Response.json(await runLearningCycle());
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Learning cycle failed' }, { status: 500 });
  }
}
