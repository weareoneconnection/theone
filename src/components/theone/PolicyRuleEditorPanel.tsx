'use client';

import { useEffect, useState } from 'react';

type Rule = {
  id: string;
  domain: string;
  action: string;
  mode: string;
  risk: string;
  decision: 'auto' | 'manual' | 'blocked';
  enabled: boolean;
  reason: string;
};

const emptyRule: Rule = {
  id: '',
  domain: 'custom',
  action: '',
  mode: 'assist,auto',
  risk: 'medium',
  decision: 'manual',
  enabled: true,
  reason: 'Custom automation policy rule.',
};

export function PolicyRuleEditorPanel() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Rule>(emptyRule);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function loadRules() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/policy/rules', { cache: 'no-store' });
      const json = await res.json();
      setRules(json?.policy?.rules || []);
      setMessage(json?.ok ? '' : json?.error || 'Policy registry unavailable.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Policy registry unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function saveRule(rule: Rule) {
    if (!rule.action.trim()) {
      setMessage('Action is required.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/theone/policy/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Policy update failed.');
      setDraft(emptyRule);
      await loadRules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Policy update failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRules();
  }, []);

  return (
    <section className="panel-card policy-editor-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Policy Registry</h2>
          <p className="panel-subtitle">Persistent automation rules for action, risk, mode, and execution decision.</p>
        </div>
        <button className="mini-action" type="button" disabled={loading} onClick={loadRules}>Refresh</button>
      </div>

      <div className="policy-edit-grid">
        <label className="field-label">
          Action
          <input value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })} placeholder="email.send" />
        </label>
        <label className="field-label">
          Decision
          <select value={draft.decision} onChange={(event) => setDraft({ ...draft, decision: event.target.value as Rule['decision'] })}>
            <option value="auto">auto</option>
            <option value="manual">manual</option>
            <option value="blocked">blocked</option>
          </select>
        </label>
      </div>
      <div className="policy-edit-grid">
        <label className="field-label">
          Domain
          <input value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} />
        </label>
        <label className="field-label">
          Risk
          <select value={draft.risk} onChange={(event) => setDraft({ ...draft, risk: event.target.value })}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
      </div>
      <label className="field-label">
        Reason
        <input value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
      </label>
      <div className="approval-actions">
        <button className="run-button compact" type="button" disabled={loading} onClick={() => saveRule({ ...draft, id: draft.id || `policy_${Date.now()}` })}>
          Save Rule
        </button>
        {message ? <span className="proof-meta">{message}</span> : null}
      </div>

      <div className="policy-rule-list">
        {rules.map((rule) => (
          <div key={rule.id} className="policy-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{rule.action}</div>
                <div className="proof-meta">{rule.domain} · {rule.mode} · {rule.reason}</div>
              </div>
              <span className={`risk-chip risk-${rule.risk}`}>{rule.decision}</span>
            </div>
            <div className="approval-actions">
              <button className="mini-action" type="button" disabled={loading} onClick={() => saveRule({ ...rule, enabled: !rule.enabled })}>
                {rule.enabled ? 'Disable' : 'Enable'}
              </button>
              <button className="mini-action" type="button" disabled={loading} onClick={() => setDraft(rule)}>
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
