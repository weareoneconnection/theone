import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest, runOneClawAction } from '../providers/oneclaw';
import { extractOneAIData, runOneAI } from '../providers/oneai';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type { ClassifiedIntent, ExecutionPlan, PlanStep, ProofRecord, TheOneMode, TheOneRunResult } from '../types';

export type XGrowthInput = {
  topic: string;
  goal: string;
  mode?: TheOneMode;
  language?: string;
};

function compact(value: string, max = 9000) {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function taskStatus(value: unknown) {
  const root = value as any;
  return String(root?.status || root?.task?.status || root?.steps?.[0]?.status || '').toLowerCase();
}

function taskId(value: unknown) {
  const root = value as any;
  return root?.id || root?.task?.id || root?.steps?.[0]?.taskId || null;
}

function firstStepOutput(value: unknown) {
  const root = value as any;
  return root?.steps?.[0]?.output || root?.task?.steps?.[0]?.output || root?.output || root?.raw || null;
}

function tweetsFromSearch(value: unknown) {
  const output = firstStepOutput(value) as any;
  const candidates = [
    output?.tweets,
    output?.response?.tweets,
    output?.response?.data,
    output?.data,
  ];
  const tweets = candidates.find((item) => Array.isArray(item));
  return Array.isArray(tweets) ? tweets : [];
}

async function safeSearch(input: { query: string; idempotencyKey: string }) {
  try {
    const result = await runOneClawAction<any>({
      action: 'x.searchRecentTweets',
      input: { query: input.query, maxResults: 10 },
      approvalMode: 'auto',
      idempotencyKey: input.idempotencyKey,
    });
    const status = taskStatus(result);
    const failed = /failed|error|rejected/.test(status);
    return {
      ok: !failed,
      result,
      error: failed ? String(result?.steps?.[0]?.error || result?.error || 'X search failed') : null,
    };
  } catch (error) {
    return {
      ok: false,
      result: null,
      error: error instanceof Error ? error.message : 'X search failed',
    };
  }
}

function localDraft(input: { topic: string; goal: string; tweets: any[]; error?: string | null }) {
  const signals = input.tweets.slice(0, 4).map((tweet) => `- ${String(tweet.text || '').slice(0, 180)}`);
  return [
    `Topic: ${input.topic}`,
    `Goal: ${input.goal}`,
    '',
    signals.length ? `Market signals:\n${signals.join('\n')}` : 'Market signals: no fresh readable tweets returned.',
    input.error ? `\nSearch note: ${input.error}` : '',
    '',
    'Draft post:',
    'AI agents are moving from chat into operating systems: policy, tools, memory, proof, and real execution all have to work together. The useful layer is not just a smarter model, but a governed workflow that can finish real work.',
    '',
    'Reply rule: only reply to tweets that allow replies or mention/engage the account; otherwise prepare a quote/post instead of forcing a reply.',
  ].filter(Boolean).join('\n');
}

function oneAiText(data: unknown) {
  const record = data && typeof data === 'object' ? data as any : {};
  return String(record.reply || record.summary || record.answer || record.text || '').trim();
}

async function draftWithOneAI(input: { topic: string; goal: string; tweets: any[]; error?: string | null; language: string }) {
  const fallback = localDraft(input);

  try {
    const result = await runOneAI({
      type: 'agent_plan',
      input: {
        goal: [
          'Prepare an X growth brief and safe draft for a normal operator.',
          `Topic: ${input.topic}`,
          `Goal: ${input.goal}`,
          `Language: ${input.language}`,
          '',
          'Return:',
          '- what the market is talking about',
          '- a high-signal X post draft under 280 characters',
          '- 2 safe reply angles',
          '- one publishing risk to check before approval',
          '',
          'Important: do not claim the post is published. Replies should only target conversations that allow replies.',
          '',
          `Recent tweets:\n${compact(JSON.stringify(input.tweets.slice(0, 10), null, 2))}`,
          input.error ? `\nSearch error:\n${input.error}` : '',
        ].join('\n'),
        brand: 'TheOne X Growth App',
        chain: 'x_growth',
        audience: 'founders, builders, and operators',
        tone: 'clear, sharp, practical',
      },
    });
    const data = extractOneAIData(result);
    return oneAiText(data) || fallback;
  } catch (error) {
    return `${fallback}\n\nOneAI draft note: ${error instanceof Error ? error.message : 'OneAI draft unavailable.'}`;
  }
}

export async function runXGrowthApp(input: XGrowthInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'x';
    topic: string;
    goal: string;
    status: string;
    summary: string;
    searchTaskId: string | null;
    candidateCount: number;
    degraded: boolean;
  };
}> {
  const topic = input.topic.trim();
  if (!topic) throw new Error('Topic is required.');

  const goal = input.goal || 'Prepare a high-signal X post';
  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [oneClawManifest, oneClawBridge] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
  ]);
  const kernel = getTheOneKernelStatus(mode, oneClawManifest, oneClawBridge);

  const searchResult = await safeSearch({
    query: topic,
    idempotencyKey: `x-growth-${runId}`,
  });
  const tweets = tweetsFromSearch(searchResult.result);
  const degraded = !searchResult.ok;
  const summary = await draftWithOneAI({
    topic,
    goal,
    tweets,
    error: searchResult.error,
    language: input.language || 'en',
  });
  const intent: ClassifiedIntent = {
    type: 'growth',
    objective: `Prepare X growth content for ${topic}`,
    entities: [topic],
    constraints: ['search and draft only', 'publishing requires approval', 'strict replies require reply-eligible tweet targets'],
    priority: 'normal',
    confidence: 0.94,
    requiresApproval: false,
  };
  const steps: PlanStep[] = [
    {
      id: 'x_brief',
      title: 'Receive content brief',
      action: 'custom',
      status: 'completed',
      output: { topic, goal },
      capability: 'plan',
    },
    {
      id: 'x_search',
      title: 'Search X for context',
      action: 'oneclaw.execute',
      status: searchResult.ok ? 'completed' : 'blocked',
      input: { action: 'x.searchRecentTweets', query: topic },
      output: { taskId: taskId(searchResult.result), candidateCount: tweets.length, error: searchResult.error },
      dependsOn: ['x_brief'],
      capability: 'research',
    },
    {
      id: 'x_draft',
      title: 'Prepare safe post and reply angles',
      action: 'oneai.generate',
      status: summary ? 'completed' : 'pending',
      output: { summary },
      dependsOn: ['x_search'],
      capability: 'create',
    },
    {
      id: 'x_proof',
      title: 'Record X growth proof',
      action: 'proof.write',
      status: summary ? 'completed' : 'pending',
      dependsOn: ['x_draft'],
      capability: 'record',
    },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary: `Prepare X growth content for ${topic}.`,
    steps,
    estimatedRisk: 'medium',
    capabilityRoute: {
      intentType: 'growth',
      objective: intent.objective,
      capabilities: ['research', 'create', 'communicate', 'govern', 'record', 'learn'],
      skills: [],
      apps: [],
      connectors: [],
      risk: 'medium',
      summary: 'X App routed market search through OneClaw and generated approval-ready content with OneAI.',
    },
  };
  const executions = [
    createExecutionRecord({
      provider: 'oneclaw',
      status: searchResult.ok ? 'success' : 'blocked',
      summary: `Searched X for ${topic}`,
      externalId: taskId(searchResult.result),
      taskName: 'action:x.searchRecentTweets',
      raw: searchResult.result || { error: searchResult.error },
    }),
    createExecutionRecord({
      provider: 'oneai',
      status: summary ? 'success' : 'mock',
      summary: 'X growth content prepared.',
      raw: { summary },
    }),
  ];
  const proof: ProofRecord[] = [
    {
      type: 'social',
      title: 'X growth draft prepared',
      value: summary.slice(0, 900),
      timestamp: startedAt,
      metadata: {
        app: 'x',
        topic,
        goal,
        searchTaskId: taskId(searchResult.result),
        candidateCount: tweets.length,
        degraded,
      },
    },
  ];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals: [] });
  const appMemoryPack = createAppMemoryPack({
    app: 'x',
    title: `X growth: ${topic}`,
    summary: summary.slice(0, 600),
    facts: [`Topic: ${topic}`, `Goal: ${goal}`, `${tweets.length} candidate tweets returned`, degraded ? 'X search degraded' : 'X search completed'],
    nextActions: ['Review draft before publishing', 'Use strict replies only for eligible targets', 'Keep public posting approval-gated'],
    sourceRunId: runId,
  });

  return {
    ok: searchResult.ok || Boolean(summary),
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
    networkSignals: {
      appRoute: 'x',
      oneClawAction: 'x.searchRecentTweets',
      searchTaskId: taskId(searchResult.result),
    },
    os: {
      ...kernel,
      workflow,
      approvals: [],
      executions,
    },
    appMemoryPack,
    appResult: {
      app: 'x',
      topic,
      goal,
      status: degraded ? 'degraded' : 'completed',
      summary,
      searchTaskId: taskId(searchResult.result),
      candidateCount: tweets.length,
      degraded,
    },
  };
}
