import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest, runOneClawAction } from '../providers/oneclaw';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type { ClassifiedIntent, ExecutionPlan, PlanStep, ProofRecord, TheOneMode, TheOneRunResult } from '../types';

export type BrowserOperationInput = {
  url: string;
  operation?: 'open' | 'extract' | 'screenshot';
  mode?: TheOneMode;
};

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
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

export async function runBrowserOperationApp(input: BrowserOperationInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'browser';
    url: string;
    operation: string;
    status: string;
    summary: string;
    oneClawTaskId: string | null;
    output: unknown;
  };
}> {
  const url = normalizeUrl(input.url);
  if (!url) throw new Error('Browser URL is required.');
  const operation = input.operation || 'extract';
  const action = operation === 'open' ? 'browser.open' : operation === 'screenshot' ? 'browser.screenshot' : 'browser.extract';
  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [manifest, bridge] = await Promise.all([getOneClawCapabilityManifest(), getOneClawBridgeStatus()]);
  const kernel = getTheOneKernelStatus(mode, manifest, bridge);
  const task = await runOneClawAction<any>({
    action,
    input: { url },
    approvalMode: 'auto',
    idempotencyKey: `browser-${operation}-${runId}`,
  });
  const status = taskStatus(task);
  const stepStatus = statusToStep(status);
  const id = taskId(task);
  const output = firstStepOutput(task);
  const summary = `Browser ${operation} for ${url} returned ${status || 'submitted'}.`;
  const intent: ClassifiedIntent = {
    type: 'knowledge',
    objective: `Run browser ${operation} on ${url}`,
    entities: [url],
    constraints: ['allowed browser host only', 'record proof'],
    priority: 'normal',
    confidence: 0.93,
    requiresApproval: false,
  };
  const steps: PlanStep[] = [
    { id: 'browser_brief', title: 'Receive browser request', action: 'custom', status: 'completed', output: { url, operation }, capability: 'plan' },
    { id: 'browser_action', title: `Run ${action}`, action: 'oneclaw.execute', status: stepStatus, input: { action, url }, output: { taskId: id, status, output }, dependsOn: ['browser_brief'], capability: 'operate' },
    { id: 'browser_proof', title: 'Record browser proof', action: 'proof.write', status: stepStatus === 'completed' ? 'completed' : 'pending', dependsOn: ['browser_action'], capability: 'record' },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary,
    steps,
    estimatedRisk: 'medium',
    capabilityRoute: {
      intentType: 'knowledge',
      objective: intent.objective,
      capabilities: ['operate', 'research', 'govern', 'record'],
      skills: [],
      apps: [],
      connectors: [],
      risk: 'medium',
      summary: 'Browser App routed a browser operation through OneClaw with host policy checks.',
    },
  };
  const executions = [createExecutionRecord({ provider: 'oneclaw', status: stepStatus === 'completed' ? 'success' : stepStatus === 'blocked' ? 'blocked' : stepStatus === 'failed' ? 'failed' : 'submitted', summary, externalId: id, taskName: `action:${action}`, raw: task })];
  const proof: ProofRecord[] = [{ type: 'execution', title: 'Browser operation handled', value: summary, timestamp: startedAt, metadata: { app: 'browser', url, operation, action, taskId: id, output } }];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals: [] });
  const appMemoryPack = createAppMemoryPack({
    app: 'browser',
    title: `Browser ${operation}: ${url}`,
    summary,
    facts: [`URL: ${url}`, `Operation: ${operation}`, `Status: ${status || 'submitted'}`],
    nextActions: ['Review captured output', 'Turn useful findings into a report or memory note'],
    sourceRunId: runId,
  });

  return {
    ok: stepStatus !== 'failed',
    runId,
    summary,
    intent,
    plan,
    execution: { completedSteps: steps.filter((step) => step.status === 'completed').length, failedSteps: steps.filter((step) => step.status === 'failed').length, agentResults: [] },
    proof,
    approvals: [],
    executions,
    pendingOneClawTask: null,
    networkSignals: { appRoute: 'browser', oneClawAction: action, oneClawTaskId: id },
    os: { ...kernel, workflow, approvals: [], executions },
    appMemoryPack,
    appResult: { app: 'browser', url, operation, status: stepStatus, summary, oneClawTaskId: id, output },
  };
}
