import { classifyIntent } from './intents/classifyIntent';
import { normalizeIntent } from './intents/normalizeIntent';
import { THEONE_CONFIG } from './config';
import { canSubmitExternalTasks, evaluatePlanPolicy } from './policy/approval-policy';
import { buildPlan } from './planners/buildPlan';
import { validatePlan } from './planners/validatePlan';
import { routeIntent } from './router';
import { runSkillWorkflow } from './skills/runtime';
import { createRunId } from './runtime';
import { assertPlanSafe } from './guards';
import { writeProof } from './proof';
import { pushNetworkSignals } from './providers/onefield';
import { recordMissionProof } from './providers/mission';
import { computeExecutionStats } from './metrics';
import { storeRunMemory } from './memory';
import { createContextBusFrame } from './context/context-bus';
import { evaluatePermissionPolicy } from './policy/permission-policy';
import { queryMemoryGraph } from './state/run-store';
import { TheOneEventBus } from './event-bus';
import { getTheOneKernelStatus } from './kernel/status';
import { runMultiAgentRuntime } from './agents/multi-agent-runtime';
import { getOneClawCapabilityManifest } from './providers/oneclaw';
import { preflightOneClawTask } from './execution/preflight';
import {
  createWorkflowTrace,
  markApprovalBlockedSteps,
} from './runtime/workflow-runtime';
import type {
  ApprovalGate,
  ExecutionPlan,
  ExecutionRecord,
  IntentInput,
  TheOneMode,
  TheOneRunResult,
  ClassifiedIntent,
} from './types';

function fallbackIntent(raw: string): ClassifiedIntent {
  return {
    type: 'general',
    objective: raw,
    entities: [],
    constraints: [],
    priority: 'normal',
    confidence: 0,
    requiresApproval: false,
  };
}

function fallbackPlan(raw: string): ExecutionPlan {
  const intent = fallbackIntent(raw);
  return {
    id: `plan_failed_${Date.now()}`,
    intent,
    summary: 'Plan failed before creation',
    steps: [],
    estimatedRisk: 'low',
  };
}

export async function runTheOne(input: IntentInput): Promise<TheOneRunResult> {
  const runId = createRunId();
  const bus = new TheOneEventBus();
  const mode = (input.mode || THEONE_CONFIG.defaultMode) as TheOneMode;
  const oneClawManifest = await getOneClawCapabilityManifest();
  const kernel = getTheOneKernelStatus(mode, oneClawManifest);

  try {
    if (!input.raw.trim()) {
      throw new Error('Input is required');
    }

    const rawIntent = await classifyIntent(input);
    const intent = normalizeIntent(rawIntent);
    bus.emit({ type: 'intent.classified', payload: intent });

    const basePlan = validatePlan(buildPlan(intent));
    const memoryContext = await queryMemoryGraph({
      query: intent.objective,
      intentType: intent.type,
      capabilities: basePlan.capabilityRoute?.capabilities,
      limit: 5,
    });
    const plan: ExecutionPlan = {
      ...basePlan,
      memoryContext,
    };
    bus.emit({ type: 'plan.created', payload: plan });

    const planApprovals = evaluatePlanPolicy(plan, mode);
    const permissions = evaluatePermissionPolicy({
      mode,
      intent,
      rawInput: input,
      plan,
      memoryContext,
    });
    const contextFrame = createContextBusFrame({
      runId,
      mode,
      intent,
      input,
      plan,
      memoryContext,
      approvals: planApprovals,
      permissions,
    });
    assertPlanSafe(plan, mode === 'auto');

    const multiAgentRuntimePromise = runMultiAgentRuntime({
      runId,
      mode,
      intent,
      plan,
      approvals: planApprovals,
      permissions,
      memoryContext,
      contextFrame,
    });

    const runtimeContext = {
      runId,
      mode,
      providerStatus: kernel.providers,
      approvalGates: planApprovals,
      canSubmitExternalTasks: canSubmitExternalTasks(planApprovals)
        && !permissions.some((permission) => permission.status === 'denied'),
      capabilityRoute: plan.capabilityRoute,
      memoryContext,
      contextFrame,
      permissions,
      preflight: null,
      oneClawManifest,
    };

    const agentResult = plan.capabilityRoute?.skills.length
      ? await runSkillWorkflow({ intent, plan, context: runtimeContext })
      : await (async () => {
        const routed = await routeIntent(intent);
        return routed.agent({ intent, plan, context: runtimeContext });
      })();
    const multiAgentRuntime = await multiAgentRuntimePromise;

    const approvals: ApprovalGate[] = [
      ...planApprovals,
      ...(agentResult.approvals || []),
    ];
    const executions: ExecutionRecord[] = [
      ...multiAgentRuntime.executions,
      ...(agentResult.executions || []),
    ];
    const preflight = preflightOneClawTask({
      task: agentResult.oneclawTask,
      intent,
      mode,
      capabilities: oneClawManifest.capabilities,
    });

    const resolvedPlanBeforePolicy: ExecutionPlan = {
      ...plan,
      steps: agentResult.updatedSteps || plan.steps,
    };
    const resolvedPlan = markApprovalBlockedSteps(resolvedPlanBeforePolicy, approvals);

    const proof = await writeProof([
      ...multiAgentRuntime.proof,
      ...(agentResult.proof || []),
    ]);
    for (const record of proof) {
      bus.emit({ type: 'proof.recorded', payload: record });
    }

    await Promise.all([
      storeRunMemory({
        runId,
        intent,
        summary: agentResult.summary,
      }),
      recordMissionProof(proof),
      pushNetworkSignals({
        runId,
        intentType: intent.type,
        proofCount: proof.length,
        confidence: intent.confidence,
      }),
    ]);

    const execution = computeExecutionStats(resolvedPlan.steps);
    bus.emit({ type: 'run.completed', payload: { runId, ok: true } });
    const workflow = createWorkflowTrace({
      runId,
      mode,
      plan: resolvedPlan,
      approvals,
    });
    const finalContextFrame = createContextBusFrame({
      runId,
      mode,
      intent,
      input,
      plan: resolvedPlan,
      memoryContext,
      approvals,
      executions,
      permissions,
    });
    const os = {
      ...kernel,
      workflow,
      approvals,
      executions,
      contextFrame: finalContextFrame,
      permissions,
      preflight,
    };
    const pendingOneClawTask = agentResult.oneclawTask ?? null;

    return {
      ok: true,
      runId,
      intent,
      plan: resolvedPlan,
      execution: {
        completedSteps: execution.completedSteps,
        failedSteps: execution.failedSteps,
        agentResults: [agentResult],
      },
      proof,
      approvals,
      executions,
      pendingOneClawTask,
      memoryContext,
      contextFrame: finalContextFrame,
      permissions,
      preflight,
      multiAgentRuntime,
      os,
      networkSignals: {
        synced: true,
        events: bus.getAll().length,
        multiAgentStatus: multiAgentRuntime.status,
        multiAgentAgents: multiAgentRuntime.agents.length,
        memoryHits: memoryContext.length,
        connectors: plan.capabilityRoute?.connectors.map((connector) => connector.key) || [],
        permissions: finalContextFrame.summary.permissionSummary,
      },
    };
  } catch (error) {
    return {
      ok: false,
      runId,
      intent: fallbackIntent(input.raw),
      plan: fallbackPlan(input.raw),
      execution: {
        completedSteps: 0,
        failedSteps: 1,
        agentResults: [],
      },
      proof: [],
      approvals: [],
      executions: [],
      pendingOneClawTask: null,
      os: {
        ...kernel,
        workflow: createWorkflowTrace({
          runId,
          mode,
          plan: fallbackPlan(input.raw),
          approvals: [],
        }),
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
