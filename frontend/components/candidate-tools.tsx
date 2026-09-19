'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

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
  const [state, setState] = useState<'idle' | 'connecting' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('mail');
    void fetch('/api/v1/mail/status').then(responseMessage).then(current => {
      setStatus(current);
      if (result === 'error') {
        setState('failed');
        setMessage('Gmail connection was not completed.');
      }
    }).catch(() => undefined);
  }, []);
  const connect = async () => {
    setState('connecting'); setMessage('');
    try {
      const data = await responseMessage(await fetch('/api/v1/mail/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
      if (typeof data?.startUrl !== 'string') throw new Error('Gmail authorization is unavailable.');
      const destination = new URL(data.startUrl, window.location.origin);
      if (destination.origin !== window.location.origin) throw new Error('Gmail authorization destination is invalid.');
      window.location.assign(destination.href);
    } catch (error) { setState('failed'); setMessage((error as Error).message); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Gmail from SkillOnIT?')) return;
    setState('connecting'); setMessage('');
    try { await responseMessage(await fetch('/api/v1/mail/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); setStatus({ ...status, connected: false, email: null, scopes: [] }); setState('idle'); }
    catch (error) { setState('failed'); setMessage((error as Error).message); }
  };
  return <div className={compact ? '' : 'panel'}>
    <span className="pill">{status.connected ? '✓ Gmail Connected' : state === 'failed' ? 'Connection failed' : 'Gmail not connected'}</span>
    {!compact && <><h2 style={{marginTop: 15}}>Send applications from your Gmail</h2><p>SkillOnIT requests only permission to send approved applications. It cannot read your inbox and never receives your Gmail password.</p></>}
    {status.connected ? <><p><strong>Email:</strong> {maskedEmail(status.email)}</p><p><strong>Permission:</strong><br />✓ Send applications from your Gmail</p><div className="actions"><button className="secondary" disabled={state === 'connecting'} onClick={() => void connect()}>Manage Gmail</button><button className="secondary" disabled={state === 'connecting'} onClick={() => void disconnect()}>Disconnect Gmail</button></div></> : <div className="actions"><button className="primary" disabled={state === 'connecting' || !status.available} onClick={() => void connect()}>{state === 'connecting' ? 'Connecting...' : state === 'failed' ? 'Try Again' : 'Connect Gmail'}</button>{compact && <Link className="secondary" href="/mail">Why connect Gmail?</Link>}</div>}
    {!status.available && <p className="notice error">Gmail authorization is awaiting secure backend configuration.</p>}
    {message && <p className="notice error" aria-live="polite">{message}</p>}
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

export function CvManager({ documents, profileRevision }: { documents: CvDocument[]; profileRevision: number }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
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
      <input id="cv-file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
      <button className="primary" disabled={!!busy} onClick={() => run('upload', async () => {
        const input = document.querySelector<HTMLInputElement>('#cv-file'); const file = input?.files?.[0];
        if (!file) throw new Error('Choose a PDF or DOCX file first.');
        return responseMessage(await fetch('/api/v1/me/cv', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': file.name }, body: file }));
      })}>{busy === 'upload' ? 'Uploading…' : 'Upload and process CV'}</button>
      {message && <p className="notice" aria-live="polite">{message}</p>}
    </div>
    {!documents.length ? <div className="panel"><h2>No CV uploaded yet</h2><p>You can continue with manual profile entry until CV processing is configured.</p></div> : documents.map(cv => <div className="panel" key={cv.id}>
      <div className="section-line"><div><span className="pill">{cv.status.replaceAll('_', ' ')}</span><h2 style={{marginTop: 12}}>{cv.filename}</h2></div><small>{Math.ceil(cv.size / 1024)} KB</small></div>
      <p className="small">Scan: {cv.scanStatus || 'pending'} · Extraction: {cv.extractionStatus || 'pending'} · Updated {new Date(cv.updatedAt).toLocaleString('en-IN')}</p>
      {cv.errorCode && <p className="notice error">Processing stopped safely: {cv.errorCode.replaceAll('_', ' ')}</p>}
      {cv.draft && <div><h3>Extracted profile draft</h3>{Object.entries(cv.draft).filter(([key]) => key !== 'confirmed').map(([key, value]) => <p key={key}><strong>{key.replaceAll(/([A-Z])/g, ' $1')}:</strong> {formatDraftValue(value)} <small>({cv.provenance?.[key] || 'Extracted from CV'})</small></p>)}</div>}
      <div className="actions">
        {cv.status === 'review' && <button className="primary" disabled={!!busy} onClick={() => run(cv.id + ':confirm', async () => {
          const draft = cv.draft || {}; const name = typeof draft.name === 'string' && draft.name.trim() ? draft.name : 'My CV';
          return responseMessage(await fetch(`/api/v1/me/cv/${cv.id}/confirm`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ profile: draft, confirmed: true, expectedRevision: cv.revision, expectedProfileRevision: profileRevision, name, targetRoles: [], summary: '' }) }));
        })}>Review complete — confirm facts</button>}
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
