import { listWorkerRuntimes } from '@/lib/theone/workers/runtime-registry';

export async function GET() {
  try {
    return Response.json({ ok: true, workers: await listWorkerRuntimes() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Worker runtime unavailable' }, { status: 500 });
  }
}
