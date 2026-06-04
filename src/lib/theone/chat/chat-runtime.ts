import { attachAutomationPolicyToTask, evaluateAutomationPolicy } from '../policy/automation-engine';
import { evaluateOneClawTaskPolicy } from '../policy/approval-policy';
import { preflightOneClawTask } from '../execution/preflight';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace, markApprovalBlockedSteps } from '../runtime/workflow-runtime';
import { getTheOneKernelStatus } from '../kernel/status';
import { extractOneAIData, runOneAI } from '../providers/oneai';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest, runOneClawTask } from '../providers/oneclaw';
import { listEnabledAppRuntimePackages, selectAppRuntimePackagesFromCatalog } from '../apps/runtime-packages';
import { resolveTheOneModel } from '../models/model-router';
import { buildUniversalWorkerCatalog } from '../workers/action-catalog';
import { queryMemoryGraph } from '../state/run-store';
import { buildBrainOnlyReply, buildTheOneBrainFrame } from './brain-layer';
import { buildOneAIChatWorkflow, type TheOneChatMessage } from './oneai-workflow-builder';
import type {
  ApprovalGate,
  ClassifiedIntent,
  ExecutionPlan,
  OneClawTask,
  OneClawTaskRun,
  PlanStep,
  ProofRecord,
  TheOneMode,
  TheOneRunResult,
} from '../types';

export type TheOneChatRuntimeInput = {
  messages: TheOneChatMessage[];
  input?: string;
  mode?: TheOneMode;
  userId?: string;
  sessionId?: string;
};

function latestUserMessage(messages: TheOneChatMessage[], explicit?: string) {
  if (explicit?.trim()) return explicit.trim();
  return [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';
}

function normalizeMode(value: unknown): TheOneMode {
  return value === 'manual' || value === 'auto' || value === 'assist' ? value : 'assist';
}

function executionStatus(raw: OneClawTaskRun | null, blocked: boolean): 'submitted' | 'blocked' | 'failed' | 'mock' | 'planned' {
  if (raw?.mock) return 'mock';
  if (raw?.status && /fail|error|rejected/i.test(raw.status)) return 'failed';
  if (raw?.status && /success|complete|submitted|running|queued|awaiting/i.test(raw.status)) return 'submitted';
  if (blocked) return 'blocked';
  return 'planned';
}

function mapApprovalsForAutomation(input: {
  approvals: ApprovalGate[];
  automationBlocked: boolean;
  automationManual: boolean;
}) {
  if (input.automationBlocked) {
    return input.approvals.map((approval) => ({
      ...approval,
      required: true,
      status: 'rejected' as const,
      reason: `${approval.reason} Automation policy blocked this action.`,
    }));
  }

  if (input.automationManual) {
    return input.approvals.map((approval) => ({
      ...approval,
      required: true,
      status: 'pending' as const,
      reason: `${approval.reason} TheOne Chat Runtime requires human approval.`,
    }));
  }

  return input.approvals;
}

function proof(input: {
  title: string;
  value: string;
  metadata?: Record<string, unknown>;
}): ProofRecord {
  return {
    type: 'system',
    title: input.title,
    value: input.value,
    metadata: input.metadata,
    timestamp: new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compactJson(value: unknown, limit = 6000) {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > limit ? `${text.slice(0, limit)}\n...truncated` : text;
  } catch {
    return String(value || '');
  }
}

function collectTextFragments(value: unknown, fragments: string[] = [], depth = 0) {
  if (depth > 5 || fragments.join('\n').length > 9000) return fragments;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 40) fragments.push(trimmed);
    return fragments;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectTextFragments(item, fragments, depth + 1));
    return fragments;
  }
  if (isRecord(value)) {
    for (const key of ['summary', 'text', 'content', 'body', 'markdown', 'title', 'description']) {
      collectTextFragments(value[key], fragments, depth + 1);
    }
    for (const key of ['output', 'response', 'data', 'result', 'artifact', 'artifacts', 'steps']) {
      collectTextFragments(value[key], fragments, depth + 1);
    }
  }
  return fragments;
}

function extractWorkerResultText(run: OneClawTaskRun | null) {
  if (!run) return '';
  const source = isRecord(run) && run.raw ? run.raw : run;
  const fragments = collectTextFragments(source)
    .map((fragment) => fragment.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return Array.from(new Set(fragments)).join('\n\n').slice(0, 9000);
}

function firstTaskStepInput(task: { steps?: Array<{ input?: Record<string, unknown>; action?: string }> } | null | undefined) {
  return task?.steps?.[0]?.input || {};
}

function firstTaskAction(task: { steps?: Array<{ action?: string }> } | null | undefined) {
  return task?.steps?.[0]?.action || '';
}

function textField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function capabilityAvailable(actions: Array<{ action: string }>, action: string) {
  return actions.some((capability) => capability.action === action);
}

function extractGitHubRepo(raw: string) {
  if (!/(github|repo|repository|仓库|代码库)/i.test(raw)) return null;
  const match = raw.match(/(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

function synthesizeGitHubRepoTask(input: {
  raw: string;
  actions: Array<{ action: string }>;
}): OneClawTask | null {
  const repo = extractGitHubRepo(input.raw);
  if (!repo || !capabilityAvailable(input.actions, 'git.repo.get')) return null;

  const steps: OneClawTask['steps'] = [
    {
      id: 'step_1',
      action: 'git.repo.get',
      input: { repo },
      dependsOn: [],
    },
  ];

  if (capabilityAvailable(input.actions, 'git.actions.runs')) {
    steps.push({
      id: 'step_2',
      action: 'git.actions.runs',
      input: { repo },
      dependsOn: [],
    });
  }

  if (capabilityAvailable(input.actions, 'git.checks.list')) {
    steps.push({
      id: 'step_3',
      action: 'git.checks.list',
      input: { repo },
      dependsOn: [],
    });
  }

  return {
    taskName: `chat_github_repo_review_${repo.replace(/[^A-Za-z0-9]+/g, '_')}`,
    approvalMode: 'auto',
    steps,
    metadata: {
      source: 'theone.chat_runtime.github_fallback',
      repo,
      reason: 'TheOne detected a complete GitHub owner/repo shorthand in the user message.',
    },
  };
}

function pendingTaskSummary(input: {
  baseReply: string;
  oneclawTask: { approvalMode?: string; steps?: Array<{ action?: string; input?: Record<string, unknown> }> } | null;
  approvals: ApprovalGate[];
  automationReason?: string;
}) {
  const action = firstTaskAction(input.oneclawTask);
  const stepInput = firstTaskStepInput(input.oneclawTask);
  const approvalReason = input.approvals.find((approval) => approval.required && approval.status === 'pending')?.reason ||
    input.automationReason ||
    'TheOne policy requires approval before this worker can act.';

  if (action === 'social.post') {
    const draft = textField(stepInput.content) || textField(stepInput.text) || textField(stepInput.body);
    const target = textField(stepInput.channel) || 'x';
    return [
      'I prepared the X post workflow and paused before publishing.',
      '',
      draft ? `Draft post:\n${draft}` : 'Draft post: The publishing worker did not return a readable draft yet.',
      '',
      `Why approval is required: posting to ${target.toUpperCase()} is a public external write action.`,
      `Approval note: ${approvalReason}`,
      '',
      'Approve it when the draft is ready, or ask me to revise the angle, tone, or length first.',
    ].join('\n');
  }

  if (input.oneclawTask?.steps?.length) {
    return [
      input.baseReply,
      '',
      `Prepared worker task: ${input.oneclawTask.steps.map((step) => step.action).filter(Boolean).join(', ')}`,
      `Why approval is required: ${approvalReason}`,
    ].join('\n');
  }

  return input.baseReply;
}

function slugify(value: string, fallback = 'mission') {
  const slug = value
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function createMissionFrame(input: {
  runId: string;
  raw: string;
  mode: TheOneMode;
  brain: ReturnType<typeof buildTheOneBrainFrame>;
  selectedAppPackages: Array<{ key: string; title: string; route: string }>;
}) {
  const primaryApp = input.selectedAppPackages[0] || input.brain.selectedApps[0] || null;
  const missionKey = `chat_${slugify(primaryApp?.key || input.brain.conversationKind)}_${slugify(input.raw)}`;
  const objective = input.brain.objective || input.raw;

  return {
    schemaVersion: 'theone.mission_frame.v1',
    id: `mission_${input.runId}`,
    key: missionKey,
    runId: input.runId,
    title: objective.length > 96 ? `${objective.slice(0, 93)}...` : objective,
    objective,
    mode: input.mode,
    conversationKind: input.brain.conversationKind,
    primaryApp: primaryApp ? {
      key: primaryApp.key,
      title: primaryApp.title,
      route: primaryApp.route,
    } : null,
    workspace: {
      key: primaryApp?.key ? `workspace_${primaryApp.key}` : 'workspace_chat',
      title: primaryApp?.title || 'TheOne Chat Workspace',
      route: primaryApp?.route || '/run',
    },
    recovery: {
      canResume: true,
      resumeWith: `Continue mission ${input.runId}`,
      replayRoute: `/runs/${input.runId}`,
    },
    createdAt: new Date().toISOString(),
  };
}

function buildMemoryContextMessage(memories: any[]): TheOneChatMessage | null {
  if (!memories.length) return null;
  const lines = memories.slice(0, 6).map((item, index) => {
    const title = item.title || item.summary || item.kind || 'memory';
    const summary = item.summary || item.content?.summary || item.content?.mission?.objective || item.content?.mission?.title || '';
    return `${index + 1}. ${title}${summary ? `: ${String(summary).slice(0, 360)}` : ''}`;
  });
  return {
    role: 'system',
    content: [
      'Relevant TheOne memory from previous runs. Use this as background context only; do not invent facts beyond it.',
      ...lines,
    ].join('\n'),
  };
}

function memorySummary(memories: any[]) {
  return {
    count: memories.length,
    latest: memories[0] ? {
      id: memories[0].id,
      kind: memories[0].kind,
      title: memories[0].title || memories[0].summary || memories[0].content?.mission?.title || 'Memory',
      createdAt: memories[0].createdAt,
    } : null,
  };
}

function describeWorkerRuntime(input: {
  oneclawTask: OneClawTask | null;
  oneclawRun: OneClawTaskRun | null;
  oneclawError: string | null;
  blocked: boolean;
  approvalGated: boolean;
  canSubmit: boolean;
  preflight: unknown;
  automationPolicy: { blocked?: boolean; canAutoRun?: boolean; requiresHumanApproval?: boolean; reasons?: string[] };
  approvals: ApprovalGate[];
  finalSummary: string | null;
  workerResultText: string;
}) {
  const failureText = [
    input.oneclawError,
    ...(input.automationPolicy.reasons || []),
    input.approvals.find((item) => item.required && item.status === 'pending')?.reason,
  ].filter(Boolean).join(' ');
  const failureDiagnosis = classifyFailure(failureText);
  const phases = [
    {
      key: 'planned',
      title: 'Workflow planned',
      status: 'completed',
      detail: 'OneAI produced a structured workflow for TheOne to validate.',
    },
    {
      key: 'policy_checked',
      title: 'Policy checked',
      status: input.blocked ? 'blocked' : input.approvalGated ? 'approval_gated' : 'completed',
      detail: input.automationPolicy.reasons?.join(' ') || 'TheOne evaluated preflight, risk, and approval rules.',
    },
    ...(input.oneclawTask ? [{
      key: 'worker_dispatch',
      title: 'Worker dispatch',
      status: input.oneclawRun
        ? 'completed'
        : input.oneclawError
          ? 'failed'
          : input.blocked
            ? 'blocked'
            : input.approvalGated
              ? 'awaiting_approval'
              : input.canSubmit
                ? 'running'
                : 'prepared',
      detail: input.oneclawRun
        ? 'OneClaw returned a worker receipt.'
        : input.oneclawError
          ? input.oneclawError
          : input.approvalGated
            ? 'The worker task is prepared and waiting for approval.'
            : 'The worker task is prepared for execution.',
    }] : []),
    {
      key: 'answer_ready',
      title: 'Answer ready',
      status: input.finalSummary || input.workerResultText || !input.oneclawTask ? 'completed' : 'pending',
      detail: input.finalSummary
        ? 'TheOne returned a polished answer from worker evidence.'
        : input.oneclawTask
          ? 'TheOne is waiting for worker output or approval before finalizing.'
          : 'TheOne answered directly without an external worker.',
    },
  ];
  const current = [...phases].reverse().find((phase) => phase.status !== 'completed') || phases[phases.length - 1];
  const approval = input.approvals.find((item) => item.required && item.status === 'pending');

  return {
    schemaVersion: 'theone.worker_runtime.v1',
    status: input.oneclawError
      ? 'failed'
      : input.blocked
        ? 'blocked'
        : input.approvalGated
          ? 'awaiting_approval'
          : input.oneclawRun || input.finalSummary
            ? 'completed'
            : input.oneclawTask
              ? 'prepared'
              : 'answered',
    current,
    phases,
    diagnostics: {
      userReadable: input.oneclawError
        ? `OneClaw execution failed: ${input.oneclawError}`
        : approval
          ? approval.reason
          : input.blocked
            ? input.automationPolicy.reasons?.join(' ') || 'TheOne blocked this workflow during policy validation.'
            : input.oneclawRun
              ? 'Worker execution completed and returned a receipt.'
              : input.oneclawTask
                ? 'Worker task is prepared and safe to track.'
                : 'No external worker was needed for this response.',
      retryable: Boolean(input.oneclawError) || input.blocked,
      approvalRequired: input.approvalGated,
      category: failureDiagnosis.category,
      severity: failureDiagnosis.severity,
      nextFixes: failureDiagnosis.nextFixes,
    },
    preflight: input.preflight,
  };
}

function classifyFailure(text: string) {
  const value = text.toLowerCase();
  if (!value.trim()) {
    return {
      category: 'none',
      severity: 'low',
      nextFixes: ['Continue the conversation or ask TheOne to turn the result into a report.'],
    };
  }
  if (/credential|token|api key|secret|unauthorized|forbidden|401|403/.test(value)) {
    return {
      category: 'credentials_or_permission',
      severity: 'high',
      nextFixes: ['Check connector credentials and permission scope.', 'Reconnect the provider, then retry the mission.'],
    };
  }
  if (/approval|manual|gate|requires human/.test(value)) {
    return {
      category: 'approval_required',
      severity: 'medium',
      nextFixes: ['Review the approval reason.', 'Approve, reject, or ask TheOne to revise the worker task.'],
    };
  }
  if (/policy|blocked|allowlist|not allowed|risk/.test(value)) {
    return {
      category: 'policy_blocked',
      severity: 'high',
      nextFixes: ['Adjust the request or policy allowlist.', 'Ask TheOne to rebuild the workflow with a safer action.'],
    };
  }
  if (/timeout|fetch failed|network|unreachable|econn|host|dns/.test(value)) {
    return {
      category: 'connector_or_network',
      severity: 'medium',
      nextFixes: ['Check whether the connector endpoint is reachable.', 'Retry after the provider or local bridge is online.'],
    };
  }
  if (/missing|required|invalid|schema|input|url|repo/.test(value)) {
    return {
      category: 'invalid_or_missing_input',
      severity: 'medium',
      nextFixes: ['Provide the missing input.', 'Ask TheOne to restate the exact field it needs.'],
    };
  }
  return {
    category: 'worker_failed',
    severity: 'medium',
    nextFixes: ['Open the mission detail and inspect the worker receipt.', 'Retry the worker or ask TheOne for an alternate route.'],
  };
}

async function summarizeWorkerResult(input: {
  rawRequest: string;
  workflowSummary: string;
  oneclawRun: OneClawTaskRun;
}) {
  const workerResultText = extractWorkerResultText(input.oneclawRun);
  const evidence = workerResultText || compactJson(input.oneclawRun, 9000);

  if (!evidence.trim()) {
    return {
      finalOneAiResult: null as unknown,
      finalSummary: 'OneClaw finished the worker task, but no readable worker result was returned yet.',
      workerResultText: '',
    };
  }

  const finalMessage = [
    'You are finalizing a TheOne chat workflow after OneClaw executed a worker task.',
    'Return a polished user-facing answer. Use the worker evidence directly. Do not ask for approval or another URL if evidence is present.',
    'For website analysis, use these sections when possible: Key findings, Positioning, Useful opportunities, Risks or gaps, Recommended next move.',
    'For API, file, GitHub, desktop, or browser work, explain what happened, what evidence supports it, and what the user can do next.',
    'Do not expose raw JSON unless it is the only useful evidence.',
    `Original user request: ${input.rawRequest}`,
    `Workflow summary: ${input.workflowSummary}`,
    `Worker evidence:\n${evidence}`,
  ].join('\n\n');
  const modelRoute = resolveTheOneModel('theone.chat.finalize');

  try {
    const finalOneAiResult = await runOneAI<unknown>({
      type: 'theone_chat_workflow',
      input: {
        message: finalMessage,
        mode: 'assist',
        availableActions: [],
        modelRoute,
      },
      options: {
        model: modelRoute.model,
        modelRoute,
      },
    });
    const data = extractOneAIData<Record<string, unknown>>(finalOneAiResult);
    const finalSummary = typeof data?.assistantReply === 'string' && data.assistantReply.trim()
      ? data.assistantReply.trim()
      : evidence.slice(0, 1800);

    return { finalOneAiResult, finalSummary, workerResultText };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OneAI final summary failed.';
    return {
      finalOneAiResult: { success: false, error: message },
      finalSummary: workerResultText
        ? `OneClaw returned worker data, but the final OneAI summary pass failed: ${message}\n\n${workerResultText.slice(0, 1800)}`
        : `OneClaw returned a receipt, but the final OneAI summary pass failed: ${message}`,
      workerResultText,
    };
  }
}

function buildIntent(input: {
  raw: string;
  domain: string;
  risk: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
}): ClassifiedIntent {
  return {
    type: input.domain === 'x' || input.domain === 'growth' ? 'growth' : input.domain === 'web' ? 'knowledge' : 'general',
    objective: input.raw,
    entities: [input.domain].filter(Boolean),
    constraints: [],
    priority: 'normal',
    confidence: 0.86,
    requiresApproval: input.requiresApproval,
  };
}

function buildPlan(input: {
  planId: string;
  intent: ClassifiedIntent;
  summary: string;
  oneAiSteps: Array<{ id: string; title: string; action: string; worker: string; dependsOn?: string[] }>;
  hasOneClawTask: boolean;
  oneClawStatus: PlanStep['status'];
  risk: 'low' | 'medium' | 'high';
}): ExecutionPlan {
  const steps: PlanStep[] = [
    {
      id: 'chat_oneai_workflow',
      title: 'OneAI builds structured workflow',
      action: 'oneai.generate',
      status: 'completed',
      output: {
        generatedSteps: input.oneAiSteps.length,
      },
    },
    {
      id: 'chat_theone_policy',
      title: 'TheOne validates workflow and policy',
      action: 'custom',
      status: input.oneClawStatus === 'failed' ? 'failed' : 'completed',
      dependsOn: ['chat_oneai_workflow'],
    },
    ...(input.hasOneClawTask ? [{
      id: 'chat_oneclaw_dispatch',
      title: 'Dispatch approved worker task',
      action: 'oneclaw.execute' as const,
      status: input.oneClawStatus,
      dependsOn: ['chat_theone_policy'],
    }] : []),
    {
      id: 'chat_proof',
      title: 'Return answer and record proof',
      action: 'proof.write',
      status: input.oneClawStatus === 'failed' ? 'failed' : 'completed',
      dependsOn: input.hasOneClawTask ? ['chat_oneclaw_dispatch'] : ['chat_theone_policy'],
    },
  ];

  return {
    id: input.planId,
    intent: input.intent,
    summary: input.summary,
    steps,
    estimatedRisk: input.risk,
    estimatedValue: 'OneAI workflow + TheOne validation + worker coordination',
  };
}

export async function runTheOneChatRuntime(input: TheOneChatRuntimeInput): Promise<TheOneRunResult & {
  chat: Record<string, unknown>;
}> {
  const runId = createRunId();
  const planId = createPlanId();
  const mode = normalizeMode(input.mode);
  const messages = input.messages || [];
  const raw = latestUserMessage(messages, input.input);

  if (!raw) {
    throw new Error('A user message is required.');
  }

  const [oneClawManifest, oneClawBridge] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
  ]);
  const kernel = getTheOneKernelStatus(mode, oneClawManifest, oneClawBridge);
  const workerCatalog = buildUniversalWorkerCatalog({
    capabilities: oneClawManifest.capabilities,
    connectors: oneClawManifest.connectors || [],
  });
  const appPackages = await listEnabledAppRuntimePackages();
  const selectedAppPackages = selectAppRuntimePackagesFromCatalog(raw, appPackages).slice(0, 3);
  const primaryModel = resolveTheOneModel('theone.chat.primary');
  const brain = buildTheOneBrainFrame({
    raw,
    mode,
    messages,
    appPackages,
    selectedAppPackages,
    workerCatalogSummary: workerCatalog.summary,
    workerCatalogActions: workerCatalog.actions,
  });
  const mission = createMissionFrame({
    runId,
    raw,
    mode,
    brain,
    selectedAppPackages,
  });
  const memoryContext = await queryMemoryGraph({
    query: raw,
    intentType: brain.conversationKind,
    capabilities: brain.capabilityRoute,
    limit: 6,
  }).catch(() => []);
  const memoryContextMessage = buildMemoryContextMessage(memoryContext);
  const contextualMessages = memoryContextMessage ? [memoryContextMessage, ...messages] : messages;

  if (!brain.executionDecision.shouldPlan || brain.reasoning.missingInformation.length > 0) {
    let brainOnlyOneAi: Awaited<ReturnType<typeof buildOneAIChatWorkflow>> | null = null;
    let summary = buildBrainOnlyReply({ brain, appPackages });

    try {
      brainOnlyOneAi = await buildOneAIChatWorkflow({
        raw,
        mode,
        messages: contextualMessages,
        capabilities: oneClawManifest.capabilities,
        workerCatalog,
        appPackages,
        brain,
      });
      if (brainOnlyOneAi.workflow.assistantReply.trim()) {
        summary = brainOnlyOneAi.workflow.assistantReply.trim();
      }
    } catch {
      brainOnlyOneAi = null;
    }

    const intent = buildIntent({
      raw: brain.objective,
      domain: brain.conversationKind,
      risk: brain.safety.risk,
      requiresApproval: brain.executionDecision.approvalExpected,
    });
    const preflight = preflightOneClawTask({
      task: null,
      intent,
      mode,
      capabilities: oneClawManifest.capabilities,
    });
    const plan = buildPlan({
      planId,
      intent,
      summary: brain.reasoning.strategy,
      oneAiSteps: [{
        id: 'brain_understanding',
        title: 'TheOne Brain understands the conversation',
        action: 'theone.brain',
        worker: 'theone',
        dependsOn: [],
      }],
      hasOneClawTask: false,
      oneClawStatus: 'skipped',
      risk: brain.safety.risk,
    });
    const workflow = createWorkflowTrace({ runId, mode, plan, approvals: [] });
    const workerRuntime = describeWorkerRuntime({
      oneclawTask: null,
      oneclawRun: null,
      oneclawError: null,
      blocked: false,
      approvalGated: false,
      canSubmit: false,
      preflight,
      automationPolicy: { blocked: false, canAutoRun: false, requiresHumanApproval: false, reasons: [] },
      approvals: [],
      finalSummary: summary,
      workerResultText: '',
    });
    const proofRecords = [
      proof({
        title: 'TheOne Brain handled conversation',
        value: summary,
        metadata: {
          source: 'theone.brain_layer',
          mission,
          brain,
          workerRuntime,
          modelRoute: primaryModel,
          selectedAppPackages,
          memoryContext: memorySummary(memoryContext),
          workerCatalogSummary: workerCatalog.summary,
          preflight,
        },
      }),
    ];
    const executions = [
      ...(brainOnlyOneAi ? [createExecutionRecord({
        provider: 'oneai' as const,
        status: brainOnlyOneAi.oneAiResult.mock ? 'mock' : brainOnlyOneAi.oneAiResult.success ? 'success' : 'failed',
        summary: 'OneAI generated the natural brain-layer chat reply.',
        taskName: 'oneai.chat.brain_reply',
        raw: brainOnlyOneAi.oneAiResult,
      })] : []),
      createExecutionRecord({
        provider: 'theone',
        status: 'success',
        summary: 'TheOne Brain answered without external worker execution.',
        taskName: 'theone.brain.respond',
        raw: { brain, preflight },
      }),
    ];

    return {
      ok: true,
      runId,
      summary,
      intent,
      plan,
      execution: {
        completedSteps: plan.steps.filter((step) => step.status === 'completed').length,
        failedSteps: plan.steps.filter((step) => step.status === 'failed').length,
        agentResults: [],
      },
      proof: proofRecords,
      approvals: [],
      executions,
      pendingOneClawTask: null,
      preflight,
      os: {
        ...kernel,
        workflow,
        approvals: [],
        executions,
        oneClawManifest,
        oneClawBridge,
        preflight,
      },
      networkSignals: {
        routedBy: 'theone.brain_layer',
        mission,
        workerRuntime,
        modelRoute: primaryModel,
        selectedAppPackages: selectedAppPackages.map((pkg) => pkg.key),
        memoryContext: memorySummary(memoryContext),
        workerCatalogSummary: workerCatalog.summary,
        brainMode: brain.mode,
        conversationKind: brain.conversationKind,
      },
      chat: {
        runtime: 'theone.chat_runtime.v2',
          mission,
          brain,
          workerRuntime,
          oneAiBrainReply: brainOnlyOneAi?.workflow || null,
          modelRoute: primaryModel,
          memoryContext: memorySummary(memoryContext),
        appPackages: brain.selectedApps.length ? brain.selectedApps : appPackages.slice(0, 4),
        workerCatalog: workerCatalog.summary,
        assistant: {
          role: 'assistant',
          content: summary,
          createdAt: new Date().toISOString(),
        },
        oneAiWorkflow: {
          id: `brain_only_${runId}`,
          summary: brain.reasoning.strategy,
          source: brainOnlyOneAi ? 'oneai' : 'theone.brain',
          owner: brainOnlyOneAi ? 'OneAI' : 'TheOne',
          status: 'validated',
          steps: (brainOnlyOneAi?.workflow.workflow.steps || [{
            id: 'brain_understanding',
            title: 'Understand and answer',
            worker: 'oneai',
            action: 'oneai.generate',
            input: { objective: brain.objective },
            dependsOn: [],
          }]).map((step) => ({
            ...step,
            owner: step.worker || 'oneai',
            status: 'completed',
          })),
        },
        workerCoordination: {
          mode,
          requiredWorkers: ['theone'],
          workers: [
            {
              key: 'theone',
              title: 'TheOne Brain',
              role: 'Understands the conversation, chooses strategy, and decides whether workers are needed.',
              status: 'ready',
            },
          ],
          oneclawTask: null,
          oneclawRun: null,
          workerResultText: '',
          finalSummary: summary,
          approvalSummary: null,
          automationPolicy: null,
          preflight,
          workerRuntime,
        },
        nextActions: brain.nextMoves,
      },
    };
  }

  const oneAi = await buildOneAIChatWorkflow({
    raw,
    mode,
    messages: contextualMessages,
    capabilities: oneClawManifest.capabilities,
    workerCatalog,
    appPackages,
    brain,
  });
  const fallbackOneClawTask = oneAi.oneclawTask ? null : synthesizeGitHubRepoTask({
    raw,
    actions: oneClawManifest.capabilities,
  });
  const plannedOneClawTask = oneAi.oneclawTask || fallbackOneClawTask;
  const plannedWorkflowSteps = fallbackOneClawTask
    ? [
        ...oneAi.workflow.workflow.steps,
        ...fallbackOneClawTask.steps.map((step, index) => ({
          id: step.id || `github_step_${index + 1}`,
          title: step.action === 'git.repo.get'
            ? 'Read GitHub repository metadata'
            : step.action === 'git.actions.runs'
              ? 'Read recent GitHub Actions runs'
              : step.action === 'git.checks.list'
                ? 'Read GitHub check status'
                : step.action,
          worker: 'github_worker',
          action: step.action,
          input: step.input,
          approvalMode: 'auto' as const,
          dependsOn: step.dependsOn || [],
        })),
      ]
    : oneAi.workflow.workflow.steps;
  const workflowSummary = fallbackOneClawTask
    ? `Check GitHub repository ${fallbackOneClawTask.metadata?.repo || ''} and summarize attention points.`
    : oneAi.workflow.workflow.summary;
  const workflowDomain = fallbackOneClawTask ? 'github' : oneAi.workflow.intent.domain;

  const intent = buildIntent({
    raw: oneAi.workflow.intent.objective || raw,
    domain: workflowDomain,
    risk: oneAi.workflow.intent.risk,
    requiresApproval: oneAi.workflow.intent.requiresApproval || oneAi.workflow.safety.requiresApproval,
  });
  const preflight = preflightOneClawTask({
    task: plannedOneClawTask,
    intent,
    mode,
    capabilities: oneClawManifest.capabilities,
  });
  const automationPolicy = await evaluateAutomationPolicy({
    task: plannedOneClawTask,
    mode,
    preflight,
    capabilities: oneClawManifest.capabilities,
    connectors: oneClawManifest.connectors,
    canSubmitExternalTasks: true,
  });
  const oneclawTask = attachAutomationPolicyToTask(plannedOneClawTask, automationPolicy);
  const approvals = mapApprovalsForAutomation({
    approvals: evaluateOneClawTaskPolicy(oneclawTask, mode),
    automationBlocked: automationPolicy.blocked,
    automationManual: automationPolicy.requiresHumanApproval,
  });
  const pendingApprovals = approvals.filter((approval) => approval.required && approval.status === 'pending');
  const canSubmit = Boolean(oneclawTask) &&
    automationPolicy.canAutoRun &&
    pendingApprovals.length === 0;

  let oneclawRun: OneClawTaskRun | null = null;
  let oneclawError: string | null = null;
  let finalOneAiResult: unknown = null;
  let finalSummary: string | null = null;
  let workerResultText = '';
  if (canSubmit && oneclawTask) {
    try {
      oneclawRun = await runOneClawTask<OneClawTaskRun>(oneclawTask);
      const finalized = await summarizeWorkerResult({
        rawRequest: raw,
        workflowSummary,
        oneclawRun,
      });
      finalOneAiResult = finalized.finalOneAiResult;
      finalSummary = finalized.finalSummary;
      workerResultText = finalized.workerResultText;
    } catch (error) {
      oneclawError = error instanceof Error ? error.message : 'OneClaw task submission failed.';
    }
  }

  const blocked = automationPolicy.blocked || preflight.status === 'blocked' || Boolean(oneclawError);
  const approvalGated = pendingApprovals.length > 0 || automationPolicy.requiresHumanApproval;
  const dispatchStatus: PlanStep['status'] = !oneclawTask
    ? 'skipped'
    : oneclawRun
      ? 'running'
    : blocked
      ? 'failed'
      : approvalGated
        ? 'blocked'
        : automationPolicy.canAutoRun
          ? 'running'
          : 'pending';
  const plan = markApprovalBlockedSteps(buildPlan({
    planId,
    intent,
    summary: workflowSummary,
    oneAiSteps: plannedWorkflowSteps,
    hasOneClawTask: Boolean(oneclawTask),
    oneClawStatus: dispatchStatus,
    risk: automationPolicy.risk || oneAi.workflow.intent.risk,
  }), approvals);
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals });
  const executions = [
    createExecutionRecord({
      provider: 'oneai',
      status: oneAi.oneAiResult.mock ? 'mock' : oneAi.oneAiResult.success ? 'success' : 'failed',
      summary: 'OneAI generated a structured chat workflow.',
      taskName: 'oneai.chat.workflow',
      raw: oneAi.oneAiResult,
    }),
    createExecutionRecord({
      provider: 'theone',
      status: blocked ? 'blocked' : 'success',
      summary: blocked ? 'TheOne blocked or failed the workflow during validation.' : 'TheOne validated workflow, preflight, and policy.',
      taskName: 'theone.chat.validate',
      raw: { preflight, automationPolicy, approvals },
    }),
    ...(oneclawTask ? [createExecutionRecord({
      provider: 'oneclaw' as const,
      status: executionStatus(oneclawRun, blocked),
      summary: oneclawRun
        ? 'OneClaw worker task executed by TheOne Chat Runtime.'
        : blocked
          ? 'OneClaw worker task was blocked before execution.'
          : 'OneClaw worker task is waiting for approval.',
      externalId: oneclawRun?.id || null,
      taskName: oneclawTask.taskName,
      raw: { oneclawTask, oneclawRun, oneclawError },
    })] : []),
    ...(finalOneAiResult ? [createExecutionRecord({
      provider: 'oneai' as const,
      status: isRecord(finalOneAiResult) && finalOneAiResult.success === false ? 'failed' : 'success',
      summary: 'OneAI summarized the worker result for the chat.',
      taskName: 'oneai.chat.finalize',
      raw: finalOneAiResult,
    })] : []),
  ];
  const approvalSummary = approvalGated
    ? pendingTaskSummary({
        baseReply: oneAi.workflow.assistantReply,
        oneclawTask,
        approvals,
        automationReason: automationPolicy.reasons?.join(' '),
      })
    : null;
  const summary = finalSummary || approvalSummary || oneAi.workflow.assistantReply;
  const workerRuntime = describeWorkerRuntime({
    oneclawTask,
    oneclawRun,
    oneclawError,
    blocked,
    approvalGated,
    canSubmit,
    preflight,
    automationPolicy,
    approvals,
    finalSummary,
    workerResultText,
  });
  const proofRecords = [
    proof({
      title: 'TheOne Chat Runtime handled conversation',
      value: summary,
      metadata: {
        source: 'theone.chat_runtime',
        mission,
        brain,
        workerRuntime,
        modelRoute: primaryModel,
        selectedAppPackages,
        memoryContext: memorySummary(memoryContext),
        workerCatalogSummary: workerCatalog.summary,
        oneAiWorkflow: oneAi.workflow,
        finalOneAiResult,
        finalSummary,
        approvalSummary,
        workerResultText,
        preflight,
        automationPolicy,
        oneclawTask,
        oneclawRun,
      },
    }),
  ];

  const ok = oneAi.oneAiResult.success && !automationPolicy.blocked && !oneclawError;
  const theoneWorkerStatus = blocked
    ? 'blocked'
    : approvalGated
      ? 'approval_gated'
      : automationPolicy.canAutoRun
        ? 'auto_cleared'
        : 'validated';
  const oneclawWorkerStatus = oneclawRun
    ? 'called'
    : blocked
      ? 'blocked'
      : approvalGated
        ? 'approval_gated'
        : automationPolicy.canAutoRun
          ? 'submitting'
          : 'prepared';
  const nextActions = automationPolicy.blocked || preflight.status === 'blocked'
    ? ['Fix the blocked workflow action or input, then ask TheOne to rebuild the workflow.']
      : oneclawError
      ? [`Check OneClaw execution error: ${oneclawError}`]
      : approvalGated
        ? firstTaskAction(oneclawTask) === 'social.post'
          ? ['Review the draft, revise it if needed, then approve the pending X publish task.']
          : ['Review the pending approval before OneClaw executes this worker task.']
        : oneclawTask && !oneclawRun && automationPolicy.canAutoRun
          ? ['The read-only worker task is auto-cleared; wait for OneClaw execution receipt or refresh the run.']
          : finalSummary
            ? ['Use this result, ask a follow-up, or turn it into a report.']
            : oneclawRun
              ? ['Review the OneClaw receipt and ask TheOne to summarize the worker result.']
            : ['Continue the conversation with the next outcome.'];

  return {
    ok,
    runId,
    summary,
    intent,
    plan,
    execution: {
      completedSteps: plan.steps.filter((step) => step.status === 'completed').length,
      failedSteps: plan.steps.filter((step) => step.status === 'failed').length,
      agentResults: [],
    },
    proof: proofRecords,
    approvals,
    executions,
    pendingOneClawTask: oneclawTask && !oneclawRun ? oneclawTask : null,
    preflight,
    os: {
      ...kernel,
      workflow,
      approvals,
      executions,
      oneClawManifest,
      oneClawBridge,
      preflight,
    },
    networkSignals: {
      routedBy: 'theone.chat_runtime',
      mission,
      workerRuntime,
      brainMode: brain.mode,
      conversationKind: brain.conversationKind,
      modelRoute: primaryModel,
      selectedAppPackages: selectedAppPackages.map((pkg) => pkg.key),
      memoryContext: memorySummary(memoryContext),
      workerCatalogSummary: workerCatalog.summary,
      oneAiWorkflowId: oneAi.workflow.workflow.id,
      fallbackRoute: fallbackOneClawTask ? 'github_repo_shorthand' : null,
      oneClawTaskName: oneclawTask?.taskName || null,
      oneClawRunId: oneclawRun?.id || null,
    },
    chat: {
      runtime: 'theone.chat_runtime.v2',
      mission,
      brain,
      workerRuntime,
      modelRoute: primaryModel,
      memoryContext: memorySummary(memoryContext),
      appPackages: selectedAppPackages.length ? selectedAppPackages : appPackages.slice(0, 4),
      workerCatalog: workerCatalog.summary,
      assistant: {
        role: 'assistant',
        content: summary,
        createdAt: new Date().toISOString(),
      },
      oneAiWorkflow: {
        ...oneAi.workflow.workflow,
        summary: workflowSummary,
        source: 'oneai',
        owner: 'OneAI',
        status: ok ? 'validated' : blocked ? 'blocked' : 'needs_approval',
        steps: plannedWorkflowSteps.map((step) => ({
          ...step,
          owner: step.worker,
          status: step.worker === 'oneai' || finalSummary ? 'completed' : oneclawRun ? 'running' : blocked ? 'blocked' : 'pending',
        })),
      },
      workerCoordination: {
        mode,
        requiredWorkers: oneAi.workflow.requiredWorkers,
        workers: [
          {
            key: 'oneai',
            title: 'OneAI',
            role: 'Builds the structured workflow from the conversation.',
            status: oneAi.oneAiResult.success ? 'ready' : 'needs_attention',
          },
          {
            key: 'theone',
            title: 'TheOne Kernel',
            role: 'Validates workflow, policy, preflight, approvals, proof, and memory.',
            status: theoneWorkerStatus,
          },
          ...(oneclawTask ? [{
            key: 'oneclaw',
            title: 'OneClaw',
            role: 'Executes approved worker tasks and returns receipts.',
            status: oneclawWorkerStatus,
          }] : []),
        ],
        oneclawTask,
        oneclawRun,
        fallbackRoute: fallbackOneClawTask ? 'github_repo_shorthand' : null,
        workerResultText,
        finalSummary,
        approvalSummary,
        automationPolicy,
        preflight,
        workerRuntime,
      },
      nextActions,
    },
  };
}
