'use client';

import { useState } from 'react';
import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const focusTypes = [
  'Understand architecture',
  'Plan a feature',
  'Fix a bug',
  'Prepare patch',
  'Review risk',
];

function resultMessage(result: any) {
  if (result?.appResult?.summary) return result.appResult.summary;
  if (result?.error) return String(result.error);
  return 'The code workflow is ready.';
}

function statusFor(result: any, loading: boolean) {
  if (loading) return 'running';
  return result?.appResult?.status || result?.os?.workflow?.status || (result ? 'completed' : 'ready');
}

export default function CodeAppPage() {
  const [workspacePath, setWorkspacePath] = useState('');
  const [objective, setObjective] = useState('Improve the Run chat page without breaking existing APIs.');
  const [focus, setFocus] = useState(focusTypes[3]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const status = statusFor(result, loading);

  async function runCodeWorkflow() {
    if (!objective.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/apps/code/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspacePath.trim() || undefined,
          objective,
          focus,
          mode: 'assist',
          language: 'en',
        }),
      });
      const json = await res.json();
      setResult(json);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'The code workflow could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="Code App"
      title="Code workspace"
      subtitle="Read a repository, understand the architecture, plan a safe change, and prepare patch drafts before any write happens."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'State', value: friendlyStatus(status), tone: status },
            { label: 'Stages', value: '1-5', tone: 'online' },
            { label: 'Writes', value: 'gated', tone: 'manual' },
          ]}
        />
      )}
    >
      <section className="app-workflow-band" aria-label="Code workflow stages">
        <div>
          <span>1</span>
          <strong>Read the codebase</strong>
          <p>TheOne scans bounded source files, package scripts, and likely architecture entry points.</p>
        </div>
        <div>
          <span>2</span>
          <strong>Plan the change</strong>
          <p>OneAI and TheOne turn the objective into a scoped implementation route.</p>
        </div>
        <div>
          <span>3</span>
          <strong>Draft the patch</strong>
          <p>TheOne prepares patch-level guidance without applying file writes.</p>
        </div>
        <div>
          <span>4</span>
          <strong>Gate implementation</strong>
          <p>File writes, rollback, and review checklist are packaged for approval.</p>
        </div>
        <div>
          <span>5</span>
          <strong>Validate and deliver</strong>
          <p>Build, test, commit, and PR delivery stay gated until approved.</p>
        </div>
      </section>

      <section className="app-workspace">
        <div className="app-input-panel">
          <div>
            <h2 className="panel-title">Code Brief</h2>
            <p className="panel-subtitle">Stages 1-5 are safe by design: read, plan, draft, gate implementation, then validate and package delivery.</p>
          </div>

          <label className="app-field">
            <span>Workspace path</span>
            <input
              value={workspacePath}
              onChange={(event) => setWorkspacePath(event.target.value)}
              placeholder="Leave blank to use the current TheOne project"
            />
          </label>

          <label className="app-field">
            <span>Outcome</span>
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Tell TheOne what code outcome you want."
              rows={5}
            />
          </label>

          <div className="app-field">
            <span>Focus</span>
            <div className="app-choice-grid">
              {focusTypes.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={focus === item ? 'app-choice active' : 'app-choice'}
                  onClick={() => setFocus(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <button className="run-button" type="button" onClick={runCodeWorkflow} disabled={loading || !objective.trim()}>
            {loading ? 'Preparing...' : 'Prepare Code Workflow'}
          </button>
        </div>

        <aside className="app-output-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Code Result</h2>
              <p className="panel-subtitle">Readable architecture notes, implementation route, patch targets, and validation.</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          {!result ? (
            <ProductEmpty title="Ready" detail="Start a code workflow to see the plan and patch draft here." />
          ) : (
            <div className="app-readable-result">
              <strong>{resultMessage(result)}</strong>
              <div className="run-result-stats">
                <div>
                  <span>Files</span>
                  <strong>{result.appResult?.scannedFiles ?? 0}</strong>
                </div>
                <div>
                  <span>Targets</span>
                  <strong>{result.appResult?.relevantFiles?.length ?? 0}</strong>
                </div>
                <div>
                  <span>Drafts</span>
                  <strong>{result.appResult?.patchDrafts?.length ?? 0}</strong>
                </div>
                <div>
                  <span>Gates</span>
                  <strong>{result.appResult?.approvalGates?.length ?? 0}</strong>
                </div>
              </div>

              {result.appResult ? (
                <>
                  <div className="run-route-card">
                    <span>Workspace</span>
                    <strong>{result.appResult.projectName} · {result.appResult.framework}</strong>
                    <p>{(result.appResult.techStack || []).join(' · ') || 'No dominant stack detected'}</p>
                  </div>

                  <div className="app-next-list">
                    {(result.appResult.implementationPlan || []).map((step: string) => (
                      <span key={step}>{step}</span>
                    ))}
                  </div>

                  {(result.appResult.patchDrafts || []).map((draft: any) => (
                    <div className="run-route-card" key={draft.file}>
                      <span>Patch draft · {draft.risk} risk</span>
                      <strong>{draft.file}</strong>
                      <p>{draft.intent}</p>
                      <p>{(draft.suggestedChanges || []).join(' ')}</p>
                    </div>
                  ))}

                  {result.appResult.implementationPackage ? (
                    <div className="run-route-card">
                      <span>Stage 4 · approval required</span>
                      <strong>Implementation package</strong>
                      <p>{(result.appResult.implementationPackage.filesToChange || []).join(' · ') || 'No exact file target selected yet'}</p>
                      <div className="app-next-list compact-list">
                        {(result.appResult.implementationPackage.reviewChecklist || []).map((item: string) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {result.appResult.validationPlan ? (
                    <div className="run-route-card">
                      <span>Stage 5 · manual validation</span>
                      <strong>Validation runbook</strong>
                      <div className="app-next-list compact-list">
                        {(result.appResult.validationPlan.commands || []).map((item: any) => (
                          <span key={item.command}>{item.command} · {item.reason}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {result.appResult.deliveryPackage ? (
                    <div className="run-route-card">
                      <span>Stage 5 · delivery package</span>
                      <strong>{result.appResult.deliveryPackage.prTitle}</strong>
                      <p>Branch: {result.appResult.deliveryPackage.branchName}</p>
                      <p>Commit: {result.appResult.deliveryPackage.commitMessage}</p>
                      <div className="app-next-list compact-list">
                        {(result.appResult.deliveryPackage.proofRequired || []).map((item: string) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </aside>
      </section>

      <section className="app-system-strip">
        <div>
          <span>Stage 1</span>
          <strong>Read code</strong>
        </div>
        <div>
          <span>Stage 2</span>
          <strong>Plan change</strong>
        </div>
        <div>
          <span>Stage 3</span>
          <strong>Patch draft</strong>
        </div>
        <div>
          <span>Stage 4</span>
          <strong>Apply gated</strong>
        </div>
        <div>
          <span>Stage 5</span>
          <strong>Validate + PR</strong>
        </div>
      </section>

      <AppMemoryRecall app="code" title="Code Memory" detail="Architecture notes and patch planning signals TheOne can recall later." />
    </ProductPage>
  );
}
