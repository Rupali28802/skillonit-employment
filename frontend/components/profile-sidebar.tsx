'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Bookmark,
  BriefcaseBusiness,
  Camera,
  Code2,
  Crown,
  GraduationCap,
  HeartPulse,
  Landmark,
  Palette,
  Pencil,
  Users,
  Newspaper,
  CalendarDays,
  ChartNoAxesCombined,
} from 'lucide-react';
import type { User } from '@/lib/domain';

const themes = {
  technology: Code2,
  design: Palette,
  healthcare: HeartPulse,
  finance: Landmark,
  education: GraduationCap,
  business: BriefcaseBusiness,
};
type Theme = keyof typeof themes;
function profession(user: User | null): Theme {
  const saved = user?.profile.coverTheme;
  if (saved && saved in themes) return saved as Theme;
  const title =
    `${user?.profile.headline || ''} ${user?.profile.skills.join(' ') || ''}`.toLowerCase();
  if (/design|creative|figma|artist/.test(title)) return 'design';
  if (/nurse|doctor|health|medical/.test(title)) return 'healthcare';
  if (/finance|account|bank/.test(title)) return 'finance';
  if (/teach|education|professor/.test(title)) return 'education';
  if (/develop|engineer|software|data|react|tech/.test(title))
    return 'technology';
  return 'business';
}
export function ProfileSidebar({
  user: initialUser,
  editor = false,
}: {
  user: User | null;
  editor?: boolean;
}) {
  const [user, setUser] = useState(initialUser);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const theme = profession(user),
    ProfessionIcon = themes[theme];
  const profile = user?.profile;
  const editable = user?.role === 'student';
  const account = !user
    ? '/login'
    : user.role === 'student'
      ? '/profile'
      : '/' + user.role;
  const initials = (user?.name || 'Your profile')
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  async function refresh() {
    const response = await fetch('/api/v1/session');
    if (!response.ok) throw Error('Please sign in again.');
    setUser((await response.json()).data.user);
  }
  async function upload(kind: string, file?: File) {
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setMessage('Choose a JPG, PNG or WebP image under 2 MB.');
      return;
    }
    setBusy(kind);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/me/profile-image/${kind}`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const result = await response.json();
      if (response.status === 404) throw Error('Photo uploads are not supported by the connected backend yet. Your profile details can still be saved.');
      if (!response.ok) throw Error(result.error?.message || 'Upload failed.');
      await refresh();
      setMessage('Image saved to your profile.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function remove(kind: string) {
    setBusy(kind);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/me/profile-image/${kind}`, {
        method: 'DELETE',
      });
      if (response.status === 404) throw Error('Photo management is not supported by the connected backend yet.');
      if (!response.ok) throw Error('Could not remove image.');
      await refresh();
      setMessage('Image removed.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function changeTheme(coverTheme: string) {
    setBusy('theme');
    setMessage('');
    try {
      const response = await fetch('/api/v1/me/profile-appearance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverTheme }),
      });
      if (response.status === 404) throw Error('Saving cover themes is not supported by the connected backend yet.');
      if (!response.ok) throw Error('Could not save cover theme.');
      await refresh();
      setMessage('Profession theme saved.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  const photo = (kind: 'avatar' | 'cover' | 'logo') =>
    `/api/v1/me/profile-image/${kind}?v=${profile?.[`${kind}Version`] || ''}`;
  return (
    <aside
      className={`profile-sidebar${editor ? ' profile-editor' : ''}`}
      aria-label={editor ? 'Profile appearance' : 'Your professional profile'}
    >
      <section className="profile-identity profile-box">
        <div className={`profile-cover cover-${theme}`}>
          {profile?.coverVersion ? (
            <Image
              src={photo('cover')}
              alt="Your profile cover"
              fill
              unoptimized
              sizes="300px"
            />
          ) : (
            <>
              <div className="cover-lines" />
              <ProfessionIcon size={47} strokeWidth={1.3} />
              <span>{theme}</span>
            </>
          )}
        </div>
        <div className="profile-identity-body">
          <Link
            className="profile-avatar"
            href={account}
            aria-label="Open your profile"
          >
            {profile?.avatarVersion ? (
              <Image
                src={photo('avatar')}
                alt={`${user?.name}'s profile photo`}
                width={80}
                height={80}
                unoptimized
              />
            ) : (
              <span>{initials}</span>
            )}
          </Link>
          <Link
            className="profile-edit-link"
            href={account}
            aria-label="Edit profile"
          >
            <Pencil size={16} />
          </Link>
          <Link href={account} className="profile-name">
            {user?.name || 'Your next chapter'}
          </Link>
          <p className="profile-headline">
            {profile?.headline ||
              (user
                ? 'Add your professional headline'
                : 'Sign in to build your professional profile')}
          </p>
          <p className="profile-location">
            {[profile?.city, profile?.country].filter(Boolean).join(', ') ||
              'Add your location'}
          </p>
          <div className="profile-education">
            {profile?.logoVersion ? (
              <Image
                src={photo('logo')}
                alt="Education or company logo"
                width={32}
                height={32}
                unoptimized
              />
            ) : (
              <GraduationCap size={27} />
            )}
            <span>
              {profile?.education || 'Add education or qualifications'}
            </span>
          </div>
          {!user && (
            <Link className="primary full" href="/login">
              Sign in
            </Link>
          )}
          {user && (
            <details
              className="profile-photo-editor"
              open={editor || undefined}
            >
              <summary>
                <Camera size={15} /> Photos &amp; cover
              </summary>
              <p>JPG, PNG or WebP · up to 2 MB. Photos are cropped to fit.</p>
              {(['avatar', 'cover', 'logo'] as const).map((kind) => (
                <div className="profile-upload-row" key={kind}>
                  <label>
                    {kind === 'avatar'
                      ? 'Profile photo'
                      : kind === 'cover'
                        ? 'Cover image'
                        : 'Education / company logo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={!!busy}
                      onChange={(event) => {
                        void upload(kind, event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  {profile?.[`${kind}Version`] && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => void remove(kind)}
                    >
                      Remove {kind}
                    </button>
                  )}
                </div>
              ))}
              <label>
                Profession cover
                <select
                  value={profile?.coverTheme || 'auto'}
                  disabled={!!busy}
                  onChange={(event) => void changeTheme(event.target.value)}
                >
                  <option value="auto">Match my profession</option>
                  {Object.keys(themes).map((value) => (
                    <option key={value} value={value}>
                      {value[0].toUpperCase() + value.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              {profile?.coverVersion && (
                <p>Remove your uploaded cover to display a profession theme.</p>
              )}
            </details>
          )}
          <output className="profile-status">
            {busy ? 'Saving…' : message}
          </output>
        </div>
      </section>
      {!editor && (
        <>
          <Link href="/pricing" className="profile-box profile-premium">
            <span>Unlock Premium tools &amp; insights</span>
            <strong>
              <Crown size={19} />
              {user?.plan === 'premium'
                ? 'Your Premium plan'
                : 'Explore Premium'}
            </strong>
          </Link>
          <section className="profile-box profile-analytics">
            <div>
              <span>Profile viewers</span>
              <span title="Profile view tracking is not available yet">—</span>
            </div>
            <p>Profile view tracking is not available yet.</p>
            <Link
              href={
                user
                  ? user.role === 'student'
                    ? '/dashboard'
                    : '/' + user.role
                  : '/login'
              }
            >
              <ChartNoAxesCombined size={16} /> View your activity
            </Link>
          </section>
          <nav
            className="profile-box profile-shortcuts"
            aria-label="Profile shortcuts"
          >
            <Link href={editable ? '/saved' : '/login'}>
              <Bookmark size={18} fill="currentColor" /> Saved items
            </Link>
            {[
              { title: 'Groups', icon: Users },
              { title: 'Newsletters', icon: Newspaper },
              { title: 'Events', icon: CalendarDays },
            ].map(({ title, icon: Icon }) => (
              <details key={title}>
                <summary>
                  <Icon size={18} />
                  {title}
                </summary>
                <p>
                  {title} are not available yet. You can explore jobs and saved
                  opportunities now.
                </p>
              </details>
            ))}
          </nav>
        </>
      )}
    </aside>
  );
}
