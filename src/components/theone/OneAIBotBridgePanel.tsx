'use client';

import { useEffect, useState } from 'react';
import { ProductEmpty, ProductStatusStrip, friendlyStatus } from './ProductNav';

export function OneAIBotBridgePanel() {
  const [bot, setBot] = useState<any>(null);
  const [workflow, setWorkflow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/oneai-bot/status', { cache: 'no-store' });
      const json = await res.json();
      setBot(json.bot || null);
    } catch (error) {
      setBot({
        ok: false,
        status: 'error',
        message: error instanceof Error ? error.message : 'OneAI Bot bridge check failed.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runBridgeCheck() {
    setRunning(true);
    setWorkflow(null);
    try {
      const res = await fetch('/api/theone/apps/bot/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'assist' }),
      });
      setWorkflow(await res.json());
    } catch (error) {
      setWorkflow({
        ok: false,
        error: error instanceof Error ? error.message : 'Bot bridge workflow failed.',
      });
    } finally {
      setRunning(false);
    }
  }

  const connected = Boolean(bot?.ok);
  const configured = Boolean(bot?.configured);

  return (
    <section className="worker-app-workspace">
      <div className="product-command-card worker-app-command">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Bridge Contract</h2>
            <p className="panel-subtitle">TheOne registers the existing bot as an external community agent runtime. The bot repository is not modified.</p>
          </div>
          <div className="button-row">
            <button className="mini-action" type="button" onClick={load} disabled={loading}>Refresh</button>
            <button className="mini-action primary" type="button" onClick={runBridgeCheck} disabled={running}>
              {running ? 'Checking' : 'Record Proof'}
            </button>
          </div>
        </div>

        <ProductStatusStrip
          items={[
            { label: 'Bot', value: connected ? 'online' : configured ? 'configured' : 'local repo', tone: connected ? 'online' : 'assist' },
            { label: 'Mode', value: bot?.mode || 'external' },
            { label: 'Code', value: 'unchanged', tone: 'online' },
          ]}
        />

        <div className="worker-action-summary">
          <span>oneai.bot.oneclaw_bridge</span>
          <strong>Bot keeps its Telegram context and existing OneAI to OneClaw execution path. TheOne only governs status, policy, proof, and future routing.</strong>
        </div>

        <div className="app-next-list">
          <span>1. Health check: TheOne can check the Bot HTTP service without touching Telegram.</span>
          <span>2. Runtime registration: Bot appears as an App, Connector, Worker, and installable package.</span>
          <span>3. Safe execution: Bot-triggered OneClaw work remains inside the Bot's existing bridge and approval context.</span>
          <span>4. Next bridge: add a small Bot-side HTTP command endpoint later, only if you choose to change the Bot code.</span>
        </div>

        {workflow ? (
          <div className="run-route-card">
            <span>Bridge workflow</span>
            <strong>{workflow.appResult?.summary || workflow.error || 'Bot bridge proof recorded.'}</strong>
            <p>{workflow.runId ? `Run ${workflow.runId}` : 'No run id returned.'}</p>
          </div>
        ) : null}
      </div>

      <aside className="product-result-card worker-app-result">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Bot Status</h2>
            <p className="panel-subtitle">Read-only bridge status for the existing WAOC OneAI Telegram Bot.</p>
          </div>
          <span className={`status-pill status-${connected ? 'online' : configured ? 'assist' : 'manual'}`}>
            {loading ? 'checking' : friendlyStatus(bot?.status)}
          </span>
        </div>

        {!bot ? (
          <ProductEmpty title="Checking" detail="TheOne is checking the bot bridge." />
        ) : (
          <div className="app-readable-result">
            <strong>{bot.message || 'Bot bridge status loaded.'}</strong>
            <div className="policy-chip-row">
              {(bot.capabilities || []).map((capability: string) => (
                <span key={capability} className="capability-chip">{capability}</span>
              ))}
            </div>
            <pre>{JSON.stringify({
              configured: bot.configured,
              status: bot.status,
              endpoint: bot.endpoint || 'not configured',
              repoPath: bot.repoPath,
              bridge: bot.bridge,
            }, null, 2)}</pre>
          </div>
        )}
      </aside>
    </section>
  );
}
