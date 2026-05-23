'use client';

import { useState } from 'react';
import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

export default function ApiAppPage() {
  const [url, setUrl] = useState('https://oneclaw-production.up.railway.app/health');
  const [method, setMethod] = useState('GET');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const status = loading ? 'running' : result?.appResult?.status || result?.os?.workflow?.status || (result ? 'completed' : 'ready');

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/apps/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method, body, mode: 'assist' }),
      });
      setResult(await res.json());
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'API workflow could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="API App"
      title="API operations workspace"
      subtitle="Call APIs through OneClaw with method-aware approval, proof, and reusable memory."
      compact
      aside={<ProductStatusStrip items={[{ label: 'State', value: friendlyStatus(status), tone: status }, { label: 'GET', value: 'auto', tone: 'online' }, { label: 'Write', value: 'approval', tone: 'manual' }]} />}
    >
      <section className="app-workflow-band">
        <div><span>1</span><strong>Choose endpoint</strong><p>Provide URL, method, and optional payload.</p></div>
        <div><span>2</span><strong>Check policy</strong><p>GET can run automatically; mutating calls wait for approval.</p></div>
        <div><span>3</span><strong>Store memory</strong><p>The result becomes proof and an API memory pack.</p></div>
      </section>
      <section className="app-workspace">
        <div className="app-input-panel">
          <h2 className="panel-title">API Brief</h2>
          <label className="app-field"><span>URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} /></label>
          <label className="app-field"><span>Method</span><input value={method} onChange={(event) => setMethod(event.target.value.toUpperCase())} /></label>
          {method !== 'GET' ? <label className="app-field"><span>Body</span><textarea value={body} onChange={(event) => setBody(event.target.value)} /></label> : null}
          <button className="run-button" type="button" onClick={run} disabled={loading || !url.trim()}>{loading ? 'Calling...' : 'Run API Operation'}</button>
        </div>
        <aside className="app-output-panel">
          <div className="panel-head"><div><h2 className="panel-title">API Result</h2><p className="panel-subtitle">Readable status, proof, and memory pack.</p></div><span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span></div>
          {!result ? <ProductEmpty title="Ready" detail="Run an API operation to see the result here." /> : (
            <div className="app-readable-result">
              <strong>{result.appResult?.summary || result.error || result.summary}</strong>
              <div className="run-result-stats"><div><span>Method</span><strong>{result.appResult?.method || method}</strong></div><div><span>Proof</span><strong>{result.proofCount ?? result.proof?.length ?? 1}</strong></div><div><span>Memory</span><strong>{result.appMemoryPack ? 'saved' : 'ready'}</strong></div></div>
              <div className="app-next-list">{(result.appMemoryPack?.nextActions || ['Review response output']).map((item: string) => <span key={item}>{item}</span>)}</div>
            </div>
          )}
        </aside>
      </section>

      <AppMemoryRecall app="api" title="API Memory" detail="Endpoints, methods, response notes, and next actions saved from API runs." />
    </ProductPage>
  );
}
