'use client';

import { useEffect, useMemo, useState } from 'react';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const domainNames: Record<string, string> = {
  browser: 'Browse websites',
  desktop: 'Control this computer',
  social: 'Publish and reply',
  x: 'Read X',
  git: 'Work with GitHub',
  file: 'Handle files',
  document: 'Create documents',
  spreadsheet: 'Use spreadsheets',
  api: 'Call APIs',
  database: 'Query databases',
  email: 'Prepare email',
  calendar: 'Plan calendar work',
  message: 'Send messages',
  notification: 'Notify people',
  construction: 'Construction workflows',
  web3: 'Read Web3',
  payment: 'Prepare payments',
};

export default function WorkersPage() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [selectedDomain, setSelectedDomain] = useState('all');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [workerData, statusData] = await Promise.all([
      fetch('/api/theone/workers').then((res) => res.json()).catch(() => ({ workers: [] })),
      fetch('/api/theone/status').then((res) => res.json()).catch(() => ({ os: null })),
    ]);
    setWorkers(workerData.workers || []);
    setStatus(statusData.os || null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const domains = useMemo(() => {
    const counts = workers.reduce<Record<string, number>>((summary, worker) => {
      const key = worker.domain || 'general';
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [workers]);

  const filteredWorkers = selectedDomain === 'all'
    ? workers
    : workers.filter((worker) => (worker.domain || 'general') === selectedDomain);

  const liveCount = workers.filter((worker) => worker.status === 'live').length;
  const guardedCount = workers.filter((worker) => worker.status === 'guarded').length;
  const bridgeMode = status?.oneClawBridge?.mode || status?.oneClawManifest?.bridge?.mode || 'api';

  return (
    <ProductPage
      eyebrow="Worker Market"
      title="Everything OneClaw can do, in human language."
      subtitle="TheOne keeps the full worker catalog visible before each capability is connected, tested, and allowed for everyday use."
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Workers', value: workers.length },
            { label: 'Live', value: liveCount, tone: 'online' },
            { label: 'Guarded', value: guardedCount, tone: 'manual' },
            { label: 'Bridge', value: bridgeMode, tone: bridgeMode },
          ]}
        />
      )}
    >
      <section className="product-card">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Capability Groups</h2>
            <p className="panel-subtitle">Choose a group to see the workers TheOne can route work toward.</p>
          </div>
          <button className="mini-action" type="button" onClick={load} disabled={loading}>Refresh</button>
        </div>
        <div className="product-chip-grid">
          <button className={selectedDomain === 'all' ? 'product-filter active' : 'product-filter'} type="button" onClick={() => setSelectedDomain('all')}>
            All · {workers.length}
          </button>
          {domains.map(([domain, count]) => (
            <button
              key={domain}
              className={selectedDomain === domain ? 'product-filter active' : 'product-filter'}
              type="button"
              onClick={() => setSelectedDomain(domain)}
            >
              {(domainNames[domain] || domain)} · {count}
            </button>
          ))}
        </div>
      </section>

      <section className="product-grid product-grid-three">
        {filteredWorkers.length === 0 ? (
          <ProductEmpty title="No workers found" detail="The catalog is still loading or this group has no workers yet." />
        ) : filteredWorkers.map((worker) => (
          <article key={worker.key} className="product-worker-card">
            <div className="panel-head">
              <div>
                <div className="product-card-kicker">{domainNames[worker.domain] || worker.domain || 'General'}</div>
                <h2>{worker.title || worker.key}</h2>
              </div>
              <span className={`status-pill status-${worker.status}`}>{friendlyStatus(worker.status)}</span>
            </div>
            <p>{worker.policy || 'Available through TheOne policy and approval routing.'}</p>
            <div className="product-worker-meta">
              <span>{worker.provider || 'theone'}</span>
              <span>{worker.connector?.title || worker.connector?.key || 'no connector'}</span>
              <span>{(worker.actions || []).length} actions</span>
            </div>
            <div className="policy-chip-row">
              {(worker.actions || []).slice(0, 6).map((action: string) => (
                <span key={action} className="capability-chip">{action}</span>
              ))}
              {(worker.actions || []).length > 6 ? <span className="capability-chip">+{worker.actions.length - 6}</span> : null}
            </div>
          </article>
        ))}
      </section>
    </ProductPage>
  );
}
