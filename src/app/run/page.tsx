'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const modes = ['manual', 'assist', 'auto'];

const quickPrompts = [
  'Analyze website weareoneconnection.org and summarize useful findings',
  'Prepare a high-signal X post: TheOne is becoming an AI operating system for real-world work.',
  'Check GitHub repo weareoneconnection/theone and explain what needs attention',
  'Use the local desktop bridge to inspect Chrome',
  'List files in /tmp',
  'Create a report from research and proof',
];

function plainResult(result: any) {
  const error = String(result?.error || '');
  if (error) return error.replace(/Invalid `prisma[^`]+` invocation:[\s\S]*/i, 'TheOne switched to safe mode because the memory database is temporarily unavailable.');
  if (result?.appResult?.summary) return result.appResult.summary;
  if (result?.appRoute?.summary) return result.appRoute.summary;
  if (result?.summary) return result.summary;
  const oneClaw = [...(result?.executions || [])].reverse().find((execution: any) => execution.provider === 'oneclaw');
  if (oneClaw?.summary) return oneClaw.summary;
  if (result?.objective) return `TheOne prepared a route for: ${result.objective}`;
  return 'TheOne is ready to plan, check policy, execute, and record proof.';
}

function runStats(result: any) {
  return {
    approvals: result?.approvals?.length || result?.pendingApprovals?.length || 0,
    executions: result?.executions?.length || 0,
    proof: result?.proof?.length || result?.proofRecords?.length || 0,
  };
}

export default function RunPage() {
  const [input, setInput] = useState('Browse a website and summarize the useful findings');
  const [mode, setMode] = useState('assist');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const status = loading ? 'running' : result?.os?.workflow?.status || result?.status || (result ? 'completed' : 'ready');
  const stats = runStats(result);

  async function runTheOne() {
    if (!input.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input,
          mode,
          language: 'en',
        }),
      });
      setResult(await res.json());
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'TheOne could not start this run.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="Run TheOne"
      title="Tell TheOne what to finish."
      subtitle="Describe the outcome. TheOne selects the right app, checks policy, calls OneAI for reasoning, sends executable work to OneClaw, and records proof."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'State', value: friendlyStatus(status), tone: status },
            { label: 'Mode', value: mode, tone: mode },
            { label: 'Route', value: 'auto', tone: 'assist' },
          ]}
        />
      )}
    >
      <section className="run-command-workspace">
        <div className="product-command-card run-command-card">
          <div className="product-mode-selector mode-selector" aria-label="Execution mode">
            {modes.map((item) => (
              <button key={item} type="button" className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>
                {item}
              </button>
            ))}
          </div>

          <label className="run-command-box">
            <span>Outcome</span>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Describe what you want TheOne to finish..."
            />
          </label>

          <div className="product-action-row">
            <button className="run-button" type="button" onClick={runTheOne} disabled={loading || !input.trim()}>
              {loading ? 'Running...' : 'Run TheOne'}
            </button>
            <span>{friendlyStatus(status)}</span>
          </div>

          <div className="quick-prompt-grid" aria-label="Quick starts">
            {quickPrompts.map((prompt) => (
              <button key={prompt} type="button" onClick={() => setInput(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <aside className="product-result-card run-result-card">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Result</h2>
              <p className="panel-subtitle">Readable plan, approval state, execution, and proof.</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          {!result ? (
            <ProductEmpty title="Ready" detail="Run TheOne to see the route and result here." />
          ) : (
            <>
              {result.appRoute ? (
                <div className="run-route-card">
                  <span>{result.appRoute.title}</span>
                  <strong>{result.appRoute.action}</strong>
                  <p>{result.appRoute.approvalMode === 'manual' ? 'Approval gated' : 'Auto runnable'} · routed by TheOne App Router</p>
                </div>
              ) : null}
              <div className="app-readable-result">
                <strong>{plainResult(result)}</strong>
                <div className="app-next-list">
                  <span>{result.appRoute ? `TheOne routed this to the ${result.appRoute.app} App workflow and recorded proof.` : 'TheOne selected capabilities and policy for this request.'}</span>
                  {result.appResult?.status ? <span>App status: {friendlyStatus(result.appResult.status)}</span> : null}
                  {result.appMemoryPack ? <span>Memory saved: {result.appMemoryPack.title}</span> : null}
                  <span>Use Apps for focused workspaces, or Advanced for the full trace.</span>
                </div>
              </div>
              <div className="run-result-stats">
                <div>
                  <span>Approvals</span>
                  <strong>{stats.approvals}</strong>
                </div>
                <div>
                  <span>Executions</span>
                  <strong>{stats.executions}</strong>
                </div>
                <div>
                  <span>Proof</span>
                  <strong>{stats.proof}</strong>
                </div>
              </div>
            </>
          )}
        </aside>
      </section>

      <section className="run-support-grid">
        <Link href="/apps" className="product-mini-card">
          <span className="product-card-kicker">Apps</span>
          <h2>Choose a focused workspace</h2>
          <p>Use Apps when you already know the surface: Web, X, GitHub, Desktop, Reports, and more.</p>
        </Link>
        <Link href="/runs" className="product-mini-card">
          <span className="product-card-kicker">Runs</span>
          <h2>Continue recent work</h2>
          <p>Review outcomes, approvals, proof counts, and past requests TheOne has handled.</p>
        </Link>
        <Link href="/theone" className="product-mini-card">
          <span className="product-card-kicker">Advanced</span>
          <h2>Inspect the full OS trace</h2>
          <p>Open kernel, worker, policy, proof, memory, and raw execution details when needed.</p>
        </Link>
      </section>
    </ProductPage>
  );
}
