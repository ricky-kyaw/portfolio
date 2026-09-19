// The Play page: a game of chess against Ransom, the engine, running in the browser.
// rules.js is the referee, board.js the board, engine.js the engine's thread.

import { START_FEN, fromFen, toFen, makeMove, toSan, toUci, fromUci, parseMove, gameState, repetitionKey, kingSquare } from './play/rules.js';
import { createBoard } from './play/board.js';
import { createEngine } from './play/engine.js';

// "Full strength" thinks by the clock, like the original. The two lighter settings are the
// same engine told to stop looking after a few half-moves.
const LEVELS = {
  gentle: { depth: 2, softMs: 1e9, hardMs: 1e9, label: 'Gentle' },
  club: { depth: 5, softMs: 1e9, hardMs: 1e9, label: 'Club' },
  full: { depth: 0, softMs: 1000, hardMs: 2000, label: 'Full strength' },
};
const STORE = 'play:game';
const UNITS_PER_PAWN = 161.9; // the engine scores in network centipawns times 1.619 (cg_eval.py)

export function initPlay(main) {
  const $ = (sel) => main.querySelector(sel);
  const el = {
    board: $('[data-board]'), status: $('[data-status]'), moves: $('[data-moves]'),
    depth: $('[data-depth]'), score: $('[data-score]'), nodes: $('[data-nodes]'), best: $('[data-best]'),
    form: $('[data-move-form]'), input: $('[data-move-input]'), hint: $('[data-move-hint]'),
    undo: $('[data-undo]'), fresh: $('[data-new]'), flip: $('[data-flip]'), copy: $('[data-copy-moves]'),
  };
  if (!el.board || !el.status) return null;

  let alive = true;
  let human = 'w', level = 'full', flipped = false;
  let positions = [fromFen(START_FEN)]; // positions[i] is the position before moves[i]
  let moves = [];                       // { move, san }
  let engineState = 'loading';          // loading | ready | failed
  let engineLoaded = false;             // did the engine ever start? (a failed search is not a failed download)
  let thinking = false, turnToken = 0, opToken = 0;
  let timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { timers = timers.filter((x) => x !== t); if (alive) fn(); }, ms); timers.push(t); };

  const board = createBoard(el.board, { onMove: (m) => humanMove(m) });
  const engine = createEngine({
    onIteration: (it) => { if (alive && thinking) paintReadout(it, false); },
  });

  const current = () => positions[positions.length - 1];
  const earlierKeys = () => positions.slice(0, -1).map(repetitionKey);
  const state = () => gameState(current(), earlierKeys());

  // ---------- painting ----------
  function paintBoard() {
    const pos = current(), st = state();
    const mine = !st.over && pos.turn === human && !thinking;
    const last = moves.length ? moves[moves.length - 1].move : null;
    board.set({ pos, legal: mine ? st.moves : [], flipped, last, check: st.check ? kingSquare(pos, pos.turn) : -1, active: mine });
  }

  function paintMoves() {
    el.moves.textContent = '';
    for (let i = 0; i < moves.length; i += 2) {
      const li = document.createElement('li');
      const w = document.createElement('span'); w.textContent = moves[i].san;
      const b = document.createElement('span'); b.textContent = moves[i + 1] ? moves[i + 1].san : '';
      li.append(w, b);
      el.moves.appendChild(li);
    }
    el.moves.scrollTop = el.moves.scrollHeight;
    el.undo.disabled = moves.length === 0 || (moves.length === 1 && human === 'b');
    if (el.copy) el.copy.disabled = moves.length === 0;
  }

  function paintStatus(extra = '') {
    const pos = current(), st = state();
    let text;
    if (st.over) {
      const who = st.result === '1/2-1/2' ? 'A draw' : (st.result === '1-0') === (human === 'w') ? 'You won' : 'Ransom won';
      text = `${who}: ${st.reason}.`;
    } else if (pos.turn === human) text = (st.check ? 'Check. ' : '') + 'Your move.';
    else if (engineState === 'loading') text = 'Loading the engine…';
    else if (engineState === 'failed') text = 'The engine could not start, so it cannot reply.';
    else text = 'Ransom is thinking…';
    say((extra ? extra + ' ' : '') + text);
  }
  // The status line is read out by screen readers, so it is only touched when the words change.
  function say(text) { if (el.status.textContent !== text) el.status.textContent = text; }

  function paintReadout(it, final) {
    if (!it) { el.depth.textContent = el.score.textContent = el.nodes.textContent = el.best.textContent = '–'; return; }
    const pos = current();
    el.depth.textContent = `${it.depth} half-move${it.depth === 1 ? '' : 's'}`;
    const mate = Math.abs(it.score) > 29000;
    const forWhite = pos.turn === 'w' ? it.score : -it.score; // the engine scores from the side that is to move
    const pawns = (Math.abs(forWhite) / UNITS_PER_PAWN).toFixed(1);
    el.score.textContent = mate ? (it.score > 0 ? 'it sees a forced mate' : 'it sees it is being mated')
      : pawns === '0.0' ? 'level' : `${forWhite > 0 ? '+' : '−'}${pawns} pawns for White`;
    const rate = final && it.ms > 20 ? ` (${Math.round(it.nodes / (it.ms / 1000)).toLocaleString('en-GB')} a second)` : '';
    el.nodes.textContent = it.nodes.toLocaleString('en-GB') + rate;
    const m = it.move ? fromUci(pos, it.move) : null;
    el.best.textContent = m ? toSan(pos, m) : '–';
  }

  function paint(extra) { paintBoard(); paintMoves(); paintStatus(extra); if (el.hint) el.hint.textContent = ''; }

  // ---------- playing ----------
  function push(move) {
    const pos = current();
    moves.push({ move, san: toSan(pos, move) });
    positions.push(makeMove(pos, move));
    save();
  }

  function humanMove(move) {
    if (thinking || current().turn !== human || state().over) return;
    push(move);
    const said = `You played ${moves[moves.length - 1].san}.`;
    paint(said);
    engineTurn(said);
  }

  async function engineTurn(said = '') {
    if (!alive || thinking || state().over || current().turn === human) return;
    if (engineState !== 'ready') return; // it will be called again once the engine is ready
    thinking = true;
    const token = ++turnToken;
    paint(said); // keep "You played e4." in the line that screen readers hear
    const pos = current(), lv = LEVELS[level], began = performance.now();
    try {
      const result = await engine.go({ fen: toFen(pos), earlier: positions.slice(0, -1).map(toFen), softMs: lv.softMs, hardMs: lv.hardMs, depth: lv.depth });
      if (!alive || token !== turnToken) return;
      const move = fromUci(pos, result.move);
      if (!move) throw new Error(`the engine answered "${result.move}", which is not a legal move here`);
      paintReadout(result, true);
      const wait = Math.max(0, 350 - (performance.now() - began)); // an instant reply feels like a glitch
      later(() => {
        if (token !== turnToken) return;
        thinking = false;
        push(move);
        paint(`Ransom played ${moves[moves.length - 1].san}.`);
      }, wait);
    } catch (err) {
      if (!alive || token !== turnToken) return;
      thinking = false;
      if (err && err.message === 'cancelled') return;
      engineState = 'failed';
      paint();
      say(`Something went wrong: ${String((err && err.message) || err).replace(/\.$/, '')}. Start a new game to try again.`);
    }
  }

  async function stopThinking() {
    turnToken++;
    thinking = false;
    timers.forEach(clearTimeout); timers = [];
    if (engine.thinking) { try { await engine.cancel(); } catch (e) { /* the thread is rebuilt */ } }
    await engine.whenUp(); // a second click can arrive while the thread is still being rebuilt
  }

  async function newGame(side = human) {
    const op = ++opToken;
    await stopThinking();
    if (!alive || op !== opToken) return; // a later click has taken over
    human = side;
    flipped = human === 'b';
    positions = [fromFen(START_FEN)];
    moves = [];
    if (engineState === 'failed' && engineLoaded) engineState = 'ready';
    engine.newGame();
    paintReadout(null);
    save();
    paint();
    markChoices();
    engineTurn();
  }

  async function takeBack() {
    if (!moves.length) return;
    const op = ++opToken;
    await stopThinking();
    if (!alive || op !== opToken) return;
    // go back to the person's own last turn (the start position always stays)
    while (moves.length) { moves.pop(); positions.pop(); if (current().turn === human) break; }
    paintReadout(null);
    save();
    paint('Taken back.');
    engineTurn();
  }

  // The game as a line of text that any chess program can read: "1. e4 c5 2. Nf3 d6 *".
  function movesAsText() {
    const parts = [];
    moves.forEach((m, i) => { if (i % 2 === 0) parts.push(`${i / 2 + 1}.`); parts.push(m.san); });
    parts.push(state().result);
    return parts.join(' ');
  }
  async function copyMoves() {
    const was = el.copy.textContent;
    let ok = false;
    try { await navigator.clipboard.writeText(movesAsText()); ok = true; } catch (e) { ok = false; }
    el.copy.textContent = ok ? 'Copied' : 'Could not copy';
    later(() => { el.copy.textContent = was; }, 1400);
  }

  // ---------- controls ----------
  function markChoices() {
    main.querySelectorAll('[data-side]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === human)));
    main.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === level)));
  }

  function onClick(e) {
    const b = e.target.closest('button');
    if (!b || !main.contains(b)) return;
    if (b.dataset.side) { if (b.dataset.side !== human || moves.length) newGame(b.dataset.side); }
    else if (b.dataset.level) { level = b.dataset.level; save(); markChoices(); }
    else if (b === el.fresh) newGame();
    else if (b === el.undo) takeBack();
    else if (b === el.flip) { flipped = !flipped; paintBoard(); }
    else if (b === el.copy) copyMoves();
  }

  function onSubmit(e) {
    e.preventDefault();
    const text = el.input.value.trim();
    if (!text) return;
    const pos = current(), st = state();
    let note = '';
    if (st.over) note = 'The game is over. Start a new one to keep playing.';
    else if (pos.turn !== human || thinking) note = 'Wait for Ransom to move first.';
    else {
      const move = parseMove(pos, text, st.moves);
      if (move) { el.input.value = ''; el.hint.textContent = ''; humanMove(move); return; }
      note = `"${text}" is not a legal move here. Write it like e4, Nf3, exd5 or O-O.`;
    }
    el.hint.textContent = note;
  }

  // ---------- remember the game while this tab stays open ----------
  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify({ human, level, moves: moves.map((m) => toUci(m.move)) })); } catch (e) { /* fine */ }
  }
  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
      if (!saved || !Array.isArray(saved.moves)) return;
      if (saved.human === 'w' || saved.human === 'b') human = saved.human;
      if (LEVELS[saved.level]) level = saved.level;
      for (const u of saved.moves) {
        const m = fromUci(current(), String(u));
        if (!m) break;
        moves.push({ move: m, san: toSan(current(), m) });
        positions.push(makeMove(current(), m));
      }
      flipped = human === 'b';
    } catch (e) { /* start fresh */ }
  }

  main.addEventListener('click', onClick);
  if (el.form) el.form.addEventListener('submit', onSubmit);

  restore();
  markChoices();
  paintReadout(null);
  paint();

  engine.ready.then(() => {
    if (!alive) return;
    engineLoaded = true;
    engineState = 'ready';
    paintStatus();
    engineTurn();
  }).catch((err) => {
    if (!alive) return;
    engineState = 'failed';
    paintStatus();
    say(`The engine could not start (${String((err && err.message) || err).replace(/\.$/, '')}). You can still move the pieces.`);
  });

  return {
    destroy() {
      alive = false;
      turnToken++;
      timers.forEach(clearTimeout);
      main.removeEventListener('click', onClick);
      if (el.form) el.form.removeEventListener('submit', onSubmit);
      board.destroy();
      engine.destroy();
    },
  };
}
