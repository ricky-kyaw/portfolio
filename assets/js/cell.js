// The notebook cell on the Home page. You type a command or a sum, and it
// answers in place. Plain English in, plain English out. Nothing here uses
// eval(); the math is a hand-written parser in mathkit.js.

import { evaluate, looksLikeMath, primeReport, fibReport } from './mathkit.js';
import { setTheme, currentTheme } from './theme.js';
import { site } from './site.config.js';
import { initFigure } from './figure.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(hover: none)');
const KEEP = 3;        // In/Out pairs shown
const HIST = 20;       // remembered inputs
const KEY = 'cell';
const NAV_DELAY = 250; // ms between the answer and the page glide

const FILLER = ['show me the', 'show me', 'show', 'open', 'go to', 'go', 'see', 'view', 'the', 'my', 'me', 'please', 'can you', 'i want to', 'let me see', 'take me to', 'a', 'an'];

// ---------- small helpers to build answers ----------
const text = (s) => ({ t: 'text', s });
const br = () => ({ t: 'br' });
const num = (s) => ({ t: 'num', s });
const math = (s) => ({ t: 'math', s });
const link = (s, href, external = false) => ({ t: 'link', s, href, external });
const run = (s, cmd) => ({ t: 'run', s, cmd });
const copy = (s) => ({ t: 'copy', s });

const isPlaceholder = (s) => /^\[[A-Z_]+\]$/.test(String(s || ''));
// "https://www.example.com/me/" reads better as "example.com/me".
const pretty = (u) => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

// One quiet status line for screen readers.
function say(text) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}

export function normalize(raw) {
  const t = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  if (t === '?') return t;
  // Sums keep their punctuation: 20! is a factorial, not a shout.
  if (looksLikeMath(t)) return t;
  return t.replace(/[.!?]+$/, '').trim();
}

function stripFiller(s) {
  let out = s;
  let again = true;
  while (again) {
    again = false;
    for (const f of FILLER) {
      if (out.startsWith(f + ' ')) {
        out = out.slice(f.length + 1).trim();
        again = true;
      }
    }
  }
  return out || s;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- the command table ----------
function makeCommands() {
  const goTo = (href, line) => (c) => { c.go(href); return [text(line)]; };
  return [
    {
      name: 'help', aliases: ['?', 'commands', 'what can you do', 'what can i type', 'options'],
      run: () => [text('You can type: show projects, show code, show apps, show resume, show story, show education, contact, skills, copy email, github, linkedin, random, dark, light, clear. Or type some math, like 2^64 or 17*23, or prime 1000000007, or fib 100.')],
    },
    { name: 'show projects', aliases: ['projects', 'project', 'work', 'show work', 'the work', 'portfolio'], run: goTo('/projects/', 'Opening the projects…') },
    { name: 'show code', aliases: ['code', 'from scratch', 'scratch', 'code i wrote', 'code i wrote from scratch'], run: goTo('/projects/#from-scratch', 'Opening the code I wrote from scratch…') },
    { name: 'show apps', aliases: ['apps', 'app', 'built fast', 'fast', 'apps i built', 'apps i built fast'], run: goTo('/projects/#built-fast', 'Opening the apps I built fast…') },
    { name: 'show resume', aliases: ['resume', 'cv', 'resumé', 'résumé'], run: goTo('/resume/', 'Opening the resume…') },
    {
      name: 'download resume', aliases: ['pdf', 'download pdf', 'resume pdf', 'download'],
      run: () => [text('Here it is: '), link('Download PDF', site.resumePdf)],
    },
    {
      name: 'show story', aliases: ['story', 'my story', 'about', 'about me', 'who are you', 'who'],
      run: (c, { alias }) => {
        c.go('/story/');
        return alias.startsWith('who')
          ? [text(`${site.name}. I write software and solve math problems. Opening my story…`)]
          : [text('Opening my story…')];
      },
    },
    { name: 'show education', aliases: ['education', 'school', 'degree', 'grades', 'studies', 'university'], run: goTo('/education/', 'Opening my education…') },
    {
      name: 'contact', aliases: ['email', 'hire', 'hire me', 'say hello', 'reach you', 'get in touch', 'talk', 'chat'],
      run: (c, { alias }) => {
        const out = [];
        if (alias.startsWith('hire')) out.push(text("Good. Let's talk."), br());
        out.push(
          text('Email: '), link(site.email, 'mailto:' + site.email), copy(site.email), br(),
          text('GitHub: '), link(pretty(site.githubUrl), site.githubUrl, true), br(),
          text('LinkedIn: '), link(pretty(site.linkedinUrl), site.linkedinUrl, true), br(),
          text('Or use '), link('the form on the Contact page', '/contact/'), text('. I read everything and I answer.')
        );
        return out;
      },
    },
    {
      name: 'skills', aliases: ['what do you know', 'tools', 'what can you build', 'languages'],
      run: () => (site.skills && site.skills.length
        ? [text(site.skills.join(', ') + '. '), link('Full list on the Resume page', '/resume/'), text('.')]
        : [text('My skills are listed on the '), link('Resume page', '/resume/'), text('.')]),
    },
    {
      name: 'copy email', aliases: ['copy', 'copy address', 'copy my email', 'copy the email'],
      run: async () => ((await copyText(site.email))
        ? [text('Copied '), num(site.email), text('.')]
        : [text('Here it is: '), link(site.email, 'mailto:' + site.email)]),
    },
    {
      name: 'github', aliases: ['gh', 'code on github', 'repo', 'repos'],
      run: () => {
        if (!isPlaceholder(site.githubUrl)) {
          window.open(site.githubUrl, '_blank', 'noopener');
          return [text('Opening GitHub in a new tab: '), link(pretty(site.githubUrl), site.githubUrl, true)];
        }
        return [text('GitHub: '), link(pretty(site.githubUrl), site.githubUrl, true)];
      },
    },
    {
      name: 'linkedin', aliases: ['li', 'linked in'],
      run: () => {
        if (!isPlaceholder(site.linkedinUrl)) {
          window.open(site.linkedinUrl, '_blank', 'noopener');
          return [text('Opening LinkedIn in a new tab: '), link(pretty(site.linkedinUrl), site.linkedinUrl, true)];
        }
        return [text('LinkedIn: '), link(pretty(site.linkedinUrl), site.linkedinUrl, true)];
      },
    },
    {
      name: 'random', aliases: ['flip', 'again', 'new walk', 'flip again', 'redraw', 'coin', 'flip a coin', 'flip coins'],
      run: (c) => {
        if (!c.figure) return [text('The figure is not on this page.')];
        const end = c.figure.redraw();
        return [text('Flipped 240 coins. The line ends at '), num(end), text('.')];
      },
    },
    { name: 'dark', aliases: ['lights off', 'night', 'dark mode'], run: () => { setTheme('dark'); return [text('Lights off.')]; } },
    { name: 'light', aliases: ['lights on', 'day', 'light mode'], run: () => { setTheme('light'); return [text('Lights on.')]; } },
    {
      name: 'theme', aliases: ['toggle', 'switch theme', 'switch'],
      run: () => {
        const next = setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
        return [text(next === 'dark' ? 'Lights off.' : 'Lights on.')];
      },
    },
    { name: 'clear', aliases: ['cls', 'reset'], run: (c) => { c.clear(); return null; } },
    {
      name: 'home', aliases: ['top', 'go home', 'scroll up'],
      run: () => { window.scrollTo({ top: 0, behavior: reduced.matches ? 'auto' : 'smooth' }); return [text('You are home.')]; },
    },
    { name: 'hi', aliases: ['hello', 'hey', 'good morning', 'good evening', 'yo', 'hi there'], run: () => [text('Hi. Try '), run('show projects', 'show projects'), text('.')] },
    { name: 'thanks', aliases: ['thank you', 'cheers', 'ty', 'thank you very much'], run: () => [text('Any time.')] },
  ];
}

const PRIME_RE = /^(?:is\s+)?(?:prime|isprime)\??\s+(\d[\d,_]*)\s*(?:prime\??)?$/;
const PRIME_RE2 = /^is\s+(\d[\d,_]*)\s+(?:a\s+)?prime\??$/;
const FIB_RE = /^fib(?:onacci)?\(?\s*(\d+)\s*\)?$/;

const COMMANDS = makeCommands();
const ALIASES = [];
for (const c of COMMANDS) {
  ALIASES.push({ alias: c.name, cmd: c });
  for (const a of c.aliases) ALIASES.push({ alias: a, cmd: c });
}
const BY_ALIAS = new Map(ALIASES.map((x) => [x.alias, x.cmd]));
const TRAILING = /\s+(please|now|thanks|thank you|pls|for me)$/;
const escapeRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Work out what a typed line means. Exported so the tests can check it.
// Returns { cmd, alias } for a command, or { out } for a direct answer.
export function resolve(norm) {
  let m = norm.match(PRIME_RE) || norm.match(PRIME_RE2);
  if (m) return { out: [text(primeReport(m[1]))] };
  m = norm.match(FIB_RE);
  if (m) return { out: [text(fibReport(m[1]))] };
  if (looksLikeMath(norm)) {
    const r = evaluate(norm);
    return { out: r.ok ? [math(r.text)] : [text(r.text)] };
  }
  const stripped = stripFiller(norm);
  const trimmed = stripped.replace(TRAILING, '').trim() || stripped;
  for (const key of [norm, stripped, trimmed]) {
    if (BY_ALIAS.has(key)) return { cmd: BY_ALIAS.get(key), alias: key };
  }
  // A known command word inside a longer sentence: "show me the projects please".
  let inside = null;
  for (const { alias, cmd } of ALIASES) {
    if (alias.length < 4) continue;
    if (new RegExp('(^|\\s)' + escapeRe(alias) + '(\\s|$)').test(trimmed) && (!inside || alias.length > inside.alias.length)) inside = { alias, cmd };
  }
  if (inside) return { cmd: inside.cmd, alias: inside.alias };
  if (trimmed.length >= 3) {
    const fits = [];
    for (const c of COMMANDS) {
      if (c.name.startsWith(trimmed) || c.aliases.some((x) => x.startsWith(trimmed))) fits.push(c);
    }
    const unique = [...new Set(fits)];
    if (unique.length === 1) return { cmd: unique[0], alias: unique[0].name };
  }
  let best = null;
  for (const { alias, cmd } of ALIASES) {
    if (alias.length < 4) continue;
    const d = levenshtein(trimmed, alias);
    if (d <= 2 && (!best || d < best.d)) best = { d, alias, cmd };
  }
  if (best) return { out: [text('I do not know that one. Did you mean '), run(best.cmd.name, best.cmd.name), text('?')] };
  return { out: [text('I do not know that one. Type '), run('help', 'help'), text(' to see what works.')] };
}

// ---------- the cell ----------
export function initCell(main, { navigate } = {}) {
  const root = main.querySelector('[data-cell]');
  if (!root) return null;
  const rows = root.querySelector('.cell-rows');
  const form = root.querySelector('form');
  const gutter = form.querySelector('.gutter');
  const input = form.querySelector('input');
  const ghost = root.querySelector('.cell-ghost');
  const svg = main.querySelector('[data-figure]');
  const figure = svg ? initFigure(svg) : null;

  const allowedHrefs = new Set(['/projects/', '/projects/#from-scratch', '/projects/#built-fast', '/resume/', '/story/', '/education/', '/contact/', '/', site.resumePdf, site.githubUrl, site.linkedinUrl]);
  const safeHref = (h) => typeof h === 'string' && (allowedHrefs.has(h) || /^mailto:/.test(h) || /^https:\/\//.test(h));

  let n = 1;
  let pairs = [];      // [{ n, in, out }]
  let history = [];
  let cursor = 0;
  let draft = '';
  let suppressGhost = false;

  function setGutter() {
    gutter.textContent = `In [${n}]:`;
    gutter.setAttribute('aria-label', `Run, In [${n}]`);
  }

  // ----- persistence -----
  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ n, rows: pairs.slice(-KEEP), history: history.slice(-HIST) }));
    } catch (e) { /* ignore */ }
  }
  function restore() {
    let s = null;
    try { s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
    if (!s || typeof s !== 'object') return;
    if (Number.isInteger(s.n) && s.n > 0 && s.n < 100000) n = s.n;
    if (Array.isArray(s.history)) history = s.history.filter((h) => typeof h === 'string').slice(-HIST);
    if (Array.isArray(s.rows)) {
      // Old rows come back quietly; they are not news for a screen reader.
      rows.removeAttribute('aria-live');
      for (const r of s.rows.slice(-KEEP)) {
        if (!r || !Number.isInteger(r.n) || typeof r.in !== 'string' || !Array.isArray(r.out)) continue;
        const out = r.out.filter((it) => it && typeof it === 'object' && typeof it.t === 'string');
        pairs.push({ n: r.n, in: r.in, out });
        appendPair(r.n, r.in, out, false);
      }
      rows.setAttribute('aria-live', 'polite');
    }
    cursor = history.length;
    setGutter();
  }

  // ----- rendering -----
  function makeRow(kind, label, body) {
    const li = document.createElement('li');
    li.className = 'row row--' + kind;
    const g = document.createElement('span');
    g.className = 'gutter';
    g.textContent = label;
    const b = document.createElement('span');
    b.className = 'row-body';
    b.append(body);
    li.append(g, b);
    return li;
  }

  function renderOut(items) {
    const frag = document.createDocumentFragment();
    for (const it of items) {
      switch (it.t) {
        case 'text': frag.append(String(it.s)); break;
        case 'br': frag.append(document.createElement('br')); break;
        case 'num': { const s = document.createElement('span'); s.className = 'num'; s.textContent = String(it.s); frag.append(s); break; }
        case 'math': {
          const eq = document.createElement('span'); eq.className = 'eq'; eq.textContent = '= ';
          const v = document.createElement('span'); v.className = 'num'; v.textContent = String(it.s);
          frag.append(eq, v); break;
        }
        case 'link': {
          if (!safeHref(it.href)) { frag.append(String(it.s)); break; }
          const a = document.createElement('a');
          a.href = it.href;
          a.textContent = String(it.s);
          if (/\.pdf$/i.test(it.href)) a.setAttribute('download', '');
          if (it.external) { a.target = '_blank'; a.rel = 'noopener'; }
          frag.append(a); break;
        }
        case 'run': {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'linklike'; b.dataset.run = String(it.cmd); b.textContent = String(it.s);
          frag.append(b); break;
        }
        case 'copy': {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'copy-inline linklike'; b.dataset.copy = String(it.s); b.textContent = 'copy';
          frag.append(b); break;
        }
        default: break;
      }
    }
    return frag;
  }

  function appendPair(k, inText, out, animate) {
    const inRow = makeRow('in', `In [${k}]:`, inText);
    rows.appendChild(inRow);
    let outRow = null;
    if (out && out.length) {
      outRow = makeRow('out', `Out [${k}]:`, renderOut(out));
      rows.appendChild(outRow);
    }
    if (animate && !reduced.matches) {
      inRow.classList.add('is-new');
      if (outRow) outRow.classList.add('is-new');
    }
    // Keep the box short: only the last few pairs stay.
    while (rows.children.length > KEEP * 2) {
      const first = rows.firstElementChild;
      const second = first.nextElementSibling && first.nextElementSibling.classList.contains('row--out') ? first.nextElementSibling : null;
      first.remove();
      if (second) second.remove();
    }
  }

  function clearRows() {
    rows.textContent = '';
    pairs = [];
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  // ----- context handed to commands -----
  const ctx = {
    figure,
    clear: clearRows,
    go(href) {
      const doIt = () => {
        if (coarse.matches) input.blur();
        if (navigate) navigate(href); else location.href = href;
      };
      setTimeout(doIt, reduced.matches ? 0 : NAV_DELAY);
    },
  };

  let running = false;
  async function execute(raw) {
    const shown = raw.trim();
    if (!shown || running) return;
    running = true;
    try {
      const norm = normalize(shown);
      history.push(shown);
      history = history.slice(-HIST);
      cursor = history.length;
      draft = '';

      const r = resolve(norm);
      let out = r.out || null;
      if (r.cmd) {
        try {
          out = await r.cmd.run(ctx, { alias: r.alias, text: norm });
        } catch (e) {
          out = [text('Something went wrong with that one. Try help.')];
        }
      }
      const k = n;
      n += 1;
      setGutter();
      if (r.cmd && r.cmd.name === 'clear') {
        save();
        return;
      }
      const items = out || [];
      pairs.push({ n: k, in: shown, out: items });
      pairs = pairs.slice(-KEEP);
      appendPair(k, shown, items, true);
      save();
    } finally {
      running = false;
    }
  }

  // ----- ghost completion (desktop only) -----
  function updateGhost() {
    if (!ghost || coarse.matches) return;
    const v = input.value;
    const norm = v.toLowerCase().trimStart();
    ghost.classList.remove('is-on');
    ghost.textContent = '';
    input.removeAttribute('aria-description');
    if (suppressGhost || norm.length < 2 || /\d/.test(norm)) return;
    const hit = ALIASES.find((x) => x.alias.startsWith(norm) && x.alias !== norm);
    if (!hit) return;
    const typed = document.createElement('span');
    typed.className = 'typed';
    typed.textContent = v;
    ghost.append(typed, hit.alias.slice(norm.length));
    ghost.dataset.value = v.slice(0, v.length - norm.length) + hit.alias;
    ghost.classList.add('is-on');
    input.setAttribute('aria-description', `Suggestion: ${hit.alias}. Press the right arrow key to accept it.`);
  }
  function acceptGhost() {
    if (!ghost || !ghost.classList.contains('is-on')) return false;
    input.value = ghost.dataset.value || input.value;
    updateGhost();
    return true;
  }

  // ----- events -----
  const onSubmit = (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    updateGhost();
    execute(v);
  };
  const onKey = (e) => {
    if (e.key === 'Enter') {
      if (e.isComposing) return;
      e.preventDefault();
      onSubmit(e);
      return;
    }
    if (e.key === 'ArrowRight' && input.selectionStart === input.value.length) {
      if (acceptGhost()) e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && ghost && ghost.classList.contains('is-on')) {
      // One Tab completes the word; the next Tab moves on as usual.
      e.preventDefault();
      acceptGhost();
      suppressGhost = true;
      updateGhost();
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!history.length) return;
      e.preventDefault();
      if (cursor === history.length) draft = input.value;
      cursor = Math.max(0, cursor - 1);
      input.value = history[cursor];
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
      updateGhost();
    } else if (e.key === 'ArrowDown') {
      if (!history.length) return;
      e.preventDefault();
      cursor = Math.min(history.length, cursor + 1);
      input.value = cursor === history.length ? draft : history[cursor];
      updateGhost();
    } else if (e.key === 'Escape') {
      input.value = '';
      updateGhost();
    }
  };
  const onInput = () => { suppressGhost = false; updateGhost(); };
  const onRootClick = (e) => {
    const chip = e.target.closest('[data-cmd]');
    if (chip) {
      e.preventDefault();
      e.stopPropagation();
      input.value = chip.dataset.cmd;
      const v = input.value;
      input.value = '';
      execute(v);
      if (!coarse.matches) input.focus({ preventScroll: true });
      return;
    }
    const runBtn = e.target.closest('[data-run]');
    if (runBtn) {
      e.preventDefault();
      execute(runBtn.dataset.run);
      return;
    }
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      e.preventDefault();
      copyText(copyBtn.dataset.copy).then((ok) => {
        const was = copyBtn.textContent;
        copyBtn.textContent = ok ? 'copied' : 'could not copy';
        say(ok ? 'Copied.' : 'Could not copy.');
        setTimeout(() => { copyBtn.textContent = was; }, 1200);
      });
    }
  };
  // The "random" word in the figure caption lives outside the cell box.
  const onMainClick = (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b && !root.contains(b)) {
      e.preventDefault();
      execute(b.dataset.cmd);
    }
  };

  form.addEventListener('submit', onSubmit);
  input.addEventListener('keydown', onKey);
  input.addEventListener('input', onInput);
  root.addEventListener('click', onRootClick);
  main.addEventListener('click', onMainClick);

  restore();

  return {
    run: execute,
    destroy() {
      if (figure) figure.destroy();
    },
  };
}
