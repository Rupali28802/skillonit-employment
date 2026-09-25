'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

type AdminLink = [string, string];

export function AdminResponsiveLayout({ section, title, userName, links, logout, children }: {
  section: string;
  title: string;
  userName: string;
  links: AdminLink[];
  logout: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  return <div className={`admin-responsive-shell${open ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
    <button className="admin-nav-backdrop" aria-label="Close admin navigation" onClick={() => setOpen(false)} />
    <aside className="admin-responsive-sidebar" aria-label="Admin navigation drawer">
      <div className="admin-sidebar-heading"><strong>Admin Console</strong><button type="button" aria-label="Close admin navigation" onClick={() => setOpen(false)}>×</button></div>
      <nav aria-label="Admin sections">{links.map(([path, label]) => <Link key={path} href={'/' + path} aria-current={section === path ? 'page' : undefined} onClick={() => setOpen(false)}><span aria-hidden="true">{path === 'admin' ? '⌂' : '›'}</span><b>{label}</b></Link>)}</nav>
    </aside>
    <div className="admin-responsive-main">
      <header className="admin-responsive-topbar">
        <button className="admin-menu-button" type="button" aria-label="Open admin navigation" aria-expanded={open} onClick={() => setOpen(true)}>☰</button>
        <button className="admin-collapse-button" type="button" aria-label={collapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'} aria-pressed={collapsed} onClick={() => setCollapsed(value => !value)}>☰</button>
        <div className="admin-title"><div className="eyebrow">ADMIN WORKSPACE</div><h1>{title}</h1></div>
        <div className="admin-account-actions"><span className="pill" title={userName}>{userName}</span>{logout}</div>
      </header>
      <main className="admin-responsive-content">{children}</main>
    </div>
  </div>;
}
