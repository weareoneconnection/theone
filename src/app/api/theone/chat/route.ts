import { runTheOneChatRuntime, type TheOneChatRuntimeInput } from '@/lib/theone/chat/chat-runtime';
import { saveRunResult } from '@/lib/theone/state/run-store';
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

function normalizeContextMessage(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const mission = record.mission && typeof record.mission === 'object' ? record.mission as Record<string, unknown> : null;
  const workerRuntime = record.workerRuntime && typeof record.workerRuntime === 'object' ? record.workerRuntime as Record<string, unknown> : null;
  const missionState = record.missionState && typeof record.missionState === 'object' ? record.missionState as Record<string, unknown> : null;
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const contextMessage = normalizeContextMessage(body.context);
    const messages = normalizeMessages(body.messages);
    const result = await runTheOneChatRuntime({
      messages: contextMessage ? [contextMessage, ...messages] : messages,
      input: typeof body.input === 'string' ? body.input : undefined,
      mode: normalizeMode(body.mode),
      userId: typeof body.userId === 'string' ? body.userId : undefined,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
    });
    const stored = await saveRunResult(result);

    return Response.json({
      ...stored,
      chat: result.chat,
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
