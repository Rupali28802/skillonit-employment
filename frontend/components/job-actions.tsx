'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { SmartForm } from './forms';
export function JobActions({
  jobId,
  sample,
}: {
  jobId: string;
  sample?: boolean;
}) {
  const [message, setMessage] = useState(''),
    [open, setOpen] = useState(false),
    [report, setReport] = useState(false),
    [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true);
    try {
      const r = await fetch('/api/v1/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
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
      <button className="primary full" onClick={() => setOpen(true)}>
        Apply now
      </button>
      <button
        className="secondary full"
        style={{ marginTop: 10 }}
        onClick={() => setReport(true)}
      >
        Report this opportunity
      </button>
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
              : 'Submitting shares your confirmed candidate profile with the employer for this vacancy. External applications continue on the employer website.'}
          </DialogDescription>
          <p className="small">
            Check your profile before proceeding. Your plan allowance and
            employer verification are checked on the server.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void apply()}
          >
            {busy ? 'Checking…' : 'Confirm and apply'}
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
