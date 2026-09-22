import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AuthForm, SmartForm } from '@/components/forms';
import { AuthRecovery } from '@/components/auth-recovery';
import { EmailConnectionVerification } from '@/components/email-connection';
import { Workspace } from '@/components/workspace';
import { PlansCarousel } from '@/components/plans-carousel';
import { demoMode, configuredPlans, currentUser } from '@/lib/api';
export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string[] }>;
}) {
  const section = (await params).page.join('/');
  return {
    title: section
      .split('/')
      .pop()!
      .replace(/^./, (c) => c.toUpperCase()),
    robots: ['about', 'trust', 'contact', 'pricing'].includes(section)
      ? undefined
      : { index: false, follow: false },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ page: string[] }>;
}) {
  const page = (await params).page.join('/');
  if (page === 'connect-email') return <EmailConnectionVerification />;
  if (page === 'verify-email' || page === 'resend-verification' || page === 'forgot-password' || page === 'reset-password')
    return <AuthRecovery key={page} mode={page} />;
  if (page === 'login' || page === 'register')
    return <AuthForm key={page} register={page === 'register'} demo={await demoMode()} />;
  if (
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
      'settings',
      'employer',
      'employer/organization',
      'employer/jobs',
      'employer/post',
      'employer/applicants',
      'employer/team',
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
    ].includes(page)
  )
    return <Workspace section={page} />;
  if (page === 'pricing') {
    const [plans, user] = await Promise.all([configuredPlans(), currentUser()]);
    return (
      <div className="page-wrap">
        <div className="eyebrow">A PLAN FOR YOUR NEXT CHAPTER</div>
        <h1 style={{ marginTop: 15 }}>Move forward at your pace.</h1>
        <p>
          Compare candidate plans. Paid subscriptions open after final pricing
          and payment verification are configured.
        </p>
        <PlansCarousel plans={plans} currentPlan={user?.role === 'student' ? user.plan : null} />
        <p className="small">
          Displayed quotas are configurable development defaults, not a final
          commercial offer. Automation requires verified destinations, a
          confirmed profile, explicit consent and authorized mailbox access.
        </p>
      </div>
    );
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
        'This development preview uses local test data. Production privacy terms, retention schedules and jurisdiction-specific notices must be reviewed before launch.',
      sections: [
        [
          'Data used by the platform',
          'Account identity, candidate-confirmed experience, preferences and application events support the workflows you choose. Do not enter real sensitive documents into a demo.',
        ],
        [
          'Access and exports',
          'Your settings include an export of your profile and application records and a request for account deletion. Some production records may require retention for legal or audit obligations.',
        ],
        [
          'Email and automation',
          'Mailbox access must use OAuth and separate consent. No mailbox credentials should be placed in your profile, message or source code.',
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
        'This is a development preview. Final service terms and commercial policies require review before production launch.',
      sections: [
        [
          'Job discovery',
          'Sample vacancies are clearly marked and are not real hiring opportunities. Production vacancies require approved sources or verified employer submissions.',
        ],
        [
          'Candidate responsibility',
          'Provide truthful qualifications and confirm application facts. No hiring outcome is promised.',
        ],
        [
          'Subscriptions',
          'Final prices and billing periods are not configured. No plan should be advertised as paid or activated based only on a checkout redirect.',
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
