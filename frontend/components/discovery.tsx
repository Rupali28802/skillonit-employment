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
  BriefcaseBusiness,
  CalendarDays,
  Clock3,

  Sparkles,
  Pause,
  Play,
  Mic, SlidersHorizontal, X,
} from 'lucide-react';
import type { PublicJob, User } from '@/lib/domain';
import { CategorySlider } from './category-slider';
import { JobActions } from './job-actions';
import { countries, states } from '@/lib/domain';
import { searchIntent } from '@/lib/search-intent';
import { SupportChatbot } from './support-chatbot';
import { WhatsAppSupport } from './whatsapp-support';

type VoiceResult = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { transcript: string; confidence: number };
};

type VoiceRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<VoiceResult> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type VoiceRecognitionConstructor = new () => VoiceRecognition;

type DiscoveryStats = {
  totalJobs: number; detectedToday: number; newJobs: number; newSince?: number; countries: number | null; measuredAt: string;
  workerOnline?: boolean;
  tenMinuteSourcesConfigured?: number;
  tenMinuteSourcesOnline?: number;
  tenMinuteSourcesOnCadence?: number;
  tenMinuteSourcesOverdue?: number;
};
type JobSearchResult = { jobs: PublicJob[]; total: number; hasMore: boolean };
type ApiPayload<T> = { data?: T; error?: { message?: string } };

// A reverse proxy can return an HTML 502/504 during a deploy or a short
// upstream outage.  Never feed that body into JSON.parse and expose its parser
// error to a job seeker.
async function readApiPayload<T>(response: Response): Promise<ApiPayload<T>> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(response.ok ? 'The job service returned an unexpected response. Please retry.' : 'Job search is temporarily unavailable. Please retry.');
  }
  try {
    return await response.json() as ApiPayload<T>;
  } catch {
    throw new Error('Job search is temporarily unavailable. Please retry.');
  }
}

export function Discovery({
  initialJobs,
  user,
}: {
  initialJobs: PublicJob[];
  user: User | null;
}) {
  const [jobs, setJobs] = useState(initialJobs.slice(0, 6)),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [country, setCountry] = useState(''),
    [mode, setMode] = useState(''),
    [jobType, setJobType] = useState(''),
    [freshness, setFreshness] = useState(''),
    [opportunity, setOpportunity] = useState(''),
    [directApplication, setDirectApplication] = useState(false),
    [experience, setExperience] = useState(''),
    [state, setState] = useState(''),
    [sort, setSort] = useState('discovered'),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(6),
    [filters, setFilters] = useState(false),
    [noticePaused, setNoticePaused] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const filterKey = useRef('');
  const requestPending = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [total, setTotal] = useState(initialJobs.length);
  const [hasMore, setHasMore] = useState(initialJobs.length >= 6);
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState('');
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const [semantic, setSemantic] = useState(false);
  const [clock, setClock] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [displayedNewJobs, setDisplayedNewJobs] = useState(0);
  const [newJobsTarget, setNewJobsTarget] = useState(0);
  const confirmedNewJobsTarget = useRef(0);
  const zeroNewJobsMeasurements = useRef(0);
  const arrivalBaseline = useRef('');
  const latestMeasurement = useRef('');
  const [stats, setStats] = useState<DiscoveryStats|null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [matchPreferencesOpen, setMatchPreferencesOpen] = useState(false);
  const matchPreferencesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!matchPreferencesOpen) return;
    const closeWhenOutside = (event: MouseEvent | TouchEvent) => {
      if (matchPreferencesRef.current && !matchPreferencesRef.current.contains(event.target as Node)) {
        setMatchPreferencesOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMatchPreferencesOpen(false);
    };
    document.addEventListener('mousedown', closeWhenOutside);
    document.addEventListener('touchstart', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeWhenOutside);
      document.removeEventListener('touchstart', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [matchPreferencesOpen]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1101px)');
    const tablet = window.matchMedia('(min-width: 641px) and (max-width: 1100px)');
    const resizePage = () => {
      const nextSize = desktop.matches ? 6 : tablet.matches ? 4 : 2;
      setPageSize(current => {
        if (current === nextSize) return current;
        setPage(1);
        return nextSize;
      });
    };
    resizePage();
    desktop.addEventListener('change', resizePage);
    tablet.addEventListener('change', resizePage);
    return () => {
      desktop.removeEventListener('change', resizePage);
      tablet.removeEventListener('change', resizePage);
    };
  }, []);
  useEffect(()=>{const initial=setTimeout(()=>setClock(Date.now()),0);const timer=setInterval(()=>setClock(Date.now()),30000);return()=>{clearTimeout(initial);clearInterval(timer);};},[]);
  useEffect(()=>{
    let cancelled=false, loading=false;
    const refresh=async()=>{
      if(loading)return;
      loading=true;
      const baseline=arrivalBaseline.current;
      try {
        const r=await fetch(`/api/v1/jobs/discovery-status${baseline?`?since=${encodeURIComponent(baseline)}`:''}`);
        const {data,error}=await readApiPayload<DiscoveryStats>(r);
        if(!r.ok)throw Error(error?.message || 'Discovery status is temporarily unavailable.');
        if(!data) throw Error('Discovery status is temporarily unavailable.');
        if(!cancelled){setStats(data);latestMeasurement.current=data.measuredAt;
          if(!arrivalBaseline.current || Date.parse(data.measuredAt)-Date.parse(arrivalBaseline.current)>86400000)arrivalBaseline.current=data.measuredAt;
          else if(baseline===arrivalBaseline.current)setNewCount(data.newSince||0);
        }
      }catch{if(!cancelled)setStats(null);}finally{loading=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),15000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[]);
  useEffect(() => {
    if (typeof stats?.newJobs !== 'number') return;
    const measuredTarget = Math.max(0, Math.floor(stats.newJobs));

    // Ignore one isolated zero reading so a temporary status refresh cannot
    // make a real live count appear to reset. A confirmed zero still becomes
    // the accurate target on the following measurement.
    if (measuredTarget === 0 && confirmedNewJobsTarget.current > 0) {
      zeroNewJobsMeasurements.current += 1;
      if (zeroNewJobsMeasurements.current < 2) return;
    } else {
      zeroNewJobsMeasurements.current = 0;
    }

    confirmedNewJobsTarget.current = measuredTarget;
    setNewJobsTarget(measuredTarget);
  }, [stats?.newJobs]);
  useEffect(() => {
    if (displayedNewJobs === newJobsTarget) return;

    const timer = window.setTimeout(() => {
      setDisplayedNewJobs(current => {
        if (current === newJobsTarget) return current;
        return current + (current < newJobsTarget ? 1 : -1);
      });
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350);
    return () => window.clearTimeout(timer);
  }, [displayedNewJobs, newJobsTarget]);
  function discoveredTime(value:string){const age=clock-Date.parse(value);if(!clock||!Number.isFinite(age))return 'Time unavailable';const minutes=Math.max(0,Math.floor(age/60000));return minutes===0?'Just now':minutes<60?`${minutes} min ago`:minutes<1440?`${Math.floor(minutes/60)} hour${minutes>=120?'s':''} ago`:`${Math.floor(minutes/1440)} days ago`;}
  const intent = useMemo(() => searchIntent(query, countries), [query]);
  const roleQuery = removed.includes('role') ? '' : intent.role;
  const activeCountry = country || (removed.includes('country') ? '' : intent.country);
  const activeMode = mode || (removed.includes('mode') ? '' : intent.mode);
  const activeExperience = experience || (removed.includes('experience') ? '' : intent.experience);
  const radarFilterCount = [activeCountry, activeMode, jobType, activeExperience, freshness, opportunity, directApplication].filter(Boolean).length;
  function updateQuery(value: string) { setQuery(value); setRemoved([]); setPage(1); }
  function removeChip(key: string) {
    setRemoved(prev => [...prev,key]); setPage(1);
    if(key==='country') {setCountry('');setState('');} if(key==='mode') setMode(''); if(key==='experience') setExperience('');
  }
  async function voiceSearch() {
    if (listening) {
      recognitionRef.current?.stop();
      setVoiceMessage('Voice input stopped.');
      return;
    }

    const voiceWindow = window as unknown as {
      SpeechRecognition?: VoiceRecognitionConstructor;
      webkitSpeechRecognition?: VoiceRecognitionConstructor;
    };
    const Voice = voiceWindow.SpeechRecognition || voiceWindow.webkitSpeechRecognition;
    if (!Voice) {
      setVoiceMessage('Voice search is not supported in this browser. Please type your search.');
      return;
    }

    const recognition = new Voice();
    recognitionRef.current = recognition;
    recognition.lang = navigator.language || 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let finalTranscript = '';
    let recognitionFailed = false;

    recognition.onstart = () => {
      setListening(true);
      setVoiceMessage('Listening… Say the job, skill, or location you want.');
    };
    recognition.onresult = event => {
      let interimTranscript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) finalTranscript += transcript;
        else interimTranscript += transcript;
      }
      const spokenQuery = `${finalTranscript} ${interimTranscript}`.trim();
      if (spokenQuery) updateQuery(spokenQuery);
      if (finalTranscript.trim()) {
        setListening(false);
        setVoiceMessage(`Searching for “${finalTranscript.trim()}”…`);
        window.setTimeout(() => {
          document.getElementById('job-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 450);
      } else if (spokenQuery) {
        setVoiceMessage(`Hearing: “${spokenQuery}”`);
      }
    };
    recognition.onerror = event => {
      recognitionFailed = true;
      setListening(false);
      recognitionRef.current = null;
      const errors: Record<string, string> = {
        'not-allowed': 'Microphone permission is blocked. Allow microphone access in your browser and try again.',
        'service-not-allowed': 'Voice recognition permission is blocked in this browser.',
        'audio-capture': 'No working microphone was found. Check your device and try again.',
        'no-speech': 'No speech was heard. Select the microphone and try again.',
        network: 'Voice recognition is temporarily unavailable. Check your connection and try again.',
      };
      if (event.error !== 'aborted') {
        setVoiceMessage(errors[event.error] || 'Voice search could not start. Please try again or type your search.');
      }
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (!recognitionFailed && !finalTranscript.trim()) {
        setVoiceMessage('Listening ended without a query. Select the microphone to try again.');
      }
    };

    try {
      setVoiceMessage('Starting microphone…');
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setVoiceMessage('Voice search is already active or unavailable. Please try again.');
    }
  }
  useEffect(() => () => recognitionRef.current?.abort(), []);
  const search = useCallback(
    async (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
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
          page: String(page),
          limit: String(pageSize),
          // "Best match" uses the transparent server-side relevance score.
          // AI search remains an explicit opt-in because its index can be narrower.
          searchMode: semantic ? 'semantic' : 'keyword',
        });
        if (freshness) p.set('postedWithinDays', freshness);
        if (opportunity === 'internship') p.set('internship', 'true');
        if (opportunity === 'entry-level') p.set('entryLevel', 'true');
        if (directApplication) p.set('hasDirectApplication', 'true');
        const range:Record<string,string[]>={'0–2 years':['0','2'],'2–5 years':['2','5'],'5+ years':['5','100']};
        if(range[activeExperience]){p.delete('experience');p.set('experienceMin',range[activeExperience][0]);p.set('experienceMax',range[activeExperience][1]);}
        const keyParams = new URLSearchParams(p); keyParams.delete('page');
        const key = keyParams.toString();
        if (filterKey.current !== key) {
          filterKey.current = key;
          if (page !== 1) { setPage(1); return; }
        }
        const response = await fetch(`/api/v1/jobs?${p}`);
        const payload = await readApiPayload<JobSearchResult>(response);
        if (!response.ok) throw Error(payload.error?.message || 'Search unavailable');
        if (!payload.data) throw Error('Job search is temporarily unavailable. Please retry.');
        const j = payload.data;
        if (requestId === sequence.current) {
          const incoming: PublicJob[] = j.jobs;
          setJobs(current => {
            const combined = page > 1 ? [...current, ...incoming] : incoming;
            const unique = [...new Map(combined.map(job => [job.id, job])).values()];
            return unique;
          });
          setTotal(j.total);
          setHasMore(j.hasMore);setUpdatedAt(new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));}
      } catch (e) {
        if(requestId===sequence.current){setMessage((e as Error).message);setLoadFailed(true);}
      } finally {
        if (requestId === sequence.current) {setBusy(false);requestPending.current=false;}
      }
    },
    [roleQuery, category, activeCountry, activeMode, jobType, activeExperience, freshness, opportunity, directApplication, state, sort, page, pageSize, semantic, intent.highSalary, removed],
  );
  useEffect(() => {
    const timer = setTimeout(() => void search(), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const loadMore = useCallback(() => {
    if (busy || requestPending.current || !hasMore || loadFailed) return;
    setPage(current => current + 1);
  }, [busy, hasMore, loadFailed]);
  async function save(id: string) {
    try {
      const r = await fetch(`/api/v1/jobs/${id}/save`, { method: 'POST' });
      if (r.status === 401) {
        window.location.assign('/login?next=/saved');
        return;
      }
      const { error } = await readApiPayload(r);
      if (r.ok) setSavedIds(ids => ids.includes(id) ? ids : [...ids, id]);
      setMessage(r.ok ? 'Saved to your collection.' : error?.message || 'Could not save job.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save job.');
    }
  }
  const radarMetrics = [
    { label: 'Total matching opportunities', value: stats?.totalJobs, Icon: BriefcaseBusiness, tone: 'opportunities' },
    { label: 'Detected today (UTC)', value: stats?.detectedToday, Icon: CalendarDays, tone: 'today' },
    { label: 'New in 10 minutes', value: displayedNewJobs, Icon: Clock3, tone: 'live' },
    { label: 'Countries / territories · includes eligibility', value: stats?.countries, Icon: Globe2, tone: 'coverage' },
  ];
  const fastSourcesConfigured = stats?.tenMinuteSourcesConfigured;
  const fastSourcesOnCadence = stats?.tenMinuteSourcesOnCadence;
  const discoveryConnected = stats?.workerOnline === true &&
    (typeof fastSourcesConfigured !== 'number' || fastSourcesConfigured === 0 || fastSourcesOnCadence === fastSourcesConfigured);
  const discoveryStatusLabel = stats
    ? discoveryConnected
      ? `Live feed connected${typeof fastSourcesConfigured === 'number' ? ` · ${fastSourcesOnCadence}/${fastSourcesConfigured} fast sources on schedule` : ''}`
      : 'Live feed is reconnecting'
    : 'Checking live feed';
  return (
    <>
      <section className="live-discovery" aria-labelledby="live-discovery-heading">
        <div className="radar-metrics" aria-label="Live discovery statistics">
          <strong>LIVE DISCOVERY</strong>
          <div className="radar-metric-values">
            {radarMetrics.map(({ label, value, Icon, tone }) => (
              <span
                className={`radar-metric-card radar-metric-${tone}${tone === 'live' ? ' radar-metric-live' : ''}`}
                data-tone={tone}
                key={label}
                aria-label={tone === 'live' ? `${value} new jobs in the last ten minutes` : undefined}
              >
                <span className="radar-metric-icon" aria-hidden="true"><Icon size={17}/></span>
                <span className="radar-metric-copy">
                  <b className={tone === 'live' ? 'radar-live-count' : undefined} key={tone === 'live' ? displayedNewJobs : label} aria-hidden={tone === 'live' ? true : undefined}>{typeof value === 'number' ? value.toLocaleString() : '—'}</b>
                  <small>{label}</small>
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="live-discovery-top">
          <div><div className="discovery-kicker"><Sparkles size={15}/> SKILLONIT EMPLOYMENT</div>
            <h1 id="live-discovery-heading">Find the Right Job. <span>Faster, Smarter, Globally.</span></h1>
            <p>Discover jobs from around the world, explore roles that match your skills and take your next step—all in one place.</p></div>
          <span className={`discovery-status${discoveryConnected ? ' is-connected' : ''}`} aria-live="polite"><i/>{discoveryStatusLabel}</span>
        </div>
        <form className="discovery-search" onSubmit={event=>{event.preventDefault();void search();document.getElementById('job-results')?.scrollIntoView({behavior:'smooth',block:'start'});}}>
          <div className="discovery-query"><Search size={23}/><input aria-label="Search worldwide jobs" aria-describedby={voiceMessage?'voice-search-status':undefined} placeholder="Search worldwide jobs..." value={query} onChange={e=>{updateQuery(e.target.value);setVoiceMessage('');}}/><button type="button" className="ai-search-badge" aria-pressed={semantic} title="Toggle meaning-based search of indexed jobs; coverage is still growing" onClick={()=>{setSemantic(!semantic);setPage(1);}}><Sparkles size={13}/> AI search {semantic ? 'on' : 'off'}</button><button type="button" className={`voice-search${listening?' is-listening':''}`} aria-label={listening?'Stop voice search':'Start voice search'} aria-pressed={listening} title={listening?'Listening — select to stop':'Search with your voice'} onClick={()=>void voiceSearch()}><Mic size={19}/></button></div>
          <label className="discovery-location"><MapPin size={19}/><select aria-label="Search location" value={activeCountry} onChange={e=>{setCountry(e.target.value);setRemoved(prev=>[...prev,'country']);setState('');setPage(1);}}><option value="">Worldwide</option>{countries.map(c=><option key={c}>{c}</option>)}</select></label>
          <button type="button" className="discovery-filter" aria-expanded={filters} onClick={()=>{setFilters(!filters);document.getElementById('job-results')?.scrollIntoView({behavior:'smooth',block:'start'});}}><SlidersHorizontal size={18}/> Filters</button>
          <button className="primary discovery-submit" disabled={busy}>{busy?'Searching…':'Search jobs'}<ArrowRight size={18}/></button>
        </form>
        {voiceMessage && <output id="voice-search-status" className={`voice-search-status${listening?' is-listening':''}`} aria-live="polite"><span aria-hidden="true"/><p>{voiceMessage}</p></output>}
        <div className="intent-summary" aria-live="polite">
          {query ? <><span className="intent-label"><Sparkles size={14}/> Search interpreted as</span>{[
            ['role','Role',roleQuery],['experience','Experience',activeExperience==='0'?'Fresher':activeExperience.includes('years')?activeExperience:activeExperience?`${activeExperience} years`:''],['country','Location',activeCountry],['mode','Work mode',activeMode],['salary','Salary preference',intent.highSalary&&!removed.includes('salary')?'Higher salary (by currency)':'']
          ].filter(([, , value])=>value).map(([key,label,value])=><button type="button" key={key} className="intent-chip" onClick={()=>removeChip(key)} aria-label={`Remove ${label} filter`}><span>{label}:</span> {value}<X size={13}/></button>)}</> : <><span className="intent-label">Try a natural search</span><button type="button" className="query-example" onClick={()=>updateQuery('React jobs for freshers, remote, India')}>React jobs for freshers, remote, India <ArrowUpRight size={14}/></button></>}
        </div>
        <div className="discovery-footnote"><span><Globe2 size={14}/> Across connected worldwide sources</span><span>{listening?'Listening…':updatedAt?`Results updated ${updatedAt}`:'Fresh opportunities, one place'}</span></div>
      </section>
      <div className="discovery-grid">
        <section className="results live-job-feed" id="job-results">
          <div className="section-line">
            <div>
              <div className="eyebrow muted">LIVE JOB FEED <span className="feed-live online">● LIVE</span></div>
              <h2>New opportunities detected continuously</h2>
            </div>
          </div>
          <CategorySlider value={category} onChange={(value) => { setCategory(value); setPage(1); }} />
          <div className="results-toolbar">
            <div className="results-tools">
              <div className="radar-filter-menu" ref={matchPreferencesRef}>
                <button
                  type="button"
                  className="radar-filter-trigger"
                  aria-expanded={matchPreferencesOpen}
                  aria-controls="match-preferences-popover"
                  onClick={() => setMatchPreferencesOpen(open => !open)}
                >
                  <SlidersHorizontal size={14} /> Match preferences
                  {radarFilterCount > 0 && <span>{radarFilterCount}</span>}
                </button>
                {matchPreferencesOpen && <section id="match-preferences-popover" className="radar-filter-popover" aria-label="Match preferences">
                  <button type="button" className="radar-filter-close" aria-label="Close match preferences" onClick={() => setMatchPreferencesOpen(false)}>
                    <X size={18} aria-hidden="true" />
                  </button>
                  <div className="radar-filter-group">
                    <strong>Location</strong>
                    <div className="radar-filters" aria-label="Worldwide locations">{[['All locations',''],['India','India'],['USA','United States'],['UK','United Kingdom'],['Canada','Canada'],['Germany','Germany'],['Australia','Australia'],['UAE','United Arab Emirates'],['Singapore','Singapore'],['Remote worldwide','Worldwide']].map(([label,value])=><button type="button" key={label} aria-pressed={activeCountry===value} onClick={()=>{setCountry(value);setRemoved(p=>[...p,'country']);setState('');setPage(1);if(value==='Worldwide')setMode('Remote');}}>{label==='All locations'?'🌍 Worldwide':label}</button>)}</div>
                  </div>
                  <div className="radar-filter-group">
                    <strong>Job preferences</strong>
                    <div className="radar-filters" aria-label="Job filters">{['Fresher','Internship','Full-time','Part-time','Contract','Remote','Hybrid','On-site'].map(label=><button type="button" key={label} aria-pressed={label==='Fresher'?activeExperience==='0':label==='Internship'?opportunity==='internship':label.includes('years')?experience===label:jobType===label||activeMode===label} onClick={()=>{setPage(1);if(['Remote','Hybrid','On-site'].includes(label)){setMode(activeMode===label?'':label);setRemoved(p=>[...p,'mode']);}else if(label==='Fresher'||label.includes('years')){setExperience(experience===(label==='Fresher'?'0':label)?'':label==='Fresher'?'0':label);setRemoved(p=>[...p,'experience']);}else if(label==='Internship')setOpportunity(opportunity==='internship'?'':'internship');else setJobType(jobType===label?'':label);}}>{label}</button>)}</div>
                  </div>
                </section>}
              </div>
              <label className="result-sort-select">
                <span className="sr-only">Sort jobs</span>
                <select
                  aria-label="Sort jobs"
                  value={sort}
                  onChange={(e) => { setSort(e.target.value); setPage(1); }}
                >
                  <option value="discovered">Latest first</option>
                  <option value="relevant">Best match</option>
                </select>
              </label>
              <button
                className="mobile-filter"
                onClick={() => setFilters(!filters)}
              >
                Advanced filters
              </button>
            </div>
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
                Posted
                <select value={freshness} onChange={(e) => { setFreshness(e.target.value); setPage(1); }}>
                  <option value="">Any verified posting date</option>
                  <option value="1">Last 24 hours</option>
                  <option value="3">Last 3 days</option>
                  <option value="7">Last 7 days</option>
                  <option value="14">Last 14 days</option>
                  <option value="30">Last 30 days</option>
                </select>
              </label>
              <label>
                Opportunity focus
                <select value={opportunity} onChange={(e) => { setOpportunity(e.target.value); setPage(1); }}>
                  <option value="">All opportunities</option>
                  <option value="entry-level">Entry-level and fresher</option>
                  <option value="internship">Internships and apprenticeships</option>
                </select>
              </label>
              <label>
                Application route
                <select value={directApplication ? 'direct' : ''} onChange={(e) => { setDirectApplication(e.target.value === 'direct'); setPage(1); }}>
                  <option value="">All authorized routes</option>
                  <option value="direct">Direct application form</option>
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
                return <article className="job-card vertical-job-card" data-job-id={job.id} key={job.id}>
                  <div className="job-card-hero">
                    <div className="company-heading">
                      <span className="job-category">{job.category || 'Other'}</span>
                      <div className="job-card-hero-actions">
                        <time className="job-freshness" data-fresh={clock > 0 && clock-Date.parse(freshness)<60000} dateTime={freshness} title={freshness}><Clock3 size={14}/> {discoveredTime(freshness)}</time>
                      <button
                        className="icon-button"
                        aria-label={`${savedIds.includes(job.id) ? 'Saved' : 'Save'} ${job.title}`}
                        aria-pressed={savedIds.includes(job.id)}
                        onClick={() => void save(job.id)}
                      >
                        <Bookmark size={19} fill={savedIds.includes(job.id) ? 'currentColor' : 'none'} />
                      </button>
                      </div>
                    </div>
                    <Link className="job-title" href={`/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <p className="company">
                      {job.company} {job.trust === 'verified' && <ShieldCheck size={14} />}
                    </p>
                  </div>
                  <div className="job-main">
                    <div className="job-facts">
                      <span>
                        <MapPin size={14} />
                        {[job.city,job.country].filter((value,index,all)=>value && all.indexOf(value)===index).join(', ')}
                      </span>
                      <span><BriefcaseBusiness size={14}/>{job.mode || 'Not specified'}</span>
                      <span><ShieldCheck size={14}/>{job.type || 'Not specified'}</span>
                    </div>
                    <div className="job-card-salary"><div><small>Salary</small><strong>
                          {job.salaryDisclosed === false ? (job.salaryText || 'Not specified') : <>
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
                        </strong></div>
                      <span className={`trust-label ${job.trust}`}><ShieldCheck size={16}/>{job.trust==='verified'?'Verified':job.trust==='flagged'?'Needs review':'Verification pending'}</span>
                    </div>
                    <div className="feed-card-actions">
                    <Link
                      className="secondary job-apply"
                      href={`/jobs/${job.id}`}
                      aria-label={`View job ${job.title}`}
                    >
                      View Job <ArrowUpRight size={17} />
                    </Link>
                    <JobActions jobId={job.id} sample={job.sample} compact />
                    </div>
                  </div>
                </article>;
              })}
            </div>
            </section>
          )}
          <div className="feed-load-more">
            <output>Showing {jobs.length.toLocaleString()} of {total.toLocaleString()} matching opportunities</output>
            {hasMore && <button className="secondary" disabled={busy} onClick={loadMore}>Load more jobs</button>}
            {busy && <span>Loading jobs…</span>}
            {loadFailed && <button className="secondary" onClick={()=>void search()}>Retry loading jobs</button>}
            {!hasMore && jobs.length > 0 && <span>You’ve reached the end of the current results.</span>}
          </div>
          {newCount>0&&<button className="new-jobs-alert" aria-live="polite" onClick={()=>{arrivalBaseline.current=latestMeasurement.current;setNewCount(0);setSort('discovered');setPage(1);setQuery('');setCategory('');setCountry('');setMode('');setJobType('');setExperience('');setState('');setSemantic(false);setRemoved([]);document.getElementById('job-results')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}}><span>🔴 {newCount} new jobs detected</span><strong>View new jobs →</strong></button>}
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
      <WhatsAppSupport />
      <SupportChatbot />
    </>
  );
}
