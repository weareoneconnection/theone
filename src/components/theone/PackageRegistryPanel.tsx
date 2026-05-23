'use client';

import { useEffect, useMemo, useState } from 'react';

export function PackageRegistryPanel() {
  const [registry, setRegistry] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const packages = registry?.packages || [];
  const byKind = useMemo(() => registry?.byKind || {}, [registry]);
  const sandboxed = packages.filter((item: any) => item.manifest?.os?.sandboxProfile).length;
  const approvalGated = packages.filter((item: any) => item.manifest?.os?.sandboxProfile?.isolation === 'approval_gated').length;

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/packages', { cache: 'no-store' });
      const json = await res.json();
      setRegistry(json.registry || null);
      setMessage(json.ok ? '' : json.error || 'Package registry unavailable.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Package registry unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function toggle(item: any) {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/packages/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Package update failed.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Package update failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="panel-card package-registry-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">OS Package Registry</h2>
          <p className="panel-subtitle">Installable apps, workers, connectors, runtimes, and policy packs with versions, permission scopes, and sandbox boundaries.</p>
        </div>
        <span className="panel-count">L21</span>
      </div>

      <div className="scheduler-actions">
        <button className="mini-action" type="button" disabled={loading} onClick={load}>Refresh</button>
        {message ? <span className="proof-meta">{message}</span> : null}
      </div>

      <div className="policy-kpis">
        <PackageKpi label="Total" value={String(registry?.total ?? 0)} />
        <PackageKpi label="Installed" value={String(registry?.installed ?? 0)} />
        <PackageKpi label="Enabled" value={String(registry?.enabled ?? 0)} />
        <PackageKpi label="Kinds" value={String(Object.keys(byKind).length)} />
        <PackageKpi label="Sandboxed" value={String(sandboxed)} />
        <PackageKpi label="Gated" value={String(approvalGated)} />
      </div>

      <div className="policy-chip-row">
        {Object.entries(byKind).map(([kind, count]) => (
          <span key={kind} className="capability-chip">{kind} · {String(count)}</span>
        ))}
      </div>

      <div className="policy-rule-list package-list">
        {packages.map((item: any) => (
          <div key={item.id} className="policy-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{item.title}</div>
                <div className="proof-meta">{item.kind} · v{item.version} · {item.source}</div>
              </div>
              <span className={`status-pill status-${item.enabled ? 'auto' : item.status === 'installed' ? 'manual' : 'idle'}`}>
                {item.enabled ? 'enabled' : item.status}
              </span>
            </div>
            <div className="ledger-meta-row">
              <span>{item.id}</span>
              <span>{(item.dependencies || []).slice(0, 2).join(' · ') || 'no dependencies'}</span>
            </div>
            <SandboxSummary manifest={item.manifest} />
            <div className="approval-actions">
              <button className="mini-action" type="button" disabled={loading} onClick={() => toggle(item)}>
                {item.enabled ? 'Disable' : 'Install / Enable'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SandboxSummary({ manifest }: { manifest: any }) {
  const os = manifest?.os || {};
  const sandbox = os.sandboxProfile || {};
  const scopes = Array.isArray(os.permissionScopes) ? os.permissionScopes : [];
  const compatibility = os.compatibility || {};

  if (!sandbox.id && scopes.length === 0) return null;

  return (
    <div className="package-sandbox-summary">
      <div className="ledger-meta-row">
        <span>Sandbox · {sandbox.isolation || 'standard'} · egress {sandbox.egress || 'none'}</span>
        <span>OS {os.level || 'L21'} · OneClaw {compatibility.oneclaw || 'optional'}</span>
      </div>
      <div className="policy-chip-row">
        {(scopes.length ? scopes : ['read_context']).slice(0, 6).map((scope: string) => (
          <span key={scope} className="capability-chip">{scope}</span>
        ))}
        {sandbox.filesystem ? <span className="capability-chip">fs · {sandbox.filesystem}</span> : null}
        {sandbox.credentials ? <span className="capability-chip">secrets · {sandbox.credentials}</span> : null}
      </div>
    </div>
  );
}

function PackageKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="policy-kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
