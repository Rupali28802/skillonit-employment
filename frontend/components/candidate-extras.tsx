'use client';

import Link from 'next/link';
import { useState } from 'react';

async function request(path: string, method = 'POST', payload?: unknown) {
  const response = await fetch(
    `/api/v1/${path}`,
    payload === undefined
      ? { method }
      : {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result?.error?.message || 'The request could not be completed.',
    );
  return result?.data;
}

type SavedSearch = {
  id: string;
  name: string;
  query: string;
  country: string;
  mode: string;
  enabled: boolean;
};
export function SavedSearchManager({ searches }: { searches: SavedSearch[] }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      window.location.reload();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="panel">
        <h2>Create a job alert</h2>
        <p>
          Save a search and choose whether it should be included when the
          backend refreshes alerts.
        </p>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void act(() =>
              request('me/saved-searches', 'POST', {
                name: form.get('name'),
                query: form.get('query'),
                country: form.get('country'),
                mode: form.get('mode'),
                enabled: true,
              }),
            );
          }}
        >
          <label>
            Alert name
            <input name="name" required maxLength={100} />
          </label>
          <label>
            Keywords
            <input name="query" maxLength={200} />
          </label>
          <label>
            Country
            <input name="country" maxLength={100} />
          </label>
          <label>
            Work arrangement
            <select name="mode">
              <option value="">Any</option>
              <option>Remote</option>
              <option>Hybrid</option>
              <option>On-site</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>
            Save alert
          </button>
        </form>
      </div>
      {searches.map((search) => (
        <div className="panel" key={search.id}>
          <div className="section-line">
            <div>
              <span className="pill">
                {search.enabled ? 'Active' : 'Paused'}
              </span>
              <h2 style={{ marginTop: 12 }}>{search.name}</h2>
              <p>
                {search.query || 'All jobs'}
                {search.country ? ` · ${search.country}` : ''}
                {search.mode ? ` · ${search.mode}` : ''}
              </p>
            </div>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    request(`me/saved-searches/${search.id}`, 'PATCH', {
                      enabled: !search.enabled,
                    }),
                  )
                }
              >
                {search.enabled ? 'Pause' : 'Enable'}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Delete this saved search?'))
                    void act(() =>
                      request(`me/saved-searches/${search.id}`, 'DELETE'),
                    );
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
      {!!searches.length && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => void act(() => request('me/alerts/refresh'))}
        >
          Refresh my alerts now
        </button>
      )}
      {message && (
        <p className="notice error" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string;
  read: boolean;
  createdAt: string;
};
type NotificationPreferences = {
  inApp: boolean;
  email: boolean;
  whatsapp: boolean;
  unsubscribeAll: boolean;
  types: Record<string, boolean>;
};
export function NotificationCenter({
  notifications,
  preferences,
}: {
  notifications: Notification[];
  preferences: NotificationPreferences;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (payload: unknown) => {
    setBusy(true);
    setMessage('');
    try {
      await request('me/notification-preferences', 'PUT', payload);
      window.location.reload();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="panel">
        <h2>Notification preferences</h2>
        <p>
          Choose in-app and verified-email updates. Unsupported channels remain
          unavailable.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void save({
              inApp: form.get('inApp') === 'on',
              email: form.get('email') === 'on',
              whatsapp: false,
              unsubscribeAll: form.get('unsubscribeAll') === 'on',
              types: preferences.types || {},
            });
          }}
        >
          <label>
            <input
              name="inApp"
              type="checkbox"
              defaultChecked={preferences.inApp}
            />{' '}
            In-app notifications
          </label>
          <br />
          <label>
            <input
              name="email"
              type="checkbox"
              defaultChecked={preferences.email}
            />{' '}
            Email notifications
          </label>
          <br />
          <label>
            <input
              name="unsubscribeAll"
              type="checkbox"
              defaultChecked={preferences.unsubscribeAll}
            />{' '}
            Pause all notifications
          </label>
          <br />
          <button className="primary" disabled={busy}>
            Save preferences
          </button>
        </form>
      </div>
      {!notifications.length ? (
        <div className="panel">
          <h2>You’re all caught up</h2>
          <p>Job matches and application updates will appear here.</p>
        </div>
      ) : (
        notifications.map((item) => (
          <div className="panel" key={item.id}>
            <span className="pill">
              {item.type.replaceAll('_', ' ')}
              {item.read ? ' · read' : ' · new'}
            </span>
            <h2 style={{ marginTop: 12 }}>{item.title}</h2>
            <p>{item.message}</p>
            <p className="small">
              {new Date(item.createdAt).toLocaleString('en-IN')}
            </p>
            <div className="actions">
              {item.href.startsWith('/') && (
                <Link className="secondary" href={item.href}>
                  Open
                </Link>
              )}
              {!item.read && (
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await request('me/notifications', 'PATCH', {
                        id: item.id,
                      });
                      window.location.reload();
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  Mark as read
                </button>
              )}
            </div>
          </div>
        ))
      )}
      {message && (
        <p className="notice error" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}

export function AssistantPanel() {
  const [answer, setAnswer] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel">
      <h2>SkillOnIT assistant</h2>
      <p>
        Ask about jobs or onboarding. Answers are grounded in verified platform
        data; personalized questions require your assistant consent.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage('');
          setAnswer('');
          const form = new FormData(event.currentTarget);
          try {
            const data = await request('assistant', 'POST', {
              message: form.get('message'),
            });
            setAnswer(data.answer);
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Your question
          <textarea
            name="message"
            required
            maxLength={500}
            placeholder="Find remote software roles or help me complete onboarding"
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? 'Checking…' : 'Ask assistant'}
        </button>
      </form>
      {answer && (
        <div className="notice">
          <strong>Answer</strong>
          <p>{answer}</p>
        </div>
      )}
      {message && <p className="notice error">{message}</p>}
    </div>
  );
}

type CatalogResult = {
  catalog: unknown;
  items: {
    id: string;
    displayName: string;
    type?: string;
    countryCode?: string;
    aliases?: string[];
  }[];
};
export function TaxonomyLookup() {
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel">
      <h2>Occupation, skill and location catalog</h2>
      <p>
        Search the managed taxonomy used by profiles, jobs, ingestion and
        matching.
      </p>
      <form
        className="form-grid"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage('');
          const form = new FormData(event.currentTarget);
          try {
            const kindValue = form.get('kind');
            const queryValue = form.get('q');
            if (typeof kindValue !== 'string' || typeof queryValue !== 'string')
              throw new Error('Enter a valid catalog search.');
            const kind = kindValue;
            const q = encodeURIComponent(queryValue);
            setResult(await request(`taxonomy/${kind}?q=${q}&limit=25`, 'GET'));
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Catalog
          <select name="kind">
            <option value="occupations">Occupations</option>
            <option value="skills">Skills</option>
            <option value="locations">Locations</option>
          </select>
        </label>
        <label>
          Search
          <input name="q" required maxLength={200} />
        </label>
        <button className="primary" disabled={busy}>
          Search catalog
        </button>
      </form>
      {result &&
        (result.items.length ? (
          <ul>
            {result.items.map((item) => (
              <li key={item.id}>
                <strong>{item.displayName}</strong>
                {item.type ? ` · ${item.type}` : ''}
                {item.countryCode ? ` · ${item.countryCode}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>No managed catalog entries matched.</p>
        ))}
      {message && <p className="notice error">{message}</p>}
    </div>
  );
}
