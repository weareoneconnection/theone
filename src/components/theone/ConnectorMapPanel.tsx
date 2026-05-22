export function ConnectorMapPanel({ result }: { result: any }) {
  const catalog = result?.os?.connectors || [];
  const route = result?.plan?.capabilityRoute;
  const active = new Set((route?.connectors || []).map((connector: any) => connector.key));

  return (
    <section className="panel-card">
      <h2 className="panel-title">Connector Registry</h2>
      <p className="panel-subtitle">
        Connectors are external system surfaces. TheOne selects them; OneClaw or TheOne drivers operate them.
      </p>
      <div className="capability-map">
        {catalog.length === 0 ? (
          <div className="capability-node">
            <div className="feed-title">Connector catalog waiting.</div>
            <div className="proof-meta">Run TheOne to see the active connector route.</div>
          </div>
        ) : (
          catalog.map((connector: any) => (
            <div
              key={connector.key}
              className={active.has(connector.key) ? 'capability-node active' : 'capability-node'}
            >
              <div className="feed-head">
                <div className="feed-title">{connector.title}</div>
                <span className={`risk-chip risk-${connector.riskProfile}`}>{connector.kind}</span>
              </div>
              <div className="proof-meta">
                {connector.provider} · {connector.status} · {connector.description}
              </div>
              <div className="proof-meta">
                scopes: {(connector.permissionScopes || []).join(', ')}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
