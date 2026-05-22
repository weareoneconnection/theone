'use client';

import { useState } from 'react';

const PROMPTS = [
  'Turn this goal into an execution workflow',
  'Prepare a high-signal X post and wait for approval',
  'Create a mission for the community',
  'Research WAOC positioning and store the result',
];

const MODES = [
  { key: 'manual', label: 'Manual' },
  { key: 'assist', label: 'Assist' },
  { key: 'auto', label: 'Auto' },
];

export function IntentInput({
  onRun,
  loading,
}: {
  onRun: (input: string, mode: string) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState('assist');

  return (
    <section className="panel-card">
      <h2 className="panel-title">Intent Hub</h2>
      <p className="panel-subtitle">
        State the outcome once. TheOne turns it into a governed workflow across intelligence,
        execution, proof, and memory.
      </p>
      <div className="mode-selector" aria-label="Execution mode">
        {MODES.map((item) => (
          <button
            key={item.key}
            className={item.key === mode ? 'mode-option active' : 'mode-option'}
            onClick={() => setMode(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="intent-row">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Describe the outcome TheOne should coordinate."
          className="intent-input"
        />
        <button
          className="run-button"
          onClick={() => onRun(value, mode)}
          disabled={loading || !value.trim()}
        >
          {loading ? 'Running...' : 'Run TheOne'}
        </button>
      </div>
      <div className="prompt-row">
        {PROMPTS.map((prompt) => (
          <button key={prompt} className="prompt-chip" onClick={() => setValue(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}
