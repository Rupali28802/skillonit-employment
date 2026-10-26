import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowUp,
  ArrowUpRight,
  BookOpenText,
} from 'lucide-react';
import './globals.css';
import { currentUser } from '@/lib/api';
import { Toaster } from '@/components/ui/toast';
import { headers } from 'next/headers';
import { jsonLd, siteOrigin } from '@/lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  icons: { icon: '/favicon.svg' },
  title: {
    default: 'SkillonIT — Find work that fits you',
    template: '%s | SkillonIT',
  },
  description:
    'Discover global opportunities, match your skills and manage your job applications with confidence.',
  openGraph: { type:'website',siteName:'SkillOnIT Employment',url:'/',title:'SkillOnIT — Find work that fits you',description:'Discover global opportunities, match your skills and manage your job applications with confidence.' },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get('x-nonce') ?? undefined;
  const sessionResult = await Promise.allSettled([currentUser()]);
  const sessionUnavailable = sessionResult[0].status === 'rejected';
  const user = sessionResult[0].status === 'fulfilled' ? sessionResult[0].value : null;
  const workspace =
    user?.role === 'admin'
      ? '/admin'
      : user?.role === 'employer'
        ? '/employer'
        : '/dashboard';
  return (
    <html lang="en">
      <body>
        <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={jsonLd({'@context':'https://schema.org','@type':'Organization',name:'SkillOnIT Employment',url:siteOrigin(),logo:new URL('/skillonit-employment-logo.png',siteOrigin()).href,sameAs:['https://www.instagram.com/skillonit.employment/','https://www.facebook.com/profile.php?id=61594123457942','https://medium.com/@skillonitemployment']})}/>
        <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={jsonLd({'@context':'https://schema.org','@type':'WebSite',name:'SkillOnIT Employment',url:siteOrigin()})}/>
        <Toaster />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <Link className="brand" href="/">
            <Image className="brand-logo" src="/skillonit-employment-logo.png" alt="SkillOnIT Employment" width={720} height={240} priority />
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
              <>
                <Link className="header-profile-photo" href={workspace} aria-label={`Open ${user.role === 'student' ? 'student ' : ''}workspace`} title={user.name}>
                  {user.profile.avatarVersion ? (
                    <Image src={`/api/v1/me/profile-image/avatar?v=${encodeURIComponent(user.profile.avatarVersion)}`} alt={`${user.name}'s profile photo`} width={40} height={40} unoptimized />
                  ) : (
                    <span aria-hidden="true">{user.name.split(' ').filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'U'}</span>
                  )}
                </Link>
                <Link className="primary header-workspace-action" href={workspace}>
                  Workspace
                  <ArrowUpRight size={16} />
                </Link>
              </>
            ) : <>
              <Link className="header-sign-in" href="/login">Sign in</Link>
              <span className="header-auth-separator" aria-hidden="true">/</span>
              <Link className="primary header-sign-up" href="/register">
                <span className="header-sign-up-desktop">Get started</span>
                <span className="header-sign-up-mobile">Sign up</span>
                <ArrowUpRight className="header-sign-up-icon" size={16} />
              </Link>
            </>}
          </div>
        </header>
        <main id="main">
          {sessionUnavailable && <output className="notice">The service is temporarily unavailable. Jobs and account details may not load. Please try reloading shortly.</output>}
          {children}
        </main>
        <footer className="site-footer">
          <div className="footer-main">
            <section className="footer-intro" aria-labelledby="footer-brand-name">
              <Link className="footer-brand" href="/" id="footer-brand-name">
                <Image className="footer-brand-logo" src="/skillonit-employment-logo.png" alt="SkillOnIT Employment" width={720} height={240} />
              </Link>
              <p>Find meaningful work, build a trusted profile, and take your next career step with confidence.</p>
              <nav className="footer-socials" aria-label="SkillOnIT social media">
                <a href="https://www.instagram.com/skillonit.employment/" target="_blank" rel="noreferrer" aria-label="SkillOnIT on Instagram">
                  <svg className="social-instagram-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                    <circle cx="12" cy="12" r="4.25" />
                    <circle className="social-instagram-dot" cx="17.4" cy="6.7" r="1.15" />
                  </svg>
                </a>
                <a href="https://www.facebook.com/profile.php?id=61594123457942" target="_blank" rel="noreferrer" aria-label="SkillOnIT on Facebook">
                  <span className="social-monogram social-facebook" aria-hidden="true">f</span>
                </a>
                <a href="https://medium.com/@skillonitemployment" target="_blank" rel="noreferrer" aria-label="SkillOnIT on Medium">
                  <BookOpenText size={17} aria-hidden="true" />
                </a>
              </nav>
            </section>

            <nav className="footer-links" aria-label="Footer navigation">
              <section>
                <h2>JOB SEEKERS</h2>
                <Link href="/">Find jobs</Link>
                <Link href={workspace}>My workspace</Link>
                <Link href="/pricing">Plans</Link>
              </section>
              <section>
                <h2>PLATFORM</h2>
                <Link href="/about">About us</Link>
                <Link href="/employer">For employers</Link>
                <Link href="/contact">Contact</Link>
              </section>
              <section>
                <h2>TRUST</h2>
                <Link href="/trust">Safety &amp; trust</Link>
                <Link href="/privacy">Privacy</Link>
                <Link href="/terms">Terms</Link>
              </section>
            </nav>
          </div>

          <div className="footer-bottom">
            <small>© {new Date().getFullYear()} SkillonIT Employment. All rights reserved.</small>
            <div className="footer-bottom-links">
              <Link href="/privacy">Privacy policy</Link>
              <Link href="/terms">Terms of service</Link>
              <a href="#main" className="back-to-top">
                <ArrowUp size={13} />
                Back to top
              </a>
            </div>
          </div>
        </footer>
        <script nonce={nonce} src="/pricing-carousel.js" defer />
      </body>
    </html>
  );
}
