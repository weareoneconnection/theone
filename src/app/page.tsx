import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="landing-shell">
      <div className="landing-panel">
        <div className="eyebrow">The Execution OS</div>
        <h1>TheOne</h1>
        <p>
          One intent. One system. One execution layer. Launch the full TheOne shell
          and orchestration demo.
        </p>
        <Link className="primary-link" href="/theone">
          Open TheOne
        </Link>
      </div>
    </main>
  );
}
