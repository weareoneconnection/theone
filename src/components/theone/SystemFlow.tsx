export function SystemFlow({ result, loading }: { result: any; loading: boolean }) {
  const workflow = result?.os?.workflow;
  const capabilities = result?.plan?.capabilityRoute?.capabilities || [];
  const connectors = result?.plan?.capabilityRoute?.connectors || [];
  const permissions = result?.permissions || result?.os?.permissions || [];
  const status = loading ? 'running' : workflow?.status || (result?.ok ? 'completed' : 'idle');

  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Kernel Flow</h2>
          <p className="panel-subtitle">Intent to governed execution.</p>
        </div>
        <span className={`status-pill status-${status}`}>{status}</span>
      </div>
      <div className="flow-grid">
        <InfoTile title="Intent" value={result?.intent?.type || '-'} />
        <InfoTile title="Capabilities" value={capabilities.length ? capabilities.join(', ') : '-'} />
        <InfoTile title="Connectors" value={connectors.length ? connectors.map((connector: any) => connector.kind).join(', ') : '-'} />
        <InfoTile title="Permissions" value={permissions.length ? String(permissions.length) : '-'} />
      </div>
      <div className="flow-lane">
        {['Intent', 'Context Bus', 'Permission', 'OneAI', 'Runtime', 'Approval', 'OneClaw', 'Proof', 'Memory'].map((item) => (
          <span key={item} className="flow-step">{item}</span>
        ))}
      </div>
    </section>
  );
}

function InfoTile({ title, value }: { title: string; value: string }) {
  return (
    <div className="info-tile">
      <div className="info-label">{title}</div>
      <div className="info-value">{value}</div>
    </div>
  );
}
