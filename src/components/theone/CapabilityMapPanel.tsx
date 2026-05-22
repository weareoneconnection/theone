export function CapabilityMapPanel({ result }: { result: any }) {
  const capabilities = result?.os?.capabilities || [];
  const route = result?.plan?.capabilityRoute;
  const active = new Set(route?.capabilities || []);
  const skills = route?.skills || [];
  const apps = route?.apps || [];
  const connectors = route?.connectors || [];

  return (
    <section className="panel-card">
      <h2 className="panel-title">Capability Map</h2>
      <p className="panel-subtitle">
        Apps are bundles. TheOne routes work through universal real-world capability primitives.
      </p>
      <div className="capability-map">
        {capabilities.length === 0 ? (
          <div className="capability-node">
            <div className="feed-title">Capability graph waiting.</div>
            <div className="proof-meta">Run TheOne to see the active capability route.</div>
          </div>
        ) : (
          capabilities.map((capability: any) => (
            <div
              key={capability.key}
              className={active.has(capability.key) ? 'capability-node active' : 'capability-node'}
            >
              <div className="feed-head">
                <div className="feed-title">{capability.title}</div>
                <span className={`risk-chip risk-${capability.defaultRisk}`}>{capability.defaultRisk}</span>
              </div>
              <div className="proof-meta">{capability.purpose}</div>
            </div>
          ))
        )}
      </div>
      <div className="route-summary-grid">
        <RouteBox title="Matched Skills" items={skills.map((skill: any) => skill.title || skill.key)} />
        <RouteBox title="App Bundles" items={apps.map((app: any) => app.title || app.key)} />
        <RouteBox title="Connectors" items={connectors.map((connector: any) => connector.title || connector.key)} />
      </div>
    </section>
  );
}

function RouteBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="route-box">
      <div className="mini-heading">{title}</div>
      {items.length === 0 ? (
        <div className="proof-meta">No route yet.</div>
      ) : (
        <div className="capability-chip-list">
          {items.slice(0, 6).map((item) => (
            <span key={item} className="capability-chip">{item}</span>
          ))}
        </div>
      )}
    </div>
  );
}
