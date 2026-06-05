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
  { label: 'History', href: '/runs' },
  { label: 'Settings', href: '/settings' },
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

function RunPageContent() {
  const searchParams = useSearchParams();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('assist');
  const [loading, setLoading] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [messages, setMessages] = useState<ConversationMessage[]>([starterMessage]);
  const [result, setResult] = useState<any>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
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
  const filteredPrompts = workerPrompts.filter((item) => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return true;
    return `${item.label} ${item.prompt}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

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
    const continueRunId = searchParams.get('continue');
    if (!continueRunId || result) return;
    fetch(`/api/theone/runs/${continueRunId}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.runId) return;
        setResult(data);
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

      const res = await fetch('/api/theone/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });
      const data = await res.json();
      setResult(data);
      setMessages((current) => ([
        ...current,
        {
          id: createId('assistant'),
          role: 'assistant',
          content: plainResult(data),
          createdAt: new Date().toISOString(),
          result: data,
        },
      ]));
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
      setLoading(false);
    }
  }

  async function decideApproval(decision: 'approve' | 'reject', approvalId?: string) {
    const runId = latestResult?.runId || result?.runId;
    if (!runId || loading) return;
    setLoading(true);
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
      setLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <main className={inspectorOpen ? 'run-product-shell' : 'run-product-shell inspector-closed'}>
          <aside className="run-session-rail run-product-sidebar" aria-label="TheOne sessions">
            <div className="run-rail-brand">
              <strong>TheOne</strong>
              <span>AI OS</span>
            </div>
            <nav className="run-rail-nav">
              {sessionShortcuts.map((item) => (
                <Link key={item.label} href={item.href}>{item.label}</Link>
              ))}
            </nav>
            <div className="run-rail-projects">
              <span>Active Work</span>
              {(messages.filter((message) => message.role === 'user').slice(-5).reverse()).map((message, index) => (
                <button key={message.id} type="button" onClick={() => setInput(message.content)}>
                  <strong>{message.content.slice(0, 48)}{message.content.length > 48 ? '...' : ''}</strong>
                  <small>#{index + 1}</small>
                </button>
              ))}
              {messages.filter((message) => message.role === 'user').length === 0 ? (
                <p>Start a mission to build the working thread.</p>
              ) : null}
            </div>
            <div className="run-rail-footer">
              <Link href="/runs">History</Link>
              <Link href="/settings">Settings</Link>
            </div>
          </aside>

          <section className="run-product-main">
          <div className="run-product-topbar">
            <div className="run-title-block">
              <span>TheOne</span>
              <strong>{title}</strong>
            </div>
            <div className="run-topbar-actions">
              <div className="product-mode-selector mode-selector run-topbar-mode" aria-label="Execution mode">
                {modes.map((item) => (
                  <button key={item} type="button" className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>
                    {item}
                  </button>
                ))}
              </div>
              <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
              <button type="button" className="mini-action" onClick={() => setInspectorOpen((open) => !open)}>
                {inspectorOpen ? 'Hide inspector' : 'Show inspector'}
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
              <button type="button" onClick={() => setInput('continue')} disabled={loading || !latestResult?.runId}>Continue mission</button>
              <button type="button" onClick={() => setInput('approve')} disabled={loading || !pendingApprovals(latestResult).length}>Approve</button>
              <button type="button" onClick={() => setInput('retry')} disabled={loading || !latestResult?.runId}>Retry</button>
              <button type="button" onClick={() => setInput('turn the current result into a report')} disabled={loading}>Report</button>
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
                {filteredPrompts.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setExamplesOpen(false);
                      setCommandQuery('');
                      setInput(item.prompt);
                    }}
                    disabled={loading}
                  >
                    <span>{item.label}</span>
                    <strong>{item.prompt}</strong>
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
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask TheOne to finish a job, call a worker, inspect a site, prepare an X post, check GitHub, use desktop bridge..."
            />
            <div className="run-composer-actions">
              <span>Cmd/Ctrl + Enter to run</span>
              <button className="run-button" type="button" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
                {loading ? 'Working...' : 'Send'}
              </button>
            </div>
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

          <details className="run-side-details" open={currentSteps.length > 0}>
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

          <details className="run-side-details run-admin-details">
            <summary>
              <span>Admin tools</span>
              <strong>hidden</strong>
            </summary>
            <div className="run-control-links">
              <Link href="/apps">Apps</Link>
              <Link href="/workers">Workers</Link>
              <Link href="/proof">Proof</Link>
              <Link href="/approvals">Approvals</Link>
              <Link href="/admin">Admin</Link>
            </div>
          </details>
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
