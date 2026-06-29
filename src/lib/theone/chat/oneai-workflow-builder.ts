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
  oneAiBrain?: {
    role: string;
    understanding: string;
    selectedApp: string;
    workerRoute: string[];
    confidence: number;
    responseStyle: string;
    executionBoundary: string;
    reasoningSummary: string;
  };
  completionContract?: {
    status: 'answered' | 'workflow_ready' | 'needs_approval' | 'needs_source' | 'blocked' | 'failed';
    finalAnswerReady: boolean;
    needsWorker: boolean;
    needsApproval: boolean;
    evidenceRequired: boolean;
    nextAction: string;
    reason: string;
  };
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

type OneAICompletionStatus = NonNullable<OneAIWorkflowContract['completionContract']>['status'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function detectResponseLanguage(text: string) {
  const source = text || '';
  const chinese = (source.match(/[\u3400-\u9fff]/g) || []).length;
  const japanese = (source.match(/[\u3040-\u30ff]/g) || []).length;
  const korean = (source.match(/[\uac00-\ud7af]/g) || []).length;
  const arabic = (source.match(/[\u0600-\u06ff]/g) || []).length;
  const cyrillic = (source.match(/[\u0400-\u04ff]/g) || []).length;
  const thai = (source.match(/[\u0e00-\u0e7f]/g) || []).length;

  if (chinese >= 2) return 'zh-CN';
  if (japanese >= 2) return 'ja';
  if (korean >= 2) return 'ko';
  if (arabic >= 2) return 'ar';
  if (cyrillic >= 2) return 'ru';
  if (thai >= 2) return 'th';
  return 'en';
}

function normalizeResponseLanguage(input: {
  language?: string;
  raw: string;
  messages: TheOneChatMessage[];
}) {
  const requested = textValue(input.language).toLowerCase();
  if (requested && requested !== 'auto' && requested !== 'same_as_user') return input.language!.trim();

  const recentUserText = input.messages
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) => message.content)
    .join('\n');
  return detectResponseLanguage([input.raw, recentUserText].filter(Boolean).join('\n'));
}

function languageContract(responseLanguage: string) {
  return {
    responseLanguage,
    userFacingFields: [
      'assistantReply',
      'oneAiBrain.understanding',
      'oneAiBrain.reasoningSummary',
      'oneAiBrain.stagePlan[].goal',
      'oneAiBrain.strategy.*',
      'oneAiBrain.executionStrategy.*',
      'workflow.summary',
      'workflow.steps[].title',
      'safety.reason',
      'completionContract.nextAction',
      'completionContract.reason',
    ],
    invariantFields: [
      'JSON keys',
      'worker/action names',
      'URLs',
      'repository names',
      'file names',
      'code identifiers',
    ],
    rule: 'Write every natural-language value in responseLanguage. Keep technical identifiers in their original language.',
  };
}

function riskValue(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function completionStatusValue(value: unknown): OneAICompletionStatus {
  if (
    value === 'answered' ||
    value === 'workflow_ready' ||
    value === 'needs_approval' ||
    value === 'needs_source' ||
    value === 'blocked' ||
    value === 'failed'
  ) {
    return value;
  }
  return 'workflow_ready';
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
  const oneAiBrain = isRecord(record.oneAiBrain) ? record.oneAiBrain : {};
  const intent = isRecord(record.intent) ? record.intent : {};
  const workflow = isRecord(record.workflow) ? record.workflow : {};
  const rawSteps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const steps = rawSteps.map(normalizeStep).filter((step): step is OneAIWorkflowStep => Boolean(step));
  const oneclawTask = extractOneAIPlannedOneClawTask(record) || (isRecord(record.oneclawTask) ? record.oneclawTask as OneClawTask : null);

  return {
    assistantReply: textValue(record.assistantReply, textValue(record.reply, 'I prepared a governed workflow for TheOne to validate.')),
    oneAiBrain: isRecord(record.oneAiBrain) ? {
      role: textValue(oneAiBrain.role, 'OneAI planning brain'),
      understanding: textValue(oneAiBrain.understanding, textValue(intent.objective, raw)),
      selectedApp: textValue(oneAiBrain.selectedApp, textValue(intent.domain, 'general')),
      workerRoute: Array.isArray(oneAiBrain.workerRoute)
        ? oneAiBrain.workerRoute.map((item) => textValue(item)).filter(Boolean)
        : [],
      confidence: typeof oneAiBrain.confidence === 'number' ? oneAiBrain.confidence : 0.7,
      responseStyle: textValue(oneAiBrain.responseStyle, 'direct, useful, Codex-like'),
      executionBoundary: textValue(oneAiBrain.executionBoundary, 'TheOne validates policy before execution.'),
      reasoningSummary: textValue(oneAiBrain.reasoningSummary, textValue(workflow.summary, 'Structured workflow candidate prepared.')),
    } : undefined,
    completionContract: isRecord(record.completionContract) ? {
      status: completionStatusValue(record.completionContract.status),
      finalAnswerReady: Boolean(record.completionContract.finalAnswerReady),
      needsWorker: Boolean(record.completionContract.needsWorker),
      needsApproval: Boolean(record.completionContract.needsApproval),
      evidenceRequired: record.completionContract.evidenceRequired === undefined ? true : Boolean(record.completionContract.evidenceRequired),
      nextAction: textValue(record.completionContract.nextAction, 'Let TheOne validate and continue the route.'),
      reason: textValue(record.completionContract.reason, textValue(workflow.summary, 'Workflow candidate prepared.')),
    } : undefined,
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
    oneAiBrain: {
      role: 'OneAI planning brain fallback',
      understanding: raw,
      selectedApp: 'general',
      workerRoute: ['oneai.generate'],
      confidence: 0.35,
      responseStyle: 'safe fallback',
      executionBoundary: 'No external action was produced.',
      reasoningSummary: 'Fallback planning kept the conversation safe.',
    },
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
    completionContract: {
      status: 'answered',
      finalAnswerReady: true,
      needsWorker: false,
      needsApproval: false,
      evidenceRequired: false,
      nextAction: 'Continue the conversation with a concrete outcome.',
      reason: 'No external action was produced.',
    },
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
  language?: string;
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
  const responseLanguage = normalizeResponseLanguage({
    language: input.language,
    raw: input.raw,
    messages: input.messages,
  });
  const language = languageContract(responseLanguage);

  const oneAiResult = await runOneAI<unknown>({
    type: 'theone_chat_workflow',
    input: {
      source: 'theone.chat_runtime',
      message: input.raw,
      mode: input.mode,
      language: responseLanguage,
      responseLanguage,
      languageContract: language,
      conversation: input.messages.slice(-12),
      availableActions,
      modelRoute,
      workerCatalog: input.workerCatalog || null,
      appPackages: input.appPackages || null,
      brain: input.brain || null,
      responseContract: {
        languageContract: language,
        assistantReply: 'string',
        oneAiBrain: {
          role: 'string: OneAI planning brain role in this turn',
          understanding: 'string: what the user wants, using given context',
          selectedApp: 'string: best TheOne app/capability package',
          workerRoute: 'string[]: candidate workers or actions in order',
          confidence: 'number 0..1',
          responseStyle: 'string: how the final answer should feel',
          executionBoundary: 'string: what OneAI is not allowed to execute by itself',
          reasoningSummary: 'string: concise, user-safe planning rationale',
        },
        completionContract: {
          status: 'answered|workflow_ready|needs_approval|needs_source|blocked|failed',
          finalAnswerReady: 'boolean: true only when the user has a usable answer now',
          needsWorker: 'boolean: true when TheOne should call OneClaw or another worker',
          needsApproval: 'boolean: true when a human approval gate is required before execution',
          evidenceRequired: 'boolean: true when a receipt, extracted source, or proof should be attached',
          nextAction: 'string: one plain next move, not internal machinery',
          reason: 'string: concise reason for this status',
        },
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
        input.brain ? `Brain context readiness: ${JSON.stringify(input.brain.contextReadiness)}` : '',
        input.brain ? `OneAI planning brain contract: ${JSON.stringify(input.brain.oneAiBrain)}` : '',
        `Use model route ${modelRoute.useCase} with preferred model alias ${modelRoute.model}.`,
        `Response language: ${responseLanguage}.`,
        `Language contract: ${JSON.stringify(language)}.`,
        'All user-facing natural-language fields must be written in the response language. Keep JSON keys, action names, URLs, repo names, file names, and code identifiers unchanged.',
        'If the user mixes languages, mirror the dominant language of the latest user message. Do not default to English when the user writes Chinese or another language.',
        'Act as the OneAI Planning Brain inside TheOne AI OS. You are an LLM-native brain for understanding, planning, and natural conversation.',
        'TheOne Control Brain owns final authority: policy, approval, worker dispatch, proof, memory, and safety. OneAI must not override it.',
        'Your answer should feel like ChatGPT/Codex: direct, helpful, context-aware, and outcome-focused. Do not narrate internal machinery unless the user asks.',
        'Every turn must have a completionContract. TheOne uses it as an execution closure contract.',
        'Do not return placeholder answers like "please hold while I gather data" as a final assistantReply. Either answer directly, return an executable workflow, ask for one missing source, or state why it is blocked.',
        'finalAnswerReady=true only when assistantReply itself satisfies the user outcome. If a worker still must run, set needsWorker=true and finalAnswerReady=false.',
        'Always return oneAiBrain so TheOne can display or audit how OneAI understood the request.',
        'The user should not need to know which App or Worker to call; infer the best App package and Worker actions from context.',
        'Use appPackages to choose the user-facing capability package and workerCatalog to choose executable actions.',
        'If a URL, repository, API endpoint, attachment, or stored path is already visible in Brain context readiness or conversation context, use it. Do not ask the user for the same detail again.',
        'When the conversation includes attached file context, treat that attachment as the source document. If readable content is present, answer, summarize, or draft the requested report directly from that content and do not ask for a path.',
        'When attachment upload failed or readable content is absent, set completionContract.status=needs_source and ask for re-upload or a durable source. Do not invent a file path.',
        'If an attachment has a stored path but no readable content, create a file.read, document.parse, spreadsheet.read, image.extractText, or image.analyze task only when that exact action is available and appropriate.',
        'For document/report requests, prefer oneai.generate after the file content is available; return a clear report with key points, risks, action items, and evidence when the user asks for a report.',
        'For X/Twitter posts, generate publication-ready content under 260 characters unless the user explicitly asks for a thread.',
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
