'use client';

import Link from 'next/link';
import { display } from '@/lib/display';
import {
  useEffect,
  useState,
  type ComponentProps,
  type SubmitEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  Bell,
  Plus,
  Search,
} from 'lucide-react';
import { SmartForm, Action } from './forms';
import { NotificationCenter } from './candidate-extras';
import { countries, categories, type User } from '@/lib/domain';

type Company = {
  id: string;
  name: string;
  domain: string;
  country: string;
  description: string;
  website?: string;
  industry?: string;
  headquarters?: string;
  companySize?: string;
  status: string;
  revision: number;
};
type Job = {
  id: string;
  title: string;
  status: string;
  city: string;
  mode: string;
  expiresAt: string;
  discoveredAt: string;
  revision?: number;
  [key: string]: unknown;
};
type Application = {
  id: string;
  jobId: string;
  status: string;
  createdAt: string;
  job: { title: string };
  candidate: {
    name: string;
    headline: string;
    skills: string[];
    experience: number | null;
    education: string;
    country: string;
    city: string;
  } | null;
  cv: { name?: string; versionId?: string } | null;
  events: { status: string; at: string }[];
  allowedTransitions: string[];
};
type Page<T> = { items: T[]; total: number; page: number; pages: number };
type Overview = {
  counts: Record<string, number>;
  recentJobs: Job[];
  recentApplications: Application[];
  subscription: { available: boolean; reason: string };
};
type Notifications = ComponentProps<typeof NotificationCenter>;

async function request<T>(
  path: string,
  method = 'GET',
  payload?: unknown,
): Promise<T> {
  const response = await fetch(
    '/api/v1/' + path,
    method === 'GET'
      ? { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(20000) }
      : {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000),
        },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result?.error?.message ||
        'Could not load your workspace. Please try again.',
    );
  return result.data;
}
function useResource<T>(path: string) {
  const [state, setState] = useState<{
    path?: string;
    revision?: number;
    data?: T;
    error?: string;
  }>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    request<T>(path)
      .then((data) => {
        if (active) setState({ path, revision, data });
      })
      .catch((error) => {
        if (active) setState({ path, revision, error: error.message });
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  const loading = state.path !== path || state.revision !== revision;
  return {
    data: loading ? undefined : state.data,
    error: loading ? undefined : state.error,
    loading,
    reload: () => setRevision((value) => value + 1),
  };
}
function State({
  loading,
  error,
  retry,
  children,
}: {
  loading: boolean;
  error?: string;
  retry: () => void;
  children: ReactNode;
}) {
  if (loading)
    return <output className="panel">Loading your employer workspace…</output>;
  if (error)
    return (
      <div className="panel" role="alert">
        <h2>Unable to load this section</h2>
        <p>{error}</p>
        <button className="secondary" onClick={retry}>
          Retry
        </button>
      </div>
    );
  return <>{children}</>;
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="employer-empty">
      <BriefcaseBusiness aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
const label = (value: string) =>
  value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString() : '—';
function Pager({
  data,
  change,
}: {
  data: { page: number; pages: number; total: number };
  change: (page: number) => void;
}) {
  return (
    <div className="employer-pagination">
      <span>
        {data.total} records · Page {data.page} of {data.pages}
      </span>
      <div className="actions">
        <button
          className="secondary"
          disabled={data.page <= 1}
          onClick={() => change(data.page - 1)}
        >
          Previous
        </button>
        <button
          className="secondary"
          disabled={data.page >= data.pages}
          onClick={() => change(data.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('a[href]') &&
        !window.confirm('Discard unsaved changes?')
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);
}

export function EmployerPortal({
  section,
  user,
}: {
  section: string;
  user: Pick<User, 'name' | 'email'>;
}) {
  if (section === 'employer/organization') return <CompanyProfile />;
  if (section === 'employer/post') return <JobEditor />;
  if (section === 'employer/jobs') return <Jobs />;
  if (section === 'employer/applicants' || section === 'employer/candidates')
    return <Applicants candidates={section.endsWith('candidates')} />;
  if (section === 'employer/notifications') return <EmployerNotifications />;
  if (section === 'employer/settings') return <EmployerSettings user={user} />;
  if (section === 'employer/billing') return <Subscription />;
  if (section === 'employer/team')
    return (
      <div className="panel">
        <h2>Organization owner</h2>
        <p>{user.name}</p>
        <p>Additional recruiter seats are not configured.</p>
      </div>
    );
  return <Dashboard />;
}
function Dashboard() {
  const overview = useResource<Overview>('employer/overview'),
    company = useResource<Company | null>('employers');
  const metrics = [
    ['active', 'Active jobs'],
    ['draft', 'Draft jobs'],
    ['review', 'In review'],
    ['closed', 'Closed jobs'],
    ['expired', 'Expired jobs'],
    ['applications', 'Applications'],
    ['newApplications', 'New applications'],
    ['shortlisted', 'Shortlisted'],
    ['interviews', 'Interviews'],
    ['offers', 'Offers'],
  ];
  return (
    <State
      loading={overview.loading || company.loading}
      error={overview.error || company.error}
      retry={() => {
        overview.reload();
        company.reload();
      }}
    >
      <div className="panel employer-welcome">
        <div>
          <span className="eyebrow">YOUR HIRING WORKSPACE</span>
          <h2>{company.data?.name || 'Build your hiring team'}</h2>
          <p>
            {company.data
              ? `Company verification: ${label(company.data.status)}`
              : 'Complete your company profile to start posting jobs.'}
          </p>
        </div>
        <Link
          className="primary"
          href={company.data ? '/employer/post' : '/employer/organization'}
        >
          <Plus size={16} />
          {company.data ? 'Create job' : 'Complete company profile'}
        </Link>
      </div>
      {overview.data && (
        <>
          <div className="employer-metrics">
            {metrics.map(([key, title]) => (
              <div className="panel" key={key}>
                <span>{title}</span>
                <strong>{overview.data!.counts[key]}</strong>
              </div>
            ))}
          </div>
          <div className="employer-columns">
            <div className="panel">
              <h2>Recent jobs</h2>
              {overview.data.recentJobs.length ? (
                overview.data.recentJobs.map((job) => (
                  <Link
                    className="employer-list-item"
                    key={job.id}
                    href="/employer/jobs"
                  >
                    <strong>{job.title}</strong>
                    <span className="pill">{label(job.status)}</span>
                  </Link>
                ))
              ) : (
                <Empty>No jobs yet. Create a draft to get started.</Empty>
              )}
            </div>
            <div className="panel">
              <h2>Recent applications</h2>
              {overview.data.recentApplications.length ? (
                overview.data.recentApplications.map((app) => (
                  <Link
                    className="employer-list-item"
                    key={app.id}
                    href="/employer/applicants"
                  >
                    <div>
                      <strong>{app.candidate?.name || 'Candidate'}</strong>
                      <p>{app.job.title}</p>
                    </div>
                    <span className="pill">{label(app.status)}</span>
                  </Link>
                ))
              ) : (
                <Empty>Applications to your jobs will appear here.</Empty>
              )}
            </div>
          </div>
          <div className="panel">
            <h2>Subscription</h2>
            <p>{overview.data.subscription.reason}</p>
            <Link href="/employer/billing">Subscription details</Link>
          </div>
        </>
      )}
      <EmployerNotifications compact />
    </State>
  );
}
function CompanyProfile() {
  const router = useRouter();
  const resource = useResource<Company | null>('employers'),
    verification = useResource<{ revision: number; status: string } | null>(
      'employer/verification',
    );
  const [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState('');
  useUnsaved(dirty);
  const cancel = () => {
    if (!dirty || window.confirm('Discard unsaved company changes?')) {
      setEditing(false);
      setDirty(false);
      if (!resource.data) router.push('/employer');
    }
  };
  return (
    <State {...resource} retry={resource.reload}>
      <div className="panel">
        <Building2 aria-hidden="true" />
        <h2>Company profile</h2>
        {message && <output>{message}</output>}
        {resource.data && !editing ? (
          <>
            <div className="section-line">
              <h3>{resource.data.name}</h3>
              <span className="pill">{label(resource.data.status)}</span>
            </div>
            <p>{resource.data.description || 'No description added.'}</p>
            <dl className="employer-details">
              {[
                ['Website', resource.data.website],
                ['Domain', resource.data.domain],
                ['Industry', resource.data.industry],
                ['Company size', resource.data.companySize],
                ['Headquarters', resource.data.headquarters],
                ['Country', resource.data.country],
              ].map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value || 'Not provided'}</dd>
                </div>
              ))}
            </dl>
            <button className="primary" onClick={() => setEditing(true)}>
              Edit company profile
            </button>
          </>
        ) : (
          <div onChange={() => setDirty(true)}>
            <SmartForm
              key={resource.data?.revision ?? 'new'}
              endpoint="employers"
              method={resource.data ? 'PUT' : 'POST'}
              initial={resource.data || { country: 'India' }}
              expectedRevision={resource.data?.revision}
              fields={[
                { name: 'name', label: 'Company name' },
                {
                  name: 'domain',
                  label: 'Company domain',
                  hint: 'example.com',
                },
                {
                  name: 'description',
                  label: 'Company description',
                  type: 'textarea',
                  required: false,
                },
                { name: 'country', label: 'Country', options: countries },
                { name: 'website', label: 'Website (HTTPS)', required: false },
                { name: 'industry', label: 'Industry', required: false },
                {
                  name: 'companySize',
                  label: 'Company size',
                  options: [
                    '1-10',
                    '11-50',
                    '51-200',
                    '201-500',
                    '501-1000',
                    '1001-5000',
                    '5001+',
                  ],
                },
                {
                  name: 'headquarters',
                  label: 'Headquarters',
                  required: false,
                },
              ]}
              onSuccess={() => {
                setDirty(false);
                setEditing(false);
                setMessage('Company profile saved.');
                resource.reload();
                verification.reload();
              }}
            />
            <button className="secondary" type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {resource.data && (
        <div className="panel">
          <h2>Company verification</h2>
          <State {...verification} retry={verification.reload}>
            {verification.data && (
              <SmartForm
                key={verification.data.revision}
                endpoint="employer/verification"
                expectedRevision={verification.data.revision}
                fields={[]}
                preservedFields={{
                  evidence: [
                    { type: 'domain', reference: resource.data.domain },
                    ...(resource.data.website
                      ? [{ type: 'website', reference: resource.data.website }]
                      : []),
                  ],
                }}
                submit="Submit company evidence for review"
                onSuccess={() => {
                  verification.reload();
                  resource.reload();
                }}
                successMessage="Evidence submitted for administrator review."
              />
            )}
          </State>
          <p>
            Company identity and job publication remain subject to verification.
          </p>
        </div>
      )}
    </State>
  );
}
function Jobs() {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [q, setQ] = useState(''),
    [search, setSearch] = useState(''),
    [editing, setEditing] = useState<Job | null>(null),
    [busy, setBusy] = useState(''),
    [message, setMessage] = useState('');
  const resource = useResource<Page<Job>>(
    `employer/jobs?page=${page}&status=${status}&q=${encodeURIComponent(search)}`,
  );
  if (editing)
    return (
      <JobEditor
        initial={editing}
        done={() => {
          setEditing(null);
          resource.reload();
        }}
      />
    );
  return (
    <>
      <div className="section-line">
        <h2>Your jobs</h2>
        <Link className="primary" href="/employer/post">
          <Plus size={16} />
          Create job
        </Link>
      </div>
      <form
        className="employer-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
          setPage(1);
        }}
      >
        <label>
          <span>Search jobs</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title or city"
          />
        </label>
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {[
              'draft',
              'review',
              'published',
              'closed',
              'expired',
              'disabled',
            ].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary">
          <Search size={16} />
          Search
        </button>
      </form>
      {message && <output>{message}</output>}
      <State {...resource} retry={resource.reload}>
        {resource.data && (
          <>
            {resource.data.items.length ? (
              resource.data.items.map((job) => (
                <div className="panel" key={job.id}>
                  <div className="section-line">
                    <h3>{job.title}</h3>
                    <span className="pill">{label(job.status)}</span>
                  </div>
                  <p>
                    {job.city} · {job.mode} · Expires {date(job.expiresAt)}
                  </p>
                  <div className="actions">
                    {!['closed', 'disabled'].includes(job.status) && (
                      <>
                        <button
                          className="secondary"
                          onClick={() => setEditing(job)}
                        >
                          Edit / preview
                        </button>
                        <button
                          className="secondary"
                          disabled={!!busy}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Close “${job.title}”? This removes it from active hiring.`,
                              )
                            )
                              return;
                            setBusy(job.id);
                            setMessage('');
                            try {
                              await request(
                                `employer/jobs/${job.id}/close`,
                                'POST',
                                {},
                              );
                              setMessage('Job closed.');
                              resource.reload();
                            } catch (error) {
                              setMessage((error as Error).message);
                            } finally {
                              setBusy('');
                            }
                          }}
                        >
                          {busy === job.id ? 'Closing…' : 'Close job'}
                        </button>
                      </>
                    )}
                    <Link href="/employer/applicants" className="secondary">
                      Applications
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <Empty>No jobs match your filters.</Empty>
            )}
            <Pager data={resource.data} change={setPage} />
          </>
        )}
      </State>
    </>
  );
}
const jobFields = [
  { name: 'title', label: 'Job title' },
  { name: 'category', label: 'Industry / function', options: categories },
  { name: 'country', label: 'Country', options: countries },
  { name: 'state', label: 'State / region', optional: true },
  { name: 'city', label: 'City' },
  {
    name: 'mode',
    label: 'Work arrangement',
    options: ['Remote', 'Hybrid', 'On-site'],
  },
  {
    name: 'type',
    label: 'Employment type',
    options: ['Full-time', 'Part-time', 'Contract', 'Internship', 'Graduate'],
  },
  { name: 'skills', label: 'Required skills (comma separated)' },
  { name: 'experienceMin', label: 'Minimum experience (years)', number: true },
  { name: 'experienceMax', label: 'Maximum experience (years)', number: true },
  { name: 'salaryMin', label: 'Minimum salary', number: true },
  { name: 'salaryMax', label: 'Maximum salary', number: true },
  {
    name: 'currency',
    label: 'Currency',
    options: ['INR', 'USD', 'GBP', 'EUR', 'CAD', 'AUD', 'SGD', 'AED'],
  },
  {
    name: 'method',
    label: 'Application method',
    options: ['direct', 'external', 'email'],
  },
  {
    name: 'url',
    label: 'Application URL (HTTPS, external applications)',
    optional: true,
  },
  {
    name: 'email',
    label: 'Recruitment email (email applications)',
    optional: true,
  },
  { name: 'description', label: 'Job description', multiline: true },
  {
    name: 'requirements',
    label: 'Qualifications and requirements',
    multiline: true,
  },
];
function JobEditor({ initial, done }: { initial?: Job; done?: () => void }) {
  const router = useRouter(),
    [preview, setPreview] = useState<Record<string, unknown> | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useUnsaved(dirty);
  const [submission, setSubmission] = useState<'draft' | 'review'>('review');
  const [record, setRecord] = useState(initial);
  const defaults: Record<string, unknown> = record || {
    country: 'India',
    currency: 'INR',
    mode: 'Hybrid',
    type: 'Full-time',
    experienceMin: 0,
    experienceMax: 3,
    salaryMin: 0,
    salaryMax: 0,
  };
  const matching = record?.matching as Record<string, unknown> | undefined;
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value: Record<string, unknown> = {};
    for (const field of jobFields)
      value[field.name] = field.number
        ? Number(form.get(field.name))
        : field.name === 'skills'
          ? display(form.get(field.name))
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : display(form.get(field.name) || '');
    if (!value.url) delete value.url;
    if (!value.email) delete value.email;
    value.matching = {
      ...matching,
      requiredEducationLevels: display(form.get('educationLevels'))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      occupationId: display(form.get('occupationId')) || undefined,
      locationId: display(form.get('locationId')) || undefined,
    };
    if (
      Number(value.salaryMax) < Number(value.salaryMin) ||
      Number(value.experienceMax) < Number(value.experienceMin)
    ) {
      setMessage('Maximum salary and experience must be at least the minimum.');
      return;
    }
    setMessage('');
    setPreview(value);
  };
  const save = async () => {
    if (
      !preview ||
      (submission === 'review' &&
        !window.confirm(
          'Submit this job for moderation? It will become public only after approval.',
        ))
    )
      return;
    setBusy(true);
    try {
      const result = await request<Job>(
        record ? `employer/jobs/${record.id}` : 'employer/jobs',
        record ? 'PUT' : 'POST',
        {
          ...preview,
          submission,
          ...(record ? { expectedRevision: record.revision ?? 0 } : {}),
        },
      );
      setRecord(result);
      setDirty(false);
      setPreview(null);
      setMessage(
        submission === 'draft'
          ? 'Draft saved.'
          : 'Job submitted for moderation.',
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <button
        className="secondary"
        onClick={() => {
          if (!dirty || window.confirm('Discard unsaved job changes?')) {
            if (done) done();
            else router.push('/employer/jobs');
          }
        }}
      >
        <ArrowLeft size={16} />
        Back to jobs
      </button>
      <h2>{record ? 'Edit job' : 'Create a job'}</h2>
      <p>
        Complete the fields, preview your job, then save a draft or submit for
        moderation. Publication requires approval.
      </p>
      {message && <output>{message}</output>}
      <form
        onSubmit={submit}
        onChange={() => setDirty(true)}
        hidden={!!preview}
        key={`${record?.id || 'new'}:${record?.revision || 0}`}
      >
        <div className="form-grid">
          {jobFields.map((field) => (
            <label
              key={field.name}
              style={field.multiline ? { gridColumn: '1/-1' } : undefined}
            >
              {field.label}
              {field.options ? (
                <select
                  name={field.name}
                  defaultValue={display(
                    defaults[field.name] || field.options[0],
                  )}
                >
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : field.multiline ? (
                <textarea
                  name={field.name}
                  required
                  minLength={field.name === 'description' ? 30 : 10}
                  maxLength={field.name === 'description' ? 15000 : 10000}
                  defaultValue={display(defaults[field.name] || '')}
                />
              ) : (
                <input
                  name={field.name}
                  type={field.number ? 'number' : 'text'}
                  min={field.number ? 0 : undefined}
                  max={field.name.startsWith('experience') ? 70 : undefined}
                  step={field.number ? 'any' : undefined}
                  required={!field.optional}
                  defaultValue={
                    Array.isArray(defaults[field.name])
                      ? (defaults[field.name] as string[]).join(', ')
                      : display(defaults[field.name] ?? '')
                  }
                />
              )}
            </label>
          ))}
          <TaxonomyPicker
            kind="occupations"
            name="occupationId"
            initial={display(matching?.occupationId || '')}
          />
          <TaxonomyPicker
            kind="locations"
            name="locationId"
            initial={display(matching?.locationId || '')}
          />
          <label>
            Required education levels (comma separated)
            <input
              name="educationLevels"
              defaultValue={
                Array.isArray(matching?.requiredEducationLevels)
                  ? matching.requiredEducationLevels.join(', ')
                  : ''
              }
            />
          </label>
        </div>
        <p>
          External applications require an HTTPS URL; email applications require
          a recruitment email. Taxonomy references are validated by the server.
        </p>
        <button className="primary" type="submit">
          Preview job
        </button>
      </form>
      {preview && (
        <div>
          <h3>{display(preview.title)}</h3>
          <p>
            {display(preview.city)} · {display(preview.country)} ·{' '}
            {display(preview.mode)}
          </p>
          <dl className="employer-details">
            {Object.entries(preview)
              .filter(([key]) => key !== 'matching')
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, ' $1')}</dt>
                  <dd>
                    {Array.isArray(value) ? value.join(', ') : display(value)}
                  </dd>
                </div>
              ))}
          </dl>
          <label>
            Save option
            <select
              value={submission}
              onChange={(e) =>
                setSubmission(e.target.value as 'draft' | 'review')
              }
              disabled={busy}
            >
              {(!record || record.status === 'draft') && (
                <option value="draft">Save draft</option>
              )}
              <option value="review">Submit for moderation</option>
            </select>
          </label>
          <div className="actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Back to editing
            </button>
            <button className="primary" disabled={busy} onClick={save}>
              {busy
                ? 'Saving…'
                : submission === 'draft'
                  ? 'Save draft'
                  : 'Confirm submission'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function Applicants({ candidates }: { candidates: boolean }) {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [q, setQ] = useState(''),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<string | null>(null);
  const resource = useResource<Page<Application>>(
    `employer/applicants?page=${page}&status=${status}&q=${encodeURIComponent(search)}`,
  );
  if (selected)
    return (
      <ApplicantDetails
        id={selected}
        close={() => {
          setSelected(null);
          resource.reload();
        }}
      />
    );
  return (
    <>
      <h2>
        {candidates ? 'Candidates who applied to your jobs' : 'Applications'}
      </h2>
      <p>
        Only candidate information shared through applications to your company
        is available.
      </p>
      <form
        className="employer-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
          setPage(1);
        }}
      >
        <label>
          Search
          <input
            placeholder="Candidate, skill or job"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          Stage
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All stages</option>
            {[
              'DIRECT_SUBMITTED',
              'VIEWED',
              'SHORTLISTED',
              'INTERVIEW',
              'OFFER',
              'REJECTED',
              'WITHDRAWN',
            ].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary">Search</button>
      </form>
      <State {...resource} retry={resource.reload}>
        {resource.data && (
          <>
            {resource.data.items.length ? (
              <div className="employer-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Job</th>
                      <th>Applied</th>
                      <th>Stage</th>
                      <th>CV</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.data.items.map((app) => (
                      <tr key={app.id}>
                        <td>{app.candidate?.name || 'Candidate'}</td>
                        <td>{app.job.title}</td>
                        <td>{date(app.createdAt)}</td>
                        <td>
                          <span className="pill">{label(app.status)}</span>
                        </td>
                        <td>{app.cv ? 'Provided' : 'Not provided'}</td>
                        <td>
                          <button
                            className="secondary"
                            onClick={() => setSelected(app.id)}
                          >
                            View application
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No applications match your filters.</Empty>
            )}
            <Pager data={resource.data} change={setPage} />
          </>
        )}
      </State>
    </>
  );
}
function ApplicantDetails({ id, close }: { id: string; close: () => void }) {
  const resource = useResource<Application>('employer/applicants/' + id),
    notes = useResource<{ id: string; note: string; createdAt: string }[]>(
      `employer/applicants/${id}/notes`,
    );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <>
      <button className="secondary" onClick={close}>
        Back to applications
      </button>
      <State {...resource} retry={resource.reload}>
        {resource.data && (
          <div className="panel">
            <h2>{resource.data.candidate?.name || 'Candidate'}</h2>
            <p>
              {resource.data.job.title} · {label(resource.data.status)}
            </p>
            {resource.data.candidate && (
              <dl className="employer-details">
                {Object.entries(resource.data.candidate).map(([key, value]) => (
                  <div key={key}>
                    <dt>{label(key)}</dt>
                    <dd>
                      {Array.isArray(value)
                        ? value.join(', ')
                        : display(value ?? 'Not provided')}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p>
              CV: {resource.data.cv?.name || 'Not provided'}.{' '}
              {resource.data.cv &&
                'CV file access is not available through the current employer API.'}
            </p>
            <p>
              Last updated:{' '}
              {date(resource.data.events.at(-1)?.at || resource.data.createdAt)}
            </p>
            <div className="actions">
              {(resource.data.allowedTransitions || []).map((status) => (
                <button
                  className="secondary"
                  disabled={busy}
                  key={status}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Move this application to ${label(status)}?`,
                      )
                    )
                      return;
                    setBusy(true);
                    setMessage('');
                    try {
                      await request(`employer/applicants/${id}`, 'PATCH', {
                        status,
                        expectedStatus: resource.data!.status,
                      });
                      setMessage(`Application moved to ${label(status)}.`);
                      resource.reload();
                    } catch (error) {
                      setMessage((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {label(status)}
                </button>
              ))}
            </div>
            {message && <output>{message}</output>}
            <h3>Application history</h3>
            <ul>
              {resource.data.events.map((event, index) => (
                <li key={index}>
                  {label(event.status)} · {date(event.at)}
                </li>
              ))}
            </ul>
            <h3>Recruiter notes</h3>
            <State {...notes} retry={notes.reload}>
              {notes.data?.length ? (
                notes.data.map((note) => (
                  <p key={note.id}>
                    {note.note} <small>· {date(note.createdAt)}</small>
                  </p>
                ))
              ) : (
                <p>No notes yet.</p>
              )}
            </State>
            <SmartForm
              endpoint={`employer/applicants/${id}/notes`}
              fields={[{ name: 'note', label: 'Add a note', type: 'textarea' }]}
              submit="Save note"
              onSuccess={notes.reload}
            />
          </div>
        )}
      </State>
    </>
  );
}
function EmployerNotifications({ compact = false }: { compact?: boolean }) {
  const items = useResource<Notifications['notifications']>('me/notifications'),
    preferences = useResource<Notifications['preferences']>(
      'me/notification-preferences',
    );
  return (
    <State
      loading={items.loading || preferences.loading}
      error={items.error || preferences.error}
      retry={() => {
        items.reload();
        preferences.reload();
      }}
    >
      {items.data &&
        preferences.data &&
        (compact ? (
          <div className="panel">
            <h2>
              <Bell size={19} />
              Important notifications
            </h2>
            {items.data
              .filter((item) => !item.read)
              .slice(0, 3)
              .map((item) => (
                <p key={item.id}>
                  <strong>{item.title}</strong> · {item.message}
                </p>
              ))}
            {!items.data.some((item) => !item.read) && (
              <p>No unread notifications.</p>
            )}
            <Link href="/employer/notifications">View all notifications</Link>
          </div>
        ) : (
          <NotificationCenter
            notifications={items.data}
            preferences={preferences.data}
          />
        ))}
    </State>
  );
}
function Subscription() {
  const resource = useResource<Overview>('employer/overview');
  return (
    <State {...resource} retry={resource.reload}>
      <div className="panel">
        <h2>Employer subscription</h2>
        <p>{resource.data?.subscription.reason}</p>
        <p>
          No employer plan, renewal date or paid usage allowance is currently
          available from the existing billing service.
        </p>
        <Link className="secondary" href="/contact">
          Contact support
        </Link>
      </div>
    </State>
  );
}
function EmployerSettings({ user }: { user: Pick<User, 'name' | 'email'> }) {
  return (
    <>
      <div className="panel">
        <h2>Account and security</h2>
        <p>
          {user.name} · {user.email}
        </p>
        <div className="actions">
          <Link className="secondary" href="/forgot-password">
            Reset password
          </Link>
          <Link className="secondary" href="/employer/organization">
            Company settings
          </Link>
          <Link className="secondary" href="/employer/notifications">
            Notification preferences
          </Link>
          <Action endpoint="auth/logout" label="Log out" redirect="/login" />
        </div>
      </div>
      <div className="panel">
        <h2>Your data</h2>
        <div className="actions">
          <a className="secondary" href="/api/v1/me/export" download>
            Export my data
          </a>
          <Action
            endpoint="me/delete-request"
            label="Request account deletion"
            confirm
          />
        </div>
      </div>
    </>
  );
}

export function EmployerNavigation({
  links,
  section,
}: {
  links: string[][];
  section: string;
}) {
  const nav = (
    <nav className="workspace-nav" aria-label="Employer navigation">
      {links.map(([path, title]) => (
        <Link
          key={path}
          href={'/' + path}
          aria-current={section === path ? 'page' : undefined}
        >
          {title}
        </Link>
      ))}
    </nav>
  );
  return (
    <>
      <div className="employer-desktop-navigation">{nav}</div>
      <details className="employer-mobile-navigation">
        <summary>Employer menu</summary>
        {nav}
      </details>
    </>
  );
}

function TaxonomyPicker({
  kind,
  name,
  initial,
}: {
  kind: 'occupations' | 'locations';
  name: string;
  initial: string;
}) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState(initial),
    [items, setItems] = useState<{ id: string; displayName: string }[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <div>
      <label>
        Search {kind} (optional)
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            kind === 'occupations' ? 'e.g. software engineer' : 'e.g. Pune'
          }
        />
      </label>
      <button
        className="secondary"
        type="button"
        disabled={busy || query.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            const result = await request<{
              items: { id: string; displayName: string }[];
            }>(`taxonomy/${kind}?q=${encodeURIComponent(query)}&limit=25`);
            setItems(result.items);
            if (!result.items.length) setMessage('No catalog entries found.');
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Searching…' : 'Search catalog'}
      </button>
      <label>
        Selected {kind === 'occupations' ? 'occupation' : 'location'}
        <select
          name={name}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Not selected</option>
          {initial && !items.some((item) => item.id === initial) && (
            <option value={initial}>Current selection ({initial})</option>
          )}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      {message && <output>{message}</output>}
    </div>
  );
}
