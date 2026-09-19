// The rules of chess, for the Play page. No engine code here: this is the
// referee. It decides which moves are legal, when the game is over, and how a
// move is written down. The engine gets a position and sends back a move; the
// page only plays that move if this file agrees it is legal.
//
// Squares are numbered a1 = 0, b1 = 1 ... h8 = 63 (rank * 8 + file).
// Pieces are letters as in FEN: upper case white, lower case black.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
const ROOK = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const BISHOP = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

export const squareName = (sq) => FILES[sq & 7] + ((sq >> 3) + 1);
export const squareIndex = (name) => (/^[a-h][1-8]$/.test(name) ? FILES.indexOf(name[0]) + (Number(name[1]) - 1) * 8 : -1);
export const isWhite = (p) => p !== '' && p === p.toUpperCase();
const colourOf = (p) => (p === '' ? '' : isWhite(p) ? 'w' : 'b');
const other = (c) => (c === 'w' ? 'b' : 'w');

// ---------- FEN ----------
export function fromFen(fen) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 4) throw new Error('A FEN needs at least four fields.');
  const rows = parts[0].split('/');
  if (rows.length !== 8) throw new Error('The board part of the FEN needs eight rows.');
  const board = new Array(64).fill('');
  rows.forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) file += Number(ch);
      else if (/[pnbrqkPNBRQK]/.test(ch)) { if (file > 7) throw new Error('A row is too long.'); board[(7 - r) * 8 + file] = ch; file += 1; }
      else throw new Error(`"${ch}" is not a piece.`);
    }
    if (file !== 8) throw new Error('A row does not add up to eight squares.');
  });
  if (board.filter((p) => p === 'K').length !== 1 || board.filter((p) => p === 'k').length !== 1) throw new Error('Each side needs exactly one king.');
  if (board.some((p, sq) => (p === 'P' || p === 'p') && ((sq >> 3) === 0 || (sq >> 3) === 7))) throw new Error('A pawn cannot stand on the first or last rank.');
  if (!/^[wb]$/.test(parts[1])) throw new Error('The side to move must be w or b.');
  if (!/^(-|K?Q?k?q?)$/.test(parts[2])) throw new Error('The castling field is not valid.');
  const pos = {
    board,
    turn: parts[1],
    castling: parts[2] === '-' ? '' : parts[2],
    ep: parts[3] === '-' ? -1 : squareIndex(parts[3]),
    half: Math.max(0, parseInt(parts[4], 10) || 0),
    full: Math.max(1, parseInt(parts[5], 10) || 1),
  };
  if (parts[3] !== '-' && pos.ep < 0) throw new Error('The en passant square is not valid.');
  if (pos.ep >= 0) {
    // It must be the empty square a pawn of the side that just moved has jumped over.
    const white = pos.turn === 'w';
    const real = (pos.ep >> 3) === (white ? 5 : 2) && board[pos.ep] === '' && board[pos.ep + (white ? -8 : 8)] === (white ? 'p' : 'P') && board[pos.ep + (white ? 8 : -8)] === '';
    if (!real) pos.ep = -1;
  }
  // Castling rights only count while the king and rook still stand on their first squares.
  const keep = { K: board[4] === 'K' && board[7] === 'R', Q: board[4] === 'K' && board[0] === 'R', k: board[60] === 'k' && board[63] === 'r', q: board[60] === 'k' && board[56] === 'r' };
  pos.castling = [...pos.castling].filter((c) => keep[c]).join('');
  if (attacked(pos, kingSquare(pos, other(pos.turn)), pos.turn)) throw new Error('The side that just moved is still in check.');
  return pos;
}

export function toFen(pos) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', gap = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[r * 8 + f];
      if (p === '') gap += 1; else { if (gap) { row += gap; gap = 0; } row += p; }
    }
    rows.push(row + (gap || ''));
  }
  return `${rows.join('/')} ${pos.turn} ${pos.castling || '-'} ${pos.ep < 0 ? '-' : squareName(pos.ep)} ${pos.half} ${pos.full}`;
}

// ---------- attacks ----------
export function kingSquare(pos, colour) { return pos.board.indexOf(colour === 'w' ? 'K' : 'k'); }

// Is `sq` attacked by any piece of colour `by`?
export function attacked(pos, sq, by) {
  const b = pos.board, f = sq & 7, r = sq >> 3;
  const mine = (p, kinds) => p !== '' && colourOf(p) === by && kinds.includes(p.toLowerCase());
  const at = (ff, rr) => (ff < 0 || ff > 7 || rr < 0 || rr > 7 ? null : b[rr * 8 + ff]);
  const pr = by === 'w' ? r - 1 : r + 1; // a pawn that attacks sq stands one rank behind it
  if (mine(at(f - 1, pr) || '', 'p') || mine(at(f + 1, pr) || '', 'p')) return true;
  for (const [df, dr] of KNIGHT) if (mine(at(f + df, r + dr) || '', 'n')) return true;
  for (const [df, dr] of KING) if (mine(at(f + df, r + dr) || '', 'k')) return true;
  const slide = (dirs, kinds) => {
    for (const [df, dr] of dirs) {
      let ff = f + df, rr = r + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const p = b[rr * 8 + ff];
        if (p !== '') { if (mine(p, kinds)) return true; break; }
        ff += df; rr += dr;
      }
    }
    return false;
  };
  return slide(ROOK, 'rq') || slide(BISHOP, 'bq');
}

export const inCheck = (pos) => attacked(pos, kingSquare(pos, pos.turn), other(pos.turn));

// ---------- moves ----------
// A move: { from, to, piece, captured, promo, ep, castle, double }
function pseudoMoves(pos) {
  const b = pos.board, us = pos.turn, out = [];
  const add = (from, to, extra) => out.push({ from, to, piece: b[from], captured: b[to], promo: '', ep: false, castle: '', double: false, ...extra });
  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (p === '' || colourOf(p) !== us) continue;
    const f = from & 7, r = from >> 3, kind = p.toLowerCase();
    if (kind === 'p') {
      const dir = us === 'w' ? 1 : -1, home = us === 'w' ? 1 : 6, last = us === 'w' ? 7 : 0;
      const push = (to, extra) => {
        if ((to >> 3) === last) for (const promo of 'qrbn') add(from, to, { ...extra, promo });
        else add(from, to, extra);
      };
      const one = from + 8 * dir;
      if (b[one] === '') {
        push(one, {});
        if (r === home && b[one + 8 * dir] === '') add(from, one + 8 * dir, { double: true });
      }
      for (const df of [-1, 1]) {
        const ff = f + df;
        if (ff < 0 || ff > 7) continue;
        const to = one + df;
        if (b[to] !== '' && colourOf(b[to]) !== us) push(to, {});
        else if (to === pos.ep && b[to] === '') add(from, to, { ep: true, captured: us === 'w' ? 'p' : 'P' });
      }
      continue;
    }
    const step = (dirs, far) => {
      for (const [df, dr] of dirs) {
        let ff = f + df, rr = r + dr;
        while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
          const to = rr * 8 + ff;
          if (b[to] === '') add(from, to, {});
          else { if (colourOf(b[to]) !== us) add(from, to, {}); break; }
          if (!far) break;
          ff += df; rr += dr;
        }
      }
    };
    if (kind === 'n') step(KNIGHT, false);
    else if (kind === 'b') step(BISHOP, true);
    else if (kind === 'r') step(ROOK, true);
    else if (kind === 'q') { step(ROOK, true); step(BISHOP, true); }
    else if (kind === 'k') {
      step(KING, false);
      const them = other(us), rank = us === 'w' ? 0 : 56;
      const can = (flag) => pos.castling.includes(us === 'w' ? flag : flag.toLowerCase());
      if (from === rank + 4 && !attacked(pos, from, them)) {
        if (can('K') && b[rank + 5] === '' && b[rank + 6] === '' && !attacked(pos, rank + 5, them) && !attacked(pos, rank + 6, them)) add(from, rank + 6, { castle: 'K' });
        if (can('Q') && b[rank + 3] === '' && b[rank + 2] === '' && b[rank + 1] === '' && !attacked(pos, rank + 3, them) && !attacked(pos, rank + 2, them)) add(from, rank + 2, { castle: 'Q' });
      }
    }
  }
  return out;
}

// The position after a move. The old position is left untouched.
export function makeMove(pos, m) {
  const b = pos.board.slice(), us = pos.turn;
  b[m.to] = m.promo ? (us === 'w' ? m.promo.toUpperCase() : m.promo) : m.piece;
  b[m.from] = '';
  if (m.ep) b[m.to + (us === 'w' ? -8 : 8)] = '';
  if (m.castle) {
    const rank = us === 'w' ? 0 : 56;
    if (m.castle === 'K') { b[rank + 5] = b[rank + 7]; b[rank + 7] = ''; } else { b[rank + 3] = b[rank]; b[rank] = ''; }
  }
  let castling = pos.castling;
  const drop = (chars) => { castling = [...castling].filter((c) => !chars.includes(c)).join(''); };
  if (m.piece === 'K') drop('KQ');
  if (m.piece === 'k') drop('kq');
  for (const sq of [m.from, m.to]) {
    if (sq === 0) drop('Q'); else if (sq === 7) drop('K'); else if (sq === 56) drop('q'); else if (sq === 63) drop('k');
  }
  return {
    board: b,
    turn: other(us),
    castling,
    ep: m.double ? (m.from + m.to) / 2 : -1,
    half: m.piece.toLowerCase() === 'p' || m.captured !== '' ? 0 : pos.half + 1,
    full: pos.full + (us === 'b' ? 1 : 0),
  };
}

export function legalMoves(pos) {
  const us = pos.turn, them = other(us);
  return pseudoMoves(pos).filter((m) => {
    const next = makeMove(pos, m);
    return !attacked(next, kingSquare(next, us), them);
  });
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(makeMove(pos, m), depth - 1);
  return n;
}

// ---------- notation ----------
export const toUci = (m) => squareName(m.from) + squareName(m.to) + m.promo;

export function fromUci(pos, text, legal = legalMoves(pos)) {
  const t = String(text).trim().toLowerCase();
  return legal.find((m) => toUci(m) === t) || null;
}

// Standard algebraic notation, e.g. Nbd7, exd6, O-O, e8=Q+, Qh7#.
export function toSan(pos, m, legal = legalMoves(pos)) {
  let s;
  if (m.castle) s = m.castle === 'K' ? 'O-O' : 'O-O-O';
  else {
    const kind = m.piece.toUpperCase();
    const takes = m.captured !== '';
    if (kind === 'P') s = (takes ? FILES[m.from & 7] + 'x' : '') + squareName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      const rivals = legal.filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
      let which = '';
      if (rivals.length) {
        if (!rivals.some((o) => (o.from & 7) === (m.from & 7))) which = FILES[m.from & 7];
        else if (!rivals.some((o) => (o.from >> 3) === (m.from >> 3))) which = String((m.from >> 3) + 1);
        else which = squareName(m.from);
      }
      s = kind + which + (takes ? 'x' : '') + squareName(m.to);
    }
  }
  const next = makeMove(pos, m);
  if (inCheck(next)) s += legalMoves(next).length ? '+' : '#';
  return s;
}

// Read what a person typed: "e4", "Nf3", "exd5", "O-O", "0-0", "e7e8q", "e8=Q", "e8Q".
export function parseMove(pos, text, legal = legalMoves(pos)) {
  const raw = String(text).trim();
  if (!raw) return null;
  const byUci = fromUci(pos, raw, legal);
  if (byUci) return byUci;
  const tidy = (s) => s.replace(/0/g, 'O').replace(/[+#!?x=\s]/g, '').replace(/e\.?p\.?$/i, '');
  const want = tidy(raw);
  const sans = legal.map((m) => tidy(toSan(pos, m, legal)));
  // Exact first ("bc5" is the b-pawn taking on c5), then forgiving about case ("bc5" as Bc5, "nf3").
  let hits = legal.filter((m, i) => sans[i] === want);
  // Only text typed without capitals gets the forgiving pass, so "Bxc3" can never turn into the b-pawn's "bxc3".
  if (!hits.length && want === want.toLowerCase()) hits = legal.filter((m, i) => sans[i].toLowerCase() === want);
  return hits.length === 1 ? hits[0] : null;
}

// ---------- the state of the game ----------
// Two positions are "the same" for the repetition rule when the pieces, the side to
// move, the castling rights and the possible en passant captures are the same.
export function repetitionKey(pos) {
  const fen = toFen(pos).split(' ');
  const epReal = pos.ep >= 0 && legalMoves(pos).some((m) => m.ep);
  return `${fen[0]} ${fen[1]} ${fen[2]} ${epReal ? fen[3] : '-'}`;
}

export function insufficientMaterial(pos) {
  const pieces = pos.board.map((p, sq) => ({ p, sq })).filter((x) => x.p !== '' && x.p.toLowerCase() !== 'k');
  if (pieces.length === 0) return true;
  if (pieces.some((x) => 'pqr'.includes(x.p.toLowerCase()))) return false;
  if (pieces.length === 1) return true; // a lone knight or bishop cannot mate
  if (pieces.every((x) => x.p.toLowerCase() === 'b')) {
    const shade = (sq) => ((sq & 7) + (sq >> 3)) % 2;
    return pieces.every((x) => shade(x.sq) === shade(pieces[0].sq)); // all bishops on one colour
  }
  return false;
}

// `earlier` is a list of repetitionKey() values of every position before this one.
export function gameState(pos, earlier = []) {
  const moves = legalMoves(pos);
  const check = inCheck(pos);
  if (!moves.length) return { over: true, check, result: check ? (pos.turn === 'w' ? '0-1' : '1-0') : '1/2-1/2', reason: check ? 'checkmate' : 'stalemate', moves };
  if (insufficientMaterial(pos)) return { over: true, check, result: '1/2-1/2', reason: 'not enough pieces to mate', moves };
  if (pos.half >= 100) return { over: true, check, result: '1/2-1/2', reason: 'fifty moves without a capture or pawn move', moves };
  const key = repetitionKey(pos);
  if (earlier.filter((k) => k === key).length >= 2) return { over: true, check, result: '1/2-1/2', reason: 'the same position three times', moves };
  return { over: false, check, result: '*', reason: '', moves };
}
