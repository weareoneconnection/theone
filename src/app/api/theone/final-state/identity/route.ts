import { getTenantIdentityRoleOS } from '@/lib/theone/final-state/os-hardening';

export async function GET() {
  try {
    return Response.json(await getTenantIdentityRoleOS());
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Identity boundary unavailable' }, { status: 500 });
  }
}
