'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';

type Details = {
  id: string; applicationMethod: string; submissionState: string; status: string; company?: string;
  candidate?: string; candidateEmail?: string; employer?: string; jobTitle?: string; job?: { title: string };
  createdAt: string; updatedAt: string; submittedAt?: string; submissionEvidence?: string;
  profileRevision?: number; cv?: { id: string; name: string }; template?: { id: string; version: string };
  reasons: { code: string; message: string }[]; events: { status: string; at: string; reason?: string }[];
  email?: { recipient: string; subject: string; provider: string; sentAt?: string; providerMessageId?: string };
  external?: { url?: string; fieldsSubmitted: string[] };
};
const text = (value: unknown) => typeof value === 'string' ? value || '—' : typeof value === 'number' ? String(value) : '—';
export function ApplicationDetails({ id, admin = false }: { id: string; admin?: boolean }) {
  const [open, setOpen] = useState(false), [data, setData] = useState<Details | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function load() {
    setOpen(true); setBusy(true); setData(null); setError('');
    try {
      const response = await fetch(`/api/v1/${admin ? 'admin/console/' : ''}applications/${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message || 'Application details unavailable.');
      setData(payload.data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Application details unavailable.'); }
    finally { setBusy(false); }
  }
  return <><button className="secondary" onClick={() => void load()}>View details</button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="application-detail-dialog"><DialogTitle>Application details</DialogTitle><DialogDescription>Submission evidence and the versions used for this application.</DialogDescription>
    {busy && <output>Loading application…</output>}{error && <p role="alert">{error}</p>}
    {data && <><dl className="application-detail-grid">{Object.entries({ 'Application ID': data.id, ...(admin ? {Candidate:data.candidate, 'Candidate email':data.candidateEmail, Employer:data.employer} : {}), Job:data.jobTitle ?? data.job?.title, Company: data.company, Method: data.applicationMethod, 'Submission state': data.submissionState, 'Recruiter status': data.status, 'Created at': data.createdAt, 'Submitted at': data.submittedAt, 'Updated at': data.updatedAt, Evidence: data.submissionEvidence, 'Profile revision': data.profileRevision, CV: data.cv?.name, 'CV version': data.cv?.id, Template:data.template?.id, 'Template version': data.template?.version }).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{text(value)}</dd></div>)}</dl>
    {data.reasons.map(reason => <p className="notice" key={reason.code}>{reason.message}</p>)}
    {data.email && <section><h3>Gmail submission</h3><dl className="application-detail-grid">{Object.entries(data.email).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{text(value)}</dd></div>)}</dl><p className="small">A Gmail acceptance records submission, not recruiter receipt or a reply.</p></section>}
    {data.external && <section><h3>External application</h3>{data.external.url && <a href={data.external.url} target="_blank" rel="noopener noreferrer">Open source application</a>}<p>No fields were submitted automatically. Any confirmation is reported by you, not verified by the external provider.</p></section>}
    <h3>History</h3><ol>{data.events.map((event,index) => <li key={index}>{event.status.replaceAll('_',' ')} · {event.at}{event.reason && <p>{event.reason}</p>}</li>)}</ol></>}
  </DialogContent></Dialog></>;
}
