import { checkProviderConnections } from '@/lib/theone/providers/connections';

export async function GET() {
  return Response.json(await checkProviderConnections());
}
