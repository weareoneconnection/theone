'use client';

import { useEffect, useState } from 'react';
import { ProductEmpty, ProductPage, ProductStatusStrip } from '@/components/theone/ProductNav';

export default function ProofPage() {
  const [proof, setProof] = useState<any[]>([]);
  const [memory, setMemory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [proofData, memoryData] = await Promise.all([
      fetch('/api/theone/proof?limit=40').then((res) => res.json()).catch(() => ({ items: [] })),
      fetch('/api/theone/memory?limit=20').then((res) => res.json()).catch(() => ({ items: [] })),
    ]);
    setProof(proofData.items || []);
    setMemory(memoryData.items || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const social = proof.filter((item) => item.type === 'social').length;
  const execution = proof.filter((item) => item.type === 'execution').length;

  return (
    <ProductPage
      eyebrow="Proof Center"
      title="Receipts, evidence, and memory."
      subtitle="TheOne records what happened so future work can be trusted, resumed, and improved."
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Proof', value: proof.length },
            { label: 'Execution', value: execution },
            { label: 'Social', value: social },
            { label: 'Memory', value: memory.length },
          ]}
        />
      )}
    >
      <section className="product-workspace product-workspace-wide">
        <div className="product-card">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Proof Ledger</h2>
              <p className="panel-subtitle">Readable receipts from TheOne and OneClaw.</p>
            </div>
            <button className="mini-action" type="button" onClick={load} disabled={loading}>Refresh</button>
          </div>
          <div className="product-list compact">
            {proof.length === 0 ? (
              <ProductEmpty title="No proof yet" detail="Proof will appear after TheOne runs or OneClaw tasks complete." />
            ) : proof.map((item) => (
              <article key={item.id} className="product-list-item">
                <div>
                  <div className="product-card-kicker">{item.type || 'proof'}</div>
                  <h2>{item.title || 'Recorded proof'}</h2>
                  <p>{item.value || item.summary || 'Recorded by TheOne.'}</p>
                </div>
                <div className="product-list-side">
                  <span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
        <aside className="product-card">
          <h2 className="panel-title">Memory</h2>
          <p className="panel-subtitle">Context TheOne can recall later.</p>
          <div className="product-list compact">
            {memory.length === 0 ? (
              <ProductEmpty title="No memory yet" detail="Useful run summaries will be stored here." />
            ) : memory.map((item) => (
              <article key={item.id} className="product-memory-item">
                <strong>{item.kind || 'memory'}</strong>
                <p>{item.summary || item.value || 'Stored context.'}</p>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </ProductPage>
  );
}
