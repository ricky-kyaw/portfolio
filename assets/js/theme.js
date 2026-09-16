// Light and dark. A tiny inline script in the <head> of every page applies
// the saved (or system) theme before the first paint, so nothing flashes.
// This module handles the toggle and remembers the choice. The button is a
// plain action button: its label says what pressing it will do.

const KEY = 'theme';
const BG = { light: '#F8F7F2', dark: '#0F1217' };

export function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme, { remember = true } = {}) {
  const html = document.documentElement;
  if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  html.classList.add('is-theming');
  html.dataset.theme = theme;
  html.style.background = BG[theme];
  if (remember) {
    try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode, fine */ }
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = BG[theme];
  setTimeout(() => html.classList.remove('is-theming'), 400);
  return theme;
}

export function toggleTheme() {
  return setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-toggle]')) toggleTheme();
  });
  // If the visitor never chose, follow the system when it changes.
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const follow = (ev) => {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
    if (!saved) setTheme(ev.matches ? 'dark' : 'light', { remember: false });
  };
  if (mq.addEventListener) mq.addEventListener('change', follow);
  else if (mq.addListener) mq.addListener(follow);
}
