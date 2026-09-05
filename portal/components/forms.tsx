'use client';
import { display } from '@/lib/display';
import { useState } from 'react';
import Link from 'next/link';
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: string[];
  required?: boolean;
  hint?: string;
};
export function SmartForm({
  fields,
  endpoint,
  method = 'POST',
  initial = {},
  submit = 'Save changes',
  onSuccess,
}: {
  fields: Field[];
  endpoint: string;
  method?: string;
  initial?: Record<string, unknown>;
  submit?: string;
  onSuccess?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage('');
        const form = new FormData(e.currentTarget),
          payload: Record<string, unknown> = {};
        for (const f of fields) {
          const v = form.get(f.name);
          payload[f.name] =
            f.type === 'number'
              ? Number(v)
              : f.type === 'checkbox'
                ? v === 'on'
                : f.type === 'list'
                  ? display(v || '')
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : v;
        }
        try {
          const r = await fetch('/api/v1/' + endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const j = await r.json();
          if (!r.ok)
            throw Error(j.error?.message || 'Could not save your changes.');
          setError(false);
          setMessage(j.data?.message || 'Your changes have been saved.');
          onSuccess?.();
        } catch (e) {
          setError(true);
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        {fields.map((f) => (
          <label
            key={f.name}
            style={
              f.type === 'textarea' || f.type === 'checkbox'
                ? { gridColumn: '1/-1' }
                : undefined
            }
          >
            {f.type === 'checkbox' ? (
              <>
                <input
                  name={f.name}
                  type="checkbox"
                  defaultChecked={!!initial[f.name]}
                  required={f.required}
                />
                {f.label}
              </>
            ) : (
              <>
                {f.label}
                {f.options ? (
                  <select
                    name={f.name}
                    defaultValue={display(initial[f.name] || f.options[0])}
                  >
                    {f.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea
                    name={f.name}
                    defaultValue={display(initial[f.name] || '')}
                    required={f.required !== false}
                  />
                ) : (
                  <input
                    name={f.name}
                    type={f.type === 'list' ? 'text' : f.type || 'text'}
                    min={f.type === 'number' ? 0 : undefined}
                    defaultValue={
                      Array.isArray(initial[f.name])
                        ? (initial[f.name] as string[]).join(', ')
                        : display(initial[f.name] ?? '')
                    }
                    required={f.required !== false}
                  />
                )}
              </>
            )}
            {f.hint && <small className="muted">{f.hint}</small>}
          </label>
        ))}
      </div>
      <div aria-live="polite">
        {message && (
          <p className={'notice ' + (error ? 'error' : '')}>{message}</p>
        )}
      </div>
      <button className="primary" disabled={busy}>
        {busy ? 'Saving…' : submit}
      </button>
    </form>
  );
}
export function Action({
  endpoint,
  label,
  payload = {},
  method = 'POST',
  redirect,
  confirm = false,
}: {
  endpoint: string;
  label: string;
  payload?: unknown;
  method?: string;
  redirect?: string;
  confirm?: boolean;
}) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        className="secondary"
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm('Confirm this request?')) return;
          setBusy(true);
          try {
            const r = await fetch('/api/v1/' + endpoint, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const j = await r.json();
            if (!r.ok)
              throw Error(
                j.error?.message || 'The action could not be completed.',
              );
            if (redirect) window.location.href = redirect;
            else {
              setMessage(j.data?.message || 'Updated successfully.');
              window.location.reload();
            }
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Please wait…' : label}
      </button>
      {message && (
        <p aria-live="polite" className="notice small">
          {message}
        </p>
      )}
    </div>
  );
}
export function AuthForm({
  register = false,
  demo = false,
}: {
  register?: boolean;
  demo?: boolean;
}) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState('');
  return (
    <div className="form-wrap">
      <div className="panel">
        <div className="eyebrow">YOUR CAREER, YOUR DIRECTION</div>
        <h1 style={{ marginTop: 18 }}>
          {register ? 'Create your account' : 'Welcome back'}
        </h1>
        <p>
          {register
            ? 'Start with a profile that reflects you.'
            : 'Sign in to your SkillonIT workspace.'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const data = Object.fromEntries(new FormData(e.currentTarget));
            try {
              const r = await fetch(
                '/api/v1/auth/' + (register ? 'register' : 'login'),
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
                },
              );
              const j = await r.json();
              if (!r.ok) throw Error(j.error?.message);
              if (j.data.demoVerificationToken) {
                setToken(j.data.demoVerificationToken);
                setMessage(
                  'Demo account created. Complete the test email verification below; no email was sent.',
                );
              } else
                window.location.href =
                  j.data.user.role === 'employer'
                    ? '/employer'
                    : j.data.user.role === 'admin'
                      ? '/admin'
                      : '/dashboard';
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {register && (
            <label>
              Your name
              <input name="name" autoComplete="name" required />
            </label>
          )}
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              minLength={register ? 12 : undefined}
              maxLength={128}
              required
            />
          </label>
          {register && (
            <>
              <p className="small">
                Use at least 12 characters. Never reuse a password from another
                service.
              </p>
              <label>
                I am a
                <select name="role">
                  <option value="student">Job seeker</option>
                  <option value="employer">Employer</option>
                </select>
              </label>
            </>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
          </button>
        </form>
        {message && (
          <p className="notice" aria-live="polite" style={{ marginTop: 15 }}>
            {message}
          </p>
        )}
        {token && (
          <Action
            endpoint="auth/verify-email"
            label="Verify this demo account"
            payload={{ token }}
            redirect="/profile"
          />
        )}
        <p className="small" style={{ marginTop: 22 }}>
          {register ? 'Already have an account?' : 'New to SkillonIT?'}{' '}
          <Link href={register ? '/login' : '/register'}>
            {register ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </div>
      {demo && (
        <div className="panel">
          <h2>Explore the local demo</h2>
          <p className="small">
            Uses fictional profiles and local test data. No email is sent and no
            payment is taken.
          </p>
          <div className="actions">
            {['student', 'employer', 'admin'].map((role) => (
              <Action
                key={role}
                endpoint="auth/demo"
                label={'Demo ' + role}
                payload={{ role }}
                redirect={role === 'student' ? '/dashboard' : '/' + role}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
