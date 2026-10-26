'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast';

export type MailboxStatus = {
  available: boolean;
  connected: boolean;
  provider: string | null;
  email: string | null;
  scopes: string[];
};

function maskedEmail(email: string | null) {
  if (!email) return '';
  const [name, domain] = email.split('@');
  if (!domain) return 'Connected account';
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
}

export function GmailConnection({ initial, compact = false }: { initial: MailboxStatus; compact?: boolean }) {
  const [status, setStatus] = useState(initial);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('mail');
    let resultHandled = false;
    const clearResult = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('mail');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    };
    const refresh = () => {
      void fetch('/api/v1/mail/status', { cache: 'no-store' }).then(responseMessage).then(current => {
        setStatus(current);
        if (current.connected) {
          setState('idle');
          setMessage('');
        }
        if (!resultHandled && result) {
          resultHandled = true;
          clearResult();
          if (result === 'connected' && current.connected) {
            toast.add({
              type: 'success',
              title: 'Email Connected Successfully',
              description: 'Your Gmail account has been connected successfully. SkillOnIT can now send job application emails from this account.',
              timeout: 8000,
            });
          } else if (result === 'cancelled') {
            setState('failed');
            setMessage('Gmail connection was cancelled. No email access was granted.');
            toast.add({ type: 'warning', title: 'Gmail Connection Cancelled', description: 'You cancelled Google consent. Your Gmail account was not connected.', timeout: 8000 });
          } else {
            setState('failed');
            const failure = result === 'connected'
              ? 'Gmail authorization completed, but the saved connection could not be confirmed.'
              : 'Gmail connection could not be completed. Please try again.';
            setMessage(failure);
            toast.add({ type: 'error', title: 'Gmail Connection Failed', description: failure, timeout: 8000 });
          }
        }
      }).catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
  const connect = async () => {
    setState('sending'); setMessage('');
    try {
      const data = await responseMessage(await fetch('/api/v1/mail/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
      if (data?.sent !== true) throw new Error('The connection email could not be sent.');
      setState('sent');
      setMessage('Verification email sent. Check your email and click Connect My Email.');
    } catch (error) { setState('failed'); setMessage((error as Error).message); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect this email from SkillOnIT?')) return;
    setState('sending'); setMessage('');
    try { await responseMessage(await fetch('/api/v1/mail/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); setStatus({ ...status, connected: false, email: null, scopes: [] }); setState('idle'); }
    catch (error) { setState('failed'); setMessage((error as Error).message); }
  };
  return <div className={compact ? '' : 'panel'}>
    <span className="pill">{status.connected ? '✓ Gmail Connected' : state === 'failed' ? 'Connection failed' : state === 'sent' ? 'Verification email sent' : 'Email not connected'}</span>
    {!compact && <><h2 style={{marginTop: 15}}>Connect your email securely</h2><p>First confirm the link sent to your registered email. Google will then separately request send-only permission. SkillOnIT cannot read your inbox and never receives your Gmail password.</p></>}
    {status.connected ? <><p><strong>Connected email:</strong> {maskedEmail(status.email)}</p><p><strong>Permission:</strong><br />✓ Send applications from your Gmail</p><div className="actions"><button className="secondary" disabled={state === 'sending'} onClick={() => void disconnect()}>Disconnect Email</button></div></> : <div className="actions"><button className="primary" disabled={state === 'sending' || !status.available} onClick={() => void connect()}>{state === 'sending' ? 'Sending...' : state === 'failed' ? 'Try Again' : state === 'sent' ? 'Send Again' : 'Connect Email'}</button>{compact && <Link className="secondary" href="/mail">Why connect email?</Link>}</div>}
    {!status.available && <p className="notice error">Email authorization is awaiting secure backend configuration.</p>}
    {message && <p className={state === 'failed' ? 'notice error' : 'notice'} aria-live="polite">{message}</p>}
  </div>;
}

type CvDocument = {
  id: string;
  filename: string;
  size: number;
  status: 'uploading' | 'queued' | 'processing' | 'review' | 'confirmed' | 'failed' | 'deleting';
  revision: number;
  scanStatus?: string;
  extractionStatus?: string;
  errorCode?: string;
  draft?: Record<string, unknown>;
  provenance?: Record<string, string>;
  updatedAt: string;
};

async function responseMessage(response: Response) {
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message || 'The request could not be completed.');
  return result?.data;
}

function formatDraftValue(value: unknown) {
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? JSON.stringify(item) : `${item}`).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  return '';
}

const editableDraftFields = [
  ['name', 'Full name', 'text'], ['contactInfo', 'Contact information', 'text'], ['headline', 'Professional headline', 'text'],
  ['targetRole', 'Target role', 'text'], ['industry', 'Industry', 'text'], ['experience', 'Total experience', 'number'],
  ['skills', 'Skills', 'list'], ['education', 'Education', 'textarea'], ['certifications', 'Certifications', 'list'],
  ['projects', 'Projects', 'list'], ['professionalLinks', 'Professional links', 'list'], ['languages', 'Languages', 'list'],
  ['country', 'Country', 'text'], ['region', 'State / region', 'text'], ['city', 'City', 'text'],
  ['availability', 'Availability / notice period', 'text'], ['relocation', 'Relocation preference', 'text'],
] as const;

export function CvManager({ documents, profileRevision, currentProfile = {}, uploadsAvailable = false }: { documents: CvDocument[]; profileRevision: number; currentProfile?: Record<string, unknown>; uploadsAvailable?: boolean }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [reviews, setReviews] = useState<Record<string, Record<string, unknown>>>(() => Object.fromEntries(documents.map(cv => [cv.id, {
    ...cv.draft,
    ...(currentProfile.confirmed ? Object.fromEntries(Object.entries(currentProfile).filter(([, value]) => value !== '' && value !== null && (!Array.isArray(value) || value.length))) : {}),
    confirmed: true,
  }])));
  useEffect(() => {
    if (!documents.some(cv => ['queued', 'processing', 'uploading'].includes(cv.status))) return;
    const timer = window.setTimeout(() => window.location.reload(), 2500);
    return () => window.clearTimeout(timer);
  }, [documents]);
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key); setMessage('');
    try { await action(); window.location.reload(); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(''); }
  };
  return <div className="stack">
    <div className="panel">
      <h2>Upload your CV</h2>
      <p>PDF or DOCX, up to 5 MB. Your file is stored privately, scanned, parsed, and shown to you for confirmation before profile data changes.</p>
      <input id="cv-file" type="file" disabled={!uploadsAvailable} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
      <button className="primary" disabled={!!busy || !uploadsAvailable} onClick={() => run('upload', async () => {
        const input = document.querySelector<HTMLInputElement>('#cv-file'); const file = input?.files?.[0];
        if (!file) throw new Error('Choose a PDF or DOCX file first.');
        setUploadProgress(0);
        return new Promise((resolve, reject) => {
          const request = new XMLHttpRequest(); request.open('POST', '/api/v1/me/cv'); request.responseType = 'json';
          request.setRequestHeader('Content-Type', file.type); request.setRequestHeader('X-File-Name', file.name);
          request.upload.onprogress = event => { if (event.lengthComputable) setUploadProgress(Math.round(event.loaded / event.total * 100)); };
          request.onload = () => request.status >= 200 && request.status < 300 ? resolve(request.response?.data) : reject(new Error(request.response?.error?.message || 'CV upload failed.'));
          request.onerror = () => reject(new Error('Network error while uploading the CV.')); request.send(file);
        });
      })}>{busy === 'upload' ? 'Uploading…' : 'Upload and process CV'}</button>
      {!uploadsAvailable && <p className="notice" role="status">CV uploads are temporarily unavailable while secure processing is being restored. You can continue with manual profile entry.</p>}
      {uploadProgress !== null && busy === 'upload' && <p aria-live="polite">Upload progress: {uploadProgress}%</p>}
      {message && <p className="notice" aria-live="polite">{message}</p>}
    </div>
    {!documents.length ? <div className="panel"><h2>No CV uploaded yet</h2><p>You can continue with manual profile entry until CV processing is configured.</p></div> : documents.map(cv => <div className="panel" key={cv.id}>
      <div className="section-line"><div><span className="pill">{cv.status.replaceAll('_', ' ')}</span><h2 style={{marginTop: 12}}>{cv.filename}</h2></div><small>{Math.ceil(cv.size / 1024)} KB</small></div>
      <p className="small">Scan: {cv.scanStatus || 'pending'} · Extraction: {cv.extractionStatus || 'pending'} · Updated {new Date(cv.updatedAt).toLocaleString('en-IN')}</p>
      {cv.errorCode && <p className="notice error">Processing stopped safely: {cv.errorCode.replaceAll('_', ' ')}</p>}
      {['queued','processing','uploading'].includes(cv.status) && <p className="notice" aria-live="polite">{cv.status === 'queued' ? 'Waiting for secure processing…' : 'Scanning and extracting your CV…'} This page refreshes automatically.</p>}
      {cv.status === 'review' && cv.draft && <div><h3>Review extracted facts</h3><p>Each value remains a draft until you confirm. Existing confirmed values are retained by default; compare the extracted value before changing them.</p>
        <div className="form-grid">{editableDraftFields.map(([key, label, type]) => {
          const extracted = cv.draft?.[key]; const value = reviews[cv.id]?.[key];
          return <label key={key} style={type === 'textarea' ? {gridColumn:'1/-1'} : undefined}>{label}<small className="muted">Extracted from CV: {formatDraftValue(extracted) || 'Not found'}{cv.provenance?.[key] ? ` · ${cv.provenance[key]}` : ''}</small>
            {type === 'textarea' ? <textarea value={formatDraftValue(value)} onChange={event => setReviews(old => ({...old,[cv.id]:{...old[cv.id],[key]:event.target.value}}))} /> : <input type={type === 'number' ? 'number' : 'text'} value={formatDraftValue(value)} onChange={event => setReviews(old => ({...old,[cv.id]:{...old[cv.id],[key]:type === 'list' ? event.target.value.split(',').map(item=>item.trim()).filter(Boolean) : type === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value}}))} />}
            <button type="button" className="secondary" onClick={() => setReviews(old => ({...old,[cv.id]:{...old[cv.id],[key]:type === 'list' ? [] : type === 'number' ? null : ''}}))}>Clear</button>
          </label>;
        })}</div>
        {Array.isArray(cv.draft.employmentHistory) && <div><h3>Work experience</h3><small className="muted">Extracted from CV · retained for confirmation</small>{cv.draft.employmentHistory.map((item, index)=><p key={index}>{formatDraftValue(item)}</p>)}</div>}
      </div>}
      <div className="actions">
        {cv.status === 'review' && <button className="primary" disabled={!!busy} onClick={() => run(cv.id + ':confirm', async () => {
          const draft: Record<string, unknown> = {...(reviews[cv.id] || cv.draft), employmentHistory: currentProfile.confirmed ? (currentProfile.employmentHistory || cv.draft?.employmentHistory || []) : (cv.draft?.employmentHistory || [])};
          const name = typeof draft.name === 'string' && draft.name.trim() ? draft.name : 'My CV';
          const targetRoles = typeof draft.targetRole === 'string' && draft.targetRole.trim() ? [draft.targetRole] : [];
          return responseMessage(await fetch(`/api/v1/me/cv/${cv.id}/confirm`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ profile: draft, confirmed: true, expectedRevision: cv.revision, expectedProfileRevision: profileRevision, name, targetRoles, summary: typeof draft.headline === 'string' ? draft.headline : '' }) }));
        })}>Confirm reviewed facts</button>}
        {cv.status === 'failed' && <button className="secondary" disabled={!!busy} onClick={() => run(cv.id + ':retry', () => fetch(`/api/v1/me/cv/${cv.id}/retry`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({expectedRevision: cv.revision}) }).then(responseMessage))}>Retry processing</button>}
        {!['uploading','processing','deleting'].includes(cv.status) && <button className="secondary" disabled={!!busy} onClick={() => { if (window.confirm('Delete this CV and its versions?')) void run(cv.id + ':delete', () => fetch(`/api/v1/me/cv/${cv.id}`, {method:'DELETE'}).then(responseMessage)); }}>Delete</button>}
      </div>
    </div>)}
  </div>;
}

type Consent = { purpose: string; granted: boolean; policyVersion: string; updatedAt: string };
export function ConsentManager({ consents }: { consents: Consent[] }) {
  const [message, setMessage] = useState('');
  const purposes = [
    ['profile', 'Profile processing', 'Use confirmed profile and CV facts for matching.'],
    ['automation', 'Application automation', 'Allow configured automation rules. Revoking this pauses automation.'],
    ['assistant', 'AI assistant', 'Allow confirmed account context in supported assistant requests.'],
    ['analytics', 'Product analytics', 'Allow privacy-minimized usage analytics.'],
  ];
  return <div className="stack">{purposes.map(([purpose, title, text]) => { const current = consents.find(c => c.purpose === purpose); return <div className="panel" key={purpose}>
    <div className="section-line"><div><h2>{title}</h2><p>{text}</p></div><span className="pill">{current?.granted ? 'Granted' : 'Not granted'}</span></div>
    <button className="secondary" onClick={async () => { try { await responseMessage(await fetch('/api/v1/me/consents', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose,granted:!current?.granted,policyVersion:'privacy-v1',source:'settings',context:'privacy_settings'})})); window.location.reload(); } catch(error){setMessage((error as Error).message);} }}>{current?.granted ? 'Revoke consent' : 'Grant consent'}</button>
  </div>; })}{message && <p className="notice error">{message}</p>}</div>;
}

export function OnboardingActions({ revision, mode, ready, completed }: { revision: number; mode: string | null; ready: boolean; completed: boolean }) {
  const [message, setMessage] = useState('');
  const update = async (payload: unknown, complete = false) => { try { await responseMessage(await fetch(`/api/v1/me/onboarding${complete ? '/complete' : ''}`, {method: complete ? 'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})); window.location.reload(); } catch(error){setMessage((error as Error).message);} };
  return <div><div className="actions"><button className={mode === 'cv' ? 'primary':'secondary'} onClick={() => update({mode:'cv',expectedRevision:revision})}>Start with my CV</button><button className={mode === 'manual' ? 'primary':'secondary'} onClick={() => update({mode:'manual',expectedRevision:revision})}>Build profile manually</button>{ready && !completed && <button className="primary" onClick={() => update({}, true)}>Complete onboarding</button>}</div>{message && <p className="notice error">{message}</p>}</div>;
}
