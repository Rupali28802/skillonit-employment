'use client';

import { ChevronLeft, ChevronRight, Check, Crown, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Plan, PlanCode } from '@/lib/domain';
import { Action } from './forms';

const INTERVAL_MS = 6500;

function price(plan: Plan) {
  return plan.price === null ? 'Pricing to be announced' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: plan.currency }).format(plan.price);
}

function planMessage(code: PlanCode) {
  if (code === 'premium') return 'Priority tools and support for a faster, more focused job search.';
  if (code === 'pro') return 'More application capacity and flexibility as your search grows.';
  return 'A clear, trusted starting point for finding and applying to opportunities.';
}

export function PlansCarousel({ plans, currentPlan }: { plans: Plan[]; currentPlan: PlanCode | null }) {
  const initial = Math.max(0, plans.findIndex(plan => plan.code === currentPlan));
  const [index, setIndex] = useState(initial);
  const [direction, setDirection] = useState<'next' | 'previous'>('next');
  const [paused, setPaused] = useState(false);
  const pointerStart = useRef<number | null>(null);
  const show = useCallback((next: number, movement: 'next' | 'previous') => {
    setDirection(movement);
    setIndex((next + plans.length) % plans.length);
  }, [plans.length]);
  const next = useCallback(() => show(index + 1, 'next'), [index, show]);
  const previous = useCallback(() => show(index - 1, 'previous'), [index, show]);
  useEffect(() => {
    if (paused || plans.length < 2) return;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % plans.length), INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [paused, plans.length]);
  if (!plans.length) return null;
  const plan = plans[index];
  const previousPlan = plans[(index - 1 + plans.length) % plans.length];
  const nextPlan = plans[(index + 1) % plans.length];
  const active = plan.code === currentPlan;
  const features = [
    'Worldwide job discovery', `${plan.dailyCap} daily application allowance`,
    plan.identity ? 'Expanded employer identity' : 'Protected employer identity',
    `${plan.cvs} CV version${plan.cvs > 1 ? 's' : ''}`,
    plan.autoApply ? 'Automation when eligible' : 'Manual application workflow',
    plan.delayMinutes === 0 ? 'Priority scheduling' : `${plan.delayMinutes} minute automation delay`,
  ];
  // Pointer handlers provide swipe/drag; navigation remains available through native buttons.
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
  return <section className="plans-carousel" aria-roledescription="carousel" aria-label="Candidate subscription plans"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
    onPointerDown={event => { pointerStart.current = event.clientX; setPaused(true); }} onPointerUp={event => { if (pointerStart.current !== null) { const movement = event.clientX - pointerStart.current; if (Math.abs(movement) > 45) { if (movement < 0) next(); else previous(); } } pointerStart.current = null; setPaused(false); }}>
    <div className="plans-stage">
      {plans.length > 1 && <button type="button" className={`plan-peek plan-peek-left plan-theme-${previousPlan.code}`} aria-label={`Show ${previousPlan.name} plan`} onClick={previous}>
        <span className="plan-peek-shade" />
        <span className="plan-peek-copy"><small>Previous plan</small><strong>{previousPlan.name}</strong><span>{planMessage(previousPlan.code)}</span></span>
      </button>}
      {plans.length > 1 && <button type="button" className={`plan-peek plan-peek-right plan-theme-${nextPlan.code}`} aria-label={`Show ${nextPlan.name} plan`} onClick={next}>
        <span className="plan-peek-shade" />
        <span className="plan-peek-copy"><small>Next plan</small><strong>{nextPlan.name}</strong><span>{planMessage(nextPlan.code)}</span></span>
      </button>}
      <button className="plans-arrow plans-previous" aria-label="Previous plan" onClick={previous}><ChevronLeft /></button>
      <article key={`${plan.code}-${index}`} className={`plan-focus-card plan-theme-${plan.code} slide-${direction} ${active ? 'current' : ''}`} aria-live="polite" aria-label={`${plan.name} plan, slide ${index + 1} of ${plans.length}`}>
        <div className="plan-focus-shade" />
        <div className="plan-card-top"><span className="plan-symbol">{plan.code === 'premium' ? <Crown /> : <ShieldCheck />}</span><span className="pill">{active ? 'Your current plan' : plan.code === 'pro' ? 'Build momentum' : plan.code === 'premium' ? 'Priority experience' : 'Start with confidence'}</span></div>
        <div className="plan-focus-content">
          <div className="plan-heading"><div><span className="plan-overline">SkillOnIT candidate plan</span><h2>{plan.name}</h2><p>{planMessage(plan.code)}</p></div><p className="plan-price">{price(plan)}</p></div>
          <ul>{features.map(feature => <li key={feature}><Check size={17} /> {feature}</li>)}</ul>
          {active ? <button className="current-plan-button" disabled>Current Plan</button> : <Action endpoint="billing/checkout" label={currentPlan === 'basic' ? `Upgrade to ${plan.name}` : `Choose ${plan.name}`} payload={{planCode:plan.code}} />}
        </div>
      </article>
      <button className="plans-arrow plans-next" aria-label="Next plan" onClick={next}><ChevronRight /></button>
    </div>
    <div className="plans-dots" role="tablist" aria-label="Choose a subscription plan">{plans.map((item, position) => <button key={item.code} role="tab" aria-selected={position === index} aria-label={`Show ${item.name} plan`} onClick={() => show(position, position > index ? 'next' : 'previous')}><span /></button>)}</div>
    <p className="plans-position">Plan {index + 1} of {plans.length}{paused ? ' · Auto-slide paused' : ''}</p>
  </section>;
}
