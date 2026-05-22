import { packageRegistrySummary, upsertTheOnePackage } from '@/lib/theone/packages/package-registry';

export async function GET() {
  try {
    return Response.json({ ok: true, registry: await packageRegistrySummary() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Package registry unavailable' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const item = await upsertTheOnePackage(body);
    return Response.json({ ok: true, package: item });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Package registration failed' }, { status: 500 });
  }
}
