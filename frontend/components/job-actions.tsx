'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { SmartForm } from './forms';

type ApplicationPreview = {
  job: { title: string; company: string; source: string; method: 'direct' | 'external' | 'email' };
  action: 'open_source_form' | 'send_authorized_email' | 'submit_to_employer';
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
    [preview, setPreview] = useState<ApplicationPreview | null>(null);
  async function review() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/applications/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const result = await response.json();
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!response.ok) throw Error(result.error?.message || 'Application details could not be loaded.');
      setPreview(result.data);
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
        body: JSON.stringify({ jobId, confirmed: true }),
      });
      const j = await r.json();
      if (r.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!r.ok) throw Error(j.error?.message);
      setMessage(
        sample
          ? 'Demo application recorded. No real employer has been contacted.'
          : j.data.method === 'email' && j.data.status === 'QUEUED'
            ? 'Application confirmed and queued to send from your connected Gmail.'
            : 'Application recorded: ' + j.data.status.replaceAll('_', ' '),
      );
      setOpen(false);
      if (j.data.externalUrl) window.location.assign(j.data.externalUrl);
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
              : preview?.action === 'open_source_form'
                ? preview.destinationKind === 'direct-form'
                  ? `After you confirm, you’ll open the real application form provided by ${preview.job.source}.`
                  : preview.destinationKind === 'source-redirect'
                    ? `After you confirm, ${preview.job.source} will send you to this job’s authorized application destination.`
                    : `After you confirm, you’ll open this job’s source page, where the source provides its application process.`
                : preview?.action === 'send_authorized_email'
                  ? 'Review the saved details below. After you confirm, SkillOnIT will send this application from your connected Gmail.'
                  : 'After you confirm, SkillOnIT will submit the reviewed details to this employer.'}
          </DialogDescription>
          {preview && <div className="application-review">
            <p><strong>{preview.job.title}</strong><br />{preview.job.company}</p>
            <p className="small">Source: {preview.job.source}{preview.destinationHost ? ` · Form hosted on ${preview.destinationHost}` : ''}</p>
            {preview.action === 'open_source_form' ? (
              <p className="notice small">{preview.destinationKind === 'direct-form' ? 'This link goes to the source-provided application form.' : preview.destinationKind === 'source-redirect' ? 'This is the source-authorized job link and may pass through its redirect before opening the employer’s application destination.' : 'This opens the job-specific source page, not a general homepage. Use the source’s Apply control to continue.'} SkillOnIT will not send your profile, CV, or email to the external site; fill its required fields there.</p>
            ) : (
              <p className="small">Reused after confirmation: {preview.dataShared.join(', ') || 'No candidate data'}.</p>
            )}
            {preview.email.used && <div className="notice small">
              <strong>Gmail delivery</strong><br />
              From: {preview.email.connected ? preview.email.address : 'Connect Gmail before sending.'}<br />
              To: {preview.email.destination || 'Verified recruitment email unavailable'}
            </div>}
            {preview.review && <div className="application-review-details">
              <h3>Details reused for this application</h3>
              <p className="small"><strong>Candidate:</strong> {preview.review.profile.name} · {preview.review.profile.email}</p>
              {(preview.review.profile.headline || preview.review.profile.location) && <p className="small">{[preview.review.profile.headline, preview.review.profile.location].filter(Boolean).join(' · ')}</p>}
              {!!preview.review.profile.skills.length && <p className="small"><strong>Skills:</strong> {preview.review.profile.skills.join(', ')}</p>}
              <p className="small"><strong>CV:</strong> {preview.review.cv?.attached ? preview.review.cv.name : 'No confirmed CV selected'}</p>
              {preview.review.message && <div className="application-message-preview">
                <p className="small"><strong>Subject:</strong> {preview.review.message.subject}</p>
                <pre>{preview.review.message.text}</pre>
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
            disabled={busy || !preview || !preview.readyToConfirm}
            onClick={() => void apply()}
          >
            {busy ? 'Checking…' : preview?.action === 'open_source_form' ? preview.destinationKind === 'direct-form' ? 'Confirm and open application form' : 'Confirm and continue to application' : preview?.action === 'send_authorized_email' ? 'Confirm and send from Gmail' : 'Confirm and apply'}
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
