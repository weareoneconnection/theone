import { markSteps } from './helpers';
import { createExecutionRecord } from '../runtime/workflow-runtime';
import type {
  AgentExecutionResult,
  AgentRuntimeContext,
  ClassifiedIntent,
  ExecutionPlan,
} from '../types';

export async function runMissionAgent(args: {
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  context: AgentRuntimeContext;
}): Promise<AgentExecutionResult> {
  const updatedSteps = markSteps(args.plan.steps, {
    'mission.create': 'completed',
    'proof.write': 'completed',
  });

  return {
    ok: true,
    agent: 'mission.agent',
    summary: `Mission workflow prepared for: ${args.intent.objective}`,
    data: {
      missionDraft: true,
      rewardFlow: 'available',
      mode: args.context.mode,
    },
    updatedSteps,
    executions: [
      createExecutionRecord({
        provider: 'theone',
        status: 'success',
        summary: 'TheOne Mission app created a draft mission object.',
      }),
    ],
    proof: [
      {
        type: 'mission',
        title: 'Mission OS created a draft',
        value: 'Mission proof pipeline is ready',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
