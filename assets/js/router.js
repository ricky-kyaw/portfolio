// Soft page transitions. Clicking a link fetches the next page, fades the
// current content out, swaps it in place, and fades the new content in.
// No white flash, no full reload. If anything goes wrong we fall back to a
// normal navigation, and without JavaScript every link still works.

const OUT_MS = 180;
const CACHE_MAX = 12;
const cache = new Map();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// Links to files are left to the browser.
const FILE_RE = /\.(pdf|png|jpe?g|gif|svg|webp|avif|ico|zip|txt|xml|json|csv|mp4|webm|mp3|woff2?|css|js|md)$/i;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function usable(a, event) {
  if (!a || a.hasAttribute('download') || a.hasAttribute('data-no-router')) return false;
  if (a.target && a.target !== '_self') return false;
  if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button)) return false;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return false;
  if (!/^https?:$/.test(url.protocol)) return false;
  if (FILE_RE.test(url.pathname)) return false;
  // Same page, only the hash changed: let the browser handle it.
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return false;
  return true;
}

async function fetchPage(url) {
  const key = url.pathname + url.search;
  if (cache.has(key)) return cache.get(key);
  const p = fetch(url.href, { headers: { 'X-Requested-With': 'router' } })
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      const type = res.headers.get('content-type') || '';
      if (!type.includes('text/html')) throw new Error('not a page');
      return res.text();
    })
    .then((html) => new DOMParser().parseFromString(html, 'text/html'))
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, p);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

function prefetch(a) {
  if (!usable(a)) return;
  const url = new URL(a.href, location.href);
  if (url.pathname === location.pathname) return;
  fetchPage(url).catch(() => {});
}

function setActiveNav(pathname) {
  document.querySelectorAll('[data-nav] a').forEach((a) => {
    const href = new URL(a.getAttribute('href'), location.href).pathname;
    const active = href === pathname || (href !== '/' && pathname.startsWith(href));
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function announce(title) {
  const live = document.getElementById('route-announcer');
  if (live) live.textContent = title;
}

// The stylesheet asks for smooth scrolling. Route changes must not animate
// the scroll, so we switch it off for one frame.
function instantly(fn) {
  const html = document.documentElement;
  const prev = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';
  fn();
  setTimeout(() => { html.style.scrollBehavior = prev; }, 0);
}

function scrollToHash(hash, smooth) {
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!el) return false;
  if (smooth && !reduced.matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else instantly(() => el.scrollIntoView({ block: 'start' }));
  return true;
}

function rememberScroll() {
  try {
    history.replaceState({ ...(history.state || {}), y: window.scrollY }, '', location.href);
  } catch (e) { /* some browsers rate-limit this; fine */ }
}

let busy = false;
let pending = null;
let current = location.pathname + location.search;

async function go(url, { push = true, restoreY = null } = {}) {
  if (busy) {
    // Remember the latest request and run it when this one finishes.
    pending = { url, push, restoreY };
    return;
  }
  busy = true;
  const main = document.querySelector('main');
  const html = document.documentElement;
  html.classList.add('is-routing');
  try {
    const leave = reduced.matches ? Promise.resolve() : (main.classList.add('is-leaving'), wait(OUT_MS));
    const [doc] = await Promise.all([fetchPage(url), leave]);
    if (pending) {
      // A newer request arrived while this one was loading. Let it win.
      main.classList.remove('is-leaving');
      return;
    }
    const source = doc.querySelector('main');
    if (!source) throw new Error('no main');
    // Copy, do not move: the cached page must stay whole for the next visit.
    const next = document.importNode(source, true);

    if (push) {
      rememberScroll();
      history.pushState({ y: 0 }, '', url.href);
    }
    current = url.pathname + url.search;
    document.title = doc.title;
    document.body.dataset.page = doc.body.dataset.page || '';
    document.dispatchEvent(new CustomEvent('page:unload', { detail: { main } }));

    main.replaceWith(next);
    if (!reduced.matches) next.classList.add('is-entering');

    setActiveNav(url.pathname);
    announce(doc.title);

    if (typeof restoreY === 'number') instantly(() => window.scrollTo(0, restoreY));
    else if (!url.hash || !scrollToHash(url.hash, false)) instantly(() => window.scrollTo(0, 0));

    document.dispatchEvent(new CustomEvent('page:load', { detail: { main: next, url } }));
    // Move focus to the new content so keyboard and screen-reader users follow along.
    next.setAttribute('tabindex', '-1');
    next.focus({ preventScroll: true });

    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove('is-entering')));
  } catch (err) {
    // Anything unexpected: do a normal navigation.
    main.classList.remove('is-leaving');
    pending = null;
    location.href = url.href;
    return;
  } finally {
    html.classList.remove('is-routing');
    busy = false;
    if (pending) {
      const p = pending;
      pending = null;
      go(p.url, { push: p.push, restoreY: p.restoreY });
    }
  }
}

export function navigate(href) {
  const url = new URL(href, location.href);
  if (url.pathname === location.pathname && url.search === location.search) {
    if (url.hash) scrollToHash(url.hash, true);
    return;
  }
  go(url);
}

export function initRouter() {
  if (!('fetch' in window) || !('DOMParser' in window)) return;
  history.scrollRestoration = 'manual';
  if (history.state && typeof history.state.y === 'number') instantly(() => window.scrollTo(0, history.state.y));

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!usable(a, e)) return;
    e.preventDefault();
    navigate(a.href);
  });

  // Warm the cache when a link is likely to be clicked.
  const warm = (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a) prefetch(a);
  };
  document.addEventListener('pointerenter', warm, true);
  document.addEventListener('focusin', warm);
  document.addEventListener('touchstart', warm, { passive: true });

  // Keep each history entry's scroll position so Back lands where you were.
  let scrollTimer;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(rememberScroll, 120);
  }, { passive: true });

  window.addEventListener('popstate', (e) => {
    const url = new URL(location.href);
    if (url.pathname + url.search === current) {
      // Only the hash moved.
      if (url.hash) scrollToHash(url.hash, true);
      return;
    }
    const y = e.state && typeof e.state.y === 'number' ? e.state.y : null;
    go(url, { push: false, restoreY: y });
  });

  setActiveNav(location.pathname);
}
