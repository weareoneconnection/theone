import { listProof } from '@/lib/theone/state/run-store';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') || 50);

  return Response.json({
    ok: true,
    items: await listProof(limit),
  });
}
