'use client';

import { useMemo, useState } from 'react';
import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const focusTypes = [
  'CI health',
  'Repo overview',
  'Release readiness',
  'Issue follow-up',
  'Risk check',
];

function normalizeRepo(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

function resultMessage(result: any) {
  if (result?.appResult?.summary) return result.appResult.summary;
  const error = String(result?.error || '');
  if (/checks|403|permission|token/i.test(error)) {
    return 'The repository was inspected where token permissions allowed it. GitHub checks may need extra token scope, while repository and Actions reads can still be useful.';
  }
  if (error) return error;
  return result?.summary || 'The GitHub workflow analysis has been prepared.';
}

function nextSteps(result: any) {
  if (!result) return ['Enter a repository', 'Choose the kind of review', 'Start analysis'];
  if (result?.appResult?.degraded) {
    return ['Review the partial result', 'Check GitHub token scopes if checks are needed', 'Create a follow-up issue only after approval'];
  }
  return ['Review repository health', 'Check failed or missing workflow runs', 'Prepare an approved issue if follow-up is needed'];
}

function completedSteps(result: any) {
  const steps = result?.plan?.steps || result?.os?.workflow?.steps || [];
  return steps.filter((step: any) => step.status === 'completed').length;
}

function totalSteps(result: any) {
  return (result?.plan?.steps || result?.os?.workflow?.steps || []).length;
}

export default function GitHubAppPage() {
  const [repo, setRepo] = useState('weareoneconnection/oneaitradingbot');
  const [branch, setBranch] = useState('main');
  const [focus, setFocus] = useState(focusTypes[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const normalizedRepo = useMemo(() => normalizeRepo(repo), [repo]);
  const status = loading ? 'running' : result?.appResult?.status || result?.os?.workflow?.status || (result ? 'completed' : 'ready');

  async function analyze() {
    if (!normalizedRepo) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/apps/github/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: normalizedRepo,
          branch,
          focus,
          mode: 'assist',
          language: 'en',
        }),
      });
      const json = await res.json();
      setResult(json);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'The GitHub analysis could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="GitHub App"
      title="Repository workflow workspace"
      subtitle="Inspect a repository, read workflow runs, turn raw GitHub signals into a plain next action, and keep write actions approval-gated."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'State', value: friendlyStatus(status), tone: status },
            { label: 'Reads', value: 'auto', tone: 'online' },
            { label: 'Writes', value: 'approval', tone: 'manual' },
          ]}
        />
      )}
    >
      <section className="app-workflow-band" aria-label="GitHub workflow flow">
        <div>
          <span>1</span>
          <strong>Give a repo</strong>
          <p>The app collects the repository, branch, and review objective.</p>
        </div>
        <div>
          <span>2</span>
          <strong>TheOne inspects it</strong>
          <p>OneClaw reads GitHub metadata and Actions runs under policy control.</p>
        </div>
        <div>
          <span>3</span>
          <strong>Use the decision</strong>
          <p>OneAI turns the raw signals into health, risks, and a next move.</p>
        </div>
      </section>

      <section className="app-workspace">
        <div className="app-input-panel">
          <div>
            <h2 className="panel-title">Repository Brief</h2>
            <p className="panel-subtitle">TheOne handles the GitHub worker details and returns an operator-readable status.</p>
          </div>

          <label className="app-field">
            <span>Repository</span>
            <input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="owner/repo" />
          </label>

          <label className="app-field">
            <span>Branch or ref</span>
            <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" />
          </label>

          <div className="app-field">
            <span>What should TheOne check?</span>
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

          <button className="run-button" type="button" onClick={analyze} disabled={loading || !normalizedRepo}>
            {loading ? 'Inspecting...' : 'Analyze Repository'}
          </button>
        </div>

        <aside className="app-output-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">GitHub Result</h2>
              <p className="panel-subtitle">A plain summary of repo health, CI signals, and next action.</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          {!result ? (
            <ProductEmpty title="Ready" detail="Start an analysis to see repository health here." />
          ) : (
            <div className="app-readable-result">
              <strong>{resultMessage(result)}</strong>
              <div className="run-result-stats">
                <div>
                  <span>Steps</span>
                  <strong>{completedSteps(result)}/{totalSteps(result) || 6}</strong>
                </div>
                <div>
                  <span>Runs</span>
                  <strong>{result.appResult?.actionsRunCount ?? 0}</strong>
                </div>
                <div>
                  <span>Proof</span>
                  <strong>{result.proofCount ?? result.proof?.length ?? 1}</strong>
                </div>
              </div>
              <div className="app-next-list">
                {nextSteps(result).map((step) => (
                  <span key={step}>{step}</span>
                ))}
              </div>
              {result.appResult ? (
                <div className="run-route-card">
                  <span>OneClaw receipts</span>
                  <strong>{result.appResult.repo}</strong>
                  <p>
                    repo {result.appResult.oneClawTaskIds?.repo || 'n/a'} · runs {result.appResult.oneClawTaskIds?.runs || 'n/a'} · checks {result.appResult.oneClawTaskIds?.checks || 'n/a'}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </section>

      <section className="app-system-strip">
        <div>
          <span>Intent</span>
          <strong>Repository review</strong>
        </div>
        <div>
          <span>Policy</span>
          <strong>Read-only by default</strong>
        </div>
        <div>
          <span>Worker</span>
          <strong>OneClaw GitHub</strong>
        </div>
        <div>
          <span>Writes</span>
          <strong>Approval gated</strong>
        </div>
      </section>

      <AppMemoryRecall app="github" title="GitHub Memory" detail="Repository health notes and workflow signals TheOne can recall later." />
    </ProductPage>
  );
}
