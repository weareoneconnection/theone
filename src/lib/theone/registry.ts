import type { AgentRuntimeContext, ClassifiedIntent, ExecutionPlan } from './types';
import { runTradingAgent } from './agents/trading.agent';
import { runGrowthAgent } from './agents/growth.agent';
import { runMissionAgent } from './agents/mission.agent';
import { runKnowledgeAgent } from './agents/knowledge.agent';
import { runGeneralAgent } from './agents/general.agent';

export type TheOneAgentFn = (args: {
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  context: AgentRuntimeContext;
}) => Promise<any>;

export const agentRegistry: Record<string, TheOneAgentFn> = {
  financial: runTradingAgent,
  growth: runGrowthAgent,
  mission: runMissionAgent,
  knowledge: runKnowledgeAgent,
  automation: runGeneralAgent,
  general: runGeneralAgent,
};

export function getAgentByIntent(intentType: ClassifiedIntent['type']): TheOneAgentFn {
  return agentRegistry[intentType] ?? runGeneralAgent;
}
