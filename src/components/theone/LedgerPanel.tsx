export function LedgerPanel({
  proof,
  memory,
}: {
  proof: any[];
  memory: any[];
}) {
  return (
    <section className="panel-card">
      <h2 className="panel-title">Durable Ledger</h2>
      <div className="ledger-split">
        <div>
          <div className="mini-heading">Proof</div>
          <div className="ledger-list compact">
            {proof.length === 0 ? (
              <div className="proof-meta">No proof receipts yet.</div>
            ) : (
              proof.slice(0, 5).map((item) => (
                <div key={item.id} className="ledger-item">
                  <div className="feed-title">{item.title}</div>
                  <div className="proof-meta">{item.type} · {item.value || 'Recorded'}</div>
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <div className="mini-heading">Memory</div>
          <div className="ledger-list compact">
            {memory.length === 0 ? (
              <div className="proof-meta">No memory notes yet.</div>
            ) : (
              memory.slice(0, 5).map((item) => (
                <div key={item.id} className="ledger-item">
                  <div className="feed-title">{item.kind}</div>
                  <div className="proof-meta">{item.summary}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
