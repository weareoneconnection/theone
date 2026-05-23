import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { runOneClawAction, getOneClawBridgeStatus, getOneClawCapabilityManifest } from '../providers/oneclaw';
import { runOneAI, extractOneAIData } from '../providers/oneai';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type { ClassifiedIntent, ExecutionPlan, PlanStep, ProofRecord, TheOneMode, TheOneRunResult } from '../types';

export type WebAnalysisInput = {
  url: string;
  focus: string;
  mode?: TheOneMode;
  language?: string;
};

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function compact(value: string, max = 14000) {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function firstText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const root = value as any;
  const candidates = [
    root.text,
    root.content,
    root.body,
    root.result?.text,
    root.result?.content,
    root.steps?.[0]?.output?.text,
    root.steps?.[0]?.output?.content,
    root.steps?.[0]?.output?.body,
    root.task?.steps?.[0]?.output?.text,
    root.task?.steps?.[0]?.output?.content,
    root.task?.steps?.[0]?.output?.body,
  ];
  return candidates.find((item) => typeof item === 'string' && item.trim())?.trim() || '';
}

function taskStatus(value: unknown) {
  const root = value as any;
  return String(root?.status || root?.task?.status || root?.steps?.[0]?.status || '').toLowerCase();
}

function taskId(value: unknown) {
  const root = value as any;
  return root?.id || root?.task?.id || root?.steps?.[0]?.taskId || null;
}

function localSummary(input: { url: string; focus: string; extractedText: string; status: string }) {
  if (!input.extractedText) {
    return input.status.includes('approval') || input.status.includes('pending')
      ? `The website extraction for ${input.url} is waiting for OneClaw approval or worker completion.`
      : `TheOne prepared a website analysis for ${input.url}, but no readable page text was returned yet.`;
  }

  const source = compact(input.extractedText, 1200);
  return [
    `Website: ${input.url}`,
    `Focus: ${input.focus}`,
    '',
    'Useful findings:',
    source,
  ].join('\n');
}

function oneAiText(data: unknown) {
  const record = data && typeof data === 'object' ? data as any : {};
  return String(record.reply || record.summary || record.answer || record.text || '').trim();
}

async function summarizeWithOneAI(input: { url: string; focus: string; extractedText: string; language: string }) {
  const fallback = localSummary({ ...input, status: 'completed' });

  if (!input.extractedText) return fallback;

  try {
    const result = await runOneAI({
      type: 'agent_plan',
      input: {
        goal: [
          `Analyze this website for a normal user.`,
          `URL: ${input.url}`,
          `Focus: ${input.focus}`,
          `Language: ${input.language}`,
          '',
          'Return a concise useful findings brief with:',
          '- what the site appears to be',
          '- useful observations',
          '- risks or gaps if visible',
          '- one practical next action',
          '',
          `Extracted website text:\n${compact(input.extractedText)}`,
        ].join('\n'),
        brand: 'TheOne Web Analysis App',
        chain: 'web_research',
        audience: 'normal users and operators',
        tone: 'clear, practical, concise',
      },
    });
    const data = extractOneAIData(result);
    return oneAiText(data) || fallback;
  } catch (error) {
    return `${fallback}\n\nOneAI summary note: ${error instanceof Error ? error.message : 'OneAI summary unavailable.'}`;
  }
}

export async function runWebAnalysisApp(input: WebAnalysisInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'web';
    url: string;
    focus: string;
    status: string;
    summary: string;
    extractedTextLength: number;
    oneClawTaskId: string | null;
  };
}> {
  const url = normalizeUrl(input.url);
  if (!url) throw new Error('Website URL is required.');

  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [oneClawManifest, oneClawBridge] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
  ]);
  const kernel = getTheOneKernelStatus(mode, oneClawManifest, oneClawBridge);

  const oneclawResult = await runOneClawAction<any>({
    action: 'browser.extract',
    input: { url },
    approvalMode: 'auto',
    idempotencyKey: `web-analysis-${runId}`,
  });
  const status = taskStatus(oneclawResult) || 'submitted';
  const id = taskId(oneclawResult);
  const extractedText = firstText(oneclawResult);
  const completed = /success|completed|mock/.test(status) || Boolean(extractedText);
  const blocked = /awaiting|approval|pending|blocked/.test(status);
  const summary = await summarizeWithOneAI({
    url,
    focus: input.focus || 'Useful findings',
    extractedText,
    language: input.language || 'en',
  });
  const intent: ClassifiedIntent = {
    type: 'knowledge',
    objective: `Analyze ${url}: ${input.focus || 'Useful findings'}`,
    entities: [url],
    constraints: ['public website only', 'record proof'],
    priority: 'normal',
    confidence: 0.94,
    requiresApproval: false,
  };
  const stepStatus = completed ? 'completed' : blocked ? 'blocked' : 'running';
  const steps: PlanStep[] = [
    {
      id: 'web_url',
      title: 'Receive website brief',
      action: 'custom',
      status: 'completed',
      output: { url, focus: input.focus },
      capability: 'research',
    },
    {
      id: 'web_extract',
      title: 'Extract website content',
      action: 'oneclaw.execute',
      status: stepStatus,
      input: { action: 'browser.extract', url },
      output: { taskId: id, textLength: extractedText.length, status },
      dependsOn: ['web_url'],
      capability: 'operate',
    },
    {
      id: 'web_summarize',
      title: 'Summarize useful findings',
      action: 'oneai.generate',
      status: completed || summary ? 'completed' : 'pending',
      output: { summary },
      dependsOn: ['web_extract'],
      capability: 'think',
    },
    {
      id: 'web_proof',
      title: 'Record website proof',
      action: 'proof.write',
      status: completed || summary ? 'completed' : 'pending',
      dependsOn: ['web_summarize'],
      capability: 'record',
    },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary: `Analyze ${url} and produce ${input.focus || 'useful findings'}.`,
    steps,
    estimatedRisk: 'medium',
    capabilityRoute: {
      intentType: 'knowledge',
      objective: intent.objective,
      capabilities: ['research', 'operate', 'think', 'record', 'remember'],
      skills: [],
      apps: [],
      connectors: [],
      risk: 'medium',
      summary: 'Web App routed public website analysis through OneClaw extraction and OneAI summarization.',
    },
  };
  const executions = [
    createExecutionRecord({
      provider: 'oneclaw',
      status: completed ? 'success' : blocked ? 'blocked' : 'submitted',
      summary: `Browser extraction for ${url}`,
      externalId: id,
      taskName: 'action:browser.extract',
      raw: oneclawResult,
    }),
    createExecutionRecord({
      provider: 'oneai',
      status: summary ? 'success' : 'mock',
      summary: 'Website findings summarized.',
      raw: { summary },
    }),
  ];
  const proof: ProofRecord[] = [
    {
      type: 'execution',
      title: 'Website analyzed',
      value: summary.slice(0, 900),
      timestamp: startedAt,
      metadata: {
        app: 'web',
        url,
        focus: input.focus,
        oneClawTaskId: id,
        extractedTextLength: extractedText.length,
      },
    },
  ];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals: [] });
  const appMemoryPack = createAppMemoryPack({
    app: 'web',
    title: `Website findings: ${url}`,
    summary: summary.slice(0, 600),
    facts: [`URL: ${url}`, `Focus: ${input.focus || 'Useful findings'}`, `${extractedText.length} characters captured`],
    nextActions: ['Reuse findings in a report', 'Turn useful points into content', 'Compare against future website scans'],
    sourceRunId: runId,
  });

  return {
    ok: completed || Boolean(summary),
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
      appRoute: 'web',
      oneClawAction: 'browser.extract',
      oneClawTaskId: id,
    },
    os: {
      ...kernel,
      workflow,
      approvals: [],
      executions,
    },
    appMemoryPack,
    appResult: {
      app: 'web',
      url,
      focus: input.focus || 'Useful findings',
      status: completed ? 'completed' : blocked ? 'blocked' : 'running',
      summary,
      extractedTextLength: extractedText.length,
      oneClawTaskId: id,
    },
  };
}
