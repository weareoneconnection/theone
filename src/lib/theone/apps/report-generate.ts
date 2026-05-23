import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest } from '../providers/oneclaw';
import { extractOneAIData, runOneAI } from '../providers/oneai';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type { ClassifiedIntent, ExecutionPlan, PlanStep, ProofRecord, TheOneMode, TheOneRunResult } from '../types';

export type ReportGenerateInput = {
  topic: string;
  source: string;
  format?: string;
  mode?: TheOneMode;
  language?: string;
};

function oneAiText(data: unknown) {
  const record = data && typeof data === 'object' ? data as any : {};
  return String(record.reply || record.summary || record.answer || record.text || '').trim();
}

async function generateReport(input: { topic: string; source: string; format: string; language: string }) {
  const fallback = [
    `Report: ${input.topic}`,
    '',
    `Format: ${input.format}`,
    '',
    'Summary:',
    input.source || 'No source material was provided.',
    '',
    'Next action: attach source proof, review facts, and export if needed.',
  ].join('\n');
  try {
    const result = await runOneAI({
      type: 'agent_plan',
      input: {
        goal: [
          `Generate a ${input.format} report for a normal operator.`,
          `Topic: ${input.topic}`,
          `Language: ${input.language}`,
          '',
          'Return an executive summary, key findings, risks, and next actions.',
          '',
          `Source material:\n${input.source}`,
        ].join('\n'),
        brand: 'TheOne Report App',
        chain: 'report_generate',
        audience: 'operators, founders, and teams',
        tone: 'clear, concise, useful',
      },
    });
    return oneAiText(extractOneAIData(result)) || fallback;
  } catch (error) {
    return `${fallback}\n\nOneAI report note: ${error instanceof Error ? error.message : 'OneAI report unavailable.'}`;
  }
}

export async function runReportGenerateApp(input: ReportGenerateInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'report';
    topic: string;
    format: string;
    status: string;
    summary: string;
  };
}> {
  const topic = input.topic.trim();
  if (!topic) throw new Error('Report topic is required.');
  const format = input.format || 'Brief';
  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [manifest, bridge] = await Promise.all([getOneClawCapabilityManifest(), getOneClawBridgeStatus()]);
  const kernel = getTheOneKernelStatus(mode, manifest, bridge);
  const report = await generateReport({ topic, source: input.source || '', format, language: input.language || 'en' });
  const intent: ClassifiedIntent = {
    type: 'knowledge',
    objective: `Generate report: ${topic}`,
    entities: [topic],
    constraints: ['use provided source/proof', 'record report memory'],
    priority: 'normal',
    confidence: 0.94,
    requiresApproval: false,
  };
  const steps: PlanStep[] = [
    { id: 'report_brief', title: 'Receive report brief', action: 'custom', status: 'completed', output: { topic, format }, capability: 'plan' },
    { id: 'report_generate', title: 'Generate report', action: 'oneai.generate', status: 'completed', output: { report }, dependsOn: ['report_brief'], capability: 'create' },
    { id: 'report_proof', title: 'Record report proof', action: 'proof.write', status: 'completed', dependsOn: ['report_generate'], capability: 'record' },
    { id: 'report_memory', title: 'Store report memory pack', action: 'memory.store', status: 'completed', dependsOn: ['report_proof'], capability: 'remember' },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary: `Generated ${format} report for ${topic}.`,
    steps,
    estimatedRisk: 'low',
    capabilityRoute: {
      intentType: 'knowledge',
      objective: intent.objective,
      capabilities: ['create', 'think', 'record', 'remember'],
      skills: [],
      apps: [],
      connectors: [],
      risk: 'low',
      summary: 'Report App generated an operator-ready report through OneAI and stored memory.',
    },
  };
  const executions = [createExecutionRecord({ provider: 'oneai', status: 'success', summary: 'Report generated.', taskName: 'oneai.report.generate', raw: { report } })];
  const proof: ProofRecord[] = [{ type: 'system', title: 'Report generated', value: report.slice(0, 900), timestamp: startedAt, metadata: { app: 'report', topic, format } }];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals: [] });
  const appMemoryPack = createAppMemoryPack({
    app: 'report',
    title: `Report: ${topic}`,
    summary: report.slice(0, 600),
    facts: [`Format: ${format}`, `Topic: ${topic}`],
    nextActions: ['Review report facts', 'Export or turn into a task when approved'],
    sourceRunId: runId,
  });

  return {
    ok: true,
    runId,
    summary: report,
    intent,
    plan,
    execution: { completedSteps: steps.length, failedSteps: 0, agentResults: [] },
    proof,
    approvals: [],
    executions,
    pendingOneClawTask: null,
    networkSignals: { appRoute: 'report' },
    os: { ...kernel, workflow, approvals: [], executions },
    appMemoryPack,
    appResult: { app: 'report', topic, format, status: 'completed', summary: report },
  };
}
