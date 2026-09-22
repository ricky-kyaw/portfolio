// The Study Log page. The top half is plain functions (dates, streaks, the
// heatmap) that tests/study-log.html checks. The bottom half wires the page.
// Every "today" here is the calendar date in London, wherever the visitor is.

const DATA_URL = '/data/study-log.json';
const CSS_URL = '/assets/css/study-log.css';
const KEY_OWNER = 'studylog:owner';
const KEY_LOCAL = 'studylog:local';
const TARGET = 6;
const MAX_HOURS = 12;
const DAY_MS = 86400000;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- calendar dates ----------
// A date is a "YYYY-MM-DD" string. Sums are done on whole day numbers
// (days since 1970-01-01), so a daylight-saving change can never add or lose a day.

let londonFormat = null;
export function londonToday(now = new Date()) {
  if (!londonFormat) {
    londonFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const got = {};
  for (const part of londonFormat.formatToParts(now)) got[part.type] = part.value;
  return `${got.year}-${got.month}-${got.day}`;
}

export function dayNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function dayString(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function isDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const n = dayNumber(date);
  return Number.isFinite(n) && dayString(n) === date;
}

// 0 is Monday, 6 is Sunday.
function weekdayOf(n) {
  return (((n + 3) % 7) + 7) % 7;
}

function niceDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${DAY_NAMES[weekdayOf(dayNumber(date))]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

function niceHours(hours) {
  const h = Math.round(hours * 100) / 100;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

// ---------- the data ----------
// Sorted by date, one entry per date (the later one wins), hours kept within 0 to 12.
// Entries with a bad date, a bad phase or hours that are not a number are left out.
export function cleanEntries(list) {
  if (!Array.isArray(list)) return [];
  const byDate = new Map();
  for (const e of list) {
    if (!e || typeof e !== 'object' || !isDate(e.date)) continue;
    if (typeof e.hours !== 'number' || !Number.isFinite(e.hours)) continue;
    if (!Number.isInteger(e.phase) || e.phase < 1 || e.phase > 4) continue;
    byDate.set(e.date, { date: e.date, hours: Math.min(MAX_HOURS, Math.max(0, e.hours)), phase: e.phase });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// A day counts as studied when its hours are above 0. Entries dated after today are ignored.
export function streakInfo(list, today, target = TARGET) {
  const t = dayNumber(today);
  const entries = cleanEntries(list).filter((e) => dayNumber(e.date) <= t);
  let total = 0;
  let longest = 0;
  let run = 0;
  let last = null;
  for (const e of entries) {
    total += e.hours;
    if (e.hours <= 0) continue;
    const n = dayNumber(e.date);
    run = last !== null && n === last + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    last = n;
  }
  const gap = last === null ? null : t - last;
  // Today counts as unbroken until midnight: a run that reached yesterday is still alive.
  const broken = gap !== null && gap >= 2;
  const daysMissed = broken ? gap - 1 : 0;
  return {
    current: gap !== null && gap <= 1 ? run : 0,
    longest,
    total: Math.round(total * 100) / 100,
    broken,
    daysMissed,
    hoursLost: target * daysMissed,
    lastStudied: last === null ? null : dayString(last),
    phase: entries.length ? entries[entries.length - 1].phase : null,
  };
}

// The colour step of a day: 0 is nothing, 1 is under 4 hours, 2 is 4 hours or more.
export function bucket(hours) {
  if (typeof hours !== 'number' || !(hours > 0)) return 0;
  return hours < 4 ? 1 : 2;
}

export function cellLabel(cell) {
  const day = niceDate(cell.date);
  if (cell.future) return `${day}: not yet`;
  if (cell.hours === null) return `${day}: no entry`;
  return `${day}: ${niceHours(cell.hours)}, phase ${cell.phase}`;
}

// One array per week, oldest first, ending with the week that holds today.
// Each week runs Monday to Sunday.
export function heatmapWeeks(list, today, weeks = 39) {
  const t = dayNumber(today);
  const byDate = new Map(cleanEntries(list).map((e) => [e.date, e]));
  const start = t - weekdayOf(t) - (weeks - 1) * 7;
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const n = start + w * 7 + d;
      const date = dayString(n);
      const future = n > t;
      const e = future ? null : byDate.get(date) || null;
      const cell = { date, hours: e ? e.hours : null, phase: e ? e.phase : null, level: e ? bucket(e.hours) : 0, future, today: n === t };
      cell.label = cellLabel(cell);
      week.push(cell);
    }
    out.push(week);
  }
  return out;
}

// The month name to print above each week column ('' for none).
export function monthLabels(weeks) {
  const months = weeks.map((week) => Number(week[0].date.slice(5, 7)));
  const labels = months.map((m, i) => (i === 0 || m !== months[i - 1] ? MONTH_NAMES[m - 1] : ''));
  // The first column's name is dropped when the next one would sit on top of it.
  if (labels.slice(1, 4).some(Boolean)) labels[0] = '';
  return labels;
}

// The calm line everybody sees.
export function statusText(info, today) {
  if (!info.lastStudied) return 'No study days yet.';
  const gap = dayNumber(today) - dayNumber(info.lastStudied);
  if (gap <= 0) return 'Today is logged.';
  if (gap === 1) return 'Last session: yesterday. Today stays open until midnight in London.';
  return `Last session: ${gap} days ago.`;
}

// The loud line only the owner sees.
export function ownerBannerText(info) {
  return info.broken ? `STREAK BROKEN. Days missed: ${info.daysMissed}. Total hours lost: ${info.hoursLost}.` : '';
}

// "1 day", "2 days".
export function dayWord(n) {
  return n === 1 ? 'day' : 'days';
}

// The address without the owner switch, so it is never reloaded, shared or
// bookmarked with the switch in it. Returns the search part ('' or '?a=b').
export function searchWithoutOwner(search) {
  const params = new URLSearchParams(search);
  params.delete('owner');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

// What the owner sees in "Ricky's log": the file, plus what this browser saved
// for dates the file does not have yet. Where the file has the date, the file
// wins, so his view matches the public one. The only exception is a date saved
// just now on this page (`fresh`), so he sees its effect before he commits.
export function overlayEntries(published, local, fresh = []) {
  const file = new Map(cleanEntries(published).map((e) => [e.date, e]));
  const keep = new Set(fresh);
  const over = [];
  const differ = [];
  for (const e of cleanEntries(local)) {
    const f = file.get(e.date);
    if (!f || keep.has(e.date)) over.push(e);
    else if (f.hours !== e.hours || f.phase !== e.phase) differ.push(e.date);
  }
  return { entries: cleanEntries([...file.values(), ...over]), laid: over.length, differ };
}

// The line to paste into the data file.
export function entryLine(entry) {
  return JSON.stringify({ date: entry.date, hours: entry.hours, phase: entry.phase });
}

// ---------- the page ----------

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) node.append(kid);
  return node;
}

function readStore(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function writeStore(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch (e) { return false; }
}
function readLocalEntries() {
  try { return cleanEntries(JSON.parse(readStore(KEY_LOCAL) || '[]')); } catch (e) { return []; }
}

// The router swaps only <main>, so a visitor who arrives from another page
// does not have this page's stylesheet yet. Add it, and wait for it.
// `on` and `later` are the page's own helpers, so destroy() also clears this wait.
function ensureStyles(on, later) {
  let link = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.getAttribute('href') === CSS_URL);
  if (link && link.sheet) return Promise.resolve();
  if (!link) {
    link = el('link', { rel: 'stylesheet', href: CSS_URL });
    document.head.appendChild(link);
  }
  return new Promise((done) => {
    later(done, 2000);
    on(link, 'load', done);
    on(link, 'error', done);
  });
}

export function initStudyLog(main) {
  const q = (name) => main.querySelector(`[data-sl-${name}]`);
  const ui = {
    status: q('status'), body: q('body'), banner: q('banner'), priv: q('private'),
    total: q('total'), current: q('current'), longest: q('longest'), phase: q('phase'),
    currentUnit: q('current-unit'), longestUnit: q('longest-unit'),
    line: q('line'), scroll: q('scroll'), grid: q('grid'), readout: q('readout'), recent: q('recent'),
    lockText: q('lock-text'), open: q('open'), form: q('form'), hours: q('hours'), phaseIn: q('phase-in'),
    error: q('error'), result: q('result'), resultText: q('result-text'), json: q('json'), copyNote: q('copy-note'),
    clear: q('clear'), clearAsk: q('clear-ask'), toOwn: q('to-own'), overlay: q('overlay'),
  };
  if (!ui.body || !ui.grid || !ui.form) return null;

  const state = { view: 'ricky', owner: false, published: [], target: TARGET, failed: false, today: londonToday(), shown: false, fresh: [] };
  const undo = [];
  const timers = new Set();
  let dead = false;
  const abort = 'AbortController' in window ? new AbortController() : null;

  function on(node, type, fn, opts) {
    if (!node) return;
    node.addEventListener(type, fn, opts);
    undo.push(() => node.removeEventListener(type, fn, opts));
  }
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  }

  // The owner's view is switched on once with ?owner=1 and off with ?owner=0.
  const flag = new URLSearchParams(location.search).get('owner');
  if (flag === '1') writeStore(KEY_OWNER, '1');
  if (flag === '0') writeStore(KEY_OWNER, null);
  // Take the switch out of the address (no navigation), so a reload, the Back
  // button or a shared link never flips it again. history.state is kept for the router.
  if (flag !== null) {
    try { history.replaceState(history.state, '', location.pathname + searchWithoutOwner(location.search) + location.hash); } catch (e) { /* leave the address as it is */ }
  }
  state.owner = readStore(KEY_OWNER) === '1';

  function canLock() { return state.view === 'own' || state.owner; }
  function overlay() { return overlayEntries(state.published, readLocalEntries(), state.fresh); }
  function entriesInView() {
    if (state.view === 'own') return readLocalEntries();
    return state.owner ? overlay().entries : state.published;
  }

  function drawGrid(entries) {
    const weeks = heatmapWeeks(entries, state.today);
    const labels = monthLabels(weeks);
    const bits = [el('span', { class: 'sl-corner', 'aria-hidden': 'true' })];
    DAY_NAMES.forEach((name, i) => bits.push(el('span', { class: 'sl-day', 'aria-hidden': 'true', text: i % 2 === 0 && i < 6 ? name : '' })));
    weeks.forEach((week, w) => {
      bits.push(el('span', { class: 'sl-month', 'aria-hidden': 'true', text: labels[w] }));
      for (const cell of week) {
        const cls = 'sl-cell' + (cell.future ? ' is-future' : ` is-l${cell.level}`) + (cell.today ? ' is-today' : '');
        bits.push(el('span', { class: cls, role: 'img', 'aria-label': cell.label, title: cell.label }));
      }
    });
    ui.grid.replaceChildren(...bits);

    const flat = weeks.flat().filter((c) => !c.future).slice(-14).reverse();
    ui.recent.replaceChildren(...flat.map((c) => el('li', { text: c.label })));
  }

  function draw() {
    state.today = londonToday();
    const local = readLocalEntries();
    const entries = entriesInView();
    const info = streakInfo(entries, state.today, state.target);

    main.querySelectorAll('[data-sl-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.slView === state.view)));

    // No banner while the file is missing: a streak worked out from half the record means nothing.
    const fileFailed = state.failed && state.view === 'ricky';
    const loud = state.owner && state.view === 'ricky' && !fileFailed ? ownerBannerText(info) : '';
    ui.banner.textContent = loud;
    ui.banner.hidden = !loud;
    ui.priv.hidden = !state.owner;

    ui.total.textContent = String(info.total);
    ui.current.textContent = String(info.current);
    ui.longest.textContent = String(info.longest);
    if (ui.currentUnit) ui.currentUnit.textContent = dayWord(info.current);
    if (ui.longestUnit) ui.longestUnit.textContent = dayWord(info.longest);
    ui.phase.textContent = info.phase ? `Phase ${info.phase}` : 'Phase –';

    let line = statusText(info, state.today);
    if (!entries.length) line = state.view === 'own' ? 'Nothing saved in this browser yet.' : 'No hours logged yet.';
    if (fileFailed) {
      line = entries.length
        ? 'The data file could not be read. Showing only what this browser saved.'
        : 'The log could not be loaded. Please try again later.';
    }
    ui.line.textContent = line;

    drawGrid(entries);

    // The lock-in part.
    const allowed = canLock();
    ui.open.hidden = !allowed || !ui.form.hidden;
    ui.toOwn.hidden = allowed;
    if (!allowed) { ui.form.hidden = true; ui.result.hidden = true; }
    ui.lockText.textContent = state.view === 'own'
      ? 'Keep your own streak here. It is saved in this browser only. Nothing is sent anywhere.'
      : allowed
        ? 'Save today, then paste the line into the data file.'
        : 'This is my record. You can keep your own streak on this page too. It stays in your browser.';
    const showClear = allowed && local.length > 0;
    ui.clear.hidden = !showClear || !ui.clearAsk.hidden;
    if (!showClear) ui.clearAsk.hidden = true;
    const over = state.owner && state.view === 'ricky' ? overlay() : { laid: 0, differ: [] };
    const notes = [];
    if (over.laid) notes.push(`${over.laid} ${over.laid === 1 ? 'entry' : 'entries'} saved in this browser ${over.laid === 1 ? 'is' : 'are'} laid over the file.`);
    if (over.differ.length) notes.push(`The file has a different entry for ${over.differ.map(niceDate).join(', ')}. The file is shown.`);
    ui.overlay.hidden = !notes.length;
    ui.overlay.textContent = notes.join(' ');
  }

  function openForm() {
    const mine = readLocalEntries().find((e) => e.date === state.today);
    const info = streakInfo(entriesInView(), state.today, state.target);
    ui.hours.value = mine ? String(mine.hours) : '';
    ui.phaseIn.value = String(mine ? mine.phase : info.phase || 1);
    ui.error.textContent = '';
    ui.result.hidden = true;
    ui.form.hidden = false;
    ui.open.hidden = true;
    ui.hours.focus();
  }
  function closeForm({ focus = true } = {}) {
    ui.form.hidden = true;
    ui.open.hidden = !canLock();
    if (focus && !ui.open.hidden) ui.open.focus();
  }

  function save(e) {
    e.preventDefault();
    const hours = Number(ui.hours.value);
    const phase = Number(ui.phaseIn.value);
    if (ui.hours.value.trim() === '' || !Number.isFinite(hours) || hours < 0 || hours > MAX_HOURS || (hours * 2) % 1 !== 0) {
      ui.error.textContent = 'Enter the hours as a number from 0 to 12, in steps of 0.5.';
      ui.hours.focus();
      return;
    }
    if (!Number.isInteger(phase) || phase < 1 || phase > 4) {
      ui.error.textContent = 'Pick a phase from 1 to 4.';
      ui.phaseIn.focus();
      return;
    }
    state.today = londonToday();
    const entry = { date: state.today, hours, phase };
    const ok = writeStore(KEY_LOCAL, JSON.stringify(cleanEntries([...readLocalEntries(), entry])));
    if (ok && !state.fresh.includes(entry.date)) state.fresh.push(entry.date);
    ui.error.textContent = '';
    ui.resultText.textContent = (ok ? `Saved for ${niceDate(entry.date)}. ` : 'This browser would not save it. ')
      + (state.owner ? 'Paste this line into the data file:' : 'This is your entry:');
    ui.json.textContent = entryLine(entry);
    ui.copyNote.textContent = '';
    ui.result.hidden = false;
    closeForm({ focus: false });
    draw();
    ui.result.focus({ preventScroll: true });
  }

  async function copyLine() {
    let ok = false;
    try { await navigator.clipboard.writeText(ui.json.textContent); ok = true; } catch (e) { ok = false; }
    if (dead) return;
    ui.copyNote.textContent = ok ? 'Copied.' : 'Could not copy. Select the line and copy it by hand.';
    if (ok) later(() => { ui.copyNote.textContent = ''; }, 2500);
  }

  on(main, 'click', (e) => {
    const t = e.target.closest('button, [data-sl-grid] .sl-cell');
    if (!t || !main.contains(t)) return;
    if (t.matches('.sl-cell')) { ui.readout.textContent = t.getAttribute('aria-label'); return; }
    if (t.dataset.slView) {
      state.view = t.dataset.slView;
      ui.form.hidden = true;
      ui.result.hidden = true;
      ui.clearAsk.hidden = true;
      draw();
    } else if (t === ui.toOwn) {
      state.view = 'own';
      draw();
      const pressed = main.querySelector('[data-sl-view="own"]');
      if (pressed) pressed.focus();
    } else if (t === ui.open) openForm();
    else if (t.hasAttribute('data-sl-cancel')) closeForm();
    else if (t.hasAttribute('data-sl-copy')) copyLine();
    else if (t === ui.clear) { ui.clearAsk.hidden = false; ui.clear.hidden = true; const keep = ui.clearAsk.querySelector('[data-sl-clear-no]'); if (keep) keep.focus(); }
    else if (t.hasAttribute('data-sl-clear-yes')) {
      writeStore(KEY_LOCAL, null);
      state.fresh = [];
      ui.clearAsk.hidden = true;
      ui.result.hidden = true;
      draw();
      // The pressed button is gone now. Hand the focus to what is still there.
      if (!ui.open.hidden) ui.open.focus();
      else if (!ui.form.hidden) ui.hours.focus();
    } else if (t.hasAttribute('data-sl-clear-no')) { ui.clearAsk.hidden = true; draw(); if (!ui.clear.hidden) ui.clear.focus(); }
    else if (t.hasAttribute('data-sl-private-off')) {
      writeStore(KEY_OWNER, null);
      state.owner = false;
      draw();
      const back = main.querySelector('[data-sl-view="ricky"]');
      if (back) back.focus();
    }
  });
  on(ui.grid, 'pointerover', (e) => {
    const c = e.target.closest('.sl-cell');
    if (c) ui.readout.textContent = c.getAttribute('aria-label');
  });
  on(ui.form, 'submit', save);
  on(ui.form, 'keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeForm(); } });
  // Another tab saved or cleared something: show it here too.
  on(window, 'storage', (e) => {
    if (e.key !== null && e.key !== KEY_LOCAL && e.key !== KEY_OWNER) return;
    state.owner = readStore(KEY_OWNER) === '1';
    if (state.shown) draw();
  });
  // A new day in London starts a new column and may end a streak.
  const tick = setInterval(() => { if (state.shown && londonToday() !== state.today) draw(); }, 30000);

  // The stylesheet keeps the "needs JavaScript" line out of sight while scripts are
  // on their way. From here on the line is ours, so let it show.
  ui.status.setAttribute('data-sl-live', '');
  ui.status.textContent = 'Loading the log…';
  const data = fetch(DATA_URL, { cache: 'no-store', signal: abort ? abort.signal : undefined })
    .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
    .then((json) => {
      if (!json || typeof json !== 'object' || !Array.isArray(json.entries)) throw new Error('not a log');
      state.published = cleanEntries(json.entries);
      if (typeof json.target_hours === 'number' && json.target_hours > 0 && json.target_hours <= 24) state.target = json.target_hours;
    })
    .catch(() => { state.failed = true; });

  Promise.all([data, ensureStyles(on, later)]).then(() => {
    if (dead) return;
    draw();
    ui.status.textContent = '';
    ui.status.hidden = true;
    ui.body.hidden = false;
    state.shown = true;
    // Start at the newest weeks when the grid is wider than the screen.
    ui.scroll.scrollLeft = ui.scroll.scrollWidth;
  });

  return {
    destroy() {
      dead = true;
      if (abort) abort.abort();
      clearInterval(tick);
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      undo.forEach((fn) => fn());
      undo.length = 0;
    },
  };
}
