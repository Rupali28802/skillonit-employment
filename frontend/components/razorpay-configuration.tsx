'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './razorpay-configuration.module.css';
import { readBrowserApiPayload } from '@/lib/browser-api';

type Environment = 'test' | 'live';
type Metadata = {
  revision: number;
  environment: Environment;
  activeEnvironment: Environment | null;
  source: string;
  configured: boolean;
  keyIdMasked: string | null;
  secretConfigured: boolean;
  webhookConfigured: boolean;
  enabled: boolean;
  status: string;
  lastAttemptFailed: boolean;
  pendingActivation: boolean;
  lastValidatedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};
type History = {
  id: string;
  actorId: string;
  action: string;
  environment: string;
  success: boolean;
  reason: string;
  createdAt: string;
};
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api/v1/admin/payments/razorpay/' + path, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  });
  const payload = await readBrowserApiPayload<T>(response);
  if (!response.ok)
    throw new Error(
      payload.error?.message || 'Payment configuration could not be updated.',
    );
  if (payload.data === undefined)
    throw new Error('Payment configuration returned an incomplete response.');
  return payload.data;
}
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

export function RazorpayConfiguration({ canManage }: { canManage: boolean }) {
  const [environment, setEnvironment] = useState<Environment>('test');
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      call<Metadata>('config?environment=' + environment),
      call<History[]>('history'),
    ])
      .then(([config, events]) => {
        if (!cancelled) {
          setMetadata(config);
          setHistory(events);
        }
      })
      .catch(() => {
        if (!cancelled)
          setMessage(
            'Unable to load Razorpay configuration. Reload to try again.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [environment]);
  const live = environment === 'live' || metadata?.activeEnvironment === 'live';
  async function action(kind: 'config' | 'validate' | 'enable' | 'disable') {
    if (
      !form.current ||
      !metadata ||
      busy ||
      !canManage ||
      !form.current.reportValidity()
    )
      return;
    const fields = new FormData(form.current);
    const payload: Record<string, unknown> = {
      environment,
      expectedRevision: metadata.revision,
      reason: fields.get('reason'),
      confirmed: fields.get('confirmed') === 'on',
      liveConfirmed: fields.get('liveConfirmed') === 'on',
    };
    if (kind === 'config')
      for (const key of ['keyId', 'keySecret', 'webhookSecret']) {
        const value = fields.get(key);
        if (typeof value === 'string' && value) payload[key] = value;
      }
    setBusy(true);
    setMessage('');
    try {
      const request = call<{
        valid: boolean;
        configuration: Metadata;
        message?: string;
      }>(kind, { method: 'POST', body: JSON.stringify(payload) });
      // Keep secrets only in the password controls/request, never React state or browser storage.
      for (const key of ['keySecret', 'webhookSecret']) {
        const input = form.current.elements.namedItem(
          key,
        ) as HTMLInputElement | null;
        if (input) input.value = '';
        delete payload[key];
        fields.delete(key);
      }
      const result = await request;
      setMetadata(result.configuration);
      setMessage(
        result.message ||
          (result.valid
            ? 'Razorpay configuration updated.'
            : 'Validation failed. The active configuration was preserved.'),
      );
      form.current.reset();
      setHistory(await call<History[]>('history'));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to update configuration.',
      );
      // Refresh optimistic-concurrency metadata after a conflict without resubmitting secrets.
      try {
        setMetadata(await call<Metadata>('config?environment=' + environment));
      } catch {
        /* Retain the safe error. */
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className={styles.panel}>
      <summary>Razorpay Configuration</summary>
      <div className={styles.content}>
        <label>
          Environment
          <select
            value={environment}
            disabled={busy}
            onChange={(event) => {
              form.current?.reset();
              setMetadata(null);
              setMessage('');
              setEnvironment(event.target.value as Environment);
            }}
          >
            <option value="test">TEST</option>
            <option value="live">LIVE</option>
          </select>
        </label>
        {message && <output>{message}</output>}
        {!metadata ? (
          <p>Loading configuration…</p>
        ) : (
          <>
            <dl className={styles.metadata}>
              <div>
                <dt>Status</dt>
                <dd>
                  {metadata.lastAttemptFailed
                    ? 'Validation failed — previous configuration preserved'
                    : metadata.status.replaceAll('_', ' ')}
                </dd>
              </div>
              <div>
                <dt>Enabled</dt>
                <dd>{metadata.enabled ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Active environment</dt>
                <dd>{metadata.activeEnvironment?.toUpperCase() || 'None'}</dd>
              </div>
              <div>
                <dt>Key ID</dt>
                <dd>{metadata.keyIdMasked || 'Not configured'}</dd>
              </div>
              <div>
                <dt>Key Secret</dt>
                <dd>
                  {metadata.secretConfigured
                    ? '••••••••••••'
                    : 'Not configured'}
                </dd>
              </div>
              <div>
                <dt>Webhook secret</dt>
                <dd>
                  {metadata.webhookConfigured ? 'Configured' : 'Not configured'}
                </dd>
              </div>
              <div>
                <dt>Last validated</dt>
                <dd>{date(metadata.lastValidatedAt)}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{date(metadata.updatedAt)}</dd>
              </div>
              <div>
                <dt>Updated by</dt>
                <dd>{metadata.updatedBy || '—'}</dd>
              </div>
              <div>
                <dt>Configuration source</dt>
                <dd>{metadata.source}</dd>
              </div>
            </dl>
            {metadata.pendingActivation && (
              <p>
                Saved credentials are awaiting activation. Select Enable to use
                them for new checkouts.
              </p>
            )}
            {metadata.source === 'environment' && (
              <p>
                Deployment credentials remain in use until Admin configuration
                is saved. Saving preserves existing payments; enabling activates
                the saved credentials.
              </p>
            )}
            {canManage && (
              <form
                ref={form}
                autoComplete="off"
                onSubmit={(event) => {
                  event.preventDefault();
                  void action('config');
                }}
              >
                <fieldset disabled={busy} className={styles.fields}>
                  <label>
                    Key ID
                    <input
                      name="keyId"
                      placeholder={
                        metadata.keyIdMasked || `rzp_${environment}_…`
                      }
                      autoComplete="off"
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Key Secret
                    <input
                      name="keySecret"
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        metadata.secretConfigured
                          ? 'Leave blank to retain'
                          : 'Enter Key Secret'
                      }
                      maxLength={500}
                    />
                  </label>
                  <label>
                    Webhook signing secret
                    <input
                      name="webhookSecret"
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        metadata.webhookConfigured
                          ? 'Leave blank to retain'
                          : 'Separate webhook secret'
                      }
                      maxLength={500}
                    />
                  </label>
                  <label className={styles.wide}>
                    Reason
                    <input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={300}
                      placeholder="Reason for this configuration change"
                    />
                  </label>
                  <label className={`${styles.check} ${styles.wide}`}>
                    <input type="checkbox" name="confirmed" required />I
                    understand this changes production payment configuration.
                  </label>
                  {live && (
                    <label
                      className={`${styles.check} ${styles.warning} ${styles.wide}`}
                    >
                      <input type="checkbox" name="liveConfirmed" required />
                      You&apos;re changing LIVE Razorpay configuration. This
                      affects real payments.
                    </label>
                  )}
                  <div className={`${styles.actions} ${styles.wide}`}>
                    <button type="submit" className="primary">
                      {busy ? 'Working…' : 'Save Configuration'}
                    </button>
                    <button
                      type="button"
                      disabled={
                        metadata.source !== 'admin' || !metadata.configured
                      }
                      onClick={() => void action('validate')}
                    >
                      Validate Connection
                    </button>
                    <button
                      type="button"
                      disabled={
                        metadata.source !== 'admin' || !metadata.configured
                      }
                      onClick={() => void action('enable')}
                    >
                      Enable / Activate
                    </button>
                    <button
                      type="button"
                      disabled={metadata.source !== 'admin'}
                      onClick={() => void action('disable')}
                    >
                      Disable Razorpay
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
            <details>
              <summary>Configuration audit history</summary>
              {history.length ? (
                <ul className={styles.history}>
                  {history.map((event) => (
                    <li key={event.id}>
                      <strong>
                        {event.action
                          .replace('RAZORPAY_CONFIGURATION_', '')
                          .toLowerCase()}{' '}
                        · {event.environment.toUpperCase()} ·{' '}
                        {event.success ? 'Success' : 'Failed'}
                      </strong>
                      <div>
                        {date(event.createdAt)} · {event.actorId}
                      </div>
                      <div>{event.reason}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No configuration changes recorded.</p>
              )}
            </details>
          </>
        )}
      </div>
    </details>
  );
}
