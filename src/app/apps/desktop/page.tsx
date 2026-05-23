'use client';

import { useState } from 'react';
import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const operations = [
  { key: 'state', label: 'Inspect app state' },
  { key: 'screenshot', label: 'Capture screenshot' },
  { key: 'hotkey', label: 'Send hotkey' },
  { key: 'type', label: 'Type text' },
];

function resultMessage(result: any) {
  if (result?.appResult?.summary) return result.appResult.summary;
  if (result?.error) return String(result.error);
  return result?.summary || 'Desktop action has been prepared.';
}

function completedSteps(result: any) {
  const steps = result?.plan?.steps || result?.os?.workflow?.steps || [];
  return steps.filter((step: any) => step.status === 'completed').length;
}

function totalSteps(result: any) {
  return (result?.plan?.steps || result?.os?.workflow?.steps || []).length;
}

export default function DesktopAppPage() {
  const [app, setApp] = useState('Google Chrome');
  const [operation, setOperation] = useState('state');
  const [text, setText] = useState('https://theone-eta.vercel.app/');
  const [keys, setKeys] = useState('cmd,l');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const status = loading ? 'running' : result?.appResult?.status || result?.os?.workflow?.status || (result ? 'completed' : 'ready');

  async function runDesktop() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/apps/desktop/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app,
          operation,
          text,
          keys: keys.split(',').map((item) => item.trim()).filter(Boolean),
          mode: 'assist',
        }),
      });
      setResult(await res.json());
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'Desktop workflow could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="Desktop App"
      title="Local computer control workspace"
      subtitle="Prepare local Mac actions through the OneClaw Local Desktop Bridge. Every control action stays approval gated."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'State', value: friendlyStatus(status), tone: status },
            { label: 'Bridge', value: 'local', tone: 'assist' },
            { label: 'Control', value: 'approval', tone: 'manual' },
          ]}
        />
      )}
    >
      <section className="app-workflow-band">
        <div><span>1</span><strong>Choose target</strong><p>Select the local app and the exact operation.</p></div>
        <div><span>2</span><strong>Approval gate</strong><p>TheOne prepares the OneClaw desktop task and waits for approval.</p></div>
        <div><span>3</span><strong>Proof trail</strong><p>Receipts and screenshots stay attached to the run.</p></div>
      </section>

      <section className="app-workspace">
        <div className="app-input-panel">
          <h2 className="panel-title">Desktop Brief</h2>
          <p className="panel-subtitle">Use this when TheOne needs to inspect or operate this Mac through the local bridge.</p>

          <label className="app-field">
            <span>App</span>
            <input value={app} onChange={(event) => setApp(event.target.value)} />
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

          {operation === 'hotkey' ? (
            <label className="app-field">
              <span>Keys</span>
              <input value={keys} onChange={(event) => setKeys(event.target.value)} placeholder="cmd,l" />
            </label>
          ) : null}

          {operation === 'type' ? (
            <label className="app-field">
              <span>Text</span>
              <input value={text} onChange={(event) => setText(event.target.value)} />
            </label>
          ) : null}

          <button className="run-button" type="button" onClick={runDesktop} disabled={loading || !app.trim()}>
            {loading ? 'Preparing...' : 'Prepare Desktop Action'}
          </button>
        </div>

        <aside className="app-output-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Desktop Result</h2>
              <p className="panel-subtitle">Approval state, receipt, and local bridge output.</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          {!result ? (
            <ProductEmpty title="Ready" detail="Prepare a desktop action to see its approval and receipt here." />
          ) : (
            <div className="app-readable-result">
              <strong>{resultMessage(result)}</strong>
              <div className="run-result-stats">
                <div><span>Steps</span><strong>{completedSteps(result)}/{totalSteps(result) || 3}</strong></div>
                <div><span>Approvals</span><strong>{result.approvals?.length || result.pendingApprovals?.length || 0}</strong></div>
                <div><span>Task</span><strong>{result.appResult?.oneClawTaskId ? 'ready' : 'pending'}</strong></div>
              </div>
              <div className="app-next-list">
                <span>Approve the OneClaw task when you want it to touch the local desktop.</span>
                <span>Use Runs or Advanced to inspect the full receipt after approval.</span>
              </div>
              {result.appResult?.oneClawTaskId ? (
                <div className="run-route-card">
                  <span>OneClaw task</span>
                  <strong>{result.appResult.oneClawTaskId}</strong>
                  <p>{result.appResult.operation} on {result.appResult.targetApp}</p>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </section>

      <AppMemoryRecall app="desktop" title="Desktop Memory" detail="Local bridge actions, approvals, and safe operating patterns saved for this computer." />
    </ProductPage>
  );
}
