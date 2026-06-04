'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

export default function RunsPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await fetch('/api/theone/runs?limit=30')
      .then((res) => res.json())
      .catch(() => ({ items: [] }));
    setRuns(data.items || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const completed = runs.filter((run) => run.workflowStatus === 'completed').length;
  const pending = runs.reduce((sum, run) => sum + (run.pendingApprovals || 0), 0);
  const proof = runs.reduce((sum, run) => sum + (run.proofCount || 0), 0);

  return (
    <ProductPage
      eyebrow="Run History"
      title="Every outcome TheOne has handled."
      subtitle="A plain timeline of work requests, status, approvals, and proof count. The advanced replay tools stay in the control console."
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Runs', value: runs.length },
            { label: 'Completed', value: completed, tone: 'completed' },
            { label: 'Pending', value: pending, tone: pending ? 'manual' : 'online' },
            { label: 'Proof', value: proof },
          ]}
        />
      )}
    >
      <section className="product-card">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Recent Work</h2>
            <p className="panel-subtitle">Open the advanced console when you need full trace, policy, and ledger detail.</p>
          </div>
          <button className="mini-action" type="button" onClick={load} disabled={loading}>Refresh</button>
        </div>
        <div className="product-list">
          {runs.length === 0 ? (
            <ProductEmpty title="No runs yet" detail="Start from Run TheOne and completed work will appear here." />
          ) : runs.map((run) => (
            <article key={run.runId} className="product-list-item">
              <div>
                <div className="product-card-kicker">{run.intentType || 'work request'}</div>
                <h2>{run.objective || 'Untitled run'}</h2>
                <p>{run.runId}</p>
              </div>
              <div className="product-list-side">
                <span className={`status-pill status-${run.workflowStatus}`}>{friendlyStatus(run.workflowStatus)}</span>
                <span>{run.pendingApprovals || 0} approval</span>
                <span>{run.proofCount || 0} proof</span>
                <Link className="mini-action" href={`/runs/${run.runId}`}>Open mission</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </ProductPage>
  );
}
