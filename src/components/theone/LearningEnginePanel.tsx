'use client';

import { useEffect, useState } from 'react';

function tone(status: string) {
  if (status === 'applied') return 'auto';
  if (status === 'dismissed') return 'blocked';
  return 'manual';
}

export function LearningEnginePanel() {
  const [insights, setInsights] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/learning?limit=20', { cache: 'no-store' });
      const json = await res.json();
      setInsights(json.insights || []);
      setMessage(json.ok ? '' : json.error || 'Learning engine unavailable.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Learning engine unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function runCycle() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/learning', { method: 'POST' });
      const json = await res.json();
      setMessage(json.ok ? `Generated ${json.generated || 0} learning insight(s).` : json.error || 'Learning cycle failed.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Learning cycle failed.');
    } finally {
      setLoading(false);
    }
  }

  async function updateInsight(id: string, status: 'applied' | 'dismissed') {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/learning/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Learning insight update failed.');
      setInsights(json.insights || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Learning insight update failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="panel-card learning-engine-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Learning Engine</h2>
          <p className="panel-subtitle">TheOne turns run history, event failures, approvals, and package state into improvement insights.</p>
        </div>
        <span className="panel-count">L16</span>
      </div>

      <div className="scheduler-actions">
        <button className="mini-action" type="button" disabled={loading} onClick={load}>Refresh</button>
        <button className="mini-action" type="button" disabled={loading} onClick={runCycle}>Run Learning</button>
        {message ? <span className="proof-meta">{message}</span> : null}
      </div>

      <div className="policy-kpis">
        <LearningKpi label="Insights" value={String(insights.length)} />
        <LearningKpi label="Suggested" value={String(insights.filter((item) => item.status === 'suggested').length)} />
        <LearningKpi label="Applied" value={String(insights.filter((item) => item.status === 'applied').length)} />
        <LearningKpi label="Dismissed" value={String(insights.filter((item) => item.status === 'dismissed').length)} />
      </div>

      <div className="policy-rule-list learning-list">
        {insights.length === 0 ? (
          <div className="policy-row">
            <div className="feed-title">No learning insights yet.</div>
            <div className="proof-meta">Run Learning after a few runs/events to generate improvement suggestions.</div>
          </div>
        ) : insights.map((item) => (
          <div key={item.id} className="policy-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{item.title}</div>
                <div className="proof-meta">{item.category} · {item.targetType} · {item.targetId || 'system'}</div>
              </div>
              <span className={`status-pill status-${tone(item.status)}`}>{item.status}</span>
            </div>
            <div className="automation-detail">{item.summary}</div>
            <div className="policy-reasons">
              <div>{item.recommendation}</div>
            </div>
            <div className="ledger-meta-row">
              <span>confidence {Math.round((item.confidence || 0) * 100)}%</span>
              <span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</span>
            </div>
            {item.status === 'suggested' ? (
              <div className="approval-actions">
                <button className="mini-action" type="button" disabled={loading} onClick={() => updateInsight(item.id, 'applied')}>Apply</button>
                <button className="mini-action" type="button" disabled={loading} onClick={() => updateInsight(item.id, 'dismissed')}>Dismiss</button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function LearningKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="policy-kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
