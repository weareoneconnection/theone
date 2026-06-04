import { extractOneAIData, extractOneAIPlannedOneClawTask, runOneAI } from '../providers/oneai';
import { resolveTheOneModel } from '../models/model-router';
import type { OneAIGenerateResult, OneClawCapabilityDefinition, OneClawTask, TheOneMode } from '../types';
import type { TheOneBrainFrame } from './brain-layer';

export type TheOneChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type OneAIWorkflowStep = {
  id: string;
  title: string;
  worker: string;
  action: string;
  input: Record<string, unknown>;
  approvalMode?: 'auto' | 'manual';
  dependsOn?: string[];
};

export type OneAIWorkflowContract = {
  assistantReply: string;
  intent: {
    objective: string;
    domain: string;
    risk: 'low' | 'medium' | 'high';
    requiresApproval: boolean;
  };
  workflow: {
    id: string;
    summary: string;
    steps: OneAIWorkflowStep[];
  };
  requiredWorkers: string[];
  oneclawTask: OneClawTask | null;
  safety: {
    requiresApproval: boolean;
    reason: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function riskValue(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function stepInput(value: unknown) {
  return isRecord(value) ? value : {};
}

function normalizeStep(value: unknown, index: number): OneAIWorkflowStep | null {
  if (!isRecord(value)) return null;
  const action = textValue(value.action);
  if (!action) return null;

  return {
    id: textValue(value.id, `step_${index + 1}`),
    title: textValue(value.title, action),
    worker: textValue(value.worker, action.startsWith('oneai') ? 'oneai' : 'oneclaw'),
    action,
    input: stepInput(value.input),
    approvalMode: value.approvalMode === 'manual' || value.approvalMode === 'auto' ? value.approvalMode : undefined,
    dependsOn: Array.isArray(value.dependsOn) ? value.dependsOn.map((item) => textValue(item)).filter(Boolean) : [],
  };
}

function taskFromWorkflow(workflow: OneAIWorkflowContract): OneClawTask | null {
  const steps = workflow.workflow.steps
    .filter((step) => step.worker !== 'oneai' && step.action !== 'oneai.generate')
    .map((step) => ({
      id: step.id,
      action: step.action,
      input: step.input,
      dependsOn: step.dependsOn || [],
    }));

  if (!steps.length) return null;

  return {
    taskName: `chat_${workflow.intent.domain || 'workflow'}_${Date.now()}`,
    approvalMode: workflow.safety.requiresApproval ? 'manual' : 'auto',
    steps,
    metadata: {
      source: 'theone.chat_runtime',
      oneAiWorkflow: workflow.workflow,
      intent: workflow.intent,
      safety: workflow.safety,
    },
  };
}

function normalizeWorkflow(data: unknown, raw: string): OneAIWorkflowContract {
  const record = isRecord(data) ? data : {};
  const intent = isRecord(record.intent) ? record.intent : {};
  const workflow = isRecord(record.workflow) ? record.workflow : {};
  const rawSteps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const steps = rawSteps.map(normalizeStep).filter((step): step is OneAIWorkflowStep => Boolean(step));
  const oneclawTask = extractOneAIPlannedOneClawTask(record) || (isRecord(record.oneclawTask) ? record.oneclawTask as OneClawTask : null);

  return {
    assistantReply: textValue(record.assistantReply, textValue(record.reply, 'I prepared a governed workflow for TheOne to validate.')),
    intent: {
      objective: textValue(intent.objective, raw),
      domain: textValue(intent.domain, textValue(record.domain, 'general')),
      risk: riskValue(intent.risk),
      requiresApproval: Boolean(intent.requiresApproval),
    },
    workflow: {
      id: textValue(workflow.id, `oneai_workflow_${Date.now()}`),
      summary: textValue(workflow.summary, textValue(record.summary, `Workflow prepared for: ${raw}`)),
      steps,
    },
    requiredWorkers: Array.isArray(record.requiredWorkers)
      ? record.requiredWorkers.map((item) => textValue(item)).filter(Boolean)
      : Array.from(new Set(steps.map((step) => step.worker))),
    oneclawTask: oneclawTask || null,
    safety: isRecord(record.safety)
      ? {
          requiresApproval: Boolean(record.safety.requiresApproval),
          reason: textValue(record.safety.reason, 'TheOne policy will decide whether approval is required.'),
        }
      : {
          requiresApproval: Boolean(intent.requiresApproval),
          reason: 'TheOne policy will decide whether approval is required.',
        },
  };
}

function fallbackWorkflow(raw: string, mode: TheOneMode): OneAIWorkflowContract {
  return {
    assistantReply: 'OneAI did not return a complete executable workflow, so TheOne kept this as a safe planning conversation.',
    intent: {
      objective: raw,
      domain: 'general',
      risk: mode === 'auto' ? 'medium' : 'low',
      requiresApproval: mode !== 'auto',
    },
    workflow: {
      id: `oneai_workflow_fallback_${Date.now()}`,
      summary: `Safe planning fallback for: ${raw}`,
      steps: [
        {
          id: 'step_1',
          title: 'Clarify objective and prepare workflow',
          worker: 'oneai',
          action: 'oneai.generate',
          input: { objective: raw },
          approvalMode: 'auto',
        },
      ],
    },
    requiredWorkers: ['oneai', 'theone'],
    oneclawTask: null,
    safety: {
      requiresApproval: false,
      reason: 'No external action was produced.',
    },
  };
}

export async function buildOneAIChatWorkflow(input: {
  raw: string;
  mode: TheOneMode;
  messages: TheOneChatMessage[];
  capabilities: OneClawCapabilityDefinition[];
  workerCatalog?: unknown;
  appPackages?: unknown;
  brain?: TheOneBrainFrame;
}): Promise<{
  workflow: OneAIWorkflowContract;
  oneAiResult: OneAIGenerateResult<unknown>;
  oneclawTask: OneClawTask | null;
}> {
  const availableActions = input.capabilities.slice(0, 120).map((capability) => ({
    action: capability.action,
    risk: capability.risk,
    approvalRequired: capability.approvalRequired,
    inputRequired: capability.inputRequired,
    liveMode: capability.liveMode,
    maturity: capability.maturity,
  }));
  const modelRoute = resolveTheOneModel('theone.chat.primary');

  const oneAiResult = await runOneAI<unknown>({
    type: 'theone_chat_workflow',
    input: {
      source: 'theone.chat_runtime',
      message: input.raw,
      mode: input.mode,
      conversation: input.messages.slice(-12),
      availableActions,
      modelRoute,
      workerCatalog: input.workerCatalog || null,
      appPackages: input.appPackages || null,
      brain: input.brain || null,
      responseContract: {
        assistantReply: 'string',
        intent: {
          objective: 'string',
          domain: 'string',
          risk: 'low|medium|high',
          requiresApproval: 'boolean',
        },
        workflow: {
          id: 'string',
          summary: 'string',
          steps: [
            {
              id: 'string',
              title: 'string',
              worker: 'oneai|oneclaw|browser_worker|github_worker|x_worker|desktop_worker|file_worker|report_worker',
              action: 'must be one of the available OneClaw actions or oneai.generate',
              input: 'object matching action requirements',
              approvalMode: 'auto|manual',
              dependsOn: 'string[]',
            },
          ],
        },
        requiredWorkers: 'string[]',
        oneclawTask: 'OneClaw task object or null',
        safety: {
          requiresApproval: 'boolean',
          reason: 'string',
        },
      },
      instruction: [
        input.brain?.systemPrompt || '',
        input.brain ? `Brain objective: ${input.brain.objective}` : '',
        input.brain ? `Brain mode: ${input.brain.mode}` : '',
        input.brain ? `Brain selected apps: ${input.brain.selectedApps.map((app) => app.key).join(', ')}` : '',
        input.brain ? `Brain execution decision: ${JSON.stringify(input.brain.executionDecision)}` : '',
        `Use model route ${modelRoute.useCase} with preferred model alias ${modelRoute.model}.`,
        'Act like a Codex-grade super-agent conversation planner for TheOne AI OS.',
        'The user should not need to know which App or Worker to call; infer the best App package and Worker actions from context.',
        'Use appPackages to choose the user-facing capability package and workerCatalog to choose executable actions.',
        'If brain.conversationKind is capability, do not create an external worker task; answer capability-level guidance.',
        'If brain.reasoning.missingInformation is not empty, ask only for the missing detail and do not invent inputs.',
        'Return structured JSON only.',
        'Do not invent worker actions that are absent from availableActions.',
        'Use oneai.generate for reasoning-only steps.',
        'Use OneClaw task steps only for real external actions.',
        'Prefer safe read-only actions when possible.',
        'High-risk write, publish, desktop, payment, transaction, and delete actions must be approval gated.',
      ].join('\n'),
    },
    options: {
      responseFormat: 'json',
      chain: 'theone_chat_workflow',
      model: modelRoute.model,
      modelRoute,
    },
  });

  const data = extractOneAIData(oneAiResult);
  const workflow = oneAiResult.success ? normalizeWorkflow(data, input.raw) : fallbackWorkflow(input.raw, input.mode);
  const oneclawTask = workflow.oneclawTask || taskFromWorkflow(workflow);

  return {
    workflow: {
      ...workflow,
      oneclawTask,
    },
    oneAiResult,
    oneclawTask,
  };
}
