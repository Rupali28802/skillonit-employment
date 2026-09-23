'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Row = { id: string; [key: string]: unknown };
type Page = { items: Row[]; nextCursor: string | null };
type Overview = { counts: Record<string, number>; pending: Record<string, number> };
type JobEngineStatus = {
  sources: { id: string; enabled?: boolean; approved?: boolean; intervalMinutes?: number }[];
  states: { id: string; lastSuccessAt?: string; failures?: number }[];
};
type SourceHealth = { online: number; configured: number };

const resourceBySection: Record<string, string> = {
  users: 'users', employers: 'employers', jobs: 'jobs', sources: 'sources',
  applications: 'applications', fraud: 'fraud', payments: 'payments', audit: 'audit',
};

const headings: Record<string, string[]> = {
  users: ['name', 'email', 'role', 'verified', 'disabled'],
  employers: ['name', 'domain', 'country', 'status', 'updatedAt'],
  jobs: ['title', 'company', 'status', 'trust', 'expiresAt'],
  sources: ['provider', 'type', 'status', 'lastSuccessAt', 'failureCount'],
  applications: ['userId', 'jobId', 'method', 'status', 'createdAt'],
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

function AdminAction({ section, row, onDone }: { section: string; row: Row; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const actions = section === 'users'
    ? [row.disabled ? 'enable' : 'disable']
    : section === 'employers' ? ['verified', 'rejected']
    : section === 'jobs' ? ['publish', 'review', 'close', 'remove']
    : section === 'fraud' ? ['resolved', 'rejected'] : [];
  if (!actions.length) return null;
  async function run(action: string) {
    const reason = window.prompt(`Reason for ${action} (required for the audit record):`);
    if (!reason || reason.trim().length < 3) return;
    if (!window.confirm(`Confirm ${action} for this ${section.slice(0, -1)}?`)) return;
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
        body = { action, reason };
      } else {
        endpoint = `admin/console/fraud/${encodeURIComponent(row.id)}/review`;
        body = { status: action, note: reason };
      }
      await request(endpoint, { method, body: JSON.stringify(body) });
      setMessage('Saved and audited.'); onDone();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Operation failed.'); }
    finally { setBusy(false); }
  }
  return <div className="admin-actions" aria-live="polite">
    {actions.map(action => <button key={action} disabled={busy} onClick={() => void run(action)}>{label(action)}</button>)}
    {message && <span>{message}</span>}
  </div>;
}

export function AdminConsolePanel({ section }: { section: string }) {
  const resource = resourceBySection[section];
  const [rows, setRows] = useState<Row[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [sourceHealth, setSourceHealth] = useState<SourceHealth | null>(null);
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
        const pageRequest = request(`admin/console/${resource}?${params}`) as Promise<Page>;
        const [page, engine] = section === 'sources'
          ? await Promise.all([pageRequest, request('admin/job-engine') as Promise<JobEngineStatus>])
          : [await pageRequest, null];
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
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Admin data is unavailable.'); }
    finally { setLoading(false); }
  }, [cursor, query, resource, section, status]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const columns = useMemo(() => headings[section] ?? [], [section]);
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
    <section className="admin-card">
    <div className="admin-card-head"><div><p className="eyebrow">SECURE OPERATIONS</p><h2>{label(section)}</h2></div><button onClick={() => void load()}>Refresh</button></div>
    <form className="admin-filters" onSubmit={event => { event.preventDefault(); setCursor(''); setHistory([]); void load(); }}>
      <label>Search<input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${section}`} /></label>
      <label>Status<input value={status} onChange={event => setStatus(event.target.value)} placeholder="All statuses" /></label>
      <button className="primary" type="submit">Apply filters</button>
    </form>
    {!rows.length ? <div className="admin-empty"><strong>No matching records</strong><p>Try clearing the filters. Synthetic records are never generated.</p></div> : <div className="table-scroll"><table className="admin-table"><thead><tr>{columns.map(column => <th key={column}>{label(column)}</th>)}<th>Actions</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column}>{['status', 'role', 'trust', 'riskLevel'].includes(column) ? <span className={`admin-badge ${tone(row[column])}`}>{text(row[column])}</span> : text(row[column])}</td>)}<td><AdminAction section={section} row={row} onDone={() => void load()} /></td></tr>)}
    </tbody></table></div>}
    <div className="admin-pagination"><button disabled={!history.length} onClick={() => { const prior = [...history]; setCursor(prior.pop() ?? ''); setHistory(prior); }}>Previous</button><span>{rows.length} records on this page</span><button disabled={!nextCursor} onClick={() => { setHistory(current => [...current, cursor]); setCursor(nextCursor ?? ''); }}>Next</button></div>
    </section>
  </>;
}
