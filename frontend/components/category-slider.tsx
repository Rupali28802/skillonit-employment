'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { categories } from '@/lib/domain';

export function CategorySlider({ value, onChange }: { value: string; onChange: (category: string) => void }) {
  const viewport = useRef<HTMLElement>(null);
  const held = useRef(false);
  const [paused, setPaused] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = viewport.current;
    const group = element?.firstElementChild as HTMLElement | null;
    if (!element || !group) return;
    const observer = new ResizeObserver(() => setOverflowing(group.getBoundingClientRect().width > element.clientWidth));
    observer.observe(element); observer.observe(group);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    const group = element?.firstElementChild as HTMLElement | null;
    if (!element || !group || paused || !overflowing) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, previous = 0, position = element.scrollLeft;
    function tick(time: number) {
      const elapsed = previous ? Math.min(time - previous, 50) : 0;
      previous = time;
      if (!held.current && !reduced.matches && !document.hidden) {
        const width = group!.getBoundingClientRect().width;
        if (width > 0) {
          position = (position + elapsed * 0.026) % width;
          element!.scrollLeft = position;
        }
      } else position = element!.scrollLeft;
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, overflowing]);
  return <div className={`category-carousel${overflowing ? ' can-loop' : ''}`}>
    <div className="category-carousel-heading"><span>Explore by category</span>{overflowing && <button type="button" className="category-motion-control" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume categories' : 'Pause categories'}</button>}</div>
    <div className="category-browse-row">
    <button type="button" className={`category-image-button category-all-fixed${value === '' ? ' selected' : ''}`} aria-pressed={value === ''} onClick={() => onChange('')}>
      <span className="category-art category-art-all" aria-hidden="true" />
      <span>All opportunities</span>
    </button>
    <section className="category-viewport" ref={viewport} aria-label="Job categories"
      onPointerEnter={event => { if (event.pointerType === 'mouse') held.current = true; }}
      onPointerLeave={() => { held.current = !!viewport.current?.contains(document.activeElement); }}
      onFocusCapture={() => { held.current = true; }}
      onBlurCapture={event => { held.current = event.currentTarget.contains(event.relatedTarget); }}
      onTouchStart={() => { held.current = true; }}
      onTouchEnd={() => { held.current = false; setPaused(true); }}>
      {[0, 1].map(copy => <div className={`category-image-group${copy ? ' category-image-copy' : ''}`} key={copy} aria-hidden={copy ? true : undefined}>
        {categories.map((category, index) => <button type="button" className={`category-image-button${value === category ? ' selected' : ''}`} key={category} tabIndex={copy ? -1 : undefined} aria-pressed={value === category} onClick={() => onChange(category)}>
          <span className="category-art" aria-hidden="true" style={{ backgroundPosition: `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 50}%` }} />
          <span>{category}</span>
        </button>)}
      </div>)}
    </section>
    </div>
  </div>;
}
