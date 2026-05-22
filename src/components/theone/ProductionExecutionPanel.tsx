'use client';

import { useMemo, useState } from 'react';
import { getOneClawSignal } from './oneClawSignals';

const actionPresets = [
  {
    label: 'GitHub Repo',
    action: 'git.repo.get',
    approvalMode: 'auto' as const,
    input: {
      repo: 'weareoneconnection/oneaitradingbot',
    },
  },
  {
    label: 'GitHub Issue',
    action: 'git.issue.create',
    approvalMode: 'manual' as const,
    input: {
      repo: 'weareoneconnection/oneaitradingbot',
      title: 'TheOne production execution test',
      body: 'Created from TheOne Execution Command Center.',
    },
  },
  {
    label: 'Actions Runs',
    action: 'git.actions.runs',
    approvalMode: 'auto' as const,
    input: {
      repo: 'weareoneconnection/oneaitradingbot',
      branch: 'main',
    },
  },
  {
    label: 'X Reply',
    action: 'social.post',
    approvalMode: 'manual' as const,
    input: {
      channel: 'x',
      mode: 'reply_only',
      strictReply: true,
      replyToTweetId: '',
      content: 'Useful framing. The hard part is turning AI from isolated output into a governed workflow with context, permissions, tools, and proof.',
    },
  },
  {
    label: 'X Post',
    action: 'social.post',
    approvalMode: 'manual' as const,
    input: {
      channel: 'x',
      content: 'TheOne executed a governed OneClaw production workflow.',
    },
  },
];

function stringifyInput(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

function externalLink(task: any) {
  const step = Array.isArray(task?.steps) ? task.steps.find((item: any) => item?.output?.response?.html_url) : null;
  return step?.output?.response?.html_url || task?.response?.html_url || '';
}

export function ProductionExecutionPanel({
  result,
  loading,
  oneClawTasks = [],
  onRunOneClawAction,
  onRefreshOneClawTask,
}: {
  result: any;
  loading: boolean;
  oneClawTasks?: any[];
  onRunOneClawAction: (payload: {
    action: string;
    input: Record<string, unknown>;
    approvalMode: 'auto' | 'manual';
  }) => void;
  onRefreshOneClawTask: (taskId?: string) => void;
}) {
  const preflight = result?.preflight || result?.os?.preflight;
  const oneClawCapabilities = result?.os?.oneClawCapabilities || [];
  const oneClawConnectors = result?.os?.oneClawConnectors || [];
  const manifest = result?.os?.oneClawManifest;
  const templates = result?.os?.executionTemplates || [];
  const [selectedPreset, setSelectedPreset] = useState(actionPresets[0]);
  const [action, setAction] = useState(actionPresets[0].action);
  const [approvalMode, setApprovalMode] = useState<'auto' | 'manual'>(actionPresets[0].approvalMode);
  const [inputText, setInputText] = useState(stringifyInput(actionPresets[0].input));
  const [inputError, setInputError] = useState('');
  const readiness = oneClawCapabilities.reduce((summary: Record<string, number>, item: any) => {
    summary[item.maturity] = (summary[item.maturity] || 0) + 1;
    return summary;
  }, {});
  const monitoredTasks = useMemo(() => {
    const byId = new Map<string, any>();
    oneClawTasks.forEach((task: any) => {
      if (task?.id) byId.set(task.id, task);
    });
    const task = result?.oneClawActionResult?.result?.task || result?.oneClawActionResult?.result;
    if (task?.id) byId.set(task.id, task);
    const approvedTask = result?.oneClawApprovalResult?.result?.task;
    if (approvedTask?.id) byId.set(approvedTask.id, approvedTask);
    return Array.from(byId.values()).slice(0, 6);
  }, [oneClawTasks, result]);

  function selectPreset(preset: typeof actionPresets[number]) {
    setSelectedPreset(preset);
    setAction(preset.action);
    setApprovalMode(preset.approvalMode);
    setInputText(stringifyInput(preset.input));
    setInputError('');
  }

  function submitAction() {
    try {
      const input = JSON.parse(inputText || '{}');
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Input must be a JSON object.');
      }
      setInputError('');
      onRunOneClawAction({ action, input, approvalMode });
    } catch (error) {
      setInputError(error instanceof Error ? error.message : 'Invalid JSON input.');
    }
  }

  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Production Execution</h2>
          <p className="panel-subtitle">
            TheOne reads OneClaw's live manifest, then gates actions with templates, preflight, approvals, and proof.
          </p>
        </div>
        <span className={`status-pill status-${manifest?.source === 'live' ? 'connected' : preflight?.status || 'ready'}`}>
          {manifest?.source || preflight?.status || 'ready'}
        </span>
      </div>

      <div className="mini-kpis small">
        <Kpi label="Production" value={readiness.production || 0} />
        <Kpi label="Guarded" value={readiness.guarded || 0} />
        <Kpi label="Prepared" value={readiness.prepared || 0} />
        <Kpi label="Planned" value={readiness.planned || 0} />
      </div>

      <div className="route-summary-grid">
        <RouteBox title="Execution Templates" items={templates.map((template: any) => template.title)} />
        <RouteBox title="Live Connectors" items={oneClawConnectors.map((connector: any) => `${connector.title}: ${connector.status}`)} />
      </div>
      <div className="proof-meta">
        Manifest {manifest?.version || 'fallback'} · {oneClawCapabilities.length} actions · {oneClawConnectors.length} connectors
      </div>

      <div className="action-launcher">
        <div className="mini-heading">Action Launcher</div>
        <div className="preset-row">
          {actionPresets.map((preset) => (
            <button
              key={preset.action + preset.label}
              type="button"
              className={`mini-action ${selectedPreset.label === preset.label ? 'active' : ''}`}
              onClick={() => selectPreset(preset)}
              disabled={loading}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="launcher-grid">
          <label className="field-label">
            Action
            <input value={action} onChange={(event) => setAction(event.target.value)} />
          </label>
          <label className="field-label">
            Mode
            <select value={approvalMode} onChange={(event) => setApprovalMode(event.target.value === 'manual' ? 'manual' : 'auto')}>
              <option value="auto">auto</option>
              <option value="manual">manual</option>
            </select>
          </label>
        </div>
        <label className="field-label">
          Input
          <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} rows={6} />
        </label>
        {inputError ? <div className="inline-error">{inputError}</div> : null}
        <div className="approval-actions">
          <button className="run-button compact" type="button" disabled={loading || !action} onClick={submitAction}>
            Run OneClaw
          </button>
          <button className="mini-action" type="button" disabled={loading || monitoredTasks.length === 0} onClick={() => onRefreshOneClawTask()}>
            Refresh Tasks
          </button>
        </div>
      </div>

      <div className="production-list task-monitor">
        <div className="mini-heading">Task Monitor</div>
        {monitoredTasks.length === 0 ? (
          <div className="production-item">
            <div className="feed-title">No live OneClaw task captured yet.</div>
            <div className="proof-meta">Launch an action or approve a live gate to track execution here.</div>
          </div>
        ) : (
          monitoredTasks.map((task: any) => {
            const link = externalLink(task);
            const signal = getOneClawSignal(task);
            return (
              <div key={task.id} className="production-item">
                <div className="feed-head">
                  <div className="feed-title">{task.taskName || task.id}</div>
                  <span className={`status-pill status-${task.status}`}>{task.status}</span>
                </div>
                <div className="proof-meta">
                  {task.id} · {(task.steps || []).length} step(s)
                </div>
                {signal ? (
                  <div className={`signal-box signal-${signal.tone}`}>
                    <div className="signal-title">{signal.title}</div>
                    <div className="signal-detail">{signal.detail}</div>
                    <div className="signal-meta">
                      <span>{signal.code}</span>
                      <span>{signal.retryable ? 'retryable' : 'do not retry'}</span>
                      {signal.shouldBlockReplyTarget ? <span>block target</span> : null}
                    </div>
                  </div>
                ) : null}
                {Array.isArray(task.logs) && task.logs.length ? (
                  <div className="task-log">{task.logs.slice(-3).join('\n')}</div>
                ) : null}
                {Array.isArray(task.steps) ? (
                  <div className="step-list">
                    {task.steps.map((step: any) => (
                      <div key={step.stepId || step.id} className="step-row">
                        <span>{step.action}</span>
                        <span>{step.status}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="approval-actions">
                  <button className="mini-action" type="button" disabled={loading} onClick={() => onRefreshOneClawTask(task.id)}>
                    Sync Task
                  </button>
                  {link ? (
                    <a className="mini-action" href={link} target="_blank" rel="noreferrer">
                      Open Result
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="production-list">
        {preflight?.checks?.length ? (
          preflight.checks.map((check: any) => (
            <div key={check.id} className="production-item">
              <div className="feed-head">
                <div className="feed-title">{check.label}</div>
                <span className={`status-pill status-${check.status}`}>{check.status}</span>
              </div>
              <div className="proof-meta">{check.detail}</div>
            </div>
          ))
        ) : (
          oneClawCapabilities.slice(0, 6).map((capability: any) => (
            <div key={capability.action} className="production-item">
              <div className="feed-head">
                <div className="feed-title">{capability.title}</div>
                <span className={`risk-chip risk-${capability.risk}`}>{capability.maturity}</span>
              </div>
              <div className="proof-meta">{capability.action} · {capability.productionNote}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="kpi-tile">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function RouteBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="route-box">
      <div className="mini-heading">{title}</div>
      {items.length === 0 ? (
        <div className="proof-meta">Waiting for a run.</div>
      ) : (
        <div className="capability-chip-list">
          {items.slice(0, 6).map((item) => (
            <span key={item} className="capability-chip">{item}</span>
          ))}
        </div>
      )}
    </div>
  );
}
