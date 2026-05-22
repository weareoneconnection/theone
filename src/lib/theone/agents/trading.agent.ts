import { markSteps } from './helpers';
import { runOneAI } from '../providers/oneai';
import { createExecutionRecord } from '../runtime/workflow-runtime';
import type {
  AgentExecutionResult,
  AgentRuntimeContext,
  ClassifiedIntent,
  ExecutionPlan,
} from '../types';

export async function runTradingAgent(args: {
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  context: AgentRuntimeContext;
}): Promise<AgentExecutionResult> {
  const oneAiResult = await runOneAI({
    type: 'trade_decision',
    input: {
      objective: args.intent.objective,
      guardrails: ['no live trade without human approval', 'strategy before execution'],
      mode: args.context.mode,
    },
  });

  const updatedSteps = markSteps(args.plan.steps, {
    'oneai.generate': 'completed',
    'trading.scan': 'completed',
    'oneclaw.execute': 'blocked',
    'proof.write': 'completed',
  });

  return {
    ok: true,
    agent: 'trading.agent',
    summary: `Guarded trading workflow planned for: ${args.intent.objective}`,
    data: {
      market: 'scanned',
      decision: 'generated',
      executionMode: 'approval_required',
      route: 'TheOne -> OneAI -> Approval -> OneClaw -> Proof',
    },
    updatedSteps,
    executions: [
      createExecutionRecord({
        provider: 'oneai',
        status: oneAiResult.mock ? 'mock' : 'success',
        summary: 'OneAI prepared the guarded trading decision.',
        raw: oneAiResult,
      }),
      createExecutionRecord({
        provider: 'oneclaw',
        status: 'blocked',
        summary: 'Live external execution is blocked until approval.',
      }),
    ],
    proof: [
      {
        type: 'trade',
        title: 'Trading OS prepared a guarded route',
        value: 'Execution is blocked until explicit approval',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
