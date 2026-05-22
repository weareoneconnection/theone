import { StatusPill } from './StatusPill';

export function PermissionPanel({ result }: { result: any }) {
  const permissions = result?.permissions || result?.os?.permissions || [];
  const summary = result?.contextFrame?.summary?.permissionSummary
    || result?.os?.contextFrame?.summary?.permissionSummary;

  return (
    <section className="panel-card">
      <h2 className="panel-title">Permission Model</h2>
      <div className="mini-kpis small">
        <div className="kpi-tile">
          <div className="kpi-label">Allowed</div>
          <div className="kpi-value">{summary?.allowed ?? 0}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Approval</div>
          <div className="kpi-value">{summary?.requiresApproval ?? 0}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Denied</div>
          <div className="kpi-value">{summary?.denied ?? 0}</div>
        </div>
      </div>
      <div className="approval-list">
        {permissions.length === 0 ? (
          <div className="approval-item">
            <div className="feed-title">No permission decisions yet.</div>
            <div className="proof-meta">TheOne will evaluate connector, memory, and action scopes.</div>
          </div>
        ) : (
          permissions.slice(0, 8).map((permission: any) => (
            <div key={permission.id} className="approval-item">
              <div className="feed-head">
                <div className="feed-title">{permission.scope}</div>
                <StatusPill status={permission.status} />
              </div>
              <div className="proof-meta">
                {permission.provider} · {permission.resourceKind} · {permission.risk} · {permission.reason}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
