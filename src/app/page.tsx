import Link from 'next/link';

export default function HomePage() {
  const useCases = [
    {
      key: '01',
      title: 'Analyze anything',
      titleZh: '分析网页与资料',
      body: 'Read websites, files, spreadsheets, and evidence, then return a usable brief.',
      bodyZh: '读取网页、文件、表格和证明材料，直接生成可用结论。',
    },
    {
      key: '02',
      title: 'Run real workers',
      titleZh: '调用真实 Worker',
      body: 'Route work to OneClaw for browser, GitHub, X, files, API, and desktop actions.',
      bodyZh: '把任务交给 OneClaw，执行浏览器、GitHub、X、文件、API 和本地电脑动作。',
    },
    {
      key: '03',
      title: 'Govern every action',
      titleZh: '自动治理动作',
      body: 'Check policy, approval gates, receipts, proof, memory, and recovery before work leaves the OS.',
      bodyZh: '在执行前检查策略、审批、证明、记忆和恢复路径。',
    },
  ];

  return (
    <main className="landing-shell">
      <div className="landing-panel">
        <div className="landing-hero-copy">
          <div className="eyebrow">Universal AI Operating System · 超级智能体操作系统</div>
          <h1>TheOne</h1>
          <p>
            Describe the outcome. TheOne plans with OneAI, governs the route,
            calls OneClaw workers, and returns proof-backed results.
            <span> 说出目标，TheOne 负责规划、治理、执行和交付结果。</span>
          </p>
          <div className="landing-actions">
            <Link className="primary-link" href="/run">
              Start TheOne
            </Link>
            <Link className="secondary-link" href="/admin">
              Admin
            </Link>
            <span className="landing-status">OneAI plans · OneClaw executes · TheOne governs</span>
          </div>
        </div>

        <div className="landing-use-grid" aria-label="TheOne use cases">
          {useCases.map((item) => (
            <Link className="landing-use-card" href="/run" key={item.key}>
              <span>{item.key}</span>
              <strong>{item.title}</strong>
              <em>{item.titleZh}</em>
              <p>{item.body}</p>
              <small>{item.bodyZh}</small>
            </Link>
          ))}
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
