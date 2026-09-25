'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { User } from '@/lib/domain';
import { SmartForm } from './forms';

type Completion = { percentage: number; missingFields: string[]; readinessStatus: string };
export type ProfileEditSection = 'all' | 'about' | 'skills' | 'experience' | 'education' | 'occupation';

const labels: Record<string, string> = {
  name: 'Full name', headline: 'Professional headline', skills: 'Skills', experience: 'Total experience',
  education: 'Education', country: 'Country', city: 'City', employmentHistory: 'Work experience',
};

const profileFields = [
  {name:'name',label:'Full name *'}, {name:'contactInfo',label:'Contact information',required:false},
  {name:'headline',label:'Professional headline *'}, {name:'targetRole',label:'Target role',required:false},
  {name:'industry',label:'Industry',required:false}, {name:'experience',label:'Total years of experience',type:'number',required:false},
  {name:'skills',label:'Skills *',type:'list',hint:'Separate items with commas'},
  {name:'education',label:'Education *',type:'textarea'},
  {name:'certifications',label:'Certifications',type:'list',required:false},
  {name:'projects',label:'Projects',type:'list',required:false},
  {name:'professionalLinks',label:'LinkedIn, GitHub and portfolio HTTPS links',type:'list',required:false},
  {name:'languages',label:'Languages and explicit proficiency',type:'list',required:false},
  {name:'country',label:'Country *'}, {name:'region',label:'State / region',required:false}, {name:'city',label:'City *'},
  {name:'availability',label:'Availability / notice period',required:false}, {name:'relocation',label:'Relocation preference',required:false},
  {name:'confirmed',label:'I reviewed and confirm these facts are accurate.',type:'checkbox',required:false},
] as const;
const fieldsBySection: Record<ProfileEditSection, readonly string[]> = {
  all: profileFields.map(field => field.name),
  about: ['name','contactInfo','headline','industry','languages','projects','professionalLinks','availability'],
  skills: ['skills'],
  experience: ['experience'],
  education: ['education','certifications'],
  occupation: ['targetRole','industry','experience'],
};
const sectionTitle: Record<ProfileEditSection, string> = {
  all: 'Update your confirmed profile', about: 'Edit about information', skills: 'Edit skills',
  experience: 'Edit experience', education: 'Edit education and qualifications', occupation: 'Edit occupation',
};

export function ProfileSetup({ user, completion, editingOnly = false, section = 'all' }: { user: User; completion: Completion; editingOnly?: boolean; section?: ProfileEditSection }) {
  const [path, setPath] = useState<'choose' | 'manual'>(editingOnly || user.profile.confirmed ? 'manual' : 'choose');
  const revision = user.profileRevision ?? 0;
  const profile = user.profile;
  const visibleNames = new Set(fieldsBySection[section]);
  const visibleFields = profileFields.filter(field => visibleNames.has(field.name));
  const preservedProfileFields = Object.fromEntries(profileFields.filter(field => !visibleNames.has(field.name)).map(field => [field.name, profile[field.name as keyof typeof profile]]));
  return <div className="stack">
    {!editingOnly && <div className="panel">
      <div className="section-line"><div><span className="pill">{completion.readinessStatus.replaceAll('_', ' ')}</span><h2 style={{marginTop: 12}}>Profile completion</h2></div><strong style={{fontSize: 28}}>{completion.percentage}%</strong></div>
      <progress value={completion.percentage} max={100} style={{width:'100%', height:14}} aria-label={`Profile ${completion.percentage}% complete`} />
      {completion.missingFields.length > 0 && <p><strong>Missing:</strong> {completion.missingFields.map(field => labels[field] || field).join(', ')}</p>}
      <p className="small">Only information you confirm is available to matching and applications.</p>
    </div>}
    {!editingOnly && path === 'choose' && <div className="panel">
      <h2>How would you like to build your profile?</h2>
      <p>You can upload a CV for a reviewable draft, or enter your details manually. Missing information can always be added later.</p>
      <div className="actions"><Link className="primary" href="/cvs">Upload Resume / CV</Link><button className="secondary" onClick={() => setPath('manual')}>Fill Profile Manually</button></div>
    </div>}
    {path === 'manual' && <div className={editingOnly ? 'profile-dash-form' : 'panel'}>
      <div className="section-line"><div><h2>{editingOnly ? sectionTitle[section] : profile.confirmed ? 'Update your confirmed profile' : 'Fill profile manually'}</h2><p>Leave unknown fields empty. Save without confirmation to keep a draft.</p></div>{!editingOnly && !profile.confirmed && <button className="secondary" onClick={() => setPath('choose')}>Back</button>}</div>
      <SmartForm key={revision} endpoint="me/profile" method="PUT" initial={profile} expectedRevision={revision}
        preservedFields={{ ...preservedProfileFields, employmentHistory: profile.employmentHistory || [] }} submit={profile.confirmed ? 'Save profile' : 'Save profile draft'}
        successMessage="Profile created successfully"
        fields={[...visibleFields]} />
      <p className="small" style={{marginTop:16}}>Work history already saved on your profile is preserved. CV work history is reviewed before it becomes canonical.</p>
      <Link href="/preferences">Continue to job preferences →</Link>
    </div>}
  </div>;
}
