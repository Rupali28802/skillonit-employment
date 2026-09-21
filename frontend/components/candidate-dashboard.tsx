import Link from 'next/link';
import { ArrowRight, Bell, BriefcaseBusiness, CheckCircle2, FileText, Mail, MapPin, Sparkles, Target, UserRound } from 'lucide-react';
import type { PublicJob, User } from '@/lib/domain';

type Application = { id: string; status: string; createdAt?: string; job?: { title?: string } };
type Match = { job: PublicJob; match: { score: number; reasons: (string | null)[] } };
type DashboardData = { apps: Application[]; saved: unknown[]; matches: Match[] };
type Completion = { percentage: number; missingFields: string[]; readinessStatus: string };
type Onboarding = { completeness: number; completed: boolean; steps: { name: string; complete: boolean; optional: boolean }[] };
type Subscription = { plan: { name: string }; subscriptionStatus: string; limits: { applicationsPerDay: number; autoApplyPerDay: number; cvVersions: number } };
type Notification = { id: string; title: string; message: string; href: string; read: boolean; createdAt: string };

const human = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export function CandidateDashboard({ user, dashboard, completion, onboarding, mailboxConnected, subscription, notifications, cvCount }: {
  user: User; dashboard: DashboardData; completion: Completion; onboarding: Onboarding; mailboxConnected: boolean;
  subscription: Subscription; notifications: Notification[]; cvCount: number;
}) {
  const firstName = user.name.trim().split(/\s+/)[0] || 'there';
  const activeApplications = dashboard.apps.filter(app => !['REJECTED','WITHDRAWN','CANCELLED','FAILED'].includes(app.status)).length;
  const unread = notifications.filter(item => !item.read).length;
  const nextRequired = onboarding.steps.find(step => !step.optional && !step.complete);
  const setup = [
    { label: 'Confirm your profile', complete: user.profile.confirmed, href: '/profile', icon: UserRound },
    { label: 'Upload and confirm a CV', complete: cvCount > 0, href: '/cvs', icon: FileText },
    { label: 'Set job preferences', complete: user.preferences.roles.length > 0, href: '/preferences', icon: Target },
    { label: 'Connect your email', complete: mailboxConnected, href: '/mail', icon: Mail },
  ];
  return <div className="candidate-dashboard">
    <section className="dashboard-hero">
      <div><span className="dashboard-kicker"><Sparkles size={15} /> YOUR CAREER WORKSPACE</span><h2>Welcome back, {firstName}.</h2><p>{completion.percentage === 100 ? 'Your confirmed profile is ready. Explore roles selected from your saved preferences.' : 'Complete your profile so SkillOnIT can produce more accurate, explainable job matches.'}</p><div className="actions"><Link className="primary" href="/">Find matching jobs <ArrowRight size={16} /></Link><Link className="dashboard-quiet-action" href="/profile">Review profile</Link></div></div>
      <div className="dashboard-progress-card"><div className="dashboard-ring" style={{'--progress': `${completion.percentage * 3.6}deg`} as React.CSSProperties}><span>{completion.percentage}%</span></div><div><strong>Profile readiness</strong><small>{human(completion.readinessStatus)}</small></div></div>
    </section>

    <section className="dashboard-stats" aria-label="Account summary">
      <Link href="/applications" className="dashboard-stat"><span className="dashboard-icon"><BriefcaseBusiness size={20} /></span><div><strong>{dashboard.apps.length}</strong><span>Total applications</span><small>{activeApplications} active</small></div></Link>
      <Link href="/saved" className="dashboard-stat"><span className="dashboard-icon"><FileText size={20} /></span><div><strong>{dashboard.saved.length}</strong><span>Saved jobs</span><small>Ready for review</small></div></Link>
      <Link href="/notifications" className="dashboard-stat"><span className="dashboard-icon"><Bell size={20} /></span><div><strong>{unread}</strong><span>New updates</span><small>{notifications.length} total notifications</small></div></Link>
      <Link href="/billing" className="dashboard-stat"><span className="dashboard-icon"><Sparkles size={20} /></span><div><strong>{subscription.plan.name}</strong><span>Current plan</span><small>{subscription.limits.applicationsPerDay} applications/day</small></div></Link>
    </section>

    <div className="dashboard-columns">
      <div className="stack">
        <section className="panel dashboard-section">
          <div className="section-line"><div><span className="dashboard-kicker">RECOMMENDED FOR YOU</span><h2>Strong job matches</h2></div><Link href="/">View all <ArrowRight size={15} /></Link></div>
          {!dashboard.matches.length ? <div className="dashboard-empty"><Target size={28} /><h3>No ranked matches yet</h3><p>Confirm your profile and add target roles to start matching.</p><Link className="secondary" href="/preferences">Set preferences</Link></div> : <div className="dashboard-match-list">{dashboard.matches.map(({job, match}) => <Link className="dashboard-match" href={`/jobs/${job.id}`} key={job.id}><div><h3>{job.title}</h3><p><MapPin size={14} /> {[job.city, job.country].filter(Boolean).join(', ')} · {job.mode}</p><small>{match.reasons.filter(Boolean).slice(0,2).join(' · ') || 'Based on your confirmed profile'}</small></div><span className="match-score">{Math.round(match.score)}%<small>match</small></span></Link>)}</div>}
        </section>

        <section className="panel dashboard-section">
          <div className="section-line"><div><span className="dashboard-kicker">ACTIVITY</span><h2>Recent applications</h2></div><Link href="/applications">View history <ArrowRight size={15} /></Link></div>
          {!dashboard.apps.length ? <div className="dashboard-empty"><BriefcaseBusiness size={28} /><h3>No applications yet</h3><p>Your confirmed profile and preferences will help you apply with confidence.</p><Link className="secondary" href="/">Browse jobs</Link></div> : dashboard.apps.slice(0,4).map(app => <Link href="/applications" className="dashboard-activity" key={app.id}><div><strong>{app.job?.title || 'Job application'}</strong><small>{app.createdAt ? new Date(app.createdAt).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : 'Application activity'}</small></div><span className="pill">{human(app.status)}</span></Link>)}
        </section>
      </div>

      <aside className="stack">
        <section className="panel dashboard-section">
          <span className="dashboard-kicker">GET APPLICATION-READY</span><div className="section-line"><h2>Setup checklist</h2><strong>{onboarding.completeness}%</strong></div>
          <div className="dashboard-checklist">{setup.map(item => <Link href={item.href} key={item.label} className={item.complete ? 'complete' : ''}><span>{item.complete ? <CheckCircle2 size={20} /> : <item.icon size={20} />}</span><div><strong>{item.label}</strong><small>{item.complete ? 'Complete' : 'Continue setup'}</small></div><ArrowRight size={15} /></Link>)}</div>
          {nextRequired && <p className="small">Next required step: <strong>{human(nextRequired.name)}</strong></p>}
        </section>
        <section className="panel dashboard-section dashboard-plan"><span className="dashboard-kicker">YOUR PLAN</span><h2>{subscription.plan.name}</h2><p>Status: {human(subscription.subscriptionStatus)}</p><div><span>Daily applications</span><strong>{subscription.limits.applicationsPerDay}</strong></div><div><span>Auto-apply limit</span><strong>{subscription.limits.autoApplyPerDay}</strong></div><div><span>CV versions</span><strong>{subscription.limits.cvVersions}</strong></div><Link className="secondary full" href="/billing">Manage plan</Link></section>
        {notifications[0] && <section className="panel dashboard-section"><span className="dashboard-kicker">LATEST UPDATE</span><h3>{notifications[0].title}</h3><p className="small">{notifications[0].message}</p><Link href={notifications[0].href || '/notifications'}>Open update <ArrowRight size={14} /></Link></section>}
      </aside>
    </div>
  </div>;
}
