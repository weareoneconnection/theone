'use client';

import { useEffect, useState } from 'react';

const layerRoutes = [
  ['L27', 'Runtime Recovery', '/api/theone/final-state/runtime'],
  ['L28', 'Identity Boundary', '/api/theone/final-state/identity'],
  ['L29', 'Package Marketplace', '/api/theone/final-state/marketplace'],
  ['L31', 'Bridge Mesh', '/api/theone/final-state/bridge-mesh'],
  ['L32', 'Memory Graph', '/api/theone/final-state/memory-graph'],
  ['L33', 'Self Evolution', '/api/theone/final-state/self-evolution'],
];

function tone(value?: string) {
  if (value === 'ready') return 'auto';
  if (value === 'guarded' || value === 'partial') return 'manual';
  return 'pending';
}

export function FinalStatePanel() {
  const [blueprint, setBlueprint] = useState<any>(null);
  const [actionCenters, setActionCenters] = useState<any[]>([]);
  const [simulation, setSimulation] = useState<any>(null);
  const [objective, setObjective] = useState('Analyze a website and create a useful report with proof');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/final-state', { cache: 'no-store' });
      const [json, centers] = await Promise.all([
        res.json(),
        fetch('/api/theone/action-centers', { cache: 'no-store' }).then((item) => item.json()).catch(() => ({ centers: [] })),
      ]);
      if (!json.ok) throw new Error(json.error || 'Final-state readiness unavailable.');
      setBlueprint(json);
      setActionCenters(centers.centers || []);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Final-state readiness unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function runSimulation() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/final-state/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective, mode: 'assist' }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Simulation failed.');
      setSimulation(json);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Simulation failed.');
    } finally {
      setLoading(false);
    }
  }

  async function resetCircuits() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/final-state/runtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_circuits' }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Circuit reset failed.');
      setMessage('Runtime circuits reset.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Circuit reset failed.');
    } finally {
      setLoading(false);
    }
  }

  async function runLearningCycle() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/final-state/self-evolution', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Learning cycle failed.');
      setMessage(`Learning cycle generated ${json.result?.generated ?? 0} insight(s).`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Learning cycle failed.');
    } finally {
      setLoading(false);
    }
  }

  async function runCenterAction(action: string) {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/action-centers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, objective, query: objective }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Action failed.');
      if (json.simulation) setSimulation(json);
      setMessage(`${action.replaceAll('_', ' ')} completed.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const readiness = blueprint?.readiness?.readiness || {};
  const layers = blueprint?.layers || [];

  return (
    <section className="panel-card final-state-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Final-State OS Runtime</h2>
          <p className="panel-subtitle">L27-L34 is now queryable: recovery, identity, marketplace, simulation, bridge mesh, memory graph, and self-evolution.</p>
        </div>
        <span className="panel-count">L34</span>
      </div>

      <div className="scheduler-actions">
        <button className="mini-action" type="button" disabled={loading} onClick={load}>Refresh</button>
        <button className="mini-action" type="button" disabled={loading} onClick={resetCircuits}>Reset circuits</button>
        <button className="mini-action" type="button" disabled={loading} onClick={runLearningCycle}>Run learning cycle</button>
        {message ? <span className="proof-meta">{message}</span> : null}
      </div>

      <div className="current-policy-card">
        <div className="policy-row-head">
          <div>
            <div className="feed-title">{blueprint?.summary || 'Universal AI OS readiness is loading.'}</div>
            <div className="proof-meta">Foundation {blueprint?.readiness?.foundation || blueprint?.foundationLevel || 'L26'} · Target {blueprint?.currentLevel || 'L34'}</div>
          </div>
          <div className="automation-score">
            <span>{Object.keys(readiness).length || '-'}</span>
            <small>layers live</small>
          </div>
        </div>
      </div>

      <div className="policy-kpis">
        {Object.entries(readiness).map(([key, value]) => (
          <div key={key} className="policy-kpi">
            <div className="kpi-label">{key}</div>
            <div className={`kpi-value tone-${tone(String(value))}`}>{String(value)}</div>
          </div>
        ))}
      </div>

      <div className="route-summary-grid">
        <div className="route-box">
          <div className="mini-heading">L30 Simulation Gate</div>
          <textarea
            className="mini-textarea"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            rows={3}
          />
          <div className="approval-actions">
            <button className="mini-action primary" type="button" disabled={loading} onClick={runSimulation}>Run simulation</button>
            {simulation?.simulation ? <span className="proof-meta">score {simulation.simulation.score} · {simulation.simulation.verdict}</span> : null}
          </div>
        </div>
        <div className="route-box">
          <div className="mini-heading">Callable OS Surfaces</div>
          <div className="policy-chip-row">
            {layerRoutes.map(([level, label, href]) => (
              <a key={href} className="capability-chip" href={href} target="_blank" rel="noreferrer">{level} · {label}</a>
            ))}
          </div>
        </div>
      </div>

      <div className="policy-rule-list maturity-list">
        {actionCenters.map((center: any) => (
          <div key={center.level} className="policy-row maturity-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{center.level} · {center.title}</div>
                <div className="proof-meta">{center.purpose}</div>
              </div>
              <span className={`status-pill status-${tone(center.status)}`}>{center.status}</span>
            </div>
            <div className="policy-kpis">
              {Object.entries(center.metrics || {}).slice(0, 4).map(([key, value]) => (
                <div key={key} className="policy-kpi">
                  <div className="kpi-label">{key}</div>
                  <div className="kpi-value">{String(value)}</div>
                </div>
              ))}
            </div>
            <div className="approval-actions">
              {(center.actions || []).map((action: any) => (
                <button
                  key={action.key}
                  className={action.risk === 'low' ? 'mini-action' : 'mini-action primary'}
                  type="button"
                  disabled={loading || !action.available}
                  onClick={() => runCenterAction(action.key)}
                  title={action.description}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div className="policy-reasons">
              <div><strong>Next</strong> · {(center.nextActions || []).join(' · ')}</div>
            </div>
          </div>
        ))}
      </div>

      {simulation?.simulation ? (
        <div className="policy-rule-list">
          {simulation.simulation.agents.map((agent: any) => (
            <div key={agent.role} className="policy-row">
              <div className="policy-row-head">
                <div>
                  <div className="feed-title">{agent.role}</div>
                  <div className="proof-meta">simulation agent verdict</div>
                </div>
                <span className={`status-pill status-${agent.verdict === 'pass' ? 'auto' : agent.verdict === 'block' ? 'blocked' : 'manual'}`}>{agent.verdict}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="policy-rule-list maturity-list">
        {layers.map((layer: any) => (
          <div key={layer.level} className="policy-row maturity-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{layer.level} · {layer.title}</div>
                <div className="proof-meta">{layer.role}</div>
              </div>
              <span className={`status-pill status-${tone(layer.status)}`}>{layer.status}</span>
            </div>
            <div className="automation-detail">{layer.productPromise}</div>
            <div className="policy-chip-row">
              {(layer.runtimeContract || []).map((contract: string) => (
                <span key={contract} className="capability-chip">{contract}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
