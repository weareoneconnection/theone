export function RunHistoryPanel({
  items,
  onOpenRun,
}: {
  items: any[];
  onOpenRun: (runId: string) => void;
}) {
  return (
    <section className="panel-card">
      <h2 className="panel-title">Recent Runs</h2>
      <div className="ledger-list">
        {items.length === 0 ? (
          <div className="ledger-item">
            <div className="feed-title">No durable runs yet.</div>
            <div className="proof-meta">Run TheOne once to write the first OS ledger entry.</div>
          </div>
        ) : (
          items.slice(0, 6).map((item) => (
            <button
              key={item.runId}
              className="ledger-item ledger-button"
              type="button"
              onClick={() => onOpenRun(item.runId)}
            >
              <div className="feed-head">
                <div className="feed-title">{item.intentType}</div>
                <span className={`status-pill status-${item.workflowStatus}`}>{item.workflowStatus}</span>
              </div>
              <div className="proof-meta">{item.objective}</div>
              <div className="ledger-meta-row">
                <span>{item.pendingApprovals} pending</span>
                <span>{item.proofCount} proof</span>
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
