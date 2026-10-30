'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  Bookmark,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  FileText,
  Mail,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { PublicJob, User } from '@/lib/domain';

type Application = { id: string; status: string; createdAt?: string; job?: { title?: string } };
type Match = { job: PublicJob; match: { score: number; reasons: (string | null)[] } };
type DashboardData = { apps: Application[]; saved: unknown[]; matches: Match[] };
type Completion = { percentage: number; missingFields: string[]; readinessStatus: string };
type Onboarding = { completeness: number; completed: boolean; steps: { name: string; complete: boolean; optional: boolean }[] };
type Subscription = { plan: { name: string }; subscriptionStatus: string; limits: { applicationsPerDay: number; autoApplyPerDay: number; cvVersions: number }; usage?: { autoApply?: { used: number; cap: number; period: string } } };
type Notification = { id: string; title: string; message: string; href: string; read: boolean; createdAt: string };

const human = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const ease = [0.22, 1, 0.36, 1] as const;
const reveal = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.52, ease } },
};
const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.075, delayChildren: 0.04 } },
};

export function CandidateDashboard({ user, dashboard, completion, onboarding, mailboxConnected, subscription, notifications, cvCount }: {
  user: User; dashboard: DashboardData; completion: Completion; onboarding: Onboarding; mailboxConnected: boolean;
  subscription: Subscription; notifications: Notification[]; cvCount: number;
}) {
  const reduceMotion = useReducedMotion();
  const firstName = user.name.trim().split(/\s+/)[0] || 'there';
  const activeApplications = dashboard.apps.filter(app => !['REJECTED', 'WITHDRAWN', 'CANCELLED', 'FAILED'].includes(app.status)).length;
  const unread = notifications.filter(item => !item.read).length;
  const initial = reduceMotion ? false : 'hidden';
  const setup = [
    { label: 'Confirm your profile', complete: user.profile.confirmed, href: '/profile', icon: UserRound, benefit: 'Improves job matches' },
    { label: 'Upload and confirm a CV', complete: cvCount > 0, href: '/cvs', icon: FileText, benefit: 'Keeps applications ready' },
    { label: 'Set job preferences', complete: user.preferences.roles.length > 0, href: '/preferences', icon: Target, benefit: 'Personalizes recommendations' },
    { label: 'Connect your email', complete: mailboxConnected, href: '/mail', icon: Mail, benefit: 'Enables email applications' },
  ];
  const completeSetup = setup.filter(item => item.complete).length;
  const nextSetup = setup.find(item => !item.complete);
  const applicationStates = [
    { label: 'In review', count: dashboard.apps.filter(app => ['NEEDS_REVIEW', 'QUEUED', 'SENDING'].includes(app.status)).length },
    { label: 'Submitted', count: dashboard.apps.filter(app => ['SENT', 'DIRECT_SUBMITTED', 'EXTERNAL_SUBMITTED'].includes(app.status)).length },
    { label: 'Interviews', count: dashboard.apps.filter(app => app.status === 'INTERVIEW').length },
  ];
  const quickActions = [
    { label: 'Update profile', detail: `${completion.percentage}% ready`, href: '/profile', icon: UserRound },
    { label: 'Find jobs', detail: 'View live matches', href: '/', icon: Search },
    { label: 'Applications', detail: `${activeApplications} active`, href: '/applications', icon: BriefcaseBusiness },
    { label: 'My CV', detail: `${cvCount} confirmed`, href: '/cvs', icon: FileText },
  ];
  const stats = [
    { value: dashboard.apps.length, label: 'Applications', detail: `${activeApplications} active`, href: '/applications', icon: BriefcaseBusiness },
    { value: dashboard.saved.length, label: 'Saved jobs', detail: 'Ready to review', href: '/saved', icon: Bookmark },
    { value: dashboard.matches.length, label: 'Job matches', detail: 'Based on your profile', href: '/', icon: Target },
    { value: unread, label: 'New updates', detail: `${notifications.length} total`, href: '/notifications', icon: Bell },
  ];

  return <motion.div className="candidate-dashboard" initial={initial} animate="visible" variants={stagger}>
    <motion.section className="dashboard-hero" variants={reveal}>
      <div className="dashboard-hero-glow" aria-hidden="true" />
      <div className="dashboard-hero-copy">
        <span className="dashboard-kicker"><Sparkles size={15} /> YOUR CAREER WORKSPACE</span>
        <h2>Welcome back, {firstName}.</h2>
        <p>{completion.percentage === 100
          ? 'Your profile is application-ready. Explore fresh roles matched to your experience and preferences.'
          : `Your workspace is ${completeSetup} of ${setup.length} essentials ready. Complete one focused step to improve the jobs and applications we can prepare for you.`}</p>
        <div className="dashboard-hero-actions">
          <Link className="primary" href={nextSetup?.href || '/'}>{nextSetup ? `Continue: ${nextSetup.label}` : 'Explore matching jobs'} <ArrowRight size={16} /></Link>
          <Link className="dashboard-quiet-action" href="#application-readiness">View readiness</Link>
        </div>
      </div>
      <motion.div className="dashboard-progress-card" whileHover={reduceMotion ? undefined : { y: -4, scale: 1.015 }} transition={{ duration: 0.22 }}>
        <div className="dashboard-ring" style={{ '--progress': `${completion.percentage * 3.6}deg` } as React.CSSProperties}>
          <span>{completion.percentage}%</span>
        </div>
        <div>
          <span className="dashboard-progress-label"><i /> PROFILE STATUS</span>
          <strong>{completeSetup === setup.length ? 'Ready to apply' : `${completeSetup} of ${setup.length} essentials ready`}</strong>
          <small>{completion.percentage === 100 ? 'Confirmed profile complete' : human(completion.readinessStatus)}</small>
        </div>
      </motion.div>
    </motion.section>

    <motion.nav className="dashboard-quick-actions" aria-label="Workspace shortcuts" variants={reveal}>
      {quickActions.map(item => <motion.div key={item.label} whileHover={reduceMotion ? undefined : { y: -3 }} transition={{ duration: 0.2 }}>
        <Link href={item.href}>
          <span className="dashboard-quick-icon"><item.icon size={19} /></span>
          <span><strong>{item.label}</strong><small>{item.detail}</small></span>
          <ArrowRight size={15} />
        </Link>
      </motion.div>)}
    </motion.nav>

    <motion.section className="dashboard-stats" aria-label="Account summary" variants={stagger}>
      {stats.map(item => <motion.div key={item.label} variants={reveal} whileHover={reduceMotion ? undefined : { y: -4 }} transition={{ duration: 0.2 }}>
        <Link href={item.href} className="dashboard-stat">
          <span className="dashboard-icon"><item.icon size={20} /></span>
          <div><strong>{item.value}</strong><span>{item.label}</span><small>{item.detail}</small></div>
        </Link>
      </motion.div>)}
    </motion.section>

    <div className="dashboard-columns">
      <div className="stack dashboard-main-column">
        <motion.section className="panel dashboard-section dashboard-matches-panel" variants={reveal} initial={initial} whileInView="visible" viewport={{ once: true, amount: 0.16 }}>
          <div className="section-line dashboard-section-heading">
            <div><span className="dashboard-kicker"><Sparkles size={13} /> RECOMMENDED FOR YOU</span><h2>Roles worth your attention</h2><p>Ranked from your confirmed skills, experience and preferences.</p></div>
            <Link href="/">View all jobs <ArrowRight size={15} /></Link>
          </div>
          {!dashboard.matches.length
            ? <div className="dashboard-empty"><span><Target size={26} /></span><h3>Your matches are getting ready</h3><p>Tell us the roles, skills and locations that matter to you. We will use only confirmed profile details to rank opportunities.</p><div className="dashboard-empty-actions"><Link className="primary" href="/profile">Complete profile</Link><Link className="secondary" href="/preferences">Set preferences</Link></div></div>
            : <div className="dashboard-match-list">{dashboard.matches.slice(0, 4).map(({ job, match }, index) => <motion.div key={job.id} initial={initial} whileInView="visible" viewport={{ once: true, amount: 0.35 }} variants={{ hidden: { opacity: 0, x: -14 }, visible: { opacity: 1, x: 0, transition: { delay: reduceMotion ? 0 : index * 0.06, duration: 0.42, ease } } }} whileHover={reduceMotion ? undefined : { x: 4 }}>
              <Link className="dashboard-match" href={`/jobs/${job.id}`}>
                <div className="dashboard-match-copy"><span className="dashboard-match-label">{job.category || 'Recommended role'}</span><h3>{job.title}</h3><p><MapPin size={14} /> {[job.city, job.country].filter(Boolean).join(', ') || 'Location flexible'} <i /> {job.mode}</p><small>{match.reasons.filter(Boolean).slice(0, 2).join(' · ') || 'Based on your confirmed profile'}</small></div>
                <span className="match-score"><strong>{Math.round(match.score)}%</strong><small>match</small></span>
              </Link>
            </motion.div>)}</div>}
        </motion.section>

        <motion.section className="panel dashboard-section" variants={reveal} initial={initial} whileInView="visible" viewport={{ once: true, amount: 0.18 }}>
          <div className="section-line dashboard-section-heading">
            <div><span className="dashboard-kicker"><Clock3 size={13} /> APPLICATION TRACKER</span><h2>Recent progress</h2><p>Keep every application and its latest status in one place.</p></div>
            <Link href="/applications">View history <ArrowRight size={15} /></Link>
          </div>
          {!!dashboard.apps.length && <div className="dashboard-application-summary" aria-label="Application status summary">{applicationStates.map(item => <span key={item.label}><strong>{item.count}</strong>{item.label}</span>)}</div>}
          {!dashboard.apps.length
            ? <div className="dashboard-empty"><span><BriefcaseBusiness size={26} /></span><h3>No applications yet</h3><p>When you find the right role, your confirmed profile will make the process faster.</p><Link className="secondary" href="/">Browse jobs</Link></div>
            : <div className="dashboard-activity-list">{dashboard.apps.slice(0, 4).map((app, index) => <Link href="/applications" className="dashboard-activity" key={app.id}>
              <span className="dashboard-activity-step"><i className={index === 0 ? 'current' : ''} /></span>
              <div><strong>{app.job?.title || 'Job application'}</strong><small>{app.createdAt ? new Date(app.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Application activity'}</small></div>
              <span className="pill">{human(app.status)}</span>
            </Link>)}</div>}
        </motion.section>
      </div>

      <aside className="stack dashboard-side-column">
        <motion.section className="panel dashboard-section dashboard-readiness" id="application-readiness" variants={reveal} initial={initial} whileInView="visible" viewport={{ once: true, amount: 0.18 }}>
          <div className="dashboard-readiness-top"><span className="dashboard-kicker"><ShieldCheck size={13} /> APPLICATION READINESS</span><strong>{onboarding.completeness}%</strong></div>
          <h2>Your setup checklist</h2>
          <div className="dashboard-mini-progress"><span style={{ width: `${onboarding.completeness}%` }} /></div>
          <div className="dashboard-checklist">{setup.map(item => <Link href={item.href} key={item.label} className={item.complete ? 'complete' : ''}><span>{item.complete ? <CheckCircle2 size={19} /> : <item.icon size={18} />}</span><div><strong>{item.label}</strong><small>{item.complete ? 'Complete' : item.benefit}</small></div><ArrowRight size={14} /></Link>)}</div>
          {nextSetup && <p className="dashboard-next-step">Recommended next step <strong>{nextSetup.label}</strong><small>{nextSetup.benefit}</small></p>}
        </motion.section>

        <motion.section className="panel dashboard-section dashboard-tools" variants={reveal} initial={initial} whileInView="visible" viewport={{ once: true, amount: 0.18 }}>
          <span className="dashboard-kicker"><Target size={13} /> JOB SEARCH TOOLS</span>
          <h2>Move faster</h2>
          <div className="dashboard-tool-grid">
            <Link href="/alerts"><Bell size={18} /><strong>Job alerts</strong><small>Stay updated</small></Link>
            <Link href="/assistant"><Sparkles size={18} /><strong>AI assistant</strong><small>Get guidance</small></Link>
            <Link href="/cvs"><FileText size={18} /><strong>CV manager</strong><small>Keep it ready</small></Link>
            <Link href="/mail"><Mail size={18} /><strong>Email</strong><small>{mailboxConnected ? 'Connected' : 'Connect now'}</small></Link>
          </div>
        </motion.section>

        <motion.section className="panel dashboard-section dashboard-plan" variants={reveal} initial={initial} whileInView="visible" viewport={{ once: true, amount: 0.18 }}>
          <div className="dashboard-plan-top"><span className="dashboard-kicker"><Sparkles size={13} /> YOUR PLAN</span><span className="dashboard-plan-status">{human(subscription.subscriptionStatus)}</span></div>
          <h2>{subscription.plan.name}</h2>
          <p>Tools and limits available in your current workspace.</p>
          <div><span>Daily applications</span><strong>{subscription.limits.applicationsPerDay}</strong></div>
          <div><span>Auto Apply today</span><strong>{subscription.usage?.autoApply ? `${subscription.usage.autoApply.used} / ${subscription.usage.autoApply.cap}` : subscription.limits.autoApplyPerDay}</strong></div>
          <div><span>CV versions</span><strong>{subscription.limits.cvVersions}</strong></div>
          <Link className="secondary full" href="/billing">Manage plan</Link>
        </motion.section>

        {notifications[0] && <motion.section className="panel dashboard-section dashboard-update" variants={reveal} initial={initial} whileInView="visible" viewport={{ once: true, amount: 0.18 }}><span className="dashboard-kicker"><Bell size={13} /> LATEST UPDATE</span><h3>{notifications[0].title}</h3><p className="small">{notifications[0].message}</p><Link href={notifications[0].href || '/notifications'}>Open update <ArrowRight size={14} /></Link></motion.section>}
      </aside>
    </div>
  </motion.div>;
}
