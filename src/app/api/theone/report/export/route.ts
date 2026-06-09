import { exportReportArtifact, type TheOneReportArtifact } from '@/lib/theone/report-artifacts';

function isReportArtifact(value: unknown): value is TheOneReportArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 'theone.report_artifact.v1' &&
    typeof record.title === 'string' &&
    typeof record.executiveSummary === 'string';
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const artifact = body?.artifact;
    if (!isReportArtifact(artifact)) {
      return Response.json({ ok: false, error: 'A valid TheOne report artifact is required.' }, { status: 400 });
    }
    const exportBundle = await exportReportArtifact(artifact);
    return Response.json({ ok: true, exportBundle });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Report export failed.',
    }, { status: 500 });
  }
}
