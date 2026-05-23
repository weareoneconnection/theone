'use client';

import { useMemo, useState } from 'react';
import { AppMemoryRecall } from '@/components/theone/AppMemoryRecall';
import { ProductEmpty, ProductPage, ProductStatusStrip, friendlyStatus } from '@/components/theone/ProductNav';

const reportTypes = [
  'Useful findings',
  'Product positioning',
  'Risk check',
  'SEO snapshot',
  'Investor-style summary',
];

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function resultMessage(result: any) {
  if (result?.appResult?.summary) return result.appResult.summary;
  const error = String(result?.error || '');
  if (/database|prisma|neon/i.test(error)) {
    return 'TheOne used safe mode because the memory database is temporarily unavailable. The website task can still run.';
  }
  if (error) return error;

  const execution = [...(result?.executions || [])]
    .reverse()
    .find((item: any) => item.provider === 'oneclaw');
  if (execution?.summary) {
    return execution.externalId ? `${execution.summary} Task: ${execution.externalId}.` : execution.summary;
  }

  return result?.summary || 'The website analysis has been prepared.';
}

function nextSteps(result: any) {
  if (!result) return ['Enter a website URL', 'Choose what kind of summary you want', 'Start analysis'];
  const blocked = result?.os?.workflow?.status === 'blocked' || result?.error;
  if (blocked) return ['Check the connection in Settings', 'Try again in Assist mode', 'Open Advanced Console for trace details'];
  return ['Review the summary', 'Save the useful points', 'Turn the findings into a post or report'];
}

function completedSteps(result: any) {
  const steps = result?.plan?.steps || result?.os?.workflow?.steps || [];
  return steps.filter((step: any) => step.status === 'completed').length;
}

function totalSteps(result: any) {
  return (result?.plan?.steps || result?.os?.workflow?.steps || []).length;
}

export default function WebAppPage() {
  const [url, setUrl] = useState('weareoneconnection.org');
  const [reportType, setReportType] = useState(reportTypes[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const status = loading ? 'running' : result?.os?.workflow?.status || (result ? 'completed' : 'ready');
  const preparedUrl = useMemo(() => normalizeUrl(url), [url]);

  async function analyze() {
    if (!preparedUrl) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/apps/web/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: preparedUrl,
          focus: reportType,
          mode: 'assist',
          language: 'en',
        }),
      });
      const json = await res.json();
      setResult(json);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'The website analysis could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProductPage
      eyebrow="Website App"
      title="Web analysis workspace"
      subtitle="Analyze a public website, extract the useful findings, and turn them into a next action without exposing the operating trace."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'State', value: friendlyStatus(status), tone: status },
            { label: 'Mode', value: 'assist', tone: 'assist' },
            { label: 'Output', value: reportType },
          ]}
        />
      )}
    >
      <section className="app-workflow-band" aria-label="Web analysis flow">
        <div>
          <span>1</span>
          <strong>Give a URL</strong>
          <p>The app collects the website and the type of insight you want.</p>
        </div>
        <div>
          <span>2</span>
          <strong>TheOne routes it</strong>
          <p>Policy checks the task and OneClaw prepares the browser extraction.</p>
        </div>
        <div>
          <span>3</span>
          <strong>Use the result</strong>
          <p>Review the plain summary, proof, and next action instead of raw logs.</p>
        </div>
      </section>

      <section className="app-workspace">
        <div className="app-input-panel">
          <div>
            <h2 className="panel-title">Website Brief</h2>
            <p className="panel-subtitle">Tell TheOne what to inspect. The advanced OS details stay in the background.</p>
          </div>

          <label className="app-field">
            <span>Website</span>
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="example.com" />
          </label>

          <div className="app-field">
            <span>What should TheOne look for?</span>
            <div className="app-choice-grid">
              {reportTypes.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={reportType === item ? 'app-choice active' : 'app-choice'}
                  onClick={() => setReportType(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <button className="run-button" type="button" onClick={analyze} disabled={loading || !preparedUrl}>
            {loading ? 'Analyzing...' : 'Start Analysis'}
          </button>
        </div>

        <aside className="app-output-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Website Result</h2>
              <p className="panel-subtitle">A plain summary of what happened and what to do next.</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          {!result ? (
            <ProductEmpty title="Ready" detail="Start an analysis to see the website findings here." />
          ) : (
            <div className="app-readable-result">
              <strong>{resultMessage(result)}</strong>
              <div className="run-result-stats">
                <div>
                  <span>Steps</span>
                  <strong>{completedSteps(result)}/{totalSteps(result) || 4}</strong>
                </div>
                <div>
                  <span>Proof</span>
                  <strong>{result.proofCount ?? result.proof?.length ?? 1}</strong>
                </div>
                <div>
                  <span>Worker</span>
                  <strong>{result.appResult?.oneClawTaskId ? 'receipt' : 'ready'}</strong>
                </div>
              </div>
              <div className="app-next-list">
                {nextSteps(result).map((step) => (
                  <span key={step}>{step}</span>
                ))}
              </div>
              {result.appResult?.oneClawTaskId ? (
                <div className="run-route-card">
                  <span>OneClaw receipt</span>
                  <strong>{result.appResult.oneClawTaskId}</strong>
                  <p>{result.appResult.extractedTextLength || 0} characters captured for analysis.</p>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </section>

      <section className="app-system-strip">
        <div>
          <span>Intent</span>
          <strong>Normal user request</strong>
        </div>
        <div>
          <span>Policy</span>
          <strong>Safe browser task</strong>
        </div>
        <div>
          <span>Worker</span>
          <strong>OneClaw extraction</strong>
        </div>
        <div>
          <span>Proof</span>
          <strong>Run receipt and summary</strong>
        </div>
      </section>

      <AppMemoryRecall app="web" title="Web Memory" detail="Website findings TheOne can reuse for future analysis, reports, and content." />
    </ProductPage>
  );
}
