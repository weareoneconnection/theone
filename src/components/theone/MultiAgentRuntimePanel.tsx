'use client';

function tone(status: string) {
  if (status === 'block') return 'blocked';
  if (status === 'warn') return 'manual';
  return 'auto';
}

export function MultiAgentRuntimePanel({ result }: { result: any }) {
  const runtime = result?.multiAgentRuntime;
  const agents = runtime?.agents || [];
  const consensus = runtime?.consensus;

  return (
    <section className="panel-card multi-agent-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Multi-Agent Runtime</h2>
          <p className="panel-subtitle">Planner, Policy, Critic, Operator, and Memory run in parallel before execution closes.</p>
        </div>
        <span className="panel-count">L14</span>
      </div>

      <div className={`automation-decision decision-${tone(runtime?.status || 'idle')}`}>
        <div>
          <div className="automation-title">{consensus?.summary || 'No multi-agent consensus yet'}</div>
          <div className="automation-detail">
            {runtime ? `${agents.length} agent(s) · ${runtime.durationMs}ms · ${runtime.mode}` : 'Run TheOne to generate a multi-agent quorum.'}
          </div>
        </div>
        <div className="automation-score">
          <span>{runtime?.status || 'idle'}</span>
          <small>consensus</small>
        </div>
      </div>

      {consensus?.recommendations?.length ? (
        <div className="policy-reasons">
          {consensus.recommendations.slice(0, 4).map((item: string, index: number) => (
            <div key={`${item}-${index}`}>{item}</div>
          ))}
        </div>
      ) : null}

      <div className="agent-quorum-grid">
        {agents.length === 0 ? (
          <div className="policy-row">
            <div className="feed-title">Standing by for agent quorum.</div>
            <div className="proof-meta">The next run will record each agent role and consensus.</div>
          </div>
        ) : agents.map((agent: any) => (
          <div key={agent.role} className="policy-row agent-card">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{agent.role}</div>
                <div className="proof-meta">{agent.title}</div>
              </div>
              <span className={`status-pill status-${tone(agent.status)}`}>{agent.status}</span>
            </div>
            <div className="automation-detail">{agent.summary}</div>
            <div className="ledger-meta-row">
              <span>confidence {Math.round((agent.confidence || 0) * 100)}%</span>
              <span>{agent.durationMs}ms</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
