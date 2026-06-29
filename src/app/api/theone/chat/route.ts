import { runTheOneChatRuntime, type TheOneChatRuntimeInput } from '@/lib/theone/chat/chat-runtime';
import { saveRunResult } from '@/lib/theone/state/run-store';
import { saveChatSessionSnapshot, type TheOneChatAttachment } from '@/lib/theone/state/chat-session-store';
import type { TheOneMode } from '@/lib/theone/types';

type ChatRole = 'user' | 'assistant' | 'system';

function normalizeMessages(value: unknown): TheOneChatRuntimeInput['messages'] {
  if (!Array.isArray(value)) return [];

  return value
    .map((message) => {
      if (!message || typeof message !== 'object') return null;
      const record = message as Record<string, unknown>;
      const role: ChatRole = record.role === 'assistant' || record.role === 'system' || record.role === 'user'
        ? record.role
        : 'user';
      const content = typeof record.content === 'string' ? record.content.trim() : '';
      if (!content) return null;
      return { role, content };
    })
    .filter((message): message is NonNullable<typeof message> => Boolean(message));
}

function normalizeMode(value: unknown): TheOneMode {
  return value === 'manual' || value === 'auto' || value === 'assist' ? value : 'assist';
}

function normalizeLanguage(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 32) : 'auto';
}

function normalizeContextMessage(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const mission = record.mission && typeof record.mission === 'object' ? record.mission as Record<string, unknown> : null;
  const workerRuntime = record.workerRuntime && typeof record.workerRuntime === 'object' ? record.workerRuntime as Record<string, unknown> : null;
  const missionState = record.missionState && typeof record.missionState === 'object' ? record.missionState as Record<string, unknown> : null;
  const documentRuntime = record.documentRuntime && typeof record.documentRuntime === 'object' ? record.documentRuntime as Record<string, unknown> : null;
  const reportArtifact = record.reportArtifact && typeof record.reportArtifact === 'object' ? record.reportArtifact as Record<string, unknown> : null;
  const exportBundle = record.exportBundle && typeof record.exportBundle === 'object' ? record.exportBundle as Record<string, unknown> : null;
  const deliveryStatus = record.deliveryStatus && typeof record.deliveryStatus === 'object' ? record.deliveryStatus as Record<string, unknown> : null;
  const continuity = record.continuity && typeof record.continuity === 'object' ? record.continuity as Record<string, unknown> : null;
  const pendingOneClawTask = record.pendingOneClawTask && typeof record.pendingOneClawTask === 'object' ? record.pendingOneClawTask as Record<string, unknown> : null;
  const lastAssistant = typeof record.lastAssistant === 'string' ? record.lastAssistant.slice(0, 2400) : '';
  const approvals = Array.isArray(record.approvals) ? record.approvals.slice(0, 8) : [];
  const executions = Array.isArray(record.executions) ? record.executions.slice(-6) : [];
  if (!mission && !workerRuntime && !lastAssistant) return null;

  return {
    role: 'system' as const,
    content: [
      'Previous TheOne mission context is available. Treat follow-up requests such as continue, retry, revise, approve, summarize, or make it shorter as referring to this mission unless the user clearly starts a new task.',
      lastAssistant ? `Last assistant answer: ${lastAssistant}` : '',
      mission ? `Mission: ${JSON.stringify({
        id: mission.id,
        runId: mission.runId,
        title: mission.title,
        objective: mission.objective,
        mode: mission.mode,
        conversationKind: mission.conversationKind,
        primaryApp: mission.primaryApp,
        workspace: mission.workspace,
      })}` : '',
      workerRuntime ? `Worker runtime: ${JSON.stringify({
        status: workerRuntime.status,
        current: workerRuntime.current,
        diagnostics: workerRuntime.diagnostics,
      })}` : '',
      missionState ? `Mission state: ${JSON.stringify({
        state: missionState.state,
        label: missionState.label,
        canResume: missionState.canResume,
        canRetry: missionState.canRetry,
        canRevise: missionState.canRevise,
        stages: missionState.stages,
      })}` : '',
      documentRuntime ? `Document runtime: ${JSON.stringify({
        status: documentRuntime.status,
        objective: documentRuntime.objective,
        attachments: documentRuntime.attachments,
        report: documentRuntime.report,
        nextActions: documentRuntime.nextActions,
      })}` : '',
      reportArtifact ? `Report artifact: ${JSON.stringify({
        id: reportArtifact.id,
        title: reportArtifact.title,
        format: reportArtifact.format,
        sourceFiles: reportArtifact.sourceFiles,
        executiveSummary: reportArtifact.executiveSummary,
        keyFindings: reportArtifact.keyFindings,
        risks: reportArtifact.risks,
        actionItems: reportArtifact.actionItems,
        evidence: reportArtifact.evidence,
      })}` : '',
      exportBundle ? `Report export bundle: ${JSON.stringify({
        id: exportBundle.id,
        status: exportBundle.status,
        createdAt: exportBundle.createdAt,
        files: exportBundle.files,
      })}` : '',
      deliveryStatus ? `Delivery status: ${JSON.stringify({
        status: deliveryStatus.status,
        stages: deliveryStatus.stages,
        files: deliveryStatus.files,
        nextAction: deliveryStatus.nextAction,
      })}` : '',
      continuity ? `Continuity: ${JSON.stringify(continuity)}` : '',
      pendingOneClawTask ? `Pending OneClaw task: ${JSON.stringify({
        taskName: pendingOneClawTask.taskName,
        approvalMode: pendingOneClawTask.approvalMode,
        steps: pendingOneClawTask.steps,
      })}` : '',
      approvals.length ? `Approvals: ${JSON.stringify(approvals)}` : '',
      executions.length ? `Executions: ${JSON.stringify(executions.map((execution: any) => ({
        provider: execution?.provider,
        status: execution?.status,
        summary: execution?.summary,
        taskName: execution?.taskName,
        externalId: execution?.externalId,
        normalizedReceipt: execution?.raw?.normalizedReceipt,
      })))}` : '',
    ].filter(Boolean).join('\n'),
  };
}

function normalizeAttachments(value: unknown): TheOneChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: TheOneChatAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : '';
    if (!name) continue;
    const attachment: TheOneChatAttachment = {
      id: typeof record.id === 'string' ? record.id : name,
      name,
      type: typeof record.type === 'string' ? record.type : 'application/octet-stream',
      size: typeof record.size === 'number' ? record.size : 0,
    };
    if (record.status === 'uploading' || record.status === 'ready' || record.status === 'failed') attachment.status = record.status;
    if (typeof record.error === 'string') attachment.error = record.error.slice(0, 1000);
    if (typeof record.sourceId === 'string') attachment.sourceId = record.sourceId.slice(0, 200);
    if (typeof record.contentRef === 'string') attachment.contentRef = record.contentRef.slice(0, 500);
    if (typeof record.textHash === 'string') attachment.textHash = record.textHash.slice(0, 100);
    if (typeof record.path === 'string') attachment.path = record.path.slice(0, 1000);
    if (typeof record.text === 'string') attachment.text = record.text.slice(0, 80000);
    if (typeof record.textPreview === 'string') attachment.textPreview = record.textPreview.slice(0, 12000);
    if (typeof record.reportContext === 'string') attachment.reportContext = record.reportContext.slice(0, 50000);
    if (typeof record.summary === 'string') attachment.summary = record.summary.slice(0, 2000);
    if (record.insights && typeof record.insights === 'object') attachment.insights = record.insights as Record<string, unknown>;
    attachments.push(attachment);
  }
  return attachments.slice(0, 8);
}

function normalizeAttachmentMessage(value: unknown) {
  const attachments = normalizeAttachments(value);
  if (!attachments.length) return null;
  return {
    role: 'system' as const,
    content: [
      'The user attached files to this message. Treat attachments as the document/file source for requests like "read this document", "summarize this", "send me a report", or "analyze this file".',
      'If readable attachment content is present below, answer from it directly and do not ask the user for a path. If only an attachment path is present, route a safe file/document worker when possible. Ask for a path only when no attachment, URL, or stored path exists.',
      ...attachments.map((attachment) => [
        `Attachment: ${attachment.name}`,
        attachment.status ? `Status: ${attachment.status}` : '',
        attachment.error ? `Upload error: ${attachment.error}` : '',
        `Type: ${attachment.type}`,
        `Size: ${attachment.size} bytes`,
        attachment.sourceId ? `Source ID: ${attachment.sourceId}` : '',
        attachment.contentRef ? `Content ref: ${attachment.contentRef}` : '',
        attachment.textHash ? `Text hash: ${attachment.textHash}` : '',
        attachment.path ? `Stored path: ${attachment.path}` : '',
        attachment.insights ? `Attachment insights: ${JSON.stringify(attachment.insights)}` : '',
        attachment.summary ? `Summary: ${attachment.summary}` : '',
        attachment.reportContext ? `Report context:\n${attachment.reportContext}` : '',
        attachment.text || attachment.textPreview ? `Content:\n${attachment.text || attachment.textPreview}` : '',
      ].filter(Boolean).join('\n')),
    ].join('\n\n'),
  };
}

function attachmentInputHint(value: unknown) {
  const attachments = normalizeAttachments(value);
  if (!attachments.length) return '';
  const readable = attachments.filter((attachment) => attachment.text || attachment.textPreview || attachment.reportContext);
  const failed = attachments.filter((attachment) => attachment.status === 'failed');
  return [
    `Attached file context: ${attachments.map((attachment) => attachment.name).join(', ')}.`,
    failed.length
      ? `Some attachments failed before TheOne could read them: ${failed.map((attachment) => `${attachment.name}${attachment.error ? ` (${attachment.error})` : ''}`).join('; ')}. Do not ask for a URL; explain that the attachment must be re-uploaded or supplied through a readable path.`
      : '',
    attachments.some((attachment) => attachment.insights)
      ? `Attachment worker hints: ${attachments.map((attachment) => {
        const worker = typeof attachment.insights?.recommendedWorker === 'string' ? attachment.insights.recommendedWorker : 'file.read';
        return `${attachment.name} -> ${worker}`;
      }).join('; ')}.`
      : '',
    readable.length
      ? 'Readable attachment report context is already available in system context; do not ask for a file path. For document/report requests, use this context as the source and produce the requested report.'
      : failed.length
        ? 'The attachment is present in the UI but failed upload or parsing, so there is no readable content or reliable stored path for the worker yet.'
      : 'The uploaded attachment has a stored path; route file/document workers if the request requires reading it.',
  ].filter(Boolean).join(' ');
}

function attachConversation(result: Awaited<ReturnType<typeof runTheOneChatRuntime>>, messages: TheOneChatRuntimeInput['messages'], sessionId?: string) {
  const assistant = (result.chat as any)?.assistant;
  return {
    ...result,
    chat: {
      ...result.chat,
      conversation: {
        sessionId: sessionId || result.runId,
        updatedAt: new Date().toISOString(),
        messages: [
          ...(messages || []).filter((message) => message.role !== 'system'),
          assistant?.content ? {
            role: 'assistant',
            content: assistant.content,
            createdAt: assistant.createdAt || new Date().toISOString(),
          } : null,
        ].filter(Boolean),
      },
    },
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const contextMessage = normalizeContextMessage(body.context);
    const attachmentMessage = normalizeAttachmentMessage(body.attachments);
    const attachments = normalizeAttachments(body.attachments);
    const messages = normalizeMessages(body.messages);
    const inputHint = attachmentInputHint(body.attachments);
    const runtimeMessages = [
      contextMessage,
      attachmentMessage,
      ...messages,
    ].filter(Boolean) as TheOneChatRuntimeInput['messages'];
    const result = await runTheOneChatRuntime({
      messages: runtimeMessages,
      input: typeof body.input === 'string' ? body.input : undefined,
      mode: normalizeMode(body.mode),
      userId: typeof body.userId === 'string' ? body.userId : undefined,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      contextHint: inputHint || undefined,
      language: normalizeLanguage(body.language),
    });
    const withConversation = attachConversation(result, messages, typeof body.sessionId === 'string' ? body.sessionId : undefined);
    const stored = await saveRunResult(withConversation);
    await saveChatSessionSnapshot({
      sessionId: String((withConversation.chat as any)?.conversation?.sessionId || body.sessionId || stored.runId),
      runId: stored.runId,
      mode: stored.os?.mode || normalizeMode(body.mode),
      title: (withConversation.chat as any)?.mission?.title || stored.intent?.objective || 'TheOne chat',
      summary: stored.summary,
      status: stored.ok ? 'active' : 'failed',
      messages: (withConversation.chat as any)?.conversation?.messages || messages,
      attachments,
      metadata: {
        approvals: stored.approvals?.length || 0,
        executions: stored.executions?.length || 0,
        proof: stored.proof?.length || 0,
        selectedWorker: body.selectedWorker || null,
      },
    });

    return Response.json({
      ...stored,
      chat: withConversation.chat,
    }, {
      status: stored.ok ? 200 : 500,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'TheOne Chat Runtime failed.',
      chat: {
        runtime: 'theone.chat_runtime.v1',
        assistant: {
          role: 'assistant',
          content: 'TheOne could not start the intelligent chat workflow.',
          createdAt: new Date().toISOString(),
        },
      },
    }, {
      status: 500,
    });
  }
}
