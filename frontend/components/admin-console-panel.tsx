'use client';

import { type SubmitEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ApplicationDetails } from './application-details';

type Row = { id: string; [key: string]: unknown };
type Page = { items: Row[]; nextCursor: string | null };
type Overview = { counts: Record<string, number>; pending: Record<string, number> };
type JobEngineStatus = {
  sources: { id: string; enabled?: boolean; approved?: boolean; intervalMinutes?: number }[];
  states: { id: string; lastSuccessAt?: string; failures?: number }[];
};
type SourceHealth = { online: number; configured: number };
type AccountRole = 'student' | 'employer' | 'admin';
type AdminAccess = { userId: string; permissions: string[] };
type PendingRole = { row: Row; from: AccountRole; to: AccountRole };
const accountRoles: AccountRole[] = ['student', 'employer', 'admin'];
const ownerUserId = (row: Row) => typeof row.ownerUserId === 'string' ? row.ownerUserId : '';

const resourceBySection: Record<string, string> = {
  users: 'users', employers: 'employers', jobs: 'jobs', sources: 'sources',
  applications: 'applications', fraud: 'fraud', payments: 'payments', audit: 'audit',
};

const headings: Record<string, string[]> = {
  users: ['name', 'email', 'role', 'verified', 'disabled'],
  employers: ['name', 'userName', 'email', 'role', 'status', 'accountStatus', 'plan', 'createdAt'],
  jobs: ['title', 'company', 'status', 'trust', 'expiresAt'],
  sources: ['provider', 'type', 'status', 'lastSuccessAt', 'failureCount'],
  applications: ['id', 'candidate', 'jobTitle', 'employer', 'applicationMethod', 'submissionState', 'submittedAt', 'updatedAt', 'reason'],
  fraud: ['entityType', 'entityId', 'status', 'riskLevel', 'createdAt'],
  payments: ['userId', 'status', 'amount', 'currency', 'createdAt'],
  audit: ['actorId', 'action', 'entityId', 'result', 'createdAt'],
};

function text(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return 'Available in detail view';
  const output = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '—';
  return /^\d{4}-\d{2}-\d{2}T/.test(output) ? new Date(output).toLocaleString('en-IN') : output;
}

function label(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase());
}

function tone(value: unknown) {
  const status = typeof value === 'string' ? value.toLowerCase() : '';
  if (/active|verified|published|captured|healthy|resolved|success/.test(status)) return 'is-good';
  if (/failed|disabled|rejected|blocked|removed|unavailable/.test(status)) return 'is-bad';
  return 'is-neutral';
}

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  const response = await fetch('/api/v1/' + path, {
    credentials: 'include', cache: 'no-store', ...init,
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || 'The administrator operation failed.');
  return payload.data;
}

const localDateTime = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const intakeInitial = () => ({
  title: '', company: '', domain: '', country: 'India', state: '', city: '', category: 'Technology', skills: '',
  mode: 'Remote', type: 'Full-time', salaryMin: '0', salaryMax: '0', currency: 'INR', experienceMin: '0', experienceMax: '0',
  description: '', requirements: '', sourceName: '', sourceUrl: '', originalApplicationUrl: '', authorizationReference: '', activeCheckedAt: localDateTime(),
});

function ManualVerifiedJobIntake({ onCreated, allowed }: { onCreated: () => Promise<void>; allowed: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(intakeInitial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const update = (key: keyof ReturnType<typeof intakeInitial>, value: string) => setForm(current => ({ ...current, [key]: value }));
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      const payload = {
        ...form,
        skills: form.skills.split(',').map(item => item.trim()).filter(Boolean),
        salaryMin: Number(form.salaryMin), salaryMax: Number(form.salaryMax),
        experienceMin: Number(form.experienceMin), experienceMax: Number(form.experienceMax),
        activeCheckedAt: new Date(form.activeCheckedAt).toISOString(),
      };
      await request('admin/console/jobs', { method: 'POST', body: JSON.stringify(payload) });
      setForm(intakeInitial()); setMessage('Submitted for review. It is not live until a second admin review confirms the evidence.');
      await onCreated();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The verified-job intake could not be saved.'); }
    finally { setBusy(false); }
  }
  return <section className="admin-card verified-job-intake">
    <div className="admin-card-head"><div><p className="eyebrow">VERIFIED JOB INTAKE</p><h2>Publish real opportunities safely</h2><p>Use only an authorized source or an employer-provided listing. New entries always start in review and retain their original source and application links.</p></div><button type="button" disabled={!allowed} title={allowed ? 'Add a verified job' : 'Your admin role cannot create job intakes.'} onClick={() => { setOpen(current => !current); setMessage(''); }}>{open ? 'Close form' : 'Add verified job'}</button></div>
    {!allowed && <div className="admin-notice is-error" role="alert">Your current admin role can view jobs but cannot create verified-job intakes.</div>}
    {open && <form className="verified-job-form" onSubmit={event => void submit(event)}>
      <p className="verified-job-rule">Do not enter a copied, guessed, expired, or unauthorised listing. The application URL must be the employer&apos;s or authorised source&apos;s original link.</p>
      <div className="verified-job-grid">
        <label>Job title<input required value={form.title} onChange={event => update('title', event.target.value)} /></label>
        <label>Company<input required value={form.company} onChange={event => update('company', event.target.value)} /></label>
        <label>Company domain<input required placeholder="company.com" value={form.domain} onChange={event => update('domain', event.target.value)} /></label>
        <label>Category<input required value={form.category} onChange={event => update('category', event.target.value)} /></label>
        <label>Country<input required value={form.country} onChange={event => update('country', event.target.value)} /></label>
        <label>State / region<input value={form.state} onChange={event => update('state', event.target.value)} /></label>
        <label>City<input required value={form.city} onChange={event => update('city', event.target.value)} /></label>
        <label>Work arrangement<select value={form.mode} onChange={event => update('mode', event.target.value)}><option>Remote</option><option>Hybrid</option><option>On-site</option></select></label>
        <label>Employment type<input required value={form.type} onChange={event => update('type', event.target.value)} /></label>
        <label>Skills, comma separated<input required placeholder="TypeScript, Node.js" value={form.skills} onChange={event => update('skills', event.target.value)} /></label>
        <label>Minimum experience<input required type="number" min="0" max="70" value={form.experienceMin} onChange={event => update('experienceMin', event.target.value)} /></label>
        <label>Maximum experience<input required type="number" min="0" max="70" value={form.experienceMax} onChange={event => update('experienceMax', event.target.value)} /></label>
        <label>Minimum salary (0 if undisclosed)<input required type="number" min="0" value={form.salaryMin} onChange={event => update('salaryMin', event.target.value)} /></label>
        <label>Maximum salary (0 if undisclosed)<input required type="number" min="0" value={form.salaryMax} onChange={event => update('salaryMax', event.target.value)} /></label>
        <label>Currency<input required maxLength={3} value={form.currency} onChange={event => update('currency', event.target.value.toUpperCase())} /></label>
        <label>Checked active at<input required type="datetime-local" value={form.activeCheckedAt} onChange={event => update('activeCheckedAt', event.target.value)} /></label>
      </div>
      <label>Job description<textarea required minLength={30} value={form.description} onChange={event => update('description', event.target.value)} placeholder="Use the real description supplied by the original source." /></label>
      <label>Requirements and eligibility<textarea required minLength={10} value={form.requirements} onChange={event => update('requirements', event.target.value)} placeholder="Include verified eligibility criteria, education or experience requirements." /></label>
      <div className="verified-job-grid">
        <label>Source name<input required value={form.sourceName} onChange={event => update('sourceName', event.target.value)} placeholder="Employer career page, authorised partner, etc." /></label>
        <label>Original source URL<input required type="url" value={form.sourceUrl} onChange={event => update('sourceUrl', event.target.value)} placeholder="https://…" /></label>
        <label>Original application URL<input required type="url" value={form.originalApplicationUrl} onChange={event => update('originalApplicationUrl', event.target.value)} placeholder="https://…" /></label>
        <label>Authorisation / review reference<textarea required minLength={10} value={form.authorizationReference} onChange={event => update('authorizationReference', event.target.value)} placeholder="Record the written permission, API/display terms, or employer-authorised review reference." /></label>
      </div>
      <div className="admin-modal-actions"><button type="submit" className="primary" disabled={busy || !allowed}>{busy ? 'Saving…' : 'Submit for review'}</button><span>{message}</span></div>
    </form>}
    {!open && message && <output className="admin-notice is-success">{message}</output>}
  </section>;
}

function AdminAction({ section, row, onDone, permissions }: { section: string; row: Row; onDone: () => void; permissions: string[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const isManualJob = section === 'jobs' && typeof row.manualEvidence === 'object' && row.manualEvidence !== null;
  const actions = section === 'users'
    ? [row.disabled ? 'enable' : 'disable']
    : section === 'employers' && row.hasEmployerProfile ? ['verified', 'rejected']
    : section === 'jobs' ? ['publish', 'review', 'close', 'remove']
    : section === 'fraud' ? ['resolved', 'rejected'] : [];
  if (!actions.length) return null;
  const permissionFor = (action: string) => section === 'employers'
    ? action === 'rejected' ? 'employers.reject' : 'employers.verify'
    : null;
  const evidenceCount = typeof row.verificationEvidenceCount === 'number' ? row.verificationEvidenceCount : 0;
  const disabledReason = (action: string) => {
    const permission = permissionFor(action);
    if (permission && !permissions.includes(permission)) return 'Your admin role does not have permission for this action.';
    if (section === 'employers' && action === 'verified' && evidenceCount === 0) return 'Verification evidence is required before approval.';
    return '';
  };
  async function run() {
    if (!pendingAction) return;
    const action = pendingAction;
    setBusy(true); setMessage('');
    try {
      let endpoint = '', method = 'POST', body: Record<string, unknown> = {};
      if (section === 'users') {
        endpoint = `admin/console/users/${encodeURIComponent(row.id)}/state`; method = 'PUT';
        body = { disabled: action === 'disable', reason };
      } else if (section === 'employers') {
        endpoint = `admin/console/employers/${encodeURIComponent(row.id)}/verification`; method = 'PUT';
        body = { status: action, note: reason };
      } else if (section === 'jobs') {
        endpoint = `admin/console/jobs/${encodeURIComponent(row.id)}/moderation`;
        body = { action, reason, ...(isManualJob && action === 'publish' ? { confirmManualEvidence: manualConfirmed } : {}) };
      } else {
        endpoint = `admin/console/fraud/${encodeURIComponent(row.id)}/review`;
        body = { status: action, note: reason };
      }
      await request(endpoint, { method, body: JSON.stringify(body) });
      setMessage('Saved and audited.'); setPendingAction(null); setReason(''); setManualConfirmed(false); onDone();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Operation failed.'); }
    finally { setBusy(false); }
  }
  return <div className="admin-actions" aria-live="polite">
    {actions.map(action => {
      const blocked = disabledReason(action);
      return <button key={action} type="button" disabled={busy || Boolean(blocked)} title={blocked} onClick={() => { setMessage(''); setReason(''); setManualConfirmed(false); setPendingAction(action); }}>{label(action)}</button>;
    })}
    {message && <span>{message}</span>}
    {pendingAction && <div className="admin-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) { setPendingAction(null); setReason(''); setManualConfirmed(false); } }}><dialog className="admin-role-modal" open aria-labelledby="job-moderation-title"><p className={`eyebrow ${pendingAction === 'remove' ? 'danger-text' : ''}`}>{section === 'jobs' ? 'JOB MODERATION' : section === 'employers' ? 'EMPLOYER VERIFICATION' : 'ADMINISTRATION'}</p><h2 id="job-moderation-title">{section === 'jobs' ? `${label(pendingAction)} this job?` : pendingAction === 'verified' ? 'Verify employer?' : 'Reject employer?'}</h2><p>{isManualJob && pendingAction === 'publish' ? 'Confirm you checked the original source and application URL, and that the vacancy is still active.' : section === 'jobs' ? 'This change is recorded in the job lifecycle and audit trail.' : pendingAction === 'verified' ? 'This confirms the submitted company evidence has been reviewed.' : 'This records a rejection and notifies the employer.'}</p>{isManualJob && pendingAction === 'publish' && <label className="verified-job-confirm"><input type="checkbox" checked={manualConfirmed} onChange={event => setManualConfirmed(event.target.checked)} />I confirmed the source, original application link, authorisation reference, and active status.</label>}<label>Reason for this decision<textarea autoFocus value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} placeholder="Enter an audit reason (required)" /></label><div className="admin-modal-actions"><button type="button" disabled={busy} onClick={() => { setPendingAction(null); setReason(''); setManualConfirmed(false); }}>Cancel</button><button className={pendingAction === 'remove' || pendingAction === 'rejected' ? 'admin-danger' : 'primary'} type="button" disabled={busy || reason.trim().length < 3 || (isManualJob && pendingAction === 'publish' && !manualConfirmed)} onClick={() => void run()}>{busy ? 'Saving…' : section === 'jobs' ? label(pendingAction) : pendingAction === 'verified' ? 'Verify employer' : 'Reject employer'}</button></div></dialog></div>}
  </div>;
}

export function AdminConsolePanel({ section }: { section: string }) {
  const resource = resourceBySection[section];
  const [rows, setRows] = useState<Row[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [applicationMethod, setApplicationMethod] = useState('');
  const [cursor, setCursor] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [sourceHealth, setSourceHealth] = useState<SourceHealth | null>(null);
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [pendingRole, setPendingRole] = useState<PendingRole | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [roleReason, setRoleReason] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (!resource) {
        setOverview(await request('admin/console/overview') as Overview);
      }
      else {
        const params = new URLSearchParams({ limit: '25' });
        if (cursor) params.set('cursor', cursor);
        if (query.trim()) params.set('query', query.trim());
        if (status) params.set('status', status);
        if (section === 'applications' && applicationMethod) params.set('method', applicationMethod);
        const pageRequest = request(`admin/console/${resource}?${params}`) as Promise<Page>;
        const [page, engine, currentAccess] = await Promise.all([
          pageRequest,
          section === 'sources' ? request('admin/job-engine') as Promise<JobEngineStatus> : Promise.resolve(null),
          ['users', 'employers', 'jobs'].includes(section) ? request('admin/console/access') as Promise<AdminAccess> : Promise.resolve(null),
        ]);
        setRows(page.items); setNextCursor(page.nextCursor);
        if (engine) {
          const now = Date.now();
          const states = new Map(engine.states.map(item => [item.id, item]));
          const configured = engine.sources.filter(item => item.enabled && item.approved);
          const online = configured.filter(item => {
            const state = states.get(item.id);
            const lastSuccess = state?.lastSuccessAt ? Date.parse(state.lastSuccessAt) : Number.NaN;
            return Number.isFinite(lastSuccess) && !state?.failures && now - lastSuccess < (item.intervalMinutes ?? 0) * 120_000;
          }).length;
          setSourceHealth({ online, configured: configured.length });
        } else setSourceHealth(null);
        if (currentAccess) setAccess(currentAccess);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Admin data is unavailable.'); }
    finally { setLoading(false); }
  }, [cursor, query, resource, section, status, applicationMethod]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  async function updateRole() {
    if (!pendingRole || roleReason.trim().length < 3) return;
    setRoleBusy(true); setNotice(null);
    try {
      const userId = section === 'employers' ? ownerUserId(pendingRole.row) : pendingRole.row.id;
      await request(`admin/console/users/${encodeURIComponent(userId)}/role`, {
        method: 'PUT', body: JSON.stringify({ role: pendingRole.to, reason: roleReason.trim() }),
      });
      setPendingRole(null); setRoleReason('');
      setNotice({ tone: 'success', text: section === 'employers' ? 'Employer role updated successfully.' : 'User role updated successfully.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: caught instanceof Error ? caught.message : 'The user role could not be updated.' });
    } finally { setRoleBusy(false); }
  }
  async function deleteUser() {
    if (!pendingDelete) return;
    setDeleteBusy(true); setNotice(null);
    try {
      const userId = section === 'employers' ? ownerUserId(pendingDelete) : pendingDelete.id;
      await request(`admin/console/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      setPendingDelete(null);
      setNotice({ tone: 'success', text: section === 'employers' ? 'Employer user deleted successfully.' : 'User deleted successfully.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: caught instanceof Error ? caught.message : 'The user could not be deleted.' });
    } finally { setDeleteBusy(false); }
  }
  const columns = useMemo(() => headings[section] ?? [], [section]);
  const managedUserId = (row: Row) => section === 'employers' ? ownerUserId(row) : row.id;
  const canManageUsers = Boolean(access?.permissions.includes('admin.users.manage'));
  const canCreateVerifiedJobs = Boolean(access?.permissions.includes('jobs.moderate'));
  if (loading) return <output className="admin-state"><span className="admin-spinner" />Loading secure admin data…</output>;
  if (error) return <div className="admin-state is-error" role="alert"><strong>Unable to load this section</strong><p>{error}</p><button onClick={() => void load()}>Retry</button></div>;
  if (!resource && overview) return <>
    <div className="admin-kpis">
      {Object.entries(overview.counts).map(([name, value]) => <article key={name}><span>{label(name)}</span><strong>{value.toLocaleString()}</strong><small>Recorded in the platform</small></article>)}
    </div>
    <section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">REVIEW QUEUE</p><h2>Items needing attention</h2></div></div>
      <div className="admin-review-grid">{Object.entries(overview.pending).map(([name, value]) => <div key={name}><strong>{value}</strong><span>{label(name)}</span></div>)}</div>
    </section>
  </>;
  return <>
    {section === 'sources' && sourceHealth && <div className="admin-kpis">
      <article><span>Sources online</span><strong>{sourceHealth.online.toLocaleString()}</strong><small>{sourceHealth.online} of {sourceHealth.configured} approved feeds reporting normally</small></article>
    </div>}
    {section === 'jobs' && <ManualVerifiedJobIntake allowed={canCreateVerifiedJobs} onCreated={load} />}
    <section className="admin-card">
    <div className="admin-card-head"><div><p className="eyebrow">SECURE OPERATIONS</p><h2>{label(section)}</h2></div><button onClick={() => void load()}>Refresh</button></div>
    <form className="admin-filters" onSubmit={event => { event.preventDefault(); setCursor(''); setHistory([]); void load(); }}>
      <label>Search<input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${section}`} /></label>
      <label>Status{section === 'applications' ? <select value={status} onChange={event => {setStatus(event.target.value); setCursor(''); setHistory([]);}}><option value="">All statuses</option>{['DRAFT','READY','SUBMITTING','SUBMITTED','CONFIRMED','NEEDS_REVIEW','FAILED','CANCELLED'].map(value => <option key={value}>{value}</option>)}</select> : <input value={status} onChange={event => setStatus(event.target.value)} placeholder="All statuses" />}</label>
      {section === 'applications' && <label>Method<select value={applicationMethod} onChange={event => {setApplicationMethod(event.target.value); setCursor(''); setHistory([]);}}><option value="">All methods</option>{['EMAIL','EXTERNAL_FORM','SKILLONIT','ATS','UNSUPPORTED'].map(value => <option key={value}>{value}</option>)}</select></label>}
      <button className="primary" type="submit">Apply filters</button>
    </form>
    {notice && <div className={`admin-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
    {!rows.length ? <div className="admin-empty"><strong>No matching records</strong><p>Try clearing the filters. Synthetic records are never generated.</p></div> : <div className="table-scroll"><table className="admin-table"><thead><tr>{columns.map(column => <th key={column}>{label(column)}</th>)}<th>Actions</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column}>{['users', 'employers'].includes(section) && column === 'role' ? <select className="admin-role-select" aria-label={`Role for ${text(row.userName ?? row.name)}`} value={String(row.role)} disabled={!canManageUsers || access?.userId === managedUserId(row)} onChange={event => setPendingRole({ row, from: row.role as AccountRole, to: event.target.value as AccountRole })}>{(canManageUsers ? accountRoles : [row.role as AccountRole]).map(role => <option key={role} value={role}>{label(role)}</option>)}</select> : ['status', 'role', 'trust', 'riskLevel', 'accountStatus'].includes(column) ? <span className={`admin-badge ${tone(row[column])}`}>{text(row[column])}</span> : text(row[column])}</td>)}<td><div className="admin-user-actions">{section === 'applications' && <ApplicationDetails id={row.id} admin />}<AdminAction section={section} row={row} permissions={access?.permissions ?? []} onDone={() => void load()} />{['users', 'employers'].includes(section) && <button className="admin-danger" type="button" disabled={!canManageUsers || access?.userId === managedUserId(row)} title={!canManageUsers ? 'Your admin role cannot delete users.' : access?.userId === managedUserId(row) ? 'You cannot delete your own account.' : 'Delete user'} onClick={() => setPendingDelete(row)}>Delete</button>}</div></td></tr>)}
    </tbody></table></div>}
    <div className="admin-pagination"><button disabled={!history.length} onClick={() => { const prior = [...history]; setCursor(prior.pop() ?? ''); setHistory(prior); }}>Previous</button><span>{rows.length} records on this page</span><button disabled={!nextCursor} onClick={() => { setHistory(current => [...current, cursor]); setCursor(nextCursor ?? ''); }}>Next</button></div>
    {pendingRole && <div className="admin-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !roleBusy) { setPendingRole(null); setRoleReason(''); } }}><dialog className="admin-role-modal" open aria-labelledby="role-change-title"><p className="eyebrow">CONFIRM ROLE CHANGE</p><h2 id="role-change-title">Change user role</h2><p className="admin-role-change"><strong>{label(pendingRole.from)}</strong><span aria-hidden="true">→</span><strong>{label(pendingRole.to)}</strong></p><label>Reason for this change<textarea autoFocus value={roleReason} maxLength={500} onChange={event => setRoleReason(event.target.value)} placeholder="Enter an audit reason (required)" /></label><div className="admin-modal-actions"><button type="button" disabled={roleBusy} onClick={() => { setPendingRole(null); setRoleReason(''); }}>Cancel</button><button className="primary" type="button" disabled={roleBusy || roleReason.trim().length < 3} onClick={() => void updateRole()}>{roleBusy ? 'Updating…' : 'Confirm role change'}</button></div></dialog></div>}
    {pendingDelete && <div className="admin-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !deleteBusy) setPendingDelete(null); }}><dialog className="admin-role-modal" open aria-labelledby="delete-user-title"><p className="eyebrow danger-text">DELETE USER</p><h2 id="delete-user-title">Delete this user?</h2><p>This permanently removes the SkillOnIT account and revokes its active sessions.</p><div className="admin-delete-target"><strong>{text(pendingDelete.name)}</strong><span>{text(pendingDelete.email)}</span></div><p className="admin-danger-copy">This action cannot be undone.</p><div className="admin-modal-actions"><button type="button" disabled={deleteBusy} onClick={() => setPendingDelete(null)}>Cancel</button><button className="admin-danger" type="button" disabled={deleteBusy} onClick={() => void deleteUser()}>{deleteBusy ? 'Deleting…' : 'Delete user'}</button></div></dialog></div>}
    </section>
  </>;
}
