import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest, runOneClawAction } from '../providers/oneclaw';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type { ClassifiedIntent, ExecutionPlan, PlanStep, ProofRecord, TheOneMode, TheOneRunResult } from '../types';

export type FilesWorkflowInput = {
  path: string;
  operation: 'list' | 'exists' | 'read' | 'write' | 'append' | 'document_parse' | 'spreadsheet_read' | 'image_extract_text' | 'image_analyze';
  content?: string;
  mode?: TheOneMode;
};

function fileAction(operation: FilesWorkflowInput['operation']) {
  if (operation === 'exists') return 'file.exists';
  if (operation === 'read') return 'file.read';
  if (operation === 'write') return 'file.write';
  if (operation === 'append') return 'file.append';
  if (operation === 'document_parse') return 'document.parse';
  if (operation === 'spreadsheet_read') return 'spreadsheet.read';
  if (operation === 'image_extract_text') return 'image.extractText';
  if (operation === 'image_analyze') return 'image.analyze';
  return 'file.list';
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

function stepStatus(status: string): PlanStep['status'] {
  if (/success|completed|mock/.test(status)) return 'completed';
  if (/awaiting|approval|pending|blocked/.test(status)) return 'blocked';
  if (/failed|error|rejected/.test(status)) return 'failed';
  return 'running';
}

function executionStatus(status: string) {
  if (/success|completed/.test(status)) return 'success' as const;
  if (/awaiting|approval|pending|blocked/.test(status)) return 'blocked' as const;
  if (/failed|error|rejected/.test(status)) return 'failed' as const;
  if (/mock/.test(status)) return 'mock' as const;
  return 'submitted' as const;
}

export async function runFilesWorkflowApp(input: FilesWorkflowInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'files';
    path: string;
    operation: FilesWorkflowInput['operation'];
    status: string;
    summary: string;
    oneClawTaskId: string | null;
    output: unknown;
    requiresApproval: boolean;
  };
}> {
  const path = (input.path || '/tmp').trim();
  const operation = input.operation || 'list';
  const action = fileAction(operation);
  const writeLike = operation === 'write' || operation === 'append';
  const readLike = operation === 'read' ||
    operation === 'document_parse' ||
    operation === 'spreadsheet_read' ||
    operation === 'image_extract_text' ||
    operation === 'image_analyze';
  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [oneClawManifest, oneClawBridge] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
  ]);
  const kernel = getTheOneKernelStatus(mode, oneClawManifest, oneClawBridge);
  const actionInput: Record<string, unknown> = { path };
  if (writeLike) actionInput.content = input.content || '';

  const task = await runOneClawAction<any>({
    action,
    input: actionInput,
    approvalMode: writeLike ? 'manual' : 'auto',
    idempotencyKey: `files-${operation}-${runId}`,
  });
  const status = taskStatus(task);
  const currentStepStatus = stepStatus(status);
  const currentExecutionStatus = executionStatus(status);
  const id = taskId(task);
  const output = firstStepOutput(task);
  const summary = writeLike && currentStepStatus === 'blocked'
    ? `${operation} for ${path} is prepared and waiting for approval.`
    : readLike
      ? `${action} read ${path} and returned ${status || 'submitted'}.`
      : `${operation} for ${path} returned ${status || 'submitted'}.`;
  const intent: ClassifiedIntent = {
    type: 'automation',
    objective: `Use Files App to ${operation} ${path}`,
    entities: [path],
    constraints: [writeLike ? 'file write requires approval' : 'read-only file or document operation', 'record proof'],
    priority: 'normal',
    confidence: 0.94,
    requiresApproval: writeLike,
  };
  const steps: PlanStep[] = [
    {
      id: 'files_brief',
      title: 'Receive file request',
      action: 'custom',
      status: 'completed',
      output: { path, operation },
      capability: 'plan',
    },
    {
      id: 'files_action',
      title: readLike ? `Read source with ${action}` : `Run ${action}`,
      action: 'oneclaw.execute',
      status: currentStepStatus,
      input: { action, ...actionInput },
      output: { taskId: id, status, output },
      requiresApproval: writeLike,
      dependsOn: ['files_brief'],
      capability: 'operate',
    },
    {
      id: 'files_proof',
      title: 'Record file proof',
      action: 'proof.write',
      status: currentStepStatus === 'completed' ? 'completed' : 'pending',
      dependsOn: ['files_action'],
      capability: 'record',
    },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary,
    steps,
    estimatedRisk: writeLike ? 'medium' : 'low',
    capabilityRoute: {
      intentType: 'automation',
      objective: intent.objective,
      capabilities: ['operate', 'govern', 'record', 'remember'],
      skills: [],
      apps: [],
      connectors: [],
      risk: writeLike ? 'medium' : 'low',
      summary: 'Files App routed the source to the safest OneClaw file, document, or spreadsheet worker.',
    },
  };
  const approvals = writeLike ? [{
    id: `approval_${runId}_files`,
    stepId: 'files_action',
    action,
    risk: 'medium' as const,
    required: true,
    status: currentStepStatus === 'blocked' ? 'pending' as const : 'not_required' as const,
    mode,
    reason: 'File write operations require approval.',
  }] : [];
  const executions = [
    createExecutionRecord({
      provider: 'oneclaw',
      status: currentExecutionStatus,
      summary,
      externalId: id,
      taskName: `action:${action}`,
      raw: task,
    }),
  ];
  const proof: ProofRecord[] = [{
    type: 'execution',
    title: 'File operation handled',
    value: summary,
    timestamp: startedAt,
    metadata: { app: 'files', path, operation, action, taskId: id, output },
  }];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals });
  const appMemoryPack = createAppMemoryPack({
    app: 'files',
    title: `File ${operation}: ${path}`,
    summary,
    facts: [`Path: ${path}`, `Operation: ${operation}`, `Action: ${action}`, `Status: ${status || 'submitted'}`],
    nextActions: writeLike ? ['Approve write only after checking content', 'Sync result after approval'] : ['Review returned file information', 'Use relevant paths in later workflows'],
    sourceRunId: runId,
  });

  return {
    ok: currentExecutionStatus !== 'failed',
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
    networkSignals: { appRoute: 'files', oneClawAction: action, oneClawTaskId: id },
    os: { ...kernel, workflow, approvals, executions },
    appMemoryPack,
    appResult: {
      app: 'files',
      path,
      operation,
      status: currentStepStatus,
      summary,
      oneClawTaskId: id,
      output,
      requiresApproval: writeLike,
    },
  };
}
