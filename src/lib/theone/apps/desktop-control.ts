import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest, runOneClawAction } from '../providers/oneclaw';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type { ClassifiedIntent, ExecutionPlan, PlanStep, ProofRecord, TheOneMode, TheOneRunResult } from '../types';

export type DesktopControlInput = {
  app: string;
  operation: 'state' | 'screenshot' | 'hotkey' | 'type';
  text?: string;
  keys?: string[];
  mode?: TheOneMode;
};

function desktopAction(operation: DesktopControlInput['operation']) {
  if (operation === 'screenshot') return 'desktop.screenshot';
  if (operation === 'hotkey') return 'desktop.hotkey';
  if (operation === 'type') return 'desktop.type';
  return 'desktop.app.state';
}

function taskStatus(value: unknown) {
  const root = value as any;
  return String(root?.status || root?.task?.status || root?.steps?.[0]?.status || '').toLowerCase();
}

function taskId(value: unknown) {
  const root = value as any;
  return root?.id || root?.task?.id || root?.steps?.[0]?.taskId || null;
}

function firstStepOutput(value: unknown) {
  const root = value as any;
  return root?.steps?.[0]?.output || root?.task?.steps?.[0]?.output || root?.output || null;
}

function statusToStep(status: string): PlanStep['status'] {
  if (/success|completed|mock/.test(status)) return 'completed';
  if (/awaiting|approval|pending|blocked/.test(status)) return 'blocked';
  if (/failed|error|rejected/.test(status)) return 'failed';
  return 'running';
}

function statusToExecution(status: string) {
  if (/success|completed/.test(status)) return 'success' as const;
  if (/awaiting|approval|pending|blocked/.test(status)) return 'blocked' as const;
  if (/failed|error|rejected/.test(status)) return 'failed' as const;
  if (/mock/.test(status)) return 'mock' as const;
  return 'submitted' as const;
}

export async function runDesktopControlApp(input: DesktopControlInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'desktop';
    targetApp: string;
    operation: DesktopControlInput['operation'];
    status: string;
    summary: string;
    oneClawTaskId: string | null;
    output: unknown;
    requiresApproval: boolean;
  };
}> {
  const targetApp = (input.app || 'Google Chrome').trim();
  const operation = input.operation || 'state';
  const action = desktopAction(operation);
  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [oneClawManifest, oneClawBridge] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
  ]);
  const kernel = getTheOneKernelStatus(mode, oneClawManifest, oneClawBridge);
  const actionInput: Record<string, unknown> = { app: targetApp };
  if (operation === 'type') actionInput.text = input.text || '';
  if (operation === 'hotkey') actionInput.keys = input.keys?.length ? input.keys : ['cmd', 'l'];

  const task = await runOneClawAction<any>({
    action,
    input: actionInput,
    approvalMode: 'manual',
    idempotencyKey: `desktop-${operation}-${runId}`,
  });
  const status = taskStatus(task);
  const stepStatus = statusToStep(status);
  const executionStatus = statusToExecution(status);
  const id = taskId(task);
  const output = firstStepOutput(task);
  const summary = stepStatus === 'blocked'
    ? `${targetApp} desktop ${operation} is prepared and waiting for approval.`
    : stepStatus === 'completed'
      ? `${targetApp} desktop ${operation} completed through the local bridge.`
      : `${targetApp} desktop ${operation} returned ${status || 'submitted'}.`;
  const intent: ClassifiedIntent = {
    type: 'automation',
    objective: `Use local desktop bridge for ${targetApp}: ${operation}`,
    entities: [targetApp],
    constraints: ['local bridge required', 'desktop actions are approval gated', 'record proof'],
    priority: 'normal',
    confidence: 0.95,
    requiresApproval: true,
  };
  const steps: PlanStep[] = [
    {
      id: 'desktop_brief',
      title: 'Receive desktop request',
      action: 'custom',
      status: 'completed',
      output: { app: targetApp, operation },
      capability: 'plan',
    },
    {
      id: 'desktop_bridge',
      title: 'Submit local desktop action',
      action: 'oneclaw.execute',
      status: stepStatus,
      input: { action, ...actionInput },
      output: { taskId: id, status, output },
      requiresApproval: true,
      dependsOn: ['desktop_brief'],
      capability: 'operate',
    },
    {
      id: 'desktop_proof',
      title: 'Record desktop proof',
      action: 'proof.write',
      status: stepStatus === 'completed' ? 'completed' : 'pending',
      dependsOn: ['desktop_bridge'],
      capability: 'record',
    },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary,
    steps,
    estimatedRisk: 'high',
    capabilityRoute: {
      intentType: 'automation',
      objective: intent.objective,
      capabilities: ['operate', 'govern', 'record'],
      skills: [],
      apps: [],
      connectors: [],
      risk: 'high',
      summary: 'Desktop App routed a local computer operation through OneClaw Local Desktop Bridge.',
    },
  };
  const executions = [
    createExecutionRecord({
      provider: 'oneclaw',
      status: executionStatus,
      summary,
      externalId: id,
      taskName: `action:${action}`,
      raw: task,
    }),
  ];
  const proof: ProofRecord[] = [{
    type: 'execution',
    title: 'Desktop action prepared',
    value: summary,
    timestamp: startedAt,
    metadata: { app: 'desktop', targetApp, operation, action, taskId: id, output },
  }];
  const approvals = [{
    id: `approval_${runId}_desktop`,
    stepId: 'desktop_bridge',
    action,
    risk: 'high' as const,
    required: true,
    status: stepStatus === 'blocked' ? 'pending' as const : 'not_required' as const,
    mode,
    reason: 'Desktop control requires explicit operator approval.',
  }];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals });
  const appMemoryPack = createAppMemoryPack({
    app: 'desktop',
    title: `Desktop ${operation}: ${targetApp}`,
    summary,
    facts: [`App: ${targetApp}`, `Operation: ${operation}`, `Action: ${action}`, `Status: ${status || 'submitted'}`],
    nextActions: ['Approve only when ready to control the local computer', 'Sync task after approval', 'Keep desktop actions scoped to allowed apps'],
    sourceRunId: runId,
  });

  return {
    ok: executionStatus !== 'failed',
    runId,
    summary,
    intent,
    plan,
    execution: {
      completedSteps: steps.filter((step) => step.status === 'completed').length,
      failedSteps: steps.filter((step) => step.status === 'failed').length,
      agentResults: [],
    },
    proof,
    approvals,
    executions,
    pendingOneClawTask: null,
    networkSignals: { appRoute: 'desktop', oneClawAction: action, oneClawTaskId: id },
    os: { ...kernel, workflow, approvals, executions },
    appMemoryPack,
    appResult: {
      app: 'desktop',
      targetApp,
      operation,
      status: stepStatus,
      summary,
      oneClawTaskId: id,
      output,
      requiresApproval: true,
    },
  };
}
