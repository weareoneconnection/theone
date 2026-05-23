import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest } from '../providers/oneclaw';
import { checkOneAIBotBridge } from '../providers/oneai-bot';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type { ClassifiedIntent, ExecutionPlan, PlanStep, ProofRecord, TheOneMode, TheOneRunResult } from '../types';

export async function runBotBridgeApp(input: { mode?: TheOneMode } = {}): Promise<TheOneRunResult & {
  appResult: {
    app: 'bot';
    status: string;
    summary: string;
    configured: boolean;
    repoPath: string;
    endpoint: string;
    bot: unknown;
  };
}> {
  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [oneClawManifest, oneClawBridge, bot] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
    checkOneAIBotBridge(),
  ]);
  const kernel = getTheOneKernelStatus(mode, oneClawManifest, oneClawBridge);
  const summary = bot.ok
    ? 'OneAI Bot bridge is reachable and registered as a TheOne runtime.'
    : bot.configured
      ? 'OneAI Bot bridge is configured but not reachable right now.'
      : 'OneAI Bot repo is registered locally; add ONEAI_BOT_BASE_URL to enable live bridge checks.';
  const intent: ClassifiedIntent = {
    type: 'automation',
    objective: 'Check OneAI Bot bridge status',
    entities: ['oneai_bot'],
    constraints: ['do not modify bot code', 'read-only bridge check', 'record proof'],
    priority: 'normal',
    confidence: 0.96,
    requiresApproval: false,
  };
  const steps: PlanStep[] = [
    {
      id: 'bot_contract',
      title: 'Load bot bridge contract',
      action: 'custom',
      status: 'completed',
      output: { mutatesBotCode: false, repoPath: bot.repoPath },
      capability: 'integrate',
    },
    {
      id: 'bot_health',
      title: 'Check bot runtime health',
      action: 'custom',
      status: bot.ok ? 'completed' : 'blocked',
      output: { status: bot.status, endpoint: bot.endpoint, message: bot.message },
      dependsOn: ['bot_contract'],
      capability: 'monitor',
    },
    {
      id: 'bot_proof',
      title: 'Record bot bridge proof',
      action: 'proof.write',
      status: 'completed',
      dependsOn: ['bot_health'],
      capability: 'record',
    },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary,
    steps,
    estimatedRisk: 'low',
    capabilityRoute: {
      intentType: 'automation',
      objective: intent.objective,
      capabilities: ['integrate', 'monitor', 'govern', 'record'],
      skills: [],
      apps: [],
      connectors: [],
      risk: 'low',
      summary: 'Bot App registered the existing OneAI Bot as an external read-only runtime.',
    },
  };
  const executions = [
    createExecutionRecord({
      provider: 'theone',
      status: bot.ok ? 'success' : bot.configured ? 'blocked' : 'planned',
      summary,
      taskName: 'oneai.bot.bridge.status',
      raw: bot,
    }),
  ];
  const proof: ProofRecord[] = [{
    type: 'system',
    title: 'OneAI Bot bridge checked',
    value: summary,
    timestamp: startedAt,
    metadata: { app: 'bot', bot },
  }];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals: [] });
  const appMemoryPack = createAppMemoryPack({
    app: 'bot',
    title: 'OneAI Bot bridge',
    summary,
    facts: [`Configured: ${Boolean(bot.configured)}`, `Status: ${bot.status}`, `Repo: ${bot.repoPath}`],
    nextActions: ['Keep bot code unchanged until a command endpoint is intentionally added', 'Use TheOne policy for future Bot-triggered work'],
    sourceRunId: runId,
  });

  return {
    ok: true,
    runId,
    summary,
    intent,
    plan,
    execution: {
      completedSteps: steps.filter((step) => step.status === 'completed').length,
      failedSteps: steps.filter((step) => step.status === 'failed').length,
      agentResults: [],
    },
    proof,
    approvals: [],
    executions,
    pendingOneClawTask: null,
    networkSignals: { appRoute: 'bot', bridge: 'oneai_bot' },
    os: { ...kernel, workflow, approvals: [], executions },
    appMemoryPack,
    appResult: {
      app: 'bot',
      status: bot.status,
      summary,
      configured: Boolean(bot.configured),
      repoPath: bot.repoPath,
      endpoint: bot.endpoint || '',
      bot,
    },
  };
}
