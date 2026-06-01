import { getSignedPackageMarketplaceOS } from '@/lib/theone/final-state/os-hardening';

export async function GET() {
  try {
    return Response.json(await getSignedPackageMarketplaceOS());
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Package marketplace unavailable' }, { status: 500 });
  }
}
