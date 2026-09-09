'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Search,
  MapPin,
  Bookmark,
  ShieldCheck,
  ArrowRight,
  Globe2,
  BriefcaseBusiness,
  Sparkles,
  Pause,
  Play,
} from 'lucide-react';
import type { PublicJob, User } from '@/lib/domain';
import { CategorySlider } from './category-slider';
import { ProfileSidebar } from './profile-sidebar';
import { countries, states } from '@/lib/domain';
export function Discovery({
  initialJobs,
  user,
}: {
  initialJobs: PublicJob[];
  user: User | null;
}) {
  const [jobs, setJobs] = useState(initialJobs),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [country, setCountry] = useState(''),
    [mode, setMode] = useState(''),
    [experience, setExperience] = useState(''),
    [state, setState] = useState(''),
    [sort, setSort] = useState('recent'),
    [page, setPage] = useState(1),
    [filters, setFilters] = useState(false),
    [paused, setPaused] = useState(false),
    [noticePaused, setNoticePaused] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const search = useCallback(
    async (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      const requestId = ++sequence.current;
      setBusy(true);
      setMessage('');
      try {
        const p = new URLSearchParams({
          q: query,
          category,
          country,
          mode,
          experience,
          state,
          sort,
          page: String(page),
        });
        const r = await fetch(`/api/v1/jobs?${p}`);
        const j = await r.json();
        if (!r.ok) throw Error(j.error?.message || 'Search unavailable');
        if (requestId === sequence.current) setJobs(j.data.jobs);
      } catch (e) {
        setMessage((e as Error).message);
      } finally {
        if (requestId === sequence.current) setBusy(false);
      }
    },
    [query, category, country, mode, experience, state, sort, page],
  );
  useEffect(() => {
    const timer = setTimeout(() => void search(), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (paused) return;
    const stream = new EventSource('/api/v1/jobs/stream');
    stream.addEventListener('jobs', () =>
      setMessage(
        'New vacancies are available. Search again to refresh your results.',
      ),
    );
    return () => stream.close();
  }, [paused]);
  async function save(id: string) {
    const r = await fetch(`/api/v1/jobs/${id}/save`, { method: 'POST' });
    if (r.status === 401) {
      window.location.assign('/login?next=/saved');
      return;
    }
    const j = await r.json();
    setMessage(
      r.ok
        ? 'Saved to your collection.'
        : j.error?.message || 'Could not save job.',
    );
  }
  return (
    <>
      <section className="search-intro job-hero">
        <div className="job-hero-copy">
        <div className="job-hero-badge">
          <Globe2 size={14} /> Global jobs. Real opportunities. Your next chapter.
        </div>
        <h1>
          Find the Right Job.<br /><span>Faster, Smarter, Globally.</span>
        </h1>
        <p>Discover jobs from around the world, explore roles that match your skills and take your next step—all in one place.</p>
        <form className="search-box" onSubmit={(event) => { void search(event); document.getElementById('job-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          <Search size={23} />
          <input
            aria-label="Search jobs"
            placeholder="Job title, skill or location"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          />
          <button className="primary" disabled={busy}>
            {busy ? 'Searching…' : 'Find jobs'}
            <ArrowRight size={18} />
          </button>
        </form>
        <div className="suggestions">
          <span>Explore</span>
          {['Remote', 'Fresher', 'Design', 'Healthcare'].map((x) => (
            <button
              key={x}
              onClick={() => {
                setQuery(x);
                setPage(1);
              }}
            >
              {x}
              <ArrowUpRight size={13} />
            </button>
          ))}
        </div>
        <div className="job-hero-actions">
          <Link href={user ? '/dashboard' : '/register'} className="job-hero-account">{user ? 'Open your workspace' : 'Create free account'}<ArrowRight size={16} /></Link>
          <span><ShieldCheck size={16} /> Your career. Your next move.</span>
        </div>
        <div className="job-hero-highlights">
          <span><Globe2 size={19} /><strong>Global opportunities</strong><small>Explore beyond borders</small></span>
          <span><Sparkles size={19} /><strong>Skills that matter</strong><small>Find your next role</small></span>
          <span><BriefcaseBusiness size={19} /><strong>One workspace</strong><small>Organize your job search</small></span>
        </div>
        </div>
        <figure className="job-hero-art" aria-label="Illustration of a job seeker exploring career opportunities on a laptop">
          <figcaption className="job-hero-art-caption">Illustrative preview</figcaption>
        </figure>
      </section>
      <div className="discovery-grid">
        <ProfileSidebar user={user} />
        <section className="results" id="job-results">
          <div className="section-line">
            <div>
              <div className="eyebrow muted">EXPLORE OPPORTUNITIES</div>
              <h2>Your next move, all in one place.</h2>
            </div>
            <button
              className="icon-button"
              aria-label={paused ? 'Resume live feed' : 'Pause live feed'}
              onClick={() => setPaused(!paused)}
            >
              {paused ? <Play size={17} /> : <Pause size={17} />}
            </button>
          </div>
          <CategorySlider value={category} onChange={(value) => { setCategory(value); setPage(1); }} />
          <div className="results-toolbar">
            <span>
              {jobs.length} opportunities{' '}
              <span className="muted">on this page</span>
            </span>
            <select
              aria-label="Sort jobs"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">Newest first</option>
              <option value="salary">Highest salary</option>
            </select>
            <button
              className="mobile-filter"
              onClick={() => setFilters(!filters)}
            >
              Filters
            </button>
          </div>
          {filters && (
            <div className="panel">
              <label>
                Country
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  <option value="">All countries</option>
                  {countries.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Work arrangement
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="">All arrangements</option>
                  {['Remote', 'Hybrid', 'On-site'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                Experience
                <select
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                >
                  <option value="">All experience levels</option>
                  <option value="0">Fresher</option>
                  <option value="2">1–3 years</option>
                  <option value="5">3–5 years</option>
                  <option value="8">5+ years</option>
                </select>
              </label>
              {country === 'India' && (
                <label>
                  State / union territory
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  >
                    <option value="">All states</option>
                    {states.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
              <button className="primary" onClick={() => void search()}>
                Apply filters
              </button>
            </div>
          )}
          <div aria-live="polite">
            {message && <p className="notice">{message}</p>}
          </div>
          {jobs.some((j) => j.sample) && (
            <div className="collection-notice">
              <div className="collection-marquee">
                <span className="sr-only">
                  Preview collection · Sample vacancies for exploring the
                  platform.
                </span>
                <div
                  className={`collection-track${noticePaused ? ' is-paused' : ''}`}
                  aria-hidden="true"
                >
                  {[0, 1].map((copy) => (
                    <div className="collection-track-group" key={copy}>
                      {[0, 1, 2].map((item) => (
                        <span key={item}>
                          <Sparkles size={15} />
                          Preview collection · Sample vacancies for exploring
                          the platform.
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <button
                className="icon-button"
                aria-label={
                  noticePaused
                    ? 'Resume collection notice'
                    : 'Pause collection notice'
                }
                aria-pressed={noticePaused}
                onClick={() => setNoticePaused(!noticePaused)}
              >
                {noticePaused ? <Play size={16} /> : <Pause size={16} />}
              </button>
            </div>
          )}
          {jobs.length === 0 ? (
            <div className="empty">
              <Search size={32} />
              <h3>No opportunities found</h3>
              <p>Try a broader role or another location.</p>
            </div>
          ) : (
            <div className="job-list">
              {jobs.map((job, i) => (
                <article className="job-card" key={job.id}>
                  <div className={`job-mark mark-${i % 4}`}>
                    <BriefcaseBusiness size={42} strokeWidth={1.5} />
                  </div>
                  <div className="job-main">
                    <div className="job-top">
                      <span className="job-category">{job.category}</span>
                      <button
                        className="icon-button"
                        aria-label={`Save ${job.title}`}
                        onClick={() => void save(job.id)}
                      >
                        <Bookmark size={19} />
                      </button>
                    </div>
                    <Link className="job-title" href={`/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <p className="company">
                      {job.company} <ShieldCheck size={14} />
                    </p>
                    <div className="job-facts">
                      <span>
                        <MapPin size={14} />
                        {job.city}, {job.country}
                      </span>
                      <span>{job.mode}</span>
                      <span>
                        {job.experienceMin === 0
                          ? 'Fresher welcome'
                          : `${job.experienceMin}–${job.experienceMax} years`}
                      </span>
                    </div>
                    <div className="job-bottom">
                      <div className="skills">
                        {job.skills.slice(0, 3).map((s) => (
                          <span key={s}>{s}</span>
                        ))}
                      </div>
                      <strong>
                        {new Intl.NumberFormat('en', {
                          style: 'currency',
                          currency: job.currency,
                          notation: 'compact',
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 1,
                        }).format(job.salaryMin)}{' '}
                        –{' '}
                        {new Intl.NumberFormat('en', {
                          style: 'currency',
                          currency: job.currency,
                          notation: 'compact',
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 1,
                        }).format(job.salaryMax)}
                        <small> / year</small>
                      </strong>
                    </div>
                    <Link
                      className="primary full job-apply"
                      href={`/jobs/${job.id}`}
                      aria-label={`Apply now for ${job.title}`}
                    >
                      Apply now <ArrowUpRight size={17} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="pagination">
            <button
              className="secondary"
              disabled={page === 1}
              onClick={() => {
                setPage(Math.max(1, page - 1));
              }}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="secondary"
              disabled={jobs.length < 12}
              onClick={() => {
                setPage(page + 1);
              }}
            >
              Next
            </button>
          </div>
        </section>
        <aside className="right-rail">
          <div className="accent-panel">
            <Sparkles size={26} />
            <h2>
              Less searching.
              <br />
              More possibilities.
            </h2>
            <p>
              Create your profile to discover roles that match your skills and
              ambitions.
            </p>
            <Link className="primary full" href="/register">
              Build my profile
              <ArrowUpRight size={17} />
            </Link>
            <span>You’re in control of every application.</span>
          </div>
          <div className="rail-section">
            <div className="eyebrow">A WORLD OF OPPORTUNITY</div>
            <Globe2 size={40} />
            <h3>Your skills travel.</h3>
            <p>Find your place, close to home or across the globe.</p>
            <Link href="/about">
              Meet SkillonIT <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="rail-section">
            <h3>Building a great team?</h3>
            <p>Connect your next opportunity with the right people.</p>
            <Link href="/employer">
              For employers <ArrowUpRight size={14} />
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
