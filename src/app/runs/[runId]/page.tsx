'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

export default function RunMissionPage({ params }: { params: Promise<{ runId: string }> }) {
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    params.then(({ runId: id }) => setRunId(id));
  }, [params]);

  async function load(id = runId) {
    if (!id) return;
    setLoading(true);
    try {
      const data = await fetch(`/api/theone/runs/${id}`, { cache: 'no-store' }).then((res) => res.json());
      if (data.ok === false) throw new Error(data.error || 'Run not found.');
      setRun(data);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Run not found.');
    } finally {
      setLoading(false);
    }
  }

  async function resume() {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await fetch(`/api/theone/runs/${runId}/resume`, { method: 'POST' }).then((res) => res.json());
      if (!data.ok) throw new Error(data.error || 'Resume failed.');
      setRun(data.result);
      setMessage('Mission resumed and refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Resume failed.');
    } finally {
      setLoading(false);
    }
  }

  async function approve(approvalId?: string) {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await fetch('/api/theone/approvals/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, approvalId, approveAll: !approvalId }),
      }).then((res) => res.json());
      if (data.ok === false) throw new Error(data.error || 'Approval failed.');
      setRun(data);
      setMessage('Approval accepted. The mission was updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Approval failed.');
    } finally {
      setLoading(false);
    }
  }

  async function reject(approvalId?: string) {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await fetch('/api/theone/approvals/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, approvalId, rejectAll: !approvalId }),
      }).then((res) => res.json());
      if (data.ok === false) throw new Error(data.error || 'Rejection failed.');
      setRun(data);
      setMessage('Approval rejected. No external worker was submitted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Rejection failed.');
    } finally {
      setLoading(false);
    }
  }

  async function replay() {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await fetch(`/api/theone/runs/${runId}/replay`, { method: 'POST' }).then((res) => res.json());
      if (!data.ok) throw new Error(data.error || 'Replay failed.');
      setRun(data.result);
      setRunId(data.result.runId);
      setMessage(`Mission rebuilt from ${data.replayOf}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Replay failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (runId) load(runId);
  }, [runId]);

  const mission = run?.chat?.mission || run?.proof?.[0]?.metadata?.mission;
  const workerRuntime = run?.chat?.workerRuntime || run?.proof?.[0]?.metadata?.workerRuntime;
  const workflow = run?.os?.workflow || {};
  const approvals = run?.approvals || [];
  const executions = run?.executions || [];
  const proof = run?.proof || [];
  const pending = approvals.filter((approval: any) => approval.required && approval.status === 'pending').length;
  const failed = executions.filter((execution: any) => /fail|blocked|rejected/i.test(execution.status || '')).length;
  const shouldPoll = Boolean(runId && run && (
    pending > 0 ||
    /running|prepared|awaiting|submitted|pending/i.test(`${workflow.status || ''} ${workerRuntime?.status || ''}`) ||
    executions.some((execution: any) => /running|submitted|awaiting|pending/i.test(execution.status || ''))
  ));

  useEffect(() => {
    if (!shouldPoll || loading) return undefined;
    const timer = window.setInterval(() => load(runId), 8000);
    return () => window.clearInterval(timer);
  }, [shouldPoll, loading, runId, pending, workflow.status, workerRuntime?.status]);

  return (
    <ProductPage
      eyebrow="Mission Control"
      title={mission?.title || run?.intent?.objective || 'TheOne mission detail'}
      subtitle="A durable view of one TheOne run: conversation outcome, workflow, worker runtime, approvals, proof, and failure diagnosis."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Status', value: friendlyStatus(workflow.status || (run?.ok ? 'completed' : 'blocked')), tone: workflow.status || (run?.ok ? 'completed' : 'blocked') },
            { label: 'Approvals', value: pending, tone: pending ? 'manual' : 'online' },
            { label: 'Proof', value: proof.length },
            { label: 'Failures', value: failed, tone: failed ? 'blocked' : 'online' },
          ]}
        />
      )}
    >
      {!run && !loading ? (
        <section className="product-card">
          <ProductEmpty title="Mission unavailable" detail={message || 'The run could not be loaded.'} />
        </section>
      ) : null}

      {run ? (
        <section className="mission-control-grid">
          <article className="product-card">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">Mission</h2>
                <p className="panel-subtitle">{mission?.objective || run.intent?.objective}</p>
              </div>
              <span className={`status-pill status-${workerRuntime?.status || workflow.status}`}>{friendlyStatus(workerRuntime?.status || workflow.status)}</span>
            </div>
            <div className="run-result-stats">
              <div><span>Run</span><strong>{run.runId}</strong></div>
              <div><span>Mode</span><strong>{mission?.mode || run.os?.mode || 'assist'}</strong></div>
              <div><span>Workspace</span><strong>{mission?.workspace?.title || 'Chat'}</strong></div>
            </div>
            <div className="approval-actions">
              <button className="mini-action primary" type="button" disabled={loading} onClick={resume}>Resume / Sync</button>
              <button className="mini-action primary" type="button" disabled={loading} onClick={replay}>Retry / Rebuild</button>
              <button className="mini-action" type="button" disabled={loading} onClick={() => load()}>Refresh</button>
              <Link className="mini-action" href="/run">Continue in chat</Link>
              <Link className="mini-action" href="/theone">Advanced trace</Link>
            </div>
            <p className="panel-subtitle">
              {shouldPoll ? 'Live tracking is on while approval, worker execution, or recovery is active.' : 'Live tracking is idle because this mission is stable.'}
            </p>
            {message ? <p className="panel-subtitle">{message}</p> : null}
          </article>

          <article className="product-card">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">Current Runtime</h2>
                <p className="panel-subtitle">{workerRuntime?.diagnostics?.userReadable || 'TheOne runtime state is ready.'}</p>
              </div>
              <span className={`status-pill status-${workerRuntime?.diagnostics?.severity === 'high' ? 'blocked' : 'assist'}`}>
                {workerRuntime?.diagnostics?.category || 'ready'}
              </span>
            </div>
            <div className="run-workflow-list">
              {(workerRuntime?.phases || []).map((phase: any) => (
                <div key={phase.key} className="run-workflow-step">
                  <span>{friendlyStatus(phase.status)}</span>
                  <div>
                    <strong>{phase.title}</strong>
                    <small>{phase.detail}</small>
                  </div>
                </div>
              ))}
            </div>
            {workerRuntime?.diagnostics?.nextFixes?.length ? (
              <div className="app-next-list">
                {workerRuntime.diagnostics.nextFixes.map((item: string) => <span key={item}>{item}</span>)}
              </div>
            ) : null}
            <div className="approval-actions">
              <button className="mini-action primary" type="button" disabled={loading} onClick={resume}>Resume current route</button>
              <button className="mini-action" type="button" disabled={loading} onClick={replay}>Rebuild workflow</button>
              <Link className="mini-action" href={`/run?continue=${run.runId}`}>Revise in chat</Link>
            </div>
          </article>

          <article className="product-card">
            <h2 className="panel-title">Workflow Timeline</h2>
            <div className="run-workflow-list">
              {(workflow.steps || run.plan?.steps || []).map((step: any, index: number) => (
                <div key={step.id || index} className="run-workflow-step">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{step.title || step.action}</strong>
                    <small>{step.action} · {friendlyStatus(step.status)}{step.error ? ` · ${step.error}` : ''}</small>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="product-card">
            <h2 className="panel-title">Approvals And Executions</h2>
            <div className="product-list">
              {approvals.length === 0 && executions.length === 0 ? (
                <ProductEmpty title="No gated work" detail="This mission did not need external approval or worker execution." />
              ) : null}
              {approvals.map((approval: any) => (
                <div key={approval.id} className="product-list-item">
                  <div><span className="product-card-kicker">Approval</span><h2>{approval.action}</h2><p>{approval.reason}</p></div>
                  <div className="product-list-side">
                    <span className={`status-pill status-${approval.status}`}>{friendlyStatus(approval.status)}</span>
                    {approval.required && approval.status === 'pending' ? (
                      <>
                        <button className="mini-action primary" type="button" disabled={loading} onClick={() => approve(approval.id)}>Approve</button>
                        <button className="mini-action" type="button" disabled={loading} onClick={() => reject(approval.id)}>Reject</button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
              {executions.map((execution: any) => (
                <div key={execution.id} className="product-list-item">
                  <div><span className="product-card-kicker">{execution.provider}</span><h2>{execution.taskName || execution.summary}</h2><p>{execution.summary}</p></div>
                  <span className={`status-pill status-${execution.status}`}>{friendlyStatus(execution.status)}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="product-card mission-control-wide">
            <h2 className="panel-title">Proof</h2>
            <div className="product-list">
              {proof.length === 0 ? (
                <ProductEmpty title="No proof recorded" detail="TheOne will show receipts and evidence here after work is handled." />
              ) : proof.map((item: any, index: number) => (
                <div key={`${item.title}_${index}`} className="product-list-item">
                  <div>
                    <span className="product-card-kicker">{item.type}</span>
                    <h2>{item.title}</h2>
                    <p>{item.value || 'Proof metadata recorded.'}</p>
                  </div>
                  <span>{item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}</span>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </ProductPage>
  );
}
