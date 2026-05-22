import { getActionRisk } from '../policy/approval-policy';
import { createExecutionRecord } from '../runtime/workflow-runtime';
import { receiptForTheOne } from '../providers/receipts';
import type {
  ApprovalGate,
  ClassifiedIntent,
  ContextBusFrame,
  ExecutionPlan,
  ExecutionRecord,
  MemoryGraphHit,
  PermissionDecision,
  ProofRecord,
  TheOneMode,
} from '../types';

export type MultiAgentRole = 'planner' | 'policy' | 'critic' | 'operator' | 'memory';

export type MultiAgentFinding = {
  role: MultiAgentRole;
  status: 'pass' | 'warn' | 'block';
  title: string;
  summary: string;
  confidence: number;
  recommendations: string[];
  signals: Record<string, unknown>;
  durationMs: number;
};

export type MultiAgentRuntimeResult = {
  id: string;
  mode: TheOneMode;
  status: 'pass' | 'warn' | 'block';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  agents: MultiAgentFinding[];
  consensus: {
    status: 'pass' | 'warn' | 'block';
    summary: string;
    blockers: string[];
    warnings: string[];
    recommendations: string[];
  };
  executions: ExecutionRecord[];
  proof: ProofRecord[];
};

type MultiAgentInput = {
  runId: string;
  mode: TheOneMode;
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  approvals: ApprovalGate[];
  permissions: PermissionDecision[];
  memoryContext: MemoryGraphHit[];
  contextFrame: ContextBusFrame;
};

function now() {
  return new Date().toISOString();
}

function runtimeId() {
  return `mar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function timed(role: MultiAgentRole, fn: () => Omit<MultiAgentFinding, 'role' | 'durationMs'>): Promise<MultiAgentFinding> {
  const started = Date.now();
  const result = await Promise.resolve(fn());
  return {
    role,
    ...result,
    durationMs: Date.now() - started,
  };
}

function plannerAgent(input: MultiAgentInput) {
  const steps = input.plan.steps || [];
  const dependencyCount = steps.reduce((count, step) => count + (step.dependsOn?.length || 0), 0);
  const hasExecutableStep = steps.some((step) => step.action === 'oneclaw.execute');

  return timed('planner', () => ({
    status: steps.length > 0 ? 'pass' : 'warn',
    title: 'Planner checked workflow shape',
    summary: `${steps.length} step(s), ${dependencyCount} dependency edge(s), ${hasExecutableStep ? 'external execution present' : 'system-only plan'}.`,
    confidence: steps.length > 0 ? 0.86 : 0.48,
    recommendations: hasExecutableStep
      ? ['Keep external execution behind policy and preflight.']
      : ['No external worker needed unless the objective requires real-world action.'],
    signals: {
      steps: steps.length,
      dependencyCount,
      capabilities: input.plan.capabilityRoute?.capabilities || [],
    },
  }));
}

function policyAgent(input: MultiAgentInput) {
  const required = input.approvals.filter((approval) => approval.required);
  const denied = input.permissions.filter((permission) => permission.status === 'denied');
  const status = denied.length > 0 ? 'block' : required.length > 0 ? 'warn' : 'pass';

  return timed('policy', () => ({
    status,
    title: 'Policy checked approvals and permission scope',
    summary: `${required.length} approval gate(s), ${denied.length} denied permission(s).`,
    confidence: denied.length > 0 ? 0.95 : 0.82,
    recommendations: denied.length > 0
      ? ['Stop execution until denied permissions are resolved.']
      : required.length > 0
        ? ['Wait for approval before submitting external worker tasks.']
        : ['Low-risk path can continue under current mode.'],
    signals: {
      requiredApprovals: required.length,
      deniedPermissions: denied.length,
      mode: input.mode,
    },
  }));
}

function criticAgent(input: MultiAgentInput) {
  const highRiskSteps = input.plan.steps.filter((step) => getActionRisk(step.action) === 'high');
  const vagueObjective = input.intent.objective.trim().length < 12;
  const status = highRiskSteps.length > 0 || vagueObjective ? 'warn' : 'pass';

  return timed('critic', () => ({
    status,
    title: 'Critic reviewed risk and ambiguity',
    summary: `${highRiskSteps.length} high-risk step(s); objective is ${vagueObjective ? 'too short' : 'specific enough'}.`,
    confidence: 0.78,
    recommendations: [
      ...(highRiskSteps.length ? ['Require proof and receipts for high-risk actions.'] : []),
      ...(vagueObjective ? ['Ask for clearer success criteria before autonomous execution.'] : []),
      ...(!highRiskSteps.length && !vagueObjective ? ['Proceed with standard proof capture.'] : []),
    ],
    signals: {
      highRiskActions: highRiskSteps.map((step) => step.action),
      objectiveLength: input.intent.objective.length,
    },
  }));
}

function operatorAgent(input: MultiAgentInput) {
  const connectors = input.plan.capabilityRoute?.connectors || [];
  const external = input.plan.steps.some((step) => step.action === 'oneclaw.execute');

  return timed('operator', () => ({
    status: external && connectors.length === 0 ? 'warn' : 'pass',
    title: 'Operator checked worker route',
    summary: `${connectors.length} connector route(s); ${external ? 'OneClaw execution may be needed' : 'no OneClaw execution required'}.`,
    confidence: 0.8,
    recommendations: external
      ? ['Use OneClaw only after automation policy and connector readiness pass.']
      : ['Complete the workflow in TheOne/OneAI without external action.'],
    signals: {
      connectors: connectors.map((connector) => connector.key),
      external,
    },
  }));
}

function memoryAgent(input: MultiAgentInput) {
  const hits = input.memoryContext || [];
  const status = hits.length > 0 ? 'pass' : 'warn';

  return timed('memory', () => ({
    status,
    title: 'Memory checked historical context',
    summary: `${hits.length} memory hit(s) available for this run.`,
    confidence: hits.length > 0 ? 0.82 : 0.55,
    recommendations: hits.length > 0
      ? ['Use prior receipts and failures as context for safer execution.']
      : ['Store this run as a future reference point.'],
    signals: {
      memoryHits: hits.length,
      topMemory: hits[0]?.summary || null,
      contextResources: input.contextFrame.summary.resourceCount,
    },
  }));
}

function consensus(agents: MultiAgentFinding[]): MultiAgentRuntimeResult['consensus'] {
  const blockers = agents.filter((agent) => agent.status === 'block');
  const warnings = agents.filter((agent) => agent.status === 'warn');
  const status = blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass';
  return {
    status,
    summary: blockers.length > 0
      ? `${blockers.length} agent(s) blocked autonomous execution.`
      : warnings.length > 0
        ? `${warnings.length} agent(s) requested guarded execution.`
        : 'All agents passed the workflow for governed execution.',
    blockers: blockers.map((agent) => `${agent.role}: ${agent.summary}`),
    warnings: warnings.map((agent) => `${agent.role}: ${agent.summary}`),
    recommendations: Array.from(new Set(agents.flatMap((agent) => agent.recommendations))).slice(0, 8),
  };
}

export async function runMultiAgentRuntime(input: MultiAgentInput): Promise<MultiAgentRuntimeResult> {
  const startedAt = now();
  const startedMs = Date.now();
  const agents = await Promise.all([
    plannerAgent(input),
    policyAgent(input),
    criticAgent(input),
    operatorAgent(input),
    memoryAgent(input),
  ]);
  const finalConsensus = consensus(agents);
  const finishedAt = now();
  const id = runtimeId();

  const executions = agents.map((agent) => createExecutionRecord({
    provider: 'theone',
    status: agent.status === 'block' ? 'blocked' : agent.status === 'warn' ? 'running' : 'success',
    summary: `${agent.role} agent: ${agent.summary}`,
    raw: agent,
    receipt: receiptForTheOne(`agent.${agent.role}`, agent.status === 'block' ? 'blocked' : 'success', agent),
  }));

  return {
    id,
    mode: input.mode,
    status: finalConsensus.status,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    agents,
    consensus: finalConsensus,
    executions,
    proof: [{
      type: 'system',
      title: 'Multi-agent runtime consensus',
      value: finalConsensus.summary,
      timestamp: finishedAt,
      metadata: {
        runtimeId: id,
        status: finalConsensus.status,
        agents,
        recommendations: finalConsensus.recommendations,
      },
    }],
  };
}
