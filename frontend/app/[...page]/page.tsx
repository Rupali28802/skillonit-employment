import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AuthForm, SmartForm } from '@/components/forms';
import { AuthRecovery } from '@/components/auth-recovery';
import { EmailConnectionVerification } from '@/components/email-connection';
import { Workspace } from '@/components/workspace';
import { PublicPricing } from '@/components/public-pricing';
import { ReferralAttribution } from '@/components/referral-attribution';
import { demoMode, configuredPlans, currentUser } from '@/lib/api';
import { jobReturnPath } from '@/lib/auth-return';
export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string[] }>;
}) {
  const section = (await params).page.join('/');
  const publicSections = new Set(['about', 'trust', 'contact', 'pricing', 'privacy', 'terms']);
  const publicPage=publicSections.has(section);
  const label=section.split('/').pop()!.replace(/^./,(c)=>c.toUpperCase());
  return {
    title: label,
    ...(publicPage?{alternates:{canonical:`/${section}`},openGraph:{type:'website' as const,title:`${label} | SkillOnIT Employment`,url:`/${section}`,siteName:'SkillOnIT Employment'}}:{}),
    robots: publicPage ? {index:true,follow:true} : { index: false, follow: false },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ page: string[] }>;
  searchParams: Promise<{ ref?: string | string[]; returnToJob?: string | string[] }>;
}) {
  const page = (await params).page.join('/');
  const applicationTemplatesPage = /^applications\/templates(?:\/new|\/[^/]+\/edit)?$/.test(page);
  if (page === 'connect-email') return <EmailConnectionVerification />;
  if (page === 'verify-email' || page === 'resend-verification' || page === 'forgot-password' || page === 'reset-password')
    return <AuthRecovery key={page} mode={page} />;
  if (page === 'login' || page === 'register') {
    const referral = (await searchParams).ref;
    const code = typeof referral === 'string' ? referral : undefined;
    return <><ReferralAttribution code={page === 'register' ? code : undefined} /><AuthForm key={page} register={page === 'register'} demo={await demoMode()} /></>;
  }
  if (
    applicationTemplatesPage ||
    [
      'dashboard',
      'onboarding',
      'profile',
      'preferences',
      'saved',
      'alerts',
      'notifications',
      'assistant',
      'insights',
      'taxonomy',
      'cv-versions',
      'applications',
      'cvs',
      'templates',
      'mail',
      'automation',
      'billing',
      'referrals',
      'settings',
      'employer',
      'employer/organization',
      'employer/jobs',
      'employer/post',
      'employer/applicants',
      'employer/team',
      'employer/candidates',
      'employer/notifications',
      'employer/settings',
      'employer/billing',
      'admin',
      'admin/users',
      'admin/employers',
      'admin/jobs',
      'admin/sources',
      'admin/applications',
      'admin/fraud',
      'admin/plans',
      'admin/payments',
      'admin/subscriptions',
      'admin/leads',
      'admin/content',
      'admin/flags',
      'admin/queues',
      'admin/notifications',
      'admin/health',
      'admin/matching',
      'admin/audit',
      'admin/roles',
      'admin/settings',
      'admin/privacy',
      'admin/referrals',
    ].includes(page)
  )
    return <Workspace section={page} returnToJob={jobReturnPath((await searchParams).returnToJob)} />;
  if (page === 'pricing') {
    const [plans, user] = await Promise.all([configuredPlans(), currentUser()]);
    return <PublicPricing plans={plans} currentPlan={user?.role === 'student' ? user.plan : null} role={user?.role} />;
  }
  if (page === 'contact')
    return (
      <div className="page-wrap prose">
        <div className="eyebrow">LET’S TALK</div>
        <h1 style={{ marginTop: 15 }}>How can we help?</h1>
        <p>
          Questions about your search, hiring or partnerships? Leave a message
          for the SkillonIT team.
        </p>
        <div className="panel">
          <SmartForm
            endpoint="contact"
            submit="Send message"
            fields={[
              { name: 'name', label: 'Your name' },
              { name: 'email', label: 'Email address', type: 'email' },
              { name: 'subject', label: 'Subject' },
              { name: 'message', label: 'Your message', type: 'textarea' },
              {
                name: 'consent',
                label: 'I agree to be contacted about this enquiry.',
                type: 'checkbox',
                required: true,
              },
            ]}
          />
        </div>
        <p>
          Email:{' '}
          <a href="mailto:skillonitemployment@gmail.com">
            skillonitemployment@gmail.com
          </a>
        </p>
      </div>
    );
  const content: Record<
    string,
    { title: string; intro: string; sections: [string, string][] }
  > = {
    about: {
      title: 'Opportunity should be easier to find.',
      intro:
        'SkillonIT brings job discovery, candidate preferences and application tracking into one considered workspace.',
      sections: [
        [
          'Find a role that fits',
          'Explore across industries and countries. Use skills, experience, location and work arrangement to narrow your search.',
        ],
        [
          'Stay in control',
          'Confirm your profile, choose the roles you want and review application progress. Automation requires your explicit permission and supported services.',
        ],
        [
          'Built for trust',
          'Job sources, employer verification and application methods are visible. Reporting tools help raise concerns with the moderation team.',
        ],
      ],
    },
    trust: {
      title: 'A safer next step.',
      intro:
        'Review every opportunity carefully. Verification reduces uncertainty but cannot guarantee an employer’s conduct or a hiring outcome.',
      sections: [
        [
          'Know where you are applying',
          'Check the source, vacancy details and employer application method. SkillonIT records opening an external website as started, never as a completed submission.',
        ],
        [
          'Keep money and credentials private',
          'Be cautious of recruitment fees, requests for account passwords, and suspicious links. Never share a mailbox password with a recruiter.',
        ],
        [
          'Report a concern',
          'Use the report control on a job detail page. Moderators can review the report and disable suspicious listings.',
        ],
        [
          'Your permission comes first',
          'Applications use only confirmed candidate facts. Email delivery requires an authorized mailbox, verified destination and explicit consent.',
        ],
      ],
    },
    privacy: {
      title: 'Your privacy and control.',
      intro:
        'Learn how Skillonit Employment uses your information to help you find jobs, manage your profile and prepare applications.',
      sections: [
        [
          'Data used by the platform',
          'The platform uses account details, job preferences, profile information and application activity to provide your workspace and support your applications. Upload only documents relevant to your job search.',
        ],
        [
          'Access and exports',
          'Use workspace settings to export your information or request account deletion. You can also review and change your consent choices.',
        ],
        [
          'Email and automation',
          'If you connect Gmail, Skillonit Employment requests permission to send email on your behalf. When you authorize an email application, the recipient receives your application message and any documents included with it. You can disconnect Gmail from your workspace.',
        ],
        [
          'Contact',
          'Questions about your data can be sent through the contact form.',
        ],
      ],
    },
    terms: {
      title: 'Platform terms and availability.',
      intro:
        'Skillonit Employment helps candidates discover vacancies, prepare applications and track their progress.',
      sections: [
        [
          'Job discovery',
          'Vacancies can change or close after they appear on the platform. Check the employer’s listing for current requirements and deadlines.',
        ],
        [
          'Candidate responsibility',
          'Provide truthful qualifications and confirm application facts. No hiring outcome is promised.',
        ],
        [
          'Subscriptions',
          'Review the plan details and any price and billing period shown before you subscribe.',
        ],
        [
          'Acceptable use',
          'Do not impersonate employers, submit fraudulent jobs, bypass access controls or use the platform for unsolicited bulk messaging.',
        ],
      ],
    },
  };
  const c = content[page];
  if (!c) notFound();
  return (
    <div className="page-wrap prose">
      <h1>{c.title}</h1>
      <p>{c.intro}</p>
      {c.sections.map(([title, text]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{text}</p>
        </section>
      ))}
      <Link className="primary" href="/contact">
        Contact SkillonIT
      </Link>
    </div>
  );
}
