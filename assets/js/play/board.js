// The chess board: 64 buttons in a grid. Click a piece and then a square, or drag
// it, or walk the board with the arrow keys and press Enter. The board knows
// nothing about the rules: it is handed the legal moves and reports the one chosen.

import { pieceSVG, pieceName } from './pieces.js';
import { squareName } from './rules.js';

export function createBoard(root, { onMove }) {
  const grid = document.createElement('div');
  grid.className = 'board-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Chess board');
  const picker = document.createElement('div');
  picker.className = 'promo';
  picker.hidden = true;
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Choose a piece to promote to');
  root.append(grid, picker);

  const squares = [];
  for (let i = 0; i < 64; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sq';
    grid.appendChild(b);
    squares.push(b);
  }

  let state = { pos: null, legal: [], flipped: false, last: null, check: -1, active: false };
  let selected = -1;
  let focusSq = 12; // e2
  let drag = null;
  let suppressClick = false;

  const sqOf = (el) => (el && el.dataset && el.dataset.sq !== undefined ? Number(el.dataset.sq) : -1);
  const elOf = (sq) => squares.find((b) => Number(b.dataset.sq) === sq);
  const targets = (from) => state.legal.filter((m) => m.from === from);

  function render() {
    const { pos, flipped, last, check } = state;
    const mine = selected >= 0 ? targets(selected) : [];
    squares.forEach((b, i) => {
      // screen order runs from the top-left corner; work out which square sits there
      const row = i >> 3, col = i & 7;
      const sq = flipped ? row * 8 + (7 - col) : (7 - row) * 8 + col;
      const piece = pos ? pos.board[sq] : '';
      const dark = ((sq & 7) + (sq >> 3)) % 2 === 0;
      b.dataset.sq = sq;
      b.className = 'sq ' + (dark ? 'sq--dark' : 'sq--light')
        + (last && (last.from === sq || last.to === sq) ? ' is-last' : '')
        + (sq === selected ? ' is-selected' : '')
        + (sq === check ? ' is-check' : '')
        + (mine.some((m) => m.to === sq) ? (piece || mine.some((m) => m.to === sq && m.ep) ? ' is-capture' : ' is-target') : '');
      const coordFile = row === 7 ? `<span class="coord coord--file" aria-hidden="true">${squareName(sq)[0]}</span>` : '';
      const coordRank = col === 0 ? `<span class="coord coord--rank" aria-hidden="true">${squareName(sq)[1]}</span>` : '';
      b.innerHTML = coordRank + coordFile + (piece ? pieceSVG(piece) : '');
      b.setAttribute('aria-label', squareName(sq) + (piece ? ', ' + pieceName(piece) : ', empty') + (mine.some((m) => m.to === sq) ? ', you can move here' : ''));
      b.setAttribute('aria-pressed', String(sq === selected));
      b.tabIndex = sq === focusSq ? 0 : -1;
    });
  }

  function choose(from, to) {
    const options = state.legal.filter((m) => m.from === from && m.to === to);
    if (!options.length) return false;
    selected = -1;
    if (options.length === 1) { onMove(options[0]); return true; }
    askPromotion(options);
    return true;
  }

  const backToBoard = () => { const el = elOf(focusSq); if (el) el.focus(); };
  picker.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    picker.hidden = true;
    render();
    backToBoard();
  });

  function askPromotion(options) {
    picker.textContent = '';
    for (const m of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'promo-btn';
      const piece = state.pos.turn === 'w' ? m.promo.toUpperCase() : m.promo;
      b.innerHTML = pieceSVG(piece);
      b.setAttribute('aria-label', 'Promote to a ' + pieceName(piece).split(' ')[1]);
      b.addEventListener('click', () => { picker.hidden = true; onMove(m); backToBoard(); });
      picker.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'promo-cancel';
    cancel.textContent = 'cancel';
    cancel.addEventListener('click', () => { picker.hidden = true; render(); backToBoard(); });
    picker.appendChild(cancel);
    picker.hidden = false;
    render();
    picker.querySelector('button').focus();
  }

  function press(sq) {
    focusSq = sq; // remembered even while the board is waiting, so the arrow keys carry on from here
    if (!state.active || !state.pos) { render(); return; }
    if (selected >= 0 && sq !== selected && choose(selected, sq)) return;
    selected = sq !== selected && targets(sq).length ? sq : -1;
    render();
    const el = elOf(sq);
    if (el && document.activeElement !== el && grid.contains(document.activeElement)) el.focus();
  }

  grid.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const sq = sqOf(e.target.closest('.sq'));
    if (sq >= 0) press(sq);
  });

  // Arrow keys walk the board the way it is drawn on screen.
  grid.addEventListener('keydown', (e) => {
    const step = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (e.key === 'Escape' && selected >= 0) { selected = -1; render(); elOf(focusSq).focus(); return; }
    if (!step || e.metaKey || e.ctrlKey || e.altKey) return;
    const here = sqOf(document.activeElement);
    if (here >= 0) focusSq = here;
    const sign = state.flipped ? -1 : 1;
    const f = (focusSq & 7) + step[0] * sign, r = (focusSq >> 3) + step[1] * sign;
    if (f < 0 || f > 7 || r < 0 || r > 7) return;
    e.preventDefault();
    e.stopPropagation();
    focusSq = r * 8 + f;
    render();
    elOf(focusSq).focus();
  });

  // Dragging. A press that does not travel is left to the click handler above.
  grid.addEventListener('pointerdown', (e) => {
    if (!state.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.pointerType === 'touch') return; // on a touch screen a drag scrolls the page; tap the piece, then the square
    const sq = sqOf(e.target.closest('.sq'));
    if (sq < 0 || !targets(sq).length) return;
    drag = { from: sq, id: e.pointerId, x: e.clientX, y: e.clientY, ghost: null };
  });
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      const src = elOf(drag.from);
      const size = src.getBoundingClientRect().width;
      const ghost = document.createElement('div');
      ghost.className = 'piece-ghost';
      ghost.style.width = ghost.style.height = size + 'px';
      ghost.innerHTML = pieceSVG(state.pos.board[drag.from]);
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      selected = drag.from;
      focusSq = drag.from;
      render();
      elOf(drag.from).classList.add('is-lifted');
    }
    drag.ghost.style.transform = `translate(${e.clientX - drag.ghost.offsetWidth / 2}px, ${e.clientY - drag.ghost.offsetHeight / 2}px)`;
    e.preventDefault();
  }

  function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.ghost) return;
    d.ghost.remove();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const under = e.type === 'pointerup' ? document.elementFromPoint(e.clientX, e.clientY) : null;
    const to = sqOf(under && under.closest ? under.closest('.sq') : null);
    if (to >= 0 && to !== d.from && choose(d.from, to)) return;
    selected = to === d.from ? d.from : -1; // dropped where it started: keep it selected, like a click
    render();
  }

  return {
    // pos: a position from rules.js; legal: its legal moves (empty when it is not the person's turn)
    set(next) {
      state = { ...state, ...next };
      if (!state.legal.some((m) => m.from === selected)) selected = -1;
      const hadFocus = !picker.hidden && picker.contains(document.activeElement);
      picker.hidden = true;
      render();
      if (hadFocus) backToBoard();
    },
    focus() { const el = elOf(focusSq); if (el) el.focus(); },
    destroy() {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
      window.removeEventListener('pointercancel', onDragEnd);
      if (drag && drag.ghost) drag.ghost.remove();
      root.textContent = '';
    },
  };
}
