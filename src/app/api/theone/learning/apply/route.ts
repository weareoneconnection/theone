import { updateLearningInsight } from '@/lib/theone/learning/learning-engine';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const insights = await updateLearningInsight({
      id: String(body.id || ''),
      status: body.status === 'dismissed' ? 'dismissed' : body.status === 'suggested' ? 'suggested' : 'applied',
    });
    return Response.json({ ok: true, insights });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Learning insight update failed' }, { status: 500 });
  }
}
