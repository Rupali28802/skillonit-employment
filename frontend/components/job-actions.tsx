'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { SmartForm } from './forms';
import { readBrowserApiPayload } from '@/lib/browser-api';

type ApplicationPreview = {
  job: { title: string; company: string; source: string; method: 'direct' | 'external' | 'email' };
  action: 'prepare_assisted_application' | 'send_authorized_email' | 'submit_to_employer';
  destinationHost: string | null;
  destinationKind: 'direct-form' | 'source-job-page' | 'source-redirect' | null;
  requiresConfirmation: true;
  readyToConfirm: boolean;
  missingRequirements: { code: string; label: string; href: string }[];
  dataShared: string[];
  email: { address: string; used: boolean; connected: boolean; destination: string | null };
  review: null | {
    profile: { name: string; email: string; headline: string; location: string; skills: string[]; experience: number | null; education: string; contactInfo: string };
    cv: { id: string; name: string; attached: boolean } | null;
    message: { subject: string; text: string } | null;
  };
  templates:{id:string;name:string;isDefault:boolean}[];
  selectedTemplateId:string|null;
  assistedApplication: null | { fields: { name: string; label: string; required: boolean; needsConfirmation: boolean; protectedStep?: boolean }[]; missingFields: string[]; protectedFields: string[]; mode: 'ASSISTED_APPLICATION' };
};

export function JobActions({
  jobId,
  sample,
  compact = false,
}: {
  jobId: string;
  sample?: boolean;
  compact?: boolean;
}) {
  const [message, setMessage] = useState(''),
    [open, setOpen] = useState(false),
    [report, setReport] = useState(false),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<ApplicationPreview | null>(null),
    [subject,setSubject]=useState(''),[emailBody,setEmailBody]=useState('');
  async function review(templateId?:string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/applications/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, ...(templateId?{templateId}:{}) }),
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const result = await readBrowserApiPayload<ApplicationPreview>(response);
      if (!response.ok) throw Error(result.error?.message || 'Application details could not be loaded.');
      if (!result.data) throw Error('Application details could not be loaded.');
      setPreview(result.data);
      setSubject(result.data.review?.message?.subject||'');setEmailBody(result.data.review?.message?.text||'');
      setOpen(true);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    try {
      const r = await fetch('/api/v1/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, confirmed: true,...(preview?.selectedTemplateId?{templateId:preview.selectedTemplateId}:{}),...(preview?.action==='send_authorized_email'&&subject&&emailBody?{subject,body:emailBody}:{}) }),
      });
      if (r.status === 401) {
        window.location.href = '/login';
        return;
      }
      const j = await readBrowserApiPayload<{ method: string; status: string }>(r);
      if (!r.ok) throw Error(j.error?.message);
      if (!j.data) throw Error('Application could not be completed. Please try again.');
      setMessage(
        sample
          ? 'Demo application recorded. No real employer has been contacted.'
          : j.data.method === 'external'
            ? 'Application plan saved. It still requires an authorized employer-form integration or your further action; no data was submitted externally.'
          : j.data.method === 'email' && j.data.status === 'QUEUED'
            ? 'Application confirmed and queued to send from your connected Gmail.'
            : 'Application recorded: ' + j.data.status.replaceAll('_', ' '),
      );
      setOpen(false);
      // External applications are saved as an in-platform, candidate-reviewed plan.
      // A source form is never opened automatically after confirmation.
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className={compact ? 'primary job-apply' : 'primary full'} disabled={busy} onClick={() => void review()}>
        {busy ? 'Checking…' : 'Apply'}
      </button>
      {!compact && <button
        className="secondary full"
        style={{ marginTop: 10 }}
        onClick={() => setReport(true)}
      >
        Report this opportunity
      </button>}
      {message && (
        <p className="notice" aria-live="polite" style={{ marginTop: 15 }}>
          {message}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Review your application</DialogTitle>
          <DialogDescription>
            {sample
              ? 'This is a sample vacancy. Submitting records a demo application only.'
              : preview?.action === 'prepare_assisted_application'
                ? 'SkillonIT will create a private application plan using only your confirmed profile and CV. It will not open, fill, or submit an external form automatically.'
                : preview?.action === 'send_authorized_email'
                  ? 'Review the saved details below. After you confirm, SkillOnIT will send this application from your connected Gmail.'
                  : 'After you confirm, SkillOnIT will submit the reviewed details to this employer.'}
          </DialogDescription>
          {preview && <div className="application-review">
            <p><strong>{preview.job.title}</strong><br />{preview.job.company}</p>
            <p className="small">Source: {preview.job.source}{preview.destinationHost ? ` · Form hosted on ${preview.destinationHost}` : ''}</p>
            {preview.action === 'prepare_assisted_application' ? (
              <><p className="notice small">This job uses an external form. SkillonIT has no verified submission integration for {preview.destinationHost || 'this destination'}, so it will not use browser automation, bypass CAPTCHA, or share your data. We will save your reviewed application plan and clearly mark it as requiring further action.</p>
              {preview.assistedApplication && <div className="application-review-details"><h3>Application details prepared</h3><ul>{preview.assistedApplication.fields.map(field => <li key={field.name}>{field.label}: {field.needsConfirmation ? <strong>Needs your input</strong> : 'Ready from your confirmed profile'}{field.protectedStep ? ' (protected step)' : ''}</li>)}</ul>{preview.assistedApplication.missingFields.length > 0 && <p className="small">Complete missing details in your profile or when using an authorized employer integration: {preview.assistedApplication.missingFields.join(', ')}.</p>}</div>}</>
            ) : (
              <p className="small">Reused after confirmation: {preview.dataShared.join(', ') || 'No candidate data'}.</p>
            )}
            {preview.email.used && <div className="notice small">
              <strong>Gmail delivery</strong><br />
              From: {preview.email.connected ? preview.email.address : 'Connect Gmail before sending.'}<br />
              To: {preview.email.destination || 'Verified recruitment email unavailable'}
            </div>}
            {!!preview.templates.length&&preview.action!=='prepare_assisted_application'&&<label>Application template<select value={preview.selectedTemplateId||''} onChange={event=>void review(event.target.value)}>{preview.templates.map(template=><option value={template.id} key={template.id}>{template.name}{template.isDefault?' (Default)':''}</option>)}</select></label>}
            {preview.review && <div className="application-review-details">
              <h3>Details reused for this application</h3>
              <p className="small"><strong>Candidate:</strong> {preview.review.profile.name} · {preview.review.profile.email}</p>
              {(preview.review.profile.headline || preview.review.profile.location) && <p className="small">{[preview.review.profile.headline, preview.review.profile.location].filter(Boolean).join(' · ')}</p>}
              {!!preview.review.profile.skills.length && <p className="small"><strong>Skills:</strong> {preview.review.profile.skills.join(', ')}</p>}
              <p className="small"><strong>CV:</strong> {preview.review.cv?.attached ? preview.review.cv.name : 'No confirmed CV selected'}</p>
              {preview.review.message && <div className="application-message-preview">
                <label>Subject<input value={subject} onChange={event=>setSubject(event.target.value)} maxLength={300}/></label>
                <label>Email body<textarea value={emailBody} onChange={event=>setEmailBody(event.target.value)} rows={12}/></label>
                <button className="secondary" type="button" disabled={busy} onClick={()=>void review(preview.selectedTemplateId||undefined)}>Regenerate personalization</button>
                <p className="small">Edits apply only to this application and do not change the saved master template.</p>
              </div>}
            </div>}
            {!!preview.missingRequirements.length && <div className="notice small">
              <strong>Complete these before applying:</strong>
              <ul>{preview.missingRequirements.map(item => <li key={item.code}><a href={item.href}>{item.label}</a></li>)}</ul>
            </div>}
          </div>}
          <p className="small">Nothing is submitted until you select the confirmation button below.</p>
          <button
            className="primary"
            disabled={busy || !preview}
            onClick={() => void apply()}
          >
            {busy ? 'Checking…' : preview && !preview.readyToConfirm ? 'Record attempt for review' : preview?.action === 'prepare_assisted_application' ? 'Confirm and save application plan' : preview?.action === 'send_authorized_email' ? 'Confirm and queue Gmail application' : 'Confirm and apply'}
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={report} onOpenChange={setReport}>
        <DialogContent>
          <DialogTitle>Report a concern</DialogTitle>
          <DialogDescription>
            Explain what looks suspicious. Your report goes to the moderation
            queue.
          </DialogDescription>
          <SmartForm
            endpoint="reports"
            initial={{ entityId: jobId }}
            fields={[
              { name: 'entityId', label: 'Job reference' },
              { name: 'reason', label: 'Reason', type: 'textarea' },
            ]}
            submit="Submit report"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
