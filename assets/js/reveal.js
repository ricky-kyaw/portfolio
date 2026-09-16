// Scroll fade-ins. Anything with [data-reveal] starts slightly lower and
// transparent, then eases into place when it scrolls into view.
// Optional: data-reveal-delay="120" (milliseconds), or a parent with
// [data-reveal-group] to stagger its [data-reveal] children automatically.

let observer;
let focusGuard = false;
let startedAt = 0;
const LOAD_WINDOW = 1500; // ms: after this, scroll reveals ignore load-stagger delays

function stagger(root) {
  root.querySelectorAll('[data-reveal-group]').forEach((group) => {
    const step = Number(group.dataset.revealGroup) || 70;
    group.querySelectorAll(':scope [data-reveal]').forEach((el, i) => {
      if (!el.dataset.revealDelay) el.style.setProperty('--reveal-delay', i * step + 'ms');
    });
  });
  root.querySelectorAll('[data-reveal][data-reveal-delay]').forEach((el) => {
    el.style.setProperty('--reveal-delay', el.dataset.revealDelay + 'ms');
  });
}

export function initReveal(root = document) {
  const items = root.querySelectorAll('[data-reveal]:not(.is-visible)');
  if (!items.length) return;
  startedAt = performance.now();
  stagger(root);

  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Load-time stagger only makes sense right after the page appears.
            // Later, when the visitor scrolls to something, show it right away.
            if (performance.now() - startedAt > LOAD_WINDOW && entry.target.dataset.revealDelay) {
              entry.target.style.setProperty('--reveal-delay', '0ms');
            }
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
  }
  items.forEach((el) => observer.observe(el));

  // Anything that receives keyboard focus must be visible right away.
  if (!focusGuard) {
    focusGuard = true;
    document.addEventListener('focusin', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-reveal]:not(.is-visible)') : null;
      if (!el) return;
      el.style.setProperty('--reveal-delay', '0ms');
      el.classList.add('is-visible');
      if (observer) observer.unobserve(el);
    });
  }
}
