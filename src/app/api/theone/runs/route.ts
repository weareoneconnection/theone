import { listRuns } from '@/lib/theone/state/run-store';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') || 20);

  return Response.json({
    ok: true,
    items: await listRuns(limit),
  });
}
