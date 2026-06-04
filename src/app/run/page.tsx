'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

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

const starterMessage: ConversationMessage = {
  id: 'assistant_starter',
  role: 'assistant',
  createdAt: new Date().toISOString(),
  content: 'Tell me the outcome you want. I will ask OneAI to build the workflow, route the right workers, check policy, call OneClaw when needed, and keep the proof trail readable.',
};

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

function firstStep(result: any) {
  const task = result?.chat?.workerCoordination?.oneclawTask || result?.pendingOneClawTask;
  return task?.steps?.[0] || null;
}

function taskDraft(result: any) {
  const input = firstStep(result)?.input || {};
  return input.content || input.text || input.body || '';
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

function latestAssistantResult(messages: ConversationMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant' && message.result)?.result || null;
}

function workflowSteps(result: any) {
  return result?.chat?.oneAiWorkflow?.steps || [];
}

function coordinationWorkers(result: any) {
  return result?.chat?.workerCoordination?.workers || [
    { key: 'oneai', title: 'OneAI', role: 'Builds the workflow', status: result ? 'ready' : 'waiting' },
    { key: 'theone', title: 'TheOne Kernel', role: 'Checks policy and proof', status: result ? 'ready' : 'waiting' },
    { key: 'oneclaw', title: 'OneClaw', role: 'Runs approved workers', status: result ? 'ready' : 'waiting' },
  ];
}

function ToolTrace({ result }: { result: any }) {
  if (!result?.chat) return null;

  const workflow = result.chat.oneAiWorkflow;
  const coordination = result.chat.workerCoordination;
  const workers = coordinationWorkers(result);
  const steps = workflowSteps(result);
  const oneclawRun = coordination?.oneclawRun;
  const evidence = evidenceText(result);
  const reason = approvalReason(result);

  return (
    <details className="run-tool-trace">
      <summary>
        <span>Tool calls</span>
        <strong>{steps.length || workers.length || 1} step(s)</strong>
      </summary>
      <div className="run-tool-body">
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

function RunMessageExplanation({ result }: { result: any }) {
  if (!result?.chat) return null;

  const step = firstStep(result);
  const action = step?.action || '';
  const draft = taskDraft(result);
  const evidence = evidenceText(result);
  const reason = approvalReason(result);
  const finalSummary = result?.chat?.workerCoordination?.finalSummary;
  const approvalSummary = result?.chat?.workerCoordination?.approvalSummary;
  const oneclawRun = result?.chat?.workerCoordination?.oneclawRun;

  if (!draft && !evidence && !reason && !oneclawRun && !approvalSummary && !finalSummary) return null;

  return (
    <div className="run-explain">
      {draft ? (
        <div className="run-explain-block">
          <span>Draft</span>
          <p>{draft}</p>
        </div>
      ) : null}
      {reason ? (
        <div className="run-explain-block">
          <span>Policy</span>
          <p>{reason}</p>
        </div>
      ) : null}
      {evidence ? (
        <details className="run-explain-details">
          <summary>Evidence from worker</summary>
          <p>{evidence.slice(0, 1400)}{evidence.length > 1400 ? ' ...' : ''}</p>
        </details>
      ) : null}
      {oneclawRun ? (
        <div className="run-explain-grid">
          <div>
            <span>Worker</span>
            <strong>{action || oneclawRun.taskName || 'OneClaw task'}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{friendlyStatus(oneclawRun.status || 'called')}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function RunPage() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('assist');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([starterMessage]);
  const [result, setResult] = useState<any>(null);
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

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

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
      const res = await fetch('/api/theone/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: content,
          mode,
          language: 'en',
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <ProductPage
      eyebrow="Run TheOne"
      title="A super-agent chat for real-world work."
      subtitle="Tell TheOne the outcome. It can answer directly, build a workflow with OneAI, call OneClaw workers, and return receipts without turning the main screen into a control panel."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'State', value: friendlyStatus(status), tone: status },
            { label: 'Mode', value: mode, tone: mode },
            { label: 'Workers', value: coordination?.workers?.length || 'ready', tone: 'assist' },
          ]}
        />
      )}
    >
      <section className="run-codex-workspace">
        <div className="run-codex-main">
          <div className="run-codex-toolbar">
            <div>
              <span className="product-card-kicker">TheOne Chat Runtime</span>
              <strong>Chat first. Tools when needed.</strong>
            </div>
            <div className="product-mode-selector mode-selector" aria-label="Execution mode">
              {modes.map((item) => (
                <button key={item} type="button" className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="run-thread" ref={threadRef} aria-live="polite">
            {messages.map((message) => (
              <article key={message.id} className={`run-message run-message-${message.role}`}>
                <div className="run-message-meta">
                  <span>{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'TheOne' : 'System'}</span>
                  <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
                <p>{message.content}</p>
                {message.result?.appRoute ? (
                  <div className="run-message-route">
                    <span>{message.result.appRoute.title}</span>
                    <strong>{message.result.appRoute.action}</strong>
                  </div>
                ) : null}
                {message.role === 'assistant' && message.result ? <ToolTrace result={message.result} /> : null}
              </article>
            ))}
            {loading ? (
              <article className="run-message run-message-assistant">
                <div className="run-message-meta">
                  <span>TheOne</span>
                  <small>working</small>
                </div>
                <p>OneAI is building the workflow. TheOne is checking policy and preparing the worker route.</p>
              </article>
            ) : null}
          </div>

          <div className="run-codex-prompts" aria-label="Worker quick starts">
            {workerPrompts.map((item) => (
              <button key={item.label} type="button" onClick={() => sendMessage(item.prompt)} disabled={loading}>
                <span>{item.label}</span>
                <strong>{item.prompt}</strong>
              </button>
            ))}
          </div>

          <div className="run-composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask TheOne to finish a job, call a worker, inspect a site, prepare an X post, check GitHub, use desktop bridge..."
            />
            <div className="run-composer-actions">
              <span>Cmd/Ctrl + Enter to run</span>
              <button className="run-button" type="button" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
                {loading ? 'Coordinating...' : 'Send to TheOne'}
              </button>
            </div>
          </div>
        </div>

        <aside className="run-codex-side">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Mission</h2>
              <p className="panel-subtitle">A small live view of the current run.</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          <div className="run-mission-card">
            <span className="product-card-kicker">Current goal</span>
            <strong>{brain?.objective || 'Understand the user outcome before routing workers.'}</strong>
            <div className="run-explain-grid">
              <div>
                <span>Mode</span>
                <strong>{brain?.mode || mode}</strong>
              </div>
              <div>
                <span>Intent</span>
                <strong>{brain?.conversationKind || 'ready'}</strong>
              </div>
            </div>
            {brain?.reasoning?.strategy ? (
              <p className="panel-subtitle">{brain.reasoning.strategy}</p>
            ) : null}
          </div>

          <details className="run-side-details" open>
            <summary>
              <span>Workflow</span>
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
              <span>Runtime</span>
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

          <div className="run-control-links">
            <Link href="/apps">Apps</Link>
            <Link href="/workers">Workers</Link>
            <Link href="/runs">Runs</Link>
            <Link href="/theone">Advanced trace</Link>
          </div>
        </aside>
      </section>
    </ProductPage>
  );
}
