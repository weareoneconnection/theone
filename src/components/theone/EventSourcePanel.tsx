'use client';

import { useEffect, useState } from 'react';

export function EventSourcePanel() {
  const [sources, setSources] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [sourceRes, workerRes] = await Promise.all([
        fetch('/api/theone/events/sources?limit=12', { cache: 'no-store' }),
        fetch('/api/theone/workers', { cache: 'no-store' }),
      ]);
      const sourceJson = await sourceRes.json();
      const workerJson = await workerRes.json();
      setSources(sourceJson.sources || []);
      setEvents(sourceJson.events || []);
      setWorkers(workerJson.workers || []);
      setMessage(sourceJson.ok && workerJson.ok ? '' : sourceJson.error || workerJson.error || 'Runtime source check failed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Runtime source check failed.');
    } finally {
      setLoading(false);
    }
  }

  async function poll() {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/events/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 2 }),
      });
      const json = await res.json();
      setMessage(json.ok ? `Polled ${(json.results || []).length} source(s).` : json.error || 'Event poll failed.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Event poll failed.');
    } finally {
      setLoading(false);
    }
  }

  async function routeEvents(force = false) {
    setLoading(true);
    try {
      const res = await fetch('/api/theone/events/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10, force }),
      });
      const json = await res.json();
      setMessage(json.ok ? `Routed ${json.checked || 0} event(s).` : json.error || 'Event routing failed.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Event routing failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="panel-card event-source-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Event Sources</h2>
          <p className="panel-subtitle">Real triggers normalized into TheOne before workers execute anything.</p>
        </div>
        <span className="panel-count">L12</span>
      </div>

      <div className="scheduler-actions">
        <button className="mini-action" type="button" disabled={loading} onClick={load}>Refresh</button>
        <button className="mini-action" type="button" disabled={loading} onClick={poll}>Poll Live Sources</button>
        <button className="mini-action" type="button" disabled={loading} onClick={() => routeEvents(false)}>Route Events</button>
        <button className="mini-action" type="button" disabled={loading} onClick={() => routeEvents(true)}>Force Route</button>
        {message ? <span className="proof-meta">{message}</span> : null}
      </div>

      <div className="policy-matrix">
        <div className="policy-row">
          <div className="mini-heading">Sources</div>
          <div className="policy-chip-row">
            {sources.map((source) => (
              <span key={source.key} className="capability-chip">{source.key} · {source.status}</span>
            ))}
          </div>
        </div>

        <div className="policy-row">
          <div className="mini-heading">Worker Runtime</div>
          <div className="policy-chip-row">
            {workers.map((worker) => (
              <span key={worker.key} className="capability-chip">{worker.title} · {worker.status}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="policy-rule-list compact-events">
        {events.length === 0 ? (
          <div className="policy-row">
            <div className="feed-title">No external events yet.</div>
            <div className="proof-meta">Poll a source or send a webhook to populate the event inbox.</div>
          </div>
        ) : events.map((event) => (
          <div key={event.id} className="policy-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{event.eventType}</div>
                <div className="proof-meta">{event.source} · {event.summary}</div>
              </div>
              <span className="status-pill status-auto">{event.status}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
