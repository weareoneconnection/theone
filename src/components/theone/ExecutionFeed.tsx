import { StatusPill } from './StatusPill';
import { executionDiagnostic } from './runDiagnostics';

export function ExecutionFeed({ result }: { result: any }) {
  const steps = result?.os?.workflow?.steps || result?.plan?.steps || [];
  const executions = result?.executions || result?.os?.executions || [];

  function stepDiagnostic(step: any) {
    if (step?.error) return step.error;
    if (step?.action !== 'oneclaw.execute') return '';
    const oneclaw = [...executions].reverse().find((execution: any) => execution.provider === 'oneclaw');
    return oneclaw?.status === 'failed' ? executionDiagnostic(oneclaw) : '';
  }

  return (
    <section className="panel-card">
      <h2 className="panel-title">Workflow Runtime</h2>
      <div className="feed-list">
        {steps.length === 0 ? (
          <div className="feed-item">
            <div className="feed-title">No execution yet.</div>
            <div className="feed-meta">Run TheOne to generate a governed workflow trace.</div>
          </div>
        ) : (
          steps.map((step: any) => {
            const diagnostic = stepDiagnostic(step);

            return (
              <div key={step.id} className="feed-item">
                <div className="feed-head">
                  <div className="feed-title">{step.title}</div>
                  <StatusPill status={step.status} />
                </div>
                <div className="feed-meta">
                  {step.provider || 'theone'} · {step.action} · {step.capability || 'system'} · {step.skillKey || 'kernel'}
                  {Array.isArray(step.dependsOn) && step.dependsOn.length > 0 ? ` · depends on ${step.dependsOn.join(', ')}` : ''}
                </div>
                {diagnostic ? <div className="inline-error">{diagnostic}</div> : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
