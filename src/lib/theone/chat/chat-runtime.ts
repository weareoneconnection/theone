import { attachAutomationPolicyToTask, evaluateAutomationPolicy } from '../policy/automation-engine';
import { evaluateOneClawTaskPolicy } from '../policy/approval-policy';
import { preflightOneClawTask } from '../execution/preflight';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace, markApprovalBlockedSteps } from '../runtime/workflow-runtime';
import { getTheOneKernelStatus } from '../kernel/status';
import { extractOneAIData, runOneAI } from '../providers/oneai';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest, runOneClawTask } from '../providers/oneclaw';
import { listAppRuntimePackages, selectAppRuntimePackages } from '../apps/runtime-packages';
import { resolveTheOneModel } from '../models/model-router';
import { buildUniversalWorkerCatalog } from '../workers/action-catalog';
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
  const appPackages = listAppRuntimePackages();
  const selectedAppPackages = selectAppRuntimePackages(raw).slice(0, 3);
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

  if (!brain.executionDecision.shouldPlan || brain.reasoning.missingInformation.length > 0) {
    let brainOnlyOneAi: Awaited<ReturnType<typeof buildOneAIChatWorkflow>> | null = null;
    let summary = buildBrainOnlyReply({ brain, appPackages });

    try {
      brainOnlyOneAi = await buildOneAIChatWorkflow({
        raw,
        mode,
        messages,
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
    const proofRecords = [
      proof({
        title: 'TheOne Brain handled conversation',
        value: summary,
        metadata: {
          source: 'theone.brain_layer',
          brain,
          modelRoute: primaryModel,
          selectedAppPackages,
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
        modelRoute: primaryModel,
        selectedAppPackages: selectedAppPackages.map((pkg) => pkg.key),
        workerCatalogSummary: workerCatalog.summary,
        brainMode: brain.mode,
        conversationKind: brain.conversationKind,
      },
      chat: {
        runtime: 'theone.chat_runtime.v2',
          brain,
          oneAiBrainReply: brainOnlyOneAi?.workflow || null,
          modelRoute: primaryModel,
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
        },
        nextActions: brain.nextMoves,
      },
    };
  }

  const oneAi = await buildOneAIChatWorkflow({
    raw,
    mode,
    messages,
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
  const proofRecords = [
    proof({
      title: 'TheOne Chat Runtime handled conversation',
      value: summary,
      metadata: {
        source: 'theone.chat_runtime',
        brain,
        modelRoute: primaryModel,
        selectedAppPackages,
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
      brainMode: brain.mode,
      conversationKind: brain.conversationKind,
      modelRoute: primaryModel,
      selectedAppPackages: selectedAppPackages.map((pkg) => pkg.key),
      workerCatalogSummary: workerCatalog.summary,
      oneAiWorkflowId: oneAi.workflow.workflow.id,
      fallbackRoute: fallbackOneClawTask ? 'github_repo_shorthand' : null,
      oneClawTaskName: oneclawTask?.taskName || null,
      oneClawRunId: oneclawRun?.id || null,
    },
    chat: {
      runtime: 'theone.chat_runtime.v2',
      brain,
      modelRoute: primaryModel,
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
      },
      nextActions,
    },
  };
}
