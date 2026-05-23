'use client';

import { useEffect, useState } from 'react';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

type Workspace = {
  key: string;
  title: string;
  app: string;
  purpose: string;
  command: string;
  cadenceMinutes: number;
  maxRunsPerDay: number;
  risk: string;
  status: 'active' | 'paused' | 'available';
  failureStreak: number;
  circuitOpen: boolean;
  nextRunAt?: string | null;
  controls: string[];
};

type WorkspaceRun = {
  id: string;
  jobId: string;
  runId?: string | null;
  status: string;
  summary: string;
  createdAt?: string;
};

export default function WorkspacesPage() {
  const [items, setItems] = useState<Workspace[]>([]);
  const [runs, setRuns] = useState<WorkspaceRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/workspaces', { cache: 'no-store' });
      const json = await res.json();
      setItems(json.workspaces || []);
      setRuns(json.runs || []);
      setMessage(json.ok ? '' : json.error || 'Workspaces unavailable.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Workspaces unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function setWorkspace(key: string, status: 'active' | 'paused') {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, status }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Workspace update failed.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Workspace update failed.');
      setLoading(false);
    }
  }

  async function runWorkspaceNow(key: string) {
    setLoading(true);
    setMessage('Running workspace now...');
    try {
      const res = await fetch('/api/theone/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, action: 'run_now' }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.result?.error || json.error || 'Workspace run failed.');
      setMessage('Workspace run completed and recorded.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Workspace run failed.');
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const active = items.filter((item) => item.status === 'active').length;
  const circuits = items.filter((item) => item.circuitOpen).length;

  function runsFor(item: Workspace) {
    return runs.filter((run) => run.jobId === `workspace_${item.key}`).slice(0, 3);
  }

  return (
    <ProductPage
      eyebrow="Autonomous Workspaces"
      title="Work that can keep going."
      subtitle="Turn an App workflow into a governed ongoing workspace with cadence, proof, memory, limits, and circuit breakers."
      compact
      aside={<ProductStatusStrip items={[{ label: 'Level', value: 'L25', tone: 'assist' }, { label: 'Active', value: active, tone: 'online' }, { label: 'Circuits', value: circuits, tone: circuits ? 'blocked' : 'online' }]} />}
    >
      <section className="app-workflow-band">
        <div><span>1</span><strong>Choose workspace</strong><p>Select the ongoing job TheOne should maintain.</p></div>
        <div><span>2</span><strong>Apply controls</strong><p>Cadence, max runs, approval gates, and failure circuit breakers stay attached.</p></div>
        <div><span>3</span><strong>Compound memory</strong><p>Each run records proof and App memory for the next cycle.</p></div>
      </section>

      <section className="workspace-board">
        {items.length === 0 ? (
          <ProductEmpty title={loading ? 'Loading workspaces' : 'No workspaces'} detail="TheOne will show autonomous workspaces here." />
        ) : items.map((item) => (
          <article key={item.key} className="workspace-card">
            <div className="workspace-card-head">
              <div>
                <span className="product-card-kicker">{item.app} · every {item.cadenceMinutes}m</span>
                <h2>{item.title}</h2>
              </div>
              <span className={`status-pill status-${item.circuitOpen ? 'blocked' : item.status === 'active' ? 'auto' : 'idle'}`}>
                {item.circuitOpen ? 'circuit' : friendlyStatus(item.status)}
              </span>
            </div>
            <p>{item.purpose}</p>
            <div className="workspace-command">{item.command}</div>
            <div className="run-result-stats">
              <div><span>Risk</span><strong>{item.risk}</strong></div>
              <div><span>Limit</span><strong>{item.maxRunsPerDay}/day</strong></div>
              <div><span>Failures</span><strong>{item.failureStreak}</strong></div>
            </div>
            <div className="policy-chip-row">
              {item.controls.map((control) => <span key={control} className="capability-chip">{control}</span>)}
            </div>
            <div className="approval-actions">
              <button className="mini-action primary" type="button" disabled={loading || item.circuitOpen} onClick={() => runWorkspaceNow(item.key)}>Run now</button>
              <button className="mini-action primary" type="button" disabled={loading} onClick={() => setWorkspace(item.key, 'active')}>Activate</button>
              <button className="mini-action" type="button" disabled={loading} onClick={() => setWorkspace(item.key, 'paused')}>Pause</button>
              <span className="proof-meta">{item.nextRunAt ? new Date(item.nextRunAt).toLocaleString() : 'not scheduled'}</span>
            </div>
            <div className="workspace-run-list">
              {runsFor(item).length === 0 ? (
                <span>No runs yet.</span>
              ) : runsFor(item).map((run) => (
                <div key={run.id} className="workspace-run-row">
                  <span className={`status-pill status-${run.status === 'success' ? 'online' : run.status === 'failed' ? 'blocked' : 'assist'}`}>{friendlyStatus(run.status)}</span>
                  <p>{run.summary}</p>
                  <small>{run.createdAt ? new Date(run.createdAt).toLocaleString() : ''}</small>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      {message ? <section className="product-card"><p className="panel-subtitle">{message}</p></section> : null}
    </ProductPage>
  );
}
