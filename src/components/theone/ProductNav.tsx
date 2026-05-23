'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const links = [
  { href: '/run', label: 'Run' },
  { href: '/apps', label: 'Apps' },
  { href: '/workers', label: 'Workers' },
  { href: '/runs', label: 'Runs' },
  { href: '/proof', label: 'Proof' },
  { href: '/settings', label: 'Settings' },
  { href: '/theone', label: 'Advanced' },
];

export function ProductNav() {
  const pathname = usePathname();

  return (
    <header className="product-nav">
      <Link className="product-brand" href="/">
        <span>TheOne</span>
        <strong>AI OS</strong>
      </Link>
      <nav className="product-tabs" aria-label="TheOne sections">
        {links.map((link) => {
          const active = pathname === link.href || (link.href !== '/' && pathname?.startsWith(`${link.href}/`));
          return (
            <Link key={link.href} className={active ? 'product-tab active' : 'product-tab'} href={link.href}>
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

export function ProductPage({
  eyebrow,
  title,
  subtitle,
  children,
  aside,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  aside?: ReactNode;
  compact?: boolean;
}) {
  return (
    <main className="product-shell">
      <ProductNav />
      <section className={compact ? 'product-hero product-hero-compact' : 'product-hero'}>
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {aside ? <div className="product-hero-aside">{aside}</div> : null}
      </section>
      {children}
    </main>
  );
}

export function ProductStatusStrip({ items }: { items: Array<{ label: string; value: string | number; tone?: string }> }) {
  return (
    <div className="product-status-strip">
      {items.map((item) => (
        <div key={item.label} className="product-status-tile">
          <span>{item.label}</span>
          <strong className={item.tone ? `tone-${item.tone}` : ''}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function ProductEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="product-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function friendlyStatus(value?: string) {
  if (!value) return 'waiting';
  if (value === 'success' || value === 'completed' || value === 'online' || value === 'connected') return 'ready';
  if (value === 'awaiting_approval' || value === 'requires_approval') return 'needs approval';
  if (value === 'failed' || value === 'blocked' || value === 'denied') return 'blocked';
  return value.replaceAll('_', ' ');
}
