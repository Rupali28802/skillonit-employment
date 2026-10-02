import { categories, isRecent, publicJob, type Job, type PublicJob } from './domain.js';
import { countryEntries, normalizeCountry } from './countries.js';
import { configuredPlans, read } from './store.js';

export type SeoPageType = 'country' | 'city' | 'occupation' | 'country-occupation' | 'industry' | 'skill' | 'remote' | 'work-arrangement' | 'job-type' | 'experience';
export type SeoRegistryPage = {
  pageType: SeoPageType;
  canonicalPath: string;
  country?: string;
  city?: string;
  occupation?: string;
  skill?: string;
  industry?: string;
  jobType?: string;
  experienceLevel?: string;
  workArrangement?: string;
  intent: string;
  title: string;
  description: string;
  h1: string;
  topics: string[];
  publicationStatus: 'published' | 'excluded';
  indexable: boolean;
  sitemapEligible: boolean;
  jobCount: number;
  lastVerifiedAt: string;
  contentVersion: 1;
  exclusionReason?: string;
  jobIds: string[];
};
export type SeoRegistry = {
  generatedAt: string;
  expiresAt: string;
  referenceCountries: number;
  countriesWithJobs: number;
  approvedCountries: number;
  pages: SeoRegistryPage[];
  eligibleJobIds: string[];
  noindexJobs: number;
  duplicatesPrevented: number;
  totalJobs: number;
  scannedJobs: number;
  truncated: boolean;
};

const MIN_COUNTRY = 3, MIN_CITY = 3, MIN_FACET = 5, MAX_SCAN = 100_000, PAGE_JOBS = 24;
const TTL_MS = 5 * 60_000;
const approvedTypes = new Set(['full-time', 'part-time', 'contract', 'internship', 'temporary']);
const slug = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const clean = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const labelType = (value: string) => value.split(/[-_ ]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' ');
const validCity = (value: string) => value.length >= 2 && value.length <= 80 && /^[\p{L}\p{M} .'-]+$/u.test(value) && !/^(unknown|not specified|remote|multiple locations)$/i.test(value);
const mapPush = (map: Map<string, Job[]>, key: string, job: Job) => { const list = map.get(key) ?? []; list.push(job); map.set(key, list); };
export const isSeoJobEligible = (job: Job) => job.status === 'published' && job.trust === 'verified' && !job.sample && isRecent(job) && job.feed?.publicListing === true && Boolean(job.sourcePostedAt) && Boolean(normalizeCountry(clean(job.country))) && Boolean(clean(job.title)) && Boolean(clean(job.description));

function page(input: Omit<SeoRegistryPage, 'publicationStatus' | 'indexable' | 'sitemapEligible' | 'lastVerifiedAt' | 'contentVersion' | 'jobIds'> & { jobs: Job[] }, now: string): SeoRegistryPage {
  const {jobs,...metadata}=input;
  return { ...metadata, publicationStatus: 'published', indexable: true, sitemapEligible: true, lastVerifiedAt: now, contentVersion: 1, jobIds: jobs.slice(0, PAGE_JOBS).map(job => job.id) };
}

type CatalogItem={id:string;slug:string;displayName:string;aliases?:string[];active:boolean};
export function buildSeoRegistry(jobs: Job[], generatedAt = new Date().toISOString(), truncated = false, catalogs:{skills?:CatalogItem[];occupations?:CatalogItem[]}={}): SeoRegistry {
  const current = jobs.filter(job => job.status === 'published' && job.trust === 'verified' && !job.sample && isRecent(job, 90, Date.parse(generatedAt)));
  const countries = new Map<string, Job[]>(), cities = new Map<string, Job[]>(), occupations = new Map<string, Job[]>(), countryOccupations = new Map<string, Job[]>(), industries = new Map<string, Job[]>(), skills = new Map<string, Job[]>(), types = new Map<string, Job[]>(), arrangements = new Map<string, Job[]>(), experience = new Map<string, Job[]>(), remote: Job[] = [];
  const approvedCategories = new Set(categories.map(item => item.toLowerCase()));
  const skillNames=new Map((catalogs.skills??[]).filter(item=>item.active).flatMap(item=>[item.displayName,...(item.aliases??[])].map(value=>[value.toLowerCase(),item.displayName] as const)));
  const occupationNames=new Map((catalogs.occupations??[]).filter(item=>item.active).flatMap(item=>[item.displayName,...(item.aliases??[])].map(value=>[value.toLowerCase(),item.displayName] as const)));
  for (const job of current) {
    const country = normalizeCountry(clean(job.country));
    if (!country) continue;
    mapPush(countries, country, job);
    const city = clean(job.city);
    if (validCity(city)) mapPush(cities, `${country}\u0000${city}`, job);
    const industry = clean(job.category);
    if (approvedCategories.has(industry.toLowerCase())) mapPush(industries, industry, job);
    for (const raw of [...new Set((job.skills ?? []).map(clean).filter(value => value.length >= 2 && value.length <= 60))]) { const skill=skillNames.get(raw.toLowerCase()); if(skill)mapPush(skills,skill,job); }
    const occupation=occupationNames.get(clean(job.title).toLowerCase()); if(occupation){mapPush(occupations,occupation,job);mapPush(countryOccupations,`${country}\u0000${occupation}`,job);}
    const type = clean(job.type).toLowerCase().replace(/[ _]+/g, '-');
    if (approvedTypes.has(type)) mapPush(types, type, job);
    if (job.mode === 'Remote') remote.push(job); else if(job.mode==='Hybrid'||job.mode==='On-site')mapPush(arrangements,job.mode,job);
    if(job.experienceDisclosed!==false&&Number.isFinite(job.experienceMin)){const level=job.experienceMin>=10?'Executive':job.experienceMin>=5?'Senior':job.experienceMin>=3?'Mid-level':job.experienceMin>=1?'Junior':'Entry-level';mapPush(experience,level,job);}
  }
  const pages: SeoRegistryPage[] = [], used = new Set<string>(); let duplicatesPrevented = 0;
  const add = (entry: SeoRegistryPage) => { if (used.has(entry.canonicalPath)) duplicatesPrevented += 1; else { used.add(entry.canonicalPath); pages.push(entry); } };
  for (const [country, list] of countries) if (list.length >= MIN_COUNTRY) add(page({ pageType:'country', canonicalPath:`/jobs/country/${slug(country)}`, country, intent:'Country job discovery', title:`Jobs in ${country} | SkillOnIT Employment`, description:`Explore current jobs in ${country} on SkillOnIT Employment. Browse roles, locations, work arrangements and application options.`, h1:`Jobs in ${country}`, topics:['jobs',country], jobCount:list.length, jobs:list }, generatedAt));
  for (const [key, list] of cities) if (list.length >= MIN_CITY) { const [country, city] = key.split('\u0000'); add(page({ pageType:'city', canonicalPath:`/jobs/city/${slug(country)}/${slug(city)}`, country, city, intent:'City job discovery', title:`Jobs in ${city}, ${country} | SkillOnIT Employment`, description:`Explore current jobs in ${city}, ${country} on SkillOnIT Employment. Browse relevant roles and work arrangements.`, h1:`Jobs in ${city}, ${country}`, topics:['jobs',city,country], jobCount:list.length, jobs:list }, generatedAt)); }
  for (const [industry, list] of industries) if (list.length >= MIN_FACET) add(page({ pageType:'industry', canonicalPath:`/jobs/industry/${slug(industry)}`, industry, intent:'Industry discovery', title:`${industry} Jobs | SkillOnIT Employment`, description:`Explore current ${industry.toLowerCase()} jobs on SkillOnIT Employment. Browse locations, work arrangements and application options.`, h1:`${industry} Jobs`, topics:['jobs',industry], jobCount:list.length, jobs:list }, generatedAt));
  for (const [occupation, list] of occupations) if (list.length >= MIN_FACET) add(page({ pageType:'occupation', canonicalPath:`/jobs/occupation/${slug(occupation)}`, occupation, intent:'Occupation discovery', title:`${occupation} Jobs | SkillOnIT Employment`, description:`Explore current ${occupation.toLowerCase()} jobs on SkillOnIT Employment. Browse locations, work arrangements and application options.`, h1:`${occupation} Jobs`, topics:['jobs',occupation], jobCount:list.length, jobs:list }, generatedAt));
  for (const [key, list] of countryOccupations) if (list.length >= MIN_FACET) {const [country,occupation]=key.split('\u0000');add(page({pageType:'country-occupation',canonicalPath:`/jobs/country/${slug(country)}/occupation/${slug(occupation)}`,country,occupation,intent:'Country and occupation discovery',title:`${occupation} Jobs in ${country} | SkillOnIT Employment`,description:`Explore current ${occupation.toLowerCase()} jobs in ${country} on SkillOnIT Employment. Browse locations, work arrangements and application options.`,h1:`${occupation} Jobs in ${country}`,topics:['jobs',occupation,country],jobCount:list.length,jobs:list},generatedAt));}
  for (const [skill, list] of skills) if (list.length >= MIN_FACET) add(page({ pageType:'skill', canonicalPath:`/jobs/skills/${slug(skill)}`, skill, intent:'Skill-based discovery', title:`${skill} Jobs | SkillOnIT Employment`, description:`Explore current jobs that list ${skill} on SkillOnIT Employment. Browse relevant roles, locations and work arrangements.`, h1:`${skill} Jobs`, topics:['jobs',skill], jobCount:list.length, jobs:list }, generatedAt));
  for (const [jobType, list] of types) if (list.length >= MIN_FACET) { const name=labelType(jobType); add(page({ pageType:'job-type', canonicalPath:`/jobs/type/${slug(jobType)}`, jobType:name, intent:'Job-type discovery', title:`${name} Jobs | SkillOnIT Employment`, description:`Explore current ${name.toLowerCase()} jobs on SkillOnIT Employment. Browse roles, locations and application options.`, h1:`${name} Jobs`, topics:['jobs',name], jobCount:list.length, jobs:list }, generatedAt)); }
  if (remote.length >= MIN_FACET) add(page({ pageType:'remote', canonicalPath:'/jobs/remote', workArrangement:'Remote', intent:'Remote job discovery', title:'Remote Jobs | SkillOnIT Employment', description:'Explore current remote jobs on SkillOnIT Employment. Browse relevant roles and application options.', h1:'Remote Jobs', topics:['jobs','remote'], jobCount:remote.length, jobs:remote }, generatedAt));
  for(const [workArrangement,list] of arrangements)if(list.length>=MIN_FACET)add(page({pageType:'work-arrangement',canonicalPath:`/jobs/work-arrangement/${slug(workArrangement)}`,workArrangement,intent:'Work-arrangement discovery',title:`${workArrangement} Jobs | SkillOnIT Employment`,description:`Explore current ${workArrangement.toLowerCase()} jobs on SkillOnIT Employment. Browse relevant roles, locations and application options.`,h1:`${workArrangement} Jobs`,topics:['jobs',workArrangement],jobCount:list.length,jobs:list},generatedAt));
  for(const [experienceLevel,list] of experience)if(list.length>=MIN_FACET)add(page({pageType:'experience',canonicalPath:`/jobs/experience/${slug(experienceLevel)}`,experienceLevel,intent:'Experience-level discovery',title:`${experienceLevel} Jobs | SkillOnIT Employment`,description:`Explore current jobs with structured ${experienceLevel.toLowerCase()} experience requirements on SkillOnIT Employment.`,h1:`${experienceLevel} Jobs`,topics:['jobs',experienceLevel],jobCount:list.length,jobs:list},generatedAt));
  pages.sort((a,b)=>a.canonicalPath.localeCompare(b.canonicalPath));
  const eligibleJobIds=current.filter(isSeoJobEligible).map(job=>job.id).sort();
  return { generatedAt, expiresAt:new Date(Date.parse(generatedAt)+TTL_MS).toISOString(), referenceCountries:countryEntries.length, countriesWithJobs:countries.size, approvedCountries:pages.filter(item=>item.pageType==='country').length, pages, eligibleJobIds, noindexJobs:current.length-eligibleJobIds.length, duplicatesPrevented, totalJobs:jobs.length, scannedJobs:jobs.length, truncated };
}

let cached: { value: SeoRegistry; expires: number } | undefined;
let pending: Promise<SeoRegistry> | undefined;
export function invalidateSeoRegistry() { cached = undefined; }
export async function seoRegistry(force = false) {
  if (!force && cached && cached.expires > Date.now()) return cached.value;
  if (pending) return pending;
  pending = read(async (r) => {
    const totalJobs=await r.count('jobs',{}),jobs: Job[] = []; let after='';
    while (jobs.length < MAX_SCAN) { const batch=await r.scan<Job>('jobs',{status:'published',trust:'verified',sample:{$ne:true},expiresAt:{$gt:new Date().toISOString()}},after,500); if (!batch.length) break; jobs.push(...batch); after=batch.at(-1)!.id; if(batch.length<500) break; }
    const loadCatalog=async(collection:string)=>{const rows:CatalogItem[]=[];let cursor='';while(rows.length<10_000){const batch=await r.scan<CatalogItem>(collection,{active:true},cursor,500);if(!batch.length)break;rows.push(...batch);cursor=batch.at(-1)!.id;if(batch.length<500)break;}return rows;};
    const [skills,occupations]=await Promise.all([loadCatalog('skills'),loadCatalog('occupationFamilies')]);
    const value=buildSeoRegistry(jobs,new Date().toISOString(),jobs.length>=MAX_SCAN,{skills,occupations}); value.totalJobs=totalJobs; value.noindexJobs=Math.max(0,totalJobs-value.eligibleJobIds.length); cached={value,expires:Date.now()+TTL_MS}; return value;
  }).finally(()=>{pending=undefined;});
  return pending;
}
export async function seoPage(path: string): Promise<{ page: SeoRegistryPage; jobs: PublicJob[] } | null> {
  const registry=await seoRegistry(), page=registry.pages.find(item=>item.canonicalPath===path && item.indexable); if(!page)return null;
  const plans=await configuredPlans();
  const jobs=await read(async r=>(await Promise.all(page.jobIds.map(id=>r.get<Job>('jobs',id)))).filter((job):job is Job=>Boolean(job)&&isRecent(job!)&&job!.status==='published').map(job=>publicJob(job,null,plans)));
  return {...{page:{...page,jobIds:[]}},jobs};
}
