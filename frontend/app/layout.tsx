import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { BriefcaseBusiness, ArrowUpRight } from 'lucide-react';
import './globals.css';
import { currentUser } from '@/lib/api';
import { Toaster } from '@/components/ui/toast';

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
        <Toaster />
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
            {user ? (
              <Link className="header-profile-photo" href={workspace} aria-label={`Open ${user.role === 'student' ? 'student ' : ''}workspace`} title={user.name}>
                {user.profile.avatarVersion ? (
                  <Image src={`/api/v1/me/profile-image/avatar?v=${encodeURIComponent(user.profile.avatarVersion)}`} alt={`${user.name}'s profile photo`} width={40} height={40} unoptimized />
                ) : (
                  <span aria-hidden="true">{user.name.split(' ').filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'U'}</span>
                )}
              </Link>
            ) : <Link href="/login">Sign in</Link>}
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
