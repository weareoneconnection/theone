export function ProofPanel({ result }: { result: any }) {
  const items = result?.proof || [];

  return (
    <section className="panel-card">
      <h2 className="panel-title">Proof Ledger</h2>
      <div className="proof-list">
        {items.length === 0 ? (
          <div className="proof-item">
            <div className="feed-title">No proof yet.</div>
            <div className="proof-meta">Proof appears after agent execution.</div>
          </div>
        ) : (
          items.map((item: any, index: number) => (
            <div key={`${item.title}-${index}`} className="proof-item">
              <div className="feed-title">{item.title}</div>
              <div className="proof-meta">
                {item.type} · {item.value || 'Recorded'} · {item.timestamp || 'now'}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
