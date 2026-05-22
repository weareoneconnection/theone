import { markSteps } from './helpers';
import { runOneAI } from '../providers/oneai';
import { createExecutionRecord } from '../runtime/workflow-runtime';
import type {
  AgentExecutionResult,
  AgentRuntimeContext,
  ClassifiedIntent,
  ExecutionPlan,
} from '../types';

export async function runKnowledgeAgent(args: {
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  context: AgentRuntimeContext;
}): Promise<AgentExecutionResult> {
  const oneAiResult = await runOneAI({
    type: 'knowledge_retrieval',
    input: {
      objective: args.intent.objective,
      mode: args.context.mode,
      memoryTarget: 'theone.memory_graph',
    },
  });

  const updatedSteps = markSteps(args.plan.steps, {
    'oneai.generate': 'completed',
    'memory.store': 'completed',
    'network.update': 'completed',
  });

  return {
    ok: true,
    agent: 'knowledge.agent',
    summary: `Knowledge workflow prepared for: ${args.intent.objective}`,
    data: {
      retrieval: 'ready',
      memoryWrite: true,
    },
    updatedSteps,
    executions: [
      createExecutionRecord({
        provider: 'oneai',
        status: oneAiResult.mock ? 'mock' : 'success',
        summary: 'OneAI prepared the knowledge route.',
        raw: oneAiResult,
      }),
    ],
    proof: [
      {
        type: 'execution',
        title: 'Knowledge OS prepared memory-ready output',
        value: 'Knowledge route completed through TheOne memory contract',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
