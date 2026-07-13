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
  'code.patch.apply',
  'code.test.run',
  'code.patch.rollback',
  'code.pr.create',
]);

const mediumRiskOneClawPrefixes = [
  'api.',
  'browser.',
  'file.',
  'construction.',
];

export function getActionRisk(action: string): 'low' | 'medium' | 'high' {
  if (['code.patch.apply', 'code.test.run', 'code.patch.rollback', 'code.pr.create'].includes(action)) return 'high';
  if (['code.diff.prepare', 'code.commit.prepare'].includes(action)) return 'medium';
  if (['code.workspace.status', 'code.verify'].includes(action)) return 'low';

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

function isReadOnlyAutoAction(action: string, input: Record<string, unknown> = {}) {
  const method = String(input.method || 'GET').toUpperCase();

  if (action === 'api.request') return method === 'GET';
  if ([
    'browser.open',
    'browser.extract',
    'browser.scrape',
    'browser.screenshot',
    'git.repo.get',
    'git.actions.runs',
    'git.checks.list',
    'git.ci.status',
    'git.repo.search',
    'x.getTweet',
    'x.getTweets',
    'x.getUserByUsername',
    'x.getUserTweets',
    'x.getUserTweetsByUsername',
    'x.searchRecentTweets',
    'file.read',
    'file.list',
    'file.exists',
    'database.query',
    'database.schema.inspect',
    'knowledge.query',
    'vector.query',
    'storage.get',
    'storage.signUrl',
    'code.workspace.status',
    'code.diff.prepare',
    'code.verify',
    'code.commit.prepare',
    'web3.balance',
    'web3.tx',
    'web3.contract.read',
    'chain.query',
    'secret.check',
  ].includes(action)) return true;

  return (
    action.endsWith('.get') ||
    action.endsWith('.list') ||
    action.endsWith('.search') ||
    action.endsWith('.query') ||
    action.includes('.read') ||
    action.includes('.inspect')
  );
}

function codeRuntimeTarget(task: OneClawTask) {
  const codeTask = task.metadata?.codeTask;
  if (!codeTask || typeof codeTask !== 'object' || Array.isArray(codeTask)) return '';
  const runtime = (codeTask as Record<string, unknown>).runtime;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return '';
  return String((runtime as Record<string, unknown>).target || '');
}

function codeApprovalRequired(action: string, mode: TheOneMode, task: OneClawTask) {
  if (['code.workspace.status', 'code.diff.prepare', 'code.verify', 'code.commit.prepare'].includes(action)) {
    return false;
  }

  // Tests are limited to approved package scripts by the code sandbox contract.
  if (action === 'code.test.run') return mode === 'manual';

  // Automatic mutation is only allowed inside an isolated cloud sandbox.
  if (action === 'code.patch.apply') {
    return mode !== 'auto' || codeRuntimeTarget(task) !== 'cloud_sandbox';
  }

  // Recovery and external delivery always stay operator-gated.
  if (action === 'code.patch.rollback' || action === 'code.pr.create') return true;
  return null;
}

function approvalRequired(action: string, explicit: boolean | undefined, mode: TheOneMode) {
  const risk = getActionRisk(action);
  const readOnlyAuto = isReadOnlyAutoAction(action);

  if (mode === 'manual') {
    return !readOnlyAuto && action !== 'oneai.generate' && action !== 'proof.write' && action !== 'memory.store';
  }

  if (readOnlyAuto && !explicit) return false;
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
    const readOnlyAuto = isReadOnlyAutoAction(step.action, step.input || {});
    const risk = strictXReply ? 'medium' : getActionRisk(step.action);
    const codeRequired = step.action.startsWith('code.')
      ? codeApprovalRequired(step.action, mode, task)
      : null;
    const required = codeRequired !== null
      ? codeRequired
      : strictXReply
      ? mode === 'manual' || task.approvalMode === 'manual'
      : readOnlyAuto
        ? false
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
        ? step.action === 'code.patch.apply'
          ? `${step.action} requires approval unless auto mode is using the isolated cloud sandbox.`
          : `${step.action} requires approval before OneClaw execution.`
        : step.action === 'code.patch.apply'
          ? `${step.action} can continue automatically inside the isolated cloud sandbox.`
          : `${step.action} can be submitted to OneClaw.`,
    };
  });
}

export function canSubmitExternalTasks(gates: ApprovalGate[]) {
  return gates.every((gate) => !gate.required || gate.status === 'approved');
}
