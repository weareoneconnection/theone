'use client';

import { useState } from 'react';
import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const goals = [
  'Prepare a high-signal X post',
  'Find reply opportunities',
  'Create a founder update',
  'Draft a product launch angle',
  'Summarize market conversation',
];

function resultMessage(result: any) {
  if (result?.appResult?.summary) return result.appResult.summary;
  const error = String(result?.error || '');
  if (/credits|402/i.test(error)) {
    return 'X API credits are not available for search right now. TheOne can still prepare a draft from the brief, but live market context is degraded.';
  }
  if (error) return error;
  return result?.summary || 'The X growth brief has been prepared.';
}

function nextSteps(result: any) {
  if (!result) return ['Enter a topic', 'Choose the growth goal', 'Prepare the brief'];
  if (result?.appResult?.degraded) return ['Review the draft', 'Check X API credits or credentials', 'Publish only after manual approval'];
  return ['Review the draft', 'Choose whether it should become a post or reply', 'Send publishing through approval'];
}

function completedSteps(result: any) {
  const steps = result?.plan?.steps || result?.os?.workflow?.steps || [];
  return steps.filter((step: any) => step.status === 'completed').length;
}

function totalSteps(result: any) {
  return (result?.plan?.steps || result?.os?.workflow?.steps || []).length;
}

export default function XAppPage() {
  const [topic, setTopic] = useState('AI agents workflow');
  const [goal, setGoal] = useState(goals[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const status = loading ? 'running' : result?.appResult?.status || result?.os?.workflow?.status || (result ? 'completed' : 'ready');

  async function prepare() {
    if (!topic.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/apps/x/growth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          goal,
          mode: 'assist',
          language: 'en',
        }),
      });
      const json = await res.json();
      setResult(json);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'The X growth workflow could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="X App"
      title="Content growth workspace"
      subtitle="Search X for context, prepare high-signal content, and keep all public publishing behind approval."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'State', value: friendlyStatus(status), tone: status },
            { label: 'Search', value: 'auto', tone: 'online' },
            { label: 'Publish', value: 'approval', tone: 'manual' },
          ]}
        />
      )}
    >
      <section className="app-workflow-band" aria-label="X growth flow">
        <div>
          <span>1</span>
          <strong>Give a topic</strong>
          <p>The app collects the audience, theme, and growth intent.</p>
        </div>
        <div>
          <span>2</span>
          <strong>TheOne researches</strong>
          <p>OneClaw searches X while TheOne blocks unsafe auto-publishing.</p>
        </div>
        <div>
          <span>3</span>
          <strong>Approve output</strong>
          <p>Use the draft as a post or reply only after the policy gate clears it.</p>
        </div>
      </section>

      <section className="app-workspace">
        <div className="app-input-panel">
          <div>
            <h2 className="panel-title">Growth Brief</h2>
            <p className="panel-subtitle">Prepare content with live context. Publishing remains a separate approval action.</p>
          </div>

          <label className="app-field">
            <span>Topic or search query</span>
            <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="AI agents workflow" />
          </label>

          <div className="app-field">
            <span>What should TheOne prepare?</span>
            <div className="app-choice-grid">
              {goals.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={goal === item ? 'app-choice active' : 'app-choice'}
                  onClick={() => setGoal(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <button className="run-button" type="button" onClick={prepare} disabled={loading || !topic.trim()}>
            {loading ? 'Preparing...' : 'Prepare Growth Brief'}
          </button>
        </div>

        <aside className="app-output-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">X Result</h2>
              <p className="panel-subtitle">A safe draft, market signals, and approval-aware next steps.</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          {!result ? (
            <ProductEmpty title="Ready" detail="Prepare a growth brief to see draft content here." />
          ) : (
            <div className="app-readable-result">
              <strong>{resultMessage(result)}</strong>
              <div className="run-result-stats">
                <div>
                  <span>Steps</span>
                  <strong>{completedSteps(result)}/{totalSteps(result) || 4}</strong>
                </div>
                <div>
                  <span>Candidates</span>
                  <strong>{result.appResult?.candidateCount ?? 0}</strong>
                </div>
                <div>
                  <span>Publish</span>
                  <strong>approval</strong>
                </div>
              </div>
              <div className="app-next-list">
                {nextSteps(result).map((step) => (
                  <span key={step}>{step}</span>
                ))}
              </div>
              {result.appResult?.searchTaskId ? (
                <div className="run-route-card">
                  <span>OneClaw receipt</span>
                  <strong>{result.appResult.searchTaskId}</strong>
                  <p>{result.appResult.candidateCount || 0} X candidate(s) used for context.</p>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </section>

      <section className="app-system-strip">
        <div>
          <span>Intent</span>
          <strong>Growth content</strong>
        </div>
        <div>
          <span>Policy</span>
          <strong>No auto-publish</strong>
        </div>
        <div>
          <span>Worker</span>
          <strong>OneClaw X search</strong>
        </div>
        <div>
          <span>Proof</span>
          <strong>Draft and receipt</strong>
        </div>
      </section>

      <AppMemoryRecall app="x" title="X Memory" detail="Growth drafts, market signals, and publishing cautions saved from prior runs." />
    </ProductPage>
  );
}
