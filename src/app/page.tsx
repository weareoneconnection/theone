import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="landing-shell">
      <div className="landing-panel">
        <div className="landing-hero-copy">
          <h1>TheOne</h1>
          <p>
            One AI OS for intent, workflow, proof, and real-world execution.
            <span>说出目标，TheOne 负责规划、治理、执行和交付结果。</span>
          </p>
          <div className="landing-actions">
            <Link className="primary-link" href="/chat">
              开始对话 · Chat
            </Link>
            <Link className="secondary-link" href="/run">
              任务台 · Console
            </Link>
            <Link className="secondary-link" href="/admin">
              Admin
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
