'use client';

import { useState } from 'react';
import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const formats = ['Brief', 'Investor summary', 'Operator report', 'Launch memo', 'Risk review'];

export default function ReportAppPage() {
  const [topic, setTopic] = useState('TheOne AI OS product progress');
  const [format, setFormat] = useState(formats[0]);
  const [source, setSource] = useState('Use recent TheOne proof, app workflow closures, and current product direction.');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const status = loading ? 'running' : result?.appResult?.status || result?.os?.workflow?.status || (result ? 'completed' : 'ready');

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/apps/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, format, source, mode: 'assist', language: 'en' }),
      });
      setResult(await res.json());
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'Report workflow could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="Report App"
      title="Report generation workspace"
      subtitle="Turn source notes, proof, and outcomes into a clean report while TheOne stores the result as reusable memory."
      compact
      aside={<ProductStatusStrip items={[{ label: 'State', value: friendlyStatus(status), tone: status }, { label: 'Reasoning', value: 'OneAI', tone: 'online' }, { label: 'Memory', value: 'pack', tone: 'assist' }]} />}
    >
      <section className="app-workflow-band">
        <div><span>1</span><strong>Give material</strong><p>Topic, format, and source notes.</p></div>
        <div><span>2</span><strong>OneAI writes</strong><p>The report is generated from the supplied proof and context.</p></div>
        <div><span>3</span><strong>TheOne remembers</strong><p>The output becomes a report memory pack.</p></div>
      </section>
      <section className="app-workspace">
        <div className="app-input-panel">
          <h2 className="panel-title">Report Brief</h2>
          <label className="app-field"><span>Topic</span><input value={topic} onChange={(event) => setTopic(event.target.value)} /></label>
          <div className="app-field"><span>Format</span><div className="app-choice-grid">{formats.map((item) => <button key={item} type="button" className={format === item ? 'app-choice active' : 'app-choice'} onClick={() => setFormat(item)}>{item}</button>)}</div></div>
          <label className="app-field"><span>Source notes</span><textarea value={source} onChange={(event) => setSource(event.target.value)} /></label>
          <button className="run-button" type="button" onClick={run} disabled={loading || !topic.trim()}>{loading ? 'Generating...' : 'Generate Report'}</button>
        </div>
        <aside className="app-output-panel">
          <div className="panel-head"><div><h2 className="panel-title">Report Result</h2><p className="panel-subtitle">Readable report, proof, and memory pack.</p></div><span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span></div>
          {!result ? <ProductEmpty title="Ready" detail="Generate a report to see it here." /> : (
            <div className="app-readable-result">
              <strong>{result.appResult?.summary || result.error || result.summary}</strong>
              <div className="run-result-stats"><div><span>Format</span><strong>{result.appResult?.format || format}</strong></div><div><span>Proof</span><strong>{result.proofCount ?? result.proof?.length ?? 1}</strong></div><div><span>Memory</span><strong>{result.appMemoryPack ? 'saved' : 'ready'}</strong></div></div>
              <div className="app-next-list">{(result.appMemoryPack?.nextActions || ['Review report facts']).map((item: string) => <span key={item}>{item}</span>)}</div>
            </div>
          )}
        </aside>
      </section>

      <AppMemoryRecall app="report" title="Report Memory" detail="Generated reports and reusable findings saved for future briefs." />
    </ProductPage>
  );
}
