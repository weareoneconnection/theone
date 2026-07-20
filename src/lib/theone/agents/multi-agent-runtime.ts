import { getActionRisk } from '../policy/approval-policy';
import { createExecutionRecord } from '../runtime/workflow-runtime';
import { receiptForTheOne } from '../providers/receipts';
import { runOneAI, extractOneAIData } from '../providers/oneai';
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

export type MultiAgentLease = {
  id: string;
  role: MultiAgentRole;
  status: 'leased' | 'released';
  acquiredAt: string;
  expiresAt: string;
  scope: string[];
};

export type MultiAgentFinding = {
  role: MultiAgentRole;
  status: 'pass' | 'warn' | 'block';
  title: string;
  summary: string;
  confidence: number;
  recommendations: string[];
  signals: Record<string, unknown>;
  durationMs: number;
  llm?: boolean;
};

export type MultiAgentRuntimeResult = {
  id: string;
  mode: TheOneMode;
  status: 'pass' | 'warn' | 'block';
  qualityScore: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  leases: MultiAgentLease[];
  agents: MultiAgentFinding[];
  consensus: {
    status: 'pass' | 'warn' | 'block';
    summary: string;
    blockers: string[];
    warnings: string[];
    recommendations: string[];
  };
  merge: {
    strategy: 'weighted_consensus';
    acceptedAgents: MultiAgentRole[];
    blockedAgents: MultiAgentRole[];
    warningAgents: MultiAgentRole[];
    selectedRecommendationCount: number;
  };
  stability: {
    leaseStatus: 'released' | 'attention_required';
    releasedLeases: number;
    totalLeases: number;
    qualityGate: 'pass' | 'review' | 'block';
    recovery: 'replay_ready' | 'approval_required' | 'blocked';
    sandbox: 'policy_sandbox' | 'approval_sandbox';
    longRunning: {
      resumable: boolean;
      cancellation: 'lease_expiry';
      mergeRule: 'weighted_consensus';
    };
  };
  executions: ExecutionRecord[];
  proof: ProofRecord[];
};

export type MultiAgentInput = {
  runId: string;
  mode: TheOneMode;
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  approvals: ApprovalGate[];
  permissions: PermissionDecision[];
  memoryContext: MemoryGraphHit[];
  contextFrame: ContextBusFrame;
};

// ── LLM agent system prompts per role ────────────────────────────────────────

const ROLE_PROMPTS: Record<MultiAgentRole, string> = {
  planner: `You are the Planner agent in a multi-agent AI OS runtime.
Review the workflow plan and return a structured JSON assessment.
Focus on: step count and quality, dependency graph correctness, whether external execution (OneClaw) is warranted.
If context.learningHints is non-empty, treat those as lessons from recent runs and factor them into your assessment.
Return JSON with exactly these fields:
{ "status": "pass"|"warn"|"block", "title": string, "summary": string (1-2 sentences), "confidence": number 0-1, "recommendations": string[] (max 3) }`,

  policy: `You are the Policy agent in a multi-agent AI OS runtime.
Review approval gates and permission decisions and return a structured JSON assessment.
Focus on: whether denied permissions block execution, whether required approvals are correctly gated, mode-appropriateness.
Return JSON with exactly these fields:
{ "status": "pass"|"warn"|"block", "title": string, "summary": string (1-2 sentences), "confidence": number 0-1, "recommendations": string[] (max 3) }`,

  critic: `You are the Critic agent in a multi-agent AI OS runtime.
Review the objective and plan for risk, ambiguity, and execution safety. Be skeptical but constructive.
Focus on: vague objectives, high-risk actions without proof gates, missing success criteria.
Return JSON with exactly these fields:
{ "status": "pass"|"warn"|"block", "title": string, "summary": string (1-2 sentences), "confidence": number 0-1, "recommendations": string[] (max 3) }`,

  operator: `You are the Operator agent in a multi-agent AI OS runtime.
Review whether the right execution workers and connectors are routed for this workflow.
Focus on: connector availability vs. need, OneClaw readiness, whether any external action is unnecessarily risky.
Return JSON with exactly these fields:
{ "status": "pass"|"warn"|"block", "title": string, "summary": string (1-2 sentences), "confidence": number 0-1, "recommendations": string[] (max 3) }`,

  memory: `You are the Memory agent in a multi-agent AI OS runtime.
Review available memory context and determine whether prior runs should influence this execution.
Focus on: relevance of memory hits, prior failures or successes that apply, whether context is sufficient.
Return JSON with exactly these fields:
{ "status": "pass"|"warn"|"block", "title": string, "summary": string (1-2 sentences), "confidence": number 0-1, "recommendations": string[] (max 3) }`,
};

// ── LLM agent call ────────────────────────────────────────────────────────────

type LLMAgentPayload = {
  role: MultiAgentRole;
  objective: string;
  mode: string;
  planSummary: string;
  stepCount: number;
  stepActions: string[];
  requiredApprovals: number;
  deniedPermissions: number;
  memoryHits: number;
  topMemorySummary: string;
  connectorCount: number;
  highRiskActions: string[];
  capabilities: string[];
  learningHints: string[];
};

function buildAgentPayload(role: MultiAgentRole, input: MultiAgentInput, learningHints: string[] = []): LLMAgentPayload {
  const highRiskActions = input.plan.steps
    .filter((s) => getActionRisk(s.action) === 'high')
    .map((s) => s.action);

  return {
    role,
    objective: input.intent.objective,
    mode: input.mode,
    planSummary: input.plan.summary,
    stepCount: input.plan.steps.length,
    stepActions: input.plan.steps.map((s) => s.action),
    requiredApprovals: input.approvals.filter((a) => a.required).length,
    deniedPermissions: input.permissions.filter((p) => p.status === 'denied').length,
    memoryHits: input.memoryContext.length,
    topMemorySummary: input.memoryContext[0]?.summary || '',
    connectorCount: (input.plan.capabilityRoute?.connectors || []).length,
    highRiskActions,
    capabilities: input.plan.capabilityRoute?.capabilities || [],
    learningHints,
  };
}

// Recent learning insights become planning hints for every LLM agent call.
async function fetchLearningHints(): Promise<string[]> {
  try {
    const { listLearningInsights } = await import('../learning/learning-engine');
    const insights = await listLearningInsights(10);
    return insights
      .filter((insight: { status?: string }) => insight.status !== 'dismissed')
      .slice(0, 5)
      .map((insight: { title: string; recommendation: string }) => `${insight.title}: ${insight.recommendation}`);
  } catch {
    return [];
  }
}

function isValidStatus(v: unknown): v is 'pass' | 'warn' | 'block' {
  return v === 'pass' || v === 'warn' || v === 'block';
}

function parseAgentLLMResponse(raw: unknown): Omit<MultiAgentFinding, 'role' | 'durationMs' | 'signals' | 'llm'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const status = isValidStatus(r.status) ? r.status : null;
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : null;
  const summary = typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim() : null;
  const confidence = typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1
    ? r.confidence : null;
  const recommendations = Array.isArray(r.recommendations)
    ? r.recommendations.filter((x): x is string => typeof x === 'string').slice(0, 3)
    : null;

  if (!status || !title || !summary || confidence === null || !recommendations) return null;

  return { status, title, summary, confidence, recommendations };
}

async function callLLMAgent(
  role: MultiAgentRole,
  input: MultiAgentInput,
  learningHints: string[] = [],
): Promise<Omit<MultiAgentFinding, 'role' | 'durationMs'> | null> {
  try {
    const payload = buildAgentPayload(role, input, learningHints);
    const result = await runOneAI<Record<string, unknown>>({
      type: 'multi_agent_role_analysis',
      input: {
        systemPrompt: ROLE_PROMPTS[role],
        agentRole: role,
        context: payload,
        responseFormat: 'json',
      },
    });

    if (!result.success) return null;

    const data = extractOneAIData<Record<string, unknown>>(result);
    if (!data) return null;

    // OneAI may wrap the agent result in data.result, data.output, or return directly
    const candidate = (data.result ?? data.output ?? data.analysis ?? data) as unknown;
    const parsed = parseAgentLLMResponse(candidate);
    if (!parsed) return null;

    return {
      ...parsed,
      signals: { payload, llmSource: result.raw },
      llm: true,
    };
  } catch {
    return null;
  }
}

// ── Rule-based fallbacks (original logic) ────────────────────────────────────

function ruleBasedPlanner(input: MultiAgentInput): Omit<MultiAgentFinding, 'role' | 'durationMs'> {
  const steps = input.plan.steps || [];
  const dependencyCount = steps.reduce((n, s) => n + (s.dependsOn?.length || 0), 0);
  const hasExecutable = steps.some((s) => s.action === 'oneclaw.execute');
  return {
    status: steps.length > 0 ? 'pass' : 'warn',
    title: 'Planner checked workflow shape',
    summary: `${steps.length} step(s), ${dependencyCount} dependency edge(s), ${hasExecutable ? 'external execution present' : 'system-only plan'}.`,
    confidence: steps.length > 0 ? 0.86 : 0.48,
    recommendations: hasExecutable
      ? ['Keep external execution behind policy and preflight.']
      : ['No external worker needed unless the objective requires real-world action.'],
    signals: { steps: steps.length, dependencyCount, capabilities: input.plan.capabilityRoute?.capabilities || [] },
  };
}

function ruleBasedPolicy(input: MultiAgentInput): Omit<MultiAgentFinding, 'role' | 'durationMs'> {
  const required = input.approvals.filter((a) => a.required);
  const denied = input.permissions.filter((p) => p.status === 'denied');
  const status = denied.length > 0 ? 'block' : required.length > 0 ? 'warn' : 'pass';
  return {
    status,
    title: 'Policy checked approvals and permission scope',
    summary: `${required.length} approval gate(s), ${denied.length} denied permission(s).`,
    confidence: denied.length > 0 ? 0.95 : 0.82,
    recommendations: denied.length > 0
      ? ['Stop execution until denied permissions are resolved.']
      : required.length > 0
        ? ['Wait for approval before submitting external worker tasks.']
        : ['Low-risk path can continue under current mode.'],
    signals: { requiredApprovals: required.length, deniedPermissions: denied.length, mode: input.mode },
  };
}

function ruleBasedCritic(input: MultiAgentInput): Omit<MultiAgentFinding, 'role' | 'durationMs'> {
  const highRisk = input.plan.steps.filter((s) => getActionRisk(s.action) === 'high');
  const vague = input.intent.objective.trim().length < 12;
  const status = highRisk.length > 0 || vague ? 'warn' : 'pass';
  return {
    status,
    title: 'Critic reviewed risk and ambiguity',
    summary: `${highRisk.length} high-risk step(s); objective is ${vague ? 'too short' : 'specific enough'}.`,
    confidence: 0.78,
    recommendations: [
      ...(highRisk.length ? ['Require proof and receipts for high-risk actions.'] : []),
      ...(vague ? ['Ask for clearer success criteria before autonomous execution.'] : []),
      ...(!highRisk.length && !vague ? ['Proceed with standard proof capture.'] : []),
    ],
    signals: { highRiskActions: highRisk.map((s) => s.action), objectiveLength: input.intent.objective.length },
  };
}

function ruleBasedOperator(input: MultiAgentInput): Omit<MultiAgentFinding, 'role' | 'durationMs'> {
  const connectors = input.plan.capabilityRoute?.connectors || [];
  const external = input.plan.steps.some((s) => s.action === 'oneclaw.execute');
  return {
    status: external && connectors.length === 0 ? 'warn' : 'pass',
    title: 'Operator checked worker route',
    summary: `${connectors.length} connector route(s); ${external ? 'OneClaw execution may be needed' : 'no OneClaw execution required'}.`,
    confidence: 0.8,
    recommendations: external
      ? ['Use OneClaw only after automation policy and connector readiness pass.']
      : ['Complete the workflow in TheOne/OneAI without external action.'],
    signals: { connectors: connectors.map((c) => c.key), external },
  };
}

function ruleBasedMemory(input: MultiAgentInput): Omit<MultiAgentFinding, 'role' | 'durationMs'> {
  const hits = input.memoryContext || [];
  return {
    status: hits.length > 0 ? 'pass' : 'warn',
    title: 'Memory checked historical context',
    summary: `${hits.length} memory hit(s) available for this run.`,
    confidence: hits.length > 0 ? 0.82 : 0.55,
    recommendations: hits.length > 0
      ? ['Use prior receipts and failures as context for safer execution.']
      : ['Store this run as a future reference point.'],
    signals: { memoryHits: hits.length, topMemory: hits[0]?.summary || null, contextResources: input.contextFrame.summary.resourceCount },
  };
}

const RULE_FALLBACKS: Record<MultiAgentRole, (input: MultiAgentInput) => Omit<MultiAgentFinding, 'role' | 'durationMs'>> = {
  planner: ruleBasedPlanner,
  policy: ruleBasedPolicy,
  critic: ruleBasedCritic,
  operator: ruleBasedOperator,
  memory: ruleBasedMemory,
};

// ── Unified agent runner: LLM → fallback ─────────────────────────────────────

async function runAgent(role: MultiAgentRole, input: MultiAgentInput, learningHints: string[] = []): Promise<MultiAgentFinding> {
  const started = Date.now();

  const llmResult = await callLLMAgent(role, input, learningHints);
  const finding = llmResult ?? { ...RULE_FALLBACKS[role](input), llm: false };

  return {
    role,
    ...finding,
    durationMs: Date.now() - started,
  };
}

// ── Consensus + scoring (unchanged) ──────────────────────────────────────────

function consensus(agents: MultiAgentFinding[]): MultiAgentRuntimeResult['consensus'] {
  const blockers = agents.filter((a) => a.status === 'block');
  const warnings = agents.filter((a) => a.status === 'warn');
  const status = blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass';
  return {
    status,
    summary: blockers.length > 0
      ? `${blockers.length} agent(s) blocked autonomous execution.`
      : warnings.length > 0
        ? `${warnings.length} agent(s) requested guarded execution.`
        : 'All agents passed the workflow for governed execution.',
    blockers: blockers.map((a) => `${a.role}: ${a.summary}`),
    warnings: warnings.map((a) => `${a.role}: ${a.summary}`),
    recommendations: Array.from(new Set(agents.flatMap((a) => a.recommendations))).slice(0, 8),
  };
}

function qualityScore(agents: MultiAgentFinding[]) {
  if (!agents.length) return 0;
  const avgConfidence = agents.reduce((sum, a) => sum + a.confidence, 0) / agents.length;
  const warnPenalty = agents.filter((a) => a.status === 'warn').length * 0.08;
  const blockPenalty = agents.filter((a) => a.status === 'block').length * 0.22;
  // LLM agents carry slightly higher weight than rule-based
  const llmBonus = agents.filter((a) => a.llm).length * 0.02;
  return Math.max(0, Math.min(100, Math.round((avgConfidence - warnPenalty - blockPenalty + llmBonus) * 100)));
}

// ── Lease management ──────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function runtimeId() {
  return `mar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createLease(role: MultiAgentRole, runId: string): MultiAgentLease {
  const acquiredAt = now();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const scopes: Record<MultiAgentRole, string[]> = {
    planner: ['plan.read', 'workflow.shape'],
    policy: ['policy.evaluate', 'approval.read'],
    critic: ['plan.review', 'risk.review'],
    operator: ['worker.route', 'connector.read'],
    memory: ['memory.read', 'proof.suggest'],
  };
  return {
    id: `lease_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role,
    status: 'leased',
    acquiredAt,
    expiresAt,
    scope: [`run:${runId}`, ...scopes[role]],
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runMultiAgentRuntime(input: MultiAgentInput): Promise<MultiAgentRuntimeResult> {
  const startedAt = now();
  const startedMs = Date.now();

  const leases = (['planner', 'policy', 'critic', 'operator', 'memory'] as MultiAgentRole[])
    .map((role) => createLease(role, input.runId));

  // Recent learning insights inform every agent's LLM analysis (learn loop)
  const learningHints = await fetchLearningHints();

  // All 5 agents run in parallel; each tries LLM first then falls back to rules
  const agents = await Promise.all(
    (['planner', 'policy', 'critic', 'operator', 'memory'] as MultiAgentRole[]).map(
      (role) => runAgent(role, input, learningHints),
    ),
  );

  const finalConsensus = consensus(agents);
  const finishedAt = now();
  const id = runtimeId();
  const score = qualityScore(agents);
  const llmAgentCount = agents.filter((a) => a.llm).length;

  const merge: MultiAgentRuntimeResult['merge'] = {
    strategy: 'weighted_consensus',
    acceptedAgents: agents.filter((a) => a.status === 'pass').map((a) => a.role),
    blockedAgents: agents.filter((a) => a.status === 'block').map((a) => a.role),
    warningAgents: agents.filter((a) => a.status === 'warn').map((a) => a.role),
    selectedRecommendationCount: finalConsensus.recommendations.length,
  };

  const releasedLeases = leases.length;
  const stability: MultiAgentRuntimeResult['stability'] = {
    leaseStatus: releasedLeases === leases.length ? 'released' : 'attention_required',
    releasedLeases,
    totalLeases: leases.length,
    qualityGate: finalConsensus.status === 'block' ? 'block' : score >= 70 ? 'pass' : 'review',
    recovery: finalConsensus.status === 'block' ? 'blocked' : finalConsensus.status === 'warn' ? 'approval_required' : 'replay_ready',
    sandbox: finalConsensus.status === 'pass' ? 'policy_sandbox' : 'approval_sandbox',
    longRunning: {
      resumable: true,
      cancellation: 'lease_expiry',
      mergeRule: 'weighted_consensus',
    },
  };

  const executions = agents.map((agent) => createExecutionRecord({
    provider: 'theone',
    status: agent.status === 'block' ? 'blocked' : agent.status === 'warn' ? 'running' : 'success',
    summary: `${agent.role} agent${agent.llm ? ' [llm]' : ' [rule]'}: ${agent.summary}`,
    raw: agent,
    receipt: receiptForTheOne(`agent.${agent.role}`, agent.status === 'block' ? 'blocked' : 'success', agent),
  }));

  return {
    id,
    mode: input.mode,
    status: finalConsensus.status,
    qualityScore: score,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    leases: leases.map((lease) => ({ ...lease, status: 'released' })),
    agents,
    consensus: finalConsensus,
    merge,
    stability,
    executions,
    proof: [{
      type: 'system',
      title: 'Multi-agent runtime consensus',
      value: finalConsensus.summary,
      timestamp: finishedAt,
      metadata: {
        runtimeId: id,
        status: finalConsensus.status,
        qualityScore: score,
        llmAgents: llmAgentCount,
        ruleAgents: agents.length - llmAgentCount,
        leases,
        merge,
        stability,
        agents,
        recommendations: finalConsensus.recommendations,
      },
    }],
  };
}
