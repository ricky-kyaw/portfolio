// Chunky block lettering, drawn from cell grids. No font file.
//
// Each lit cell is a white square with a fine grid inside it. A blue layer
// peeks out on one side and an amber layer on the other, with a hard black
// shadow between, so the letters look stacked. The real text stays in the
// page for screen readers and search engines; the drawing is decoration.

const GLYPHS = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01111 10000 10000 10000 10000 10000 01111', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01111 10000 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '11111 00100 00100 00100 00100 00100 11111', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11110 00001 00001 01110 00001 00001 11110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  '-': '000 000 000 111 000 000 000', '.': '0 0 0 0 0 0 1', ' ': '000 000 000 000 000 000 000',
};
GLYPHS['–'] = GLYPHS['-'];

const NS = 'http://www.w3.org/2000/svg';

export function pixelSVG(text, { cell = 12 } = {}) {
  const lit = [];
  let x = 0;
  for (const ch of text.toUpperCase()) {
    const rows = (GLYPHS[ch] || GLYPHS[' ']).split(' ');
    rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '1') lit.push([x + c, r]); });
    x += rows[0].length + 1;
  }
  const cols = Math.max(1, x - 1);
  const pad = Math.ceil(cell * 0.4);
  const W = cols * cell + pad * 2, H = 7 * cell + pad * 2;

  const layer = (dx, dy) => lit.map(([c, r]) => `M${pad + c * cell + dx} ${pad + r * cell + dy}h${cell}v${cell}h-${cell}z`).join('');
  const third = cell / 3;
  const grid = lit.map(([c, r]) => {
    const x0 = pad + c * cell, y0 = pad + r * cell;
    return `M${x0 + third} ${y0}v${cell}M${x0 + 2 * third} ${y0}v${cell}M${x0} ${y0 + third}h${cell}M${x0} ${y0 + 2 * third}h${cell}M${x0} ${y0}h${cell}M${x0} ${y0}v${cell}`;
  }).join('');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'pixel-text');
  svg.style.aspectRatio = `${W} / ${H}`;
  svg.style.setProperty('--cols', String(cols)); // the stylesheet sizes the drawing by its cell count
  const add = (d, attrs) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    for (const k in attrs) p.setAttribute(k, attrs[k]);
    svg.appendChild(p);
  };
  add(layer(cell * 0.30, cell * 0.30), { fill: '#F2B233', 'shape-rendering': 'crispEdges' });
  add(layer(-cell * 0.22, cell * 0.12), { fill: '#3B6BFF', 'shape-rendering': 'crispEdges' });
  add(layer(cell * 0.12, cell * 0.12), { fill: '#000', 'shape-rendering': 'crispEdges' });
  add(layer(0, 0), { fill: '#F4F5F7', 'shape-rendering': 'crispEdges' });
  add(grid, { fill: 'none', stroke: '#C5CAD3', 'stroke-width': Math.max(0.6, cell / 16) });
  return svg;
}

// Turn every [data-pixel] element into block lettering, keeping its words.
export function applyPixelText(root = document) {
  root.querySelectorAll('[data-pixel]:not(.is-pixel)').forEach((el) => {
    const text = el.textContent.trim();
    if (!text) return;
    const words = document.createElement('span');
    words.className = 'visually-hidden';
    words.textContent = text;
    el.textContent = '';
    el.append(words, pixelSVG(text));
    el.classList.add('is-pixel');
  });
}
