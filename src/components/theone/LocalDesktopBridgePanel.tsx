'use client';

import { useEffect, useMemo, useState } from 'react';

function toneFor(status: string) {
  if (status === 'pass' || status === 'online' || status === 'desktop') return 'auto';
  if (status === 'warn' || status === 'api') return 'pending';
  return 'blocked';
}

function bridgeFrom(result: any, liveBridge: any) {
  return liveBridge?.bridge || result?.os?.oneClawBridge || result?.os?.oneClawManifest?.bridge || null;
}

export function LocalDesktopBridgePanel({ result }: { result: any }) {
  const [liveBridge, setLiveBridge] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const bridgeStatus = bridgeFrom(result, liveBridge);
  const bridge = bridgeStatus?.bridge || bridgeStatus || null;
  const diagnostics = bridgeStatus?.diagnostics || [];

  const summary = useMemo(() => {
    const pass = diagnostics.filter((item: any) => item.status === 'pass').length;
    const warn = diagnostics.filter((item: any) => item.status === 'warn').length;
    const fail = diagnostics.filter((item: any) => item.status === 'fail').length;
    return { pass, warn, fail };
  }, [diagnostics]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/oneclaw/bridge', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Bridge status unavailable.');
      setLiveBridge(json.bridge || null);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Bridge status unavailable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="panel-card local-bridge-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Local Desktop Bridge</h2>
          <p className="panel-subtitle">OneClaw local execution endpoint for Mac screen, app state, keyboard, mouse, and proof artifacts.</p>
        </div>
        <span className={`status-pill status-${toneFor(bridge?.mode || 'missing')}`}>
          {bridge?.role === 'local_desktop_bridge' ? 'LOCAL' : bridge?.mode || 'MISSING'}
        </span>
      </div>

      <div className="scheduler-actions">
        <button className="mini-action" type="button" disabled={loading} onClick={refresh}>Refresh</button>
        {message ? <span className="proof-meta">{message}</span> : null}
      </div>

      <div className="policy-kpis">
        <BridgeKpi label="Mode" value={bridge?.mode || '-'} />
        <BridgeKpi label="Platform" value={bridge?.platform || '-'} />
        <BridgeKpi label="Actions" value={String((bridge?.actions || []).length)} />
        <BridgeKpi label="Checks" value={`${summary.pass}/${diagnostics.length || 0}`} />
      </div>

      <div className="policy-row">
        <div className="policy-row-head">
          <div>
            <div className="feed-title">{bridge?.name || 'OneClaw Local Desktop Bridge'}</div>
            <div className="proof-meta">
              {bridge?.id || 'no bridge id'} · {bridge?.hostname || 'host unknown'} · {bridge?.online ? 'online' : 'offline'}
            </div>
          </div>
          <span className={`status-pill status-${bridge?.online ? 'auto' : 'blocked'}`}>{bridge?.online ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <div className="automation-detail">
          {bridge?.routing?.note || 'Local bridge reports desktop execution status and routing readiness.'}
        </div>
      </div>

      <div className="policy-chip-row">
        {(bridge?.actions || []).map((action: string) => (
          <span key={action} className="capability-chip">{action}</span>
        ))}
      </div>

      <div className="policy-rule-list">
        {diagnostics.length ? diagnostics.map((item: any) => (
          <div key={item.key} className="policy-row compact-policy-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{item.label}</div>
                <div className="proof-meta">{item.detail}</div>
              </div>
              <span className={`status-pill status-${toneFor(item.status)}`}>{item.status}</span>
            </div>
          </div>
        )) : (
          <div className="empty-state">
            <div className="feed-title">No bridge diagnostics captured yet.</div>
            <div className="proof-meta">Run a local OneClaw bridge and refresh this panel.</div>
          </div>
        )}
      </div>

      <div className="policy-reasons">
        <div>allowlist · {(bridge?.appAllowlist || []).join(' · ') || 'not configured'}</div>
        <div>blocklist · {(bridge?.appBlocklist || []).join(' · ') || 'none'}</div>
      </div>
    </section>
  );
}

function BridgeKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="policy-kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
