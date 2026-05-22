'use client';

import { useEffect, useState } from 'react';

function statusTone(status: string) {
  if (status === 'live') return 'auto';
  if (status === 'guarded') return 'manual';
  if (status === 'partial') return 'pending';
  return 'blocked';
}

export function ProductionMaturityPanel() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/production', { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Production maturity unavailable.');
      setReport(json);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Production maturity unavailable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const capabilities = report?.capabilities || [];
  const evidence = report?.evidence;

  return (
    <section className="panel-card production-maturity-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Production Maturity</h2>
          <p className="panel-subtitle">Queue, sandbox, policy packs, learning loop, eval rollback, package isolation, trace, and tenant boundary.</p>
        </div>
        <span className="panel-count">{report?.level || 'L17'}</span>
      </div>

      <div className="scheduler-actions">
        <button className="mini-action" type="button" disabled={loading} onClick={load}>Refresh</button>
        {message ? <span className="proof-meta">{message}</span> : null}
      </div>

      <div className="current-policy-card">
        <div className="policy-row-head">
          <div>
            <div className="feed-title">{report?.label || 'Production Maturity Layer'}</div>
            <div className="proof-meta">{report?.summary || 'Loading production maturity report.'}</div>
          </div>
          <div className="automation-score">
            <span>{report?.score ?? '-'}</span>
            <small>{report?.readiness || 'readiness'}</small>
          </div>
        </div>
      </div>

      {evidence ? (
        <div className="policy-kpis">
          <MaturityKpi label="Workers" value={`${evidence.workers.live}/${evidence.workers.total}`} />
          <MaturityKpi label="Automation" value={`${evidence.automation.active}/${evidence.automation.total}`} />
          <MaturityKpi label="Packages" value={`${evidence.packages.enabled}/${evidence.packages.total}`} />
          <MaturityKpi label="Learning" value={`${evidence.learning.applied}/${evidence.learning.total}`} />
        </div>
      ) : null}

      <div className="policy-rule-list maturity-list">
        {capabilities.map((item: any) => (
          <div key={item.key} className="policy-row maturity-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{item.title}</div>
                <div className="proof-meta">{item.level} · score {item.score}</div>
              </div>
              <span className={`status-pill status-${statusTone(item.status)}`}>{item.status}</span>
            </div>
            <div className="automation-detail">{item.current}</div>
            <div className="policy-reasons">
              <div><strong>Target</strong> · {item.target}</div>
              <div><strong>Gaps</strong> · {(item.gaps || []).join(' · ')}</div>
              <div><strong>Next</strong> · {(item.nextActions || []).join(' · ')}</div>
            </div>
            <div className="policy-chip-row">
              {(item.controls || []).map((control: string) => (
                <span key={control} className="capability-chip">{control}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MaturityKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="policy-kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
