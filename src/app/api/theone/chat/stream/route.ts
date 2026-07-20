import { runTheOneChatRuntime, type TheOneChatRuntimeInput } from '@/lib/theone/chat/chat-runtime';
import { saveRunResult } from '@/lib/theone/state/run-store';
import { saveChatSessionSnapshot, type TheOneChatAttachment } from '@/lib/theone/state/chat-session-store';
import { attachCodeMission } from '@/lib/theone/code/code-mission';
import type { TheOneMode } from '@/lib/theone/types';
import { rateLimit } from '@/lib/theone/security/api-guard';

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
  const codeMission = record.codeMission && typeof record.codeMission === 'object' ? record.codeMission as Record<string, unknown> : null;
  const lastAssistant = typeof record.lastAssistant === 'string' ? record.lastAssistant.slice(0, 2400) : '';
  const approvals = Array.isArray(record.approvals) ? record.approvals.slice(0, 8) : [];
  const executions = Array.isArray(record.executions) ? record.executions.slice(-6) : [];
  if (!mission && !workerRuntime && !codeMission && !lastAssistant) return null;

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
      codeMission ? `Persistent code mission: ${JSON.stringify({
        id: codeMission.id,
        objective: codeMission.objective,
        mode: codeMission.mode,
        status: codeMission.status,
        iteration: codeMission.iteration,
        currentAction: codeMission.currentAction,
        nextAction: codeMission.nextAction,
        workspace: codeMission.workspace,
        acceptanceCriteria: codeMission.acceptanceCriteria,
        constraints: codeMission.constraints,
        plan: codeMission.plan,
        completedActions: codeMission.completedActions,
        files: codeMission.files,
        tests: codeMission.tests,
        recovery: codeMission.recovery,
        loop: codeMission.loop,
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

function send(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function streamAnswer(controller: ReadableStreamDefaultController<Uint8Array>, content: string) {
  const chunks = content.match(/.{1,18}(\s|$)|\S+(\s|$)/g) || [content];
  for (const chunk of chunks) {
    send(controller, 'answer_delta', { text: chunk });
  }
}

function publicChatFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/request entity too large|payload too large|content too large|status\s*413/i.test(message)) {
    return 'This conversation contains more context than the planning service can accept. TheOne compacted it automatically, but the request is still too large. Start a new chat or remove large attachments, then retry.';
  }
  if (/ONEAI request failed|internal server error/i.test(message)) {
    return 'TheOne could not reach the planning brain for this request. Please retry; your existing runs and files were not changed.';
  }
  return 'TheOne could not start this request. Please retry or start a new chat if the current conversation is very long.';
}

function emitRuntimeEvents(controller: ReadableStreamDefaultController<Uint8Array>, result: any) {
  const workflow = result?.chat?.oneAiWorkflow;
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  const codeMission = result?.codeMission || result?.chat?.codeMission;
  const codeRuntime = result?.chat?.codeRuntime || result?.networkSignals?.codeRuntime;
  if (codeMission) {
    send(controller, 'mission_started', {
      id: codeMission.id,
      objective: codeMission.objective,
      status: codeMission.status,
      iteration: codeMission.iteration,
      mode: codeMission.mode,
      workspace: codeMission.workspace,
      loop: codeMission.loop,
    });
  }
  send(controller, 'plan_delta', {
    summary: workflow?.summary || result?.summary || 'TheOne prepared the route.',
    steps: steps.map((step: any) => ({
      id: step.id,
      title: step.title || step.action || 'Workflow step',
      action: step.action,
      worker: step.worker || step.owner,
      status: step.status || step.approvalMode || 'ready',
    })).slice(0, 12),
  });
  send(controller, 'plan_created', {
    missionId: codeMission?.id,
    summary: workflow?.summary || result?.summary || 'TheOne prepared the route.',
    steps: steps.slice(0, 12),
    nextAction: codeMission?.nextAction,
  });

  if (result?.pendingOneClawTask) {
    send(controller, 'tool_start', {
      taskName: result.pendingOneClawTask.taskName,
      approvalMode: result.pendingOneClawTask.approvalMode,
      steps: result.pendingOneClawTask.steps || [],
    });
    send(controller, 'tool_started', {
      missionId: codeMission?.id,
      taskName: result.pendingOneClawTask.taskName,
      approvalMode: result.pendingOneClawTask.approvalMode,
      steps: result.pendingOneClawTask.steps || [],
    });
  }

  for (const approval of (Array.isArray(result?.approvals) ? result.approvals : []).filter((item: any) => item?.required && item?.status === 'pending')) {
    send(controller, 'approval_required', {
      id: approval.id,
      action: approval.action,
      reason: approval.reason,
      risk: approval.risk,
    });
  }

  for (const execution of (Array.isArray(result?.executions) ? result.executions : []).slice(-6)) {
    send(controller, 'tool_result', {
      provider: execution.provider,
      taskName: execution.taskName || execution.action,
      status: execution.status,
      summary: execution.summary,
      externalId: execution.externalId,
    });
    send(controller, 'tool_completed', {
      missionId: codeMission?.id,
      provider: execution.provider,
      taskName: execution.taskName || execution.action,
      status: execution.status,
      summary: execution.summary,
      externalId: execution.externalId,
    });
  }

  for (const proof of (Array.isArray(result?.proof) ? result.proof : []).slice(-6)) {
    send(controller, 'proof_recorded', {
      type: proof.type,
      title: proof.title,
      value: proof.value,
      timestamp: proof.timestamp,
    });
  }

  if (codeRuntime?.diff) {
    send(controller, 'diff_ready', {
      missionId: codeMission?.id,
      summary: codeRuntime.summary,
      diff: codeRuntime.diff,
      files: codeRuntime.files || [],
    });
  }
  if (codeRuntime?.tests) {
    send(controller, 'test_completed', {
      missionId: codeMission?.id,
      status: codeRuntime.tests.status,
      passed: codeRuntime.tests.passed,
      results: codeRuntime.tests.results || [],
    });
  }
  if (codeRuntime?.lifecycle?.some((step: any) => step?.action === 'code.verify')) {
    send(controller, 'verification_completed', {
      missionId: codeMission?.id,
      status: codeMission?.workspace?.stage || codeRuntime.status,
      delivery: codeRuntime.delivery,
    });
  }
  if (codeRuntime?.rollback?.available) {
    send(controller, 'checkpoint_created', {
      missionId: codeMission?.id,
      token: codeRuntime.rollback.token,
      workspace: codeMission?.workspace,
    });
  }
  if (codeMission?.status === 'completed') {
    send(controller, 'mission_completed', codeMission);
  } else if (codeMission?.status === 'failed' || codeMission?.status === 'blocked') {
    send(controller, 'mission_failed', codeMission);
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, { key: 'chat-stream', limit: 60, windowMs: 60_000 });
  if (!limited.allowed) return limited.response;

  const body = await req.json();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
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

        const attachmentNames = attachments.map((attachment) => attachment.name).filter(Boolean);
        send(controller, 'stage', {
          index: 0,
          label: attachmentNames.length ? 'Reading files' : 'Understanding request',
          detail: attachmentNames.length
            ? `Reading ${attachmentNames.slice(0, 3).join(', ')} as source context.`
            : 'Understanding the outcome before choosing tools.',
        });
        send(controller, 'stage', {
          index: 1,
          label: 'Choosing route',
          detail: inputHint
            ? 'Using attachment hints to choose the safest app and worker route.'
            : 'Selecting the right app, worker, or direct answer path.',
        });
        send(controller, 'stage', {
          index: 2,
          label: 'Checking safety',
          detail: 'Checking mode, policy, approvals, and worker access.',
        });

        const result = await runTheOneChatRuntime({
          messages: runtimeMessages,
          input: typeof body.input === 'string' ? body.input : undefined,
          mode: normalizeMode(body.mode),
          userId: typeof body.userId === 'string' ? body.userId : undefined,
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
          contextHint: inputHint || undefined,
          language: normalizeLanguage(body.language),
        });

        send(controller, 'stage', {
          index: 3,
          label: result?.chat?.documentRuntime ? 'Building report' : 'Running work',
          detail: result.pendingOneClawTask
            ? 'The worker route is prepared or running.'
            : result?.chat?.documentRuntime
              ? 'The document answer is being shaped into a useful report.'
              : typeof (result?.chat as any)?.workerRuntime?.diagnostics?.userReadable === 'string'
                ? (result.chat as any).workerRuntime.diagnostics.userReadable
                : 'TheOne is checking whether this can be answered directly or needs a worker.',
        });
        send(controller, 'stage', {
          index: 4,
          label: result?.chat?.exportBundle ? 'Preparing files' : 'Collecting proof',
          detail: result?.chat?.exportBundle
            ? 'Export files are being attached to the result.'
            : 'Receipts, proof, and memory are being attached.',
        });

        const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
          ? body.sessionId.trim()
          : result.runId;
        const withConversation = attachConversation(result, messages, sessionId);
        const objective = [...messages].reverse().find((message) => message.role === 'user')?.content
          || (typeof body.input === 'string' ? body.input : undefined);
        const withCodeMission = attachCodeMission({
          result: withConversation,
          sessionId,
          runId: result.runId,
          mode: normalizeMode(body.mode),
          objective,
          previous: body.context?.codeMission,
        });

        emitRuntimeEvents(controller, withCodeMission);
        const immediateRuntime = (withCodeMission.chat as Record<string, unknown> | undefined)?.l40Runtime;
        if (immediateRuntime) send(controller, 'runtime_contract', immediateRuntime);
        send(controller, 'stage', { index: 5, label: 'Writing answer', detail: 'Returning the result in plain language.' });
        streamAnswer(controller, String((withCodeMission.chat as any)?.assistant?.content || withCodeMission.summary || ''));

        const stored = await saveRunResult(withCodeMission);
        await saveChatSessionSnapshot({
          sessionId: String((withCodeMission.chat as any)?.conversation?.sessionId || sessionId || stored.runId),
          runId: stored.runId,
          mode: stored.os?.mode || normalizeMode(body.mode),
          title: (withCodeMission.chat as any)?.mission?.title || stored.intent?.objective || 'TheOne chat',
          summary: stored.summary,
          status: stored.ok ? 'active' : 'failed',
          messages: (withCodeMission.chat as any)?.conversation?.messages || messages,
          attachments,
          metadata: {
            approvals: stored.approvals?.length || 0,
            executions: stored.executions?.length || 0,
            proof: stored.proof?.length || 0,
            selectedWorker: body.selectedWorker || null,
            codeMission: withCodeMission.codeMission || null,
          },
        });
        const output = {
          ...stored,
          codeMission: withCodeMission.codeMission,
          chat: withCodeMission.chat,
        };
        send(controller, 'result', output);
      } catch (error) {
        const content = publicChatFailure(error);
        send(controller, 'error', {
          ok: false,
          error: content,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
