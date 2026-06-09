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
  sourceFiles?: Array<{
    name: string;
    type?: string;
    path?: string;
    summary?: string;
  }>;
};

export type ReportArtifact = {
  schemaVersion: 'theone.report_artifact.v1';
  id: string;
  title: string;
  format: string;
  sourceFiles: Array<{
    name: string;
    type?: string;
    path?: string;
    summary?: string;
  }>;
  executiveSummary: string;
  keyFindings: string[];
  risks: Array<{
    title: string;
    severity: 'low' | 'medium' | 'high';
    evidence?: string;
    action?: string;
  }>;
  actionItems: Array<{
    task: string;
    owner?: string;
    priority?: 'low' | 'medium' | 'high';
    evidence?: string;
  }>;
  evidence: string[];
  sourceExcerpt: string;
  createdAt: string;
};

function oneAiText(data: unknown) {
  const record = data && typeof data === 'object' ? data as any : {};
  return String(record.reply || record.summary || record.answer || record.text || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => typeof item === 'string' ? item.trim() : asString(asRecord(item).title || asRecord(item).text))
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeSeverity(value: unknown): 'low' | 'medium' | 'high' {
  const text = String(value || '').toLowerCase();
  if (text.includes('high') || text.includes('critical') || text.includes('severe')) return 'high';
  if (text.includes('low') || text.includes('minor')) return 'low';
  return 'medium';
}

function fallbackBullets(source: string, topic: string) {
  const lines = source
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((line) => line.length > 24)
    .slice(0, 5);
  return lines.length ? lines : [
    `The source material was reviewed for ${topic}.`,
    'The report should be verified against the original file before external use.',
  ];
}

function buildFallbackReportArtifact(input: {
  topic: string;
  source: string;
  format: string;
  sourceFiles?: ReportArtifact['sourceFiles'];
}): ReportArtifact {
  const bullets = fallbackBullets(input.source, input.topic);
  return {
    schemaVersion: 'theone.report_artifact.v1',
    id: `report_${createRunId()}`,
    title: input.topic,
    format: input.format,
    sourceFiles: input.sourceFiles || [],
    executiveSummary: bullets[0] || `Report prepared for ${input.topic}.`,
    keyFindings: bullets.slice(0, 5),
    risks: [{
      title: 'Source verification required',
      severity: 'medium',
      evidence: 'The report was generated from provided source text.',
      action: 'Review the original source file before sharing or acting on the report.',
    }],
    actionItems: [{
      task: 'Review report facts and evidence',
      priority: 'medium',
      evidence: 'Generated report artifact needs operator review.',
    }],
    evidence: bullets.slice(0, 4),
    sourceExcerpt: input.source.slice(0, 1200),
    createdAt: new Date().toISOString(),
  };
}

function normalizeReportArtifact(value: unknown, fallback: ReportArtifact): ReportArtifact {
  const record = asRecord(value);
  const risksRaw = Array.isArray(record.risks) ? record.risks : [];
  const actionsRaw = Array.isArray(record.actionItems) ? record.actionItems : Array.isArray(record.actions) ? record.actions : [];
  return {
    ...fallback,
    title: asString(record.title, fallback.title),
    executiveSummary: asString(record.executiveSummary, asString(record.summary, fallback.executiveSummary)),
    keyFindings: asStringArray(record.keyFindings, fallback.keyFindings),
    risks: risksRaw.length ? risksRaw.map((item) => {
      const risk = asRecord(item);
      return {
        title: asString(risk.title || risk.risk || risk.issue, 'Risk requires review'),
        severity: normalizeSeverity(risk.severity),
        evidence: asString(risk.evidence),
        action: asString(risk.action || risk.recommendation),
      };
    }).slice(0, 10) : fallback.risks,
    actionItems: actionsRaw.length ? actionsRaw.map((item) => {
      const action = asRecord(item);
      return {
        task: asString(action.task || action.title || action.action, 'Review and decide next step'),
        owner: asString(action.owner),
        priority: normalizeSeverity(action.priority),
        evidence: asString(action.evidence),
      };
    }).slice(0, 12) : fallback.actionItems,
    evidence: asStringArray(record.evidence, fallback.evidence),
    sourceExcerpt: asString(record.sourceExcerpt, fallback.sourceExcerpt),
  };
}

function renderReportArtifactText(artifact: ReportArtifact) {
  return [
    `# ${artifact.title}`,
    '',
    '## Executive summary',
    artifact.executiveSummary,
    '',
    '## Key findings',
    ...artifact.keyFindings.map((item) => `- ${item}`),
    '',
    '## Risks / issues',
    ...artifact.risks.map((item) => `- [${item.severity}] ${item.title}${item.action ? ` Action: ${item.action}` : ''}`),
    '',
    '## Action items',
    ...artifact.actionItems.map((item) => `- ${item.task}${item.owner ? ` Owner: ${item.owner}` : ''}`),
    '',
    '## Evidence',
    ...artifact.evidence.map((item) => `- ${item}`),
  ].join('\n');
}

async function generateReport(input: {
  topic: string;
  source: string;
  format: string;
  language: string;
  sourceFiles?: ReportArtifact['sourceFiles'];
}) {
  const fallback = buildFallbackReportArtifact(input);
  try {
    const result = await runOneAI({
      type: 'agent_plan',
      input: {
        goal: [
          `Generate a ${input.format} report artifact for a normal operator.`,
          `Topic: ${input.topic}`,
          `Language: ${input.language}`,
          '',
          'Return JSON only with: title, executiveSummary, keyFindings, risks, actionItems, evidence, sourceExcerpt.',
          'Risks must include title, severity, evidence, and action. Action items must include task, owner if inferable, priority, and evidence.',
          'Use concise, evidence-backed language. Do not invent details that are not in the source.',
          '',
          `Source material:\n${input.source}`,
        ].join('\n'),
        brand: 'TheOne Report App',
        chain: 'report_generate',
        audience: 'operators, founders, and teams',
        tone: 'clear, concise, useful',
      },
      options: {
        responseFormat: 'json',
        chain: 'theone_report_artifact',
      },
    });
    const data = extractOneAIData(result);
    const artifact = normalizeReportArtifact(data, fallback);
    return {
      artifact,
      text: renderReportArtifactText(artifact) || oneAiText(data) || renderReportArtifactText(fallback),
    };
  } catch (error) {
    const artifact = {
      ...fallback,
      risks: [
        ...fallback.risks,
        {
          title: 'OneAI report generation unavailable',
          severity: 'medium' as const,
          evidence: error instanceof Error ? error.message : 'OneAI report unavailable.',
          action: 'Use fallback report and retry generation if needed.',
        },
      ],
    };
    return {
      artifact,
      text: `${renderReportArtifactText(artifact)}\n\nOneAI report note: ${error instanceof Error ? error.message : 'OneAI report unavailable.'}`,
    };
  }
}

export async function runReportGenerateApp(input: ReportGenerateInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'report';
    topic: string;
    format: string;
    status: string;
    summary: string;
    reportArtifact: ReportArtifact;
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
  const report = await generateReport({
    topic,
    source: input.source || '',
    format,
    language: input.language || 'en',
    sourceFiles: input.sourceFiles,
  });
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
    { id: 'report_generate', title: 'Generate report', action: 'oneai.generate', status: 'completed', output: { reportArtifact: report.artifact }, dependsOn: ['report_brief'], capability: 'create' },
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
  const executions = [createExecutionRecord({ provider: 'oneai', status: 'success', summary: 'Report generated.', taskName: 'oneai.report.generate', raw: { reportArtifact: report.artifact, text: report.text } })];
  const proof: ProofRecord[] = [{ type: 'system', title: 'Report generated', value: report.text.slice(0, 900), timestamp: startedAt, metadata: { app: 'report', topic, format, reportArtifact: report.artifact } }];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals: [] });
  const appMemoryPack = createAppMemoryPack({
    app: 'report',
    title: `Report: ${topic}`,
    summary: report.artifact.executiveSummary.slice(0, 600),
    facts: [`Format: ${format}`, `Topic: ${topic}`, ...report.artifact.keyFindings.slice(0, 3)],
    nextActions: report.artifact.actionItems.slice(0, 4).map((item) => item.task).concat('Export or turn into a task when approved'),
    sourceRunId: runId,
  });

  return {
    ok: true,
    runId,
    summary: report.text,
    intent,
    plan,
    execution: { completedSteps: steps.length, failedSteps: 0, agentResults: [] },
    proof,
    approvals: [],
    executions,
    pendingOneClawTask: null,
    networkSignals: { appRoute: 'report', reportArtifact: report.artifact },
    os: { ...kernel, workflow, approvals: [], executions },
    appMemoryPack,
    appResult: { app: 'report', topic, format, status: 'completed', summary: report.text, reportArtifact: report.artifact },
  };
}
