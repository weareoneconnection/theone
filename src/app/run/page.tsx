'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { friendlyStatus } from '@/components/theone/ProductNav';

const modes = ['manual', 'assist', 'auto'] as const;

type Mode = typeof modes[number];

type ConversationMessage = {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  createdAt: string;
  result?: any;
};

type CommandItem = {
  key: string;
  label: string;
  prompt: string;
  meta: string;
  source: 'template' | 'worker';
  action?: string;
};

type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  text?: string;
  textPreview?: string;
  summary?: string;
  status: 'uploading' | 'ready' | 'failed';
};

type StreamEvent = {
  id: string;
  event: string;
  data: any;
  createdAt: string;
};

type TimelineItem = {
  key: string;
  title: string;
  detail: string;
  status: 'ready' | 'running' | 'done' | 'blocked' | 'waiting';
};

const workerPrompts = [
  {
    label: 'Web research',
    prompt: 'Analyze website weareoneconnection.org and summarize useful findings',
  },
  {
    label: 'X growth',
    prompt: 'Prepare a high-signal X post: TheOne is becoming an AI operating system for real-world work.',
  },
  {
    label: 'GitHub',
    prompt: 'Check GitHub repo weareoneconnection/theone and explain what needs attention',
  },
  {
    label: 'Desktop',
    prompt: 'Use the local desktop bridge to inspect Chrome',
  },
  {
    label: 'Files',
    prompt: 'List files in /tmp',
  },
  {
    label: 'Report',
    prompt: 'Create a report from research and proof',
  },
  {
    label: 'OneAI Bot',
    prompt: 'Check the OneAI Bot bridge status and explain how it connects to TheOne',
  },
  {
    label: 'API',
    prompt: 'Call the OneClaw health API and summarize the result',
  },
];

const sessionShortcuts = [
  { label: 'New chat', href: '/run' },
  { label: 'Search', href: '/runs' },
  { label: 'Workspaces', href: '/workspaces' },
];

const starterMessage: ConversationMessage = {
  id: 'assistant_starter',
  role: 'assistant',
  createdAt: new Date().toISOString(),
  content: 'Tell me what you want finished. I can answer directly, plan a workflow, call OneClaw workers, ask for approval when needed, and return a clear result with proof.',
};

const liveProgressStages = [
  'Understanding',
  'Planning',
  'Checking policy',
  'Calling workers',
  'Reading proof',
  'Writing answer',
];

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function postChatWithStream(
  payload: Record<string, unknown>,
  onStage: (stage: number) => void,
  onDelta: (text: string) => void,
  onEvent?: (event: string, data: any) => void
) {
  const response = await fetch('/api/theone/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error('TheOne stream unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: any = null;
  let streamError = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const packets = buffer.split('\n\n');
    buffer = packets.pop() || '';

    for (const packet of packets) {
      const event = packet.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataLine = packet.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !dataLine) continue;
      const data = JSON.parse(dataLine);
      if (event === 'stage') onStage(Number(data.index || 0));
      if (event === 'answer_delta' && typeof data.text === 'string') onDelta(data.text);
      if (!['stage', 'answer_delta', 'result', 'error'].includes(event)) onEvent?.(event, data);
      if (event === 'result') finalResult = data;
      if (event === 'error') streamError = data.error || 'TheOne stream failed.';
    }
  }

  if (streamError) throw new Error(streamError);
  if (!finalResult) throw new Error('TheOne stream finished without a result.');
  return finalResult;
}

async function postChatJson(payload: Record<string, unknown>) {
  const response = await fetch('/api/theone/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function uploadChatAttachments(files: FileList | null): Promise<ChatAttachment[]> {
  const selected = Array.from(files || []).slice(0, 8);
  if (!selected.length) return [];

  const form = new FormData();
  selected.forEach((file) => form.append('files', file));
  const response = await fetch('/api/theone/chat/upload', {
    method: 'POST',
    body: form,
  });
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || 'Attachment upload failed.');
  }

  return (Array.isArray(data.attachments) ? data.attachments : []).map((attachment: any) => ({
    id: String(attachment.id || createId('attachment')),
    name: String(attachment.name || 'attachment'),
    type: String(attachment.type || 'application/octet-stream'),
    size: Number(attachment.size || 0),
    text: typeof attachment.text === 'string' ? attachment.text : undefined,
    textPreview: typeof attachment.textPreview === 'string' ? attachment.textPreview : undefined,
    summary: typeof attachment.summary === 'string' ? attachment.summary : undefined,
    status: 'ready' as const,
  }));
}

function plainResult(result: any) {
  const assistant = result?.chat?.assistant?.content;
  if (assistant) return assistant;
  const error = String(result?.error || '');
  if (error) return error.replace(/Invalid `prisma[^`]+` invocation:[\s\S]*/i, 'TheOne switched to safe mode because the memory database is temporarily unavailable.');
  if (result?.appResult?.summary) return result.appResult.summary;
  if (result?.appRoute?.summary) return result.appRoute.summary;
  if (result?.summary) return result.summary;
  const oneClaw = [...(result?.executions || [])].reverse().find((execution: any) => execution.provider === 'oneclaw');
  if (oneClaw?.summary) return oneClaw.summary;
  return 'TheOne is ready to plan, check policy, execute, and record proof.';
}

function runStats(result: any) {
  const approvals = result?.pendingApprovals || result?.approvals || [];
  const pendingApprovals = Array.isArray(approvals)
    ? approvals.filter((approval: any) => approval?.required === true && approval?.status === 'pending')
    : [];

  return {
    approvals: pendingApprovals.length,
    executions: result?.executions?.length || 0,
    proof: result?.proof?.length || result?.proofRecords?.length || 0,
  };
}

function activeStatus(result: any, loading: boolean) {
  if (loading) return 'running';
  if (!result) return 'ready';
  if (result.ok === false) return 'blocked';
  return result?.os?.workflow?.status || result?.status || 'completed';
}

function workerTone(status?: string) {
  if (!status) return 'ready';
  if (/approval|gated|pending|prepared/i.test(status)) return 'assist';
  if (/attention|failed|blocked|error/i.test(status)) return 'blocked';
  return 'ready';
}

function approvalReason(result: any) {
  const approvals = result?.approvals || [];
  return approvals.find((approval: any) => approval?.required && approval?.status === 'pending')?.reason ||
    result?.chat?.workerCoordination?.automationPolicy?.reasons?.join(' ') ||
    '';
}

function evidenceText(result: any) {
  return result?.chat?.workerCoordination?.workerResultText || '';
}

function workStatusLine(result: any) {
  if (!result?.chat && !result?.runId) return null;
  const steps = workflowSteps(result).length || result?.plan?.steps?.length || 0;
  const executions = result?.executions?.length || 0;
  const proof = result?.proof?.length || result?.proofRecords?.length || 0;
  const approvals = pendingApprovals(result).length;
  const pieces = [
    steps ? `${steps} plan step${steps === 1 ? '' : 's'}` : null,
    executions ? `${executions} worker call${executions === 1 ? '' : 's'}` : null,
    proof ? `${proof} proof record${proof === 1 ? '' : 's'}` : null,
    approvals ? `${approvals} approval${approvals === 1 ? '' : 's'} waiting` : null,
  ].filter(Boolean);
  return pieces.length ? pieces.join(' · ') : 'Answered directly';
}

function latestAssistantResult(messages: ConversationMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant' && message.result)?.result || null;
}

function conversationTitle(result: any, messages: ConversationMessage[]) {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')?.content;
  return result?.chat?.mission?.title ||
    result?.chat?.brain?.objective ||
    result?.intent?.objective ||
    (latestUser ? latestUser.slice(0, 92) : 'New TheOne mission');
}

function formatDuration(ms?: number | null) {
  if (!ms) return 'Ready';
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `Worked for ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `Worked for ${minutes}m ${rest}s`;
}

function formatRelativeTime(value?: string) {
  if (!value) return 'recent';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'recent';
  const diff = Date.now() - time;
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function runIdOf(run: any) {
  return run?.runId || run?.id || run?.taskId || '';
}

function runTitleOf(run: any) {
  return run?.title ||
    run?.taskName ||
    run?.chat?.mission?.title ||
    run?.metadata?.normalizedTask?.taskName ||
    run?.summary ||
    runIdOf(run) ||
    'TheOne mission';
}

function templateCommands(): CommandItem[] {
  return workerPrompts.map((item) => ({
    key: `template:${item.label}`,
    label: item.label,
    prompt: item.prompt,
    meta: 'starter',
    source: 'template' as const,
  }));
}

function promptForWorker(action: string, title?: string) {
  if (/browser\.extract|browser\.scrape|search\.web/i.test(action)) return `Use ${action} to analyze https://weareoneconnection.org and summarize useful findings`;
  if (/social\.post|x\./i.test(action)) return `Use ${action} to prepare a high-signal X workflow and wait for approval when needed`;
  if (/git\./i.test(action)) return `Use ${action} for repo weareoneconnection/theone and explain what needs attention`;
  if (/desktop\./i.test(action)) return `Use ${action} through the local desktop bridge for Google Chrome`;
  if (/file\.|document\.|spreadsheet\./i.test(action)) return `Use ${action} to inspect files and summarize the result`;
  if (/api\.|webhook|health/i.test(action)) return `Use ${action} to call the OneClaw health API and summarize the response`;
  return `Use ${action || title || 'this worker'} to help finish my task`;
}

function normalizeWorkerCommands(payload: any): CommandItem[] {
  const workers = Array.isArray(payload?.workers) ? payload.workers : [];
  const commands: CommandItem[] = [];
  for (const worker of workers) {
    const rawActions = Array.isArray(worker?.actions)
      ? worker.actions
      : Array.isArray(worker?.capabilities)
        ? worker.capabilities
        : worker?.action
          ? [worker.action]
          : [];
    for (const raw of rawActions) {
      const action = typeof raw === 'string' ? raw : raw?.action || raw?.name || raw?.key;
      if (!action) continue;
      const title = typeof raw === 'string' ? worker?.title || worker?.name : raw?.title || worker?.title || worker?.name;
      const status = raw?.liveMode || raw?.maturity || worker?.status || worker?.mode || 'worker';
      commands.push({
        key: `worker:${worker?.key || worker?.id || worker?.name || 'oneclaw'}:${action}`,
        label: title || action,
        prompt: promptForWorker(action, title),
        meta: `${action} · ${friendlyStatus(status)}${raw?.approvalRequired || worker?.approvalRequired ? ' · approval' : ''}`,
        source: 'worker',
        action,
      });
    }
  }
  return commands;
}

function missionTimeline(result: any, loading: boolean, stage: number): TimelineItem[] {
  const hasResult = Boolean(result?.chat || result?.runId || result?.ok !== undefined);
  const blocked = result?.ok === false || activeStatus(result, loading) === 'blocked';
  const approvals = pendingApprovals(result).length;
  const executions = result?.executions?.length || 0;
  const proof = result?.proof?.length || result?.proofRecords?.length || 0;
  const current = Math.min(stage, 5);
  const timed = (index: number): TimelineItem['status'] => {
    if (blocked && index >= Math.max(2, current)) return 'blocked';
    if (loading && index === current) return 'running';
    if (loading && index > current) return 'waiting';
    return hasResult ? 'done' : index === 0 ? 'ready' : 'waiting';
  };

  return [
    { key: 'intent', title: 'Understand goal', detail: result?.chat?.brain?.objective || 'Turn the message into an outcome.', status: timed(0) },
    { key: 'plan', title: 'Build workflow', detail: result?.chat?.oneAiWorkflow?.summary || 'OneAI creates a structured route.', status: timed(1) },
    { key: 'policy', title: approvals ? 'Approval gate' : 'Policy cleared', detail: approvals ? `${approvals} decision waiting.` : 'TheOne validates risk and mode.', status: approvals ? 'blocked' : timed(2) },
    { key: 'worker', title: executions ? 'Worker called' : 'Prepare worker', detail: executions ? `${executions} execution record(s).` : 'OneClaw route is selected when needed.', status: timed(3) },
    { key: 'proof', title: proof ? 'Proof stored' : 'Collect proof', detail: proof ? `${proof} proof record(s).` : 'Receipts and evidence are attached.', status: timed(4) },
    { key: 'answer', title: 'Return answer', detail: hasResult ? 'Readable result is shown in chat.' : 'TheOne will answer when the route completes.', status: timed(5) },
  ];
}

function workerLifecycle(result: any, execution: any): TimelineItem[] {
  const approvals = pendingApprovals(result);
  const status = String(execution?.status || '').toLowerCase();
  const failed = /failed|error|rejected|blocked/.test(status);
  const completed = /success|completed|mock/.test(status);
  const approvalWaiting = approvals.length > 0;
  return [
    {
      key: 'planned',
      title: 'Planned',
      detail: execution?.taskName || result?.pendingOneClawTask?.taskName || 'TheOne selected a worker route.',
      status: 'done',
    },
    {
      key: 'policy',
      title: approvalWaiting ? 'Approval waiting' : 'Policy cleared',
      detail: approvalWaiting ? `${approvals.length} approval decision needed.` : 'Risk, mode, and worker access checked.',
      status: approvalWaiting ? 'blocked' : 'done',
    },
    {
      key: 'running',
      title: completed || failed ? 'Worker finished' : 'Worker running',
      detail: execution?.externalId || execution?.provider || 'OneClaw worker execution.',
      status: completed || failed ? 'done' : 'running',
    },
    {
      key: 'completed',
      title: failed ? 'Failed' : completed ? 'Completed' : 'Awaiting receipt',
      detail: execution?.summary || 'The worker receipt is tracked by TheOne.',
      status: failed ? 'blocked' : completed ? 'done' : 'waiting',
    },
    {
      key: 'summarized',
      title: 'Summarized',
      detail: result?.chat?.assistant?.content ? 'The result was converted into a readable answer.' : 'TheOne will summarize the worker output.',
      status: result?.chat?.assistant?.content ? 'done' : 'waiting',
    },
  ];
}

function workflowSteps(result: any) {
  return result?.chat?.oneAiWorkflow?.steps || [];
}

function activeWorkflowSteps(result: any) {
  const steps = workflowSteps(result);
  if (steps.length) return steps;
  return result?.plan?.steps || [];
}

function resultActions(result: any) {
  const actions = [
    { label: 'Continue', prompt: 'continue' },
    { label: 'Retry', prompt: 'retry' },
    { label: 'Revise', prompt: 'revise this result to be clearer and more useful' },
    { label: 'Report', prompt: 'turn this result into a concise report' },
    { label: 'Save', prompt: 'save this to TheOne memory' },
  ];
  if (pendingApprovals(result).length) {
    return [{ label: 'Approve', prompt: 'approve' }, { label: 'Reject', prompt: 'reject' }, ...actions.filter((item) => item.label !== 'Save')];
  }
  return actions;
}

function PlanChecklist({ result }: { result: any }) {
  const steps = activeWorkflowSteps(result).slice(0, 6);
  if (!steps.length) return null;

  return (
    <div className="run-plan-checklist">
      <span>Plan</span>
      {steps.map((step: any, index: number) => (
        <div key={step.id || index}>
          <small>{friendlyStatus(step.status || step.approvalMode || 'ready')}</small>
          <strong>{step.title || step.action || 'Task step'}</strong>
        </div>
      ))}
    </div>
  );
}

function ResultActions({
  result,
  busy,
  content,
  onAction,
}: {
  result: any;
  busy: boolean;
  content: string;
  onAction: (prompt: string) => void;
}) {
  if (!result?.chat && !result?.runId) return null;
  return (
    <div className="run-result-actions">
      <button type="button" disabled={busy} onClick={() => navigator.clipboard?.writeText(content)}>
        Copy
      </button>
      {resultActions(result).map((action) => (
        <button key={action.label} type="button" disabled={busy} onClick={() => onAction(action.prompt)}>
          {action.label}
        </button>
      ))}
      {result.runId ? <Link href={`/runs/${result.runId}`}>Open run</Link> : null}
    </div>
  );
}

function pendingApprovals(result: any) {
  const approvals = result?.approvals || [];
  return Array.isArray(approvals)
    ? approvals.filter((approval: any) => approval?.required && approval?.status === 'pending')
    : [];
}

function coordinationWorkers(result: any) {
  return result?.chat?.workerCoordination?.workers || [
    { key: 'oneai', title: 'OneAI', role: 'Builds the workflow', status: result ? 'ready' : 'waiting' },
    { key: 'theone', title: 'TheOne Kernel', role: 'Checks policy and proof', status: result ? 'ready' : 'waiting' },
    { key: 'oneclaw', title: 'OneClaw', role: 'Runs approved workers', status: result ? 'ready' : 'waiting' },
  ];
}

function missionQuickCommand(content: string, result: any) {
  const runId = result?.runId;
  if (!runId) return null;
  const value = content.trim().toLowerCase();
  const compact = value.replace(/\s+/g, ' ');
  const pending = pendingApprovals(result).length > 0;
  if (pending && /^(approve|approve all|批准|同意|确认|yes|ok|可以)$/.test(compact)) return 'approve';
  if (pending && /^(reject|reject all|拒绝|取消|不要|no)$/.test(compact)) return 'reject';
  if (/^(continue|resume|sync|继续|接着|同步|刷新)$/.test(compact)) return 'resume';
  if (/^(retry|rebuild|replay|重试|重新执行|重新规划|再跑一次)$/.test(compact)) return 'replay';
  return null;
}

function AgentProgress({ stage }: { stage: number }) {
  return (
    <div className="run-agent-progress" aria-live="polite">
      <div>
        <span>{String(Math.min(stage + 1, liveProgressStages.length)).padStart(2, '0')}</span>
        <strong>{liveProgressStages[Math.min(stage, liveProgressStages.length - 1)]}</strong>
      </div>
      <div className="run-progress-dots">
        {liveProgressStages.map((label, index) => (
          <i key={label} className={index <= stage ? 'active' : ''} />
        ))}
      </div>
    </div>
  );
}

function MissionTimeline({
  result,
  loading,
  stage,
}: {
  result: any;
  loading: boolean;
  stage: number;
}) {
  const items = missionTimeline(result, loading, stage);
  return (
    <div className="run-mission-timeline">
      <div className="run-timeline-head">
        <span>Mission timeline</span>
        <strong>{loading ? liveProgressStages[Math.min(stage, liveProgressStages.length - 1)] : activeStatus(result, loading)}</strong>
      </div>
      {items.map((item, index) => (
        <div key={item.key} className={`run-timeline-item timeline-${item.status}`}>
          <small>{String(index + 1).padStart(2, '0')}</small>
          <div>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkStatusLine({ result }: { result: any }) {
  const text = workStatusLine(result);
  if (!text) return null;
  return (
    <div className="run-work-status-line">
      <span>Work</span>
      <strong>{text}</strong>
    </div>
  );
}

function WelcomePanel({
  busy,
  onPrompt,
}: {
  busy: boolean;
  onPrompt: (prompt: string) => void;
}) {
  return (
    <section className="run-welcome-panel">
      <span>TheOne AI OS</span>
      <h1>What should TheOne finish?</h1>
      <p>
        Give me an outcome. I can answer, plan, call workers, request approval, and return proof without exposing the system machinery.
      </p>
      <div className="run-welcome-prompts">
        {workerPrompts.slice(0, 4).map((item) => (
          <button key={item.label} type="button" disabled={busy} onClick={() => onPrompt(item.prompt)}>
            <small>{item.label}</small>
            <strong>{item.prompt}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function ApprovalCard({
  result,
  busy,
  onDecision,
}: {
  result: any;
  busy: boolean;
  onDecision: (decision: 'approve' | 'reject', approvalId?: string) => void;
}) {
  const approvals = pendingApprovals(result);
  if (!approvals.length) return null;
  const task = result?.pendingOneClawTask || result?.chat?.workerCoordination?.oneclawTask;
  const first = approvals[0];

  return (
    <div className="run-approval-card">
      <div>
        <span className="product-card-kicker">Approval gate</span>
        <strong>{task?.taskName || first.action || 'Worker task waiting'}</strong>
        <p>{first.reason || 'TheOne policy needs your decision before OneClaw executes this worker.'}</p>
      </div>
      <div className="approval-actions">
        <button className="mini-action primary" type="button" disabled={busy} onClick={() => onDecision('approve', first.id)}>Approve</button>
        <button className="mini-action" type="button" disabled={busy} onClick={() => onDecision('reject', first.id)}>Reject</button>
        {approvals.length > 1 ? (
          <>
            <button className="mini-action primary" type="button" disabled={busy} onClick={() => onDecision('approve')}>Approve all</button>
            <button className="mini-action" type="button" disabled={busy} onClick={() => onDecision('reject')}>Reject all</button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ToolTrace({ result }: { result: any }) {
  if (!result?.chat) return null;

  const workflow = result.chat.oneAiWorkflow;
  const coordination = result.chat.workerCoordination;
  const workers = coordinationWorkers(result);
  const steps = workflowSteps(result);
  const timeline = result.chat.agentTimeline || coordination?.agentTimeline || [];
  const oneclawRun = coordination?.oneclawRun;
  const evidence = evidenceText(result);
  const reason = approvalReason(result);

  return (
    <details className="run-tool-trace">
      <summary>
        <span>Work trace</span>
        <strong>{steps.length || workers.length || 1} step(s)</strong>
      </summary>
      <div className="run-tool-body">
        {timeline.length ? (
          <div className="run-agent-timeline">
            {timeline.map((item: any) => (
              <div key={item.key || `${item.actor}_${item.title}`} className={`timeline-${workerTone(item.status)}`}>
                <span>{item.actor || 'TheOne'}</span>
                <strong>{item.title}</strong>
                <em>{friendlyStatus(item.status)} · {item.detail}</em>
              </div>
            ))}
          </div>
        ) : null}

        <div className="run-tool-section">
          <span>OneAI plan</span>
          <strong>{workflow?.summary || 'TheOne asked OneAI to decide the workflow.'}</strong>
          {steps.length ? (
            <div className="run-tool-steps">
              {steps.map((step: any, index: number) => (
                <div key={step.id || index}>
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <p>{step.title || step.action || 'Workflow step'}</p>
                  <em>{step.worker || step.owner || 'theone'} · {friendlyStatus(step.status || step.approvalMode || 'ready')}</em>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="run-tool-section">
          <span>Worker route</span>
          <div className="run-tool-workers">
            {workers.map((worker: any) => (
              <div key={worker.key || worker.title}>
                <strong>{worker.title}</strong>
                <small className={`status-pill status-${workerTone(worker.status)}`}>{friendlyStatus(worker.status)}</small>
                <p>{worker.role}</p>
              </div>
            ))}
          </div>
        </div>

        {reason ? (
          <div className="run-tool-section">
            <span>Policy</span>
            <strong>{reason}</strong>
          </div>
        ) : null}

        {oneclawRun ? (
          <div className="run-tool-section">
            <span>OneClaw receipt</span>
            <strong>{oneclawRun.taskName || 'Worker task'} · {friendlyStatus(oneclawRun.status || 'called')}</strong>
          </div>
        ) : null}

        {evidence ? (
          <div className="run-tool-section">
            <span>Evidence</span>
            <p>{evidence.slice(0, 900)}{evidence.length > 900 ? ' ...' : ''}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function WorkerCallCards({ result }: { result: any }) {
  const executions = Array.isArray(result?.executions) ? result.executions : [];
  if (!executions.length) return null;

  return (
    <div className="run-worker-call-cards">
      {executions.slice(-4).map((execution: any, index: number) => {
        const status = friendlyStatus(execution.status || 'ready');
        const taskName = execution.taskName || execution.action || execution.provider || 'worker.call';
        const receipt = execution.receipt || execution.raw?.receipt || execution.raw?.normalizedReceipt || execution.raw;
        return (
          <details key={execution.id || `${taskName}_${index}`} className="run-worker-call-card">
            <summary>
              <span>{execution.provider || 'worker'}</span>
              <strong>{taskName}</strong>
              <small>{status}</small>
            </summary>
            <div>
              <p>{execution.summary || 'The worker returned a receipt for this mission.'}</p>
              <div className="run-worker-lifecycle">
                {workerLifecycle(result, execution).map((item, itemIndex) => (
                  <div key={item.key} className={`timeline-${item.status}`}>
                    <small>{String(itemIndex + 1).padStart(2, '0')}</small>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                ))}
              </div>
              {execution.externalId ? <code>{execution.externalId}</code> : null}
              {receipt ? <pre>{JSON.stringify(receipt, null, 2).slice(0, 1800)}</pre> : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function StreamEventList({ events }: { events: StreamEvent[] }) {
  if (!events.length) return null;
  const labelFor = (event: string) => ({
    plan_delta: 'Plan',
    tool_start: 'Worker start',
    tool_result: 'Worker result',
    approval_required: 'Approval',
    proof_recorded: 'Proof',
  }[event] || event.replace(/_/g, ' '));

  return (
    <details className="run-side-details" open>
      <summary>
        <span>Live events</span>
        <strong>{events.length}</strong>
      </summary>
      <div className="run-stream-events">
        {events.slice(-8).map((item) => (
          <div key={item.id}>
            <small>{labelFor(item.event)}</small>
            <strong>{item.data?.title || item.data?.taskName || item.data?.action || item.data?.summary || item.data?.status || 'event'}</strong>
            {item.data?.reason || item.data?.value ? <p>{item.data.reason || item.data.value}</p> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function RunPageContent() {
  const searchParams = useSearchParams();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('assist');
  const [loading, setLoading] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [messages, setMessages] = useState<ConversationMessage[]>([starterMessage]);
  const [result, setResult] = useState<any>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [workerCommands, setWorkerCommands] = useState<CommandItem[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<CommandItem | null>(null);
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [workedMs, setWorkedMs] = useState<number | null>(null);
  const [chatSessionId, setChatSessionId] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const status = activeStatus(result, loading);
  const stats = runStats(result);
  const workflow = result?.chat?.oneAiWorkflow;
  const coordination = result?.chat?.workerCoordination;
  const brain = result?.chat?.brain;
  const nextActions = result?.chat?.nextActions || [];
  const modelRoute = result?.chat?.modelRoute;
  const appPackages = result?.chat?.appPackages || [];
  const workerCatalog = result?.chat?.workerCatalog;
  const workerCapabilityMap = brain?.workerCapabilityMap || [];
  const latestResult = latestAssistantResult(messages) || result;
  const mission = latestResult?.chat?.mission || result?.chat?.mission;
  const workerRuntime = latestResult?.chat?.workerRuntime || result?.chat?.workerRuntime;
  const missionState = latestResult?.chat?.missionState || workerRuntime?.missionState || result?.chat?.missionState;
  const continuity = latestResult?.chat?.continuity || result?.chat?.continuity;
  const currentSteps = activeWorkflowSteps(latestResult);
  const title = conversationTitle(latestResult, messages);
  const hasUserMessages = messages.some((message) => message.role === 'user');
  const commands = [...templateCommands(), ...workerCommands];
  const filteredPrompts = commands.filter((item) => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return true;
    return `${item.label} ${item.prompt} ${item.meta}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    const stored = window.localStorage.getItem('theone.chatSessionId');
    const id = stored || createId('session');
    window.localStorage.setItem('theone.chatSessionId', id);
    setChatSessionId(id);
  }, []);

  useEffect(() => {
    if (!loading) {
      setProgressStage(0);
      return undefined;
    }

    const timer = window.setInterval(() => {
      setProgressStage((stage) => Math.min(liveProgressStages.length - 1, stage + 1));
    }, 850);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/theone/runs?limit=8', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
      fetch('/api/theone/workers', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
    ]).then(([runsData, workersData]) => {
      if (!active) return;
      if (Array.isArray(runsData?.items)) setRunHistory(runsData.items);
      setWorkerCommands(normalizeWorkerCommands(workersData).slice(0, 80));
    });
    return () => {
      active = false;
    };
  }, [latestResult?.runId, stats.executions]);

  useEffect(() => {
    const continueRunId = searchParams.get('continue');
    if (!continueRunId || result) return;
    fetch(`/api/theone/runs/${continueRunId}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.runId) return;
        setResult(data);
        if (data?.chat?.conversation?.sessionId) {
          setChatSessionId(data.chat.conversation.sessionId);
          window.localStorage.setItem('theone.chatSessionId', data.chat.conversation.sessionId);
        }
        const restoredMessages = Array.isArray(data?.chat?.conversation?.messages)
          ? data.chat.conversation.messages
            .filter((message: any) => message?.role === 'user' || message?.role === 'assistant' || message?.role === 'system')
            .map((message: any, index: number) => ({
              id: createId(`restored_${index}`),
              role: message.role,
              content: String(message.content || ''),
              createdAt: message.createdAt || new Date().toISOString(),
              result: index === data.chat.conversation.messages.length - 1 && message.role === 'assistant' ? data : undefined,
            }))
            .filter((message: ConversationMessage) => message.content.trim())
          : [];
        if (restoredMessages.length) {
          setMessages(restoredMessages);
        } else {
          setMessages((current) => ([
            ...current,
            {
              id: createId('assistant_resume'),
              role: 'assistant',
              content: `I loaded mission ${data.runId}. Tell me what to change, retry, summarize, or continue.`,
              createdAt: new Date().toISOString(),
              result: data,
            },
          ]));
        }
      })
      .catch(() => undefined);
  }, [searchParams, result]);

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMessage: ConversationMessage = {
      id: createId('user'),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setWorkedMs(null);
    setStreamEvents([]);
    const startedAt = Date.now();

    try {
      const command = missionQuickCommand(content, latestResult);
      if (command && latestResult?.runId) {
        const endpoint = command === 'approve'
          ? '/api/theone/approvals/approve'
          : command === 'reject'
            ? '/api/theone/approvals/reject'
            : command === 'resume'
              ? `/api/theone/runs/${latestResult.runId}/resume`
              : `/api/theone/runs/${latestResult.runId}/replay`;
        const data = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: command === 'approve'
            ? JSON.stringify({ runId: latestResult.runId, approveAll: true })
            : command === 'reject'
              ? JSON.stringify({ runId: latestResult.runId, rejectAll: true })
              : undefined,
        }).then((res) => res.json());
        const resolved = data.result || data;
        if (resolved?.ok === false || data?.ok === false) throw new Error(data.error || resolved.error || 'Mission command failed.');
        setResult(resolved);
        setMessages((current) => ([
          ...current,
          {
            id: createId(`assistant_${command}`),
            role: 'assistant',
            content: command === 'approve'
              ? 'Approved. I continued the mission and refreshed the worker status.'
              : command === 'reject'
                ? 'Rejected. I kept the external worker from running.'
                : command === 'resume'
                  ? plainResult(resolved)
                  : `I rebuilt the mission route.\n\n${plainResult(resolved)}`,
            createdAt: new Date().toISOString(),
            result: resolved,
          },
        ]));
        return;
      }

      const payload = {
        input: content,
        mode,
        language: 'en',
        context: latestResult?.chat ? {
          runId: latestResult.runId,
          mission: latestResult.chat.mission,
          workerRuntime: latestResult.chat.workerRuntime,
          missionState: latestResult.chat.missionState || latestResult.chat.workerRuntime?.missionState,
          continuity: latestResult.chat.continuity,
          pendingOneClawTask: latestResult.pendingOneClawTask,
          approvals: latestResult.approvals,
          executions: latestResult.executions,
          lastAssistant: latestResult.chat.assistant?.content || latestResult.summary,
        } : undefined,
        messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
        sessionId: chatSessionId || undefined,
        attachments,
        selectedWorker: selectedWorker ? {
          key: selectedWorker.key,
          label: selectedWorker.label,
          action: selectedWorker.action,
          meta: selectedWorker.meta,
        } : undefined,
      };
      let data: any;
      const streamMessageId = createId('assistant_stream');
      let streamed = false;
      try {
        data = await postChatWithStream(
          payload,
          (stage) => setProgressStage(stage),
          (delta) => {
            streamed = true;
            setMessages((current) => {
              const existing = current.find((message) => message.id === streamMessageId);
              if (existing) {
                return current.map((message) => (
                  message.id === streamMessageId
                    ? { ...message, content: `${message.content}${delta}` }
                    : message
                ));
              }
              return [
                ...current,
                {
                  id: streamMessageId,
                  role: 'assistant',
                  content: delta,
                  createdAt: new Date().toISOString(),
                },
              ];
            });
          },
          (event, eventData) => {
            setStreamEvents((current) => [
              ...current.slice(-24),
              {
                id: createId('stream'),
                event,
                data: eventData,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
        );
      } catch {
        data = await postChatJson(payload);
      }
      setResult(data);
      setMessages((current) => {
        if (streamed) {
          return current.map((message) => (
            message.id === streamMessageId
              ? { ...message, content: plainResult(data), result: data }
              : message
          ));
        }
        return [
          ...current,
          {
            id: createId('assistant'),
            role: 'assistant',
            content: plainResult(data),
            createdAt: new Date().toISOString(),
            result: data,
          },
        ];
      });
      if (data?.chat?.conversation?.sessionId) {
        setChatSessionId(data.chat.conversation.sessionId);
        window.localStorage.setItem('theone.chatSessionId', data.chat.conversation.sessionId);
      }
      setAttachments([]);
      setSelectedWorker(null);
    } catch (error) {
      const failure = { ok: false, error: error instanceof Error ? error.message : 'TheOne could not start this run.' };
      setResult(failure);
      setMessages((current) => ([
        ...current,
        {
          id: createId('assistant_error'),
          role: 'assistant',
          content: plainResult(failure),
          createdAt: new Date().toISOString(),
          result: failure,
        },
      ]));
    } finally {
      setWorkedMs(Date.now() - startedAt);
      setLoading(false);
    }
  }

  async function decideApproval(decision: 'approve' | 'reject', approvalId?: string) {
    const runId = latestResult?.runId || result?.runId;
    if (!runId || loading) return;
    setLoading(true);
    setWorkedMs(null);
    const startedAt = Date.now();
    try {
      const endpoint = decision === 'approve' ? '/api/theone/approvals/approve' : '/api/theone/approvals/reject';
      const payload = decision === 'approve'
        ? { runId, approvalId, approveAll: !approvalId }
        : { runId, approvalId, rejectAll: !approvalId };
      const data = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((res) => res.json());
      if (data.ok === false) throw new Error(data.error || 'Approval decision failed.');
      setResult(data);
      setMessages((current) => ([
        ...current,
        {
          id: createId(`assistant_${decision}`),
          role: 'assistant',
          content: decision === 'approve'
            ? 'Approved. I refreshed the mission so you can see whether OneClaw executed or still needs follow-up.'
            : 'Rejected. I kept the external worker from running.',
          createdAt: new Date().toISOString(),
          result: data,
        },
      ]));
    } catch (error) {
      const failure = { ok: false, error: error instanceof Error ? error.message : 'Approval decision failed.' };
      setResult(failure);
      setMessages((current) => ([
        ...current,
        {
          id: createId('assistant_approval_error'),
          role: 'assistant',
          content: plainResult(failure),
          createdAt: new Date().toISOString(),
          result: failure,
        },
      ]));
    } finally {
      setWorkedMs(Date.now() - startedAt);
      setLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendMessage();
    }
  }

  async function handleAttachmentInput(files: FileList | null) {
    const pending = Array.from(files || []).slice(0, 8).map((file) => ({
      id: createId('attachment_pending'),
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      status: 'uploading' as const,
    }));
    if (!pending.length) return;
    setAttachments((current) => [...current, ...pending].slice(-12));
    try {
      const uploaded = await uploadChatAttachments(files);
      setAttachments((current) => [
        ...current.filter((item) => !pending.some((pendingItem) => pendingItem.id === item.id)),
        ...uploaded,
      ].slice(-12));
    } catch {
      setAttachments((current) => current.map((item) => (
        pending.some((pendingItem) => pendingItem.id === item.id)
          ? { ...item, status: 'failed' as const, summary: 'Upload failed.' }
          : item
      )));
    }
  }

  function startNewChat() {
    const id = createId('session');
    window.localStorage.setItem('theone.chatSessionId', id);
    setChatSessionId(id);
    setMessages([{
      ...starterMessage,
      id: createId('assistant_starter'),
      createdAt: new Date().toISOString(),
    }]);
    setResult(null);
    setInput('');
    setAttachments([]);
    setSelectedWorker(null);
    setStreamEvents([]);
    setWorkedMs(null);
  }

  return (
    <main className={inspectorOpen ? 'run-product-shell' : 'run-product-shell inspector-closed'}>
          <aside className="run-session-rail run-product-sidebar" aria-label="TheOne sessions">
            <div className="run-rail-brand">
              <strong>TheOne</strong>
              <span>AI OS</span>
            </div>
            <nav className="run-rail-nav">
              <button type="button" onClick={startNewChat}>New chat</button>
              {sessionShortcuts.filter((item) => item.label !== 'New chat').map((item) => (
                <Link key={item.label} href={item.href}>{item.label}</Link>
              ))}
            </nav>
            <div className="run-rail-projects">
              <span>Active Work</span>
              {runHistory.length ? runHistory.slice(0, 7).map((run) => {
                const id = runIdOf(run);
                return (
                  <Link key={id || runTitleOf(run)} className="run-history-item" href={id ? `/run?continue=${id}` : '/runs'}>
                    <strong>{runTitleOf(run).slice(0, 58)}{runTitleOf(run).length > 58 ? '...' : ''}</strong>
                    <small>{friendlyStatus(run?.status || run?.workflow?.status || 'saved')} · {formatRelativeTime(run?.updatedAt || run?.createdAt)}</small>
                  </Link>
                );
              }) : (messages.filter((message) => message.role === 'user').slice(-5).reverse()).map((message, index) => (
                <button key={message.id} type="button" onClick={() => setInput(message.content)}>
                  <strong>{message.content.slice(0, 48)}{message.content.length > 48 ? '...' : ''}</strong>
                  <small>#{index + 1}</small>
                </button>
              ))}
              {!runHistory.length && messages.filter((message) => message.role === 'user').length === 0 ? (
                <p>Start a mission to build the working thread.</p>
              ) : null}
            </div>
            <div className="run-rail-footer">
              <Link href="/runs">History</Link>
              <Link href="/settings">Settings</Link>
              <Link href="/admin">Admin</Link>
            </div>
          </aside>

          <section className="run-product-main">
          <div className="run-product-topbar">
            <div className="run-title-block">
              <span>TheOne</span>
              <strong>{title}</strong>
              <em>{loading ? liveProgressStages[Math.min(progressStage, liveProgressStages.length - 1)] : formatDuration(workedMs)}</em>
            </div>
            <div className="run-topbar-actions">
              <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
              <button type="button" className="mini-action" onClick={() => setInspectorOpen((open) => !open)}>
                {inspectorOpen ? 'Hide inspector' : 'Current work'}
              </button>
            </div>
          </div>

          <div className={`run-thread ${!hasUserMessages ? 'run-thread-empty' : ''}`} ref={threadRef} aria-live="polite">
            {!hasUserMessages ? <WelcomePanel busy={loading} onPrompt={(prompt) => sendMessage(prompt)} /> : null}
            {messages.map((message) => (
              <article key={message.id} className={`run-message run-message-${message.role}`}>
                <div className="run-message-meta">
                  <span>{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'TheOne' : 'System'}</span>
                  <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
                <p>{message.content}</p>
                {message.role === 'assistant' && message.result ? <WorkStatusLine result={message.result} /> : null}
                {message.result?.appRoute ? (
                  <div className="run-message-route">
                    <span>{message.result.appRoute.title}</span>
                    <strong>{message.result.appRoute.action}</strong>
                  </div>
                ) : null}
                {message.role === 'assistant' && message.result ? <ToolTrace result={message.result} /> : null}
                {message.role === 'assistant' && message.result ? <WorkerCallCards result={message.result} /> : null}
                {message.role === 'assistant' && message.result ? (
                  <ApprovalCard result={message.result} busy={loading} onDecision={decideApproval} />
                ) : null}
                {message.role === 'assistant' && message.result ? (
                  <ResultActions result={message.result} busy={loading} content={message.content} onAction={(prompt) => sendMessage(prompt)} />
                ) : null}
              </article>
            ))}
            {loading ? <AgentProgress stage={progressStage} /> : null}
          </div>

          <div className="run-composer">
            <div className="run-composer-toolbar">
              <button type="button" onClick={() => setExamplesOpen((open) => !open)} disabled={loading}>/ Commands</button>
              <button type="button" onClick={() => {
                setExamplesOpen(true);
                setCommandQuery('worker');
              }} disabled={loading}>@ Worker</button>
              <label className="run-attach-button">
                Attach
                <input
                  type="file"
                  multiple
                  onChange={async (event) => {
                    await handleAttachmentInput(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
            {examplesOpen ? (
              <div className="run-examples-popover">
                <div className="run-command-search">
                  <span>Command palette</span>
                  <input
                    value={commandQuery}
                    onChange={(event) => setCommandQuery(event.target.value)}
                    placeholder="Search apps, workers, or actions..."
                  />
                </div>
                {filteredPrompts.slice(0, 24).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setExamplesOpen(false);
                      setCommandQuery('');
                      setInput(item.prompt);
                      setSelectedWorker(item.source === 'worker' ? item : null);
                    }}
                    disabled={loading}
                  >
                    <span>{item.source === 'worker' ? 'Worker' : item.label}</span>
                    <strong>{item.prompt}</strong>
                    <small>{item.source === 'worker' ? item.meta : 'template'}</small>
                  </button>
                ))}
                {!filteredPrompts.length ? <p>No matching command yet.</p> : null}
              </div>
            ) : null}
            <textarea
              value={input}
              onChange={(event) => {
                const value = event.target.value;
                setInput(value);
                if (value.startsWith('/')) {
                  setExamplesOpen(true);
                  setCommandQuery(value.slice(1));
                } else if (value.startsWith('@')) {
                  setExamplesOpen(true);
                  setCommandQuery(value.slice(1) || 'worker');
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask TheOne to finish a job, call a worker, inspect a site, prepare an X post, check GitHub, use desktop bridge..."
            />
            {selectedWorker ? (
              <div className="run-selected-worker">
                <span>Worker route</span>
                <strong>{selectedWorker.action || selectedWorker.label}</strong>
                <small>{selectedWorker.meta}</small>
                <button type="button" onClick={() => setSelectedWorker(null)}>Clear</button>
              </div>
            ) : null}
            <div className="run-composer-actions">
              <div className="run-permission-menu" aria-label="Execution mode">
                {modes.map((item) => (
                  <button key={item} type="button" className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>
                    {item}
                  </button>
                ))}
              </div>
              <span>Cmd/Ctrl + Enter</span>
              <button className="run-button" type="button" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
                {loading ? 'Working...' : 'Send'}
              </button>
            </div>
            {attachments.length ? (
              <div className="run-attachment-strip">
                {attachments.map((attachment) => (
                  <span key={attachment.id} className={`attachment-${attachment.status}`}>
                    {attachment.name}
                    <small>{attachment.status === 'ready' ? 'ready' : attachment.status}</small>
                  </span>
                ))}
                <button type="button" onClick={() => setAttachments([])}>Clear</button>
              </div>
            ) : null}
          </div>
          </section>

        <aside className="run-codex-side run-product-inspector">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Inspector</h2>
              <p className="panel-subtitle">Current work, gates, proof, and raw details when needed.</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          <div className="run-mission-card">
            <span className="product-card-kicker">Current goal</span>
            <strong>{mission?.title || brain?.objective || 'Understand the user outcome before routing workers.'}</strong>
            <div className="run-explain-grid">
              <div>
                <span>Mode</span>
                <strong>{mission?.mode || brain?.mode || mode}</strong>
              </div>
              <div>
                <span>Intent</span>
                <strong>{mission?.conversationKind || brain?.conversationKind || 'ready'}</strong>
              </div>
            </div>
            {mission?.workspace ? (
              <p className="panel-subtitle">
                Workspace: {mission.workspace.title}. Resume from {mission.recovery?.replayRoute || '/runs'}.
              </p>
            ) : null}
            {brain?.reasoning?.strategy ? (
              <p className="panel-subtitle">{brain.reasoning.strategy}</p>
            ) : null}
          </div>

          <MissionTimeline result={latestResult} loading={loading} stage={progressStage} />
          <StreamEventList events={streamEvents} />

          <details className="run-side-details">
            <summary>
              <span>Plan</span>
              <strong>{currentSteps.length || 1}</strong>
            </summary>
            <div className="run-current-plan">
              {(currentSteps.length ? currentSteps.slice(0, 6) : [{ id: 'ready', title: 'Describe an outcome', status: 'ready' }]).map((step: any, index: number) => (
                <div key={step.id || index}>
                  <small>{friendlyStatus(step.status || step.approvalMode || 'ready')}</small>
                  <strong>{step.title || step.action || 'Task step'}</strong>
                </div>
              ))}
            </div>
          </details>

          {workerRuntime ? (
            <div className="run-mission-card">
              <span className="product-card-kicker">Now</span>
              <strong>{workerRuntime.current?.title || friendlyStatus(workerRuntime.status)}</strong>
              <p className="panel-subtitle">{workerRuntime.current?.detail || workerRuntime.diagnostics?.userReadable}</p>
              {missionState ? (
                <div className="run-state-strip">
                  <span>{friendlyStatus(missionState.state)}</span>
                  <strong>{missionState.canResume ? 'Can resume' : 'Stable'}</strong>
                  <em>{missionState.canRetry ? 'Retry available' : continuity?.followUpIntent || 'Context linked'}</em>
                </div>
              ) : null}
            </div>
          ) : null}

          {pendingApprovals(latestResult).length ? (
            <div className="run-mission-card">
              <span className="product-card-kicker">Needs decision</span>
              <strong>{pendingApprovals(latestResult)[0]?.action || 'Approval required'}</strong>
              <p className="panel-subtitle">{pendingApprovals(latestResult)[0]?.reason}</p>
              <div className="approval-actions">
                <button className="mini-action primary" type="button" disabled={loading} onClick={() => decideApproval('approve')}>Approve all</button>
                <button className="mini-action" type="button" disabled={loading} onClick={() => decideApproval('reject')}>Reject all</button>
              </div>
            </div>
          ) : null}

          <details className="run-side-details" open={pendingApprovals(latestResult).length > 0}>
            <summary>
              <span>Actions</span>
              <strong>{pendingApprovals(latestResult).length ? 'decision' : 'ready'}</strong>
            </summary>
            <div className="run-side-action-grid">
              <button type="button" disabled={loading || !latestResult?.runId} onClick={() => sendMessage('continue')}>Continue</button>
              <button type="button" disabled={loading || !latestResult?.runId} onClick={() => sendMessage('retry')}>Retry</button>
              <button type="button" disabled={loading} onClick={() => sendMessage('turn the current result into a concise report')}>Report</button>
              <button type="button" disabled={loading} onClick={() => sendMessage('save this to TheOne memory')}>Save</button>
            </div>
            <WorkerCallCards result={latestResult} />
          </details>

          <details className="run-side-details">
            <summary>
              <span>Details</span>
              <strong>{workflowSteps(latestResult).length || 1}</strong>
            </summary>
            <strong>{workflow?.summary || 'Waiting for a goal.'}</strong>
            <div className="run-workflow-list">
              {(workflow?.steps || [
                { id: 'ready', title: 'Describe an outcome', owner: 'oneai', status: 'ready' },
              ]).map((step: any, index: number) => (
                <div key={step.id || index} className="run-workflow-step">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <small>{step.owner || 'theone'} · {friendlyStatus(step.status)}</small>
                  </div>
                </div>
              ))}
            </div>
            {workerRuntime?.phases?.length ? (
              <div className="run-tool-steps">
                {workerRuntime.phases.map((phase: any) => (
                  <div key={phase.key}>
                    <small>{friendlyStatus(phase.status)}</small>
                    <p>{phase.title}</p>
                    <em>{phase.detail}</em>
                  </div>
                ))}
              </div>
            ) : null}
            {missionState?.stages?.length ? (
              <div className="run-tool-steps">
                {missionState.stages.map((stage: any) => (
                  <div key={stage.key}>
                    <small>{friendlyStatus(stage.status)}</small>
                    <p>{stage.title}</p>
                    <em>{stage.key}</em>
                  </div>
                ))}
              </div>
            ) : null}
          </details>

          <div className="run-result-stats">
            <div>
              <span>Approvals</span>
              <strong>{stats.approvals}</strong>
            </div>
            <div>
              <span>Executions</span>
              <strong>{stats.executions}</strong>
            </div>
            <div>
              <span>Proof</span>
              <strong>{stats.proof}</strong>
            </div>
          </div>

          <details className="run-side-details">
            <summary>
              <span>Advanced context</span>
              <strong>{modelRoute?.model || 'frontier'}</strong>
            </summary>
            <div className="run-explain-grid">
              <div>
                <span>Model</span>
                <strong>{modelRoute?.model || 'frontier alias'}</strong>
              </div>
              <div>
                <span>Workers</span>
                <strong>{workerCatalog?.workers || coordination?.workers?.length || 'ready'}</strong>
              </div>
            </div>
            {appPackages.length ? (
              <div className="app-next-list">
                {appPackages.slice(0, 4).map((pkg: any) => <span key={pkg.key}>{pkg.title}</span>)}
              </div>
            ) : null}
          </details>

          <details className="run-side-details">
            <summary>
              <span>Workers</span>
              <strong>{coordination?.workers?.length || 'ready'}</strong>
            </summary>
            <div className="run-worker-list">
              {coordinationWorkers(latestResult).map((worker: any) => (
                <div key={worker.key || worker.title} className="run-worker-row">
                  <div>
                    <strong>{worker.title}</strong>
                    <span>{worker.role}</span>
                  </div>
                  <small className={`status-pill status-${workerTone(worker.status)}`}>{friendlyStatus(worker.status)}</small>
                </div>
              ))}
            </div>
          </details>

          <div className="run-mission-card">
            <span className="product-card-kicker">Next</span>
            <div className="app-next-list">
              {(nextActions.length > 0 ? nextActions : [
                'Start with a normal request. TheOne will choose the app or worker.',
                'Use Advanced only when you need raw traces.',
              ]).map((item: string) => <span key={item}>{item}</span>)}
            </div>
          </div>

          {workerCapabilityMap.length ? (
            <details className="run-side-details">
              <summary>
                <span>Capability map</span>
                <strong>{workerCapabilityMap.length}</strong>
              </summary>
              <div className="app-next-list">
                {workerCapabilityMap.slice(0, 28).map((item: any) => (
                  <span key={item.domain}>
                    {item.title} · {item.actions?.length || 0} · {friendlyStatus(item.status)}
                  </span>
                ))}
              </div>
            </details>
          ) : null}

        </aside>
    </main>
  );
}

export default function RunPage() {
  return (
    <Suspense fallback={null}>
      <RunPageContent />
    </Suspense>
  );
}
