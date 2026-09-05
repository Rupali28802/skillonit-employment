'use client';
import { useState } from 'react';
import type { Plan } from '@/lib/domain';
export function PlanEditor({ initial }: { initial: Plan[] }) {
  const [plans, setPlans] = useState(initial),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  function update(index: number, key: keyof Plan, value: unknown) {
    setPlans(plans.map((p, i) => (i === index ? { ...p, [key]: value } : p)));
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await fetch('/api/v1/admin/plans', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(plans),
          });
          const j = await r.json();
          setMessage(
            r.ok ? 'Plan configuration saved and audited.' : j.error.message,
          );
        } catch {
          setMessage('Could not save plan configuration.');
        } finally {
          setBusy(false);
        }
      }}
    >
      {plans.map((p, i) => (
        <fieldset className="panel" key={p.code}>
          <legend>{p.name}</legend>
          <div className="form-grid">
            <label>
              Daily application cap
              <input
                type="number"
                min="0"
                max="100"
                value={p.dailyCap}
                onChange={(e) => update(i, 'dailyCap', Number(e.target.value))}
              />
            </label>
            <label>
              Automation delay (minutes)
              <input
                type="number"
                min="0"
                max="10080"
                value={p.delayMinutes}
                onChange={(e) =>
                  update(i, 'delayMinutes', Number(e.target.value))
                }
              />
            </label>
            <label>
              Price (leave blank until approved)
              <input
                type="number"
                min="0"
                value={p.price ?? ''}
                onChange={(e) =>
                  update(
                    i,
                    'price',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
              />
            </label>
            <label>
              CV versions
              <input
                type="number"
                min="1"
                max="20"
                value={p.cvs}
                onChange={(e) => update(i, 'cvs', Number(e.target.value))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={p.identity}
                onChange={(e) => update(i, 'identity', e.target.checked)}
              />
              Reveal employer identity
            </label>
            <label>
              <input
                type="checkbox"
                checked={p.autoApply}
                onChange={(e) => update(i, 'autoApply', e.target.checked)}
              />
              Permit automation when eligible
            </label>
          </div>
        </fieldset>
      ))}
      {message && (
        <p className="notice" aria-live="polite">
          {message}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save plan configuration'}
      </button>
    </form>
  );
}
