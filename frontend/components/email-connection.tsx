'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export function EmailConnectionVerification() {
  const verificationStarted = useRef(false);
  const [state, setState] = useState<'checking' | 'ready' | 'failed'>('checking');
  const [message, setMessage] = useState('Verifying your secure email connection link…');
  const [startUrl, setStartUrl] = useState<string | null>(null);

  useEffect(() => {
    // React development mode can invoke effects twice. This endpoint consumes a
    // single-use token, so only one verification request may leave this page.
    if (verificationStarted.current) return;
    verificationStarted.current = true;
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (fragmentToken) sessionStorage.setItem('skillonit-mail-connect-token', fragmentToken);
    const token = fragmentToken || sessionStorage.getItem('skillonit-mail-connect-token');
    // Remove the bearer token from browser history before making any request.
    history.replaceState(null, '', '/connect-email');
    if (!token) {
      void Promise.resolve().then(() => {
        setState('failed');
        setMessage('This connection link is invalid or expired. Request a new email from your profile.');
      });
      return;
    }
    void fetch('/api/v1/mail/verify-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(async response => {
      const result = await response.json().catch(() => null);
      if (response.status === 401) {
        window.location.assign('/login?next=/connect-email');
        return;
      }
      if (!response.ok || typeof result?.data?.startUrl !== 'string')
        throw new Error(result?.error?.message || 'This connection link is invalid or expired.');
      const destination = new URL(result.data.startUrl, window.location.origin);
      if (destination.origin !== window.location.origin)
        throw new Error('The email authorization destination is invalid.');
      sessionStorage.removeItem('skillonit-mail-connect-token');
      setStartUrl(destination.href);
      setState('ready');
      setMessage('Your SkillOnIT email is verified. Google will now ask for Gmail send-only permission.');
    }).catch(error => {
      setState('failed');
      setMessage(error instanceof Error ? error.message : 'The connection link could not be verified.');
    });
  }, []);

  return <main className="auth-shell"><div className="panel auth-card">
    <span className="pill">Email connection</span>
    <h1>{state === 'checking' ? 'Checking your secure link' : state === 'ready' ? 'Email verified' : 'Connection link unavailable'}</h1>
    <p aria-live="polite">{message}</p>
    {state === 'ready' && startUrl && <><p>SkillOnIT will not request access to read your inbox. You can revoke this permission at any time.</p><div className="actions"><button className="primary" onClick={() => window.location.assign(startUrl)}>Connect Gmail / Allow Email Access</button><Link className="secondary" href="/profile">Return to profile</Link></div></>}
    {state === 'failed' && <div className="actions"><Link className="primary" href="/mail">Request a new connection email</Link><Link className="secondary" href="/login">Sign in</Link></div>}
  </div></main>;
}
