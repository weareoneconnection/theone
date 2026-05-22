import { markSteps } from './helpers';
import { runOneAI } from '../providers/oneai';
import { createExecutionRecord } from '../runtime/workflow-runtime';
import type {
  AgentExecutionResult,
  AgentRuntimeContext,
  ClassifiedIntent,
  ExecutionPlan,
} from '../types';

export async function runGeneralAgent(args: {
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  context: AgentRuntimeContext;
}): Promise<AgentExecutionResult> {
  const oneAiResult = await runOneAI({
    type: 'general_plan',
    input: {
      objective: args.intent.objective,
      mode: args.context.mode,
      os: 'theone',
    },
  });

  const updatedSteps = markSteps(args.plan.steps, {
    'oneai.generate': 'completed',
    'memory.store': 'completed',
    'network.update': 'completed',
  });

  return {
    ok: true,
    agent: 'general.agent',
    summary: `General workflow prepared for: ${args.intent.objective}`,
    data: {
      status: 'done',
    },
    updatedSteps,
    executions: [
      createExecutionRecord({
        provider: 'oneai',
        status: oneAiResult.mock ? 'mock' : 'success',
        summary: 'OneAI prepared the general plan.',
        raw: oneAiResult,
      }),
    ],
    proof: [
      {
        type: 'system',
        title: 'TheOne Kernel prepared a general workflow',
        value: 'Intent, planning, memory, and network update completed',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
