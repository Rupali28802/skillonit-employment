'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bookmark,
  Bell,
  FileText,
  Download,
  Search,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import type { Profile, PublicJob } from '@/lib/domain';
import { SmartForm, Action } from './forms';

export type SavedSearch = {
  id: string;
  name: string;
  query: string;
  country: string;
  mode: string;
  enabled: boolean;
};
export type Notification = {
  id: string;
  title: string;
  message: string;
  href: string;
  read: boolean;
  createdAt: string;
};
export type CVVersion = {
  id: string;
  name: string;
  targetRole: string;
  summary: string;
  profile: Profile;
  createdAt: string;
};
async function send<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch('/api/v1/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error?.message || 'Please try again.');
  return result.data;
}

export function SavedSearches({ searches }: { searches: SavedSearch[] }) {
  const router = useRouter();
  return (
    <div className="stack">
      <div className="feature-heading">
        <Bookmark size={22} />
        <div>
          <h2>Your search, ready when you are</h2>
          <p>
            Save a role and location. Check for new matches whenever you return.
          </p>
        </div>
      </div>
      <div className="panel">
        <h3>Create a saved search</h3>
        <SmartForm
          endpoint="me/saved-searches"
          submit="Save search"
          onSuccess={() => router.refresh()}
          fields={[
            {
              name: 'name',
              label: 'Search name',
              hint: 'For example: My next design role',
            },
            { name: 'query', label: 'Role or skills', required: false },
            { name: 'country', label: 'Country', required: false },
            {
              name: 'mode',
              label: 'Work arrangement',
              options: ['', 'Remote', 'Hybrid', 'On-site'],
            },
            {
              name: 'enabled',
              label: 'Include this search when I check for alerts',
              type: 'checkbox',
            },
          ]}
          initial={{ enabled: true }}
        />
      </div>
      <div className="section-line">
        <h3>{searches.length} saved searches</h3>
        <Action endpoint="me/alerts/refresh" label="Check for new matches" />
      </div>
      {!searches.length && (
        <div className="panel empty">
          <Search size={30} />
          <h3>Keep a good search close</h3>
          <p>Your saved searches will appear here.</p>
        </div>
      )}
      {searches.map((search) => (
        <div className="panel" key={search.id}>
          <div className="section-line">
            <h3>{search.name}</h3>
            <span className="pill">
              {search.enabled ? 'Alerts enabled' : 'Paused'}
            </span>
          </div>
          <p>
            {search.query || 'All roles'} · {search.country || 'Worldwide'} ·{' '}
            {search.mode || 'Any arrangement'}
          </p>
          <div className="actions">
            <Link
              className="primary"
              href={
                '/jobs?q=' +
                encodeURIComponent(search.query) +
                '&country=' +
                encodeURIComponent(search.country) +
                '&mode=' +
                encodeURIComponent(search.mode)
              }
            >
              View matches
            </Link>
            <Action
              endpoint={'me/saved-searches/' + search.id}
              method="PATCH"
              payload={{ enabled: !search.enabled }}
              label={search.enabled ? 'Pause alerts' : 'Resume alerts'}
            />
            <Action
              endpoint={'me/saved-searches/' + search.id}
              method="DELETE"
              label="Remove search"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function NotificationCenter({
  notifications,
  preferences,
}: {
  notifications: Notification[];
  preferences: Record<string, unknown>;
}) {
  return (
    <div className="stack">
      <div className="feature-heading">
        <Bell size={24} />
        <div>
          <h2>Stay in the loop</h2>
          <p>Application updates and saved-search matches, in one place.</p>
        </div>
      </div>
      <div className="panel">
        <h3>Delivery preferences</h3>
        <p className="small">
          Email and WhatsApp channels will become available after provider
          setup. In-app updates are available now.
        </p>
        <SmartForm
          endpoint="me/notification-preferences"
          method="PUT"
          initial={preferences}
          fields={[
            {
              name: 'inApp',
              label: 'Receive in-app notifications',
              type: 'checkbox',
            },
            {
              name: 'email',
              label: 'Email notifications — not connected',
              type: 'checkbox',
            },
            {
              name: 'whatsapp',
              label: 'WhatsApp notifications — not connected',
              type: 'checkbox',
            },
          ]}
        />
      </div>
      {!notifications.length && (
        <div className="panel empty">
          <Bell size={30} />
          <h3>You’re all caught up</h3>
          <p>New updates will appear here as you use your workspace.</p>
        </div>
      )}
      {notifications.map((item) => (
        <article
          className={'panel notification-card ' + (item.read ? '' : 'unread')}
          key={item.id}
        >
          <div className="section-line">
            <h3>{item.title}</h3>
            <span className="pill">{item.read ? 'Read' : 'New'}</span>
          </div>
          <p>{item.message}</p>
          <p className="small">{new Date(item.createdAt).toLocaleString()}</p>
          <div className="actions">
            <Link className="secondary" href={item.href}>
              View update
            </Link>
            {!item.read && (
              <Action
                endpoint="me/notifications"
                method="PATCH"
                payload={{ id: item.id }}
                label="Mark as read"
              />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export function CVLibrary({
  versions,
  profile,
}: {
  versions: CVVersion[];
  profile: Profile;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  function download(version: CVVersion) {
    const p = version.profile;
    const text = `${p.name}\n${p.headline}\n${p.city}, ${p.country}\n\nTARGET ROLE\n${version.targetRole}\n\nPROFILE\n${version.summary}\n\nSKILLS\n${p.skills.join(', ')}\n\nEXPERIENCE\n${p.experience} years\n\nEDUCATION\n${p.education}\n`;
    const url = URL.createObjectURL(
      new Blob([text], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'SkillOnIT-CV.txt';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="stack">
      <div className="feature-heading">
        <FileText size={24} />
        <div>
          <h2>Your experience, thoughtfully presented</h2>
          <p>Create confirmed, role-specific CV versions from your profile.</p>
        </div>
      </div>
      <div className="notice">
        PDF/DOCX file upload requires connected private storage and malware
        scanning. You can build and download a text CV here now.
      </div>
      <div className="panel">
        <h3>Create a CV version</h3>
        <p>
          Profile facts are copied into each version so later profile edits
          won’t change your saved CV.
        </p>
        {!profile.confirmed ? (
          <Link className="primary" href="/profile">
            Confirm your profile first
          </Link>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setMessage('');
              const form = new FormData(event.currentTarget);
              try {
                await send('me/cv-versions', {
                  name: form.get('name'),
                  targetRole: form.get('targetRole'),
                  summary: form.get('summary'),
                  confirmed: form.get('confirmed') === 'on',
                  profile,
                });
                setMessage('Your CV version has been saved.');
                router.refresh();
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Version name
                <input
                  name="name"
                  required
                  maxLength={100}
                  placeholder="Frontend developer CV"
                />
              </label>
              <label>
                Target role
                <input
                  name="targetRole"
                  maxLength={100}
                  placeholder="Frontend developer"
                />
              </label>
              <label className="full-width">
                Professional summary
                <textarea
                  name="summary"
                  required
                  minLength={20}
                  maxLength={6000}
                  placeholder="Describe your relevant experience using only facts you can confirm."
                />
              </label>
              <label className="full-width">
                <input name="confirmed" type="checkbox" required /> I confirm
                this summary and my profile accurately describe my experience.
              </label>
            </div>
            <p aria-live="polite">{message}</p>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save CV version'}
            </button>
          </form>
        )}
      </div>
      {!versions.length && (
        <div className="panel empty">
          <FileText size={30} />
          <h3>A stronger introduction starts here</h3>
          <p>Your confirmed CV versions will appear below.</p>
        </div>
      )}
      {versions.map((version) => (
        <article className="panel" key={version.id}>
          <div className="section-line">
            <h3>{version.name}</h3>
            <span className="pill">
              <CheckCircle2 size={14} /> Confirmed
            </span>
          </div>
          <p>{version.targetRole || version.profile.headline}</p>
          <p className="cv-summary">{version.summary}</p>
          <div className="actions">
            <button className="primary" onClick={() => download(version)}>
              <Download size={16} /> Download text CV
            </button>
            <Action
              endpoint={'me/cv-versions/' + version.id}
              method="DELETE"
              label="Delete version"
              confirm
            />
          </div>
        </article>
      ))}
    </div>
  );
}

export function SearchAssistant() {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(''),
    [jobs, setJobs] = useState<PublicJob[]>([]);
  return (
    <div className="stack">
      <div className="feature-heading">
        <Sparkles size={24} />
        <div>
          <h2>A little help with your next step</h2>
          <p>Search opportunities or understand your workspace.</p>
        </div>
      </div>
      <div className="panel">
        <span className="pill">Guided search · keyword mode</span>
        <p style={{ marginTop: 16 }}>
          Try “React remote” or ask about mailbox and billing setup. This
          version uses search rules, not a generative AI model.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setAnswer('');
            try {
              const result = await send<{ answer: string; jobs: PublicJob[] }>(
                'assistant',
                { message },
              );
              setAnswer(result.answer);
              setJobs(result.jobs);
            } catch (error) {
              setAnswer((error as Error).message);
              setJobs([]);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Your question
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              required
              maxLength={300}
              placeholder="Find React roles in India"
            />
          </label>
          <button className="primary" disabled={busy} style={{ marginTop: 16 }}>
            {busy ? 'Searching…' : 'Ask assistant'}
          </button>
        </form>
        <p className="notice" aria-live="polite" style={{ marginTop: 20 }}>
          {answer || 'Your results will appear here.'}
        </p>
      </div>
      {jobs.map((job) => (
        <div className="panel" key={job.id}>
          <span className="pill">{job.mode}</span>
          <h3 style={{ marginTop: 12 }}>
            <Link href={'/jobs/' + job.id}>{job.title}</Link>
          </h3>
          <p>
            {job.city} · {job.country}
          </p>
          <Link className="secondary" href={'/jobs/' + job.id}>
            Explore opportunity
          </Link>
        </div>
      ))}
    </div>
  );
}
