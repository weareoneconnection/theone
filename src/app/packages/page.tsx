'use client';

import { useEffect, useMemo, useState } from 'react';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const kindLabels: Record<string, string> = {
  app: 'Apps',
  worker: 'Workers',
  connector: 'Connectors',
  policy_pack: 'Policy Packs',
  agent_runtime: 'Agent Runtimes',
  memory_pack: 'Memory Packs',
  ui_schema: 'UI Schemas',
};

function toneForPackage(item: any) {
  if (item.enabled && item.status === 'installed') return 'online';
  if (item.status === 'disabled') return 'blocked';
  return 'assist';
}

export default function PackagesPage() {
  const [registry, setRegistry] = useState<any>(null);
  const [learning, setLearning] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [packageData, learningData] = await Promise.all([
        fetch('/api/theone/packages', { cache: 'no-store' }).then((res) => res.json()),
        fetch('/api/theone/learning?limit=12', { cache: 'no-store' }).then((res) => res.json()).catch(() => ({ insights: [] })),
      ]);
      if (!packageData.ok) throw new Error(packageData.error || 'Package runtime unavailable.');
      setRegistry(packageData.registry);
      setLearning(learningData.insights || []);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Package runtime unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function togglePackage(id: string, enabled: boolean) {
    setLoading(true);
    try {
      const data = await fetch('/api/theone/packages/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      }).then((res) => res.json());
      if (!data.ok) throw new Error(data.error || 'Package update failed.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Package update failed.');
      setLoading(false);
    }
  }

  async function runLearning() {
    setLoading(true);
    try {
      const data = await fetch('/api/theone/learning', { method: 'POST' }).then((res) => res.json());
      if (!data.ok) throw new Error(data.error || 'Learning cycle failed.');
      await load();
      setMessage(`Learning cycle generated ${data.generated || 0} insight(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Learning cycle failed.');
      setLoading(false);
    }
  }

  async function updateInsight(id: string, status: 'applied' | 'dismissed') {
    setLoading(true);
    try {
      const data = await fetch('/api/theone/learning/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      }).then((res) => res.json());
      if (!data.ok) throw new Error(data.error || 'Learning update failed.');
      setLearning(data.insights || []);
      setMessage(status === 'applied' ? 'Insight marked applied.' : 'Insight dismissed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Learning update failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const packages = registry?.packages || [];
  const runtime = registry?.runtime || {};
  const grouped = useMemo(() => packages.reduce((summary: Record<string, any[]>, item: any) => {
    summary[item.kind] = summary[item.kind] || [];
    summary[item.kind].push(item);
    return summary;
  }, {}), [packages]);
  const suggestedLearning = learning.filter((item) => item.status === 'suggested');

  return (
    <ProductPage
      eyebrow="Package Runtime"
      title="Installable OS pieces."
      subtitle="TheOne can compose Apps, Workers, Connectors, Policy Packs, Memory Packs, UI Schemas, and Agent Runtimes without hardcoding every future capability."
      compact
      aside={<ProductStatusStrip items={[
        { label: 'Packages', value: registry?.total || 0 },
        { label: 'Installed', value: registry?.installed || 0, tone: 'online' },
        { label: 'Healthy', value: runtime.healthy || 0, tone: 'assist' },
        { label: 'Level', value: runtime.level || 'L28', tone: 'assist' },
      ]} />}
    >
      <section className="mission-control-grid">
        <article className="product-card">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Runtime Contract</h2>
              <p className="panel-subtitle">Every package declares permissions, sandbox, version lock, dependencies, composition, and rollback behavior.</p>
            </div>
            <button className="mini-action" type="button" onClick={load} disabled={loading}>Refresh</button>
          </div>
          <div className="run-result-stats">
            <div><span>Sandboxed</span><strong>{runtime.sandboxed || 0}</strong></div>
            <div><span>Approval gated</span><strong>{runtime.approvalGated || 0}</strong></div>
            <div><span>Version locked</span><strong>{runtime.versionLocked || 0}</strong></div>
          </div>
          <div className="policy-chip-row">
            {(runtime.composableKinds || []).map((kind: string) => <span key={kind} className="capability-chip">{kindLabels[kind] || kind}</span>)}
          </div>
        </article>

        <aside className="product-card">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Self-Evolution Queue</h2>
              <p className="panel-subtitle">TheOne learns from failures, approvals, events, packages, and memory.</p>
            </div>
            <button className="mini-action primary" type="button" onClick={runLearning} disabled={loading}>Run learning</button>
          </div>
          <div className="product-list compact">
            {suggestedLearning.length === 0 ? (
              <ProductEmpty title="No suggested changes" detail="Run learning after more missions to generate improvement proposals." />
            ) : suggestedLearning.slice(0, 4).map((item) => (
              <div key={item.id} className="product-memory-item">
                <strong>{item.title}</strong>
                <p>{item.recommendation}</p>
                <div className="approval-actions">
                  <button className="mini-action primary" type="button" disabled={loading} onClick={() => updateInsight(item.id, 'applied')}>Mark applied</button>
                  <button className="mini-action" type="button" disabled={loading} onClick={() => updateInsight(item.id, 'dismissed')}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      {message ? <section className="product-card"><p className="panel-subtitle">{message}</p></section> : null}

      {Object.keys(grouped).length === 0 ? (
        <section className="product-card">
          <ProductEmpty title={loading ? 'Loading packages' : 'No packages found'} detail={message || 'The package registry will appear here when the runtime is reachable.'} />
        </section>
      ) : (Object.entries(grouped) as Array<[string, any[]]>).map(([kind, items]) => (
        <section key={kind} className="product-card">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">{kindLabels[kind] || kind}</h2>
              <p className="panel-subtitle">Install, disable, and inspect the OS contract for this package group.</p>
            </div>
            <span className="status-pill status-assist">{items.length}</span>
          </div>
          <div className="product-grid product-grid-three">
            {items.map((item: any) => {
              const os = item.manifest?.os || {};
              return (
                <article key={item.id} className="product-mini-card">
                  <div className="panel-head">
                    <h2>{item.title}</h2>
                    <span className={`status-pill status-${toneForPackage(item)}`}>{friendlyStatus(item.status)}</span>
                  </div>
                  <p>{item.manifest?.summary || item.manifest?.description || item.source}</p>
                  <div className="policy-chip-row">
                    {(os.permissionScopes || []).slice(0, 5).map((scope: string) => <span key={scope} className="capability-chip">{scope}</span>)}
                  </div>
                  <div className="workspace-run-list">
                    <div className="workspace-run-row">
                      <span>Sandbox</span>
                      <p>{os.sandboxProfile?.isolation || 'standard'}</p>
                      <small>v{item.version}</small>
                    </div>
                    <div className="workspace-run-row">
                      <span>Rollback</span>
                      <p>{os.installContract?.rollbackPlan || 'disable package'}</p>
                      <small>{os.versionLock ? 'locked' : 'unlocked'}</small>
                    </div>
                  </div>
                  <button
                    className={item.enabled ? 'mini-action' : 'mini-action primary'}
                    type="button"
                    disabled={loading}
                    onClick={() => togglePackage(item.id, !item.enabled)}
                  >
                    {item.enabled ? 'Disable' : 'Install'}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </ProductPage>
  );
}
