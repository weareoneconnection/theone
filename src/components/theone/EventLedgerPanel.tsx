'use client';

import { useEffect, useState } from 'react';

export function EventLedgerPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadEvents() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/events?limit=20', { cache: 'no-store' });
      const json = await res.json();
      setItems(json?.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
  }, []);

  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Event Ledger</h2>
          <p className="panel-subtitle">Event-sourced trace for runs, approvals, submissions, sync, proof, and memory.</p>
        </div>
        <button className="mini-action" type="button" disabled={loading} onClick={loadEvents}>Refresh</button>
      </div>
      <div className="approval-list">
        {items.length === 0 ? (
          <div className="approval-item">
            <div className="feed-title">No events recorded yet.</div>
            <div className="proof-meta">Run TheOne or sync an execution to populate the event ledger.</div>
          </div>
        ) : items.map((event) => (
          <div key={event.id} className="approval-item">
            <div className="feed-head">
              <div className="feed-title">{event.type}</div>
              <span className={`status-pill status-${event.status}`}>{event.status}</span>
            </div>
            <div className="proof-meta">{event.provider} · {event.summary}</div>
            <div className="ledger-meta-row">
              <span>{event.runId || 'system'}</span>
              <span>{event.createdAt ? new Date(event.createdAt).toLocaleString() : '-'}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
