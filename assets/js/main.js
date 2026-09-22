// Entry point for every page. Wires up the soft page transitions, the scroll
// fade-ins, the theme toggle, the menu, the copy buttons, the contact form,
// and visit counting. Page-specific code (like the notebook cell) is loaded
// only when the page needs it.

import { initRouter, navigate } from './router.js';
import { initReveal } from './reveal.js';
import { initTheme } from './theme.js';
import { site } from './site.config.js';

const html = document.documentElement;
// The inline script in <head> adds "js" before paint and removes it again
// after three seconds unless we confirm here that the script really ran.
html.classList.add('js', 'js-ready');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// Run each part on its own so one failure cannot blank the page.
function safely(name, fn) {
  try { fn(); } catch (e) { console.error(name, e); }
}

// Older Safari has matchMedia but not addEventListener on the result.
export function onMedia(mq, fn) {
  if (mq.addEventListener) mq.addEventListener('change', fn);
  else if (mq.addListener) mq.addListener(fn);
}

// One quiet status line for screen readers ("Copied", "Sent").
export function say(text) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}

// ---------- nav: the thin rule that slides under the current tab ----------
function placeNavRule() {
  const rule = document.querySelector('.nav-rule');
  const active = document.querySelector('[data-nav] a.is-active, [data-nav] a[aria-current="page"]');
  if (!rule) return;
  if (!active || getComputedStyle(rule).display === 'none') {
    rule.classList.remove('is-ready');
    return;
  }
  const w = active.offsetWidth;
  rule.style.transform = `translateX(${active.offsetLeft}px) scaleX(${w / 100})`;
  requestAnimationFrame(() => rule.classList.add('is-ready'));
}

// ---------- mobile menu (a simple disclosure, not a modal) ----------
function initMenu() {
  const btn = document.querySelector('.menu-btn');
  const nav = document.getElementById('site-nav');
  if (!btn || !nav) return;
  const open = () => { nav.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); };
  const close = ({ focus = false } = {}) => {
    if (!nav.classList.contains('is-open')) return;
    nav.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    if (focus) btn.focus();
  };
  btn.addEventListener('click', () => (nav.classList.contains('is-open') ? close() : open()));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('is-open')) return;
    if (!e.target.closest('#site-nav, .menu-btn')) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close({ focus: true }); });
  onMedia(matchMedia('(min-width: 720px)'), () => close());
  document.addEventListener('page:unload', () => close());
}

// ---------- copy buttons (footer, resume bullets) ----------
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) { return false; }
}
function initCopy() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.copy-btn[data-copy]');
    if (!b) return;
    e.preventDefault();
    copyText(b.dataset.copy).then((ok) => {
      const was = b.textContent;
      b.textContent = ok ? 'copied' : 'could not copy';
      b.classList.toggle('is-done', ok);
      say(ok ? 'Copied.' : 'Could not copy.');
      setTimeout(() => { b.textContent = was; b.classList.remove('is-done'); }, 1200);
    });
  });
}

// ---------- contact form: send in place, no page change ----------
function initForms() {
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-ajax]');
    if (!form || !('fetch' in window)) return;
    e.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const was = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Sending…'; }

    // Give up after 15 seconds so a stalled connection cannot lock the form.
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
    let res = null;
    try {
      res = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
        signal: ctl ? ctl.signal : undefined,
      });
    } catch (err) {
      res = null;
    }
    if (timer) clearTimeout(timer);

    if (res && res.ok) {
      const done = document.createElement('p');
      done.className = 'form-done';
      done.tabIndex = -1;
      done.textContent = 'Sent. Thank you. I read everything and I answer.';
      form.replaceWith(done);
      done.focus({ preventScroll: true });
      say('Message sent.');
      return;
    }

    if (res) {
      // The form service answered, but said no. Usually it wants to show its
      // own "are you human" check, which it cannot do in the background.
      // Send the ordinary way instead, so the message is never lost.
      form.submit();
      return;
    }

    // No answer at all: offline, blocked, or timed out.
    if (button) { button.disabled = false; button.textContent = was; button.focus(); }
    let note = form.querySelector('.form-error');
    if (!note) {
      note = document.createElement('p');
      note.className = 'form-error';
      form.appendChild(note);
    }
    note.textContent = 'That did not send. Please email me instead: ';
    const mail = document.createElement('a');
    mail.className = 'u u--rest';
    mail.href = 'mailto:' + site.email;
    mail.textContent = site.email;
    note.appendChild(mail);
    say(note.textContent);
  });
}

// ---------- visit counting (GoatCounter) ----------
// The GoatCounter script tag sits in the <head> of every page and counts the
// first page by itself. Moving between pages here does not reload anything,
// so we tell it about each later page ourselves.
function countView() {
  if (window.goatcounter && typeof window.goatcounter.count === 'function') {
    window.goatcounter.count({ path: location.pathname + location.search });
  }
}

// ---------- per-page setup, run on first load and after every soft navigation ----------
let cell = null;
let story = null;
let play = null;
let studyLog = null;
let plates = null;
async function pageInit(main) {
  safely('reveal', () => initReveal(main));
  safely('nav', placeNavRule);
  if (main.matches('[data-story]')) {
    const deck = main.querySelector('[data-deck]');
    try {
      const mod = await import('./story.js');
      if (!main.isConnected) return;
      story = mod.initStory(main);
      if (!story && deck) deck.classList.add('is-plain');
    } catch (e) {
      // The slides could not start: fall back to the plain scrolling article.
      if (deck) deck.classList.add('is-plain');
      console.error('story', e);
    }
    return;
  }
  if (main.matches('[data-play]')) {
    try {
      const mod = await import('./play.js');
      if (!main.isConnected) return;
      play = mod.initPlay(main);
      if (!play) throw new Error('the page is missing its board');
    } catch (e) {
      // Say what is true (scripts are on, the board just did not load) and hide the controls that cannot work.
      main.classList.add('is-broken');
      const status = main.querySelector('[data-status]');
      if (status) status.textContent = 'The board could not load. Reload the page to try again.';
      console.error('play', e);
    }
    return;
  }
  if (main.matches('[data-study-log]')) {
    try {
      const mod = await import('./study-log.js');
      if (!main.isConnected) return;
      studyLog = mod.initStudyLog(main);
    } catch (e) {
      console.error('study log', e);
    }
    return;
  }
  if (main.querySelector('[data-cell]')) {
    try {
      const mod = await import('./cell.js');
      if (!main.isConnected) return; // the visitor already moved on
      cell = mod.initCell(main, { navigate });
    } catch (e) {
      console.error('cell', e);
    }
  }
  if (main.querySelector('[data-miniboard]')) {
    try {
      const mod = await import('./home-plates.js');
      if (!main.isConnected) return;
      plates = mod.initHomePlates(main);
    } catch (e) {
      console.error('plates', e);
    }
  }
  if (main.querySelector('[data-github-repo]')) {
    try {
      const mod = await import('./github.js');
      if (!main.isConnected) return;
      mod.hydrateGithubLinks(site.githubUser, main);
    } catch (e) {
      console.error('github', e);
    }
  }
}
function pageTeardown() {
  if (cell) { cell.destroy(); cell = null; }
  if (story) { story.destroy(); story = null; }
  if (play) { play.destroy(); play = null; }
  if (studyLog) { studyLog.destroy(); studyLog = null; }
  if (plates) { plates.destroy(); plates = null; }
}

safely('theme', initTheme);
safely('router', initRouter);
safely('menu', initMenu);
safely('copy', initCopy);
safely('forms', initForms);
// The Resume page's "Print, or save as a PDF" button. The print layout lives in site.css.
safely('print', () => document.addEventListener('click', (e) => { if (e.target.closest('[data-print]')) window.print(); }));
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-visible'));
  // paper cannot be clicked: open every "More" for the print, and close them again afterwards
  document.querySelectorAll('.proj details:not([open])').forEach((d) => { d.open = true; d.dataset.printOpened = '1'; });
});
window.addEventListener('afterprint', () => document.querySelectorAll('.proj details[data-print-opened]').forEach((d) => { d.open = false; delete d.dataset.printOpened; }));

document.addEventListener('page:unload', pageTeardown);
document.addEventListener('page:load', (e) => { pageInit(e.detail.main); countView(); });
window.addEventListener('resize', () => placeNavRule());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeNavRule);

pageInit(document.querySelector('main'));

// Smooth scroll for same-page anchors. The skip link is left to the browser
// so that it also moves keyboard focus.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || a.classList.contains('skip') || a.getAttribute('href') === '#') return;
  const el = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
  history.replaceState(history.state, '', a.getAttribute('href'));
});
