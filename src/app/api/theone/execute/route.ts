import { preflightOneClawTask } from '@/lib/theone/execution/preflight';
import { evaluateAutomationPolicy } from '@/lib/theone/policy/automation-engine';
import { getOneClawCapabilityManifest, runOneClawAction } from '@/lib/theone/providers/oneclaw';
import type { ClassifiedIntent, OneClawTask, TheOneIntentType, TheOneMode } from '@/lib/theone/types';

function makeIntent(body: any): ClassifiedIntent {
  return {
    type: (String(body.intentType || 'general') as TheOneIntentType),
    objective: String(body.objective || `Execute ${body.action || 'action'}`),
    entities: [],
    constraints: [],
    priority: 'normal',
    confidence: 0.8,
    requiresApproval: false,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || '');
    if (!action) throw new Error('Action is required');

    const mode = (body.mode || 'assist') as TheOneMode;
    const manifest = await getOneClawCapabilityManifest();
    const task: OneClawTask = {
      taskName: String(body.taskName || `theone_execute_${action.replace(/[^a-z0-9_]+/gi, '_')}`),
      approvalMode: body.approvalMode === 'manual' ? 'manual' : 'auto',
      steps: [{
        id: 'step_1',
        action,
        input: body.input && typeof body.input === 'object' ? body.input : {},
      }],
      metadata: { source: 'theone.api.execute' },
    };
    const preflight = preflightOneClawTask({
      task,
      intent: makeIntent(body),
      mode,
      capabilities: manifest.capabilities,
    });
    const policy = await evaluateAutomationPolicy({
      task,
      mode,
      preflight,
      capabilities: manifest.capabilities,
      connectors: manifest.connectors,
      canSubmitExternalTasks: true,
    });

    if (policy.blocked) {
      return Response.json({ ok: false, status: 'blocked', preflight, policy }, { status: 403 });
    }

    const result = await runOneClawAction({
      action,
      input: task.steps[0].input,
      approvalMode: policy.approvalMode,
      idempotencyKey: body.idempotencyKey,
    });

    return Response.json({ ok: true, preflight, policy, result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'TheOne execute failed' }, { status: 500 });
  }
}
