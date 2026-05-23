import Link from 'next/link';
import { ProductPage, ProductStatusStrip } from '@/components/theone/ProductNav';

const phases = [
  {
    label: 'Phase 1',
    title: 'Core Apps',
    summary: 'The first product surfaces people can use directly.',
    apps: [
      ['Web Analysis', '/apps/web', 'Ready', 'online', 'Read websites, summarize findings, and prepare next actions.'],
      ['Browser Operations', '/apps/browser', 'Ready', 'online', 'Open, extract, screenshot, and keep browser proof.'],
      ['X Growth', '/apps/x', 'Guarded', 'manual', 'Prepare posts, replies, limits, approvals, and public proof.'],
      ['GitHub Workflow', '/apps/github', 'Ready', 'online', 'Inspect repos, issues, actions, pull requests, and engineering status.'],
      ['Desktop Control', '/apps/desktop', 'Local', 'manual', 'Use the local OneClaw bridge to operate this computer safely.'],
      ['Files', '/apps/files', 'Ready', 'online', 'Read, transform, write, and route local or cloud artifacts.'],
      ['OneAI Bot', '/apps/bot', 'Bridge', 'assist', 'Connect the existing Telegram community bot without changing its code.'],
      ['Reports', '/apps/report', 'Ready', 'online', 'Turn research, files, and proof into documents and briefs.'],
      ['Monitor', '/workspaces', 'Ready', 'assist', 'Watch runs, approvals, signals, failures, and recurring work.'],
    ],
  },
  {
    label: 'Phase 2',
    title: 'Work OS Expansion',
    summary: 'Everyday business systems TheOne can coordinate.',
    apps: [
      ['Email', '/workers', 'Planned', 'manual', 'Draft, search, summarize, and send email with consent controls.'],
      ['Calendar', '/workers', 'Planned', 'manual', 'Check availability, schedule events, and prepare meetings.'],
      ['Messages', '/workers', 'Planned', 'manual', 'Coordinate Slack, Teams, Telegram, and operator notifications.'],
      ['API Operations', '/apps/api', 'Ready', 'online', 'Call APIs, submit webhooks, sync systems, and record proof.'],
      ['Database', '/workers', 'Planned', 'manual', 'Query, inspect schemas, and prepare guarded writes.'],
      ['Tasks', '/workers', 'Planned', 'assist', 'Create missions, owners, checklists, approvals, and handoffs.'],
      ['Memory', '/proof', 'Planned', 'assist', 'Preserve preferences, decisions, proof, context, and patterns.'],
      ['Automation', '/settings', 'Planned', 'manual', 'Run recurring work with policy, limits, proof, and escalation.'],
    ],
  },
  {
    label: 'Phase 3',
    title: 'Industry OS & Guarded Actions',
    summary: 'Vertical workflows and high-impact operations that require stronger policy.',
    apps: [
      ['Construction OS', '/workers', 'Planned', 'manual', 'RFIs, inspections, NCRs, procurement, schedule recovery, and site proof.'],
      ['Trading', '/workers', 'Guarded', 'manual', 'Scan markets, prepare actions, and separate advice from execution.'],
      ['Finance', '/workers', 'Guarded', 'manual', 'Parse invoices, reconcile records, review variance, and route approvals.'],
      ['Legal', '/workers', 'Guarded', 'manual', 'Extract clauses, review risks, and build approval packages.'],
      ['Sales', '/workers', 'Planned', 'assist', 'Create leads, update CRM records, log activity, and prepare outreach.'],
      ['Support', '/workers', 'Planned', 'assist', 'Triage requests, draft responses, summarize history, and escalate.'],
      ['Procurement', '/workers', 'Guarded', 'manual', 'Search suppliers, compare quotes, and prepare guarded orders.'],
      ['Operations', '/workers', 'Guarded', 'manual', 'Create work orders, inspect devices, monitor signals, and coordinate field work.'],
      ['Payments', '/workers', 'Guarded', 'manual', 'Prepare invoices, charges, transfers, and money movement approvals.'],
      ['Advanced Console', '/theone', 'Advanced', 'assist', 'Inspect kernel traces, workers, policy packs, proof, memory, and raw state.'],
    ],
  },
];

const osLevels = [
  ['L19', 'Multi-App Automation OS', 'Run and Apps route proven OneClaw workers into real user-facing workspaces.'],
  ['L20', 'Parallel Agent Runtime', 'Planner, Executor, Reviewer, Policy, and Memory roles coordinate before execution.'],
  ['L21', 'Installable OS', 'Apps, workers, connectors, and policy packs become versioned installable packages.'],
  ['L22', 'Self-Evolving OS', 'TheOne learns from failures and proposes safe upgrades with simulation and rollback.'],
  ['L24', 'App Memory OS', 'Focused Apps generate reusable memory packs, not just one-time outputs.'],
  ['L25', 'Autonomous Workspace OS', 'Apps can become ongoing workspaces with cadence, limits, proof, and circuit breakers.'],
];

export default function AppsPage() {
  const appCount = phases.reduce((count, phase) => count + phase.apps.length, 0);
  const liveCount = phases.reduce((count, phase) => count + phase.apps.filter((app) => app[2] === 'Ready' || app[2] === 'Guarded' || app[2] === 'Local').length, 0);

  return (
    <ProductPage
      eyebrow="App Directory"
      title="Apps TheOne can run."
      subtitle="Apps are focused work surfaces on top of the same OS: TheOne governs intent and policy, OneAI reasons, and OneClaw executes through workers and connectors."
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Phases', value: phases.length },
            { label: 'Apps', value: appCount },
            { label: 'Connected', value: liveCount, tone: 'online' },
          ]}
        />
      )}
    >
      <section className="os-composition-strip" aria-label="TheOne operating model">
        <div className="os-composition-item">
          <span>TheOne</span>
          <strong>Intent, policy, workflow, proof, memory</strong>
        </div>
        <div className="os-composition-item">
          <span>OneAI</span>
          <strong>Planning, reasoning, writing, judgment</strong>
        </div>
        <div className="os-composition-item">
          <span>OneClaw</span>
          <strong>Workers, connectors, browser, desktop, APIs</strong>
        </div>
      </section>

      <section className="os-level-strip" aria-label="TheOne L19 to L22 foundation">
        {osLevels.map(([level, title, description]) => (
          <div key={level} className="os-level-item">
            <span>{level}</span>
            <strong>{title}</strong>
            <p>{description}</p>
          </div>
        ))}
      </section>

      <section className="phase-board" aria-label="TheOne app roadmap">
        {phases.map((phase) => (
          <section key={phase.title} className="phase-section">
            <div className="phase-head">
              <div>
                <span className="product-card-kicker">{phase.label}</span>
                <h2>{phase.title}</h2>
              </div>
              <p>{phase.summary}</p>
            </div>
            <div className="phase-app-grid">
              {phase.apps.map(([title, href, status, tone, description]) => (
                <Link key={title} href={href} className={href.startsWith('/apps/') ? 'phase-app-card primary' : 'phase-app-card'}>
                  <div className="app-launch-top">
                    <span className="product-card-kicker">{href.startsWith('/apps/') ? href : 'capability'}</span>
                    <span className={`status-pill status-${tone}`}>{status}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <div className="app-powered-chain">
                    <span>{href.startsWith('/apps/') ? 'Open live app' : 'View capability path'}</span>
                  </div>
                  <strong>{href.startsWith('/apps/') ? 'Open app' : 'View'}</strong>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </section>
    </ProductPage>
  );
}
