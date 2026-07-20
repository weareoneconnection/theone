import { updateLearningInsight } from '@/lib/theone/learning/learning-engine';
import { requireAdmin } from '@/lib/theone/security/api-guard';

export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (!guard.allowed) return guard.response;

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
