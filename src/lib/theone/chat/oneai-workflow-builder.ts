import { extractOneAIData, extractOneAIPlannedOneClawTask, runOneAI } from '../providers/oneai';
import { resolveTheOneModel } from '../models/model-router';
import type { OneAIGenerateResult, OneClawCapabilityDefinition, OneClawTask, TheOneMode } from '../types';
import type { AppRuntimePackage } from '../apps/runtime-packages';
import type { buildUniversalWorkerCatalog } from '../workers/action-catalog';
import type { TheOneBrainFrame } from './brain-layer';

type UniversalWorkerCatalog = ReturnType<typeof buildUniversalWorkerCatalog>;

export type TheOneChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

const MAX_ONEAI_ACTIONS = 48;
const MAX_ONEAI_CONVERSATION_CHARS = 16_000;

function compactText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 28))}\n...[context truncated]`;
}

function compactConversation(messages: TheOneChatMessage[]) {
  let remaining = MAX_ONEAI_CONVERSATION_CHARS;
  const compacted: TheOneChatMessage[] = [];

  for (const message of messages.slice(-10).reverse()) {
    if (remaining <= 0) break;
    const content = compactText(message.content, Math.min(3_200, remaining));
    if (!content) continue;
    compacted.push({ role: message.role, content });
    remaining -= content.length;
  }

  return compacted.reverse();
}

function selectedWorkerActions(brain: TheOneBrainFrame | null | undefined) {
  return new Set(
    (brain?.selectedApps || []).flatMap((app) =>
      Array.isArray(app.workerActions) ? app.workerActions : [],
    ),
  );
}

function actionRelevanceScore(
  capability: OneClawCapabilityDefinition,
  raw: string,
  brain: TheOneBrainFrame | null | undefined,
) {
  const normalized = raw.toLowerCase();
  const action = capability.action.toLowerCase();
  const domain = String(capability.domain || action.split('.')[0] || '').toLowerCase();
  const preferredActions = selectedWorkerActions(brain);
  let score = preferredActions.has(capability.action) ? 100 : 0;

  const keywordDomains: Array<[RegExp, string[]]> = [
    [/code|coding|program|编程|代码|开发|debug|bug|repo|repository/, ['code', 'git', 'shell', 'file']],
    [/website|browser|web|网页|网站|浏览/, ['browser', 'web', 'search']],
    [/twitter|tweet|\bx\b|推文|发帖/, ['x', 'social']],
    [/document|pdf|word|文件|文档|报告/, ['document', 'file', 'storage']],
    [/spreadsheet|excel|csv|表格/, ['spreadsheet', 'file']],
    [/desktop|computer|电脑|桌面/, ['desktop']],
    [/api|webhook|接口/, ['api']],
  ];

  for (const [pattern, domains] of keywordDomains) {
    if (pattern.test(normalized) && domains.some((item) => domain.includes(item) || action.startsWith(`${item}.`))) {
      score += 60;
    }
  }

  if (brain?.capabilityRoute?.some((item) => action.includes(String(item).toLowerCase()))) score += 30;
  if (capability.liveMode === 'live') score += 8;
  if (capability.maturity === 'production') score += 6;
  if (!capability.approvalRequired) score += 2;
  return score;
}

function compactWorkerCatalog(catalog: UniversalWorkerCatalog | null | undefined, actionNames: Set<string>) {
  if (!catalog) return null;
  return {
    summary: catalog.summary,
    workers: catalog.workers
      .map((worker) => ({
        key: worker.key,
        domain: worker.domain,
        connectorKey: worker.connectorKey,
        actionCount: worker.actions.length,
        actions: worker.actions
          .filter((action) => actionNames.has(action))
          .slice(0, 8),
      }))
      .filter((worker) => worker.actions.length > 0)
      .slice(0, 16),
  };
}

function compactAppPackages(
  packages: AppRuntimePackage[] | null | undefined,
  brain: TheOneBrainFrame | null | undefined,
) {
  if (!packages?.length) return null;
  const selectedKeys = new Set((brain?.selectedApps || []).map((app) => app.key));
  const selected = packages.filter((item) => selectedKeys.has(item.key));
  const source = selected.length ? selected : packages;
  return source.slice(0, 8).map((item) => ({
    key: item.key,
    title: item.title,
    stage: item.stage,
    purpose: compactText(item.purpose, 420),
    workerActions: item.workerActions.slice(0, 12),
    policy: item.policy,
  }));
}

function compactBrain(brain: TheOneBrainFrame | null | undefined) {
  if (!brain) return null;
  return {
    objective: compactText(brain.objective, 1_200),
    mode: brain.mode,
    conversationKind: brain.conversationKind,
    contextReadiness: brain.contextReadiness,
    selectedApps: brain.selectedApps.slice(0, 6).map((app) => ({
      key: app.key,
      title: app.title,
      workerActions: app.workerActions.slice(0, 12),
    })),
    capabilityRoute: brain.capabilityRoute.slice(0, 16),
    reasoning: brain.reasoning,
    executionDecision: brain.executionDecision,
    safety: brain.safety,
    nextMoves: brain.nextMoves.slice(0, 6),
    workerCapabilityMap: brain.workerCapabilityMap.slice(0, 24).map((item) => ({
      domain: item.domain,
      status: item.status,
      liveActions: item.liveActions,
      preparedActions: item.preparedActions,
      approvalGatedActions: item.approvalGatedActions,
      blockedActions: item.blockedActions,
      actions: item.actions.slice(0, 6),
    })),
  };
}

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
    resultQuality: 'draft' | 'usable' | 'needs_evidence' | 'blocked';
  };
  runtimeStrategy?: {
    selectedStage: 'understand' | 'select_app' | 'plan_workers' | 'check_policy' | 'execute_or_answer' | 'close_loop';
    evidencePlan: string;
    closurePlan: string;
    fallbackPlan: string;
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

function resultQualityValue(value: unknown): NonNullable<OneAIWorkflowContract['completionContract']>['resultQuality'] {
  if (value === 'draft' || value === 'usable' || value === 'needs_evidence' || value === 'blocked') return value;
  return 'needs_evidence';
}

function runtimeStageValue(value: unknown): NonNullable<OneAIWorkflowContract['runtimeStrategy']>['selectedStage'] {
  if (
    value === 'understand' ||
    value === 'select_app' ||
    value === 'plan_workers' ||
    value === 'check_policy' ||
    value === 'execute_or_answer' ||
    value === 'close_loop'
  ) {
    return value;
  }
  return 'understand';
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
      oneAiBrain: workflow.oneAiBrain || null,
      completionContract: workflow.completionContract || null,
      runtimeStrategy: workflow.runtimeStrategy || null,
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
      resultQuality: resultQualityValue(record.completionContract.resultQuality),
    } : undefined,
    runtimeStrategy: isRecord(record.runtimeStrategy) ? {
      selectedStage: runtimeStageValue(record.runtimeStrategy.selectedStage),
      evidencePlan: textValue(record.runtimeStrategy.evidencePlan, 'Use available worker receipts or conversation context as evidence.'),
      closurePlan: textValue(record.runtimeStrategy.closurePlan, 'Close only when the user has a usable answer or a clear approval/source request.'),
      fallbackPlan: textValue(record.runtimeStrategy.fallbackPlan, 'Ask for the missing source or choose a safer worker route.'),
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
      resultQuality: 'usable',
    },
    runtimeStrategy: {
      selectedStage: 'execute_or_answer',
      evidencePlan: 'No external evidence is required for this fallback answer.',
      closurePlan: 'Close the turn with a direct safe answer.',
      fallbackPlan: 'Ask the user for a more concrete outcome.',
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
  workerCatalog?: UniversalWorkerCatalog;
  appPackages?: AppRuntimePackage[];
  brain?: TheOneBrainFrame;
  language?: string;
  direct?: boolean;
}): Promise<{
  workflow: OneAIWorkflowContract;
  oneAiResult: OneAIGenerateResult<unknown>;
  oneclawTask: OneClawTask | null;
}> {
  const rankedCapabilities = [...input.capabilities]
    .sort((left, right) =>
      actionRelevanceScore(right, input.raw, input.brain) - actionRelevanceScore(left, input.raw, input.brain),
    )
    .slice(0, input.brain?.conversationKind === 'capability' ? 32 : MAX_ONEAI_ACTIONS);
  const availableActions = rankedCapabilities.map((capability) => ({
    action: capability.action,
    domain: capability.domain,
    connectorKey: capability.connectorKey,
    risk: capability.risk,
    approvalRequired: capability.approvalRequired,
    inputRequired: capability.inputRequired,
    liveMode: capability.liveMode,
    maturity: capability.maturity,
  }));
  const actionNames = new Set(availableActions.map((capability) => capability.action));
  const workerDomains = Array.from(
    input.capabilities.reduce((domains, capability) => {
      domains.add(capability.domain);
      return domains;
    }, new Set<string>())
  ).sort();
  const modelRoute = resolveTheOneModel('theone.chat.primary');
  const responseLanguage = normalizeResponseLanguage({
    language: input.language,
    raw: input.raw,
    messages: input.messages,
  });
  const language = languageContract(responseLanguage);
  const compactedBrain = compactBrain(input.brain);
  const compactedWorkerCatalog = compactWorkerCatalog(input.workerCatalog, actionNames);
  const compactedAppPackages = compactAppPackages(input.appPackages, input.brain);

  if (input.direct) {
    const oneAiResult = await runOneAI<unknown>({
      type: 'theone_chat_direct',
      input: {
        message: input.raw,
        responseLanguage,
        conversation: compactConversation(input.messages).slice(-6),
        capabilityContext: {
          role: 'TheOne AI OS',
          abilities: [
            'converse and reason',
            'plan and program',
            'analyze websites and files',
            'coordinate connected OneClaw workers',
            'request approval and return proof for external actions',
          ],
          executionBoundary: 'This direct route answers only and does not execute workers.',
        },
      },
      options: {
        responseFormat: 'json',
        chain: 'theone_chat_direct',
        model: modelRoute.model,
        modelRoute,
      },
    });

    const data = extractOneAIData(oneAiResult);
    const normalized = oneAiResult.success
      ? normalizeWorkflow(data, input.raw)
      : fallbackWorkflow(input.raw, input.mode);
    const workflow: OneAIWorkflowContract = {
      ...normalized,
      workflow: {
        ...normalized.workflow,
        steps: [],
      },
      requiredWorkers: [],
      oneclawTask: null,
      completionContract: {
        status: 'answered',
        finalAnswerReady: true,
        needsWorker: false,
        needsApproval: false,
        evidenceRequired: false,
        nextAction: normalized.completionContract?.nextAction || 'Continue the conversation or give TheOne a concrete outcome.',
        reason: normalized.completionContract?.reason || 'The request was answered directly.',
        resultQuality: 'usable',
      },
      safety: {
        requiresApproval: false,
        reason: normalized.safety.reason || 'No external action was requested.',
      },
    };

    return {
      workflow,
      oneAiResult,
      oneclawTask: null,
    };
  }

  const oneAiResult = await runOneAI<unknown>({
    type: 'theone_chat_workflow',
    input: {
      source: 'theone.chat_runtime',
      message: input.raw,
      mode: input.mode,
      language: responseLanguage,
      responseLanguage,
      languageContract: language,
      conversation: compactConversation(input.messages),
      availableActions,
      actionCount: input.capabilities.length,
      workerDomains,
	      modelRoute,
	      brainVersion: 'oneai.brain.v2',
	      executionStrategy: {
	        stages: ['understand', 'select_app', 'plan_workers', 'check_policy', 'execute_or_answer', 'close_loop'],
	        closureRequired: true,
	        preferDirectAnswerWhenEvidenceReady: true,
	        preferWorkerWhenExternalEvidenceMissing: true,
	      },
	      workerCatalog: compactedWorkerCatalog,
	      appPackages: compactedAppPackages,
	      brain: compactedBrain,
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
	          resultQuality: 'draft|usable|needs_evidence|blocked',
	        },
	        runtimeStrategy: {
	          selectedStage: 'understand|select_app|plan_workers|check_policy|execute_or_answer|close_loop',
	          evidencePlan: 'string: what evidence is required and where it should come from',
	          closurePlan: 'string: how TheOne should know the job is finished',
	          fallbackPlan: 'string: what to do if the preferred worker cannot run',
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
              worker:
                'string: oneai, theone, oneclaw, or a concrete worker key/domain from workerCatalog, such as browser_worker, document_worker, spreadsheet_worker, code_worker, github_worker, x_worker, desktop_worker, api_worker, database_worker, email_worker, calendar_worker, knowledge_worker, image_worker, audio_worker, video_worker, geo_worker, construction_worker, finance_worker, legal_worker, device_worker, iot_worker, robot_worker, payment_worker, commerce_worker',
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
        input.brain ? compactText(input.brain.systemPrompt, 5_000) : '',
        input.brain ? `Brain objective: ${compactText(input.brain.objective, 1_200)}` : '',
        input.brain ? `Brain mode: ${input.brain.mode}` : '',
        input.brain ? `Brain selected apps: ${input.brain.selectedApps.map((app) => app.key).join(', ')}` : '',
        input.brain ? `Brain execution decision: ${JSON.stringify(input.brain.executionDecision)}` : '',
        input.brain ? `Brain context readiness: ${JSON.stringify(input.brain.contextReadiness)}` : '',
        `Use model route ${modelRoute.useCase} with preferred model alias ${modelRoute.model}.`,
        `Response language: ${responseLanguage}.`,
        `Language contract: ${JSON.stringify(language)}.`,
        'All user-facing natural-language fields must be written in the response language. Keep JSON keys, action names, URLs, repo names, file names, and code identifiers unchanged.',
        'If the user mixes languages, mirror the dominant language of the latest user message. Do not default to English when the user writes Chinese or another language.',
	        'Act as the OneAI Planning Brain inside TheOne AI OS. You are an LLM-native brain for understanding, planning, and natural conversation.',
	        'Use OneAI Brain v2 strategy: understand the outcome, choose the user-facing app, choose worker evidence, plan the minimum safe route, then define how TheOne should close the loop.',
	        'TheOne Control Brain owns final authority: policy, approval, worker dispatch, proof, memory, and safety. OneAI must not override it.',
	        'Your answer should feel like ChatGPT/Codex: direct, helpful, context-aware, and outcome-focused. Do not narrate internal machinery unless the user asks.',
        'Do not limit TheOne to demo examples. Use the full worker/action catalog provided in availableActions and workerDomains.',
        'The workflow.steps[].worker field may name any suitable worker domain from the catalog: document, spreadsheet, database, email, calendar, knowledge, image, audio, video, geo, construction, finance, legal, commerce, payment, device, IoT, robot, desktop, browser, GitHub, X, API, files, storage, identity, permissions, or secrets.',
        'If a requested capability is visible but not live or needs setup, explain the connection gap and give the next setup step instead of pretending it executed.',
	        'Every turn must have a completionContract. TheOne uses it as an execution closure contract.',
	        'Every execution workflow must also include runtimeStrategy. The strategy should be useful to TheOne but short enough to audit.',
	        'Do not return placeholder answers like "please hold while I gather data" as a final assistantReply. Either answer directly, return an executable workflow, ask for one missing source, or state why it is blocked.',
	        'finalAnswerReady=true only when assistantReply itself satisfies the user outcome. If a worker still must run, set needsWorker=true and finalAnswerReady=false.',
	        'If worker evidence is already present in the conversation, produce the final answer from that evidence instead of building another worker route.',
	        'If a worker task is required, assistantReply should briefly say what was prepared and what the user should expect next; it must not claim the final outcome is complete.',
	        'Always return oneAiBrain so TheOne can display or audit how OneAI understood the request.',
        'The user should not need to know which App or Worker to call; infer the best App package and Worker actions from context.',
        'Use appPackages to choose the user-facing capability package and workerCatalog to choose executable actions.',
        'If a URL, repository, API endpoint, attachment, or stored path is already visible in Brain context readiness or conversation context, use it. Do not ask the user for the same detail again.',
        'When the conversation includes attached file context, treat that attachment as the source document. If readable content is present, answer, summarize, or draft the requested report directly from that content and do not ask for a path.',
        'When attachment upload failed or readable content is absent, set completionContract.status=needs_source and ask for re-upload or a durable source. Do not invent a file path.',
        'If an attachment has a stored path but no readable content, create a file.read, document.parse, spreadsheet.read, image.extractText, or image.analyze task only when that exact action is available and appropriate.',
        'For document/report requests, prefer oneai.generate after the file content is available; return a clear report with key points, risks, action items, and evidence when the user asks for a report.',
        'For X/Twitter posts, generate publication-ready content under 260 characters unless the user explicitly asks for a thread.',
	        'For code or programming requests, distinguish between generating an example and changing a real repository. A source-only example may be answered directly without a workspace or OneClaw task. A repository mutation must use code_worker and only actions present in availableActions.',
	        'When answering a source-only programming request directly, return complete, runnable source files in fenced Markdown code blocks with accurate language labels. Include concise dependency and run instructions, but do not claim the code was executed or tested without worker receipts.',
	        'Preserve source-code identifiers exactly. Never apply Markdown emphasis inside fenced code. For Python, the module entry guard must be exactly: if __name__ == "__main__":',
	        'Generated code must be syntactically complete, internally consistent, and use current stable library APIs represented in the request context. Never silently omit imports, entry points, required environment variables, or error handling needed by the example.',
	        'If the conversation context contains a Persistent code mission, continue that exact mission instead of creating a new coding task. Reuse its mission id, workspace, acceptance criteria, constraints, completed actions, test evidence, and rollback checkpoint.',
	        'For a persistent code mission, select exactly one auditable next action per turn from the mission loop decision unless a single OneClaw task already contains an ordered, dependency-safe execution package.',
	        'Stop the code agent loop when the outcome is satisfied, approval or missing input is required, verification fails, rollback should be offered, or the mission iteration budget is exhausted. Never claim continued background work after the response ends.',
	        'In manual mode, inspect and prepare previews automatically but gate mutation, tests, recovery, and delivery. In assist mode, inspect, preview, test approved changes, and verify automatically while gating patch apply, rollback, and PR delivery. In auto mode, mutation may auto-run only in an isolated cloud sandbox; local workspace mutation remains approval gated.',
	        'Use code.workspace.status for read-only workspace inspection, repository status, and project health checks.',
	        'Use code.diff.prepare for requested fixes, refactors, implementation changes, or code review follow-up. This is preview-only and should not modify files.',
	        'Use code.patch.apply only after explicit user approval of a prepared patch. It must be manual approval gated and treated as high risk.',
	        'Use code.test.run only for approved package.json validation scripts such as check, lint, typecheck, test, or build. Never invent an arbitrary shell command.',
	        'Use code.verify after tests to run repository-safe verification such as git diff --check and return final status evidence.',
	        'Use code.patch.rollback when an applied patch has a rollbackToken and tests or verification fail. Rollback is always approval gated.',
	        'Use code.commit.prepare to produce a delivery package with branch, status, diff stat, and a proposed commit message. It does not create a commit.',
	        'Use code.pr.create to prepare a pull request package only after validation succeeds. It is approval gated and must not claim a live PR exists without a provider receipt.',
	        'For code changes, prefer the route: inspect workspace -> prepare diff preview -> wait for approval -> apply patch -> run approved tests -> verify -> prepare commit -> prepare PR -> return proof.',
	        'When tests or verification fail after apply, preserve the failure evidence and offer rollback using the exact rollbackToken. Do not mark the coding mission complete.',
        'If a code task lacks the target workspace, repository, branch, file path, or concrete change request, ask only for the missing target. Do not invent a patch.',
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
