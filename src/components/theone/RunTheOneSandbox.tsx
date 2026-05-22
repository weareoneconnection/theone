import { useMemo } from 'react';
import { getOneClawSignal } from './oneClawSignals';

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compact(value: unknown, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function findOneClawTask(result: any, oneClawTasks: any[]) {
  return result?.oneClawTaskResult?.task
    || result?.oneClawActionResult?.result?.task
    || result?.oneClawActionResult?.result
    || result?.oneClawApprovalResult?.result?.task
    || oneClawTasks[0];
}

function buildTrace(result: any, providerChecks: any[], oneClawTasks: any[], loading: boolean) {
  const providers = result?.os?.providers || [];
  const oneAi = providers.find((item: any) => item.key === 'oneai') || providerChecks.find((item: any) => item.key === 'oneai');
  const oneClaw = providers.find((item: any) => item.key === 'oneclaw') || providerChecks.find((item: any) => item.key === 'oneclaw');
  const executions = result?.executions || result?.os?.executions || [];
  const approvals = result?.approvals || result?.os?.approvals || [];
  const oneClawTask = findOneClawTask(result, oneClawTasks);
  const signal = getOneClawSignal(oneClawTask);

  return [
    {
      phase: '01 Intent',
      actor: 'TheOne Kernel',
      status: loading ? 'running' : result?.intent ? 'completed' : 'ready',
      title: result?.intent?.objective || 'Waiting for Run TheOne',
      detail: `${compact(result?.intent?.type, 'general')} · confidence ${compact(result?.intent?.confidence)}`,
      code: {
        objective: result?.intent?.objective || null,
        route: result?.plan?.capabilityRoute?.capabilities || [],
      },
    },
    {
      phase: '02 OneAI',
      actor: 'Planning Driver',
      status: loading ? 'running' : oneAi?.mode || oneAi?.status || 'standby',
      title: 'Plan, classify, and prepare execution',
      detail: `${compact(oneAi?.baseUrl, 'OneAI endpoint')} · ${compact(oneAi?.status || oneAi?.mode, 'ready')}`,
      code: executions.filter((item: any) => item.provider === 'oneai').slice(-2),
    },
    {
      phase: '03 Permission',
      actor: 'Policy Model',
      status: approvals.some((item: any) => item.status === 'pending') ? 'awaiting_approval' : result ? 'completed' : 'ready',
      title: `${approvals.length} approval gate(s)`,
      detail: approvals.length ? approvals.map((item: any) => `${item.action}:${item.status}`).join(' · ') : 'No approval required yet',
      code: approvals,
    },
    {
      phase: '04 OneClaw',
      actor: 'Execution Driver',
      status: oneClawTask?.status || oneClaw?.mode || oneClaw?.status || 'standby',
      title: oneClawTask?.taskName || 'External task runtime',
      detail: oneClawTask?.id
        ? `${oneClawTask.id} · ${(oneClawTask.steps || []).length} step(s)`
        : `${compact(oneClaw?.baseUrl, 'OneClaw endpoint')} · ${compact(oneClaw?.status || oneClaw?.mode, 'ready')}`,
      code: oneClawTask || executions.filter((item: any) => item.provider === 'oneclaw').slice(-2),
      signal,
    },
    {
      phase: '05 Proof',
      actor: 'TheOne Ledger',
      status: result?.proof?.length ? 'completed' : result ? 'ready' : 'standby',
      title: `${result?.proof?.length || 0} proof record(s)`,
      detail: result?.proof?.[0]?.value || 'Receipts appear after OneAI or OneClaw execution',
      code: (result?.proof || []).slice(0, 3),
    },
  ];
}

export function RunTheOneSandbox({
  result,
  loading,
  providerChecks,
  oneClawTasks,
}: {
  result: any;
  loading: boolean;
  providerChecks: any[];
  oneClawTasks: any[];
}) {
  const trace = useMemo(
    () => buildTrace(result, providerChecks, oneClawTasks, loading),
    [result, providerChecks, oneClawTasks, loading],
  );

  return (
    <section className="run-sandbox panel-card">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Execution Sandbox</h2>
          <p className="panel-subtitle">Live trace of OneAI planning and OneClaw execution after Run TheOne.</p>
        </div>
        <span className={`status-pill status-${loading ? 'running' : result ? 'completed' : 'ready'}`}>
          {loading ? 'running' : result ? 'ready' : 'standby'}
        </span>
      </div>
      <div className="sandbox-trace inline">
        {trace.map((item) => (
          <div key={item.phase} className="sandbox-step">
            <div className="sandbox-step-head">
              <div>
                <div className="sandbox-phase">{item.phase}</div>
                <div className="sandbox-title">{item.title}</div>
              </div>
              <span className={`status-pill status-${String(item.status).toLowerCase()}`}>{item.status}</span>
            </div>
            <div className="proof-meta">{item.actor} · {item.detail}</div>
            {item.signal ? (
              <div className={`signal-box signal-${item.signal.tone}`}>
                <div className="signal-title">{item.signal.title}</div>
                <div className="signal-detail">{item.signal.detail}</div>
              </div>
            ) : null}
            <pre className="sandbox-code">{safeJson(item.code)}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}
