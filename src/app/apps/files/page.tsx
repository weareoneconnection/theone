'use client';

import { useState } from 'react';
import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const operations = [
  { key: 'list', label: 'List folder' },
  { key: 'exists', label: 'Check exists' },
  { key: 'read', label: 'Read file' },
  { key: 'write', label: 'Write file' },
  { key: 'append', label: 'Append file' },
];

function resultMessage(result: any) {
  if (result?.appResult?.summary) return result.appResult.summary;
  if (result?.error) return String(result.error);
  return result?.summary || 'File operation has been handled.';
}

function completedSteps(result: any) {
  const steps = result?.plan?.steps || result?.os?.workflow?.steps || [];
  return steps.filter((step: any) => step.status === 'completed').length;
}

export default function FilesAppPage() {
  const [path, setPath] = useState('/tmp');
  const [operation, setOperation] = useState('list');
  const [content, setContent] = useState('Created from TheOne Files App.');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const status = loading ? 'running' : result?.appResult?.status || result?.os?.workflow?.status || (result ? 'completed' : 'ready');
  const writeLike = operation === 'write' || operation === 'append';

  async function runFiles() {
    if (!path.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/apps/files/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, operation, content, mode: 'assist' }),
      });
      setResult(await res.json());
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'Files workflow could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="Files App"
      title="File workspace"
      subtitle="Browse, read, and prepare guarded writes through OneClaw while TheOne keeps proof and policy attached."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'State', value: friendlyStatus(status), tone: status },
            { label: 'Reads', value: 'auto', tone: 'online' },
            { label: 'Writes', value: 'approval', tone: 'manual' },
          ]}
        />
      )}
    >
      <section className="app-workflow-band">
        <div><span>1</span><strong>Pick a path</strong><p>Choose a folder or file to inspect.</p></div>
        <div><span>2</span><strong>Run safely</strong><p>Read-only actions can run automatically; writes wait for approval.</p></div>
        <div><span>3</span><strong>Keep proof</strong><p>The result, receipt, and policy decision stay attached.</p></div>
      </section>

      <section className="app-workspace">
        <div className="app-input-panel">
          <h2 className="panel-title">File Brief</h2>
          <p className="panel-subtitle">TheOne turns file actions into governed OneClaw filesystem tasks.</p>

          <label className="app-field">
            <span>Path</span>
            <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/tmp" />
          </label>

          <div className="app-field">
            <span>Operation</span>
            <div className="app-choice-grid">
              {operations.map((item) => (
                <button key={item.key} type="button" className={operation === item.key ? 'app-choice active' : 'app-choice'} onClick={() => setOperation(item.key)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {writeLike ? (
            <label className="app-field">
              <span>Content</span>
              <textarea value={content} onChange={(event) => setContent(event.target.value)} />
            </label>
          ) : null}

          <button className="run-button" type="button" onClick={runFiles} disabled={loading || !path.trim()}>
            {loading ? 'Running...' : writeLike ? 'Prepare Write' : 'Run File Action'}
          </button>
        </div>

        <aside className="app-output-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">File Result</h2>
              <p className="panel-subtitle">Readable output, approval state, and worker receipt.</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          {!result ? (
            <ProductEmpty title="Ready" detail="Run a file action to see the result here." />
          ) : (
            <div className="app-readable-result">
              <strong>{resultMessage(result)}</strong>
              <div className="run-result-stats">
                <div><span>Steps</span><strong>{completedSteps(result)}/3</strong></div>
                <div><span>Approval</span><strong>{result.appResult?.requiresApproval ? 'needed' : 'none'}</strong></div>
                <div><span>Proof</span><strong>{result.proofCount ?? result.proof?.length ?? 1}</strong></div>
              </div>
              <div className="app-next-list">
                <span>{writeLike ? 'Approve the write only after checking the path and content.' : 'Review the returned file information.'}</span>
                <span>Use Advanced for raw OneClaw output if needed.</span>
              </div>
              {result.appResult?.oneClawTaskId ? (
                <div className="run-route-card">
                  <span>OneClaw task</span>
                  <strong>{result.appResult.oneClawTaskId}</strong>
                  <p>{result.appResult.operation} · {result.appResult.path}</p>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </section>

      <AppMemoryRecall app="files" title="Files Memory" detail="File paths, write approvals, and artifact notes TheOne can reuse." />
    </ProductPage>
  );
}
