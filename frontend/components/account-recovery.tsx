'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export function AccountRecovery({
  mode,
}: {
  mode:
    | 'forgot-password'
    | 'reset-password'
    | 'verify-email'
    | 'resend-verification';
}) {
  const token = useRef('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [testLink, setTestLink] = useState('');
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has('token')) token.current = fragment.get('token') || '';
    if (fragment.has('token'))
      window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const title = {
    'forgot-password': 'Forgot your password?',
    'reset-password': 'Choose a new password',
    'verify-email': 'Verify your email',
    'resend-verification': 'Request a verification email',
  }[mode];
  const emailRequired =
    mode === 'forgot-password' || mode === 'resend-verification';
  return (
    <div className="form-wrap">
      <div className="panel">
        <h1>{title}</h1>
        <p>
          {emailRequired
            ? 'Enter your account email address.'
            : 'Submit this form to confirm your request. Links expire after 30 minutes.'}
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setMessage('');
            setTestLink('');
            const data = new FormData(event.currentTarget);
            try {
              if (!emailRequired && !token.current) throw new Error('Open a valid link from your email. If you refreshed, reopen the original link.');
              const response = await fetch('/api/v1/auth/' + mode, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                  emailRequired
                    ? { email: data.get('email') }
                    : {
                        token: token.current,
                        ...(mode === 'reset-password'
                          ? { password: data.get('password') }
                          : {}),
                      },
                ),
              });
              const result = await response.json();
              if (!response.ok)
                throw new Error(
                  result.error?.message || 'Please try again later.',
                );
              setMessage(
                result.data.message ||
                  'Email verified. You can continue to your account.',
              );
              if (!emailRequired) {
                setComplete(true);
                token.current = '';
              }
              const demo =
                result.data.demoResetToken || result.data.demoVerificationToken;
              if (demo)
                setTestLink(
                  `/${result.data.demoResetToken ? 'reset-password' : 'verify-email'}#token=${encodeURIComponent(demo)}`,
                );
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : 'Please try again.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {emailRequired && (
            <label>
              Email
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                maxLength={254}
              />
            </label>
          )}
          {mode === 'reset-password' && !complete && (
            <label>
              New password
              <input
                type="password"
                name="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
          )}
          {!complete && (
            <button
              className="primary full"
              disabled={busy}
            >
              {busy ? 'Submitting…' : 'Continue'}
            </button>
          )}
        </form>
        {message && (
          <output className="notice" style={{ display: 'block', marginTop: 16 }}>
            {message}
          </output>
        )}
        {testLink && (
          <p>
            <a href={testLink}>Demo only: open test link (no email sent)</a>
          </p>
        )}
        <div className="actions">
          <Link href="/login">Back to sign in</Link>
          <Link href="/resend-verification">Resend verification</Link>
        </div>
      </div>
    </div>
  );
}
