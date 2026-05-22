import { listAutomationJobs, upsertAutomationJob } from '@/lib/theone/automation/scheduler';

export async function GET() {
  try {
    return Response.json({ ok: true, jobs: await listAutomationJobs() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Automation jobs unavailable' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return Response.json({ ok: true, job: await upsertAutomationJob(body) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Automation job update failed' }, { status: 500 });
  }
}
