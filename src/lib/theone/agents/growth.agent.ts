import { markSteps } from './helpers';
import { canSubmitExternalTasks, evaluateOneClawTaskPolicy } from '../policy/approval-policy';
import { extractOneAIData, extractOneAIPlannedOneClawTask, runOneAI } from '../providers/oneai';
import { runOneClawTask } from '../providers/oneclaw';
import { createExecutionRecord } from '../runtime/workflow-runtime';
import type {
  AgentExecutionResult,
  AgentRuntimeContext,
  ClassifiedIntent,
  ExecutionPlan,
  OneClawTask,
  OneClawTaskRun,
} from '../types';

export async function runGrowthAgent(args: {
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  context: AgentRuntimeContext;
}): Promise<AgentExecutionResult> {
  const oneAiResult = await runOneAI<{
    reply?: string;
    shouldExecute?: boolean;
    oneclawTask?: OneClawTask | null;
    summary?: string;
  }>({
    type: 'oneclaw_execute',
    input: {
      message: args.intent.objective,
      lang: 'mixed',
      source: 'theone.growth',
    },
  });
  const oneAiData = extractOneAIData<{
    reply?: string;
    shouldExecute?: boolean;
    oneclawTask?: OneClawTask | null;
    summary?: string;
  }>(oneAiResult);
  const oneclawTask = extractOneAIPlannedOneClawTask(oneAiData) ?? oneAiData?.oneclawTask ?? null;
  const oneclawApprovals = evaluateOneClawTaskPolicy(oneclawTask, args.context.mode);
  const maySubmit = Boolean(oneclawTask) &&
    args.context.canSubmitExternalTasks &&
    canSubmitExternalTasks(oneclawApprovals);

  let oneclawRun: OneClawTaskRun | null = null;
  if (oneclawTask && maySubmit) {
    oneclawRun = await runOneClawTask<OneClawTaskRun>(oneclawTask);
  }

  const updatedSteps = markSteps(args.plan.steps, {
    'oneai.generate': 'completed',
    'oneclaw.execute': oneclawRun ? 'running' : oneclawTask ? 'blocked' : 'skipped',
    'proof.write': 'completed',
  });

  return {
    ok: true,
    agent: 'growth.agent',
    summary: oneclawRun
      ? `Growth workflow submitted to OneClaw for: ${args.intent.objective}`
      : `Growth workflow planned and waiting for approval: ${args.intent.objective}`,
    data: {
      oneAiMode: oneAiResult.mock ? 'mock' : 'live',
      reply: oneAiData?.reply,
      contentPlan: oneAiData?.summary || 'generated',
      oneclawTask,
      brandSafety: 'on',
    },
    updatedSteps,
    approvals: oneclawApprovals,
    executions: [
      createExecutionRecord({
        provider: 'oneai',
        status: oneAiResult.mock ? 'mock' : 'success',
        summary: 'OneAI generated the growth execution plan.',
        raw: oneAiResult,
      }),
      createExecutionRecord({
        provider: 'oneclaw',
        status: oneclawRun ? 'submitted' : 'blocked',
        summary: oneclawRun ? 'OneClaw task submitted.' : 'OneClaw task is waiting for approval.',
        externalId: oneclawRun?.id ?? null,
        taskName: oneclawTask?.taskName,
        raw: oneclawRun ?? oneclawTask,
      }),
    ],
    oneclawTask,
    proof: [
      {
        type: 'social',
        title: 'Growth OS prepared an execution route',
        value: oneclawRun ? 'OneClaw task submitted' : 'Approval required before external execution',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
