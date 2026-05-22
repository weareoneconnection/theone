import { THEONE_CONFIG } from '@/lib/theone/config';
import { classifyIntent } from '@/lib/theone/intents/classifyIntent';
import { normalizeIntent } from '@/lib/theone/intents/normalizeIntent';
import { buildPlan } from '@/lib/theone/planners/buildPlan';
import { validatePlan } from '@/lib/theone/planners/validatePlan';
import { evaluatePlanPolicy } from '@/lib/theone/policy/approval-policy';
import { createRunId } from '@/lib/theone/runtime';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = (body.mode || THEONE_CONFIG.defaultMode) as TheOneMode;
    const raw = String(body.input || body.command || '');
    if (!raw.trim()) throw new Error('Input is required');

    const intent = normalizeIntent(await classifyIntent({ raw, mode, language: body.language || 'en' }));
    const plan = validatePlan(buildPlan(intent));
    const approvals = evaluatePlanPolicy(plan, mode);

    return Response.json({
      ok: true,
      runId: createRunId(),
      mode,
      intent,
      plan,
      approvals,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'TheOne plan failed' }, { status: 500 });
  }
}
