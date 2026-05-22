import { setPackageInstalled } from '@/lib/theone/packages/package-registry';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const packages = await setPackageInstalled({
      id: String(body.id || ''),
      enabled: body.enabled !== false,
    });
    return Response.json({ ok: true, packages });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Package install failed' }, { status: 500 });
  }
}
