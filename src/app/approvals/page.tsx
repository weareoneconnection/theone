'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

function approvalTone(status: string, risk: string) {
  if (status === 'pending') return risk === 'high' ? 'manual' : 'assist';
  if (status === 'approved') return 'online';
  if (status === 'rejected') return 'blocked';
  return status;
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await fetch('/api/theone/approvals?limit=80', { cache: 'no-store' }).then((res) => res.json());
      if (!data.ok) throw new Error(data.error || 'Approval inbox unavailable.');
      setItems(data.items || []);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Approval inbox unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function decide(decision: 'approve' | 'reject', item: any) {
    setLoading(true);
    try {
      const data = await fetch(`/api/theone/approvals/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: item.runId, approvalId: item.id }),
      }).then((res) => res.json());
      if (data.ok === false) throw new Error(data.error || 'Approval decision failed.');
      await load();
      setMessage(decision === 'approve' ? 'Approved and mission refreshed.' : 'Rejected. The external action will not run.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Approval decision failed.');
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const pending = items.filter((item) => item.status === 'pending');
  const highRisk = pending.filter((item) => item.risk === 'high').length;
  const grouped = useMemo(() => ({
    pending,
    recent: items.filter((item) => item.status !== 'pending'),
  }), [items]);

  return (
    <ProductPage
      eyebrow="Approval Inbox"
      title="Decide what TheOne may do."
      subtitle="One place for public posts, GitHub writes, desktop control, file writes, payments, and any worker action that needs human judgment."
      compact
      aside={<ProductStatusStrip items={[
        { label: 'Pending', value: pending.length, tone: pending.length ? 'manual' : 'online' },
        { label: 'High risk', value: highRisk, tone: highRisk ? 'manual' : 'online' },
        { label: 'Total', value: items.length },
      ]} />}
    >
      <section className="product-card">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Waiting For You</h2>
            <p className="panel-subtitle">Approve only when the task, target, and risk make sense.</p>
          </div>
          <button className="mini-action" type="button" onClick={load} disabled={loading}>Refresh</button>
        </div>
        <div className="product-list">
          {grouped.pending.length === 0 ? (
            <ProductEmpty title="Nothing waiting" detail="Approval-gated work will appear here when TheOne prepares an external action." />
          ) : grouped.pending.map((item) => (
            <article key={item.id} className="product-list-item">
              <div>
                <div className="product-card-kicker">{item.risk} risk · {item.mode}</div>
                <h2>{item.action}</h2>
                <p>{item.reason}</p>
                <p>{item.run?.objective}</p>
              </div>
              <div className="product-list-side">
                <span className={`status-pill status-${approvalTone(item.status, item.risk)}`}>{friendlyStatus(item.status)}</span>
                <button className="mini-action primary" type="button" disabled={loading} onClick={() => decide('approve', item)}>Approve</button>
                <button className="mini-action" type="button" disabled={loading} onClick={() => decide('reject', item)}>Reject</button>
                <Link className="mini-action" href={`/runs/${item.runId}`}>Mission</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="product-card">
        <h2 className="panel-title">Recent Decisions</h2>
        <div className="product-list">
          {grouped.recent.length === 0 ? (
            <ProductEmpty title="No decisions yet" detail="Approved and rejected gates will be kept here as proof context." />
          ) : grouped.recent.slice(0, 24).map((item) => (
            <article key={item.id} className="product-list-item">
              <div>
                <div className="product-card-kicker">{item.action}</div>
                <h2>{item.run?.objective || item.id}</h2>
                <p>{item.reason}</p>
              </div>
              <div className="product-list-side">
                <span className={`status-pill status-${approvalTone(item.status, item.risk)}`}>{friendlyStatus(item.status)}</span>
                <Link className="mini-action" href={`/runs/${item.runId}`}>Open</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {message ? <section className="product-card"><p className="panel-subtitle">{message}</p></section> : null}
    </ProductPage>
  );
}
