'use client';

import { useEffect, useMemo, useState } from 'react';
import { ProductEmpty, friendlyStatus } from './ProductNav';

type MemoryItem = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  content?: {
    facts?: string[];
    nextActions?: string[];
    sourceRunId?: string;
  } | null;
  createdAt?: string;
  runId?: string | null;
};

export function AppMemoryRecall({
  app,
  title = 'App Memory',
  detail = 'Reusable context this App has learned from previous runs.',
}: {
  app: string;
  title?: string;
  detail?: string;
}) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/memory?limit=120', { cache: 'no-store' });
      const json = await res.json();
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const memories = useMemo(() => (
    items
      .filter((item) => item.kind === `app.${app}.memory_pack` || item.content?.sourceRunId && item.content && item.kind.includes(`.${app}.`))
      .slice(0, 4)
  ), [app, items]);

  return (
    <section className="app-memory-panel" aria-label={`${app} memory recall`}>
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{title}</h2>
          <p className="panel-subtitle">{detail}</p>
        </div>
        <button className="mini-action" type="button" onClick={load} disabled={loading}>
          {loading ? 'Loading' : 'Refresh'}
        </button>
      </div>

      {memories.length === 0 ? (
        <ProductEmpty
          title="No app memory yet"
          detail="Run this App once to create a reusable memory pack."
        />
      ) : (
        <div className="app-memory-grid">
          {memories.map((item) => (
            <article key={item.id} className="app-memory-card">
              <div className="app-memory-top">
                <span>{friendlyStatus(item.kind.replace(/^app\./, '').replace(/\.memory_pack$/, ''))}</span>
                <small>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'memory'}</small>
              </div>
              <h3>{item.title || 'Stored memory'}</h3>
              <p>{item.summary || 'TheOne stored reusable context from this App.'}</p>
              {item.content?.facts?.length ? (
                <div className="app-memory-list">
                  {item.content.facts.slice(0, 3).map((fact) => <span key={fact}>{fact}</span>)}
                </div>
              ) : null}
              {item.content?.nextActions?.length ? (
                <div className="app-memory-actions">
                  {item.content.nextActions.slice(0, 2).map((action) => <strong key={action}>{action}</strong>)}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
