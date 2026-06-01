import { executeFinalActionCenter, listFinalActionCenters } from '@/lib/theone/action-centers/final-action-centers';

export async function GET() {
  try {
    return Response.json(await listFinalActionCenters());
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Action centers unavailable' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await executeFinalActionCenter({
      action: String(body.action || ''),
      objective: body.objective,
      query: body.query,
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Action center command failed' }, { status: 500 });
  }
}
