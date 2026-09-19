'use client';
import '@/app/vertical-feed.css';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Search,
  MapPin,
  Bookmark,
  ShieldCheck,
  ArrowRight,
  Globe2,

  Sparkles,
  Pause,
  Play,
  Mic, SlidersHorizontal, X,
} from 'lucide-react';
import type { PublicJob, User } from '@/lib/domain';
import { CategorySlider } from './category-slider';
import { ProfileSidebar } from './profile-sidebar';
import { countries, states } from '@/lib/domain';
import { searchIntent } from '@/lib/search-intent';
export function Discovery({
  initialJobs,
  user,
  initialSearch = {},
}: {
  initialJobs: PublicJob[];
  user: User | null;
  initialSearch?: { query?: string; country?: string; mode?: string };
}) {
  const [jobs, setJobs] = useState(initialJobs),
    [query, setQuery] = useState(initialSearch.query || ''),
    [category, setCategory] = useState(''),
    [country, setCountry] = useState(initialSearch.country || ''),
    [mode, setMode] = useState(initialSearch.mode || ''),
    [jobType, setJobType] = useState(''),
    [experience, setExperience] = useState(''),
    [state, setState] = useState(''),
    [sort, setSort] = useState('discovered'),
    [page, setPage] = useState(1),
    [filters, setFilters] = useState(false),
    [paused, setPaused] = useState(false),
    [noticePaused, setNoticePaused] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const filterKey = useRef('');
  const requestPending = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const [total, setTotal] = useState(initialJobs.length);
  const [hasMore, setHasMore] = useState(false);
  const [listening, setListening] = useState(false);
  const [semantic, setSemantic] = useState(false);
  const [clock, setClock] = useState(0);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [newCount, setNewCount] = useState(0);
  const arrivalBaseline = useRef('');
  const latestMeasurement = useRef('');
  const [stats, setStats] = useState<{sourcesOnline:number;detectedToday:number;newJobs:number;countries:number|null;workerOnline?:boolean}|null>(null);
  const previousJobs = useRef<PublicJob[]>(initialJobs);
  const feed = useRef<HTMLDivElement>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  useEffect(()=>{const initial=setTimeout(()=>setClock(Date.now()),0);const timer=setInterval(()=>setClock(Date.now()),30000);return()=>{clearTimeout(initial);clearInterval(timer);};},[]);
  useEffect(()=>{
    let cancelled=false, loading=false;
    const refresh=async()=>{
      if(loading)return;
      loading=true;
      const baseline=arrivalBaseline.current;
      try {
        const r=await fetch(`/api/v1/jobs/discovery-status${baseline?`?since=${encodeURIComponent(baseline)}`:''}`);
        if(!r.ok)throw Error();
        const {data}=await r.json();
        if(!cancelled){setStats(data);latestMeasurement.current=data.measuredAt;
          if(!arrivalBaseline.current || Date.parse(data.measuredAt)-Date.parse(arrivalBaseline.current)>86400000)arrivalBaseline.current=data.measuredAt;
          else if(baseline===arrivalBaseline.current)setNewCount(data.newSince||0);
        }
      }catch{if(!cancelled)setStats(null);}finally{loading=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),15000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[]);
  function discoveredTime(value:string){const age=clock-Date.parse(value);if(!clock||!Number.isFinite(age))return 'Time unavailable';const minutes=Math.max(0,Math.floor(age/60000));return minutes===0?'Just now':minutes<60?`${minutes} min ago`:minutes<1440?`${Math.floor(minutes/60)} hour${minutes>=120?'s':''} ago`:`${Math.floor(minutes/1440)} days ago`;}
  const intent = useMemo(() => searchIntent(query, countries), [query]);
  const roleQuery = removed.includes('role') ? '' : intent.role;
  const activeCountry = country || (removed.includes('country') ? '' : intent.country);
  const activeMode = mode || (removed.includes('mode') ? '' : intent.mode);
  const activeExperience = experience || (removed.includes('experience') ? '' : intent.experience);
  function updateQuery(value: string) { setQuery(value); setRemoved([]); setPage(1); }
  function removeChip(key: string) {
    setRemoved(prev => [...prev,key]); setPage(1);
    if(key==='country') {setCountry('');setState('');} if(key==='mode') setMode(''); if(key==='experience') setExperience('');
  }
  function voiceSearch() {
    type Recognition = {lang:string;start:()=>void;onresult:(e:{results:{transcript:string}[][]})=>void;onend:()=>void;onerror:()=>void};
    const voiceWindow = window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
    const Voice = voiceWindow.SpeechRecognition || voiceWindow.webkitSpeechRecognition;
    if(!Voice) {setMessage('Voice search is not supported in this browser. Please type your search.');return;}
    const recognition = new Voice(); recognition.lang='en-IN';
    recognition.onresult=e=>updateQuery(e.results[0][0].transcript);
    recognition.onend=()=>setListening(false);
    recognition.onerror=()=>{setListening(false);setMessage('Microphone unavailable. Check browser permission or type your search.');};
    try {recognition.start();setListening(true);} catch {setListening(false);}
  }
  const search = useCallback(
    async (e?: { preventDefault: () => void }, live = false) => {
      e?.preventDefault();
      if (live && (requestPending.current || page !== 1)) return;
      const requestId = ++sequence.current;
      requestPending.current = true;
      setLoadFailed(false);
      setBusy(true);
      setMessage('');
      try {
        const p = new URLSearchParams({
          q: roleQuery,
          category,
          country: activeCountry,
          mode: activeMode,
          type: jobType,
          experience: activeExperience,
          state,
          sort: intent.highSalary&&!removed.includes('salary')?'salary':sort,
          page: String((page - 1) * 2 + 1),
          searchMode: semantic ? 'semantic' : 'keyword',
        });
        const range:Record<string,string[]>={'0–2 years':['0','2'],'2–5 years':['2','5'],'5+ years':['5','100']};
        if(range[activeExperience]){p.delete('experience');p.set('experienceMin',range[activeExperience][0]);p.set('experienceMax',range[activeExperience][1]);}
        const keyParams = new URLSearchParams(p); keyParams.delete('page');
        const key = keyParams.toString();
        if (filterKey.current !== key) {
          filterKey.current = key;
          if (page !== 1) { setPage(1); return; }
        }
        const secondPage = new URLSearchParams(p);
        secondPage.set('page', String(page * 2));
        const results = await Promise.all([p, secondPage].map(async params => {
          const response = await fetch(`/api/v1/jobs?${params}`);
          const payload = await response.json();
          if (!response.ok) throw Error(payload.error?.message || 'Search unavailable');
          return payload.data;
        }));
        const j = {data: {jobs: [...results[0].jobs, ...results[1].jobs], total: results[0].total, hasMore: results[1].hasMore}};
        if (requestId === sequence.current) {
          if(live && sort==='discovered') {const known=new Set(previousJobs.current.map(job=>job.id));const arrivals=j.data.jobs.filter((job:PublicJob)=>!known.has(job.id)).map((job:PublicJob)=>job.id);setNewIds(prev=>[...new Set([...prev,...arrivals])]);}
          if(!live){setNewIds([]);}
          const incoming: PublicJob[] = j.data.jobs;
          previousJobs.current=incoming;setJobs(incoming);setTotal(j.data.total);
          setHasMore(j.data.hasMore);setUpdatedAt(new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));}
      } catch (e) {
        if(requestId===sequence.current){setMessage((e as Error).message);setLoadFailed(true);}
      } finally {
        if (requestId === sequence.current) {setBusy(false);requestPending.current=false;}
      }
    },
    [roleQuery, category, activeCountry, activeMode, jobType, activeExperience, state, sort, page, semantic, intent.highSalary, removed],
  );
  useEffect(() => {
    const timer = setTimeout(() => void search(), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (paused) return;
    const stream = new EventSource('/api/v1/jobs/stream');
    stream.onopen=()=>setConnected(true); stream.onerror=()=>setConnected(false);
    stream.addEventListener('jobs', () => { void search(undefined,true); });
    // Keep results fresh when a proxy or browser connection limit delays SSE.
    const refreshTimer=setInterval(()=>{if(document.visibilityState==='visible')void search(undefined,true);},30000);
    return () => {clearInterval(refreshTimer);stream.close();setConnected(false);};
  }, [paused, search]);
  function changePage(next: number) {
    if (busy) return;
    setPage(next);
    document.getElementById('job-results')?.scrollIntoView({behavior:'smooth'});
  }
  async function save(id: string) {
    const r = await fetch(`/api/v1/jobs/${id}/save`, { method: 'POST' });
    if (r.status === 401) {
      window.location.assign('/login?next=/saved');
      return;
    }
    const j = await r.json();
    if (r.ok) setSavedIds(ids => ids.includes(id) ? ids : [...ids, id]);
    setMessage(
      r.ok
        ? 'Saved to your collection.'
        : j.error?.message || 'Could not save job.',
    );
  }
  return (
    <>
      <section className="live-discovery" aria-labelledby="live-discovery-heading">
        <div className="radar-metrics" aria-label="Live discovery statistics"><strong>LIVE DISCOVERY</strong>{[['Sources online',stats?.sourcesOnline],['Detected today (UTC)',stats?.detectedToday],['New in 10 minutes',stats?.newJobs],['Countries / territories · includes eligibility',stats?.countries]].map(([label,value])=><span key={label}><b>{typeof value==='number'?value.toLocaleString():'—'}</b>{label}</span>)}</div>
        <div className="live-discovery-top">
          <div><div className="discovery-kicker"><Sparkles size={15}/> SKILLONIT EMPLOYMENT</div>
            <h1 id="live-discovery-heading">Find the Right Job. <span>Faster, Smarter, Globally.</span></h1>
            <p>Discover jobs from around the world, explore roles that match your skills and take your next step—all in one place.</p></div>
          <span className={`discovery-status ${connected && !paused ? 'is-connected' : ''}`}><i/>{paused ? 'Feed paused' : stats?.workerOnline === false ? 'Discovery worker offline' : connected ? 'Live feed connected' : 'Connecting to feed'}</span>
        </div>
        <form className="discovery-search" onSubmit={event=>{event.preventDefault();void search();document.getElementById('job-results')?.scrollIntoView({behavior:'smooth',block:'start'});}}>
          <div className="discovery-query"><Search size={23}/><input aria-label="Search worldwide jobs" placeholder="Search worldwide jobs..." value={query} onChange={e=>updateQuery(e.target.value)}/><button type="button" className="ai-search-badge" aria-pressed={semantic} title="Toggle meaning-based search of indexed jobs; coverage is still growing" onClick={()=>{setSemantic(!semantic);setPage(1);}}><Sparkles size={13}/> AI search {semantic ? 'on' : 'off'}</button><button type="button" className="voice-search" aria-label={listening?'Listening':'Start voice search'} disabled={listening} onClick={voiceSearch}><Mic size={19}/></button></div>
          <label className="discovery-location"><MapPin size={19}/><select aria-label="Search location" value={activeCountry} onChange={e=>{setCountry(e.target.value);setRemoved(prev=>[...prev,'country']);setState('');setPage(1);}}><option value="">Worldwide</option>{countries.map(c=><option key={c}>{c}</option>)}</select></label>
          <button type="button" className="discovery-filter" aria-expanded={filters} onClick={()=>{setFilters(!filters);document.getElementById('job-results')?.scrollIntoView({behavior:'smooth',block:'start'});}}><SlidersHorizontal size={18}/> Filters</button>
          <button className="primary discovery-submit" disabled={busy}>{busy?'Searching…':'Search jobs'}<ArrowRight size={18}/></button>
        </form>
        <div className="intent-summary" aria-live="polite">
          {query ? <><span className="intent-label"><Sparkles size={14}/> Search interpreted as</span>{[
            ['role','Role',roleQuery],['experience','Experience',activeExperience==='0'?'Fresher':activeExperience.includes('years')?activeExperience:activeExperience?`${activeExperience} years`:''],['country','Location',activeCountry],['mode','Work mode',activeMode],['salary','Salary preference',intent.highSalary&&!removed.includes('salary')?'Higher salary (by currency)':'']
          ].filter(([, , value])=>value).map(([key,label,value])=><button type="button" key={key} className="intent-chip" onClick={()=>removeChip(key)} aria-label={`Remove ${label} filter`}><span>{label}:</span> {value}<X size={13}/></button>)}</> : <><span className="intent-label">Try a natural search</span><button type="button" className="query-example" onClick={()=>updateQuery('React jobs for freshers, remote, India')}>React jobs for freshers, remote, India <ArrowUpRight size={14}/></button></>}
        </div>
        <div className="discovery-footnote"><span><Globe2 size={14}/> Across connected worldwide sources</span><span>{listening?'Listening…':updatedAt?`Results updated ${updatedAt}`:'Fresh opportunities, one place'}</span></div>
      </section>
      <div className="discovery-grid">
        <ProfileSidebar user={user} />
        <section className="results live-job-feed" id="job-results">
          <div className="section-line">
            <div>
              <div className="eyebrow muted">LIVE JOB FEED <span className={`feed-live ${connected&&!paused?'online':''}`}>{connected&&!paused?'● LIVE':paused?'PAUSED':'RECONNECTING'}</span></div>
              <h2>New opportunities detected continuously</h2>
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
          <div className="radar-filters" aria-label="Worldwide locations">{[['All locations',''],['India','India'],['USA','United States'],['UK','United Kingdom'],['Canada','Canada'],['Germany','Germany'],['Australia','Australia'],['UAE','United Arab Emirates'],['Singapore','Singapore'],['Remote worldwide','Worldwide']].map(([label,value])=><button key={label} aria-pressed={activeCountry===value} onClick={()=>{setCountry(value);setRemoved(p=>[...p,'country']);setState('');setPage(1);if(value==='Worldwide')setMode('Remote');}}>{label==='All locations'?'🌍 Worldwide':label}</button>)}</div>
          <div className="radar-filters" aria-label="Job filters">{['Fresher','Internship','Full-time','Part-time','Contract','Remote','Hybrid','On-site'].map(label=><button key={label} aria-pressed={label==='Fresher'?activeExperience==='0':label.includes('years')?experience===label:jobType===label||activeMode===label} onClick={()=>{setPage(1);if(['Remote','Hybrid','On-site'].includes(label)){setMode(activeMode===label?'':label);setRemoved(p=>[...p,'mode']);}else if(label==='Fresher'||label.includes('years')){setExperience(experience===(label==='Fresher'?'0':label)?'':label==='Fresher'?'0':label);setRemoved(p=>[...p,'experience']);}else setJobType(jobType===label?'':label);}}>{label}</button>)}</div>
          <div className="results-toolbar">
            <span>
              {total.toLocaleString()} matching opportunities{' '}
            </span>
            <select
              aria-label="Sort jobs"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="discovered">Latest discovery</option>
              <option value="recent">Latest posted</option>
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
                  onChange={(e) => { setCountry(e.target.value); setState(''); setPage(1); }}
                >
                  <option value="">All countries</option>
                  <option value="Worldwide">Worldwide / anywhere</option>
                  {countries.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Job type
                <select value={jobType} onChange={(e) => { setJobType(e.target.value); setPage(1); }}>
                  <option value="">All job types</option>
                  {['Full-time', 'Part-time', 'Permanent', 'Contract', 'Temporary', 'Internship', 'Apprenticeship', 'Freelance', 'Volunteer'].map(t => <option key={t}>{t}</option>)}
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
            <section className="vertical-job-feed" aria-label="Latest job opportunities">
            <div className="vertical-job-list" ref={feed}>
              {jobs.map((job) => {
                const freshness = job.sourcePostedAt || job.discoveredAt;
                const freshnessLabel = job.sourcePostedAt ? 'Posted' : 'Discovered';
                return <article className="job-card vertical-job-card" data-job-id={job.id} data-new={newIds.includes(job.id)} key={job.id}>
                  <div className="company-heading">
                    <div className="company-monogram" aria-label={`${job.company} initials`}>{job.company.split(/\s+/).slice(0,2).map(word=>word[0]).join('')}</div>
                    <time className="job-freshness" data-fresh={clock > 0 && clock-Date.parse(freshness)<60000} dateTime={freshness} title={`${freshnessLabel} ${freshness}`}>{freshnessLabel} {discoveredTime(freshness)}</time>
                  </div>
                  <div className="job-main">
                    <div className="job-top">
                      <span className="job-category">{job.category}</span>
                      <button
                        className="icon-button"
                        aria-label={`${savedIds.includes(job.id) ? 'Saved' : 'Save'} ${job.title}`}
                        aria-pressed={savedIds.includes(job.id)}
                        onClick={() => void save(job.id)}
                      >
                        <Bookmark size={19} fill={savedIds.includes(job.id) ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <Link className="job-title" href={`/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <p className="company">
                      {job.company} {job.trust === 'verified' && <ShieldCheck size={14} />}
                    </p>
                    <div className="job-facts">
                      <span>
                        <MapPin size={14} />
                        {[job.city,job.country].filter((value,index,all)=>value && all.indexOf(value)===index).join(', ')}
                      </span>
                      <span>{job.mode}</span>
                      <span>{job.type}</span>
                      <span>
                        {job.experienceDisclosed === false ? 'Experience not specified' : job.experienceMin === 0 && job.experienceMax === 0
                          ? 'Fresher welcome'
                          : `${job.experienceMin}–${job.experienceMax} years`}
                      </span>
                    </div>
                    <div className="job-bottom">
                      <div className="skills">
                        {job.skills.slice(0, 4).map((s) => (
                          <span key={s}>{s}</span>
                        ))}
                      </div>
                      <strong>
                        {job.salaryDisclosed === false ? (job.salaryText || 'Salary not specified') : <>
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
                        <small>{job.normalizedFacts?.salary?.period ? ` / ${job.normalizedFacts.salary.period}` : ''}</small>
                        </>}
                      </strong>
                    </div>
                    {job.sourceLink && <a className="small" href={job.sourceLink} target="_blank" rel="noopener noreferrer">Source: {job.source} ↗</a>}
                    {!job.sourceLink && <span className="small">Source: {job.source}</span>}
                    <span className={`trust-label ${job.trust}`}>{job.trust==='verified'?'✓ Verified listing':job.trust==='flagged'?'Needs review':'Verification pending'}</span>
                    <div className="job-match-status"><Sparkles size={14}/> AI match score unavailable</div>
                    {job.sourceUpdatedAt && <span className="job-updated">Updated {discoveredTime(job.sourceUpdatedAt)}</span>}
                    <div className="feed-card-actions">
                    <Link
                      className="secondary job-apply"
                      href={`/jobs/${job.id}`}
                      aria-label={`View job ${job.title}`}
                    >
                      View Job <ArrowUpRight size={17} />
                    </Link>
                    <Link className="primary job-apply" href={`/jobs/${job.id}`} aria-label={`Review ${job.title} before applying`}>Apply <ArrowRight size={17}/></Link>
                    </div>
                  </div>
                </article>;
              })}
            </div>
            </section>
          )}
          <div className="feed-load-more">
            <output>Page {page} · {jobs.length} jobs · {total.toLocaleString()} matching opportunities</output>
            <nav className="pagination" aria-label="Job result pages">
              <button className="secondary" disabled={busy || page === 1} onClick={()=>changePage(page-1)}>Previous</button>
              <span>Page {page} of {Math.max(1,Math.ceil(total/24))}</span>
              <button className="secondary" disabled={busy || !hasMore} onClick={()=>changePage(page+1)}>Next</button>
            </nav>
            {busy && <span>Loading jobs…</span>}
            {loadFailed && <button className="secondary" onClick={()=>void search()}>Retry loading jobs</button>}
          </div>
          {newCount>0&&<button className="new-jobs-alert" aria-live="polite" onClick={()=>{arrivalBaseline.current=latestMeasurement.current;setNewCount(0);setSort('discovered');setPage(1);setQuery('');setCategory('');setCountry('');setMode('');setJobType('');setExperience('');setState('');setSemantic(false);setRemoved([]);setNewIds([]);document.getElementById('job-results')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}}><span>🔴 {newCount} new jobs detected</span><strong>View new jobs →</strong></button>}
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
