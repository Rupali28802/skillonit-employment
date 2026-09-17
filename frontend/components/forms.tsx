'use client';
import { display } from '@/lib/display';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: string[];
  required?: boolean;
  hint?: string;
};
const noAuthSubscription = () => () => {};
export function SmartForm({
  fields,
  endpoint,
  method = 'POST',
  initial = {},
  submit = 'Save changes',
  onSuccess,
  expectedRevision,
  preservedFields = {},
}: {
  fields: Field[];
  endpoint: string;
  method?: string;
  initial?: Record<string, unknown>;
  submit?: string;
  onSuccess?: () => void;
  expectedRevision?: number;
  preservedFields?: Record<string, unknown>;
}) {
  const [revision, setRevision] = useState(expectedRevision);
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
          payload: Record<string, unknown> = { ...preservedFields, ...(revision !== undefined ? { expectedRevision: revision } : {}) };
        for (const f of fields) {
          const v = form.get(f.name);
          payload[f.name] =
            f.type === 'number'
              ? (v === '' && f.required === false ? null : Number(v))
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
          if (revision !== undefined)
            setRevision(typeof j.data?.revision === 'number' ? j.data.revision : revision + 1);
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
            if (typeof j.data?.startUrl === 'string') {
              const destination = new URL(j.data.startUrl, window.location.origin);
              if (destination.origin !== window.location.origin)
                throw Error('The authorization destination is invalid.');
              window.location.assign(destination.href);
            } else if (redirect) window.location.href = redirect;
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
    [showPassword, setShowPassword] = useState(false),
    [accountType, setAccountType] = useState('student');
  const authError = useSyncExternalStore(noAuthSubscription, () => new URLSearchParams(window.location.search).get('auth_error'), () => null);
  const providerMessage = authError === 'google_email_proof' ? 'Sign in with your password first to link this Google email safely.' : authError ? 'Google sign-in was not completed. Please try again.' : '';
  return (
    <div className="auth-page">
      <div className="auth-card">
        <section
          className="auth-welcome"
          aria-label="Welcome to SkillonIT Employment"
        >
          <Link className="brand auth-brand" href="/">
            <span className="brand-icon">
              <BriefcaseBusiness size={24} />
            </span>
            Skillon<span>IT</span>
            <small>EMPLOYMENT</small>
          </Link>
          <div className="auth-welcome-copy">
            <span className="auth-welcome-badge">
              <Sparkles size={15} /> YOUR NEXT CHAPTER
            </span>
            <h2>
              {accountType === 'employer'
                ? 'Great teams start with you.'
                : register
                  ? 'Find the work made for you.'
                  : 'Welcome back. Move forward.'}
            </h2>
            <p>
              {accountType === 'employer'
                ? 'Post opportunities, connect with candidates and build your next great team.'
                : 'Bring your skills, ambitions and experience. Discover where they can take you.'}
            </p>
            <div className="auth-benefits">
              <span>
                <Check size={17} /> A profile that tells your story
              </span>
              <span>
                <Check size={17} /> Opportunities that fit your skills
              </span>
              <span>
                <Check size={17} /> Every application, in your control
              </span>
            </div>
            <div className="auth-switch-prompt">
              <strong>
                {register
                  ? 'Already part of SkillonIT?'
                  : 'Hello, new beginnings.'}
              </strong>
              <p>
                {register
                  ? 'Your next opportunity is waiting. Let’s pick up where you left off.'
                  : 'Create your profile and start your next chapter with us.'}
              </p>
              <Link
                className="auth-outline"
                href={register ? '/login' : '/register'}
              >
                {register ? 'Sign in' : 'Create an account'}
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
          <div className="auth-decoration" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="auth-welcome-footer">
            <ShieldCheck size={16} /> Your career. Your direction.
          </span>
        </section>
        <section
          className="auth-form-panel"
          aria-label={register ? 'Register' : 'Sign in'}
        >
          <div className="auth-form-heading">
            <div className="auth-heading-row">
              <div className="eyebrow">SKILLONIT EMPLOYMENT</div>
              <Link className="auth-back" href="/" onClick={(event) => {
                if (window.history.length > 1) {
                  event.preventDefault();
                  window.history.back();
                }
              }}><ArrowLeft size={15} /> Back</Link>
            </div>
            <h1>
              {register
                ? 'Create your account'
                : accountType === 'employer'
                  ? 'Employer login'
                  : 'Sign in to your account'}
            </h1>
            <p>
              {register
                ? 'Your next opportunity starts here.'
                : 'Good to see you again. Let’s get you signed in.'}
            </p>
          </div>
          <fieldset
            className="auth-role-switch"
            aria-label="Account type"
          >
            <button
              type="button"
              aria-pressed={accountType === 'student'}
              onClick={() => setAccountType('student')}
            >
              Job seeker
            </button>
            <button
              type="button"
              aria-pressed={accountType === 'employer'}
              onClick={() => setAccountType('employer')}
            >
              Employer
            </button>
          </fieldset>
          {accountType === 'student' && <>
            <button type="button" className="auth-google" disabled={busy} onClick={async () => {
              setBusy(true); setMessage('');
              try {
                const response = await fetch('/api/v1/auth/google/status');
                const result = await response.json();
                if (!response.ok || !result.data?.available) throw Error('Google sign-in is not available yet. Please use email sign-in.');
                window.location.assign(result.data.startUrl);
              } catch (error) { setMessage(error instanceof Error ? error.message : 'Google sign-in is unavailable.'); setBusy(false); }
            }}><span className="auth-google-mark" aria-hidden="true">G</span>Continue with Google</button>
            <div className="auth-divider"><span>or continue with email</span></div>
          </>}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage('');
              const data = Object.fromEntries(new FormData(e.currentTarget));
              if (register && data.password !== data.confirmPassword) {
                setMessage(
                  'Your passwords do not match. Please check and try again.',
                );
                setBusy(false);
                return;
              }
              delete data.confirmPassword;
              if (register) data.role = accountType;
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
                if (register && !j.data.user.verified) {
                  sessionStorage.setItem('skillonit-verification-email', typeof data.email === 'string' ? data.email : '');
                  window.location.assign('/verify-email');
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
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Enter your full name"
                  maxLength={200}
                  required
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
            <label>
              Password
              <span className="auth-password">
                <input
                  name="password"
                  aria-label="Password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={
                    register ? 'Create a password' : 'Enter your password'
                  }
                  autoComplete={register ? 'new-password' : 'current-password'}
                  minLength={register ? 12 : undefined}
                  maxLength={128}
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {register && (
              <>
                <p className="auth-password-hint">
                  Use at least 12 characters.
                </p>
                <label>
                  Confirm password
                  <input
                    name="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
              </>
            )}
            {!register && (
              <div className="auth-help">
                <Link href="/forgot-password">Forgot password?</Link>
              </div>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
              <ArrowRight size={17} />
            </button>
          </form>
          {(message || providerMessage) && (
            <p className="notice" aria-live="polite" style={{ marginTop: 15 }}>
              {message || providerMessage}
            </p>
          )}
          <p className="auth-bottom-link">
            {register ? 'Already have an account?' : 'New to SkillonIT?'}{' '}
            <Link href={register ? '/login' : '/register'}>
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
          <div className="auth-legal">
            <Link href="/privacy">Privacy policy</Link>
            <span>·</span>
            <Link href="/terms">Terms &amp; conditions</Link>
          </div>
        </section>
      </div>
      {demo && (
        <div className="panel auth-demo">
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
