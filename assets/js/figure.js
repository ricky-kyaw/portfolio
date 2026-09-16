// Figure 1: a random walk of 240 coin flips, drawn on the page's graph paper.
// It draws itself once per visit. Coming back to Home shows the same walk,
// already finished. Only the "random" command flips the coins again.

const N = 240;
const STEP = 0.1;
const W = 480;
const H = 240;
const GL = 32;   // left gutter for the y labels
const PR = 10;   // right padding
const TOP = 14;
const BOT = 26;  // room for the x labels
const KEY = 'fig1';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const round1 = (x) => Math.round(x * 10) / 10;

export function makeWalk() {
  const w = [0];
  for (let i = 0; i < N; i++) w.push(round1(w[i] + (Math.random() < 0.5 ? STEP : -STEP)));
  return w;
}

export function fmtEnd(v) {
  const sign = v > 0.0001 ? '+' : v < -0.0001 ? '−' : '';
  return sign + Math.abs(v).toFixed(1);
}

function load() {
  try {
    const w = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (Array.isArray(w) && w.length === N + 1 && w.every((x) => typeof x === 'number' && Number.isFinite(x))) return w;
  } catch (e) { /* ignore */ }
  return null;
}

function save(w) {
  try { sessionStorage.setItem(KEY, JSON.stringify(w)); } catch (e) { /* ignore */ }
}

function svgText(attrs, text) {
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  for (const k in attrs) t.setAttribute(k, attrs[k]);
  t.textContent = text;
  return t;
}

export function initFigure(svg) {
  const path = svg.querySelector('.walk');
  const dot = svg.querySelector('.dot');
  const end = svg.querySelector('.end');
  const axis = svg.querySelector('.axis');
  const yTicks = svg.querySelector('.y-ticks');
  const endNote = document.getElementById('fig1-end');
  if (!path || !dot || !end || !axis || !yTicks) return null;

  let generation = 0;
  let walk = load();
  let firstDraw = false;
  if (!walk) {
    walk = makeWalk();
    save(walk);
    firstDraw = true;
  }

  function fitStroke() {
    const w = svg.clientWidth;
    if (w > 0) {
      const scale = W / w;
      path.style.strokeWidth = (1.5 * scale).toFixed(2);
      svg.style.setProperty('--fig-scale', scale.toFixed(3));
    }
  }

  function render(w, animate) {
    let lo = Math.min(0, ...w);
    let hi = Math.max(0, ...w);
    let range = hi - lo;
    if (range < 1) { const extra = (1 - range) / 2; lo -= extra; hi += extra; range = 1; }
    const pad = range * 0.1;
    lo -= pad; hi += pad;
    const sy = (v) => TOP + ((hi - v) / (hi - lo)) * (H - TOP - BOT);
    const sx = (i) => GL + (i / N) * (W - GL - PR);

    const y0 = sy(0).toFixed(1);
    axis.setAttribute('y1', y0);
    axis.setAttribute('y2', y0);

    yTicks.textContent = '';
    for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
      const label = k > 0 ? '+' + k : k < 0 ? '−' + -k : '0';
      yTicks.appendChild(svgText({ class: 'tick', x: GL - 8, y: sy(k).toFixed(1), dy: '0.35em', 'text-anchor': 'end' }, label));
    }

    path.setAttribute('d', 'M' + w.map((v, i) => `${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' L'));

    const ex = sx(N);
    const ey = sy(w[N]);
    const flip = ex > W - 70;
    dot.setAttribute('cx', ex.toFixed(1));
    dot.setAttribute('cy', ey.toFixed(1));
    end.setAttribute('x', (flip ? ex - 8 : ex + 8).toFixed(1));
    end.setAttribute('y', ey.toFixed(1));
    end.setAttribute('text-anchor', flip ? 'end' : 'start');
    end.textContent = 'ends at ' + fmtEnd(w[N]);
    if (endNote) endNote.textContent = 'The line ends at ' + fmtEnd(w[N]) + '.';

    fitStroke();
    svg.classList.add('is-ready');
    if (animate && !reduced.matches) draw();
    else finish();
  }

  function finish() {
    path.classList.remove('is-drawing');
    path.style.strokeDasharray = '';
    path.style.strokeDashoffset = '';
    path.classList.add('is-ready');
    dot.classList.remove('is-hidden');
    end.classList.remove('is-hidden');
  }

  function draw() {
    const gen = ++generation;
    const L = path.getTotalLength();
    path.classList.remove('is-drawing');
    path.style.strokeDasharray = String(L);
    path.style.strokeDashoffset = String(L);
    path.classList.add('is-ready');
    dot.classList.add('is-hidden');
    end.classList.add('is-hidden');
    // Make sure the browser has seen the start state before we animate.
    path.getBoundingClientRect();
    const done = () => {
      if (gen !== generation) return;
      path.removeEventListener('transitionend', done);
      finish();
    };
    setTimeout(() => {
      if (gen !== generation) return;
      path.addEventListener('transitionend', done);
      path.classList.add('is-drawing');
      path.style.strokeDashoffset = '0';
      setTimeout(done, 1800); // in case the tab was hidden and the event never came
    }, 300);
  }

  let resizeTimer;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitStroke, 100); };
  window.addEventListener('resize', onResize);

  render(walk, firstDraw);

  return {
    redraw() {
      walk = makeWalk();
      save(walk);
      render(walk, true);
      return fmtEnd(walk[N]);
    },
    end: () => fmtEnd(walk[N]),
    destroy() {
      generation++;
      window.removeEventListener('resize', onResize);
    },
  };
}
