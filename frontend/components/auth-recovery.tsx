'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft } from 'lucide-react';
import { readBrowserApiPayload } from '@/lib/browser-api';

export type RecoveryMode = 'verify-email' | 'resend-verification' | 'forgot-password' | 'reset-password';
const noStorageSubscription = () => () => {};
export function AuthRecovery({ mode }: { mode: RecoveryMode }) {
  const [editedEmail, setEmail] = useState<string | null>(null);
  const savedEmail = useSyncExternalStore(noStorageSubscription, () => sessionStorage.getItem('skillonit-verification-email') || '', () => '');
  const email = editedEmail ?? savedEmail;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const token = useRef('');
  useEffect(() => {
    token.current = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    if (token.current) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const verify = mode === 'verify-email';
  const reset = mode === 'reset-password';
  async function send(endpoint: string, data: Record<string, unknown>) {
    const response = await fetch('/api/v1/auth/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await readBrowserApiPayload<{ message?: string }>(response);
    if (!response.ok) throw Error(result.error?.message || 'Please try again later.');
    return result.data || {};
  }
  return <div className="auth-page"><div className="auth-card auth-recovery-card">
    <section className="auth-welcome"><Link className="brand auth-brand" href="/"><Image className="auth-brand-logo" src="/skillonit-employment-logo.png" alt="SkillOnIT Employment" width={720} height={240} priority /></Link></section>
    <section className="auth-form-panel">
      <div className="auth-form-heading"><div className="auth-heading-row"><div className="eyebrow">YOUR ACCOUNT</div><Link className="auth-back" href="/login"><ArrowLeft size={15} />Back</Link></div>
        <h1>{verify ? 'Verify your email' : reset ? 'Choose a new password' : mode === 'forgot-password' ? 'Forgot your password?' : 'Request a new code'}</h1>
        <p>{verify ? 'Enter the six-digit code from your email. It expires in five minutes.' : reset ? 'Choose a password with at least 6 characters.' : 'Enter the email address you used to create your account.'}</p>
      </div>
      {!complete && <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setMessage('');
        const fields = new FormData(event.currentTarget);
        try {
          if (reset && !token.current) throw Error('Open the password reset link from your email again.');
          if (reset && fields.get('password') !== fields.get('confirmPassword')) throw Error('Your passwords do not match.');
          const data = await send(mode, reset ? { token: token.current, password: fields.get('password') } : { email, ...(verify ? { otp: fields.get('otp') } : {}) });
          if (verify) { sessionStorage.removeItem('skillonit-verification-email'); window.location.assign('/dashboard'); }
          else { setMessage(data.message || 'Request completed.'); setComplete(true); token.current = ''; }
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); }
        finally { setBusy(false); }
      }}>
        {!reset && <label>Email address<input type="email" name="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>}
        {verify && <label>Verification code<input name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="Six-digit code" required /></label>}
        {reset && <><label>New password<input type="password" name="password" autoComplete="new-password" minLength={6} maxLength={128} required /></label><label>Confirm password<input type="password" name="confirmPassword" autoComplete="new-password" minLength={6} maxLength={128} required /></label></>}
        <button className="primary full" disabled={busy}>{busy ? 'Please wait…' : verify ? 'Verify email' : reset ? 'Save password' : 'Send email'}</button>
      </form>}
      {message && <output className="notice">{message}</output>}
      {verify && <button type="button" className="auth-resend" disabled={busy || !!cooldown || !email} onClick={async () => {
        setBusy(true); setMessage('');
        try { const data = await send('resend-verification', { email }); setMessage(data.message || 'Verification email requested.'); setCooldown(60); }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); }
        finally { setBusy(false); }
      }}>{cooldown ? `Resend in ${cooldown}s` : 'Resend verification code'}</button>}
      <div className="auth-bottom-link"><Link href="/login">Back to sign in</Link>{!verify && <> · <Link href="/verify-email">Verify email</Link></>}</div>
    </section>
  </div></div>;
}
