'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

function showPlan(index: number) {
  document.getElementById('public-plan-slider')?.querySelectorAll<HTMLElement>('.public-plan-card')[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

export function PricingSliderControls({ count }: { count: number }) {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  useEffect(() => {
    const slider = document.getElementById('public-plan-slider');
    if (!slider) return;
    const update = () => {
      const cards = Array.from(slider.querySelectorAll<HTMLElement>('.public-plan-card'));
      if (!cards.length) return;
      const center = slider.scrollLeft + slider.clientWidth / 2;
      let closest = 0;
      cards.forEach((card, index) => {
        const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
        const current = cards[closest];
        if (distance < Math.abs(current.offsetLeft + current.offsetWidth / 2 - center)) closest = index;
      });
      activeRef.current = closest;
      setActive(closest);
    };
    slider.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => { slider.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  useEffect(() => {
    if (count < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      if (document.hidden || window.innerWidth > 760) return;
      showPlan((activeRef.current + 1) % count);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [count]);
  if (count < 2) return null;
  return <nav className="public-plan-slider-controls" aria-label="Plan slider controls">
    <button aria-label="Previous plan" disabled={active === 0} onClick={() => showPlan(active - 1)}><ChevronLeft /></button>
    <div>{Array.from({ length: count }, (_, index) => <button key={index} className={index === active ? 'is-active' : ''} aria-label={`Show plan ${index + 1}`} aria-current={index === active ? 'true' : undefined} onClick={() => showPlan(index)} />)}</div>
    <button aria-label="Next plan" disabled={active === count - 1} onClick={() => showPlan(active + 1)}><ChevronRight /></button>
  </nav>;
}
