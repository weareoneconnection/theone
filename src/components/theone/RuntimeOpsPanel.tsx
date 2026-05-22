'use client';

import type { ReactNode } from 'react';

const apiRoutes = [
  'POST /api/theone/run',
  'POST /api/theone/command',
  'POST /api/theone/plan',
  'POST /api/theone/execute',
  'POST /api/theone/policy/evaluate',
  'GET /api/theone/packages',
  'POST /api/theone/packages',
  'POST /api/theone/packages/install',
  'GET /api/theone/production',
  'GET /api/theone/learning',
  'POST /api/theone/learning',
  'POST /api/theone/learning/apply',
  'GET /api/theone/automation/jobs',
  'POST /api/theone/automation/jobs',
  'POST /api/theone/automation/tick',
  'GET /api/theone/events/sources',
  'POST /api/theone/events/poll',
  'POST /api/theone/events/ingest',
  'POST /api/theone/events/route',
  'GET /api/theone/workers',
  'GET /api/theone/events/stream',
  'GET /api/theone/runs',
  'GET /api/theone/runs/:id',
  'POST /api/theone/runs/:id/replay',
  'POST /api/theone/runs/:id/resume',
  'GET /api/theone/events',
  'GET /api/theone/policy/rules',
  'POST /api/theone/policy/rules',
];

const agents = [
  'Planner Agent',
  'Critic Agent',
  'Policy Agent',
  'Memory Agent',
  'Recovery Agent',
  'Operator Agent',
];

export function RuntimeOpsPanel({ result, ledger }: { result: any; ledger: { runs: any[] } }) {
  const latestRuns = ledger.runs || [];
  const pending = latestRuns.filter((run: any) => run.pendingApprovals > 0).length;
  const running = latestRuns.filter((run: any) => ['running', 'submitted'].includes(String(run.latestExecutionStatus || '').toLowerCase())).length;
  const failed = latestRuns.filter((run: any) => run.ok === false || String(run.latestExecutionStatus || '').toLowerCase() === 'failed').length;
  const runId = result?.runId || latestRuns[0]?.runId;

  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Runtime Ops</h2>
          <p className="panel-subtitle">Queue, replay, resume, agent roles, permissions, and external API surface.</p>
        </div>
        <span className="panel-count">L17</span>
      </div>

      <div className="policy-kpis">
        <RuntimeKpi label="Pending" value={String(pending)} />
        <RuntimeKpi label="Running" value={String(running)} />
        <RuntimeKpi label="Failed" value={String(failed)} />
        <RuntimeKpi label="Runs" value={String(latestRuns.length)} />
      </div>

      <div className="route-summary-grid">
        <div className="route-box">
          <div className="mini-heading">Agent Runtime</div>
          <div className="capability-chip-list">
            {agents.map((agent) => <span key={agent} className="capability-chip">{agent}</span>)}
          </div>
        </div>
        <div className="route-box">
          <div className="mini-heading">Connector Permission Center</div>
          <div className="proof-meta">Action scope · connector scope · mode policy · approval gates · live credentials · event receipts</div>
        </div>
      </div>

      <div className="current-policy-card">
        <div className="mini-heading">Replay / Resume</div>
        <div className="feed-title">{runId || 'No run selected'}</div>
        <div className="approval-actions">
          <ApiButton disabled={!runId} href={runId ? `/api/theone/runs/${runId}/replay` : ''}>Replay endpoint</ApiButton>
          <ApiButton disabled={!runId} href={runId ? `/api/theone/runs/${runId}/resume` : ''}>Resume endpoint</ApiButton>
        </div>
      </div>

      <div className="policy-matrix">
        <div className="policy-row">
          <div className="mini-heading">TheOne API / SDK Surface</div>
          <div className="policy-chip-row">
            {apiRoutes.map((route) => <span key={route} className="capability-chip">{route}</span>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function RuntimeKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="policy-kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function ApiButton({ href, disabled, children }: { href: string; disabled?: boolean; children: ReactNode }) {
  if (disabled) return <button className="mini-action" disabled type="button">{children}</button>;
  return <a className="mini-action" href={href} target="_blank" rel="noreferrer">{children}</a>;
}
