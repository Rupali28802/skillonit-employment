'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  BriefcaseBusiness,
  Camera,
  Check,
  FileText,
  GraduationCap,
  Mail,
  MapPin,
  Pencil,
  ShieldCheck,
  Target,
  UserRound,
} from 'lucide-react';
import type { Preferences, User } from '@/lib/domain';
import { GmailConnection, type MailboxStatus } from './candidate-tools';
import { ProfileSetup, type ProfileEditSection } from './profile-setup';

type Completion = { percentage: number; missingFields: string[]; readinessStatus: string };
type CvDocument = { id: string; originalName?: string; name?: string; status?: string; createdAt?: string; size?: number };
type Consent = { purpose: string; granted: boolean; policyVersion: string; updatedAt: string };
type ProfileSection = 'about' | 'skills' | 'experience' | 'education' | 'occupation' | 'job-preferences' | 'documents' | 'gmail' | 'privacy';
const profileSections: { key: ProfileSection; label: string }[] = [
  { key: 'about', label: 'About' }, { key: 'skills', label: 'Skills' },
  { key: 'experience', label: 'Experience' }, { key: 'education', label: 'Education' },
  { key: 'occupation', label: 'Occupation' }, { key: 'job-preferences', label: 'Job Preferences' },
  { key: 'documents', label: 'CV / Resume' }, { key: 'gmail', label: 'Gmail' },
  { key: 'privacy', label: 'Privacy' },
];

const humanize = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ');

function Empty({ icon: Icon, title, text }: { icon: typeof BriefcaseBusiness; title: string; text: string }) {
  return <div className="profile-dash-empty"><span><Icon size={27} /></span><strong>{title}</strong><p>{text}</p></div>;
}

export function ProfileDashboard({ user, completion, preferences, mailbox, documents, consents }: {
  user: User;
  completion: Completion;
  preferences: Preferences;
  mailbox: MailboxStatus;
  documents: CvDocument[];
  consents: Consent[];
}) {
  const [editing, setEditing] = useState<ProfileEditSection | null>(null);
  const [activeSection, setActiveSection] = useState<ProfileSection>('about');
  const [imageEditor, setImageEditor] = useState<'avatar' | 'cover' | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [imageMessage, setImageMessage] = useState('');
  const [imageError, setImageError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const profile = user.profile;
  const initials = (profile.name || user.name).split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const location = [profile.city, profile.region, profile.country].filter(Boolean).join(', ');
  const confirmedCvs = documents.filter((document) => document.status === 'confirmed');
  const image = (kind: 'avatar' | 'cover') => `/api/v1/me/profile-image/${kind}?v=${profile[`${kind}Version`] || ''}`;
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    const syncHash = () => {
      const value = window.location.hash.replace('#profile-', '') as ProfileSection;
      if (profileSections.some(section => section.key === value)) setActiveSection(value);
    };
    syncHash(); window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  function openEditor(section: ProfileEditSection) {
    setEditing(section);
    window.requestAnimationFrame(() => document.querySelector('.profile-dash-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function closeImageEditor() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImageEditor(null); setSelectedImage(null); setPreviewUrl(''); setImageMessage(''); setImageError(false);
  }
  function chooseImage(file?: File) {
    setImageMessage(''); setImageError(false);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setImageError(true); setImageMessage('Choose a JPG, PNG or WebP image.'); return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setImageError(true); setImageMessage('The image must be smaller than 2 MB.'); return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedImage(file); setPreviewUrl(URL.createObjectURL(file));
  }
  async function saveImage() {
    if (!imageEditor || !selectedImage) return;
    setImageBusy(true); setImageMessage(''); setImageError(false);
    try {
      const response = await fetch(`/api/v1/me/profile-image/${imageEditor}`, { method:'PUT', headers:{'Content-Type':selectedImage.type}, body:selectedImage });
      const result = await response.json();
      if (!response.ok) throw Error(result.error?.message || 'The image could not be saved.');
      setImageMessage(imageEditor === 'avatar' ? 'Profile photo saved.' : 'Cover photo saved.');
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) { setImageError(true); setImageMessage(error instanceof Error ? error.message : 'The image could not be saved.'); setImageBusy(false); }
  }
  async function removeImage() {
    if (!imageEditor) return;
    setImageBusy(true); setImageMessage(''); setImageError(false);
    try {
      const response = await fetch(`/api/v1/me/profile-image/${imageEditor}`, { method:'DELETE' });
      if (!response.ok) throw Error('The image could not be removed.');
      setImageMessage(imageEditor === 'avatar' ? 'Profile photo removed.' : 'Cover photo removed.');
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) { setImageError(true); setImageMessage(error instanceof Error ? error.message : 'The image could not be removed.'); setImageBusy(false); }
  }
  const checks = [
    ['Basic information', Boolean(profile.name && profile.headline)],
    ['Education & qualifications', Boolean(profile.education)],
    ['Skills', profile.skills.length > 0],
    ['Job preferences', preferences.roles.length > 0],
  ] as const;

  return <div className="profile-dashboard">
    <div className="profile-dashboard-top">
      <section className="profile-dash-identity">
        <div className="profile-dash-cover">
          {profile.coverVersion && <Image src={image('cover')} alt="Profile cover" fill unoptimized sizes="900px" />}
          <div className="profile-dash-cover-shape" />
          <button className="profile-image-camera cover-camera" type="button" aria-label="Edit cover photo" onClick={() => { setImageEditor('cover'); setImageMessage(''); }}><Camera size={17}/><span>Edit cover</span></button>
        </div>
        <div className="profile-dash-person">
          <div className="profile-dash-avatar">
            {profile.avatarVersion ? <Image src={image('avatar')} alt={`${user.name}'s profile photo`} width={104} height={104} unoptimized /> : <span>{initials}</span>}
            <button className="profile-image-camera avatar-camera" type="button" aria-label="Edit profile photo" onClick={() => { setImageEditor('avatar'); setImageMessage(''); }}><Camera size={16}/></button>
          </div>
          <div className="profile-dash-name">
            <h2>{profile.name || user.name} {user.verified && <BadgeCheck size={18} aria-label="Verified account" />}</h2>
            <p>{profile.headline || 'Add your professional headline'}</p>
            <div>{location && <span><MapPin size={14} />{location}</span>}<span><Mail size={14} />{user.email.replace(/^(.{2}).+(@.*)$/, '$1******$2')}</span></div>
            <small>{user.role === 'student' ? 'Student / candidate' : user.role}</small>
          </div>
          <button className="secondary profile-dash-edit" type="button" onClick={() => setEditing((value) => value ? null : 'all')}><Pencil size={15} /> {editing ? 'Close Editor' : 'Edit Profile'}</button>
        </div>
      </section>

      <section className="profile-dash-completion">
        <h2>Profile Completion</h2>
        <div className="profile-completion-body">
          <div className="profile-completion-ring" style={{'--completion': `${completion.percentage * 3.6}deg`} as React.CSSProperties}><span>{completion.percentage}%</span></div>
          <div><strong>{completion.percentage >= 80 ? "You're almost there!" : 'Build a complete profile'}</strong><p>Complete your profile to improve matching and application readiness.</p></div>
        </div>
        <div className="profile-checks">{checks.map(([label, complete]) => <span className={complete ? 'complete' : ''} key={label}><i>{complete ? <Check size={12} /> : null}</i>{label}</span>)}</div>
      </section>
    </div>

    {imageEditor && <div className="profile-image-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !imageBusy) closeImageEditor(); }}>
      <dialog className="profile-image-dialog" open aria-labelledby="profile-image-title">
        <div className="profile-dash-card-head"><div><Camera size={20}/><h2 id="profile-image-title">{imageEditor === 'avatar' ? 'Profile photo' : 'Cover photo'}</h2></div><button type="button" disabled={imageBusy} onClick={closeImageEditor}>Close</button></div>
        <div className={`profile-image-preview ${imageEditor}`}>
          {previewUrl ? <Image src={previewUrl} alt="Selected image preview" fill unoptimized sizes="500px" /> : profile[`${imageEditor}Version`] ? <Image src={image(imageEditor)} alt={`Current ${imageEditor} photo`} fill unoptimized sizes="500px" /> : <span>{imageEditor === 'avatar' ? initials : <Camera size={32}/>}</span>}
        </div>
        <p className="small">JPG, PNG or WebP · maximum 2 MB. The image is cropped to fit the {imageEditor === 'avatar' ? 'circular profile area' : 'wide cover area'}.</p>
        <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value=''; }} />
        <div className="profile-image-options">
          <button className="secondary" type="button" disabled={imageBusy} onClick={() => fileInput.current?.click()}><Camera size={15}/> {selectedImage ? 'Choose another file' : 'Upload Photo / Choose File'}</button>
          {profile[`${imageEditor}Version`] && <button className="profile-image-remove" type="button" disabled={imageBusy} onClick={() => void removeImage()}>Remove Photo</button>}
        </div>
        {imageMessage && <p className={`notice ${imageError ? 'error' : ''}`} aria-live="polite">{imageMessage}</p>}
        <div className="profile-image-dialog-actions"><button className="secondary" type="button" disabled={imageBusy} onClick={closeImageEditor}>Cancel</button><button className="primary" type="button" disabled={imageBusy || !selectedImage} onClick={() => void saveImage()}>{imageBusy ? 'Saving…' : 'Save Photo'}</button></div>
      </dialog>
    </div>}

    {editing && <section className="profile-dash-editor">
      <div className="profile-dash-card-head"><div><span>EDIT PROFILE</span><h2>Update your professional information</h2></div><button className="secondary" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
      <ProfileSetup key={editing} user={user} completion={completion} editingOnly section={editing} />
    </section>}

    <nav className="profile-dash-tabs" aria-label="Profile sections">
      {profileSections.map(section => <a className={activeSection === section.key ? 'active' : ''} aria-current={activeSection === section.key ? 'location' : undefined} href={`#profile-${section.key}`} onClick={() => setActiveSection(section.key)} key={section.key}>{section.label}</a>)}
    </nav>

    <div className="profile-dash-grid">
      <div className="profile-dash-main">
        <section className="profile-dash-card" id="profile-about">
          <div className="profile-dash-card-head"><div><UserRound size={20}/><h2>About Me</h2></div><button type="button" onClick={() => openEditor('about')}><Pencil size={13}/> Edit</button></div>
          {profile.headline || profile.industry || profile.availability ? <p className="profile-dash-copy">{[profile.headline, profile.industry, profile.availability].filter(Boolean).join(' · ')}</p> : <p className="profile-dash-muted">Add a confirmed professional headline, industry and availability to introduce yourself.</p>}
        </section>

        <section className="profile-dash-card" id="profile-skills">
          <div className="profile-dash-card-head"><div><Target size={20}/><h2>Skills</h2></div><button type="button" onClick={() => openEditor('skills')}><Pencil size={13}/> Edit</button></div>
          {profile.skills.length ? <div className="profile-dash-tags">{profile.skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : <p className="profile-dash-muted">No confirmed skills added yet.</p>}
        </section>

        <section className="profile-dash-card" id="profile-experience">
          <div className="profile-dash-card-head"><div><BriefcaseBusiness size={20}/><h2>Work Experience</h2></div><button type="button" onClick={() => openEditor('experience')}><Pencil size={13}/> Edit</button></div>
          {profile.employmentHistory?.length ? <div className="profile-dash-timeline">{profile.employmentHistory.map((item, index) => <article key={`${item.employer}-${index}`}><i/><div><h3>{item.title}</h3><strong>{item.employer}</strong><small>{[item.start,item.end].filter(Boolean).join(' – ')}</small>{item.description && <p>{item.description}</p>}</div></article>)}</div> : <Empty icon={BriefcaseBusiness} title="No work experience added yet" text="Add confirmed experience to showcase your skills and past roles." />}
        </section>

        <section className="profile-dash-card" id="profile-documents">
          <div className="profile-dash-card-head"><div><FileText size={20}/><h2>CV / Resume</h2></div><Link href="/cvs"><Pencil size={13}/> Manage</Link></div>
          {documents.length ? documents.slice(0,3).map((document) => <div className="profile-dash-document" key={document.id}><span><FileText size={20}/></span><div><strong>{document.originalName || document.name || 'CV document'}</strong><small>{humanize(document.status || 'processing')}{document.createdAt ? ` · ${new Date(document.createdAt).toLocaleDateString('en-IN')}` : ''}</small></div><Link href="/cvs">View</Link></div>) : <p className="profile-dash-muted">No CV uploaded yet. Upload a CV to create a reviewable profile draft.</p>}
          {confirmedCvs.length > 0 && <p className="profile-cv-ready"><Check size={14}/> A confirmed CV is ready for eligible applications.</p>}
        </section>

        <section className="profile-dash-card profile-dash-gmail" id="profile-gmail"><div className="profile-dash-card-head"><div><Mail size={20}/><h2>Gmail Connection</h2></div></div><GmailConnection initial={mailbox} compact /></section>
      </div>

      <aside className="profile-dash-side">
        <section className="profile-dash-card" id="profile-preferences">
          <div className="profile-dash-card-head"><div><MapPin size={20}/><h2>Location &amp; Job Preferences</h2></div><Link href="/preferences"><Pencil size={13}/> Edit</Link></div>
          <dl className="profile-dash-facts"><div><dt>Location</dt><dd>{location || 'Not set'}</dd></div><div><dt>Preferred roles</dt><dd>{preferences.roles.join(', ') || 'Not set'}</dd></div><div><dt>Preferred work mode</dt><dd>{preferences.modes.join(', ') || 'Not set'}</dd></div><div><dt>Preferred countries</dt><dd>{preferences.countries.join(', ') || 'Not set'}</dd></div></dl>
        </section>

        <section className="profile-dash-card" id="profile-education">
          <div className="profile-dash-card-head"><div><GraduationCap size={20}/><h2>Education &amp; Qualifications</h2></div><button type="button" onClick={() => openEditor('education')}><Pencil size={13}/> Edit</button></div>
          {profile.education ? <p className="profile-dash-copy">{profile.education}</p> : <p className="profile-dash-muted">No confirmed education added yet.</p>}
          {!!profile.certifications?.length && <div className="profile-dash-tags">{profile.certifications.map((item) => <span key={item}>{item}</span>)}</div>}
        </section>

        <section className="profile-dash-card" id="profile-occupation">
          <div className="profile-dash-card-head"><div><BriefcaseBusiness size={20}/><h2>Occupation</h2></div><button type="button" onClick={() => openEditor('occupation')}><Pencil size={13}/> Edit</button></div>
          <dl className="profile-dash-facts"><div><dt>Target role</dt><dd>{profile.targetRole || 'Not set'}</dd></div><div><dt>Industry</dt><dd>{profile.industry || 'Not set'}</dd></div><div><dt>Experience</dt><dd>{profile.experience === null ? 'Not set' : `${profile.experience} years`}</dd></div></dl>
        </section>

        <section className="profile-dash-card" id="profile-job-preferences">
          <div className="profile-dash-card-head"><div><Target size={20}/><h2>Job Preferences</h2></div><Link href="/preferences"><Pencil size={13}/> Edit</Link></div>
          <div className="profile-dash-tags">{preferences.roles.map((role) => <span key={role}>{role}</span>)}{preferences.modes.map((mode) => <span key={mode}>{mode}</span>)}</div>
          {!preferences.roles.length && !preferences.modes.length && <p className="profile-dash-muted">No job preferences saved yet.</p>}
        </section>

        <section className="profile-dash-card" id="profile-privacy">
          <div className="profile-dash-card-head"><div><ShieldCheck size={20}/><h2>Privacy &amp; Consent</h2></div><Link href="/settings"><Pencil size={13}/> Edit</Link></div>
          <div className="profile-dash-consents">{consents.length ? consents.slice(0,5).map((consent) => <span key={consent.purpose} className={consent.granted ? 'granted' : ''}><i>{consent.granted && <Check size={12}/>}</i>{humanize(consent.purpose)}</span>) : <p className="profile-dash-muted">Review privacy and consent settings.</p>}</div>
        </section>
      </aside>
    </div>
  </div>;
}
