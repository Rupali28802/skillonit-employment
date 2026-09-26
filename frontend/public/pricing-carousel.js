const pricingCarouselTimers = new WeakMap();
const pricingCarouselInterval = 5000;

function selectPricingPlan(carousel, index) {
  const radio = carousel.querySelector(`.public-plan-radio-${index}`);
  if (!radio) return;

  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
}

function startPricingCarousel(carousel) {
  const currentTimer = pricingCarouselTimers.get(carousel);
  if (currentTimer) window.clearInterval(currentTimer);

  const radios = Array.from(carousel.querySelectorAll('.public-plan-radio'));
  if (radios.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const timer = window.setInterval(() => {
    if (!carousel.isConnected) {
      window.clearInterval(timer);
      pricingCarouselTimers.delete(carousel);
      return;
    }

    const currentIndex = Math.max(0, radios.findIndex(radio => radio.checked));
    selectPricingPlan(carousel, (currentIndex + 1) % radios.length);
  }, pricingCarouselInterval);

  pricingCarouselTimers.set(carousel, timer);
}

function setupPricingCarousels() {
  document.querySelectorAll('.public-plan-carousel').forEach((carousel) => {
    if (carousel.dataset.autoplayReady === 'true') return;
    carousel.dataset.autoplayReady = 'true';
    startPricingCarousel(carousel);
  });
}

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const control = event.target.closest('[data-pricing-plan]');
  if (!control) return;

  const carousel = control.closest('.public-plan-carousel');
  if (!carousel) return;

  const index = Number(control.getAttribute('data-pricing-plan'));
  if (!Number.isInteger(index)) return;

  const radio = carousel.querySelector(`.public-plan-radio-${index}`);
  if (!radio || radio.checked) return;

  event.preventDefault();
  selectPricingPlan(carousel, index);
  window.setTimeout(() => selectPricingPlan(carousel, index), 0);
  startPricingCarousel(carousel);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPricingCarousels, { once: true });
} else {
  setupPricingCarousels();
}

new MutationObserver(setupPricingCarousels).observe(document.documentElement, { childList: true, subtree: true });
