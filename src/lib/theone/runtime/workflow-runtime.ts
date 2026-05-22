import { getActionRisk } from '../policy/approval-policy';
import type {
  ApprovalGate,
  ExecutionPlan,
  ExecutionRecord,
  PlanStepStatus,
  TheOneMode,
  WorkflowTrace,
  WorkflowTraceStep,
} from '../types';

function providerForAction(action: string): WorkflowTraceStep['provider'] {
  if (action === 'oneai.generate') return 'oneai';
  if (action === 'oneclaw.execute' || action.includes('.') && !action.startsWith('oneai')) {
    if (
      action.startsWith('social.') ||
      action.startsWith('browser.') ||
      action.startsWith('file.') ||
      action.startsWith('message.') ||
      action.startsWith('api.') ||
      action.startsWith('construction.') ||
      action === 'trading.place'
    ) {
      return 'oneclaw';
    }
  }
  return 'theone';
}

function findApproval(stepId: string, approvals: ApprovalGate[]) {
  return approvals.find((gate) => gate.stepId === stepId);
}

function traceStatus(steps: WorkflowTraceStep[]): WorkflowTrace['status'] {
  if (steps.some((step) => step.status === 'failed')) return 'failed';
  if (steps.some((step) => step.status === 'blocked')) return 'blocked';
  if (steps.some((step) => step.status === 'running')) return 'running';
  if (steps.length > 0 && steps.every((step) => step.status === 'completed' || step.status === 'skipped')) {
    return 'completed';
  }
  return 'idle';
}

export function createWorkflowTrace(input: {
  runId: string;
  mode: TheOneMode;
  plan: ExecutionPlan;
  approvals: ApprovalGate[];
}): WorkflowTrace {
  const steps = input.plan.steps.map((step) => {
    const approval = findApproval(step.id, input.approvals);
    return {
      id: step.id,
      title: step.title,
      action: step.action,
      status: step.status,
      provider: providerForAction(step.action),
      risk: approval?.risk ?? getActionRisk(step.action),
      approvalStatus: approval?.status ?? 'not_required',
      skillKey: step.skillKey,
      capability: step.capability,
      dependsOn: step.dependsOn || [],
    };
  });

  return {
    id: input.plan.id,
    runId: input.runId,
    mode: input.mode,
    status: traceStatus(steps),
    summary: input.plan.summary,
    steps,
  };
}

export function markApprovalBlockedSteps(
  plan: ExecutionPlan,
  approvals: ApprovalGate[]
): ExecutionPlan {
  const pendingStepIds = new Set(
    approvals
      .filter((gate) => gate.required && gate.status === 'pending')
      .map((gate) => gate.stepId)
  );

  return {
    ...plan,
    steps: plan.steps.map((step) => {
      if (!pendingStepIds.has(step.id)) return step;
      if (step.status === 'completed' || step.status === 'running') return step;
      return { ...step, status: 'blocked' as PlanStepStatus };
    }),
  };
}

export function createExecutionRecord(input: {
  provider: ExecutionRecord['provider'];
  status: ExecutionRecord['status'];
  summary: string;
  externalId?: string | null;
  taskName?: string;
  raw?: unknown;
  receipt?: ExecutionRecord['receipt'];
}): ExecutionRecord {
  return {
    id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ...input,
  };
}
