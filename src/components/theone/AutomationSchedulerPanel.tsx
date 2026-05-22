'use client';

import { useEffect, useState } from 'react';

type Job = {
  id: string;
  name: string;
  triggerType: string;
  trigger: Record<string, unknown>;
  command: string;
  mode: string;
  status: 'active' | 'paused';
  maxRunsPerDay: number;
  cooldownMinutes: number;
  failureStreak: number;
  circuitOpen: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
};

const emptyJob: Job = {
  id: '',
  name: 'New automation',
  triggerType: 'interval',
  trigger: { source: 'manual', intervalMinutes: 120 },
  command: '',
  mode: 'assist',
  status: 'paused',
  maxRunsPerDay: 3,
  cooldownMinutes: 120,
  failureStreak: 0,
  circuitOpen: false,
};

export function AutomationSchedulerPanel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [draft, setDraft] = useState<Job>(emptyJob);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function loadJobs() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/automation/jobs', { cache: 'no-store' });
      const json = await res.json();
      setJobs(json.jobs || []);
      setMessage(json.ok ? '' : json.error || 'Automation scheduler unavailable.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Automation scheduler unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function saveJob(job: Job) {
    if (!job.command.trim()) {
      setMessage('Automation command is required.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/theone/automation/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...job,
          id: job.id || `job_${Date.now()}`,
          trigger: { ...job.trigger, intervalMinutes: job.cooldownMinutes },
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Automation job update failed.');
      setDraft(emptyJob);
      await loadJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Automation job update failed.');
    } finally {
      setLoading(false);
    }
  }

  async function tick(force = false) {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/automation/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force, limit: 3 }),
      });
      const json = await res.json();
      setMessage(json.ok ? `Checked ${json.checked || 0} automation job(s).` : json.error || 'Automation tick failed.');
      await loadJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Automation tick failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  return (
    <section className="panel-card automation-scheduler-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Automation Scheduler</h2>
          <p className="panel-subtitle">Long-running jobs that can trigger TheOne without a manual button press.</p>
        </div>
        <span className="panel-count">L11</span>
      </div>

      <div className="scheduler-actions">
        <button className="mini-action" type="button" disabled={loading} onClick={loadJobs}>Refresh</button>
        <button className="mini-action" type="button" disabled={loading} onClick={() => tick(false)}>Tick Due</button>
        <button className="mini-action" type="button" disabled={loading} onClick={() => tick(true)}>Force Tick</button>
      </div>

      <div className="policy-edit-grid">
        <label className="field-label">
          Name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="field-label">
          Status
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Job['status'] })}>
            <option value="paused">paused</option>
            <option value="active">active</option>
          </select>
        </label>
      </div>
      <label className="field-label">
        Command
        <input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} placeholder="Monitor GitHub issues and summarize blockers" />
      </label>
      <div className="policy-edit-grid">
        <label className="field-label">
          Cooldown minutes
          <input type="number" min="5" value={draft.cooldownMinutes} onChange={(event) => setDraft({ ...draft, cooldownMinutes: Number(event.target.value || 60) })} />
        </label>
        <label className="field-label">
          Runs/day
          <input type="number" min="1" value={draft.maxRunsPerDay} onChange={(event) => setDraft({ ...draft, maxRunsPerDay: Number(event.target.value || 3) })} />
        </label>
      </div>
      <div className="approval-actions">
        <button className="run-button compact" type="button" disabled={loading} onClick={() => saveJob(draft)}>Save Job</button>
        {message ? <span className="proof-meta">{message}</span> : null}
      </div>

      <div className="policy-rule-list">
        {jobs.map((job) => (
          <div key={job.id} className="policy-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{job.name}</div>
                <div className="proof-meta">{job.triggerType} · {job.mode} · {job.command}</div>
              </div>
              <span className={`status-pill status-${job.circuitOpen ? 'blocked' : job.status === 'active' ? 'auto' : 'idle'}`}>
                {job.circuitOpen ? 'circuit' : job.status}
              </span>
            </div>
            <div className="ledger-meta-row">
              <span>failures {job.failureStreak} · limit {job.maxRunsPerDay}/day</span>
              <span>{job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : 'no schedule'}</span>
            </div>
            <div className="approval-actions">
              <button className="mini-action" type="button" disabled={loading} onClick={() => saveJob({ ...job, status: job.status === 'active' ? 'paused' : 'active' })}>
                {job.status === 'active' ? 'Pause' : 'Activate'}
              </button>
              <button className="mini-action" type="button" disabled={loading} onClick={() => setDraft(job)}>Edit</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
