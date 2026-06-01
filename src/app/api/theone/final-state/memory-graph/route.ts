import { getMemoryGraphKnowledgeOS } from '@/lib/theone/final-state/os-hardening';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    return Response.json(await getMemoryGraphKnowledgeOS({ query: url.searchParams.get('query') || undefined }));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Memory graph unavailable' }, { status: 500 });
  }
}
