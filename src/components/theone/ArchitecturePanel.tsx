export function ArchitecturePanel({ result }: { result: any }) {
  const layers = result?.os?.layers || [];
  const appBundles = result?.os?.appBundles || [];

  return (
    <section className="panel-card">
      <h2 className="panel-title">Universal AI OS</h2>
      <div className="layer-grid">
        {layers.length === 0 ? (
          <div className="layer-item">
            <div className="feed-title">Kernel waiting.</div>
            <div className="proof-meta">The OS layers appear after the first run.</div>
          </div>
        ) : (
          layers.map((layer: any) => (
            <div key={layer.key} className="layer-item">
              <div className="layer-status-row">
                <div className="feed-title">{layer.title}</div>
                <span className={`status-pill status-${layer.status}`}>{layer.status}</span>
              </div>
              <div className="proof-meta">{layer.role}</div>
            </div>
          ))
        )}
      </div>
      <div className="app-bundle-list">
        {appBundles.slice(0, 6).map((app: any) => (
          <div key={app.key} className="app-bundle-item">
            <div className="feed-head">
              <div className="feed-title">{app.title}</div>
              <span className={`risk-chip risk-${app.riskProfile}`}>{app.riskProfile}</span>
            </div>
            <div className="proof-meta">{app.domain}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
