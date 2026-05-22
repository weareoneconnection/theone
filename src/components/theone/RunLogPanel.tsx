import { StatusPill } from './StatusPill';
import { derivedRunStatus, executionDiagnostic } from './runDiagnostics';
import { getOneClawSignal } from './oneClawSignals';

type LogEntry = {
  id: string;
  phase: string;
  title: string;
  detail: string;
  provider: string;
  status: string;
  meta?: string;
};

function statusForResult(result: any) {
  return derivedRunStatus(result);
}

function compactList(items: unknown[], limit = 4) {
  return items
    .slice(0, limit)
    .map((item) => String(item))
    .filter(Boolean)
    .join(' · ');
}

function taskAdapterLabel(execution: any) {
  const raw = execution?.raw?.raw || execution?.raw || {};
  const requested = raw.requestedTask || raw.payload?.type;
  const upstream = raw.upstreamTask || raw.request?.type;
  if (!requested && !upstream) return '';
  if (!upstream || requested === upstream) return String(requested || upstream);
  return `${requested} -> ${upstream}`;
}

function buildLogs(result: any, loading: boolean): LogEntry[] {
  if (loading && !result) {
    return [
      {
        id: 'live-queued',
        phase: 'Request',
        title: 'Run request accepted',
        detail: 'TheOne is classifying intent and preparing the governed context frame.',
        provider: 'theone',
        status: 'running',
      },
      {
        id: 'live-policy',
        phase: 'Govern',
        title: 'Policy and permissions are being evaluated',
        detail: 'TheOne checks context, memory, connector scope, and approval gates before provider execution.',
        provider: 'theone',
        status: 'running',
      },
      {
        id: 'live-provider',
        phase: 'Providers',
        title: 'Provider route is being prepared',
        detail: 'OneAI receives adapted tasks; OneClaw is only reached when execution planning requires it.',
        provider: 'oneai',
        status: 'running',
      },
    ];
  }

  if (!result) return [];

  const logs: LogEntry[] = [];
  const workflow = result?.os?.workflow;
  const steps = workflow?.steps || result?.plan?.steps || [];
  const executions = result?.executions || result?.os?.executions || [];
  const approvals = result?.approvals || result?.os?.approvals || [];
  const proof = result?.proof || [];
  const pendingTask = result?.pendingOneClawTask
    || result?.oneclawTask
    || result?.execution?.agentResults?.find((item: any) => item?.oneclawTask)?.oneclawTask;
  const automationPolicy = pendingTask?.metadata?.theoneTask?.automationPolicy;
  const taskRisk = pendingTask?.metadata?.theoneTask?.risk;
  const memory = result?.memoryContext || result?.plan?.memoryContext || [];
  const frame = result?.contextFrame || result?.os?.contextFrame;
  const permissions = result?.permissions || result?.os?.permissions || [];
  const capabilities = result?.plan?.capabilityRoute?.capabilities || [];
  const connectors = result?.plan?.capabilityRoute?.connectors || [];
  const liveTasks = [
    ...(result?.oneClawTasks || []),
    result?.oneClawTaskResult?.task,
    result?.oneClawActionResult?.result?.task || result?.oneClawActionResult?.result,
    result?.oneClawApprovalResult?.result?.task,
  ].filter(Boolean);

  logs.push({
    id: 'intent',
    phase: 'Intent',
    title: result?.intent?.objective || 'Objective received',
    detail: `${result?.intent?.type || 'general'} intent · confidence ${result?.intent?.confidence ?? '-'}`,
    provider: 'theone',
    status: result?.intent ? 'completed' : statusForResult(result),
  });

  logs.push({
    id: 'context',
    phase: 'Context Bus',
    title: 'Context frame assembled',
    detail: `${frame?.summary?.resourceCount || 0} resources · ${frame?.summary?.connectorCount || connectors.length || 0} connectors · ${frame?.summary?.memoryHitCount || memory.length || 0} memory hits`,
    provider: 'theone',
    status: frame ? 'completed' : statusForResult(result),
    meta: compactList(capabilities),
  });

  logs.push({
    id: 'permission',
    phase: 'Permission',
    title: 'Permission model evaluated',
    detail: `${frame?.summary?.permissionSummary?.allowed || 0} allowed · ${frame?.summary?.permissionSummary?.requiresApproval || 0} approval · ${frame?.summary?.permissionSummary?.denied || 0} denied`,
    provider: 'theone',
    status: permissions.some((item: any) => item.status === 'denied') ? 'denied' : 'completed',
  });

  if (automationPolicy || taskRisk) {
    logs.push({
      id: 'automation-policy',
      phase: 'Automation',
      title: automationPolicy?.canAutoRun ? 'Task is eligible for automatic execution' : 'Task is approval gated',
      detail: [
        automationPolicy?.approvalMode ? `mode ${automationPolicy.approvalMode}` : '',
        taskRisk?.level ? `risk ${taskRisk.level}` : '',
        Array.isArray(taskRisk?.reasons) ? taskRisk.reasons[0] : '',
      ].filter(Boolean).join(' · '),
      provider: 'theone',
      status: automationPolicy?.canAutoRun ? 'completed' : 'blocked',
      meta: Array.isArray(automationPolicy?.safeguards) ? automationPolicy.safeguards[0] : undefined,
    });
  }

  steps.forEach((step: any, index: number) => {
    logs.push({
      id: `step-${step.id || index}`,
      phase: `Step ${index + 1}`,
      title: step.title || step.action || 'Workflow step',
      detail: `${step.action || 'custom'} · ${step.skillKey || 'kernel'} · ${step.capability || 'system'}`,
      provider: step.provider || (step.action === 'oneai.generate' ? 'oneai' : 'theone'),
      status: step.status || 'pending',
      meta: Array.isArray(step.dependsOn) && step.dependsOn.length ? `depends on ${step.dependsOn.join(', ')}` : undefined,
    });
  });

  executions.forEach((execution: any, index: number) => {
    const adapter = taskAdapterLabel(execution);
    const diagnostic = executionDiagnostic(execution);
    logs.push({
      id: `execution-${execution.id || index}`,
      phase: 'Execution',
      title: execution.summary || `${execution.provider || 'provider'} execution`,
      detail: [
        execution.provider || 'provider',
        execution.taskName,
        execution.externalId ? `external ${execution.externalId}` : '',
        adapter ? `task ${adapter}` : '',
      ].filter(Boolean).join(' · '),
      provider: execution.provider || 'theone',
      status: execution.status || 'completed',
      meta: diagnostic || undefined,
    });
  });

  liveTasks.forEach((task: any, index: number) => {
    const signal = getOneClawSignal(task);
    if (!signal) return;

    logs.push({
      id: `oneclaw-signal-${task.id || index}`,
      phase: 'OneClaw Signal',
      title: signal.title,
      detail: signal.detail,
      provider: 'oneclaw',
      status: signal.tone === 'blocked' ? 'blocked' : signal.tone,
      meta: `${signal.code} · ${signal.retryable ? 'retry later' : 'do not retry'}`,
    });
  });

  approvals.forEach((approval: any, index: number) => {
    logs.push({
      id: `approval-${approval.id || index}`,
      phase: 'Approval',
      title: approval.action || 'Approval gate',
      detail: `${approval.required ? 'required' : 'not required'} · ${approval.reason || 'policy evaluated'}`,
      provider: 'theone',
      status: approval.status || 'pending',
      meta: approval.risk ? `${approval.risk} risk` : undefined,
    });
  });

  proof.forEach((record: any, index: number) => {
    logs.push({
      id: `proof-${index}`,
      phase: 'Proof',
      title: record.title || 'Proof recorded',
      detail: record.value || `${record.type || 'system'} proof written`,
      provider: 'theone',
      status: 'completed',
      meta: record.timestamp ? new Date(record.timestamp).toLocaleString() : undefined,
    });
  });

  logs.push({
    id: 'memory',
    phase: 'Memory',
    title: 'Run memory committed',
    detail: `${memory.length || 0} recalled memories · ${result?.networkSignals?.events || 0} event bus events`,
    provider: 'theone',
    status: result.ok ? 'completed' : 'failed',
  });

  if (result.error) {
    logs.push({
      id: 'error',
      phase: 'Error',
      title: 'Run failed',
      detail: result.error,
      provider: 'theone',
      status: 'failed',
    });
  }

  return logs;
}

export function RunLogPanel({ result, loading }: { result: any; loading: boolean }) {
  const logs = buildLogs(result, loading);

  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Run Log</h2>
          <p className="panel-subtitle">Chronological trace across kernel, policy, providers, proof, and memory.</p>
        </div>
        <StatusPill status={loading ? 'running' : statusForResult(result)} />
      </div>
      <div className="run-log-list">
        {logs.length === 0 ? (
          <div className="feed-item">
            <div className="feed-title">No run log yet.</div>
            <div className="feed-meta">Run TheOne to capture the first operating trace.</div>
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={`run-log-item provider-${log.provider}`}>
              <div className="run-log-spine">
                <span className={`run-log-dot status-${log.status.toLowerCase()}`} />
              </div>
              <div className="run-log-content">
                <div className="run-log-head">
                  <div>
                    <div className="run-log-phase">{log.phase}</div>
                    <div className="run-log-title">{log.title}</div>
                  </div>
                  <StatusPill status={log.status} />
                </div>
                <div className="run-log-detail">{log.detail}</div>
                <div className="run-log-meta">
                  <span>{log.provider}</span>
                  {log.meta ? <span>{log.meta}</span> : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
