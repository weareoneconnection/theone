import type {
  ApprovalGate,
  ExecutionPlan,
  OneClawTask,
  PlanStep,
  TheOneMode,
} from '../types';

const highRiskPlanActions = new Set<PlanStep['action']>([
  'oneclaw.execute',
  'trading.place',
  'social.post',
  'social.reply',
]);

const mediumRiskPlanActions = new Set<PlanStep['action']>([
  'browser.extract',
  'browser.open',
  'custom',
]);

const highRiskOneClawActions = new Set([
  'message.send',
  'social.post',
  'social.schedule',
  'web3.sign',
  'web3.write',
  'human.approval.request',
  'construction.approval.request',
  'construction.hse.corrective_action',
  'construction.qaqc.ncr.create',
  'construction.change_order.prepare',
  'construction.contract.claim_prepare',
]);

const mediumRiskOneClawPrefixes = [
  'api.',
  'browser.',
  'file.',
  'construction.',
];

export function getActionRisk(action: string): 'low' | 'medium' | 'high' {
  if (highRiskPlanActions.has(action as PlanStep['action']) || highRiskOneClawActions.has(action)) {
    return 'high';
  }

  if (mediumRiskPlanActions.has(action as PlanStep['action'])) {
    return 'medium';
  }

  if (mediumRiskOneClawPrefixes.some((prefix) => action.startsWith(prefix))) {
    return 'medium';
  }

  return 'low';
}

function isStrictXReply(task: OneClawTask, stepId: string) {
  const step = task.steps.find((item) => item.id === stepId);
  const input = step?.input || {};
  return step?.action === 'social.post' &&
    input.channel === 'x' &&
    input.mode === 'reply_only' &&
    input.strictReply === true &&
    typeof input.replyToTweetId === 'string' &&
    /^[0-9]{1,19}$/.test(input.replyToTweetId);
}

function approvalRequired(action: string, explicit: boolean | undefined, mode: TheOneMode) {
  const risk = getActionRisk(action);

  if (mode === 'manual') {
    return action !== 'oneai.generate' && action !== 'proof.write' && action !== 'memory.store';
  }

  if (explicit || risk === 'high') return true;

  return false;
}

export function evaluatePlanPolicy(plan: ExecutionPlan, mode: TheOneMode): ApprovalGate[] {
  return plan.steps.map((step) => {
    const risk = getActionRisk(step.action);
    const required = approvalRequired(step.action, step.requiresApproval, mode);

    return {
      id: `approval_${plan.id}_${step.id}`,
      stepId: step.id,
      action: step.action,
      risk,
      required,
      status: required ? 'pending' : 'not_required',
      mode,
      reason: required
        ? `${step.action} is ${risk} risk in ${mode} mode.`
        : `${step.action} is allowed in ${mode} mode.`,
    };
  });
}

export function evaluateOneClawTaskPolicy(
  task: OneClawTask | null | undefined,
  mode: TheOneMode
): ApprovalGate[] {
  if (!task) return [];

  return task.steps.map((step) => {
    const strictXReply = isStrictXReply(task, step.id);
    const risk = strictXReply ? 'medium' : getActionRisk(step.action);
    const required = strictXReply
      ? mode === 'manual' || task.approvalMode === 'manual'
      : approvalRequired(step.action, task.approvalMode === 'manual', mode);

    return {
      id: `approval_${task.taskName}_${step.id}`,
      stepId: step.id,
      action: step.action,
      risk,
      required,
      status: required ? 'pending' : 'not_required',
      mode,
      reason: required
        ? `${step.action} requires approval before OneClaw execution.`
        : `${step.action} can be submitted to OneClaw.`,
    };
  });
}

export function canSubmitExternalTasks(gates: ApprovalGate[]) {
  return gates.every((gate) => !gate.required || gate.status === 'approved');
}
