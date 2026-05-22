import { getTheOneKernelStatusWithWorkers } from '@/lib/theone/kernel/status';
import { checkProviderConnections } from '@/lib/theone/providers/connections';
import { getOneClawCapabilityManifest } from '@/lib/theone/providers/oneclaw';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeConnections = url.searchParams.get('connections') === '1';
  const connections = includeConnections ? await checkProviderConnections() : null;
  const oneClawManifest = await getOneClawCapabilityManifest();

  return Response.json({
    ok: true,
    timestamp: new Date().toISOString(),
    os: await getTheOneKernelStatusWithWorkers(undefined, oneClawManifest),
    connections,
  });
}
