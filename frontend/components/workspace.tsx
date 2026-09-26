import { display } from '@/lib/display';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api';
import { api, configuredPlans, demoMode } from '@/lib/api';
import { type PublicJob, type User, countries, categories } from '@/lib/domain';
import { SmartForm, Action } from './forms';
import { PlanEditor } from './admin-config';
import { AdminBillingPanel } from './admin-billing-panel';
import { ConsentManager, CvManager, GmailConnection, OnboardingActions, type MailboxStatus } from './candidate-tools';
import { AssistantPanel, NotificationCenter, SavedSearchManager, TaxonomyLookup } from './candidate-extras';
import { CandidateDashboard } from './candidate-dashboard';
import { ProfileDashboard } from './profile-dashboard';
import { AdminConsolePanel } from './admin-console-panel';
import { AdminRolesPanel } from './admin-roles-panel';
import { AdminResponsiveLayout } from './admin-responsive-layout';
type RecordRow = { id: string; [key: string]: unknown };
const candidateLinks = [
  ['dashboard', 'Overview'],
  ['profile', 'My profile'],
  ['preferences', 'Job preferences'],
  ['saved', 'Saved jobs'],
  ['applications', 'Applications'],
  ['cvs', 'CV manager'],
  ['alerts', 'Job alerts'],
  ['assistant', 'AI assistant'],
  ['mail', 'Connected email'],
  ['billing', 'Plan & billing'],
  ['settings', 'Settings'],
];
const employerLinks = [
  ['employer', 'Overview'],
  ['employer/organization', 'Organization'],
  ['employer/jobs', 'Manage jobs'],
  ['employer/post', 'Post a job'],
  ['employer/applicants', 'Applicants'],
  ['employer/team', 'Team'],
  ['employer/billing', 'Billing'],
];
const adminLinks = [
  ['admin', 'Overview'],
  ['admin/users', 'Users'],
  ['admin/employers', 'Employers'],
  ['admin/jobs', 'Jobs'],
  ['admin/sources', 'Job Sources'],
  ['admin/applications', 'Applications'],
  ['admin/fraud', 'Fraud & risk'],
  ['admin/plans', 'Plans & entitlements'],
  ['admin/payments', 'Payments'],
  ['admin/subscriptions', 'Subscriptions'],
  ['admin/leads', 'Leads'],
  ['admin/content', 'Content & SEO'],
  ['admin/flags', 'Feature flags'],
  ['admin/queues', 'Queues & workers'],
  ['admin/notifications', 'Notifications'],
  ['admin/health', 'System health'],
  ['admin/matching', 'Matching policy'],
  ['admin/audit', 'Audit logs'],
  ['admin/privacy', 'Privacy requests'],
  ['admin/roles', 'Roles & permissions'],
  ['admin/settings', 'Settings'],
];
const adminLinkPermission: Record<string, string> = {
  'admin/users':'users.read','admin/employers':'employers.read','admin/jobs':'jobs.read','admin/sources':'sources.read',
  'admin/applications':'applications.read','admin/fraud':'fraud.read','admin/plans':'plans.read','admin/payments':'payments.read','admin/subscriptions':'subscriptions.read',
  'admin/queues':'system.read','admin/notifications':'notifications.read','admin/health':'system.read','admin/matching':'configuration.read',
  'admin/leads':'configuration.read','admin/content':'configuration.read','admin/flags':'configuration.read',
  'admin/audit':'audit.read','admin/privacy':'privacy.read','admin/roles':'admin.roles.manage','admin/settings':'configuration.read',
};
export async function Workspace({ section }: { section: string }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const group = section.startsWith('admin')
    ? 'admin'
    : section.startsWith('employer')
      ? 'employer'
      : 'student';
  if (user.role !== group)
    return (
      <div className="page-wrap">
        <h1>This workspace is restricted</h1>
        <p>Sign in with the appropriate account role.</p>
        <Link
          className="primary"
          href={user.role === 'student' ? '/dashboard' : '/' + user.role}
        >
          Go to your workspace
        </Link>
      </div>
    );
  let links =
    group === 'admin'
      ? adminLinks
      : group === 'employer'
        ? employerLinks
        : candidateLinks;
  let adminAccess: { permissions:string[]; roleName:string } | null = null;
  if (group === 'admin') {
    adminAccess = await api<{ permissions: string[]; roleName:string }>('admin/console/access');
    links = adminLinks.filter(([path]) => !adminLinkPermission[path] || adminAccess?.permissions.includes(adminLinkPermission[path]));
  }
  if (group === 'admin') {
    const title = links.find(([path]) => path === section)?.[1] || 'Admin Console';
    return <AdminResponsiveLayout section={section} title={title} userName={user.name} links={links as [string, string][]} logout={<Action endpoint="auth/logout" label="Sign out" redirect="/" />}>
      {(await demoMode()) && <p className="sample-note">Local demo · External providers may be unavailable.</p>}
      <Admin section={section} user={user} permissions={adminAccess?.permissions ?? []} />
    </AdminResponsiveLayout>;
  }
  return (
    <div className={group === 'student' ? 'page-wrap candidate-workspace-shell' : 'page-wrap'}>
      <div className={group === 'student' ? 'section-line workspace-page-heading' : 'section-line'}>
        <div>
          <div className="eyebrow">{group === 'student' ? 'MY CAREER WORKSPACE' : `${group.toUpperCase()} WORKSPACE`}</div>
          <h1>{links.find(([p]) => p === section)?.[1] || 'Workspace'}</h1>
          {group === 'student' && <p>Manage your job search, profile and applications from one focused place.</p>}
        </div>
        <div className="actions">
          <span className="pill workspace-user-pill">{user.name}</span>
          <Action endpoint="auth/logout" label="Sign out" redirect="/" />
        </div>
      </div>
      {(await demoMode()) && (
        <p className="sample-note">
          Local demo · Fictional data and test accounts. External providers are
          not connected.
        </p>
      )}
      <div className="workspace">
        <nav className="workspace-nav" aria-label="Workspace navigation">
          {group === 'student' && <div className="workspace-nav-identity">
            <span aria-hidden="true">{user.name.trim().slice(0, 1).toUpperCase()}</span>
            <div><strong>{user.name}</strong><small>{user.profile.headline || user.profile.targetRole || 'Candidate profile'}</small></div>
          </div>}
          {group === 'student' && <small className="workspace-nav-label">WORKSPACE</small>}
          {links.map(([path, label]) => (
            <Link
              key={path}
              href={'/' + path}
              aria-current={section === path ? 'page' : undefined}
            >
              <i aria-hidden="true" />
              {label}
            </Link>
          ))}
          {group === 'student' && <Link className="workspace-find-jobs" href="/"><i aria-hidden="true" />Find matching jobs <span>→</span></Link>}
        </nav>
        <section>
          {group === 'student' ? (
            <Candidate section={section} user={user} />
          ) : group === 'employer' ? (
            <Employer section={section} user={user} />
          ) : (
            <Admin section={section} user={user} permissions={adminAccess?.permissions ?? []} />
          )}
        </section>
      </div>
    </div>
  );
}
async function Candidate({ section, user }: { section: string; user: User }) {
  if (section === 'onboarding') {
    const state = await api<{ revision: number; mode: string | null; completeness: number; ready: boolean; completed: boolean; steps: { number: number; name: string; complete: boolean; optional: boolean }[] }>('me/onboarding');
    const mailbox = await api<MailboxStatus>('mail/status');
    return <div className="stack"><GmailConnection initial={mailbox} /><div className="panel"><span className="pill">{state.completeness}% complete</span><h2 style={{marginTop: 15}}>Set up your candidate workspace</h2><p>Choose a CV-first or manual path. Extracted CV facts stay as a draft until you review and confirm them.</p><OnboardingActions revision={state.revision} mode={state.mode} ready={state.ready} completed={state.completed} /></div><div className="panel"><h2>Your setup journey</h2><ol><li>{mailbox.connected ? '✓' : '○'} Email connection</li><li><Link href="/profile">Continue to profile</Link></li><li><Link href="/cvs">Upload resume</Link></li><li>Review and confirm resume facts</li><li><Link href="/preferences">Choose job preferences</Link></li><li><Link href="/automation">Set auto-apply preferences</Link></li><li><Link href="/billing">Review subscription</Link></li></ol><h3>Backend onboarding checks</h3><ol>{state.steps.map(step => <li key={step.name}>{step.complete ? '✓' : '○'} {step.name.replaceAll('-', ' ')}{step.optional ? ' (optional)' : ''}</li>)}</ol></div></div>;
  }
  if (section === 'profile') {
    // Use the revision from the same authenticated user snapshot as the form.
    // A separate status read could accept stale profile data after a concurrent edit.
    const [mailbox, completion, preferences, documents, consents] = await Promise.all([
      api<MailboxStatus>('mail/status'),
      api<{ percentage: number; missingFields: string[]; readinessStatus: string }>('me/profile/completion'),
      api<User['preferences'] & { revision: number }>('me/preferences'),
      api<{ id: string; originalName?: string; name?: string; status?: string; createdAt?: string; size?: number }[]>('me/cv'),
      api<{ purpose: string; granted: boolean; policyVersion: string; updatedAt: string }[]>('me/consents'),
    ]);
    return <ProfileDashboard user={user} mailbox={mailbox} completion={completion} preferences={preferences} documents={documents} consents={consents} />;
  }
  if (section === 'preferences') {
    const preferences = await api<User['preferences'] & { revision: number }>('me/preferences');
    return (
      <div className="panel">
        <h2>
          What does your next role look like?
        </h2>
        <p>
          Keep your preferences current to improve your matches. Automation
          remains off until all required services and consents are ready.
        </p>
        <SmartForm
          endpoint="me/preferences"
          method="PUT"
          key={preferences.revision}
          initial={preferences}
          expectedRevision={preferences.revision}
          fields={[
            { name: 'roles', label: 'Target job titles', type: 'list' },
            {
              name: 'relatedRoles',
              label: 'Accepted related roles',
              type: 'list',
              required: false,
            },
            {
              name: 'countries',
              label: 'Preferred countries',
              type: 'list',
              required: false,
            },
            {
              name: 'modes',
              label: 'Work arrangements',
              type: 'list',
              hint: 'Remote, Hybrid, On-site',
              required: false,
            },
            {
              name: 'exclusions',
              label: 'Excluded titles or employers',
              type: 'list',
              required: false,
            },
            {
              name: 'dailyCap',
              label: 'Your daily application cap',
              type: 'number',
            },
            {
              name: 'automation',
              label: 'Enable automatic applications with my explicit consent',
              type: 'checkbox',
            },
          ]}
        />
      </div>
    );
  }
  if (section === 'saved') {
    const jobs = await api<PublicJob[]>('me/saved');
    return (
      <div className="stack">
        {!jobs.length ? (
          <Empty
            title="Make room for your next opportunity"
            text="Save jobs from the discovery page and come back when you’re ready."
          />
        ) : (
          jobs
            .filter((j): j is PublicJob => !!j)
            .map((j) => (
              <div className="panel" key={j.id}>
                <span className="pill">{j.category}</span>
                <h2 style={{ marginTop: 15 }}>
                  <Link href={'/jobs/' + j.id}>{j.title}</Link>
                </h2>
                <p>
                  {j.city} · {j.mode}
                </p>
              </div>
            ))
        )}
      </div>
    );
  }
  if (section === 'alerts') {
    const searches = await api<{ id: string; name: string; query: string; country: string; mode: string; enabled: boolean }[]>('me/saved-searches');
    return <SavedSearchManager searches={searches} />;
  }
  if (section === 'notifications') {
    const [notifications, preferences] = await Promise.all([
      api<{ id: string; type: string; title: string; message: string; href: string; read: boolean; createdAt: string }[]>('me/notifications'),
      api<{ inApp: boolean; email: boolean; whatsapp: boolean; unsubscribeAll: boolean; types: Record<string, boolean> }>('me/notification-preferences'),
    ]);
    return <NotificationCenter notifications={notifications} preferences={preferences} />;
  }
  if (section === 'assistant') return <AssistantPanel />;
  if (section === 'taxonomy') return <TaxonomyLookup />;
  if (section === 'insights') {
    const [completion, usage] = await Promise.all([api<RecordRow>('me/profile/completion'), api<RecordRow>('me/usage')]);
    return <div className="stack"><div className="panel"><h2>Profile completion</h2><p>These readiness checks come from the backend policy used by onboarding and matching.</p><pre>{JSON.stringify(completion, null, 2)}</pre></div><div className="panel"><h2>Plan usage and entitlements</h2><p>Your effective limits and current subscription state.</p><pre>{JSON.stringify(usage, null, 2)}</pre></div></div>;
  }
  if (section === 'cv-versions') {
    const versions = await api<RecordRow[]>('me/cv-versions');
    return <div className="stack"><div className="panel"><h2>Create an ATS-friendly CV version</h2><p>This uses only your confirmed profile. Review the summary before saving.</p><SmartForm endpoint="me/cv-versions" preservedFields={{profile:user.profile,confirmed:true}} fields={[{name:'name',label:'Version name'},{name:'targetRole',label:'Target role',required:false},{name:'summary',label:'Professional summary',type:'textarea',hint:'At least 20 characters; use confirmed facts only.'}]} submit="Save CV version" /></div>{versions.length ? versions.map(version=><div className="panel" key={version.id}><span className="pill">{display(version.source)}</span><h2 style={{marginTop:12}}>{display(version.name)}</h2><p>{display(version.targetRole)}</p><p>{display(version.summary)}</p><Action endpoint={`me/cv-versions/${version.id}`} method="DELETE" label="Delete version" confirm /></div>):<div className="panel"><h2>No saved versions</h2><p>Create a version after confirming your candidate profile.</p></div>}</div>;
  }
  if (section === 'applications') {
    const apps = await api<RecordRow[]>('applications');
    return (
      <>
        <p>
          Your application record distinguishes platform submissions, external
          progress and email delivery.
        </p>
        {!apps.length ? (
          <Empty
            title="Your application story starts here"
            text="Find a role that fits you, confirm your profile and apply."
          />
        ) : (
          apps.map((a) => (
            <div className="panel" key={a.id}>
              <span className="pill">
                {display(a.status).replaceAll('_', ' ')}
              </span>
              <h2 style={{ marginTop: 12 }}>
                {display((a.job as { title: string }).title)}
              </h2>
              <p className="small">
                {new Date(display(a.createdAt)).toLocaleString('en-IN')}
              </p>
              <ol>
                {(a.events as { status: string; at: string }[]).map((e, i) => (
                  <li key={i}>
                    {e.status.replaceAll('_', ' ')} ·{' '}
                    {new Date(e.at).toLocaleString('en-IN')}
                  </li>
                ))}
              </ol>
              <div className="actions">
                {a.status === 'EXTERNAL_STARTED' && (
                  <Action
                    endpoint={`applications/${a.id}/confirm-external`}
                    label="I submitted on the employer website"
                  />
                )}
                {a.status === 'QUEUED' && (
                  <Action
                    endpoint={`applications/${a.id}/cancel`}
                    label="Cancel queued application"
                  />
                )}
                {[
                  'DIRECT_SUBMITTED',
                  'EXTERNAL_STARTED',
                  'SHORTLISTED',
                  'VIEWED',
                  'INTERVIEW',
                ].includes(display(a.status)) && (
                  <Action
                    endpoint={`applications/${a.id}/withdraw`}
                    label="Withdraw application"
                    confirm
                  />
                )}
              </div>
            </div>
          ))
        )}
      </>
    );
  }
  if (section === 'templates') {
    const saved = await api<RecordRow | null>('me/templates');
    return (
      <div className="panel">
        <h2>A message that sounds like you</h2>
        <p>
          Supported fields: {'{{name}}'} and {'{{job_title}}'}. Review the text
          and never include claims you cannot substantiate.
        </p>
        <SmartForm
          endpoint="me/templates"
          method="PUT"
          initial={
            saved || {
              subject: 'Application for {{job_title}}',
              body: 'Hello,\nI would like to apply for {{job_title}}. Please consider my confirmed profile.\nThank you,\n{{name}}',
              signature: user.name,
            }
          }
          fields={[
            { name: 'subject', label: 'Subject' },
            { name: 'signature', label: 'Signature' },
            { name: 'body', label: 'Message', type: 'textarea' },
          ]}
        />
      </div>
    );
  }
  if (section === 'automation') {
    const automation = await api<RecordRow & { revision: number; executionAvailable: boolean }>('me/automation-preferences');
    const mailbox = await api<MailboxStatus>('mail/status');
    return <div className="stack"><GmailConnection initial={mailbox} compact /><div className="panel"><span className="pill">{automation.executionAvailable && mailbox.connected ? 'Execution available' : 'Execution paused'}</span><h2 style={{marginTop: 15}}>Application automation controls</h2><p>Automation uses only confirmed facts, eligible jobs, your consent, a connected email account, and the daily cap you choose. Development testing never sends a real job application automatically.</p><SmartForm endpoint="me/automation-preferences" method="PUT" initial={automation} expectedRevision={automation.revision} requirements={[{field:'enabled',satisfied:mailbox.connected,message:'Connect your email account first to enable automatic applications.',href:'/mail',action:'Connect Email'}]} fields={[{name:'enabled',label:'Enable Automatic Job Applications',type:'checkbox'},{name:'paused',label:'Pause all automated applications',type:'checkbox'},{name:'dailyCap',label:'Maximum applications per day',type:'number'},{name:'allowedRoleFamilies',label:'Allowed occupation IDs',type:'list',required:false},{name:'excludedRoles',label:'Excluded role names',type:'list',required:false},{name:'allowedLocations',label:'Allowed location IDs',type:'list',required:false},{name:'excludedLocations',label:'Excluded location IDs',type:'list',required:false},{name:'workModes',label:'Work arrangements',type:'list',required:false},{name:'employmentTypes',label:'Employment types',type:'list',required:false}]} /></div></div>;
  }
  if (section === 'cvs') {
    const documents = await api<RecordRow[]>('me/cv');
    return <CvManager documents={documents as never[]} profileRevision={user.profileRevision ?? 0} currentProfile={user.profile} />;
  }
  if (section === 'mail') {
    const mailbox = await api<MailboxStatus>('mail/status');
    return <GmailConnection initial={mailbox} />;
  }
  if (section === 'billing') {
    const subscription = await api<{ plan: { name: string; dailyCap: number; cvs: number; delayMinutes: number }; subscriptionStatus: string; subscription: { currentPeriodStart:string; currentPeriodEnd: string; nextBillingAt?:string; autoRenew:boolean; cancelAtPeriodEnd: boolean; providerSubscriptionId?:string } | null; limits: { applicationsPerDay: number; autoApplyPerDay: number; cvVersions: number } }>('me/subscription');
    const history = await api<RecordRow[]>('billing/history');
    const plan = subscription.plan;
    return (
      <div className="panel">
        <span className="pill">{plan.name} · {subscription.subscriptionStatus.replaceAll('_', ' ')}</span>
        <h2 style={{ marginTop: 20 }}>Your plan and usage</h2>
        <p>
          {subscription.limits.applicationsPerDay} applications per UTC day · {subscription.limits.cvVersions} CV versions ·{' '}
          {plan.delayMinutes} minute scheduling delay for eligible automation.
        </p>
        <Link href="/pricing" className="primary">
          Compare plans
        </Link>
        {subscription.subscription && <><p>Current billing period: {new Date(subscription.subscription.currentPeriodStart).toLocaleDateString('en-IN')} – {new Date(subscription.subscription.currentPeriodEnd).toLocaleDateString('en-IN')}.</p><p>Auto-renewal: {subscription.subscription.autoRenew?'On':'Off'}{subscription.subscription.nextBillingAt?` · Next billing ${new Date(subscription.subscription.nextBillingAt).toLocaleDateString('en-IN')}`:''}{subscription.subscription.cancelAtPeriodEnd?' · Cancels at period end':''}</p>{subscription.subscription.providerSubscriptionId&&!subscription.subscription.cancelAtPeriodEnd&&<Action endpoint="billing/subscriptions/cancel" label="Cancel Renewal" confirm />}</>}
        <h3 style={{ marginTop: 25 }}>Billing history</h3>
        {history.length ? <ul>{history.map(row => <li key={row.id}>{display(row.type)} · {display(row.currency)} {(Number(row.amount || 0) / 100).toFixed(2)} · {new Date(display(row.createdAt)).toLocaleString('en-IN')}</li>)}</ul> : <p>No billing activity yet.</p>}
      </div>
    );
  }
  if (section === 'settings') {
    const consents = await api<{ purpose: string; granted: boolean; policyVersion: string; updatedAt: string }[]>('me/consents');
    return (
      <div className="stack">
      <div className="panel">
        <h2>Your data belongs to you</h2>
        <p>
          Download your profile, preferences and application records, or request
          account deletion.
        </p>
        <div className="actions">
          <a
            className="secondary"
            href="/api/v1/me/export"
            download="skillonit-data.json"
          >
            Export my data
          </a>
          <Action
            endpoint="me/delete-request"
            label="Request account deletion"
            confirm
          />
        </div>
      </div>
      <ConsentManager consents={consents} />
      </div>
    );
  }
  const [dashboard, completion, onboarding, mailbox, subscription, notifications, documents] = await Promise.all([api<{
    apps: RecordRow[];
    saved: RecordRow[];
    matches: {
      job: PublicJob;
      match: { score: number; reasons: (string | null)[] };
    }[];
  }>('me/dashboard'), api<{percentage:number;missingFields:string[];readinessStatus:string}>('me/profile/completion'), api<{completeness:number;completed:boolean;steps:{name:string;complete:boolean;optional:boolean}[]}>('me/onboarding'), api<MailboxStatus>('mail/status'), api<{plan:{name:string};subscriptionStatus:string;limits:{applicationsPerDay:number;autoApplyPerDay:number;cvVersions:number}}>('me/subscription'), api<{id:string;title:string;message:string;href:string;read:boolean;createdAt:string}[]>('me/notifications'), api<RecordRow[]>('me/cv')]);
  return <CandidateDashboard user={user} dashboard={dashboard as never} completion={completion} onboarding={onboarding} mailboxConnected={mailbox.connected} subscription={subscription} notifications={notifications} cvCount={documents.filter(document => document.status === 'confirmed').length} />;
}
async function Employer({ section, user }: { section: string; user: User }) {
  const org = await api<RecordRow | null>('employers');
  if (section === 'employer/organization')
    return (
      <div className="panel">
        <h2>Introduce your organization</h2>
        <p>
          Verification status: {display(org?.status || 'Not submitted')}. A
          moderator reviews organization identity before vacancies are
          published.
        </p>
        <SmartForm
          endpoint="employers"
          method={org ? 'PUT' : 'POST'}
          initial={org || { country: 'India' }}
          expectedRevision={org && typeof org.revision === 'number' ? org.revision : undefined}
          fields={[
            { name: 'name', label: 'Organization name' },
            {
              name: 'domain',
              label: 'Company domain',
              hint: 'example.com, without https://',
            },
            { name: 'country', label: 'Country', options: countries },
            {
              name: 'description',
              label: 'About your organization',
              type: 'textarea',
              required: false,
            },
          ]}
          submit="Submit for verification"
        />
      </div>
    );
  if (section === 'employer/post')
    return (
      <div className="panel">
        <h2>Make your next hire a great one.</h2>
        <p>Your vacancy is reviewed before it becomes searchable.</p>
        <SmartForm
          endpoint="employer/jobs"
          initial={{
            country: 'India',
            currency: 'INR',
            mode: 'Hybrid',
            type: 'Full-time',
            method: 'direct',
            experienceMin: 0,
            experienceMax: 3,
            salaryMin: 0,
            salaryMax: 0,
          }}
          fields={[
            { name: 'title', label: 'Job title' },
            {
              name: 'category',
              label: 'Industry / function',
              options: categories,
            },
            { name: 'country', label: 'Country', options: countries },
            { name: 'state', label: 'State or region', required: false },
            { name: 'city', label: 'City' },
            {
              name: 'mode',
              label: 'Work arrangement',
              options: ['Remote', 'Hybrid', 'On-site'],
            },
            {
              name: 'type',
              label: 'Employment type',
              options: [
                'Full-time',
                'Part-time',
                'Contract',
                'Internship',
                'Graduate',
              ],
            },
            { name: 'skills', label: 'Required skills', type: 'list' },
            {
              name: 'experienceMin',
              label: 'Minimum experience (years)',
              type: 'number',
            },
            {
              name: 'experienceMax',
              label: 'Maximum experience (years)',
              type: 'number',
            },
            {
              name: 'salaryMin',
              label: 'Minimum annual salary',
              type: 'number',
            },
            {
              name: 'salaryMax',
              label: 'Maximum annual salary',
              type: 'number',
            },
            {
              name: 'currency',
              label: 'Currency',
              options: ['INR', 'USD', 'GBP', 'EUR', 'CAD', 'AUD', 'SGD', 'AED'],
            },
            {
              name: 'method',
              label: 'Application method',
              options: ['direct'],
            },
            { name: 'description', label: 'Job description', type: 'textarea' },
            {
              name: 'requirements',
              label: 'Qualifications and requirements',
              type: 'textarea',
            },
          ]}
          submit="Submit vacancy for review"
        />
      </div>
    );
  if (section === 'employer/team')
    return (
      <div className="panel">
        <h2>Your recruiting team</h2>
        <p>{user.name} · Organization owner</p>
        <p>
          Team invitations are unavailable until the notification provider and
          seat entitlements are configured.
        </p>
      </div>
    );
  if (section === 'employer/billing')
    return (
      <div className="panel">
        <h2>Employer subscriptions</h2>
        <p>
          Employer prices, active-job allowances and recruiter seats require
          commercial configuration before checkout opens.
        </p>
        <Link className="primary" href="/contact">
          Contact SkillonIT
        </Link>
      </div>
    );
  if (section === 'employer/applicants') {
    const apps = await api<RecordRow[]>('employer/applicants');
    return (
      <>
        {apps.length ? (
          apps.map((a) => (
            <div className="panel" key={a.id}>
              <h2>{display((a.job as { title: string }).title)}</h2>
              <p>{display(a.status)}</p>
              <SmartForm
                endpoint={'employer/applicants/' + a.id}
                method="PATCH"
                fields={[
                  {
                    name: 'status',
                    label: 'Applicant status',
                    options: [
                      'VIEWED',
                      'SHORTLISTED',
                      'INTERVIEW',
                      'OFFER',
                      'REJECTED',
                    ],
                  },
                ]}
                submit="Update status"
              />
            </div>
          ))
        ) : (
          <Empty
            title="Applications will appear here"
            text="Publish a verified vacancy to start receiving direct applications."
          />
        )}
      </>
    );
  }
  const jobs = await api<PublicJob[]>('employer/jobs');
  return (
    <>
      <div className="panel">
        <h2>{org ? display(org.name) : 'Welcome to your hiring workspace'}</h2>
        <p>
          {org
            ? 'Organization status: ' + display(org.status)
            : 'Start by creating and verifying your organization profile.'}
        </p>
        <div className="actions">
          <Link className="primary" href="/employer/organization">
            Organization profile
          </Link>
          <Link className="secondary" href="/employer/post">
            Post a vacancy
          </Link>
        </div>
      </div>
      {jobs.length ? (
        jobs.map((j) => (
          <div className="panel" key={j.id}>
            <span className="pill">{j.status}</span>
            <h2 style={{ marginTop: 15 }}>{j.title}</h2>
            <p>
              {j.city} · {j.mode}
            </p>
            {j.status !== 'closed' && (
              <Action
                endpoint={'employer/jobs/' + j.id}
                method="PATCH"
                label="Close vacancy"
                confirm
              />
            )}
          </div>
        ))
      ) : (
        <Empty
          title="Your hiring pipeline starts here"
          text="Create a structured vacancy and submit it for review."
        />
      )}
    </>
  );
}
async function Admin({
  section,
  user: _user,
  permissions,
}: {
  section: string;
  user: User;
  permissions: string[];
}) {
  const segment = section.split('/')[1];
  if (!segment) {
    return <AdminConsolePanel section="overview" />;
  }
  if (segment === 'roles') return <AdminRolesPanel />;
  if (['users', 'employers', 'jobs', 'sources', 'applications', 'fraud', 'audit'].includes(segment))
    return <AdminConsolePanel section={segment} />;
  if (segment === 'payments' || segment === 'subscriptions') return <AdminBillingPanel mode={segment} canRefund={permissions.includes('payments.refund')} canManageSubscriptions={permissions.includes('subscriptions.manage')} />;
  const operational: Record<string, { endpoint: string; title: string; description: string }> = {
    queues: { endpoint: 'admin/queue/status', title: 'Queue and worker health', description: 'Live queue state from the existing worker infrastructure.' },
    health: { endpoint: 'admin/observability', title: 'System health', description: 'Provider-safe operational status. Credentials and raw provider responses are never displayed.' },
    matching: { endpoint: 'admin/matching-policy', title: 'Matching policy', description: 'Current revision and matching configuration from the backend source of truth.' },
    notifications: { endpoint: 'admin/notification-templates', title: 'Notification operations', description: 'Approved notification templates and delivery configuration.' },
    settings: { endpoint: 'admin/console/configuration', title: 'Platform configuration', description: 'Revision status for administrator-controlled platform policies.' },
  };
  if (operational[segment]) {
    const item = operational[segment];
    let value: unknown;
    try {
      value = await api<unknown>(item.endpoint);
    } catch {
      return <Empty title={`${item.title} unavailable`} text="The backend service is unavailable or not configured. No synthetic operational data is shown." />;
    }
    return <div className="admin-card"><div className="admin-card-head"><div><div className="eyebrow">ADMIN OPERATIONS</div><h2>{item.title}</h2><p>{item.description}</p></div></div><pre className="admin-safe-json">{JSON.stringify(value, null, 2)}</pre></div>;
  }
  if (segment === 'plans') {
    const p = await configuredPlans();
    const summary = await api<{items:{code:string;subscriberCount:number;razorpayPlanId:string|null;status:string;billingPeriod:string;billingInterval:number}[]}>('admin/plans/summary');
    return <PlanEditor initial={p} summary={summary.items} canUpdate={permissions.includes('plans.update')} />;
  }
  const collections: Record<string, string> = {
    leads: 'leads',
    content: 'content',
    flags: 'systemConfig',
    queues: 'queue',
    audit: 'auditLogs',
    privacy: 'privacyRequests',
  };
  const c = collections[segment];
  if (!c)
    return (
      <Empty
        title="Section unavailable"
        text="Choose an operational section from the navigation."
      />
    );
  const rows = await api<RecordRow[]>('admin/' + segment);
  if (!rows.length)
    return (
      <Empty
        title={'No ' + segment + ' records yet'}
        text="Records will appear when this workflow receives data. Unconfigured providers do not generate synthetic activity."
      />
    );
  const actions: Record<string, string[]> = {
    employers: ['verified', 'rejected'],
    jobs: ['published', 'disabled', 'closed'],
    fraud: ['resolved', 'rejected'],
    leads: ['contacted', 'resolved'],
    privacy: ['resolved'],
  };
  return (
    <div className="stack">
      {rows.map((row) => (
        <div className="panel" key={row.id}>
          <h2 style={{ fontSize: 19 }}>
            {display(
              row.title || row.name || row.subject || row.action || row.id,
            )}
          </h2>
          <p className="small">
            {display(
              row.email || row.domain || row.event || row.entityId || '',
            )}{' '}
            {row.status ? ' · ' + display(row.status) : ''}
          </p>
          {!!row.message && <p>{display(row.message)}</p>}
          {!!row.reason && <p>{display(row.reason)}</p>}
          {!!row.createdAt && (
            <p className="small">
              {new Date(display(row.createdAt)).toLocaleString('en-IN')}
            </p>
          )}
          {actions[segment] && (
            <SmartForm
              endpoint={`admin/${segment}/${row.id}`}
              method="PATCH"
              fields={[
                {
                  name: 'status',
                  label: 'Review decision',
                  options: actions[segment],
                },
                { name: 'note', label: 'Review note', required: false },
              ]}
              submit="Record decision"
            />
          )}
        </div>
      ))}
    </div>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{text}</p>
      <Link href="/" className="secondary">
        Explore opportunities
      </Link>
    </div>
  );
}
