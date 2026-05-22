export function MemoryContextPanel({ result }: { result: any }) {
  const hits = result?.memoryContext || result?.plan?.memoryContext || [];

  return (
    <section className="panel-card">
      <h2 className="panel-title">Memory Context</h2>
      <div className="ledger-list compact">
        {hits.length === 0 ? (
          <div className="ledger-item">
            <div className="feed-title">No recalled memory yet.</div>
            <div className="proof-meta">TheOne will query prior runs as the ledger grows.</div>
          </div>
        ) : (
          hits.slice(0, 5).map((item: any) => (
            <div key={item.id} className="ledger-item">
              <div className="feed-head">
                <div className="feed-title">{item.title}</div>
                <span className="capability-chip">score {item.score}</span>
              </div>
              <div className="proof-meta">
                {item.kind} · {item.summary}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
