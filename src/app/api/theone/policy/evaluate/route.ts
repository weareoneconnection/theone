import { preflightOneClawTask } from '@/lib/theone/execution/preflight';
import { evaluateAutomationPolicy } from '@/lib/theone/policy/automation-engine';
import { getOneClawCapabilityManifest } from '@/lib/theone/providers/oneclaw';
import type { ClassifiedIntent, OneClawTask, TheOneIntentType, TheOneMode } from '@/lib/theone/types';

function intentFromBody(body: any): ClassifiedIntent {
  return {
    type: (String(body.intentType || 'general') as TheOneIntentType),
    objective: String(body.objective || body.input || body.command || 'Evaluate automation policy'),
    entities: [],
    constraints: [],
    priority: 'normal',
    confidence: 0.7,
    requiresApproval: false,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = (body.mode || 'assist') as TheOneMode;
    const manifest = await getOneClawCapabilityManifest();
    const task = body.task as OneClawTask | null;
    const intent = intentFromBody(body);
    const preflight = preflightOneClawTask({
      task,
      intent,
      mode,
      capabilities: manifest.capabilities,
    });
    const policy = await evaluateAutomationPolicy({
      task,
      mode,
      preflight,
      capabilities: manifest.capabilities,
      connectors: manifest.connectors,
      canSubmitExternalTasks: body.canSubmitExternalTasks !== false,
    });

    return Response.json({ ok: true, mode, preflight, policy });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Policy evaluation failed' }, { status: 500 });
  }
}
