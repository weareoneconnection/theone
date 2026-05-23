import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="landing-shell">
      <div className="landing-panel">
        <div className="landing-hero-copy">
          <div className="eyebrow">Universal AI Operating System</div>
          <h1>TheOne</h1>
          <p>
            One control plane for intent, context, permissions, workflow, proof,
            memory, and real-world execution.
          </p>
          <div className="landing-actions">
            <Link className="primary-link" href="/theone">
              Advanced Console
            </Link>
            <Link className="secondary-link" href="/run">
              Run TheOne
            </Link>
            <span className="landing-status">OneAI plans · OneClaw executes · TheOne governs</span>
          </div>
        </div>

        <div className="landing-system-grid">
          <div className="landing-system-card">
            <span>01</span>
            <strong>Intent Kernel</strong>
            <p>Turns an objective into a governed operating frame.</p>
          </div>
          <div className="landing-system-card">
            <span>02</span>
            <strong>Policy Runtime</strong>
            <p>Decides what can run, what needs approval, and what stays blocked.</p>
          </div>
          <div className="landing-system-card">
            <span>03</span>
            <strong>Worker Catalog</strong>
            <p>Maps OneClaw workers into installable OS capabilities.</p>
          </div>
          <div className="landing-system-card">
            <span>04</span>
            <strong>Proof Ledger</strong>
            <p>Records actions, receipts, memory, and execution evidence.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
