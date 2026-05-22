export function ApprovalPanel({
  result,
  loading,
  oneClawApprovals = [],
  onApprove,
  onReject,
  onApproveOneClaw,
  onRejectOneClaw,
  onSync,
}: {
  result: any;
  loading: boolean;
  oneClawApprovals?: any[];
  onApprove: (approvalId?: string, approveAll?: boolean) => void;
  onReject: (approvalId?: string, rejectAll?: boolean) => void;
  onApproveOneClaw: (approvalId: string) => void;
  onRejectOneClaw: (approvalId: string) => void;
  onSync: () => void;
}) {
  const approvals = result?.approvals || result?.os?.approvals || [];
  const pendingCount = approvals.filter((approval: any) => approval.required && approval.status === 'pending').length;
  const pendingOneClawCount = oneClawApprovals.filter((approval: any) => approval.status === 'pending').length;
  const oneclawExecution = (result?.executions || result?.os?.executions || [])
    .slice()
    .reverse()
    .find((execution: any) => execution.provider === 'oneclaw' && execution.externalId);

  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Approval Gates</h2>
          <p className="panel-subtitle">Approve TheOne gates and live OneClaw execution gates from one control plane.</p>
        </div>
        <span className="panel-count">{pendingOneClawCount} live</span>
      </div>
      <div className="approval-toolbar">
        <button
          className="mini-action"
          type="button"
          disabled={!result?.runId || pendingCount === 0 || loading}
          onClick={() => onApprove(undefined, true)}
        >
          Approve & Run
        </button>
        <button
          className="mini-action danger"
          type="button"
          disabled={!result?.runId || pendingCount === 0 || loading}
          onClick={() => onReject(undefined, true)}
        >
          Reject All
        </button>
        <button
          className="mini-action"
          type="button"
          disabled={!oneclawExecution || loading}
          onClick={onSync}
        >
          Sync
        </button>
      </div>
      <div className="approval-list">
        {oneClawApprovals.length > 0 ? (
          <>
            <div className="approval-section-label">OneClaw Live Queue</div>
            {oneClawApprovals.map((approval: any) => (
              <div key={`oneclaw-${approval.id}`} className="approval-item approval-live">
                <div className="feed-head">
                  <div className="feed-title">{approval.action}</div>
                  <span className="risk-chip risk-high">live</span>
                </div>
                <div className="proof-meta">
                  {approval.status} · {approval.reason}
                </div>
                <div className="approval-context">
                  <span>{approval.taskId}</span>
                  <span>{approval.stepId}</span>
                </div>
                {approval.input ? (
                  <pre className="approval-json">{JSON.stringify(approval.input, null, 2)}</pre>
                ) : null}
                {approval.status === 'pending' ? (
                  <div className="approval-actions">
                    <button
                      className="mini-action"
                      type="button"
                      disabled={loading}
                      onClick={() => onApproveOneClaw(approval.id)}
                    >
                      Approve Live
                    </button>
                    <button
                      className="mini-action danger"
                      type="button"
                      disabled={loading}
                      onClick={() => onRejectOneClaw(approval.id)}
                    >
                      Reject Live
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </>
        ) : null}

        {approvals.length === 0 && oneClawApprovals.length === 0 ? (
          <div className="approval-item">
            <div className="feed-title">No approval gates yet.</div>
            <div className="proof-meta">Risk policy appears after TheOne builds a workflow.</div>
          </div>
        ) : (
          <>
            {approvals.length > 0 ? <div className="approval-section-label">TheOne Run Gates</div> : null}
            {approvals.map((approval: any) => (
              <div key={approval.id} className="approval-item">
                <div className="feed-head">
                  <div className="feed-title">{approval.action}</div>
                  <span className={`risk-chip risk-${approval.risk}`}>{approval.risk}</span>
                </div>
                <div className="proof-meta">
                  {approval.status} · {approval.reason}
                </div>
                {approval.status === 'pending' ? (
                  <div className="approval-actions">
                    <button
                      className="mini-action"
                      type="button"
                      disabled={loading}
                      onClick={() => onApprove(approval.id, false)}
                    >
                      Approve
                    </button>
                    <button
                      className="mini-action danger"
                      type="button"
                      disabled={loading}
                      onClick={() => onReject(approval.id, false)}
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
