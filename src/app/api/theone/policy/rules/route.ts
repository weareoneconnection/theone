import { automationPolicySummary, upsertAutomationPolicyRule } from '@/lib/theone/policy/policy-registry';

export async function GET() {
  try {
    return Response.json({
      ok: true,
      policy: await automationPolicySummary(),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Policy registry failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rule = await upsertAutomationPolicyRule(body);
    return Response.json({ ok: true, rule });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Policy rule update failed' },
      { status: 500 }
    );
  }
}
