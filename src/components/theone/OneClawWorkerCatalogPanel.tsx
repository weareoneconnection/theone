'use client';

import { useEffect, useMemo, useState } from 'react';

function statusTone(status: string) {
  if (status === 'live') return 'auto';
  if (status === 'guarded') return 'manual';
  if (status === 'prepared') return 'pending';
  return 'blocked';
}

export function OneClawWorkerCatalogPanel() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const stats = useMemo(() => workers.reduce((summary, worker) => {
    summary.total += 1;
    summary[worker.status] = (summary[worker.status] || 0) + 1;
    if (worker.provider === 'oneclaw') summary.oneclaw += 1;
    return summary;
  }, { total: 0, oneclaw: 0, live: 0, guarded: 0, prepared: 0, missing: 0 } as Record<string, number>), [workers]);

  const domains = useMemo(() => {
    const counts = workers.reduce<Record<string, number>>((summary, worker) => {
      summary[worker.domain] = (summary[worker.domain] || 0) + 1;
      return summary;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [workers]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/workers', { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Worker catalog unavailable.');
      setWorkers(json.workers || []);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Worker catalog unavailable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="panel-card oneclaw-worker-catalog">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">OneClaw Worker Catalog</h2>
          <p className="panel-subtitle">All OneClaw manifest workers are visible inside TheOne before we connect them one by one.</p>
        </div>
        <span className="panel-count">{stats.oneclaw}</span>
      </div>

      <div className="scheduler-actions">
        <button className="mini-action" type="button" disabled={loading} onClick={load}>Refresh</button>
        {message ? <span className="proof-meta">{message}</span> : null}
      </div>

      <div className="policy-kpis">
        <WorkerKpi label="Workers" value={String(stats.total)} />
        <WorkerKpi label="Live" value={String(stats.live || 0)} />
        <WorkerKpi label="Guarded" value={String(stats.guarded || 0)} />
        <WorkerKpi label="Prepared" value={String(stats.prepared || 0)} />
      </div>

      <div className="policy-chip-row">
        {domains.map(([domain, count]) => (
          <span key={domain} className="capability-chip">{domain} · {count}</span>
        ))}
      </div>

      <div className="policy-rule-list worker-catalog-list">
        {workers.map((worker) => (
          <div key={worker.key} className="policy-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{worker.title}</div>
                <div className="proof-meta">
                  {worker.provider} · {worker.domain} · {worker.source || 'manifest'} · {(worker.actions || []).length} action(s)
                </div>
              </div>
              <span className={`status-pill status-${statusTone(worker.status)}`}>{worker.status}</span>
            </div>
            <div className="automation-detail">{worker.policy}</div>
            <div className="ledger-meta-row">
              <span>{worker.connector?.title || worker.connector?.key || 'no connector'}</span>
              <span>{worker.connector?.status || worker.connector?.mode || 'prepared'}</span>
            </div>
            <div className="policy-chip-row">
              {(worker.actions || []).slice(0, 14).map((action: string) => (
                <span key={action} className="capability-chip">{action}</span>
              ))}
              {(worker.actions || []).length > 14 ? (
                <span className="capability-chip">+{worker.actions.length - 14}</span>
              ) : null}
            </div>
            {(worker.approvalActions || []).length ? (
              <div className="policy-reasons">
                <div>approval gated · {(worker.approvalActions || []).slice(0, 8).join(' · ')}</div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkerKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="policy-kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
