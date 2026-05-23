'use client';

import { useState } from 'react';
import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const operations = ['extract', 'open', 'screenshot'];

export default function BrowserAppPage() {
  const [url, setUrl] = useState('weareoneconnection.org');
  const [operation, setOperation] = useState('extract');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const status = loading ? 'running' : result?.appResult?.status || result?.os?.workflow?.status || (result ? 'completed' : 'ready');

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/apps/browser/operate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, operation, mode: 'assist' }),
      });
      setResult(await res.json());
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'Browser workflow could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="Browser App"
      title="Browser operations workspace"
      subtitle="Open, extract, or capture web targets through OneClaw while TheOne keeps proof and memory."
      compact
      aside={<ProductStatusStrip items={[{ label: 'State', value: friendlyStatus(status), tone: status }, { label: 'Worker', value: 'browser', tone: 'online' }, { label: 'Proof', value: 'auto', tone: 'online' }]} />}
    >
      <section className="app-workflow-band">
        <div><span>1</span><strong>Give target</strong><p>Provide a URL and browser operation.</p></div>
        <div><span>2</span><strong>OneClaw operates</strong><p>Browser worker performs allowed web operation.</p></div>
        <div><span>3</span><strong>Reuse result</strong><p>TheOne records proof and a browser memory pack.</p></div>
      </section>
      <section className="app-workspace">
        <div className="app-input-panel">
          <h2 className="panel-title">Browser Brief</h2>
          <label className="app-field"><span>URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} /></label>
          <div className="app-field"><span>Operation</span><div className="app-choice-grid">{operations.map((item) => <button key={item} type="button" className={operation === item ? 'app-choice active' : 'app-choice'} onClick={() => setOperation(item)}>{item}</button>)}</div></div>
          <button className="run-button" type="button" onClick={run} disabled={loading || !url.trim()}>{loading ? 'Running...' : 'Run Browser Operation'}</button>
        </div>
        <aside className="app-output-panel">
          <div className="panel-head"><div><h2 className="panel-title">Browser Result</h2><p className="panel-subtitle">Worker receipt, proof, and memory.</p></div><span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span></div>
          {!result ? <ProductEmpty title="Ready" detail="Run a browser operation to see the result here." /> : (
            <div className="app-readable-result">
              <strong>{result.appResult?.summary || result.error || result.summary}</strong>
              <div className="run-result-stats"><div><span>Operation</span><strong>{result.appResult?.operation || operation}</strong></div><div><span>Task</span><strong>{result.appResult?.oneClawTaskId ? 'receipt' : 'ready'}</strong></div><div><span>Memory</span><strong>{result.appMemoryPack ? 'saved' : 'ready'}</strong></div></div>
              {result.appResult?.oneClawTaskId ? <div className="run-route-card"><span>OneClaw task</span><strong>{result.appResult.oneClawTaskId}</strong><p>{result.appResult.url}</p></div> : null}
            </div>
          )}
        </aside>
      </section>

      <AppMemoryRecall app="browser" title="Browser Memory" detail="Browser operations, captured targets, and reusable web evidence." />
    </ProductPage>
  );
}
