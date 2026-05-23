'use client';

import { useEffect, useState } from 'react';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const capabilityGroups = [
  {
    title: 'Web and Research',
    description: 'Analyze websites, search external sources, and summarize useful findings.',
    apps: ['Web', 'Search', 'Monitor'],
    status: 'Ready',
    tone: 'online',
  },
  {
    title: 'Publishing and Communication',
    description: 'Prepare X posts, replies, notifications, email, and messages behind policy gates.',
    apps: ['X', 'Email', 'Messages'],
    status: 'Guarded',
    tone: 'manual',
  },
  {
    title: 'Code and Workflows',
    description: 'Inspect GitHub, create issues, track runs, and route engineering work.',
    apps: ['GitHub', 'Tasks', 'Reports'],
    status: 'Connected',
    tone: 'assist',
  },
  {
    title: 'Local Computer',
    description: 'Control Chrome and desktop apps only when the local OneClaw bridge is running.',
    apps: ['Desktop', 'Browser', 'Files'],
    status: 'Local',
    tone: 'manual',
  },
  {
    title: 'Business Systems',
    description: 'Connect APIs, databases, calendars, CRM, payments, and operational systems.',
    apps: ['API', 'Database', 'Calendar', 'CRM'],
    status: 'Planned',
    tone: 'assist',
  },
  {
    title: 'High-Risk Actions',
    description: 'Finance, trading, legal, procurement, web3, and payments always stay approval gated.',
    apps: ['Finance', 'Trading', 'Legal', 'Payments'],
    status: 'Protected',
    tone: 'manual',
  },
];

function providerByKey(providers: any[], checks: any[], key: string) {
  return providers.find((item) => item.key === key) || checks.find((item) => item.key === key) || null;
}

function providerCheck(checks: any[], key: string) {
  return checks.find((item) => item.key === key) || null;
}

function isLocalEndpoint(value?: string) {
  return Boolean(value && /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value));
}

function connectionCard(input: {
  title: string;
  role: string;
  status: string;
  tone: string;
  detail: string;
}) {
  return input;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<any>(null);
  const [checks, setChecks] = useState<any[]>([]);
  const [bridge, setBridge] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [statusData, checkData, bridgeData] = await Promise.all([
      fetch('/api/theone/status').then((res) => res.json()).catch(() => ({ os: null })),
      fetch('/api/theone/providers/check').then((res) => res.json()).catch(() => ({ providers: [] })),
      fetch('/api/theone/oneclaw/bridge').then((res) => res.json()).catch(() => ({ bridge: null })),
    ]);
    setStatus(statusData.os || null);
    setChecks(checkData.providers || []);
    setBridge(bridgeData.bridge || statusData.os?.oneClawBridge || null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const providers = status?.providers || [];
  const connectors = status?.oneClawConnectors || status?.oneClawManifest?.connectors || [];
  const systemConnectors = status?.connectors || [];
  const onlineProviders = checks.filter((item) => item.ok || item.status === 'connected').length;
  const connectedConnectors = connectors.filter((item: any) => item.status === 'connected').length || systemConnectors.filter((item: any) => item.status === 'available').length;
  const oneAi = providerByKey(providers, checks, 'oneai');
  const oneAiCheck = providerCheck(checks, 'oneai');
  const oneClaw = providerByKey(providers, checks, 'oneclaw');
  const oneClawCheck = providerCheck(checks, 'oneclaw');
  const oneAiBotCheck = providerCheck(checks, 'oneai_bot');
  const oneClawBase = oneClaw?.baseUrl || oneClawCheck?.baseUrl || oneClawCheck?.endpoint || '';
  const oneClawLocalTarget = isLocalEndpoint(oneClawBase);
  const desktopReady = Boolean(bridge?.desktopEnabled);
  const connectionCards = [
    connectionCard({
      title: 'TheOne OS',
      role: 'Intent, policy, workflow, proof, memory, and app routing.',
      status: 'ready',
      tone: 'online',
      detail: 'Control plane is running in this web app.',
    }),
    connectionCard({
      title: 'OneAI Intelligence',
      role: 'Planning, reasoning, writing, evaluation, and learning.',
      status: oneAiCheck?.ok || oneAi?.configured ? 'ready' : 'needs setup',
      tone: oneAiCheck?.ok || oneAi?.configured ? 'online' : 'manual',
      detail: oneAi?.baseUrl || oneAiCheck?.endpoint || 'No OneAI endpoint reported.',
    }),
    connectionCard({
      title: 'OneClaw Execution',
      role: 'External workers, browser extraction, GitHub, X, API, files, and approvals.',
      status: oneClawCheck?.ok ? 'ready' : oneClawLocalTarget ? 'local target' : oneClaw?.configured ? 'configured' : 'needs setup',
      tone: oneClawCheck?.ok ? 'online' : oneClawLocalTarget ? 'assist' : 'manual',
      detail: oneClawLocalTarget
        ? 'This page points at a local OneClaw endpoint. Use the local bridge for desktop work, or configure a cloud OneClaw URL for hosted use.'
        : oneClaw?.baseUrl || oneClawCheck?.endpoint || 'No OneClaw endpoint reported.',
    }),
    connectionCard({
      title: 'Local Desktop Bridge',
      role: 'Controls this Mac through approved desktop actions.',
      status: desktopReady ? 'ready' : 'off',
      tone: desktopReady ? 'online' : 'manual',
      detail: desktopReady ? `Desktop bridge is enabled on ${bridge?.platform || 'this computer'}.` : 'Start local OneClaw when desktop control is needed.',
    }),
    connectionCard({
      title: 'OneAI Bot Runtime',
      role: 'Existing Telegram community bot, OneAI chat, community graph, and Bot-side OneClaw bridge.',
      status: oneAiBotCheck?.ok ? 'ready' : oneAiBotCheck?.configured ? 'configured' : 'local repo',
      tone: oneAiBotCheck?.ok ? 'online' : 'assist',
      detail: oneAiBotCheck?.endpoint || oneAiBotCheck?.repoPath || 'WAOC OneAI Bot is registered as a no-code-change bridge.',
    }),
  ];

  return (
    <ProductPage
      eyebrow="Settings"
      title="Systems TheOne can use."
      subtitle="See which intelligence, execution, connector, and local-computer systems are available. High-impact actions still pass through policy and approval."
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Core systems', value: 5 },
            { label: 'Online', value: Math.max(1, onlineProviders), tone: onlineProviders ? 'online' : 'assist' },
            { label: 'Capabilities', value: capabilityGroups.length },
            { label: 'Local desktop', value: desktopReady ? 'ready' : 'off', tone: desktopReady ? 'online' : 'manual' },
          ]}
        />
      )}
      compact
    >
      <section className="settings-health-grid">
        <div className="product-card settings-health-card">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Connection Health</h2>
              <p className="panel-subtitle">The main systems behind TheOne, shown in product language.</p>
            </div>
            <button className="mini-action" type="button" onClick={load} disabled={loading}>Refresh</button>
          </div>
          <div className="settings-system-grid">
            {connectionCards.map((item) => (
              <article key={item.title} className="product-mini-card">
                <div className="panel-head">
                  <h2>{item.title}</h2>
                  <span className={`status-pill status-${item.tone}`}>{item.status}</span>
                </div>
                <p>{item.role}</p>
                <span>{item.detail}</span>
              </article>
            ))}
          </div>
        </div>

        <aside className="product-card settings-local-card">
          <h2 className="panel-title">Local Computer Control</h2>
          <p className="panel-subtitle">Hosted pages cannot directly control your Mac. Desktop actions require a local OneClaw bridge on this computer.</p>
          {!bridge ? (
            <ProductEmpty title="Bridge not detected" detail="Run local OneClaw when desktop control is needed." />
          ) : (
            <div className="product-bridge-state">
              <ProductStatusStrip
                items={[
                  { label: 'Bridge', value: bridge.mode || 'api' },
                  { label: 'Computer', value: bridge.platform || 'unknown' },
                  { label: 'Desktop', value: bridge.desktopEnabled ? 'enabled' : 'off', tone: bridge.desktopEnabled ? 'online' : 'manual' },
                ]}
              />
              <div className="product-list compact">
                {(bridge.diagnostics || []).slice(0, 6).map((item: any) => (
                  <div key={item.key} className="product-memory-item">
                    <strong>{item.label || item.key}</strong>
                    <p>{item.message || friendlyStatus(item.status)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </section>

      <section className="product-card">
        <h2 className="panel-title">What TheOne Can Use</h2>
        <p className="panel-subtitle">A capability view for normal users. The connector details remain available through Workers and Advanced.</p>
        <div className="settings-capability-grid">
          {capabilityGroups.map((group) => (
            <article key={group.title} className="product-mini-card">
              <div className="panel-head">
                <h2>{group.title}</h2>
                <span className={`status-pill status-${group.tone}`}>{group.status}</span>
              </div>
              <p>{group.description}</p>
              <div className="policy-chip-row">
                {group.apps.map((app) => (
                  <span key={app} className="capability-chip">{app}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="product-card settings-connector-detail">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Connector Details</h2>
            <p className="panel-subtitle">Technical connector inventory from OneClaw. Useful for builders, hidden from everyday workflows.</p>
          </div>
          <span className="status-pill status-assist">{connectors.length || systemConnectors.length} reported</span>
        </div>
        <div className="product-grid product-grid-three">
          {(connectors.length ? connectors : systemConnectors).length === 0 ? (
            <ProductEmpty title="No connectors reported" detail="Cloud OneClaw or the local bridge will populate this when reachable." />
          ) : (connectors.length ? connectors : systemConnectors).map((connector: any) => (
            <article key={connector.key} className="product-mini-card">
              <div className="panel-head">
                <h2>{connector.title || connector.key}</h2>
                <span className={`status-pill status-${connector.status}`}>{friendlyStatus(connector.status)}</span>
              </div>
              <p>{connector.note || connector.description || connector.domain}</p>
              <div className="policy-chip-row">
                {(connector.actions || connector.capabilities || []).slice(0, 5).map((action: string) => (
                  <span key={action} className="capability-chip">{action}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </ProductPage>
  );
}
