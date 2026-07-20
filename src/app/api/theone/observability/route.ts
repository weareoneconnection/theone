import { buildObservabilityReport } from '@/lib/theone/observability/metrics-report';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get('hours') || 24);
  const report = await buildObservabilityReport(Number.isFinite(hours) ? hours : 24);
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
