import type { Metadata } from 'next';
import Link from 'next/link';
import { BriefcaseBusiness, ArrowUpRight } from 'lucide-react';
import './globals.css';
import { currentUser } from '@/lib/api';

export const metadata: Metadata = {
  icons: { icon: '/favicon.svg' },
  title: {
    default: 'SkillonIT — Find work that fits you',
    template: '%s | SkillonIT',
  },
  description:
    'Discover global opportunities, match your skills and manage your job applications with confidence.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await currentUser();
  const workspace =
    user?.role === 'admin'
      ? '/admin'
      : user?.role === 'employer'
        ? '/employer'
        : '/dashboard';
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <Link className="brand" href="/">
            <span className="brand-icon">
              <BriefcaseBusiness size={22} />
            </span>
            Skillon<span>IT</span>
            <small>EMPLOYMENT</small>
          </Link>
          <nav aria-label="Main navigation">
            <Link href="/">Find jobs</Link>
            <Link href={workspace}>My workspace</Link>
            <Link href="/pricing">Plans</Link>
            <Link href="/employer">
              For employers
              <ArrowUpRight size={13} />
            </Link>
          </nav>
          <div className="header-actions">
            <Link href={user ? workspace : '/login'}>
              {user ? 'My account' : 'Sign in'}
            </Link>
            <Link className="primary" href={user ? workspace : '/register'}>
              {user ? 'Workspace' : 'Get started'}
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer>
          <Link className="brand" href="/">
            Skillon<span>IT</span>
          </Link>
          <p>A considered next step for every career.</p>
          <div>
            <Link href="/about">About</Link>
            <Link href="/trust">Safety & trust</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
          <small>© {new Date().getFullYear()} SkillonIT Employment</small>
        </footer>
      </body>
    </html>
  );
}
