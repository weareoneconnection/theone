'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

export default function WorkspaceMissionControlPage() {
  const params = useParams<{ key: string }>();
  const key = String(params?.key || '');
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/theone/workspaces/${key}`, { cache: 'no-store' });
      const json = await res.json();
      setDetail(json.ok ? json : null);
      setMessage(json.ok ? '' : json.error || 'Workspace unavailable.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Workspace unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function runNow() {
    setLoading(true);
    setMessage('Running workspace now...');
    try {
      const res = await fetch(`/api/theone/workspaces/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_now' }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.result?.error || json.error || 'Workspace run failed.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Workspace run failed.');
      setLoading(false);
    }
  }

  useEffect(() => {
    if (key) load();
  }, [key]);

  const workspace = detail?.workspace;
  const policy = detail?.policy || {};
  const diagnostics = detail?.diagnostics || {};
  const runs = detail?.runs || [];
  const proof = detail?.proof || [];
  const memory = detail?.memory || [];
  const packages = detail?.packages || [];

  return (
    <ProductPage
      eyebrow="Workspace Mission Control"
      title={workspace?.title || 'Workspace'}
      subtitle={workspace?.purpose || 'Independent timeline, policy, memory, proof, and failure diagnostics for this autonomous workspace.'}
      compact
      aside={<ProductStatusStrip items={[
        { label: 'Level', value: 'L26', tone: 'assist' },
        { label: 'Status', value: workspace?.circuitOpen ? 'circuit' : friendlyStatus(workspace?.status), tone: workspace?.circuitOpen ? 'blocked' : 'online' },
        { label: 'Risk', value: policy.risk || 'managed', tone: policy.risk === 'high' ? 'manual' : 'assist' },
      ]} />}
    >
      <section className="mission-control-grid">
        <article className="product-card mission-primary">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Control</h2>
              <p className="panel-subtitle">Run, inspect, and diagnose this workspace without entering raw automation logs.</p>
            </div>
            <span className={`status-pill status-${diagnostics.status === 'blocked' ? 'blocked' : diagnostics.status === 'watch' ? 'assist' : 'online'}`}>
              {diagnostics.status || 'ready'}
            </span>
          </div>
          {workspace ? (
            <>
              <div className="workspace-command">{workspace.command}</div>
              <div className="run-result-stats">
                <div><span>Cadence</span><strong>{policy.cadenceMinutes}m</strong></div>
                <div><span>Limit</span><strong>{policy.maxRunsPerDay}/day</strong></div>
                <div><span>Failures</span><strong>{workspace.failureStreak}</strong></div>
              </div>
              <div className="approval-actions">
                <button className="mini-action primary" type="button" onClick={runNow} disabled={loading || workspace.circuitOpen}>Run now</button>
                <Link className="mini-action" href="/workspaces">Back to workspaces</Link>
                <span className="proof-meta">{workspace.nextRunAt ? `Next ${new Date(workspace.nextRunAt).toLocaleString()}` : 'not scheduled'}</span>
              </div>
            </>
          ) : (
            <ProductEmpty title={loading ? 'Loading workspace' : 'Workspace unavailable'} detail={message || 'The workspace detail could not be loaded.'} />
          )}
        </article>

        <aside className="product-card mission-side">
          <h2 className="panel-title">Diagnosis</h2>
          <p className="panel-subtitle">{diagnostics.nextAction || 'No diagnosis yet.'}</p>
          <div className="product-list compact">
            <div className="product-memory-item"><strong>Failure count</strong><p>{diagnostics.failureCount || 0}</p></div>
            <div className="product-memory-item"><strong>Latest failure</strong><p>{diagnostics.latestFailure || 'none'}</p></div>
            <div className="product-memory-item"><strong>Circuit breaker</strong><p>{policy.circuitBreaker || '2 consecutive failures'}</p></div>
          </div>
        </aside>
      </section>

      <section className="mission-control-grid">
        <article className="product-card">
          <h2 className="panel-title">Policy</h2>
          <p className="panel-subtitle">The guardrails attached to this workspace.</p>
          <div className="policy-chip-row">
            {(policy.controls || []).map((control: string) => <span key={control} className="capability-chip">{control}</span>)}
          </div>
          <div className="run-result-stats">
            <div><span>Mode</span><strong>{policy.mode || 'assist'}</strong></div>
            <div><span>Risk</span><strong>{policy.risk || 'managed'}</strong></div>
            <div><span>Packages</span><strong>{packages.length}</strong></div>
          </div>
        </article>

        <article className="product-card">
          <h2 className="panel-title">Package Runtime</h2>
          <p className="panel-subtitle">Installable App, Worker, Connector, Policy, and Memory pieces this workspace can compose with.</p>
          <div className="workspace-run-list">
            {packages.length === 0 ? <span>No related packages reported.</span> : packages.slice(0, 6).map((item: any) => (
              <div key={item.id} className="workspace-run-row">
                <span className={`status-pill status-${item.enabled ? 'online' : 'idle'}`}>{item.enabled ? 'enabled' : item.status}</span>
                <p>{item.title}</p>
                <small>v{item.version}</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="mission-timeline-grid">
        <article className="product-card">
          <h2 className="panel-title">Timeline</h2>
          <p className="panel-subtitle">Recent autonomous runs for this workspace.</p>
          <div className="workspace-run-list">
            {runs.length === 0 ? <span>No runs yet.</span> : runs.map((run: any) => (
              <div key={run.id} className="workspace-run-row">
                <span className={`status-pill status-${run.status === 'success' ? 'online' : run.status === 'failed' ? 'blocked' : 'assist'}`}>{friendlyStatus(run.status)}</span>
                <p>{run.summary}</p>
                <small>{run.createdAt ? new Date(run.createdAt).toLocaleString() : ''}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="product-card">
          <h2 className="panel-title">Proof</h2>
          <p className="panel-subtitle">Evidence generated by this workspace.</p>
          <div className="workspace-run-list">
            {proof.length === 0 ? <span>No proof linked yet.</span> : proof.map((item: any) => (
              <div key={item.id} className="workspace-run-row">
                <span className="status-pill status-online">{item.type}</span>
                <p>{item.title}</p>
                <small>{item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="product-card">
          <h2 className="panel-title">Memory</h2>
          <p className="panel-subtitle">Reusable context this workspace can carry forward.</p>
          <div className="workspace-run-list">
            {memory.length === 0 ? <span>No memory linked yet.</span> : memory.map((item: any) => (
              <div key={item.id} className="workspace-run-row">
                <span className="status-pill status-assist">{item.kind}</span>
                <p>{item.title || item.summary}</p>
                <small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      {message ? <section className="product-card"><p className="panel-subtitle">{message}</p></section> : null}
    </ProductPage>
  );
}
