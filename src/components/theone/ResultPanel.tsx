import { StatusPill } from './StatusPill';
import { derivedRunStatus, executionDiagnostic } from './runDiagnostics';
import { getOneClawSignal } from './oneClawSignals';

export function ResultPanel({ result }: { result: any }) {
  const executions = result?.executions || result?.os?.executions || [];
  const pendingTask = result?.pendingOneClawTask
    || result?.oneclawTask
    || result?.execution?.agentResults?.find((item: any) => item?.oneclawTask)?.oneclawTask;
  const taskPolicy = pendingTask?.metadata?.theoneTask?.automationPolicy;
  const taskRisk = pendingTask?.metadata?.theoneTask?.risk;
  const status = derivedRunStatus(result);
  const liveTask = result?.oneClawTaskResult?.task
    || result?.oneClawActionResult?.result?.task
    || result?.oneClawActionResult?.result
    || result?.oneClawApprovalResult?.result?.task;
  const liveStep = Array.isArray(liveTask?.steps) ? liveTask.steps.find((step: any) => step?.output?.response?.html_url || step?.output?.receipt) : null;
  const liveResultUrl = liveStep?.output?.response?.html_url || liveTask?.response?.html_url || '';
  const liveSignal = getOneClawSignal(liveTask);
  const executionError = executions
    .map((execution: any) => execution.status === 'failed' ? executionDiagnostic(execution) : '')
    .find(Boolean);
  const pendingApprovals = (result?.approvals || []).filter((approval: any) => approval.required && approval.status === 'pending').length;
  const permissionSummary = result?.contextFrame?.summary?.permissionSummary
    || result?.os?.contextFrame?.summary?.permissionSummary
    || { denied: 0 };

  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Run Result</h2>
          <p className="panel-subtitle">{result?.intent?.objective || 'Standing by for an objective.'}</p>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="result-grid">
        <div className="info-tile">
          <div className="info-label">Run ID</div>
          <div className="info-value">{result?.runId || '-'}</div>
        </div>
        <div className="info-tile">
          <div className="info-label">Completed</div>
          <div className="info-value">{String(result?.execution?.completedSteps ?? '-')}</div>
        </div>
        <div className="info-tile">
          <div className="info-label">Executions</div>
          <div className="info-value">{String(executions.length || '-')}</div>
        </div>
        <div className="info-tile">
          <div className="info-label">Approvals</div>
          <div className="info-value">{String(pendingApprovals)}</div>
        </div>
        <div className="info-tile">
          <div className="info-label">Denied</div>
          <div className="info-value">{String(permissionSummary.denied || 0)}</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <ResultRow label="Risk" value={result?.plan?.estimatedRisk || '-'} />
        {taskPolicy ? <ResultRow label="Automation" value={`${taskPolicy.approvalMode || '-'} · ${taskPolicy.canAutoRun ? 'auto runnable' : 'approval gated'}`} /> : null}
        {taskRisk ? <ResultRow label="Task Risk" value={`${taskRisk.level || '-'} · ${(taskRisk.reasons || []).slice(0, 1).join('')}`} /> : null}
        <ResultRow label="Architecture" value={result?.os?.architecture || '-'} />
        {liveTask?.id ? <ResultRow label="OneClaw Task" value={`${liveTask.id} · ${liveTask.status}`} /> : null}
        {liveSignal ? <ResultRow label="X Signal" value={`${liveSignal.title} · ${liveSignal.retryable ? 'retry later' : 'do not retry'}`} /> : null}
        {liveResultUrl ? <ResultLink label="External Result" href={liveResultUrl} /> : null}
        <ResultRow label="OK" value={String(result?.ok ?? '-')} />
        {executionError ? <div className="error-box">{executionError}</div> : null}
        {result?.error ? <div className="error-box">{result.error}</div> : null}
      </div>
    </section>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="result-row">
      <div className="result-key">{label}</div>
      <div className="result-value">{value}</div>
    </div>
  );
}

function ResultLink({ label, href }: { label: string; href: string }) {
  return (
    <div className="result-row">
      <div className="result-key">{label}</div>
      <a className="result-value result-link" href={href} target="_blank" rel="noreferrer">
        Open
      </a>
    </div>
  );
}
