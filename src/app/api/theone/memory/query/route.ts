import { queryMemoryGraph } from '@/lib/theone/state/run-store';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  return Response.json({
    ok: true,
    items: await queryMemoryGraph({
      query: String(body.query || ''),
      intentType: body.intentType ? String(body.intentType) : undefined,
      capabilities: Array.isArray(body.capabilities)
        ? body.capabilities.map((item: unknown) => String(item))
        : [],
      limit: Number(body.limit || 5),
    }),
  });
}
