import Link from 'next/link';
import { ProductPage, ProductStatusStrip } from '@/components/theone/ProductNav';

const adminSections = [
  {
    title: 'Apps',
    href: '/apps',
    detail: 'Operate app workspaces for web, X, GitHub, desktop, files, reports, API, and OneAI Bot.',
  },
  {
    title: 'Workers',
    href: '/workers',
    detail: 'Inspect the OneClaw worker catalog, live capability status, and guarded execution surface.',
  },
  {
    title: 'Packages',
    href: '/packages',
    detail: 'Manage installable App, Worker, Connector, and Policy Pack runtime modules.',
  },
  {
    title: 'Workspaces',
    href: '/workspaces',
    detail: 'Review autonomous workspace timelines, memory, strategy, proof, and recovery state.',
  },
  {
    title: 'Proof',
    href: '/proof',
    detail: 'Read execution receipts, evidence, memory records, and ledgered outcomes.',
  },
  {
    title: 'Advanced Trace',
    href: '/theone',
    detail: 'Open the full operating-system trace for kernel, policy, workflow, providers, and memory.',
  },
  {
    title: 'Settings',
    href: '/settings',
    detail: 'Check provider connections, local bridge status, safety settings, and connector health.',
  },
  {
    title: 'History',
    href: '/runs',
    detail: 'Browse user-facing run history and mission-control detail pages.',
  },
];

export default function AdminPage() {
  return (
    <ProductPage
      eyebrow="Admin"
      title="TheOne backend control room."
      subtitle="Operational pages stay here so the public product surface can stay focused on the super-agent chat experience."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Product', value: '/run', tone: 'online' },
            { label: 'APIs', value: 'unchanged', tone: 'online' },
            { label: 'Backend', value: 'available', tone: 'assist' },
          ]}
        />
      )}
    >
      <section className="product-grid-three admin-control-grid">
        {adminSections.map((section) => (
          <Link key={section.href} className="product-card admin-control-card" href={section.href}>
            <span className="product-card-kicker">{section.href}</span>
            <h2>{section.title}</h2>
            <p>{section.detail}</p>
          </Link>
        ))}
      </section>
    </ProductPage>
  );
}
