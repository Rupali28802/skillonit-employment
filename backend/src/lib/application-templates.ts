import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Job, User } from './domain.js';
import type { Repository } from './store.js';
import { read, transaction } from './store.js';
import { ApiError, audit } from './security.js';

export const applicationTemplateSchema = z.object({
  templateName: z.string().trim().min(1).max(100),
  applicationType: z.enum(['email', 'general']).default('email'),
  subjectTemplate: z.string().trim().min(1).max(300),
  bodyTemplate: z.string().trim().min(10).max(6000),
  signature: z.string().max(1000).default(''),
  attachCv: z.boolean().default(true),
  attachCoverLetter: z.boolean().default(false),
  aiPersonalizationEnabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
}).strict();

export type ApplicationTemplate = z.infer<typeof applicationTemplateSchema> & {
  id: string; userId: string; createdAt: string; updatedAt: string;
};

type TemplateVersion = Pick<ApplicationTemplate, 'userId'|'templateName'|'applicationType'|'subjectTemplate'|'bodyTemplate'|'signature'|'attachCv'|'attachCoverLetter'|'aiPersonalizationEnabled'|'isDefault'|'status'> & {
  id: string; templateId: string; createdAt: string;
};

const placeholders = ['jobTitle','companyName','candidateName','candidateEmail','candidatePhone','candidateLocation','relevantSkills','location','candidateHeadline'] as const;
const legacy: Record<string, typeof placeholders[number]> = { name: 'candidateName', job_title: 'jobTitle' };
export const supportedApplicationPlaceholders = placeholders.map(value => `{{${value}}}`);

function assertSafeTemplate(value: Pick<ApplicationTemplate, 'subjectTemplate'|'bodyTemplate'|'signature'>) {
  for (const text of [value.subjectTemplate, value.bodyTemplate, value.signature]) {
    for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const key = legacy[match[1]!] ?? match[1];
      if (!placeholders.includes(key as typeof placeholders[number])) throw new ApiError(400, 'INVALID_VARIABLE', `Unsupported placeholder {{${match[1]}}}.`);
    }
    if (/\{[{%]|[%}]\}/.test(text.replace(/\{\{\s*[A-Za-z_]+\s*\}\}/g, ''))) throw new ApiError(400, 'UNSAFE_TEMPLATE', 'Template expressions are not supported.');
  }
}

const normalizeLegacy = (row: Record<string, unknown>, userId: string): ApplicationTemplate => {
  const now = String(row.updatedAt ?? new Date().toISOString());
  return {
    ...applicationTemplateSchema.parse({
      templateName: row.templateName ?? 'Default application', applicationType: row.applicationType ?? 'email',
      subjectTemplate: row.subjectTemplate ?? row.subject ?? 'Application for {{jobTitle}} - {{candidateName}}',
      bodyTemplate: row.bodyTemplate ?? row.body ?? 'I am applying for {{jobTitle}} at {{companyName}}.',
      signature: row.signature ?? '', attachCv: row.attachCv ?? true, attachCoverLetter: row.attachCoverLetter ?? false,
      aiPersonalizationEnabled: row.aiPersonalizationEnabled ?? true, isDefault: row.isDefault ?? true, status: row.status ?? 'enabled',
    }), id: String(row.id ?? userId), userId, createdAt: String(row.createdAt ?? now), updatedAt: now,
  };
};

export async function listApplicationTemplates(userId:string, r?:Repository) {
  const run=async(repo:Repository)=> (await repo.find<Record<string,unknown>>('applicationTemplates',{userId},100)).map(row=>normalizeLegacy(row,userId)).sort((a,b)=>Number(b.isDefault)-Number(a.isDefault)||b.updatedAt.localeCompare(a.updatedAt));
  const rows=r?await run(r):await read(run);
  const old=r?await r.get<Record<string,unknown>>('applicationTemplates',userId):await read(repo=>repo.get<Record<string,unknown>>('applicationTemplates',userId));
  const legacyRow=old?normalizeLegacy(old,userId):null;
  const combined=legacyRow&&!rows.some(row=>row.id===legacyRow.id)?[...rows,legacyRow]:rows;
  return combined.sort((a,b)=>Number(b.isDefault)-Number(a.isDefault)||b.updatedAt.localeCompare(a.updatedAt));
}

export async function resolveApplicationTemplate(r:Repository,userId:string,templateId?:string){
  const templates=await listApplicationTemplates(userId,r);
  const selected=templateId?templates.find(row=>row.id===templateId):templates.find(row=>row.isDefault&&row.status==='enabled')??templates.find(row=>row.status==='enabled');
  if(templateId&&!selected)throw new ApiError(404,'TEMPLATE_NOT_FOUND','Application template not found.');
  if(selected&&selected.status!=='enabled')throw new ApiError(409,'TEMPLATE_DISABLED','Enable the selected application template first.');
  return selected??null;
}

async function recordTemplateVersion(r:Repository,template:ApplicationTemplate) {
  const version:TemplateVersion={
    id:randomUUID(),templateId:template.id,userId:template.userId,templateName:template.templateName,
    applicationType:template.applicationType,subjectTemplate:template.subjectTemplate,bodyTemplate:template.bodyTemplate,
    signature:template.signature,attachCv:template.attachCv,attachCoverLetter:template.attachCoverLetter,
    aiPersonalizationEnabled:template.aiPersonalizationEnabled,isDefault:template.isDefault,status:template.status,
    createdAt:template.updatedAt,
  };
  await r.put('templateVersions',version);
}

export async function createApplicationTemplate(user:User,input:unknown){
  const data=applicationTemplateSchema.parse(input);assertSafeTemplate(data as ApplicationTemplate);
  return transaction(async r=>{const existing=await listApplicationTemplates(user.id,r),now=new Date().toISOString();const row:ApplicationTemplate={...data,id:randomUUID(),userId:user.id,isDefault:data.isDefault||existing.length===0,createdAt:now,updatedAt:now};if(row.isDefault)for(const item of existing.filter(v=>v.isDefault))await r.put('applicationTemplates',{...item,isDefault:false,updatedAt:now});await r.put('applicationTemplates',row);await recordTemplateVersion(r,row);await audit(r,user.id,'application_template.created',row.id);return row;});
}

export async function updateApplicationTemplate(user:User,id:string,input:unknown){
  const data=applicationTemplateSchema.parse(input);assertSafeTemplate(data as ApplicationTemplate);
  return transaction(async r=>{const rows=await listApplicationTemplates(user.id,r),current=rows.find(row=>row.id===id);if(!current)throw new ApiError(404,'TEMPLATE_NOT_FOUND','Application template not found.');const now=new Date().toISOString(),next={...current,...data,updatedAt:now};if(next.isDefault)for(const item of rows.filter(v=>v.id!==id&&v.isDefault))await r.put('applicationTemplates',{...item,isDefault:false,updatedAt:now});await r.put('applicationTemplates',next);await recordTemplateVersion(r,next);await audit(r,user.id,'application_template.updated',id);return next;});
}

export async function deleteApplicationTemplate(user:User,id:string){
  return transaction(async r=>{const rows=await listApplicationTemplates(user.id,r),current=rows.find(row=>row.id===id);if(!current)throw new ApiError(404,'TEMPLATE_NOT_FOUND','Application template not found.');await r.remove('applicationTemplates',id);const remaining=rows.filter(row=>row.id!==id);if(current.isDefault&&remaining.length){const replacement=remaining.find(row=>row.status==='enabled')??remaining[0]!;await r.put('applicationTemplates',{...replacement,isDefault:true,updatedAt:new Date().toISOString()});}await audit(r,user.id,'application_template.deleted',id);return {deleted:true};});
}

export async function duplicateApplicationTemplate(user:User,id:string){const original=(await listApplicationTemplates(user.id)).find(row=>row.id===id);if(!original)throw new ApiError(404,'TEMPLATE_NOT_FOUND','Application template not found.');const {templateName,applicationType,subjectTemplate,bodyTemplate,signature,attachCv,attachCoverLetter,aiPersonalizationEnabled,status}=original;return createApplicationTemplate(user,{templateName:`${templateName} copy`,applicationType,subjectTemplate,bodyTemplate,signature,attachCv,attachCoverLetter,aiPersonalizationEnabled,status,isDefault:false});}

export function renderApplicationTemplate(template:ApplicationTemplate,user:User,job:Job){
  const haystack=`${job.title} ${job.skills.join(' ')} ${job.description} ${job.requirements}`.toLowerCase();
  const relevant=user.profile.skills.filter(skill=>haystack.includes(skill.toLowerCase()));
  const confirmedPhone=user.profile.contactInfo?.match(/(?:\+?\d[\d\s().-]{6,}\d)/)?.[0]?.trim()??'';
  const values:Record<string,string>={jobTitle:job.title,companyName:job.company,candidateName:user.profile.name||user.name,candidateEmail:user.email,candidatePhone:confirmedPhone,candidateLocation:[user.profile.city,user.profile.country].filter(Boolean).join(', '),relevantSkills:relevant.join(', '),location:[job.city,job.state,job.country].filter(Boolean).join(', '),candidateHeadline:user.profile.headline};
  const replace=(text:string)=>text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_,raw:string)=>values[legacy[raw]??raw]??'');
  const required=new Set<string>();for(const text of [template.subjectTemplate,template.bodyTemplate,template.signature])for(const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)){const key=legacy[match[1]!]??match[1]!;if(!values[key]?.trim())required.add(key);}
  return {subject:replace(template.subjectTemplate).trim(),text:[replace(template.bodyTemplate).trim(),replace(template.signature).trim()].filter(Boolean).join('\n\n'),personalizationStatus:required.size?'NEEDS_REVIEW':'READY',missingFacts:[...required]};
}
