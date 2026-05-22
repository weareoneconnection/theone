export function ContextBusPanel({ result }: { result: any }) {
  const frame = result?.contextFrame || result?.os?.contextFrame;
  const resources = frame?.resources || [];
  const summary = frame?.summary;

  return (
    <section className="panel-card">
      <h2 className="panel-title">Context Bus</h2>
      <p className="panel-subtitle">
        One governed frame for intent, capabilities, connectors, memory, approvals, and executions.
      </p>
      <div className="mini-kpis small">
        <div className="kpi-tile">
          <div className="kpi-label">Resources</div>
          <div className="kpi-value">{summary?.resourceCount ?? 0}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Connectors</div>
          <div className="kpi-value">{summary?.connectorCount ?? 0}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Memory</div>
          <div className="kpi-value">{summary?.memoryHitCount ?? 0}</div>
        </div>
      </div>
      <div className="ledger-list compact">
        {resources.length === 0 ? (
          <div className="ledger-item">
            <div className="feed-title">No context frame yet.</div>
            <div className="proof-meta">Run TheOne to build a governed context bus frame.</div>
          </div>
        ) : (
          resources.slice(0, 8).map((resource: any) => (
            <div key={`${resource.kind}:${resource.id}`} className="ledger-item">
              <div className="feed-head">
                <div className="feed-title">{resource.title}</div>
                <span className={`risk-chip risk-${resource.risk}`}>{resource.kind}</span>
              </div>
              <div className="proof-meta">
                {resource.source}{resource.provider ? ` · ${resource.provider}` : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
