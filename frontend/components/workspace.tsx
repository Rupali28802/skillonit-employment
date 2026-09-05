import { display } from '@/lib/display';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api';
import { api, configuredPlans, demoMode } from '@/lib/api';
import { type PublicJob, type User, countries, categories } from '@/lib/domain';
import { SmartForm, Action } from './forms';
import { PlanEditor } from './admin-config';
import {
  CVLibrary,
  SavedSearches,
  NotificationCenter,
  SearchAssistant,
  type CVVersion,
  type SavedSearch,
  type Notification,
} from './candidate-tools';
type RecordRow = { id: string; [key: string]: unknown };
const candidateLinks = [
  ['dashboard', 'Overview'],
  ['profile', 'My profile'],
  ['preferences', 'Job preferences'],
  ['saved', 'Saved jobs'],
  ['saved-searches', 'Saved searches'],
  ['notifications', 'Notifications'],
  ['assistant', 'Search assistant'],
  ['applications', 'Applications'],
  ['cvs', 'My CVs'],
  ['templates', 'Email templates'],
  ['mail', 'Email integration'],
  ['automation', 'Automation'],
  ['billing', 'Billing'],
  ['settings', 'Privacy & settings'],
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
  ...[
    'users',
    'employers',
    'jobs',
    'sources',
    'applications',
    'fraud',
    'plans',
    'payments',
    'leads',
    'content',
    'flags',
    'queues',
    'audit',
    'privacy',
  ].map((s) => ['admin/' + s, s[0].toUpperCase() + s.slice(1)]),
];
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
  const links =
    group === 'admin'
      ? adminLinks
      : group === 'employer'
        ? employerLinks
        : candidateLinks;
  return (
    <div className="page-wrap">
      <div className="section-line">
        <div>
          <div className="eyebrow">{group.toUpperCase()} WORKSPACE</div>
          <h1>{links.find(([p]) => p === section)?.[1] || 'Workspace'}</h1>
        </div>
        <div className="actions">
          <span className="pill">{user.name}</span>
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
          {links.map(([path, label]) => (
            <Link
              key={path}
              href={'/' + path}
              aria-current={section === path ? 'page' : undefined}
              style={
                section === path
                  ? { background: '#e4f0e9', fontWeight: 700 }
                  : undefined
              }
            >
              {label}
            </Link>
          ))}
        </nav>
        <section>
          {group === 'student' ? (
            <Candidate section={section} user={user} />
          ) : group === 'employer' ? (
            <Employer section={section} user={user} />
          ) : (
            <Admin section={section} user={user} />
          )}
        </section>
      </div>
    </div>
  );
}
async function Candidate({ section, user }: { section: string; user: User }) {
  if (section === 'saved-searches')
    return (
      <SavedSearches searches={await api<SavedSearch[]>('me/saved-searches')} />
    );
  if (section === 'notifications')
    return (
      <NotificationCenter
        notifications={await api<Notification[]>('me/notifications')}
        preferences={await api<Record<string, unknown>>(
          'me/notification-preferences',
        )}
      />
    );
  if (section === 'assistant') return <SearchAssistant />;
  if (section === 'cvs')
    return (
      <CVLibrary
        versions={await api<CVVersion[]>('me/cv-versions')}
        profile={user.profile}
      />
    );
  if (section === 'profile')
    return (
      <div className="panel">
        <h2>Your experience, in your words.</h2>
        <p>Only facts you confirm can be used in matching and applications.</p>
        <SmartForm
          endpoint="me/profile"
          method="PUT"
          initial={user.profile}
          fields={[
            { name: 'name', label: 'Full name' },
            { name: 'headline', label: 'Professional headline' },
            {
              name: 'skills',
              label: 'Skills',
              type: 'list',
              hint: 'Separate skills with commas',
            },
            {
              name: 'experience',
              label: 'Years of experience',
              type: 'number',
            },
            { name: 'country', label: 'Country', options: countries },
            { name: 'city', label: 'City' },
            {
              name: 'education',
              label: 'Education and qualifications',
              type: 'textarea',
            },
            {
              name: 'confirmed',
              label:
                'I confirm these details accurately represent my experience.',
              type: 'checkbox',
            },
          ]}
        />
      </div>
    );
  if (section === 'preferences' || section === 'automation')
    return (
      <div className="panel">
        <h2>
          {section === 'automation'
            ? 'You control your applications'
            : 'What does your next role look like?'}
        </h2>
        <p>
          Keep your preferences current to improve your matches. Automation
          remains off until all required services and consents are ready.
        </p>
        <SmartForm
          endpoint="me/preferences"
          method="PUT"
          initial={user.preferences}
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
                <Action
                  endpoint={`jobs/${j.id}/save`}
                  method="DELETE"
                  label="Remove from saved jobs"
                />
              </div>
            ))
        )}
      </div>
    );
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
  if (section === 'mail')
    return (
      <div className="panel">
        <span className="pill">Not connected</span>
        <h2 style={{ marginTop: 20 }}>Your mailbox, with your permission.</h2>
        <p>
          Mailbox integration uses OAuth. SkillonIT will never ask for your
          email password. You can revoke access at any time.
        </p>
        <Action endpoint="mail/connect" label="Connect a mailbox" />
        <p className="small" style={{ marginTop: 20 }}>
          Provider setup is pending. Clicking this control does not grant access
          or send email.
        </p>
      </div>
    );
  if (section === 'billing') {
    const plan = (await configuredPlans()).find((p) => p.code === user.plan)!;
    return (
      <div className="panel">
        <span className="pill">{plan.name}</span>
        <h2 style={{ marginTop: 20 }}>Your plan and usage</h2>
        <p>
          {plan.dailyCap} applications per UTC day · {plan.cvs} CV versions ·{' '}
          {plan.delayMinutes} minute scheduling delay for eligible automation.
        </p>
        <Link href="/pricing" className="primary">
          Compare plans
        </Link>
        <h3 style={{ marginTop: 25 }}>Payments</h3>
        <p>No payment has been taken in this demo.</p>
      </div>
    );
  }
  if (section === 'settings')
    return (
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
    );
  const { apps, saved, matches } = await api<{
    apps: RecordRow[];
    saved: RecordRow[];
    matches: {
      job: PublicJob;
      match: { score: number; reasons: (string | null)[] };
    }[];
  }>('me/dashboard');
  return (
    <>
      <div className="stat-grid">
        {[
          ['Applications', apps.length],
          ['Saved jobs', saved.length],
          ['Profile', user.profile.confirmed ? 'Confirmed' : 'Incomplete'],
        ].map(([label, value]) => (
          <div className="panel" key={label}>
            <strong
              style={typeof value === 'string' ? { fontSize: 22 } : undefined}
            >
              {value}
            </strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {!user.profile.confirmed && (
        <div className="panel">
          <h2>Help your next role find you.</h2>
          <p>Complete your profile to make matching more relevant.</p>
          <Link className="primary" href="/profile">
            Complete my profile
          </Link>
        </div>
      )}
      <div className="section-line">
        <h2>Roles worth exploring</h2>
        <Link href="/preferences">Adjust preferences</Link>
      </div>
      {matches.map(({ job, match }) => (
        <div className="panel" key={job.id}>
          <div className="section-line">
            <h2>
              <Link href={'/jobs/' + job.id}>{job.title}</Link>
            </h2>
            <span className="pill">{match.score}% relevance</span>
          </div>
          <p>
            {job.city} · {job.mode}
          </p>
          <p className="small">
            {match.reasons.join(' · ') ||
              'Add skills and preferences for a more useful match.'}
          </p>
        </div>
      ))}
    </>
  );
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
          initial={org || { country: 'India' }}
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
}: {
  section: string;
  user: User;
}) {
  const segment = section.split('/')[1];
  if (segment === 'flags')
    return (
      <div className="panel">
        <h2>Feature availability</h2>
        <p>
          Pause supported features without changing code. External mail,
          payments and WhatsApp cannot be enabled from this screen until their
          integrations are implemented and verified.
        </p>
        <SmartForm
          endpoint="admin/feature-flags"
          method="PUT"
          initial={await api<Record<string, unknown>>('admin/feature-flags')}
          fields={[
            {
              name: 'assistant',
              label: 'Enable guided search assistant',
              type: 'checkbox',
            },
            {
              name: 'savedSearchAlerts',
              label: 'Enable saved-search match checks',
              type: 'checkbox',
            },
          ]}
        />
      </div>
    );
  if (segment === 'sources') {
    const sources = await api<RecordRow[]>('admin/source-policies');
    return (
      <div className="stack">
        <div className="panel">
          <h2>Governed job sources</h2>
          <p>
            Record permission evidence before enabling a source. Saving a policy
            does not start an external fetch; discovery requires a running
            configured worker.
          </p>
          <SmartForm
            endpoint="admin/source-policies"
            submit="Save source policy"
            fields={[
              { name: 'name', label: 'Source name' },
              { name: 'board', label: 'Greenhouse board identifier' },
              {
                name: 'requestsPerMinute',
                label: 'Maximum requests per minute',
                type: 'number',
              },
              {
                name: 'policyEvidence',
                label: 'Permission evidence and permitted use',
                type: 'textarea',
              },
              {
                name: 'approved',
                label: 'Permission evidence has been reviewed',
                type: 'checkbox',
              },
              {
                name: 'enabled',
                label: 'Enable this approved source',
                type: 'checkbox',
              },
            ]}
            initial={{ requestsPerMinute: 1 }}
          />
        </div>
        {sources.map((source) => (
          <div className="panel" key={source.id}>
            <h3>{display(source.name || source.board)}</h3>
            <span className="pill">
              {source.enabled ? 'Enabled' : 'Disabled'} ·{' '}
              {source.approved ? 'Approved' : 'Needs review'}
            </span>
            <p style={{ marginTop: 12 }}>{display(source.policyEvidence)}</p>
            <p className="small">
              Limit: {display(source.requestsPerMinute)} requests/minute. Policy
              saved; worker execution is tracked separately.
            </p>
          </div>
        ))}
      </div>
    );
  }
  if (segment === 'content')
    return (
      <div className="panel">
        <h2>Public contact and announcements</h2>
        <p>
          Publish business contact details and an optional announcement. Changes
          are recorded in the audit log.
        </p>
        <SmartForm
          endpoint="admin/configuration"
          method="PUT"
          initial={await api<Record<string, unknown>>('admin/configuration')}
          fields={[
            { name: 'email', label: 'Public contact email', type: 'email' },
            { name: 'phone', label: 'Public contact phone', required: false },
            {
              name: 'announcement',
              label: 'Announcement',
              type: 'textarea',
              required: false,
            },
          ]}
        />
      </div>
    );
  if (!segment) {
    const overview = await api<{
      counts: Record<string, number>;
      providers: { name: string; status: string }[];
    }>('admin/overview');
    const counts = {
      users: overview.counts.users,
      jobs: overview.counts.jobs,
      applications: overview.counts.applications,
    };
    return (
      <>
        <div className="stat-grid">
          {Object.entries(counts).map(([k, v]) => (
            <div className="panel" key={k}>
              <strong>{v}</strong>
              <span>{k}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>Service readiness</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {overview.providers.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }
  if (segment === 'plans') {
    const p = await configuredPlans();
    return (
      <div className="panel">
        <h2>Candidate plan configuration</h2>
        <p>
          Initial quotas and delays are development assumptions. Final prices
          have not been set.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Daily cap</th>
                <th>Delay</th>
                <th>Identity</th>
              </tr>
            </thead>
            <tbody>
              {p.map((plan) => (
                <tr key={plan.code}>
                  <td>{plan.name}</td>
                  <td>{plan.dailyCap}</td>
                  <td>{plan.delayMinutes} minutes</td>
                  <td>{plan.identity ? 'Visible' : 'Protected'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PlanEditor initial={p} />
      </div>
    );
  }
  const collections: Record<string, string> = {
    users: 'users',
    employers: 'employers',
    jobs: 'jobs',
    sources: 'jobSources',
    applications: 'applications',
    fraud: 'fraudReports',
    payments: 'payments',
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
