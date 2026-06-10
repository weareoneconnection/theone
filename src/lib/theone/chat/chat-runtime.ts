import { attachAutomationPolicyToTask, evaluateAutomationPolicy } from '../policy/automation-engine';
import { evaluateOneClawTaskPolicy } from '../policy/approval-policy';
import { normalizeOneClawTaskContract } from '../execution/task-contracts';
import { preflightOneClawTask } from '../execution/preflight';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace, markApprovalBlockedSteps } from '../runtime/workflow-runtime';
import { getTheOneKernelStatus } from '../kernel/status';
import { extractOneAIData, runOneAI } from '../providers/oneai';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest, runOneClawTask } from '../providers/oneclaw';
import { normalizeWorkerReceipt } from '../providers/receipts';
import { listEnabledAppRuntimePackages, selectAppRuntimePackagesFromCatalog } from '../apps/runtime-packages';
import { resolveTheOneModel } from '../models/model-router';
import { buildUniversalWorkerCatalog } from '../workers/action-catalog';
import { queryMemoryGraph } from '../state/run-store';
import { exportReportArtifact, type ReportExportBundle, type TheOneReportArtifact } from '../report-artifacts';
import { buildBrainOnlyReply, buildTheOneBrainFrame } from './brain-layer';
import { buildOneAIChatWorkflow, type TheOneChatMessage } from './oneai-workflow-builder';
import type {
  ApprovalGate,
  ClassifiedIntent,
  ExecutionPlan,
  OneClawTask,
  OneClawTaskRun,
  PlanStep,
  ProofRecord,
  TheOneMode,
  TheOneRunResult,
} from '../types';

export type TheOneChatRuntimeInput = {
  messages: TheOneChatMessage[];
  input?: string;
  mode?: TheOneMode;
  userId?: string;
  sessionId?: string;
  contextHint?: string;
};

function latestUserMessage(messages: TheOneChatMessage[], explicit?: string) {
  if (explicit?.trim()) return explicit.trim();
  return [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';
}

function normalizeMode(value: unknown): TheOneMode {
  return value === 'manual' || value === 'auto' || value === 'assist' ? value : 'assist';
}

function executionStatus(raw: OneClawTaskRun | null, blocked: boolean): 'submitted' | 'blocked' | 'failed' | 'mock' | 'planned' {
  if (raw?.mock) return 'mock';
  if (raw?.status && /fail|error|rejected/i.test(raw.status)) return 'failed';
  if (raw?.status && /success|complete|submitted|running|queued|awaiting/i.test(raw.status)) return 'submitted';
  if (blocked) return 'blocked';
  return 'planned';
}

function oneClawRunFailed(run: OneClawTaskRun | null) {
  return Boolean(run?.status && /fail|error|rejected/i.test(run.status));
}

function mapApprovalsForAutomation(input: {
  approvals: ApprovalGate[];
  automationBlocked: boolean;
  automationManual: boolean;
}) {
  if (input.automationBlocked) {
    return input.approvals.map((approval) => ({
      ...approval,
      required: true,
      status: 'rejected' as const,
      reason: `${approval.reason} Automation policy blocked this action.`,
    }));
  }

  if (input.automationManual) {
    return input.approvals.map((approval) => ({
      ...approval,
      required: true,
      status: 'pending' as const,
      reason: `${approval.reason} TheOne Chat Runtime requires human approval.`,
    }));
  }

  return input.approvals;
}

function proof(input: {
  title: string;
  value: string;
  metadata?: Record<string, unknown>;
}): ProofRecord {
  return {
    type: 'system',
    title: input.title,
    value: input.value,
    metadata: input.metadata,
    timestamp: new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compactJson(value: unknown, limit = 6000) {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > limit ? `${text.slice(0, limit)}\n...truncated` : text;
  } catch {
    return String(value || '');
  }
}

function collectTextFragments(value: unknown, fragments: string[] = [], depth = 0) {
  if (depth > 5 || fragments.join('\n').length > 9000) return fragments;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 40) fragments.push(trimmed);
    return fragments;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectTextFragments(item, fragments, depth + 1));
    return fragments;
  }
  if (isRecord(value)) {
    for (const key of ['summary', 'text', 'content', 'body', 'markdown', 'title', 'description']) {
      collectTextFragments(value[key], fragments, depth + 1);
    }
    for (const key of ['output', 'response', 'data', 'result', 'artifact', 'artifacts', 'steps']) {
      collectTextFragments(value[key], fragments, depth + 1);
    }
  }
  return fragments;
}

function extractWorkerResultText(run: OneClawTaskRun | null) {
  if (!run) return '';
  const source = isRecord(run) && run.raw ? run.raw : run;
  const fragments = collectTextFragments(source)
    .map((fragment) => fragment.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return Array.from(new Set(fragments)).join('\n\n').slice(0, 9000);
}

function normalizeOneClawRunForChat(run: OneClawTaskRun | null, task: OneClawTask | null) {
  if (!run) return null;
  return normalizeWorkerReceipt({
    provider: 'oneclaw',
    taskName: task?.taskName || run.taskName || null,
    action: task?.steps?.[0]?.action || null,
    status: run.status,
    raw: run.raw ?? run,
  });
}

function firstTaskStepInput(task: { steps?: Array<{ input?: Record<string, unknown>; action?: string }> } | null | undefined) {
  return task?.steps?.[0]?.input || {};
}

function firstTaskAction(task: { steps?: Array<{ action?: string }> } | null | undefined) {
  return task?.steps?.[0]?.action || '';
}

function textField(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const SOCIAL_POST_MAX_CHARS = 280;

function countPostCharacters(value: string) {
  return Array.from(value).length;
}

function socialPostContentField(input: Record<string, unknown>) {
  for (const key of ['content', 'text', 'body', 'message']) {
    const value = textField(input[key]);
    if (value) return { key, value };
  }
  return null;
}

function fallbackShortPost(content: string) {
  const cleaned = content
    .replace(/\s+/g, ' ')
    .replace(/\b(exciting news|stay tuned for more updates|this evolution will|revolutionize your workflow and productivity)[!.]?/gi, '')
    .trim();
  const base = cleaned || content.replace(/\s+/g, ' ').trim();
  const chars = Array.from(base);
  return chars.length <= SOCIAL_POST_MAX_CHARS
    ? base
    : `${chars.slice(0, SOCIAL_POST_MAX_CHARS - 1).join('').trim()}…`;
}

async function shortenSocialPost(input: {
  content: string;
  raw: string;
  mode: TheOneMode;
}) {
  const fallback = fallbackShortPost(input.content);
  try {
    const result = await runOneAI<unknown>({
      type: 'theone_chat_workflow',
      input: {
        message: [
          'Rewrite this X/Twitter post so it is publication-ready and strictly under 280 characters.',
          'Keep the strategic intent. Remove filler, hype, and repeated claims. Return JSON with shortenedPost only.',
          `User objective: ${input.raw}`,
          `Draft:\n${input.content}`,
        ].join('\n\n'),
        mode: input.mode,
        availableActions: [],
        responseContract: {
          shortenedPost: 'string under 280 characters',
        },
      },
      options: {
        responseFormat: 'json',
        chain: 'theone_social_post_repair',
      },
    });
    const data = extractOneAIData<Record<string, unknown>>(result);
    const candidate = textField(data?.shortenedPost) || textField(data?.assistantReply) || textField(data?.reply);
    return countPostCharacters(candidate) <= SOCIAL_POST_MAX_CHARS ? candidate : fallback;
  } catch {
    return fallback;
  }
}

async function repairOneClawTaskBeforePolicy(input: {
  task: OneClawTask | null;
  raw: string;
  mode: TheOneMode;
}) {
  if (!input.task?.steps?.length) return input.task;
  let repaired = false;
  const steps = [];
  for (const step of input.task.steps) {
    if (step.action !== 'social.post') {
      steps.push(step);
      continue;
    }
    const content = socialPostContentField(step.input || {});
    if (!content || countPostCharacters(content.value) <= SOCIAL_POST_MAX_CHARS) {
      steps.push(step);
      continue;
    }
    const shortened = await shortenSocialPost({
      content: content.value,
      raw: input.raw,
      mode: input.mode,
    });
    repaired = true;
    steps.push({
      ...step,
      input: {
        ...(step.input || {}),
        [content.key]: shortened,
      },
    });
  }
  if (!repaired) return input.task;
  return {
    ...input.task,
    steps,
    metadata: {
      ...(input.task.metadata || {}),
      autoRepair: {
        type: 'social_post_length',
        maxCharacters: SOCIAL_POST_MAX_CHARS,
        repairedAt: new Date().toISOString(),
      },
    },
  };
}

function attachmentContextText(messages: TheOneChatMessage[]) {
  return messages
    .filter((message) => message.role === 'system' && /Attachment:|Attached file context|Content:\n/i.test(message.content))
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 32_000);
}

function isAttachmentReportRequest(raw: string, messages: TheOneChatMessage[]) {
  return Boolean(attachmentContextText(messages)) &&
    /read this|document|file|attachment|report|summary|summarize|analy[sz]e|读|文档|文件|附件|报告|总结|分析/i.test(raw);
}

function taskIncludesAction(task: OneClawTask | null | undefined, action: string) {
  return Boolean(task?.steps?.some((step) => step.action === action));
}

function asksForFileArtifact(raw: string) {
  return /save|export|write.*file|generate.*(docx|pdf|file)|email|send (?:it|the report|report|file|document) to|保存|导出|生成文件|写入文件|另存|邮件|发送到|发给/i.test(raw);
}

function wantsChatReport(raw: string) {
  return /report|summary|summarize|analy[sz]e|read this|document|报告|总结|分析|阅读|读/i.test(raw) &&
    !/email|send .* to|发送到|发给|邮件/i.test(raw);
}

function attachmentInventory(context: string) {
  if (!context.trim()) return [];
  return context
    .split(/\n\n(?=Attachment: )/i)
    .map((block) => {
      const name = block.match(/Attachment:\s*(.+)/i)?.[1]?.trim() || '';
      if (!name) return null;
      const type = block.match(/Type:\s*(.+)/i)?.[1]?.trim() || 'file';
      const size = Number(block.match(/Size:\s*(\d+)/i)?.[1] || 0);
      const path = block.match(/Stored path:\s*(.+)/i)?.[1]?.trim() || '';
      const summary = block.match(/Summary:\s*([\s\S]*?)(?:\nContent:|$)/i)?.[1]?.trim() || '';
      const insightsText = block.match(/Attachment insights:\s*(\{[\s\S]*?\})(?:\nSummary:|\nContent:|$)/i)?.[1]?.trim() || '';
      let insights: Record<string, unknown> | null = null;
      if (insightsText) {
        try {
          const parsed = JSON.parse(insightsText);
          if (isRecord(parsed)) insights = parsed;
        } catch {
          insights = null;
        }
      }
      const hasReadableText = /Content:\n/i.test(block);
      return {
        name,
        type,
        size,
        path,
        summary: summary.slice(0, 800),
        hasReadableText,
        insights,
        recommendedWorker: textField(insights?.recommendedWorker),
        pageEstimate: typeof insights?.pageEstimate === 'number' ? insights.pageEstimate : null,
        wordCount: typeof insights?.wordCount === 'number' ? insights.wordCount : null,
        detectedTopics: Array.isArray(insights?.detectedTopics) ? insights.detectedTopics.map(String).filter(Boolean).slice(0, 8) : [],
        reportSections: Array.isArray(insights?.reportSections) ? insights.reportSections.map(String).filter(Boolean).slice(0, 8) : [],
        evidencePreview: Array.isArray(insights?.evidencePreview) ? insights.evidencePreview.map(String).filter(Boolean).slice(0, 6) : [],
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function buildDocumentRuntime(input: {
  raw: string;
  attachmentContext: string;
  attachmentReport: { summary: string } | null;
  summary: string;
  reportArtifact?: ChatReportArtifact | null;
}) {
  const attachments = attachmentInventory(input.attachmentContext);
  if (!attachments.length && !input.attachmentReport) return null;
  const readable = attachments.filter((attachment) => attachment.hasReadableText).length;
  const workerHints = attachments.map((attachment) => attachment.recommendedWorker).filter(Boolean);
  const topicHints = Array.from(new Set(attachments.flatMap((attachment) => attachment.detectedTopics)));
  const reportSections = Array.from(new Set(attachments.flatMap((attachment) => attachment.reportSections)));
  const reportReady = Boolean(input.attachmentReport || input.summary);
  const artifactReady = Boolean(input.reportArtifact);
  const wantsReport = /report|报告|总结|summary|summarize|分析|analy[sz]e/i.test(input.raw);

  return {
    schemaVersion: 'theone.document_runtime.v1',
    status: artifactReady ? 'artifact_ready' : reportReady ? 'report_ready' : readable ? 'read_ready' : 'needs_worker_read',
    objective: input.raw,
    attachments,
    readableCount: readable,
    sourceQuality: readable ? 'upload_text_ready' : 'worker_read_needed',
    recommendedWorkers: workerHints,
    detectedTopics: topicHints,
    reportSections,
    stages: [
      { key: 'uploaded', title: 'File attached', status: attachments.length ? 'completed' : 'pending' },
      { key: 'classify', title: topicHints.length ? `Classified: ${topicHints.slice(0, 3).join(', ')}` : 'Classify source', status: attachments.length ? 'completed' : 'pending' },
      { key: 'read', title: readable ? 'Readable text extracted' : 'File worker read needed', status: readable ? 'completed' : 'pending' },
      { key: 'analyze', title: 'Evidence analyzed', status: reportReady ? 'completed' : readable ? 'active' : 'pending' },
      { key: 'report', title: wantsReport ? 'Report prepared' : 'Summary prepared', status: reportReady ? 'completed' : 'pending' },
      { key: 'export', title: artifactReady ? 'Export package ready' : 'Export on request', status: artifactReady ? 'available' : 'pending' },
    ],
    report: reportReady ? {
      available: true,
      format: artifactReady ? 'structured' : 'chat',
      summary: input.summary.slice(0, 1200),
      artifactId: input.reportArtifact?.id || null,
    } : null,
    nextActions: [
      'Turn this into a formal report.',
      'Extract risk register and action items.',
      'Export as DOCX or PDF when needed.',
    ],
  };
}

type ChatReportArtifact = TheOneReportArtifact;

function reportLines(summary: string) {
  return summary
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((line) => line.length > 16);
}

function inferSeverity(line: string): 'low' | 'medium' | 'high' {
  if (/critical|urgent|high|major|material|termination|penalty|liquidated|高|重大|严重|违约/i.test(line)) return 'high';
  if (/low|minor|optional|低|轻微/i.test(line)) return 'low';
  return 'medium';
}

function pickReportLines(lines: string[], patterns: RegExp[], fallbackStart = 0) {
  const matches = lines.filter((line) => patterns.some((pattern) => pattern.test(line)));
  return (matches.length ? matches : lines.slice(fallbackStart, fallbackStart + 5)).slice(0, 8);
}

function buildReportArtifactFromSummary(input: {
  raw: string;
  summary: string;
  attachmentContext: string;
}): ChatReportArtifact | null {
  const attachments = attachmentInventory(input.attachmentContext);
  if (!attachments.length || !input.summary.trim()) return null;
  const lines = reportLines(input.summary);
  const executiveSummary = lines.find((line) => !/^#+\s/.test(line)) || input.summary.replace(/\s+/g, ' ').slice(0, 600);
  const keyFindings = pickReportLines(lines, [/finding|发现|scope|范围|deliverable|term|条款|summary|结论/i], 1);
  const riskLines = pickReportLines(lines, [/risk|issue|problem|gap|liabil|delay|penalty|exclusion|风险|问题|缺口|责任|延期|罚/i], 2);
  const actionLines = pickReportLines(lines, [/action|next|review|confirm|approve|prepare|verify|follow|行动|下一步|确认|审核|批准|准备/i], 3);
  const evidence = pickReportLines(lines, [/evidence|source|clause|page|document|附件|证据|来源|条款|页/i], 0);

  return {
    schemaVersion: 'theone.report_artifact.v1',
    id: `chat_report_${createRunId()}`,
    title: input.raw.replace(/\s+/g, ' ').slice(0, 96) || 'Document report',
    format: 'chat_report',
    sourceFiles: attachments.map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      path: attachment.path,
      summary: attachment.summary,
      insights: attachment.insights || undefined,
      pageEstimate: attachment.pageEstimate || undefined,
      wordCount: attachment.wordCount || undefined,
      recommendedWorker: attachment.recommendedWorker || undefined,
    })),
    executiveSummary,
    keyFindings,
    risks: riskLines.map((line) => ({
      title: line,
      severity: inferSeverity(line),
      evidence: line,
      action: 'Review source file and decide mitigation or clarification.',
    })),
    actionItems: actionLines.map((line) => ({
      task: line,
      priority: inferSeverity(line),
      evidence: line,
    })),
    evidence: evidence.slice(0, 8),
    sourceExcerpt: input.summary.slice(0, 1600),
    createdAt: new Date().toISOString(),
  };
}

function extractBalancedJsonObject(value: string) {
  const start = value.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return null;
}

function parsePreviousReportArtifact(messages: TheOneChatMessage[]): ChatReportArtifact | null {
  for (const message of [...messages].reverse()) {
    const marker = 'Report artifact:';
    const index = message.content.indexOf(marker);
    if (index < 0) continue;
    const text = message.content.slice(index + marker.length).trim();
    const candidate = extractBalancedJsonObject(text);
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed) && parsed.schemaVersion === 'theone.report_artifact.v1') return parsed as ChatReportArtifact;
      if (isRecord(parsed) && parsed.id && parsed.executiveSummary) {
        return {
          schemaVersion: 'theone.report_artifact.v1',
          id: textField(parsed.id, `report_${Date.now()}`),
          title: textField(parsed.title, 'Report'),
          format: textField(parsed.format, 'structured'),
          sourceFiles: Array.isArray(parsed.sourceFiles) ? parsed.sourceFiles as ChatReportArtifact['sourceFiles'] : [],
          executiveSummary: textField(parsed.executiveSummary),
          keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings.map((item) => String(item)).filter(Boolean) : [],
          risks: Array.isArray(parsed.risks) ? parsed.risks as ChatReportArtifact['risks'] : [],
          actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems as ChatReportArtifact['actionItems'] : [],
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map((item) => String(item)).filter(Boolean) : [],
          sourceExcerpt: textField(parsed.sourceExcerpt),
          createdAt: textField(parsed.createdAt, new Date().toISOString()),
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function buildDeliveryStatus(input: {
  documentRuntime: ReturnType<typeof buildDocumentRuntime>;
  reportArtifact: ChatReportArtifact | null;
  exportBundle: ReportExportBundle | null;
  approvals: ApprovalGate[];
}) {
  if (!input.documentRuntime && !input.reportArtifact && !input.exportBundle) return null;
  return {
    schemaVersion: 'theone.delivery_status.v1',
    status: input.exportBundle ? 'export_ready' : input.reportArtifact ? 'report_ready' : 'in_progress',
    quality: {
      sourceCoverage: input.documentRuntime?.sourceQuality || 'unknown',
      readableFiles: input.documentRuntime?.readableCount || 0,
      sourceFiles: Array.isArray(input.documentRuntime?.attachments) ? input.documentRuntime.attachments.length : 0,
      reportSections: input.documentRuntime?.reportSections || [],
    },
    stages: [
      { key: 'read', title: 'Read source', status: input.documentRuntime ? 'completed' : 'pending' },
      { key: 'report', title: 'Build report', status: input.reportArtifact ? 'completed' : 'pending' },
      { key: 'export', title: 'Export files', status: input.exportBundle ? 'completed' : 'available' },
      { key: 'approval', title: 'Approval gates', status: input.approvals.some((approval) => approval.status === 'pending') ? 'waiting' : 'clear' },
    ],
    files: input.exportBundle?.files || [],
    nextAction: input.exportBundle
      ? 'Open or download the exported report files.'
      : input.reportArtifact
        ? 'Ask TheOne to export as PDF, DOCX, Markdown, HTML, or JSON.'
        : 'Finish reading and reporting first.',
  };
}

function buildObjectiveAssessment(input: {
  summary: string;
  runtimeError: string | null;
  approvalGated: boolean;
  documentRuntime: ReturnType<typeof buildDocumentRuntime>;
  oneclawRun: OneClawTaskRun | null;
  oneclawTask: OneClawTask | null;
}) {
  const hasAnswer = Boolean(input.summary.trim());
  const documentDone = input.documentRuntime?.status === 'report_ready' || input.documentRuntime?.status === 'artifact_ready';
  const workerDone = Boolean(input.oneclawRun && !input.runtimeError);
  const directAnswer = !input.oneclawTask && hasAnswer;
  const satisfied = Boolean(!input.runtimeError && !input.approvalGated && (documentDone || workerDone || directAnswer));

  return {
    schemaVersion: 'theone.objective_assessment.v1',
    status: satisfied ? 'satisfied' : input.approvalGated ? 'waiting_approval' : input.runtimeError ? 'needs_fix' : 'in_progress',
    satisfied,
    outcome: satisfied
      ? 'The requested outcome has a usable answer or worker result.'
      : input.approvalGated
        ? 'The workflow is prepared, but a human approval is required before execution.'
        : input.runtimeError
          ? `The workflow needs a fix before it can complete: ${input.runtimeError}`
          : 'The workflow has not reached a final worker result yet.',
    evidence: [
      documentDone ? 'Attachment content was read and converted into a report.' : null,
      workerDone ? 'OneClaw returned a worker receipt.' : null,
      directAnswer ? 'TheOne answered directly without external execution.' : null,
    ].filter(Boolean),
    gaps: [
      input.approvalGated ? 'Approval is still waiting.' : null,
      input.runtimeError ? input.runtimeError : null,
      !hasAnswer ? 'No final readable answer was produced yet.' : null,
    ].filter(Boolean),
    nextAction: satisfied
      ? 'Use the result, ask a follow-up, save it, or export it.'
      : input.approvalGated
        ? 'Approve, reject, or ask TheOne to revise the task.'
        : input.runtimeError
          ? 'Retry with the suggested fix or ask TheOne for an alternate route.'
          : 'Continue the mission.',
  };
}

function isProcessPlaceholderReply(value: string) {
  return /(please hold|while i gather|i'?ll extract|i will extract|i will gather|let me gather|i need to extract|proceed with browsing|gather the data|收集数据|正在收集|请稍等)/i.test(value);
}

function objectiveNeedsWorkerResult(raw: string, task: OneClawTask | null) {
  if (!task) return false;
  const action = firstTaskAction(task);
  if (/^(browser\.|git\.|file\.|document\.|spreadsheet\.|image\.|api\.|x\.|social\.)/.test(action)) return true;
  return /(analy[sz]e|summarize|summary|findings|browse|website|web page|inspect|check|read|report|extract|list|分析|总结|浏览|网站|检查|读取|报告|提取)/i.test(raw);
}

function taskOutcomeLabel(task: OneClawTask | null) {
  const action = firstTaskAction(task);
  if (action === 'browser.extract' || action === 'browser.scrape' || action === 'browser.open') return 'website analysis';
  if (action.startsWith('git.')) return 'GitHub check';
  if (action.startsWith('document.') || action.startsWith('file.') || action.startsWith('spreadsheet.') || action.startsWith('image.')) return 'file reading';
  if (action === 'social.post') return 'X publishing';
  if (action.startsWith('api.')) return 'API call';
  return action || 'worker task';
}

function firstBlockedCheck(preflight: unknown) {
  if (!isRecord(preflight)) return '';
  const checks = Array.isArray(preflight.checks) ? preflight.checks : [];
  const failed = checks.find((check) => isRecord(check) && /fail|block|error/i.test(String(check.status || '')));
  if (!isRecord(failed)) return '';
  return textField(failed.detail) || textField(failed.message) || textField(failed.title) || textField(failed.label);
}

function buildUnfinishedExecutionSummary(input: {
  raw: string;
  oneclawTask: OneClawTask | null;
  oneclawRun: OneClawTaskRun | null;
  runtimeError: string | null;
  approvalGated: boolean;
  blocked: boolean;
  canSubmit: boolean;
  workerResultText: string;
  preflight: unknown;
  automationPolicy: { blocked?: boolean; canAutoRun?: boolean; requiresHumanApproval?: boolean; reasons?: string[] };
  approvals: ApprovalGate[];
}) {
  const label = taskOutcomeLabel(input.oneclawTask);
  const action = firstTaskAction(input.oneclawTask);
  const approval = input.approvals.find((item) => item.required && item.status === 'pending');
  const policyReason = input.automationPolicy.reasons?.filter(Boolean).join(' ');
  const blockedCheck = firstBlockedCheck(input.preflight);
  const reason = input.runtimeError || approval?.reason || policyReason || blockedCheck;

  if (!input.oneclawTask) {
    return 'I understood the request, but I did not get a valid worker route yet. Ask me to retry, or provide the missing target such as a URL, file, repository, or API endpoint.';
  }

  if (input.runtimeError) {
    return [
      `I could not finish the ${label}.`,
      `Reason: ${input.runtimeError}`,
      action ? `Worker: ${action}` : '',
      'Next: retry after fixing the connector issue, or ask me to rebuild the workflow with a different route.',
    ].filter(Boolean).join('\n\n');
  }

  if (input.blocked || input.automationPolicy.blocked) {
    return [
      `I prepared the ${label}, but TheOne blocked it before execution.`,
      reason ? `Reason: ${reason}` : 'Reason: policy or preflight did not clear the task.',
      'Next: revise the request or policy, then retry.',
    ].join('\n\n');
  }

  if (input.approvalGated) {
    return [
      `I prepared the ${label}, but it has not run yet because approval is required.`,
      reason ? `Approval reason: ${reason}` : '',
      'Next: approve it, reject it, or ask me to revise the worker task first.',
    ].filter(Boolean).join('\n\n');
  }

  if (input.oneclawRun && input.workerResultText.trim()) {
    return [
      `The ${label} worker returned data, but the final summary pass did not produce a finished answer.`,
      'Readable worker evidence:',
      input.workerResultText.trim().slice(0, 1800),
      'Next: press Continue or Report and I will turn this evidence into a polished summary.',
    ].join('\n\n');
  }

  if (input.oneclawRun) {
    return [
      `The ${label} worker returned a receipt, but I did not receive enough readable content to produce the final answer.`,
      reason ? `Detail: ${reason}` : '',
      'Next: open the run receipt, retry the worker, or ask me to summarize the raw receipt.',
    ].filter(Boolean).join('\n\n');
  }

  if (input.canSubmit || input.automationPolicy.canAutoRun) {
    return [
      `The ${label} is auto-cleared, but I have not received the OneClaw execution receipt yet.`,
      action ? `Worker: ${action}` : '',
      'Next: press Continue or Retry so I can fetch the receipt and finish the answer.',
    ].filter(Boolean).join('\n\n');
  }

  return [
    `I prepared the ${label}, but it did not execute.`,
    reason ? `Reason: ${reason}` : 'Reason: TheOne did not get an executable state from policy or preflight.',
    'Next: press Retry, or ask me to rebuild the workflow.',
  ].join('\n\n');
}

async function generateAttachmentReport(input: {
  raw: string;
  attachmentContext: string;
  mode: TheOneMode;
}) {
  const result = await runOneAI<unknown>({
    type: 'theone_chat_workflow',
    input: {
      message: [
        'The user attached a document or file and asked TheOne to read it.',
        'Write the final answer directly in the chat. Do not create an external worker task. Do not ask for a file path.',
        'If the user asks for a report, produce a practical report with: executive summary, key findings, risks/issues, action items, and evidence from the attachment.',
        'If the document appears to be a contract, subcontract, construction package, commercial document, invoice, schedule, or technical file, adapt the report to that domain.',
        'For construction or subcontract documents, include scope, commercial terms, deadlines, deliverables, exclusions/assumptions, risk clauses, and owner/contractor action items when evidence exists.',
        'Use clear headings and concise bullets. If evidence is missing because the uploaded text is incomplete, say that limitation plainly and recommend the safest next step.',
        `User request: ${input.raw}`,
        `Attachment context:\n${input.attachmentContext}`,
      ].join('\n\n'),
      mode: input.mode,
      availableActions: [],
      responseContract: {
        assistantReply: 'final report text for the user',
        intent: 'document_report',
        workflow: 'reasoning-only',
      },
    },
    options: {
      responseFormat: 'json',
      chain: 'theone_attachment_report',
    },
  });
  const data = extractOneAIData<Record<string, unknown>>(result);
  return {
    result,
    summary: textField(data?.assistantReply) || textField(data?.reply) || textField(data?.summary) ||
      'I read the attached document, but OneAI did not return a readable report.',
  };
}

function capabilityAvailable(actions: Array<{ action: string }>, action: string) {
  return actions.some((capability) => capability.action === action);
}

function chooseAvailableAction(actions: Array<{ action: string }>, candidates: string[]) {
  return candidates.find((action) => capabilityAvailable(actions, action)) || null;
}

function isFileOrAttachmentIntent(raw: string) {
  return /(attachment|attached|file|document|pdf|spreadsheet|image|read|summarize|summary|report|analy[sz]e|附件|文件|文档|合同|报告|总结|分析|读取|图片|表格)/i.test(raw);
}

function extractGitHubRepo(raw: string) {
  if (!/(\bgithub\b|\brepo\b|repository|仓库|代码库)/i.test(raw)) return null;
  const match = raw.match(/(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

function synthesizeGitHubRepoTask(input: {
  raw: string;
  actions: Array<{ action: string }>;
}): OneClawTask | null {
  const repo = extractGitHubRepo(input.raw);
  if (!repo || !capabilityAvailable(input.actions, 'git.repo.get')) return null;

  const steps: OneClawTask['steps'] = [
    {
      id: 'step_1',
      action: 'git.repo.get',
      input: { repo },
      dependsOn: [],
    },
  ];

  if (capabilityAvailable(input.actions, 'git.actions.runs')) {
    steps.push({
      id: 'step_2',
      action: 'git.actions.runs',
      input: { repo },
      dependsOn: [],
    });
  }

  if (capabilityAvailable(input.actions, 'git.checks.list')) {
    steps.push({
      id: 'step_3',
      action: 'git.checks.list',
      input: { repo },
      dependsOn: [],
    });
  }

  return {
    taskName: `chat_github_repo_review_${repo.replace(/[^A-Za-z0-9]+/g, '_')}`,
    approvalMode: 'auto',
    steps,
    metadata: {
      source: 'theone.chat_runtime.github_fallback',
      repo,
      reason: 'TheOne detected a complete GitHub owner/repo shorthand in the user message.',
    },
  };
}

function extractWebUrl(raw: string) {
  const match = raw.match(/https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/i);
  if (!match) return null;
  const value = match[0].replace(/[.,，。]+$/g, '');
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function synthesizeWebExtractTask(input: {
  raw: string;
  actions: Array<{ action: string }>;
}): OneClawTask | null {
  if (!/(website|web page|browse|analy[sz]e|summarize|findings|网页|网站|浏览|总结|分析)/i.test(input.raw)) return null;
  const url = extractWebUrl(input.raw);
  if (!url) return null;
  const action = chooseAvailableAction(input.actions, ['browser.extract', 'browser.scrape']);
  if (!action) return null;

  return {
    taskName: `chat_web_extract_${url.replace(/^https?:\/\//i, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 48)}`,
    approvalMode: 'auto',
    steps: [{
      id: 'step_1',
      action,
      input: { url },
      dependsOn: [],
    }],
    metadata: {
      source: 'theone.chat_runtime.web_fallback',
      domain: 'web',
      routerGuard: 'web_extract',
      url,
      reason: 'TheOne detected a website analysis request and created a read-only browser extraction task when OneAI did not provide one.',
    },
  };
}

function isExplicitWebWorkerRequest(raw: string) {
  return Boolean(extractWebUrl(raw)) &&
    /(website|web page|browse|analy[sz]e|summarize|summary|findings|inspect|extract|网页|网站|浏览|总结|分析|提取)/i.test(raw);
}

function taskContainsGitHubAction(task: OneClawTask | null | undefined) {
  return Boolean(task?.steps?.some((step) => /^git\./i.test(step.action || '')));
}

function inferAttachmentReadAction(input: {
  attachment: ReturnType<typeof attachmentInventory>[number];
  actions: Array<{ action: string }>;
}) {
  const worker = textField(input.attachment.recommendedWorker);
  if (worker && capabilityAvailable(input.actions, worker)) return worker;
  const name = input.attachment.name || '';
  const type = input.attachment.type || '';
  if (/pdf|docx?|rtf/i.test(type) || /\.(pdf|docx?|rtf)$/i.test(name)) {
    return chooseAvailableAction(input.actions, ['document.parse', 'file.read']);
  }
  if (/csv|spreadsheet|excel|sheet/i.test(type) || /\.(csv|tsv|xlsx?|xls)$/i.test(name)) {
    return chooseAvailableAction(input.actions, ['spreadsheet.read', 'file.read']);
  }
  if (/^image\//i.test(type) || /\.(png|jpe?g|webp|gif|heic|tiff?)$/i.test(name)) {
    return chooseAvailableAction(input.actions, ['image.extractText', 'image.analyze', 'file.read']);
  }
  return chooseAvailableAction(input.actions, ['file.read']);
}

function synthesizeAttachmentWorkerTask(input: {
  raw: string;
  attachmentContext: string;
  actions: Array<{ action: string }>;
}): OneClawTask | null {
  if (!isFileOrAttachmentIntent(input.raw)) return null;
  const attachments = attachmentInventory(input.attachmentContext);
  const target = attachments.find((attachment) => attachment.path && !attachment.hasReadableText) ||
    attachments.find((attachment) => attachment.path);
  if (!target?.path) return null;
  const action = inferAttachmentReadAction({ attachment: target, actions: input.actions });
  if (!action) return null;

  return {
    taskName: `chat_attachment_read_${target.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 48) || 'file'}`,
    approvalMode: 'auto',
    steps: [{
      id: 'step_1',
      action,
      input: { path: target.path },
      dependsOn: [],
    }],
    metadata: {
      source: 'theone.chat_runtime.router_guard',
      domain: 'files',
      routerGuard: 'attachment_worker_read',
      attachmentName: target.name,
      attachmentType: target.type,
      reason: 'TheOne detected an attached file/document request and routed it to the matching file worker before other fallbacks.',
    },
  };
}

function guardOneClawTaskRoute(input: {
  raw: string;
  attachmentContext: string;
  actions: Array<{ action: string }>;
  proposedTask: OneClawTask | null;
}) {
  const attachmentTask = synthesizeAttachmentWorkerTask(input);
  if (!attachmentTask) return { task: input.proposedTask, route: null as string | null };
  if (!input.proposedTask || taskContainsGitHubAction(input.proposedTask)) {
    return { task: attachmentTask, route: 'attachment_worker_read' };
  }
  return { task: input.proposedTask, route: null as string | null };
}

function pendingTaskSummary(input: {
  baseReply: string;
  oneclawTask: {
    approvalMode?: string;
    metadata?: Record<string, unknown>;
    steps?: Array<{ action?: string; input?: Record<string, unknown> }>;
  } | null;
  approvals: ApprovalGate[];
  automationReason?: string;
}) {
  const action = firstTaskAction(input.oneclawTask);
  const stepInput = firstTaskStepInput(input.oneclawTask);
  const approvalReason = input.approvals.find((approval) => approval.required && approval.status === 'pending')?.reason ||
    input.automationReason ||
    'TheOne policy requires approval before this worker can act.';

  if (action === 'social.post') {
    const draft = textField(stepInput.content) || textField(stepInput.text) || textField(stepInput.body);
    const target = textField(stepInput.channel) || 'x';
    const autoRepair = isRecord(input.oneclawTask?.metadata) && isRecord(input.oneclawTask.metadata.autoRepair)
      ? input.oneclawTask.metadata.autoRepair
      : null;
    const repairNote = autoRepair?.type === 'social_post_length'
      ? `TheOne also shortened the draft before approval so it fits X's ${autoRepair.maxCharacters || SOCIAL_POST_MAX_CHARS}-character limit.`
      : '';
    return [
      'I prepared the X post workflow and paused before publishing.',
      '',
      draft ? `Draft post:\n${draft}` : 'Draft post: The publishing worker did not return a readable draft yet.',
      repairNote ? `\n${repairNote}` : '',
      '',
      `Why approval is required: posting to ${target.toUpperCase()} is a public external write action.`,
      `Approval note: ${approvalReason}`,
      '',
      'Approve it when the draft is ready, or ask me to revise the angle, tone, or length first.',
    ].join('\n');
  }

  if (input.oneclawTask?.steps?.length) {
    return [
      input.baseReply,
      '',
      `Prepared worker task: ${input.oneclawTask.steps.map((step) => step.action).filter(Boolean).join(', ')}`,
      `Why approval is required: ${approvalReason}`,
    ].join('\n');
  }

  return input.baseReply;
}

function slugify(value: string, fallback = 'mission') {
  const slug = value
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function createMissionFrame(input: {
  runId: string;
  raw: string;
  mode: TheOneMode;
  brain: ReturnType<typeof buildTheOneBrainFrame>;
  selectedAppPackages: Array<{ key: string; title: string; route: string }>;
}) {
  const primaryApp = input.selectedAppPackages[0] || input.brain.selectedApps[0] || null;
  const missionKey = `chat_${slugify(primaryApp?.key || input.brain.conversationKind)}_${slugify(input.raw)}`;
  const objective = input.brain.objective || input.raw;

  return {
    schemaVersion: 'theone.mission_frame.v1',
    id: `mission_${input.runId}`,
    key: missionKey,
    runId: input.runId,
    title: objective.length > 96 ? `${objective.slice(0, 93)}...` : objective,
    objective,
    mode: input.mode,
    conversationKind: input.brain.conversationKind,
    primaryApp: primaryApp ? {
      key: primaryApp.key,
      title: primaryApp.title,
      route: primaryApp.route,
    } : null,
    workspace: {
      key: primaryApp?.key ? `workspace_${primaryApp.key}` : 'workspace_chat',
      title: primaryApp?.title || 'TheOne Chat Workspace',
      route: primaryApp?.route || '/run',
    },
    recovery: {
      canResume: true,
      resumeWith: `Continue mission ${input.runId}`,
      replayRoute: `/runs/${input.runId}`,
    },
    createdAt: new Date().toISOString(),
  };
}

function buildMemoryContextMessage(memories: any[]): TheOneChatMessage | null {
  if (!memories.length) return null;
  const lines = memories.slice(0, 6).map((item, index) => {
    const title = item.title || item.summary || item.kind || 'memory';
    const summary = item.summary || item.content?.summary || item.content?.mission?.objective || item.content?.mission?.title || '';
    return `${index + 1}. ${title}${summary ? `: ${String(summary).slice(0, 360)}` : ''}`;
  });
  return {
    role: 'system',
    content: [
      'Relevant TheOne memory from previous runs. Use this as background context only; do not invent facts beyond it.',
      ...lines,
    ].join('\n'),
  };
}

function memorySummary(memories: any[]) {
  return {
    count: memories.length,
    latest: memories[0] ? {
      id: memories[0].id,
      kind: memories[0].kind,
      title: memories[0].title || memories[0].summary || memories[0].content?.mission?.title || 'Memory',
      createdAt: memories[0].createdAt,
    } : null,
  };
}

function buildChatContinuityFrame(input: {
  raw: string;
  mission: ReturnType<typeof createMissionFrame>;
  memoryContext: any[];
  workerRuntime?: Record<string, any>;
}) {
  const lower = input.raw.toLowerCase();
  const followUpIntent = /继续|接着|approve|批准|同意|resume|continue|sync|同步/.test(lower)
    ? 'continue_or_approve'
    : /重试|retry|rebuild|重新|换个|alternate/.test(lower)
      ? 'retry_or_rebuild'
      : /改|修改|revise|shorter|longer|tone|语气|更短|更长/.test(lower)
        ? 'revise'
        : /总结|summary|summarize|report|报告/.test(lower)
          ? 'summarize_or_report'
          : 'new_or_direct';

  return {
    schemaVersion: 'theone.chat_continuity.v1',
    activeMissionId: input.mission.id,
    activeRunId: input.mission.runId,
    followUpIntent,
    canContinue: true,
    canRevise: true,
    canRetry: Boolean(input.workerRuntime?.missionState?.canRetry || input.workerRuntime?.diagnostics?.retryable),
    canApprove: input.workerRuntime?.status === 'awaiting_approval',
    memoryHits: input.memoryContext.length,
    continuitySources: [
      input.mission ? 'mission_frame' : null,
      input.workerRuntime ? 'worker_runtime' : null,
      input.memoryContext.length ? 'memory_graph' : null,
    ].filter(Boolean),
  };
}

function buildAgentTimeline(input: {
  mode: TheOneMode;
  workerRuntime: Record<string, any>;
  workflowSteps: Array<{ id?: string; title?: string; action?: string; worker?: string; owner?: string; status?: string }>;
  executions: ExecutionPlan['steps'] | Array<{ provider?: string; status?: string; summary?: string; taskName?: string }>;
  approvals: ApprovalGate[];
  oneclawTask: OneClawTask | null;
  oneclawRun: OneClawTaskRun | null;
  finalSummary: string | null;
}) {
  const pendingApproval = input.approvals.find((approval) => approval.required && approval.status === 'pending');
  const workerSteps = input.workflowSteps.map((step, index) => ({
    key: step.id || `workflow_${index + 1}`,
    actor: step.worker || step.owner || 'theone',
    title: step.title || step.action || 'Workflow step',
    status: step.status || 'ready',
    detail: step.action || 'workflow',
  }));

  return [
    {
      key: 'understand',
      actor: 'TheOne',
      title: 'Understand the goal',
      status: 'completed',
      detail: `Mode: ${input.mode}`,
    },
    {
      key: 'plan',
      actor: 'OneAI',
      title: 'Build or refine the workflow',
      status: workerSteps.length ? 'completed' : 'ready',
      detail: `${workerSteps.length || 1} planned step(s)`,
    },
    {
      key: 'policy',
      actor: 'TheOne',
      title: 'Check policy and mission state',
      status: input.workerRuntime?.missionState?.state || input.workerRuntime?.status || 'validated',
      detail: input.workerRuntime?.diagnostics?.userReadable || 'Policy, preflight, memory, and proof were evaluated.',
    },
    ...workerSteps.slice(0, 8),
    ...(input.oneclawTask ? [{
      key: 'oneclaw',
      actor: 'OneClaw',
      title: input.oneclawRun ? 'Worker returned a receipt' : pendingApproval ? 'Worker waiting for approval' : 'Worker prepared',
      status: input.oneclawRun?.status || (pendingApproval ? 'awaiting_approval' : 'prepared'),
      detail: input.oneclawTask.taskName,
    }] : []),
    {
      key: 'answer',
      actor: 'TheOne',
      title: input.finalSummary ? 'Answer finalized from worker evidence' : 'Answer returned',
      status: input.finalSummary || !input.oneclawTask || pendingApproval ? 'completed' : 'pending',
      detail: pendingApproval ? 'Approval is needed before execution.' : 'Proof and memory were recorded.',
    },
  ];
}

function describeWorkerRuntime(input: {
  oneclawTask: OneClawTask | null;
  oneclawRun: OneClawTaskRun | null;
  oneclawError: string | null;
  blocked: boolean;
  approvalGated: boolean;
  canSubmit: boolean;
  preflight: unknown;
  automationPolicy: { blocked?: boolean; canAutoRun?: boolean; requiresHumanApproval?: boolean; reasons?: string[] };
  approvals: ApprovalGate[];
  finalSummary: string | null;
  workerResultText: string;
}) {
  const failureText = [
    input.oneclawError,
    ...(input.automationPolicy.reasons || []),
    input.approvals.find((item) => item.required && item.status === 'pending')?.reason,
  ].filter(Boolean).join(' ');
  const failureDiagnosis = classifyFailure(failureText);
  const phases = [
    {
      key: 'planned',
      title: 'Workflow planned',
      status: 'completed',
      detail: 'OneAI produced a structured workflow for TheOne to validate.',
    },
    {
      key: 'policy_checked',
      title: 'Policy checked',
      status: input.blocked ? 'blocked' : input.approvalGated ? 'approval_gated' : 'completed',
      detail: input.automationPolicy.reasons?.join(' ') || 'TheOne evaluated preflight, risk, and approval rules.',
    },
    ...(input.oneclawTask ? [{
      key: 'worker_dispatch',
      title: 'Worker dispatch',
      status: input.oneclawRun
        ? 'completed'
        : input.oneclawError
          ? 'failed'
          : input.blocked
            ? 'blocked'
            : input.approvalGated
              ? 'awaiting_approval'
              : input.canSubmit
                ? 'running'
                : 'prepared',
      detail: input.oneclawRun
        ? 'OneClaw returned a worker receipt.'
        : input.oneclawError
          ? input.oneclawError
          : input.approvalGated
            ? 'The worker task is prepared and waiting for approval.'
            : 'The worker task is prepared for execution.',
    }] : []),
    {
      key: 'answer_ready',
      title: 'Answer ready',
      status: input.finalSummary || input.workerResultText || !input.oneclawTask ? 'completed' : 'pending',
      detail: input.finalSummary
        ? 'TheOne returned a polished answer from worker evidence.'
        : input.oneclawTask
          ? 'TheOne is waiting for worker output or approval before finalizing.'
          : 'TheOne answered directly without an external worker.',
    },
  ];
  const current = [...phases].reverse().find((phase) => phase.status !== 'completed') || phases[phases.length - 1];
  const approval = input.approvals.find((item) => item.required && item.status === 'pending');
  const missionState = buildMissionState({
    oneclawTask: input.oneclawTask,
    oneclawRun: input.oneclawRun,
    oneclawError: input.oneclawError,
    blocked: input.blocked,
    approvalGated: input.approvalGated,
    canSubmit: input.canSubmit,
    finalSummary: input.finalSummary,
    workerResultText: input.workerResultText,
    phases,
  });

  return {
    schemaVersion: 'theone.worker_runtime.v1',
    status: input.oneclawError
      ? 'failed'
      : input.blocked
        ? 'blocked'
        : input.approvalGated
          ? 'awaiting_approval'
          : input.oneclawRun || input.finalSummary
            ? 'completed'
            : input.oneclawTask
              ? 'prepared'
              : 'answered',
    current,
    phases,
    diagnostics: {
      userReadable: input.oneclawError
        ? `OneClaw execution failed: ${input.oneclawError}`
        : approval
          ? approval.reason
          : input.blocked
            ? input.automationPolicy.reasons?.join(' ') || 'TheOne blocked this workflow during policy validation.'
            : input.oneclawRun
              ? 'Worker execution completed and returned a receipt.'
              : input.oneclawTask
                ? 'Worker task is prepared and safe to track.'
                : 'No external worker was needed for this response.',
      retryable: Boolean(input.oneclawError) || input.blocked,
      approvalRequired: input.approvalGated,
      category: failureDiagnosis.category,
      severity: failureDiagnosis.severity,
      nextFixes: failureDiagnosis.nextFixes,
    },
    missionState,
    preflight: input.preflight,
  };
}

function buildMissionState(input: {
  oneclawTask: OneClawTask | null;
  oneclawRun: OneClawTaskRun | null;
  oneclawError: string | null;
  blocked: boolean;
  approvalGated: boolean;
  canSubmit: boolean;
  finalSummary: string | null;
  workerResultText: string;
  phases: Array<{ key: string; title: string; status: string; detail: string }>;
}) {
  const state = input.oneclawError
    ? 'failed'
    : input.blocked
      ? 'blocked'
      : input.approvalGated
        ? 'waiting_approval'
        : input.oneclawRun && !(input.finalSummary || input.workerResultText)
          ? 'summarizing'
          : input.finalSummary || input.workerResultText || !input.oneclawTask
            ? 'completed'
            : input.canSubmit
              ? 'executing'
              : input.oneclawTask
                ? 'policy_checked'
                : 'drafted';

  const stageStatus = (key: string) => {
    const order = ['drafted', 'policy_checked', 'waiting_approval', 'executing', 'summarizing', 'completed'];
    if (state === 'failed' || state === 'blocked') {
      if (key === state) return 'active';
      const index = order.indexOf(key);
      const checkpoint = input.approvalGated ? 'waiting_approval' : input.oneclawRun ? 'executing' : 'policy_checked';
      return index >= 0 && index <= order.indexOf(checkpoint) ? 'completed' : 'pending';
    }
    const currentIndex = order.indexOf(state);
    const itemIndex = order.indexOf(key);
    if (itemIndex < currentIndex) return 'completed';
    if (itemIndex === currentIndex) return 'active';
    return 'pending';
  };

  return {
    schemaVersion: 'theone.mission_state.v1',
    state,
    label: state.replace(/_/g, ' '),
    canResume: ['waiting_approval', 'executing', 'summarizing', 'blocked', 'failed', 'policy_checked'].includes(state),
    canRetry: ['failed', 'blocked'].includes(state),
    canRevise: true,
    stages: [
      { key: 'drafted', title: 'Understand goal', status: stageStatus('drafted') },
      { key: 'policy_checked', title: 'Check policy', status: stageStatus('policy_checked') },
      { key: 'waiting_approval', title: 'Wait for approval', status: stageStatus('waiting_approval') },
      { key: 'executing', title: 'Run worker', status: stageStatus('executing') },
      { key: 'summarizing', title: 'Summarize evidence', status: stageStatus('summarizing') },
      { key: 'completed', title: 'Return answer', status: stageStatus('completed') },
      ...(state === 'blocked' ? [{ key: 'blocked', title: 'Blocked', status: 'active' }] : []),
      ...(state === 'failed' ? [{ key: 'failed', title: 'Failed', status: 'active' }] : []),
    ],
    runtimePhases: input.phases.map((phase) => ({
      key: phase.key,
      title: phase.title,
      status: phase.status,
    })),
  };
}

function classifyFailure(text: string) {
  const value = text.toLowerCase();
  if (!value.trim()) {
    return {
      category: 'none',
      severity: 'low',
      nextFixes: ['Continue the conversation or ask TheOne to turn the result into a report.'],
    };
  }
  if (/credential|token|api key|secret|unauthorized|forbidden|401|403/.test(value)) {
    return {
      category: 'credentials_or_permission',
      severity: 'high',
      nextFixes: ['Check connector credentials and permission scope.', 'Reconnect the provider, then retry the mission.'],
    };
  }
  if (/too long|max 280|characters|character limit|字数|超长|超过/.test(value)) {
    return {
      category: 'content_length_limit',
      severity: 'low',
      nextFixes: ['Ask TheOne to shorten the content.', 'Retry after the draft fits the provider limit.'],
    };
  }
  if (/attachment|document|file path|pdf|docx|xlsx|上传|附件|文档|文件/.test(value)) {
    return {
      category: 'document_or_attachment',
      severity: 'medium',
      nextFixes: ['Attach a readable file or provide a file path.', 'Ask TheOne to read the attachment and return a chat report first.'],
    };
  }
  if (/approval|manual|gate|requires human/.test(value)) {
    return {
      category: 'approval_required',
      severity: 'medium',
      nextFixes: ['Review the approval reason.', 'Approve, reject, or ask TheOne to revise the worker task.'],
    };
  }
  if (/policy|blocked|allowlist|not allowed|risk/.test(value)) {
    return {
      category: 'policy_blocked',
      severity: 'high',
      nextFixes: ['Adjust the request or policy allowlist.', 'Ask TheOne to rebuild the workflow with a safer action.'],
    };
  }
  if (/timeout|fetch failed|network|unreachable|econn|host|dns/.test(value)) {
    return {
      category: 'connector_or_network',
      severity: 'medium',
      nextFixes: ['Check whether the connector endpoint is reachable.', 'Retry after the provider or local bridge is online.'],
    };
  }
  if (/missing|required|invalid|schema|input|url|repo/.test(value)) {
    return {
      category: 'invalid_or_missing_input',
      severity: 'medium',
      nextFixes: ['Provide the missing input.', 'Ask TheOne to restate the exact field it needs.'],
    };
  }
  return {
    category: 'worker_failed',
    severity: 'medium',
    nextFixes: ['Open the mission detail and inspect the worker receipt.', 'Retry the worker or ask TheOne for an alternate route.'],
  };
}

async function summarizeWorkerResult(input: {
  rawRequest: string;
  workflowSummary: string;
  oneclawRun: OneClawTaskRun;
  normalizedReceipt?: ReturnType<typeof normalizeWorkerReceipt> | null;
}) {
  const workerResultText = extractWorkerResultText(input.oneclawRun);
  const receiptSummary = input.normalizedReceipt
    ? [
        `Normalized worker summary: ${input.normalizedReceipt.summary}`,
        input.normalizedReceipt.error ? `Worker error: ${input.normalizedReceipt.error}` : '',
        input.normalizedReceipt.evidence?.length ? `Evidence:\n${input.normalizedReceipt.evidence.join('\n\n')}` : '',
        input.normalizedReceipt.artifacts?.length ? `Artifacts: ${input.normalizedReceipt.artifacts.join(', ')}` : '',
      ].filter(Boolean).join('\n\n')
    : '';
  const evidence = [receiptSummary, workerResultText || compactJson(input.oneclawRun, 9000)]
    .filter(Boolean)
    .join('\n\n');

  if (!evidence.trim()) {
    return {
      finalOneAiResult: null as unknown,
      finalSummary: 'OneClaw finished the worker task, but no readable worker result was returned yet.',
      workerResultText: '',
    };
  }

  const finalMessage = [
    'You are finalizing a TheOne chat workflow after OneClaw executed a worker task.',
    'Return a polished user-facing answer. Use the worker evidence directly. Do not ask for approval or another URL if evidence is present.',
    'If the worker failed, start with the exact reason, then give the fastest fix. Do not say the task completed.',
    'Always judge whether the original user objective is satisfied. If not, say what is missing and the next safest action.',
    'Use this answer shape when useful: Outcome, Evidence, Gaps or risks, Next action.',
    'For website analysis, use these sections when possible: Key findings, Positioning, Useful opportunities, Risks or gaps, Recommended next move.',
    'For API, file, GitHub, desktop, or browser work, explain what happened, what evidence supports it, and what the user can do next.',
    'For X/social publishing failures, mention character limits, approval state, or provider restrictions when present.',
    'Do not expose raw JSON unless it is the only useful evidence.',
    `Original user request: ${input.rawRequest}`,
    `Workflow summary: ${input.workflowSummary}`,
    `Worker evidence:\n${evidence}`,
  ].join('\n\n');
  const modelRoute = resolveTheOneModel('theone.chat.finalize');

  try {
    const finalOneAiResult = await runOneAI<unknown>({
      type: 'theone_chat_workflow',
      input: {
        message: finalMessage,
        mode: 'assist',
        availableActions: [],
        modelRoute,
      },
      options: {
        model: modelRoute.model,
        modelRoute,
      },
    });
    const data = extractOneAIData<Record<string, unknown>>(finalOneAiResult);
    const finalSummary = typeof data?.assistantReply === 'string' && data.assistantReply.trim()
      ? data.assistantReply.trim()
      : evidence.slice(0, 1800);

    return { finalOneAiResult, finalSummary, workerResultText };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OneAI final summary failed.';
    return {
      finalOneAiResult: { success: false, error: message },
      finalSummary: workerResultText
        ? `OneClaw returned worker data, but the final OneAI summary pass failed: ${message}\n\n${workerResultText.slice(0, 1800)}`
        : `OneClaw returned a receipt, but the final OneAI summary pass failed: ${message}`,
      workerResultText,
    };
  }
}

function buildIntent(input: {
  raw: string;
  domain: string;
  risk: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
}): ClassifiedIntent {
  return {
    type: input.domain === 'x' || input.domain === 'growth' ? 'growth' : input.domain === 'web' ? 'knowledge' : 'general',
    objective: input.raw,
    entities: [input.domain].filter(Boolean),
    constraints: [],
    priority: 'normal',
    confidence: 0.86,
    requiresApproval: input.requiresApproval,
  };
}

function buildPlan(input: {
  planId: string;
  intent: ClassifiedIntent;
  summary: string;
  oneAiSteps: Array<{ id: string; title: string; action: string; worker: string; dependsOn?: string[] }>;
  hasOneClawTask: boolean;
  oneClawStatus: PlanStep['status'];
  risk: 'low' | 'medium' | 'high';
}): ExecutionPlan {
  const steps: PlanStep[] = [
    {
      id: 'chat_oneai_workflow',
      title: 'OneAI builds structured workflow',
      action: 'oneai.generate',
      status: 'completed',
      output: {
        generatedSteps: input.oneAiSteps.length,
      },
    },
    {
      id: 'chat_theone_policy',
      title: 'TheOne validates workflow and policy',
      action: 'custom',
      status: input.oneClawStatus === 'failed' ? 'failed' : 'completed',
      dependsOn: ['chat_oneai_workflow'],
    },
    ...(input.hasOneClawTask ? [{
      id: 'chat_oneclaw_dispatch',
      title: 'Dispatch approved worker task',
      action: 'oneclaw.execute' as const,
      status: input.oneClawStatus,
      dependsOn: ['chat_theone_policy'],
    }] : []),
    {
      id: 'chat_proof',
      title: 'Return answer and record proof',
      action: 'proof.write',
      status: input.oneClawStatus === 'failed' ? 'failed' : 'completed',
      dependsOn: input.hasOneClawTask ? ['chat_oneclaw_dispatch'] : ['chat_theone_policy'],
    },
  ];

  return {
    id: input.planId,
    intent: input.intent,
    summary: input.summary,
    steps,
    estimatedRisk: input.risk,
    estimatedValue: 'OneAI workflow + TheOne validation + worker coordination',
  };
}

export async function runTheOneChatRuntime(input: TheOneChatRuntimeInput): Promise<TheOneRunResult & {
  chat: Record<string, unknown>;
}> {
  const runId = createRunId();
  const planId = createPlanId();
  const mode = normalizeMode(input.mode);
  const messages = input.messages || [];
  const raw = latestUserMessage(messages, input.input);
  const planningRaw = [raw, input.contextHint?.trim()].filter(Boolean).join('\n\n');

  if (!raw) {
    throw new Error('A user message is required.');
  }

  const [oneClawManifest, oneClawBridge] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
  ]);
  const kernel = getTheOneKernelStatus(mode, oneClawManifest, oneClawBridge);
  const workerCatalog = buildUniversalWorkerCatalog({
    capabilities: oneClawManifest.capabilities,
    connectors: oneClawManifest.connectors || [],
  });
  const appPackages = await listEnabledAppRuntimePackages();
  const selectedAppPackages = selectAppRuntimePackagesFromCatalog(planningRaw, appPackages).slice(0, 3);
  const primaryModel = resolveTheOneModel('theone.chat.primary');
  const brain = buildTheOneBrainFrame({
    raw: planningRaw,
    mode,
    messages,
    appPackages,
    selectedAppPackages,
    workerCatalogSummary: workerCatalog.summary,
    workerCatalogActions: workerCatalog.actions,
  });
  const mission = createMissionFrame({
    runId,
    raw,
    mode,
    brain,
    selectedAppPackages,
  });
  const memoryContext = await queryMemoryGraph({
    query: planningRaw,
    intentType: brain.conversationKind,
    capabilities: brain.capabilityRoute,
    limit: 6,
  }).catch(() => []);
  const memoryContextMessage = buildMemoryContextMessage(memoryContext);
  const contextualMessages = memoryContextMessage ? [memoryContextMessage, ...messages] : messages;
  const attachmentContext = attachmentContextText(contextualMessages);
  const previousReportArtifact = parsePreviousReportArtifact(contextualMessages);
  const directReportExport = Boolean(previousReportArtifact && asksForFileArtifact(raw));

  if (!directReportExport && (!brain.executionDecision.shouldPlan || brain.reasoning.missingInformation.length > 0)) {
    let brainOnlyOneAi: Awaited<ReturnType<typeof buildOneAIChatWorkflow>> | null = null;
    let summary = buildBrainOnlyReply({ brain, appPackages });

    try {
      brainOnlyOneAi = await buildOneAIChatWorkflow({
        raw,
        mode,
        messages: contextualMessages,
        capabilities: oneClawManifest.capabilities,
        workerCatalog,
        appPackages,
        brain,
      });
      if (brainOnlyOneAi.workflow.assistantReply.trim()) {
        summary = brainOnlyOneAi.workflow.assistantReply.trim();
      }
    } catch {
      brainOnlyOneAi = null;
    }

    const intent = buildIntent({
      raw: brain.objective,
      domain: brain.conversationKind,
      risk: brain.safety.risk,
      requiresApproval: brain.executionDecision.approvalExpected,
    });
    const preflight = preflightOneClawTask({
      task: null,
      intent,
      mode,
      capabilities: oneClawManifest.capabilities,
    });
    const plan = buildPlan({
      planId,
      intent,
      summary: brain.reasoning.strategy,
      oneAiSteps: [{
        id: 'brain_understanding',
        title: 'TheOne Brain understands the conversation',
        action: 'theone.brain',
        worker: 'theone',
        dependsOn: [],
      }],
      hasOneClawTask: false,
      oneClawStatus: 'skipped',
      risk: brain.safety.risk,
    });
    const workflow = createWorkflowTrace({ runId, mode, plan, approvals: [] });
    const workerRuntime = describeWorkerRuntime({
      oneclawTask: null,
      oneclawRun: null,
      oneclawError: null,
      blocked: false,
      approvalGated: false,
      canSubmit: false,
      preflight,
      automationPolicy: { blocked: false, canAutoRun: false, requiresHumanApproval: false, reasons: [] },
      approvals: [],
      finalSummary: summary,
      workerResultText: '',
    });
    const missionState = workerRuntime.missionState;
    const continuity = buildChatContinuityFrame({
      raw,
      mission,
      memoryContext,
      workerRuntime,
    });
    const proofRecords = [
      proof({
        title: 'TheOne Brain handled conversation',
        value: summary,
        metadata: {
          source: 'theone.brain_layer',
          mission,
          brain,
          workerRuntime,
          modelRoute: primaryModel,
          selectedAppPackages,
          memoryContext: memorySummary(memoryContext),
          continuity,
          missionState,
          workerCatalogSummary: workerCatalog.summary,
          oneAiBrain: brainOnlyOneAi?.workflow.oneAiBrain || null,
          preflight,
        },
      }),
    ];
    const executions = [
      ...(brainOnlyOneAi ? [createExecutionRecord({
        provider: 'oneai' as const,
        status: brainOnlyOneAi.oneAiResult.mock ? 'mock' : brainOnlyOneAi.oneAiResult.success ? 'success' : 'failed',
        summary: 'OneAI generated the natural brain-layer chat reply.',
        taskName: 'oneai.chat.brain_reply',
        raw: brainOnlyOneAi.oneAiResult,
      })] : []),
      createExecutionRecord({
        provider: 'theone',
        status: 'success',
        summary: 'TheOne Brain answered without external worker execution.',
        taskName: 'theone.brain.respond',
        raw: { brain, preflight },
      }),
    ];
    const agentTimeline = buildAgentTimeline({
      mode,
      workerRuntime,
      workflowSteps: [{
        id: 'brain_understanding',
        title: 'Understand and answer',
        action: 'oneai.generate',
        worker: 'oneai',
        status: 'completed',
      }],
      executions,
      approvals: [],
      oneclawTask: null,
      oneclawRun: null,
      finalSummary: summary,
    });

    return {
      ok: true,
      runId,
      summary,
      intent,
      plan,
      execution: {
        completedSteps: plan.steps.filter((step) => step.status === 'completed').length,
        failedSteps: plan.steps.filter((step) => step.status === 'failed').length,
        agentResults: [],
      },
      proof: proofRecords,
      approvals: [],
      executions,
      pendingOneClawTask: null,
      preflight,
      os: {
        ...kernel,
        workflow,
        approvals: [],
        executions,
        oneClawManifest,
        oneClawBridge,
        preflight,
      },
      networkSignals: {
        routedBy: 'theone.brain_layer',
        mission,
        workerRuntime,
        missionState,
        continuity,
        agentTimeline,
        modelRoute: primaryModel,
        selectedAppPackages: selectedAppPackages.map((pkg) => pkg.key),
        memoryContext: memorySummary(memoryContext),
        workerCatalogSummary: workerCatalog.summary,
        brainMode: brain.mode,
        conversationKind: brain.conversationKind,
        oneAiBrain: brainOnlyOneAi?.workflow.oneAiBrain || null,
      },
      chat: {
        runtime: 'theone.chat_runtime.v2',
        mission,
        brain,
        workerRuntime,
        missionState,
        continuity,
        oneAiBrainReply: brainOnlyOneAi?.workflow || null,
        oneAiBrain: brainOnlyOneAi?.workflow.oneAiBrain || null,
        modelRoute: primaryModel,
        memoryContext: memorySummary(memoryContext),
        appPackages: brain.selectedApps.length ? brain.selectedApps : appPackages.slice(0, 4),
        workerCatalog: workerCatalog.summary,
        assistant: {
          role: 'assistant',
          content: summary,
          createdAt: new Date().toISOString(),
        },
        oneAiWorkflow: {
          id: `brain_only_${runId}`,
          summary: brain.reasoning.strategy,
          source: brainOnlyOneAi ? 'oneai' : 'theone.brain',
          owner: brainOnlyOneAi ? 'OneAI' : 'TheOne',
          status: 'validated',
          planningBrain: brainOnlyOneAi?.workflow.oneAiBrain || null,
          steps: (brainOnlyOneAi?.workflow.workflow.steps || [{
            id: 'brain_understanding',
            title: 'Understand and answer',
            worker: 'oneai',
            action: 'oneai.generate',
            input: { objective: brain.objective },
            dependsOn: [],
          }]).map((step) => ({
            ...step,
            owner: step.worker || 'oneai',
            status: 'completed',
          })),
        },
        workerCoordination: {
          mode,
          requiredWorkers: ['theone'],
          workers: [
            {
              key: 'theone',
              title: 'TheOne Brain',
              role: 'Understands the conversation, chooses strategy, and decides whether workers are needed.',
              status: 'ready',
            },
          ],
          oneclawTask: null,
          oneclawRun: null,
          workerResultText: '',
          finalSummary: summary,
          approvalSummary: null,
          automationPolicy: null,
          preflight,
          workerRuntime,
          missionState,
          continuity,
        },
        nextActions: brain.nextMoves,
      },
    };
  }

  const oneAi = await buildOneAIChatWorkflow({
    raw,
    mode,
    messages: contextualMessages,
    capabilities: oneClawManifest.capabilities,
    workerCatalog,
    appPackages,
    brain,
  });
  const directAttachmentReport = isAttachmentReportRequest(raw, contextualMessages) &&
    (!asksForFileArtifact(raw) || wantsChatReport(raw));
  const oneAiProposedDocumentWorker = taskIncludesAction(oneAi.oneclawTask, 'document.generate') ||
    oneAi.workflow.workflow.steps.some((step) => step.action === 'document.generate');
  const attachmentReport = directAttachmentReport
    ? await generateAttachmentReport({ raw, attachmentContext, mode }).catch(() => null)
    : null;
  const directExportSummary = directReportExport
    ? 'I exported the current report artifact into downloadable files: Markdown, HTML, JSON, PDF, and DOCX.'
    : null;
  const effectiveOneAi = directReportExport
    ? {
        ...oneAi,
        workflow: {
          ...oneAi.workflow,
          assistantReply: directExportSummary || 'I exported the current report artifact into downloadable files.',
          workflow: {
            ...oneAi.workflow.workflow,
            summary: 'Export the current report artifact into usable files.',
            steps: [
              {
                id: 'report_export',
                title: 'Export report artifact',
                worker: 'theone',
                action: 'theone.report.export',
                input: { objective: raw, artifactId: previousReportArtifact?.id },
                approvalMode: 'auto' as const,
                dependsOn: [],
              },
            ],
          },
          requiredWorkers: ['theone'],
          oneclawTask: null,
          safety: {
            requiresApproval: false,
            reason: 'Exporting an existing report artifact is handled locally by TheOne.',
          },
        },
        oneclawTask: null,
      }
    : attachmentReport
    ? {
        ...oneAi,
        workflow: {
          ...oneAi.workflow,
          assistantReply: attachmentReport.summary,
          workflow: {
            ...oneAi.workflow.workflow,
            summary: 'Read the attached document and produce a chat report.',
            steps: [
              {
                id: 'attachment_report',
                title: 'Read attachment and write report',
                worker: 'oneai',
                action: 'oneai.generate',
                input: { objective: raw, source: 'attached_file_context' },
                approvalMode: 'auto' as const,
                dependsOn: [],
              },
            ],
          },
          requiredWorkers: ['oneai', 'theone'],
          oneclawTask: null,
          safety: {
            requiresApproval: false,
            reason: 'Reading an uploaded attachment and writing a chat report does not require external execution.',
          },
        },
        oneAiResult: attachmentReport.result as typeof oneAi.oneAiResult,
        oneclawTask: null,
      }
    : oneAi;
  const attachmentFallbackTask = effectiveOneAi.oneclawTask ? null : synthesizeAttachmentWorkerTask({
    raw,
    attachmentContext,
    actions: oneClawManifest.capabilities,
  });
  const forcedWebFallbackTask = !attachmentFallbackTask && isExplicitWebWorkerRequest(raw)
    ? synthesizeWebExtractTask({
        raw,
        actions: oneClawManifest.capabilities,
      })
    : null;
  const webFallbackTask = attachmentFallbackTask
    ? null
    : forcedWebFallbackTask || (!effectiveOneAi.oneclawTask ? synthesizeWebExtractTask({
        raw,
        actions: oneClawManifest.capabilities,
      }) : null);
  const githubFallbackTask = effectiveOneAi.oneclawTask || attachmentFallbackTask || webFallbackTask ? null : synthesizeGitHubRepoTask({
    raw,
    actions: oneClawManifest.capabilities,
  });
  const fallbackOneClawTask = attachmentFallbackTask || webFallbackTask || githubFallbackTask;
  const proposedOneClawTask = forcedWebFallbackTask || effectiveOneAi.oneclawTask || fallbackOneClawTask;
  const guardedRoute = guardOneClawTaskRoute({
    raw,
    attachmentContext,
    actions: oneClawManifest.capabilities,
    proposedTask: proposedOneClawTask,
  });
  const rawPlannedOneClawTask = guardedRoute.task;
  const fallbackRoute = guardedRoute.route ||
    (attachmentFallbackTask ? 'attachment_worker_read' : webFallbackTask ? 'web_extract' : githubFallbackTask ? 'github_repo_shorthand' : null);
  const plannedWorkflowSteps = rawPlannedOneClawTask && fallbackRoute === 'attachment_worker_read'
    ? [
        ...effectiveOneAi.workflow.workflow.steps,
        ...rawPlannedOneClawTask.steps.map((step, index) => ({
          id: step.id || `attachment_step_${index + 1}`,
          title: step.action === 'document.parse'
            ? 'Parse attached document'
            : step.action === 'spreadsheet.read'
              ? 'Read attached spreadsheet'
              : step.action === 'image.extractText'
                ? 'Extract text from attached image'
                : step.action === 'image.analyze'
                  ? 'Analyze attached image'
                  : 'Read attached file',
          worker: step.action.startsWith('image.') ? 'image_worker' : step.action === 'spreadsheet.read' ? 'spreadsheet_worker' : step.action === 'document.parse' ? 'document_worker' : 'file_worker',
          action: step.action,
          input: step.input,
          approvalMode: 'auto' as const,
          dependsOn: step.dependsOn || [],
        })),
      ]
    : rawPlannedOneClawTask && fallbackRoute === 'web_extract'
    ? [
        ...effectiveOneAi.workflow.workflow.steps,
        ...rawPlannedOneClawTask.steps.map((step, index) => ({
          id: step.id || `web_step_${index + 1}`,
          title: step.action === 'browser.scrape' ? 'Scrape website content' : 'Extract website content',
          worker: 'browser_worker',
          action: step.action,
          input: step.input,
          approvalMode: 'auto' as const,
          dependsOn: step.dependsOn || [],
        })),
      ]
    : rawPlannedOneClawTask && fallbackRoute === 'github_repo_shorthand'
    ? [
        ...effectiveOneAi.workflow.workflow.steps,
        ...rawPlannedOneClawTask.steps.map((step, index) => ({
          id: step.id || `github_step_${index + 1}`,
          title: step.action === 'git.repo.get'
            ? 'Read GitHub repository metadata'
            : step.action === 'git.actions.runs'
              ? 'Read recent GitHub Actions runs'
              : step.action === 'git.checks.list'
                ? 'Read GitHub check status'
                : step.action,
          worker: 'github_worker',
          action: step.action,
          input: step.input,
          approvalMode: 'auto' as const,
          dependsOn: step.dependsOn || [],
        })),
      ]
    : effectiveOneAi.workflow.workflow.steps;
  const workflowSummary = fallbackRoute === 'attachment_worker_read'
    ? 'Read the attached source with the matching file worker and prepare a report-ready result.'
    : fallbackRoute === 'web_extract'
      ? `Extract website content from ${rawPlannedOneClawTask?.metadata?.url || 'the requested URL'} and summarize useful findings.`
    : fallbackRoute === 'github_repo_shorthand'
    ? `Check GitHub repository ${rawPlannedOneClawTask?.metadata?.repo || ''} and summarize attention points.`
    : effectiveOneAi.workflow.workflow.summary;
  const workflowDomain = fallbackRoute === 'attachment_worker_read'
    ? 'files'
    : fallbackRoute === 'web_extract'
      ? 'web'
    : fallbackRoute === 'github_repo_shorthand'
      ? 'github'
      : effectiveOneAi.workflow.intent.domain;

  const intent = buildIntent({
    raw: effectiveOneAi.workflow.intent.objective || raw,
    domain: workflowDomain,
    risk: effectiveOneAi.workflow.intent.risk,
    requiresApproval: effectiveOneAi.workflow.intent.requiresApproval || effectiveOneAi.workflow.safety.requiresApproval,
  });
  const normalizedPlannedOneClawTask = normalizeOneClawTaskContract({
    task: rawPlannedOneClawTask,
    intent,
    oneAiData: effectiveOneAi.workflow as unknown as Record<string, unknown>,
  });
  const plannedOneClawTask = await repairOneClawTaskBeforePolicy({
    task: normalizedPlannedOneClawTask,
    raw,
    mode,
  });
  const preflight = preflightOneClawTask({
    task: plannedOneClawTask,
    intent,
    mode,
    capabilities: oneClawManifest.capabilities,
  });
  const automationPolicy = await evaluateAutomationPolicy({
    task: plannedOneClawTask,
    mode,
    preflight,
    capabilities: oneClawManifest.capabilities,
    connectors: oneClawManifest.connectors,
    canSubmitExternalTasks: true,
  });
  const oneclawTask = attachAutomationPolicyToTask(plannedOneClawTask, automationPolicy);
  const approvals = mapApprovalsForAutomation({
    approvals: evaluateOneClawTaskPolicy(oneclawTask, mode),
    automationBlocked: automationPolicy.blocked,
    automationManual: automationPolicy.requiresHumanApproval,
  });
  const pendingApprovals = approvals.filter((approval) => approval.required && approval.status === 'pending');
  const canSubmit = Boolean(oneclawTask) &&
    automationPolicy.canAutoRun &&
    pendingApprovals.length === 0;

  let oneclawRun: OneClawTaskRun | null = null;
  let oneclawError: string | null = null;
  let normalizedWorkerReceipt: ReturnType<typeof normalizeWorkerReceipt> | null = null;
  let finalOneAiResult: unknown = null;
  let finalSummary: string | null = null;
  let workerResultText = '';
  if (canSubmit && oneclawTask) {
    try {
      oneclawRun = await runOneClawTask<OneClawTaskRun>(oneclawTask);
      normalizedWorkerReceipt = normalizeOneClawRunForChat(oneclawRun, oneclawTask);
      const finalized = await summarizeWorkerResult({
        rawRequest: raw,
        workflowSummary,
        oneclawRun,
        normalizedReceipt: normalizedWorkerReceipt,
      });
      finalOneAiResult = finalized.finalOneAiResult;
      finalSummary = finalized.finalSummary;
      workerResultText = finalized.workerResultText;
    } catch (error) {
      oneclawError = error instanceof Error ? error.message : 'OneClaw task submission failed.';
    }
  }

  const workerReturnedFailure = oneClawRunFailed(oneclawRun);
  const workerFailureDetail = normalizedWorkerReceipt?.error ||
    (workerReturnedFailure ? normalizedWorkerReceipt?.summary || `OneClaw task returned ${oneclawRun?.status}.` : null);
  const runtimeError = oneclawError || workerFailureDetail;
  const blocked = automationPolicy.blocked || preflight.status === 'blocked' || Boolean(oneclawError);
  const approvalGated = pendingApprovals.length > 0 || automationPolicy.requiresHumanApproval;
  const dispatchStatus: PlanStep['status'] = !oneclawTask
    ? 'skipped'
    : oneclawRun
      ? workerReturnedFailure ? 'failed' : 'completed'
    : blocked
      ? 'failed'
      : approvalGated
        ? 'blocked'
        : automationPolicy.canAutoRun
          ? 'running'
          : 'pending';
  const plan = markApprovalBlockedSteps(buildPlan({
    planId,
    intent,
    summary: workflowSummary,
    oneAiSteps: plannedWorkflowSteps,
    hasOneClawTask: Boolean(oneclawTask),
    oneClawStatus: dispatchStatus,
    risk: automationPolicy.risk || effectiveOneAi.workflow.intent.risk,
  }), approvals);
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals });
  const executions = [
    createExecutionRecord({
      provider: 'oneai',
      status: effectiveOneAi.oneAiResult.mock ? 'mock' : effectiveOneAi.oneAiResult.success ? 'success' : 'failed',
      summary: attachmentReport ? 'OneAI generated an attachment report for the chat.' : 'OneAI generated a structured chat workflow.',
      taskName: attachmentReport ? 'oneai.chat.attachment_report' : 'oneai.chat.workflow',
      raw: effectiveOneAi.oneAiResult,
    }),
    createExecutionRecord({
      provider: 'theone',
      status: blocked ? 'blocked' : 'success',
      summary: blocked ? 'TheOne blocked the workflow during validation.' : 'TheOne validated workflow, preflight, and policy.',
      taskName: 'theone.chat.validate',
      raw: { preflight, automationPolicy, approvals },
    }),
    ...(oneclawTask ? [createExecutionRecord({
      provider: 'oneclaw' as const,
      status: executionStatus(oneclawRun, blocked),
      summary: oneclawRun
        ? normalizedWorkerReceipt?.summary || 'OneClaw worker task executed by TheOne Chat Runtime.'
        : blocked
          ? 'OneClaw worker task was blocked before execution.'
          : 'OneClaw worker task is waiting for approval.',
      externalId: oneclawRun?.id || null,
      taskName: oneclawTask.taskName,
      raw: { oneclawTask, oneclawRun, oneclawError, normalizedReceipt: normalizedWorkerReceipt },
    })] : []),
    ...(finalOneAiResult ? [createExecutionRecord({
      provider: 'oneai' as const,
      status: isRecord(finalOneAiResult) && finalOneAiResult.success === false ? 'failed' : 'success',
      summary: 'OneAI summarized the worker result for the chat.',
      taskName: 'oneai.chat.finalize',
      raw: finalOneAiResult,
    })] : []),
  ];
  const approvalSummary = approvalGated
    ? pendingTaskSummary({
        baseReply: effectiveOneAi.workflow.assistantReply,
        oneclawTask,
        approvals,
        automationReason: automationPolicy.reasons?.join(' '),
      })
    : null;
  const unfinishedExecutionSummary = !finalSummary && !approvalSummary && objectiveNeedsWorkerResult(raw, oneclawTask)
    ? buildUnfinishedExecutionSummary({
        raw,
        oneclawTask,
        oneclawRun,
        runtimeError,
        approvalGated,
        blocked,
        canSubmit,
        workerResultText,
        preflight,
        automationPolicy,
        approvals,
      })
    : null;
  const candidateSummary = finalSummary || approvalSummary || unfinishedExecutionSummary || effectiveOneAi.workflow.assistantReply;
  const summary = isProcessPlaceholderReply(candidateSummary) && objectiveNeedsWorkerResult(raw, oneclawTask)
    ? buildUnfinishedExecutionSummary({
        raw,
        oneclawTask,
        oneclawRun,
        runtimeError,
        approvalGated,
        blocked,
        canSubmit,
        workerResultText,
        preflight,
        automationPolicy,
        approvals,
      })
    : candidateSummary;
  const generatedReportArtifact = attachmentReport
    ? buildReportArtifactFromSummary({
        raw,
        summary,
        attachmentContext,
      })
    : null;
  const reportArtifact = generatedReportArtifact || (directReportExport ? previousReportArtifact : null);
  const exportBundle = reportArtifact && (directReportExport || attachmentReport)
    ? await exportReportArtifact(reportArtifact).catch(() => null)
    : null;
  const documentRuntime = buildDocumentRuntime({
    raw,
    attachmentContext,
    attachmentReport: attachmentReport ? { summary: attachmentReport.summary } : null,
    summary,
    reportArtifact,
  });
  const deliveryStatus = buildDeliveryStatus({
    documentRuntime,
    reportArtifact,
    exportBundle,
    approvals,
  });
  const objectiveAssessment = buildObjectiveAssessment({
    summary,
    runtimeError,
    approvalGated,
    documentRuntime,
    oneclawRun,
    oneclawTask,
  });
  const workerRuntime = describeWorkerRuntime({
    oneclawTask,
    oneclawRun,
    oneclawError: runtimeError,
    blocked,
    approvalGated,
    canSubmit,
    preflight,
    automationPolicy,
    approvals,
    finalSummary,
    workerResultText,
  });
  const missionState = workerRuntime.missionState;
  const continuity = buildChatContinuityFrame({
    raw,
    mission,
    memoryContext,
    workerRuntime,
  });
  const agentTimeline = buildAgentTimeline({
    mode,
    workerRuntime,
    workflowSteps: plannedWorkflowSteps.map((step) => ({
      ...step,
      status: step.worker === 'oneai' || finalSummary ? 'completed' : oneclawRun ? 'running' : blocked ? 'blocked' : 'pending',
    })),
    executions,
    approvals,
    oneclawTask,
    oneclawRun,
    finalSummary,
  });
  const proofRecords = [
    proof({
      title: 'TheOne Chat Runtime handled conversation',
      value: summary,
      metadata: {
        source: 'theone.chat_runtime',
        mission,
        brain,
        workerRuntime,
        modelRoute: primaryModel,
        selectedAppPackages,
        memoryContext: memorySummary(memoryContext),
        continuity,
        missionState,
        documentRuntime,
        reportArtifact,
        exportBundle,
        deliveryStatus,
        objectiveAssessment,
        agentTimeline,
        workerCatalogSummary: workerCatalog.summary,
        oneAiWorkflow: effectiveOneAi.workflow,
        oneAiBrain: effectiveOneAi.workflow.oneAiBrain || null,
        attachmentReportMode: Boolean(attachmentReport),
        oneAiProposedDocumentWorker,
        finalOneAiResult,
        finalSummary,
        approvalSummary,
        unfinishedExecutionSummary,
        workerResultText,
        normalizedWorkerReceipt,
        preflight,
        automationPolicy,
        oneclawTask,
        oneclawRun,
      },
    }),
  ];

  const ok = effectiveOneAi.oneAiResult.success && !automationPolicy.blocked && !runtimeError;
  const theoneWorkerStatus = blocked
    ? 'blocked'
    : approvalGated
      ? 'approval_gated'
      : automationPolicy.canAutoRun
        ? 'auto_cleared'
        : 'validated';
  const oneclawWorkerStatus = workerReturnedFailure
    ? 'failed'
    : oneclawRun
    ? 'called'
    : blocked
      ? 'blocked'
      : approvalGated
        ? 'approval_gated'
        : automationPolicy.canAutoRun
          ? 'submitting'
          : 'prepared';
  const nextActions = automationPolicy.blocked || preflight.status === 'blocked'
    ? ['Fix the blocked workflow action or input, then ask TheOne to rebuild the workflow.']
      : runtimeError
      ? normalizedWorkerReceipt?.nextActions?.length
        ? normalizedWorkerReceipt.nextActions
        : [`Check OneClaw execution error: ${runtimeError}`]
      : approvalGated
        ? firstTaskAction(oneclawTask) === 'social.post'
          ? ['Review the draft, revise it if needed, then approve the pending X publish task.']
          : ['Review the pending approval before OneClaw executes this worker task.']
        : oneclawTask && !oneclawRun && automationPolicy.canAutoRun
          ? ['The read-only worker task is auto-cleared; wait for OneClaw execution receipt or refresh the run.']
          : exportBundle
            ? ['Open or download the exported report files, or ask TheOne to revise the report and export again.']
          : attachmentReport
            ? ['Use this report, ask a follow-up, or ask TheOne to export it as a file.']
          : finalSummary
            ? ['Use this result, ask a follow-up, or turn it into a report.']
            : oneclawRun
              ? ['Review the OneClaw receipt and ask TheOne to summarize the worker result.']
            : ['Continue the conversation with the next outcome.'];

  return {
    ok,
    runId,
    summary,
    intent,
    plan,
    execution: {
      completedSteps: plan.steps.filter((step) => step.status === 'completed').length,
      failedSteps: plan.steps.filter((step) => step.status === 'failed').length,
      agentResults: [],
    },
    proof: proofRecords,
    approvals,
    executions,
    pendingOneClawTask: oneclawTask && !oneclawRun ? oneclawTask : null,
    preflight,
    os: {
      ...kernel,
      workflow,
      approvals,
      executions,
      oneClawManifest,
      oneClawBridge,
      preflight,
    },
    networkSignals: {
      routedBy: 'theone.chat_runtime',
      mission,
      workerRuntime,
      missionState,
      documentRuntime,
      reportArtifact,
      exportBundle,
      deliveryStatus,
      objectiveAssessment,
      continuity,
      agentTimeline,
      brainMode: brain.mode,
      conversationKind: brain.conversationKind,
      modelRoute: primaryModel,
      selectedAppPackages: selectedAppPackages.map((pkg) => pkg.key),
      memoryContext: memorySummary(memoryContext),
      workerCatalogSummary: workerCatalog.summary,
      oneAiWorkflowId: effectiveOneAi.workflow.workflow.id,
      oneAiBrain: effectiveOneAi.workflow.oneAiBrain || null,
      fallbackRoute,
      oneClawTaskName: oneclawTask?.taskName || null,
      oneClawRunId: oneclawRun?.id || null,
    },
    chat: {
      runtime: 'theone.chat_runtime.v2',
      mission,
      brain,
      workerRuntime,
      missionState,
      documentRuntime,
      reportArtifact,
      exportBundle,
      deliveryStatus,
      objectiveAssessment,
      continuity,
      agentTimeline,
      modelRoute: primaryModel,
      memoryContext: memorySummary(memoryContext),
      appPackages: selectedAppPackages.length ? selectedAppPackages : appPackages.slice(0, 4),
      workerCatalog: workerCatalog.summary,
      assistant: {
        role: 'assistant',
        content: summary,
        createdAt: new Date().toISOString(),
      },
      oneAiWorkflow: {
        ...effectiveOneAi.workflow.workflow,
        summary: workflowSummary,
        source: 'oneai',
        owner: 'OneAI',
        status: ok ? 'validated' : blocked ? 'blocked' : 'needs_approval',
        planningBrain: effectiveOneAi.workflow.oneAiBrain || null,
        steps: plannedWorkflowSteps.map((step) => ({
          ...step,
          owner: step.worker,
          status: step.worker === 'oneai' || finalSummary ? 'completed' : oneclawRun ? 'running' : blocked ? 'blocked' : 'pending',
        })),
      },
      workerCoordination: {
        mode,
        requiredWorkers: effectiveOneAi.workflow.requiredWorkers,
        workers: [
          {
            key: 'oneai',
            title: 'OneAI',
            role: 'Builds the structured workflow from the conversation.',
            status: effectiveOneAi.oneAiResult.success ? 'ready' : 'needs_attention',
          },
          {
            key: 'theone',
            title: 'TheOne Kernel',
            role: 'Validates workflow, policy, preflight, approvals, proof, and memory.',
            status: theoneWorkerStatus,
          },
          ...(oneclawTask ? [{
            key: 'oneclaw',
            title: 'OneClaw',
            role: 'Executes approved worker tasks and returns receipts.',
            status: oneclawWorkerStatus,
          }] : []),
        ],
        oneclawTask,
        oneclawRun,
        fallbackRoute,
        workerResultText,
        finalSummary,
        approvalSummary,
        automationPolicy,
        preflight,
        workerRuntime,
        missionState,
        continuity,
        agentTimeline,
        exportBundle,
        deliveryStatus,
      },
      nextActions,
    },
  };
}
