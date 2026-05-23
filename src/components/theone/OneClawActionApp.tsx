'use client';

import { useMemo, useState } from 'react';
import { ProductEmpty, friendlyStatus } from './ProductNav';

export type ActionTemplate = {
  key: string;
  label: string;
  action: string;
  description: string;
  approvalMode?: 'auto' | 'manual';
  fields: Array<{
    key: string;
    label: string;
    placeholder?: string;
    multiline?: boolean;
    defaultValue?: string;
  }>;
  buildInput?: (values: Record<string, string>) => Record<string, unknown>;
};

function compactJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function outputSummary(result: any) {
  if (!result) return '';
  if (result.error) return String(result.error);
  const task = result.result || result;
  const status = task.status || task.task?.status || task.steps?.[0]?.status || 'submitted';
  const id = task.id || task.task?.id || task.steps?.[0]?.taskId || '';
  const receipt = task.steps?.[0]?.output?.receipt || task.task?.steps?.[0]?.output?.receipt;
  const actionStatus = task.steps?.[0]?.output?.status || receipt?.status;
  return [friendlyStatus(status), actionStatus, id ? `Task ${id}` : ''].filter(Boolean).join(' · ');
}

export function OneClawActionApp({
  templates,
  defaultTemplate,
  resultTitle,
}: {
  templates: ActionTemplate[];
  defaultTemplate: string;
  resultTitle: string;
}) {
  const [activeKey, setActiveKey] = useState(defaultTemplate);
  const active = templates.find((template) => template.key === activeKey) || templates[0];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const template of templates) {
      for (const field of template.fields) {
        if (field.defaultValue && !initial[field.key]) initial[field.key] = field.defaultValue;
      }
    }
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const inputPreview = useMemo(() => {
    const base = Object.fromEntries(active.fields.map((field) => [field.key, values[field.key] || '']));
    return active.buildInput ? active.buildInput(base) : base;
  }, [active, values]);

  async function submit() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/theone/oneclaw/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: active.action,
          approvalMode: active.approvalMode || 'auto',
          idempotencyKey: `${active.key}-${Date.now()}`,
          input: inputPreview,
        }),
      });
      const json = await res.json();
      setResult(json);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'OneClaw action could not start.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="worker-app-workspace">
      <div className="product-command-card worker-app-command">
        <div className="app-choice-grid">
          {templates.map((template) => (
            <button
              key={template.key}
              type="button"
              className={active.key === template.key ? 'app-choice active' : 'app-choice'}
              onClick={() => {
                setActiveKey(template.key);
                setResult(null);
              }}
            >
              {template.label}
            </button>
          ))}
        </div>

        <div className="worker-action-summary">
          <span>{active.action}</span>
          <strong>{active.description}</strong>
        </div>

        <div className="worker-field-grid">
          {active.fields.map((field) => (
            <label key={field.key} className="app-field">
              <span>{field.label}</span>
              {field.multiline ? (
                <textarea
                  value={values[field.key] || ''}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                />
              ) : (
                <input
                  value={values[field.key] || ''}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                />
              )}
            </label>
          ))}
        </div>

        <button className="run-button" type="button" onClick={submit} disabled={loading}>
          {loading ? 'Submitting...' : active.approvalMode === 'manual' ? 'Prepare for Approval' : 'Run Worker'}
        </button>
      </div>

      <aside className="product-result-card worker-app-result">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{resultTitle}</h2>
            <p className="panel-subtitle">TheOne submits the exact OneClaw action and shows the receipt.</p>
          </div>
          <span className={`status-pill status-${result?.ok === false ? 'failed' : result ? 'completed' : 'ready'}`}>
            {result?.ok === false ? 'blocked' : result ? 'submitted' : 'ready'}
          </span>
        </div>

        {!result ? (
          <ProductEmpty title="Ready" detail="Choose an action and run the worker." />
        ) : (
          <div className="app-readable-result">
            <strong>{outputSummary(result)}</strong>
            <pre>{compactJson(result.result || result)}</pre>
          </div>
        )}
      </aside>
    </section>
  );
}
