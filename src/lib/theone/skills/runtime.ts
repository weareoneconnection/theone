import { canSubmitExternalTasks, evaluateOneClawTaskPolicy } from '../policy/approval-policy';
import { attachAutomationPolicyToTask, evaluateAutomationPolicy } from '../policy/automation-engine';
import { preflightOneClawTask } from '../execution/preflight';
import { normalizeOneClawTaskContract } from '../execution/task-contracts';
import { extractOneAIData, extractOneAIPlannedOneClawTask, runOneAI } from '../providers/oneai';
import { runOneClawTask } from '../providers/oneclaw';
import { receiptForOneClawPlan, receiptForTheOne, receiptFromOneAI, receiptFromOneClawRun } from '../providers/receipts';
import { createExecutionRecord } from '../runtime/workflow-runtime';
import { getSkill } from './registry';
import type {
  AgentExecutionResult,
  AgentRuntimeContext,
  ApprovalGate,
  ClassifiedIntent,
  ExecutionPlan,
  ExecutionRecord,
  OneAIGenerateResult,
  OneClawTask,
  OneClawTaskRun,
  PlanStep,
  ProofRecord,
  SkillDefinition,
  SkillIOSchema,
} from '../types';

type SkillRunnerInput = {
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  step: PlanStep;
  skill: SkillDefinition;
  context: AgentRuntimeContext;
};

type SkillRunnerOutput = {
  ok: boolean;
  step: PlanStep;
  data?: Record<string, unknown>;
  approvals?: ApprovalGate[];
  executions?: ExecutionRecord[];
  proof?: ProofRecord[];
  oneclawTask?: OneClawTask | null;
};

type SkillRunner = (input: SkillRunnerInput) => Promise<SkillRunnerOutput>;

function now() {
  return new Date().toISOString();
}

function nextAttempt(step: PlanStep) {
  return (step.attempts ?? 0) + 1;
}

function completeStep(step: PlanStep, output?: Record<string, unknown>): PlanStep {
  return {
    ...step,
    status: 'completed',
    attempts: nextAttempt(step),
    output,
  };
}

function blockedStep(step: PlanStep, output?: Record<string, unknown>): PlanStep {
  return {
    ...step,
    status: 'blocked',
    attempts: nextAttempt(step),
    output,
  };
}

function failedStep(step: PlanStep, error: string): PlanStep {
  return {
    ...step,
    status: 'failed',
    attempts: nextAttempt(step),
    error,
  };
}

function oneAiExecution(
  result: OneAIGenerateResult<unknown>,
  summary: string,
  operation = 'oneai.generate'
): ExecutionRecord {
  return createExecutionRecord({
    provider: 'oneai',
    status: result.mock ? 'mock' : result.success ? 'success' : 'failed',
    summary,
    raw: result,
    receipt: receiptFromOneAI(result, operation),
  });
}

function proof(input: {
  type: ProofRecord['type'];
  title: string;
  value?: string;
  metadata?: Record<string, unknown>;
}): ProofRecord {
  return {
    ...input,
    timestamp: now(),
  };
}

function oneAiPayload(input: SkillRunnerInput, task: string) {
  return {
    type: task,
    input: {
      objective: input.intent.objective,
      intentType: input.intent.type,
      capabilities: input.plan.capabilityRoute?.capabilities || [],
      connectors: input.plan.capabilityRoute?.connectors.map((connector) => connector.key) || [],
      skillKey: input.skill.key,
      mode: input.context.mode,
      contextFrame: input.context.contextFrame ? {
        id: input.context.contextFrame.id,
        resourceCount: input.context.contextFrame.summary.resourceCount,
        connectorCount: input.context.contextFrame.summary.connectorCount,
        memoryHitCount: input.context.contextFrame.summary.memoryHitCount,
        permissionSummary: input.context.contextFrame.summary.permissionSummary,
      } : null,
      permissions: input.context.permissions?.map((permission) => ({
        scope: permission.scope,
        status: permission.status,
        risk: permission.risk,
        resourceId: permission.resourceId,
      })).slice(0, 12) || [],
      memoryContext: input.context.memoryContext?.map((memory) => ({
        kind: memory.kind,
        summary: memory.summary,
        score: memory.score,
      })).slice(0, 5) || [],
    },
  };
}

function extractUrlFromObjective(objective: string) {
  const explicit = objective.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
  if (explicit) return explicit.replace(/[),.;]+$/, '');

  const domain = objective.match(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i)?.[0];
  if (!domain) return '';
  return `https://${domain.replace(/[),.;]+$/, '')}`;
}

function buildBrowserExtractTask(input: SkillRunnerInput): OneClawTask | null {
  const url = extractUrlFromObjective(input.intent.objective);
  if (!url) return null;

  return {
    taskName: 'web_research_extract',
    approvalMode: input.context.mode === 'manual' ? 'manual' : 'auto',
    steps: [
      {
        id: 'step_1',
        action: 'browser.extract',
        input: {
          url,
          objective: input.intent.objective,
          format: 'summary',
        },
        dependsOn: [],
      },
    ],
    metadata: {
      source: 'theone.skill.research_summary',
      url,
      intentType: input.intent.type,
    },
  };
}

function shouldAutoSubmitOneClawTask(input: {
  task: OneClawTask | null;
  approvals: ApprovalGate[];
  preflightStatus: string;
  context: AgentRuntimeContext;
  canAutoRun?: boolean;
}) {
  return Boolean(input.task) &&
    input.preflightStatus === 'ready' &&
    input.context.canSubmitExternalTasks &&
    canSubmitExternalTasks(input.approvals) &&
    input.canAutoRun === true;
}

function applyAutomationPolicyToApprovals(
  approvals: ApprovalGate[],
  policy: Awaited<ReturnType<typeof evaluateAutomationPolicy>>
) {
  if (policy.decision === 'auto') {
    return approvals.map((approval) => ({
      ...approval,
      required: false,
      status: 'not_required' as const,
      reason: `Automation policy allows auto-run. ${policy.reasons[0] || ''}`.trim(),
    }));
  }

  return approvals.map((approval) => ({
    ...approval,
    required: true,
    status: 'pending' as const,
    reason: policy.decision === 'blocked'
      ? `Automation policy blocked this action. ${policy.reasons[0] || ''}`.trim()
      : `Automation policy requires approval. ${policy.reasons[0] || approval.reason}`.trim(),
  }));
}

function materializeSkillInput(input: SkillRunnerInput): Record<string, unknown> {
  return {
    objective: input.intent.objective,
    intentType: input.intent.type,
    capabilities: input.plan.capabilityRoute?.capabilities || input.skill.capabilities,
    mode: input.context.mode,
    stepInput: input.step.input || {},
  };
}

function matchesSchemaType(value: unknown, expected: NonNullable<SkillIOSchema['properties']>[string]) {
  if (expected === 'unknown') return true;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expected;
}

function validateSkillIO(
  schema: SkillIOSchema | undefined,
  value: Record<string, unknown> | undefined,
  label: string
) {
  if (!schema) return { ok: true };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `${label} must be an object.` };
  }

  for (const field of schema.required || []) {
    if (value[field] === undefined || value[field] === null) {
      return { ok: false, error: `${label} missing required field: ${field}` };
    }
  }

  for (const [field, expected] of Object.entries(schema.properties || {})) {
    if (value[field] === undefined || value[field] === null) continue;
    if (!matchesSchemaType(value[field], expected)) {
      return { ok: false, error: `${label}.${field} must be ${expected}.` };
    }
  }

  return { ok: true };
}

function sortStepsByDependencies(steps: PlanStep[]) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const sorted: PlanStep[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(step: PlanStep) {
    if (visited.has(step.id)) return;
    if (visiting.has(step.id)) return;
    visiting.add(step.id);

    for (const dependencyId of step.dependsOn || []) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }

    visiting.delete(step.id);
    visited.add(step.id);
    sorted.push(step);
  }

  steps.forEach(visit);
  return sorted;
}

async function runObjectiveAnalysis(input: SkillRunnerInput): Promise<SkillRunnerOutput> {
  const result = await runOneAI(oneAiPayload(input, 'objective_analysis'));

  return {
    ok: result.success,
    step: completeStep(input.step, { oneAiMode: result.mock ? 'mock' : 'live' }),
    executions: [oneAiExecution(result, 'OneAI analyzed the objective and capability route.', 'oneai.objective_analysis')],
    proof: [
      proof({
        type: 'system',
        title: 'Objective analyzed',
        value: input.plan.capabilityRoute?.summary || 'Capability route created.',
        metadata: {
          skillKey: input.skill.key,
          capabilities: input.plan.capabilityRoute?.capabilities,
        },
      }),
    ],
  };
}

async function runResearchSummary(input: SkillRunnerInput): Promise<SkillRunnerOutput> {
  const result = await runOneAI(oneAiPayload(input, 'knowledge_retrieval'));
  const data = extractOneAIData<Record<string, unknown>>(result);
  const plannedTask = buildBrowserExtractTask(input);
  const preflight = preflightOneClawTask({
    task: plannedTask,
    intent: input.intent,
    mode: input.context.mode,
    capabilities: input.context.oneClawManifest?.capabilities,
  });
  const canSubmitReadOnlyBrowserTask = input.context.mode !== 'manual';
  const automationPolicy = await evaluateAutomationPolicy({
    task: plannedTask,
    mode: input.context.mode,
    preflight,
    capabilities: input.context.oneClawManifest?.capabilities,
    connectors: input.context.oneClawManifest?.connectors,
    canSubmitExternalTasks: canSubmitReadOnlyBrowserTask,
  });
  const oneclawTask = attachAutomationPolicyToTask(plannedTask, automationPolicy);
  const approvals = applyAutomationPolicyToApprovals(
    evaluateOneClawTaskPolicy(oneclawTask, input.context.mode),
    automationPolicy
  );
  const shouldSubmit = shouldAutoSubmitOneClawTask({
    task: oneclawTask,
    approvals,
    preflightStatus: preflight.status,
    context: {
      ...input.context,
      canSubmitExternalTasks: canSubmitReadOnlyBrowserTask,
    },
    canAutoRun: automationPolicy.canAutoRun,
  });
  const startedAt = shouldSubmit ? Date.now() : 0;
  const oneclawRun = shouldSubmit && oneclawTask
    ? await runOneClawTask<OneClawTaskRun>(oneclawTask)
    : null;
  const oneclawReceipt = oneclawRun
    ? receiptFromOneClawRun(oneclawRun, 'oneclaw.task.run', startedAt)
    : receiptForOneClawPlan(oneclawTask, 'planned');

  return {
    ok: result.success && preflight.ok && !automationPolicy.blocked,
    step: oneclawRun
      ? completeStep(input.step, { oneAiMode: result.mock ? 'mock' : 'live', data, oneclawTask, oneclawRun, preflight })
      : oneclawTask
      ? blockedStep(input.step, { oneAiMode: result.mock ? 'mock' : 'live', data, oneclawTask, preflight })
      : completeStep(input.step, { oneAiMode: result.mock ? 'mock' : 'live', data, preflight }),
    data: { research: data || null, oneclawTask, oneclawRun, preflight },
    approvals,
    executions: [
      oneAiExecution(result, 'OneAI prepared a research and knowledge route.', 'oneai.knowledge_retrieval'),
      createExecutionRecord({
        provider: 'oneclaw',
        status: oneclawRun ? (oneclawRun.mock ? 'mock' : 'submitted') : preflight.status === 'blocked' || automationPolicy.blocked ? 'failed' : oneclawTask ? 'blocked' : 'planned',
        summary: oneclawRun
          ? 'OneClaw browser extraction was submitted for this website.'
          : oneclawTask
          ? 'OneClaw browser extraction is prepared and waiting for policy clearance.'
          : 'No website URL was found, so TheOne prepared a research plan only.',
        externalId: oneclawRun?.id ?? null,
        taskName: oneclawTask?.taskName,
        raw: { task: oneclawTask, oneclawRun, preflight, automationPolicy },
        receipt: oneclawReceipt,
      }),
    ],
    oneclawTask,
    proof: [
      proof({
        type: 'execution',
        title: 'Research summary prepared',
        value: oneclawRun
          ? 'Website extraction was submitted to OneClaw.'
          : oneclawTask
          ? 'Website extraction task is prepared for OneClaw.'
          : 'Research output is ready for durable memory.',
        metadata: { skillKey: input.skill.key, result, oneclawTask, oneclawRun, preflight, automationPolicy },
      }),
    ],
  };
}

async function runContentPrepare(input: SkillRunnerInput): Promise<SkillRunnerOutput> {
  const result = await runOneAI(oneAiPayload(input, 'general_plan'));
  const data = extractOneAIData<Record<string, unknown>>(result);

  return {
    ok: result.success,
    step: completeStep(input.step, { oneAiMode: result.mock ? 'mock' : 'live', data }),
    data: { content: data || null },
    executions: [oneAiExecution(result, 'OneAI prepared a content or artifact plan.', 'oneai.general_plan')],
    proof: [
      proof({
        type: 'system',
        title: 'Content prepared',
        value: 'Create capability completed.',
        metadata: { skillKey: input.skill.key, result },
      }),
    ],
  };
}

async function runExternalPublish(input: SkillRunnerInput): Promise<SkillRunnerOutput> {
  const result = await runOneAI<{
    reply?: string;
    shouldExecute?: boolean;
    oneclawTask?: OneClawTask | null;
    summary?: string;
  }>({
    type: 'oneclaw_execute',
    input: {
      message: input.intent.objective,
      lang: 'mixed',
      source: 'theone.skill.external_publish',
      capabilities: input.skill.capabilities,
    },
  });
  const data = extractOneAIData<{
    reply?: string;
    shouldExecute?: boolean;
    oneclawTask?: OneClawTask | null;
    summary?: string;
  }>(result);
  const rawPlannedTask = extractOneAIPlannedOneClawTask(data) ?? data?.oneclawTask ?? null;
  const plannedTask = normalizeOneClawTaskContract({
    task: rawPlannedTask,
    intent: input.intent,
    oneAiData: data,
  });
  const preflight = preflightOneClawTask({
    task: plannedTask,
    intent: input.intent,
    mode: input.context.mode,
    capabilities: input.context.oneClawManifest?.capabilities,
  });
  const automationPolicy = await evaluateAutomationPolicy({
    task: plannedTask,
    mode: input.context.mode,
    preflight,
    capabilities: input.context.oneClawManifest?.capabilities,
    connectors: input.context.oneClawManifest?.connectors,
    canSubmitExternalTasks: input.context.canSubmitExternalTasks,
  });
  const oneclawTask = attachAutomationPolicyToTask(plannedTask, automationPolicy);
  const approvals = applyAutomationPolicyToApprovals(
    evaluateOneClawTaskPolicy(oneclawTask, input.context.mode),
    automationPolicy
  );
  const shouldSubmit = shouldAutoSubmitOneClawTask({
    task: oneclawTask,
    approvals,
    preflightStatus: preflight.status,
    context: input.context,
    canAutoRun: automationPolicy.canAutoRun,
  });
  const startedAt = shouldSubmit ? Date.now() : 0;
  const oneclawRun = shouldSubmit && oneclawTask
    ? await runOneClawTask<OneClawTaskRun>(oneclawTask)
    : null;
  const blocked = Boolean(oneclawTask && !oneclawRun);
  const oneclawReceipt = oneclawRun
    ? receiptFromOneClawRun(oneclawRun, 'oneclaw.task.run', startedAt)
    : receiptForOneClawPlan(oneclawTask, oneclawTask ? 'blocked' : 'planned');

  return {
    ok: result.success && preflight.ok && !automationPolicy.blocked,
    step: oneclawRun
      ? completeStep(input.step, { oneclawTask, oneclawRun, reply: data?.reply, preflight })
      : blocked
      ? blockedStep(input.step, { oneclawTask, reply: data?.reply, preflight })
      : completeStep(input.step, { reply: data?.reply, preflight }),
    data: { reply: data?.reply, oneclawTask, oneclawRun, preflight },
    approvals,
    executions: [
      oneAiExecution(result, 'OneAI planned an external publishing task.', 'oneai.oneclaw_execute'),
      createExecutionRecord({
        provider: 'oneclaw',
        status: oneclawRun ? (oneclawRun.mock ? 'mock' : 'submitted') : preflight.status === 'blocked' || automationPolicy.blocked ? 'failed' : oneclawTask ? 'blocked' : 'planned',
        summary: preflight.status === 'blocked' || automationPolicy.blocked
          ? 'OneClaw task failed production preflight or automation policy.'
          : oneclawRun
            ? 'OneClaw task auto-submitted by TheOne policy.'
            : oneclawTask
            ? 'OneClaw task is waiting for approval.'
            : 'No external OneClaw task was produced.',
        externalId: oneclawRun?.id ?? null,
        taskName: oneclawTask?.taskName,
        raw: { task: oneclawTask, oneclawRun, preflight, automationPolicy },
        receipt: oneclawReceipt,
      }),
    ],
    oneclawTask,
    proof: [
      proof({
        type: 'social',
        title: 'External communication planned',
        value: preflight.status === 'blocked'
          ? 'Production preflight blocked external publish.'
          : automationPolicy.blocked
          ? 'Automation policy blocked external publish.'
          : oneclawRun ? 'TheOne auto-submitted this governed publish task.' : oneclawTask ? 'Approval required before external publish.' : 'No external publish task required.',
        metadata: { skillKey: input.skill.key, oneclawTask, oneclawRun, preflight, automationPolicy },
      }),
    ],
  };
}

async function runMissionOrchestration(input: SkillRunnerInput): Promise<SkillRunnerOutput> {
  return {
    ok: true,
    step: completeStep(input.step, {
      missionDraft: true,
      capabilities: input.skill.capabilities,
    }),
    executions: [
      createExecutionRecord({
        provider: 'theone',
        status: 'success',
        summary: 'TheOne created a mission orchestration draft.',
        receipt: receiptForTheOne('mission.orchestration', 'success', {
          skillKey: input.skill.key,
          capabilities: input.skill.capabilities,
        }),
      }),
    ],
    proof: [
      proof({
        type: 'mission',
        title: 'Mission orchestration prepared',
        value: 'Mission, task, and proof loop drafted.',
        metadata: { skillKey: input.skill.key },
      }),
    ],
  };
}

async function runExternalOperation(input: SkillRunnerInput): Promise<SkillRunnerOutput> {
  const result = await runOneAI<{
    reply?: string;
    shouldExecute?: boolean;
    oneclawTask?: OneClawTask | null;
  }>({
    type: 'oneclaw_execute',
    input: {
      message: input.intent.objective,
      lang: 'mixed',
      source: 'theone.skill.external_operation',
      capabilities: input.skill.capabilities,
    },
  });
  const data = extractOneAIData<{ oneclawTask?: OneClawTask | null; reply?: string }>(result);
  const rawPlannedTask = extractOneAIPlannedOneClawTask(data) ?? data?.oneclawTask ?? null;
  const plannedTask = normalizeOneClawTaskContract({
    task: rawPlannedTask,
    intent: input.intent,
    oneAiData: data,
  });
  const preflight = preflightOneClawTask({
    task: plannedTask,
    intent: input.intent,
    mode: input.context.mode,
    capabilities: input.context.oneClawManifest?.capabilities,
  });
  const automationPolicy = await evaluateAutomationPolicy({
    task: plannedTask,
    mode: input.context.mode,
    preflight,
    capabilities: input.context.oneClawManifest?.capabilities,
    connectors: input.context.oneClawManifest?.connectors,
    canSubmitExternalTasks: input.context.canSubmitExternalTasks,
  });
  const oneclawTask = attachAutomationPolicyToTask(plannedTask, automationPolicy);
  const approvals = applyAutomationPolicyToApprovals(
    evaluateOneClawTaskPolicy(oneclawTask, input.context.mode),
    automationPolicy
  );
  const shouldSubmit = shouldAutoSubmitOneClawTask({
    task: oneclawTask,
    approvals,
    preflightStatus: preflight.status,
    context: input.context,
    canAutoRun: automationPolicy.canAutoRun,
  });
  const startedAt = shouldSubmit ? Date.now() : 0;
  const oneclawRun = shouldSubmit && oneclawTask
    ? await runOneClawTask<OneClawTaskRun>(oneclawTask)
    : null;
  const oneclawReceipt = oneclawRun
    ? receiptFromOneClawRun(oneclawRun, 'oneclaw.task.run', startedAt)
    : receiptForOneClawPlan(oneclawTask, oneclawTask ? 'blocked' : 'planned');

  return {
    ok: result.success && preflight.ok && !automationPolicy.blocked,
    step: oneclawRun
      ? completeStep(input.step, { oneclawTask, oneclawRun, preflight })
      : oneclawTask ? blockedStep(input.step, { oneclawTask, preflight }) : completeStep(input.step, { preflight }),
    data: { oneclawTask, oneclawRun, preflight },
    approvals,
    executions: [
      oneAiExecution(result, 'OneAI planned an external operation.', 'oneai.oneclaw_execute'),
      createExecutionRecord({
        provider: 'oneclaw',
        status: oneclawRun ? (oneclawRun.mock ? 'mock' : 'submitted') : preflight.status === 'blocked' || automationPolicy.blocked ? 'failed' : oneclawTask ? 'blocked' : 'planned',
        summary: preflight.status === 'blocked' || automationPolicy.blocked
          ? 'External operation failed production preflight or automation policy.'
          : oneclawRun ? 'External operation auto-submitted by TheOne policy.' : oneclawTask ? 'External operation waits for approval.' : 'No external operation needed.',
        externalId: oneclawRun?.id ?? null,
        taskName: oneclawTask?.taskName,
        raw: { task: oneclawTask, oneclawRun, preflight, automationPolicy },
        receipt: oneclawReceipt,
      }),
    ],
    oneclawTask,
    proof: [
      proof({
        type: 'execution',
        title: 'External operation planned',
        value: preflight.status === 'blocked'
          ? 'Production preflight blocked external operation.'
          : automationPolicy.blocked
          ? 'Automation policy blocked external operation.'
          : oneclawRun ? 'TheOne auto-submitted this governed operation.' : oneclawTask ? 'Approval required before operation.' : 'No external operation task required.',
        metadata: { skillKey: input.skill.key, oneclawTask, oneclawRun, preflight, automationPolicy },
      }),
    ],
  };
}

async function runTransactionGuard(input: SkillRunnerInput): Promise<SkillRunnerOutput> {
  const result = await runOneAI(oneAiPayload(input, 'trade_decision'));

  return {
    ok: result.success,
    step: blockedStep(input.step, {
      guard: 'transaction_requires_explicit_approval',
      oneAiMode: result.mock ? 'mock' : 'live',
    }),
    executions: [
      oneAiExecution(result, 'OneAI prepared a guarded transaction decision.', 'oneai.trade_decision'),
      createExecutionRecord({
        provider: 'oneclaw',
        status: 'blocked',
        summary: 'Transaction execution is blocked until explicit approval.',
        receipt: receiptForOneClawPlan(null, 'blocked'),
      }),
    ],
    proof: [
      proof({
        type: 'trade',
        title: 'Transaction guard engaged',
        value: 'High-risk transaction is blocked by governance policy.',
        metadata: { skillKey: input.skill.key, result },
      }),
    ],
  };
}

async function runStatusMonitor(input: SkillRunnerInput): Promise<SkillRunnerOutput> {
  const result = await runOneAI(oneAiPayload(input, 'general_plan'));

  return {
    ok: result.success,
    step: completeStep(input.step, { oneAiMode: result.mock ? 'mock' : 'live' }),
    executions: [oneAiExecution(result, 'OneAI prepared monitoring and follow-up context.', 'oneai.general_plan')],
    proof: [
      proof({
        type: 'system',
        title: 'Status monitor prepared',
        value: 'Monitor capability completed.',
        metadata: { skillKey: input.skill.key, result },
      }),
    ],
  };
}

const skillRunners: Record<string, SkillRunner> = {
  objective_analysis: runObjectiveAnalysis,
  research_summary: runResearchSummary,
  content_prepare: runContentPrepare,
  external_publish: runExternalPublish,
  mission_orchestration: runMissionOrchestration,
  external_operation: runExternalOperation,
  transaction_guard: runTransactionGuard,
  status_monitor: runStatusMonitor,
};

function runSystemStep(step: PlanStep): SkillRunnerOutput {
  if (step.action === 'memory.store') {
    return {
      ok: true,
      step: completeStep(step, { stored: true }),
      executions: [
        createExecutionRecord({
          provider: 'theone',
          status: 'success',
          summary: 'TheOne prepared a memory write for the workflow.',
          receipt: receiptForTheOne('memory.store', 'success', step.input),
        }),
      ],
      proof: [
        proof({
          type: 'system',
          title: 'Memory write prepared',
          value: 'Memory policy completed for this workflow.',
          metadata: { capability: step.capability },
        }),
      ],
    };
  }

  if (step.action === 'network.update') {
    return {
      ok: true,
      step: completeStep(step, { synced: true }),
      executions: [
        createExecutionRecord({
          provider: 'theone',
          status: 'success',
          summary: 'TheOne prepared a network state update.',
          receipt: receiptForTheOne('network.update', 'success', step.input),
        }),
      ],
    };
  }

  if (step.action === 'proof.write') {
    return {
      ok: true,
      step: completeStep(step, { proofWritten: true }),
      executions: [
        createExecutionRecord({
          provider: 'theone',
          status: 'success',
          summary: 'TheOne recorded workflow proof.',
          receipt: receiptForTheOne('proof.write', 'success', step.input),
        }),
      ],
    };
  }

  return {
    ok: true,
    step: completeStep(step),
    executions: [
      createExecutionRecord({
        provider: 'theone',
        status: 'success',
        summary: `TheOne completed system action ${step.action}.`,
        receipt: receiptForTheOne(step.action, 'success', step.input),
      }),
    ],
  };
}

export async function runSkillWorkflow(input: {
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  context: AgentRuntimeContext;
}): Promise<AgentExecutionResult> {
  const updatedSteps: PlanStep[] = [];
  const approvals: ApprovalGate[] = [];
  const executions: ExecutionRecord[] = [];
  const proofRecords: ProofRecord[] = [];
  const data: Record<string, unknown> = {
    runtime: 'skill.runtime.v2',
    capabilities: input.plan.capabilityRoute?.capabilities || [],
    skills: input.plan.capabilityRoute?.skills.map((skill) => skill.key) || [],
    connectors: input.plan.capabilityRoute?.connectors.map((connector) => connector.key) || [],
    memoryContext: input.context.memoryContext || [],
    contextFrame: input.context.contextFrame || null,
    permissionSummary: input.context.contextFrame?.summary.permissionSummary || {
      allowed: 0,
      requiresApproval: 0,
      denied: 0,
    },
    dag: input.plan.steps.map((step) => ({
      id: step.id,
      dependsOn: step.dependsOn || [],
    })),
  };
  let oneclawTask: OneClawTask | null = null;
  let ok = true;
  const completedStepIds = new Set<string>();

  for (const step of sortStepsByDependencies(input.plan.steps)) {
    const blockedBy = (step.dependsOn || []).filter((dependencyId) => !completedStepIds.has(dependencyId));
    if (blockedBy.length) {
      updatedSteps.push(blockedStep(step, {
        blockedBy,
        reason: 'dependency_not_completed',
      }));
      continue;
    }

    try {
      if (!step.skillKey) {
        const result = runSystemStep(step);
        updatedSteps.push(result.step);
        executions.push(...(result.executions || []));
        proofRecords.push(...(result.proof || []));
        if (result.step.status === 'completed') completedStepIds.add(result.step.id);
        continue;
      }

      const skill = getSkill(step.skillKey);
      const runner = skill ? skillRunners[skill.key] : null;

      if (!skill || !runner) {
        updatedSteps.push(failedStep(step, `No skill runner registered for ${step.skillKey}`));
        executions.push(createExecutionRecord({
          provider: 'theone',
          status: 'failed',
          summary: `No skill runner registered for ${step.skillKey}.`,
          receipt: receiptForTheOne('skill.lookup', 'failed', { skillKey: step.skillKey }),
        }));
        ok = false;
        continue;
      }

      const inputCheck = validateSkillIO(
        skill.inputSchema,
        materializeSkillInput({
          intent: input.intent,
          plan: input.plan,
          step,
          skill,
          context: input.context,
        }),
        `${skill.key} input`
      );

      if (!inputCheck.ok) {
        updatedSteps.push(failedStep(step, inputCheck.error || 'Skill input contract failed.'));
        executions.push(createExecutionRecord({
          provider: 'theone',
          status: 'failed',
          summary: `Skill ${skill.key} failed its input contract.`,
          raw: inputCheck,
          receipt: receiptForTheOne('skill.input.validate', 'failed', inputCheck),
        }));
        ok = false;
        continue;
      }

      const result = await runner({
        intent: input.intent,
        plan: input.plan,
        step,
        skill,
        context: input.context,
      });

      const outputCheck = validateSkillIO(
        skill.outputSchema,
        result.step.output || result.data || {},
        `${skill.key} output`
      );
      const finalStep = outputCheck.ok
        ? result.step
        : failedStep(result.step, outputCheck.error || 'Skill output contract failed.');

      ok = ok && result.ok && outputCheck.ok;
      updatedSteps.push(finalStep);
      Object.assign(data, result.data || {});
      approvals.push(...(result.approvals || []));
      executions.push(...(result.executions || []));
      if (!outputCheck.ok) {
        executions.push(createExecutionRecord({
          provider: 'theone',
          status: 'failed',
          summary: `Skill ${skill.key} failed its output contract.`,
          raw: outputCheck,
          receipt: receiptForTheOne('skill.output.validate', 'failed', outputCheck),
        }));
      }
      proofRecords.push(...(result.proof || []));
      if (!oneclawTask && result.oneclawTask) {
        oneclawTask = result.oneclawTask;
      }
      if (finalStep.status === 'completed' && result.ok && outputCheck.ok) completedStepIds.add(finalStep.id);
    } catch (error) {
      ok = false;
      updatedSteps.push(failedStep(
        step,
        error instanceof Error ? error.message : 'Skill runner failed'
      ));
      executions.push(createExecutionRecord({
        provider: 'theone',
        status: 'failed',
        summary: `Skill ${step.skillKey || step.action} failed.`,
        raw: error instanceof Error ? { message: error.message } : error,
        receipt: receiptForTheOne('skill.runner.error', 'failed', error instanceof Error ? { message: error.message } : error),
      }));
    }
  }

  return {
    ok,
    agent: 'skill.runtime',
    summary: executions.find((execution) => execution.provider === 'oneclaw')?.summary
      || proofRecords.find((record) => record.value)?.value
      || input.plan.capabilityRoute?.summary
      || `Skill workflow executed for: ${input.intent.objective}`,
    data,
    updatedSteps,
    approvals,
    executions,
    proof: proofRecords,
    oneclawTask,
  };
}
