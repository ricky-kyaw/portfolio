// Light and dark. The site is dark unless the visitor picks light. A tiny inline
// script in the <head> of every page applies the saved choice before the first
// paint, so nothing flashes. This module handles the toggle and remembers the
// choice. The button is a plain action button: its label says what pressing it will do.

const KEY = 'theme';
const BG = { light: '#FAFAF8', dark: '#0B0D10' };

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme, { remember = true } = {}) {
  const html = document.documentElement;
  if (theme !== 'light') theme = 'dark';
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
}
