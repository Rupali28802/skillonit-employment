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
  SlidersHorizontal,
  Globe2,
  BriefcaseBusiness,
  Sparkles,
  Pause,
  Play,
} from 'lucide-react';
import type { PublicJob } from '@/lib/domain';
import { categories, countries, states } from '@/lib/domain';
export function Discovery({ initialJobs }: { initialJobs: PublicJob[] }) {
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
      <section className="search-intro">
        <div className="eyebrow">
          <span className="live-dot" /> YOUR NEXT CHAPTER STARTS HERE
        </div>
        <h1>
          Find work that <span>fits you.</span>
        </h1>
        <p>Discover opportunities across roles, industries and borders.</p>
        <form className="search-box" onSubmit={search}>
          <Search size={23} />
          <input
            aria-label="Search jobs"
            placeholder="Try “remote design jobs” or “fresher in Bengaluru”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
      </section>
      <div className="discovery-grid">
        <aside className="filter-panel">
          <div className="section-line">
            <h2>Refine your search</h2>
            <SlidersHorizontal size={17} />
          </div>
          <label>
            Location
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">Anywhere in the world</option>
              {countries.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {country === 'India' && (
            <label>
              State / union territory
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">All states</option>
                {states.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
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
          <button
            className="secondary full"
            onClick={() => {
              setPage(1);
              void search();
            }}
          >
            Apply filters
          </button>
          <div className="filter-note">
            <ShieldCheck size={24} />
            <h3>A more confident search</h3>
            <p>
              Review source details, verification status and application method
              before you apply.
            </p>
            <Link href="/trust">
              How we protect your search <ArrowUpRight size={14} />
            </Link>
          </div>
        </aside>
        <section className="results">
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
          <div className="category-row">
            <button
              className={!category ? 'selected' : ''}
              onClick={() => setCategory('')}
            >
              All opportunities
            </button>
            {categories.map((c) => (
              <button
                key={c}
                className={category === c ? 'selected' : ''}
                onClick={() => {
                  setCategory(c);
                  setPage(1);
                }}
              >
                {c}
              </button>
            ))}
          </div>
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
            <div className="sample-note">
              Preview collection · Sample vacancies for exploring the platform.
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
                    <BriefcaseBusiness size={24} />
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
