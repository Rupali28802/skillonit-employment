import Link from 'next/link';
import { ArrowRight, Bot, Check, FileText, Mail, Rocket, Search, ShieldCheck, Sparkles, Target, Zap } from 'lucide-react';
import type { Plan, PlanCode } from '@/lib/domain';
import { Action } from './forms';

function amount(plan: Plan) {
  return plan.price === null ? 'Price unavailable' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: plan.currency, maximumFractionDigits: 0 }).format(plan.price);
}
function period(plan: Plan) {
  return ({ daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' } as Record<string, string>)[plan.billingPeriod || 'monthly'] || 'month';
}
function values(plan: Plan) {
  return [`${plan.dailyCap} / day`, plan.autoApply ? `${plan.autoApplyDailyCap ?? plan.dailyCap} / day` : 'Manual', 'Enabled', plan.identity ? 'Expanded' : 'Protected', String(plan.cvs), plan.autoApply ? 'Enabled' : 'Manual', plan.delayMinutes === 0 ? 'Priority' : `${plan.delayMinutes} min`];
}
const features = [[Target, 'Application credits'], [Zap, 'Auto apply credits'], [Search, 'Job matching'], [ShieldCheck, 'Employer identity'], [FileText, 'CV versions'], [Mail, 'Application workflow'], [Bot, 'Scheduling']] as const;

function PlanButton({ plan, currentPlan, role }: { plan: Plan; currentPlan: PlanCode | null; role?: string }) {
  const name = plan.name;
  if (plan.code === currentPlan) return <button className="public-plan-button is-current" disabled><Check size={14} /> Current plan</button>;
  if (role && role !== 'student') return <button className="public-plan-button is-current" disabled>Candidate plan</button>;
  if (plan.price === 0) return <Link className="public-plan-button is-outline" href={role === 'student' ? '/dashboard' : '/register'}>{role === 'student' ? `Continue ${name}` : `Get started with ${name}`}</Link>;
  if (plan.price === null) return <button className="public-plan-button is-current" disabled>Currently unavailable</button>;
  if (!role) return <Link className="public-plan-button" href="/login">Sign in to choose {name}</Link>;
  return <Action endpoint="billing/subscriptions" label={`Choose ${name}`} payload={{ planCode: plan.code }} />;
}

export function PublicPricing({ plans, currentPlan, role }: { plans: Plan[]; currentPlan: PlanCode | null; role?: string }) {
  const initialPlan = plans.findIndex(plan => plan.highlighted || plan.badge);
  const initialPlanIndex = initialPlan >= 0 ? initialPlan : Math.min(1, plans.length - 1);
  const workspace = role === 'admin' ? '/admin' : role === 'employer' ? '/employer' : role === 'student' ? '/dashboard' : '/register';
  return <div className="public-pricing">
    <section className="public-pricing-hero">
      <span className="public-pricing-kicker"><Sparkles size={13} /> Upgrade your career</span>
      <h1>Choose the plan that fits<br /><span>your career</span></h1>
      <p>Get smarter job matching, application tools and premium features to help you move forward with confidence.</p>
      <div className="public-billing-period" aria-label="Billing period"><strong>Monthly plans</strong><span>Secure billing</span></div>
    </section>
    <section
      id="public-plan-slider"
      className={`public-plan-carousel public-plan-count-${plans.length}`}
      aria-label="Candidate subscription plans"
      aria-roledescription="carousel"
    >
      {plans.map((plan, index) => <input
        key={plan.code}
        className={`public-plan-radio public-plan-radio-${index} public-plan-select-${index}`}
        type="radio"
        name="public-plan-carousel"
        id={`public-plan-choice-${index}`}
        aria-label={`Show ${plan.name} plan`}
        data-pricing-plan={index}
        defaultChecked={index === initialPlanIndex}
        style={{ left: `calc(50% + ${(index - (plans.length - 1) / 2) * 18}px)` }}
      />)}
      <div className="public-plan-stage">
      {plans.map((plan, planIndex) => {
        const name = plan.name;
        return <article
          key={plan.code}
          className={`public-plan-card public-plan-${plan.code} public-plan-card-${planIndex}`}
          data-pricing-plan={planIndex}
        >
          {plan.badge && <span className="public-popular">{plan.badge}</span>}
          <header>
            <span className="public-plan-tag">{name}</span>
            <div className={`public-plan-price${plan.price === null ? ' is-unavailable' : ''}`}><strong>{amount(plan)}</strong>{amount(plan) !== 'Price unavailable' && <span>/ {period(plan)}</span>}</div>
            <p>{plan.description || 'Focused tools to support your next career move.'}</p>
          </header>
          <ul>{features.map(([, label], featureIndex) => <li key={label}><i><Check size={12} /></i><span>{label}</span><b>{values(plan)[featureIndex]}</b></li>)}</ul>
          <div className="public-plan-card-action"><PlanButton plan={plan} currentPlan={currentPlan} role={role} /></div>
        </article>;
      })}
      </div>
      <div className="public-plan-positions">{plans.map((plan, index) => <p className={`public-plan-position public-plan-position-${index}`} key={plan.code}>{plan.name} · {index + 1} of {plans.length}</p>)}</div>
    </section>
    <section className="public-comparison">
      <span className="public-section-kicker"><Sparkles size={11} /> Plan comparison</span><h2>Compare plans</h2><p>See how each plan supports your job search and choose the right fit.</p>
      <div className="public-comparison-scroll"><table><thead><tr><th>Features</th>{plans.map(plan => <th key={plan.code}>{plan.name}<small>{amount(plan)}{amount(plan) !== 'Price unavailable' ? ` / ${period(plan)}` : ''}</small></th>)}</tr></thead><tbody>{features.map(([Icon, label], row) => <tr key={label}><th><Icon /> {label}</th>{plans.map(plan => <td key={plan.code}>{values(plan)[row]}</td>)}</tr>)}</tbody></table></div>
    </section>
    <section className="public-faqs">
      <span className="public-section-kicker"><Sparkles size={11} /> FAQs</span><h2>Frequently asked questions</h2><p>Find answers to common questions about plans and billing.</p>
      <div>{[['Can I change my plan anytime?', 'Yes. You can move to another available plan from your billing workspace.'], ['What payment methods do you accept?', 'Available methods are shown securely during Razorpay checkout.'], ['Is there a free plan available?', 'Yes. The Free plan lets you start without a paid subscription.'], ['Do unused credits roll over?', 'Plan limits reset with their configured usage period and do not roll over.'], ['How do I cancel my subscription?', 'Open Billing in your workspace and choose Cancel Renewal.'], ['How do I get a refund?', 'Contact support or use the available refund process for an eligible payment.']].map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div>
    </section>
    <section className="public-pricing-cta"><Rocket /><div><strong>Ready to take the next step?</strong><p>Join SkillOnIT and build your next career opportunity.</p></div><Link href={workspace}>{role ? 'Open workspace' : 'Get started now'} <ArrowRight /></Link></section>
  </div>;
}
