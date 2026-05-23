import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest, runOneClawAction } from '../providers/oneclaw';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type { ClassifiedIntent, ExecutionPlan, PlanStep, ProofRecord, TheOneMode, TheOneRunResult } from '../types';

export type ApiOperationInput = {
  url: string;
  method?: string;
  body?: string;
  mode?: TheOneMode;
};

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

export async function runApiOperationApp(input: ApiOperationInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'api';
    url: string;
    method: string;
    status: string;
    summary: string;
    oneClawTaskId: string | null;
    output: unknown;
  };
}> {
  const url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('API URL must start with http:// or https://.');
  const method = (input.method || 'GET').toUpperCase();
  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [manifest, bridge] = await Promise.all([getOneClawCapabilityManifest(), getOneClawBridgeStatus()]);
  const kernel = getTheOneKernelStatus(mode, manifest, bridge);
  const payload: Record<string, unknown> = { url, method };
  if (input.body?.trim()) payload.body = input.body;
  const task = await runOneClawAction<any>({
    action: 'api.request',
    input: payload,
    approvalMode: method === 'GET' ? 'auto' : 'manual',
    idempotencyKey: `api-${runId}`,
  });
  const status = taskStatus(task);
  const stepStatus = statusToStep(status);
  const id = taskId(task);
  const output = firstStepOutput(task);
  const summary = method === 'GET'
    ? `API request to ${url} returned ${status || 'submitted'}.`
    : `API ${method} request to ${url} is ${stepStatus === 'blocked' ? 'waiting for approval' : status || 'submitted'}.`;
  const intent: ClassifiedIntent = {
    type: 'automation',
    objective: `Call API ${method} ${url}`,
    entities: [url],
    constraints: [method === 'GET' ? 'read-only API call' : 'non-GET API call requires approval', 'record proof'],
    priority: 'normal',
    confidence: 0.93,
    requiresApproval: method !== 'GET',
  };
  const steps: PlanStep[] = [
    { id: 'api_brief', title: 'Receive API request', action: 'custom', status: 'completed', output: payload, capability: 'integrate' },
    { id: 'api_call', title: 'Submit API operation', action: 'oneclaw.execute', status: stepStatus, input: { action: 'api.request', ...payload }, output: { taskId: id, status, output }, requiresApproval: method !== 'GET', dependsOn: ['api_brief'], capability: 'operate' },
    { id: 'api_proof', title: 'Record API proof', action: 'proof.write', status: stepStatus === 'completed' ? 'completed' : 'pending', dependsOn: ['api_call'], capability: 'record' },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary,
    steps,
    estimatedRisk: method === 'GET' ? 'medium' : 'high',
    capabilityRoute: {
      intentType: 'automation',
      objective: intent.objective,
      capabilities: ['integrate', 'operate', 'govern', 'record'],
      skills: [],
      apps: [],
      connectors: [],
      risk: method === 'GET' ? 'medium' : 'high',
      summary: 'API App routed an HTTP operation through OneClaw with method-aware approval gates.',
    },
  };
  const approvals = method === 'GET' ? [] : [{
    id: `approval_${runId}_api`,
    stepId: 'api_call',
    action: 'api.request',
    risk: 'high' as const,
    required: true,
    status: stepStatus === 'blocked' ? 'pending' as const : 'not_required' as const,
    mode,
    reason: 'Non-GET API operations require approval.',
  }];
  const executions = [createExecutionRecord({ provider: 'oneclaw', status: stepStatus === 'completed' ? 'success' : stepStatus === 'blocked' ? 'blocked' : stepStatus === 'failed' ? 'failed' : 'submitted', summary, externalId: id, taskName: 'action:api.request', raw: task })];
  const proof: ProofRecord[] = [{ type: 'execution', title: 'API operation handled', value: summary, timestamp: startedAt, metadata: { app: 'api', url, method, taskId: id, output } }];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals });
  const appMemoryPack = createAppMemoryPack({
    app: 'api',
    title: `API operation: ${method} ${url}`,
    summary,
    facts: [`Method: ${method}`, `URL: ${url}`, `Status: ${status || 'submitted'}`],
    nextActions: method === 'GET' ? ['Review response output', 'Promote to scheduled monitor if useful'] : ['Approve only after checking payload and endpoint'],
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
    approvals,
    executions,
    pendingOneClawTask: null,
    networkSignals: { appRoute: 'api', oneClawAction: 'api.request', oneClawTaskId: id },
    os: { ...kernel, workflow, approvals, executions },
    appMemoryPack,
    appResult: { app: 'api', url, method, status: stepStatus, summary, oneClawTaskId: id, output },
  };
}
