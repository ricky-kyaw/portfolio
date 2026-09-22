// The small board on the Home page's first plate.
//
// It replays one recorded game: the original Ransom engine playing both sides from the starting
// position, 80 moves at depth 6. The positions and scores are copied from the engine's own test
// records (engine-port/tests/golden_games.json, the first game), so nothing here is made up.
// The bar beside the board is the engine's own score for White at each move.
//
// It rests while it is off screen or the tab is hidden. People who ask for less motion get one
// still position.

import { pieceSVG } from './play/pieces.js';

// where every piece stands before each move (FEN piece placement), then the last position
const ROWS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR',
  'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR',
  'rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR',
  'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR',
  'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R',
  'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R',
  'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/4PN2/PP3PPP/RNBQKB1R',
  'rnbqk2r/ppp1bppp/4pn2/3p4/2PP4/4PN2/PP3PPP/RNBQKB1R',
  'rnbqk2r/ppp1bppp/4pn2/3p4/2PP4/2N1PN2/PP3PPP/R1BQKB1R',
  'rnbq1rk1/ppp1bppp/4pn2/3p4/2PP4/2N1PN2/PP3PPP/R1BQKB1R',
  'rnbq1rk1/ppp1bppp/4pn2/3p4/2PP4/P1N1PN2/1P3PPP/R1BQKB1R',
  'r1bq1rk1/pppnbppp/4pn2/3p4/2PP4/P1N1PN2/1P3PPP/R1BQKB1R',
  'r1bq1rk1/pppnbppp/4pn2/3p4/2PP4/P1N1PN2/1P2BPPP/R1BQK2R',
  'r1bq1rk1/pppnbppp/4pn2/8/2pP4/P1N1PN2/1P2BPPP/R1BQK2R',
  'r1bq1rk1/pppnbppp/4pn2/8/2BP4/P1N1PN2/1P3PPP/R1BQK2R',
  'r1bq1rk1/pp1nbppp/4pn2/2p5/2BP4/P1N1PN2/1P3PPP/R1BQK2R',
  'r1bq1rk1/pp1nbppp/4pn2/2p5/3P4/P1N1PN2/1P2BPPP/R1BQK2R',
  'r1bq1rk1/1p1nbppp/p3pn2/2p5/3P4/P1N1PN2/1P2BPPP/R1BQK2R',
  'r1bq1rk1/1p1nbppp/p3pn2/2p1N3/3P4/P1N1P3/1P2BPPP/R1BQK2R',
  'r1b2rk1/1pqnbppp/p3pn2/2p1N3/3P4/P1N1P3/1P2BPPP/R1BQK2R',
  'r1b2rk1/1pqNbppp/p3pn2/2p5/3P4/P1N1P3/1P2BPPP/R1BQK2R',
  'r4rk1/1pqbbppp/p3pn2/2p5/3P4/P1N1P3/1P2BPPP/R1BQK2R',
  'r4rk1/1pqbbppp/p3pn2/2p5/3P4/P1N1P3/1P2BPPP/R1BQ1RK1',
  'r4rk1/1pq1bppp/p1b1pn2/2p5/3P4/P1N1P3/1P2BPPP/R1BQ1RK1',
  'r4rk1/1pq1bppp/p1b1pn2/2P5/8/P1N1P3/1P2BPPP/R1BQ1RK1',
  'r4rk1/1pq2ppp/p1b1pn2/2b5/8/P1N1P3/1P2BPPP/R1BQ1RK1',
  'r4rk1/1pq2ppp/p1b1pn2/2b5/8/P1N1PB2/1P3PPP/R1BQ1RK1',
  'r2r2k1/1pq2ppp/p1b1pn2/2b5/8/P1N1PB2/1P3PPP/R1BQ1RK1',
  'r2r2k1/1pq2ppp/p1b1pn2/2b5/8/P1N1PB2/1P2QPPP/R1B2RK1',
  'r2r2k1/1pq2ppp/p1bbpn2/8/8/P1N1PB2/1P2QPPP/R1B2RK1',
  'r2r2k1/1pq2ppp/p1bbpn2/8/8/P1N1PB1P/1P2QPP1/R1B2RK1',
  'r2r2k1/1pq2ppp/p2bpn2/8/8/P1N1Pb1P/1P2QPP1/R1B2RK1',
  'r2r2k1/1pq2ppp/p2bpn2/8/8/P1N1PQ1P/1P3PP1/R1B2RK1',
  'r2r2k1/1pq2ppp/p3pn2/4b3/8/P1N1PQ1P/1P3PP1/R1B2RK1',
  'r2r2k1/1pq2ppp/p3pn2/4b3/4P3/P1N2Q1P/1P3PP1/R1B2RK1',
  'r2r2k1/1p3ppp/p3pn2/4b3/2q1P3/P1N2Q1P/1P3PP1/R1B2RK1',
  'r2r2k1/1p3ppp/p3pn2/4b3/2q1P3/P1N2Q1P/1P3PP1/1RB2RK1',
  'r2r2k1/5ppp/p3pn2/1p2b3/2q1P3/P1N2Q1P/1P3PP1/1RB2RK1',
  'r2r2k1/5ppp/p3pn2/1p2b3/2q1P3/P1N1BQ1P/1P3PP1/1R3RK1',
  'r2r2k1/5ppp/p3pn2/1p6/2q1P3/P1b1BQ1P/1P3PP1/1R3RK1',
  'r2r2k1/5ppp/p3pn2/1p6/2q1P3/P1P1BQ1P/5PP1/1R3RK1',
  'r2r2k1/5ppp/p3pn2/1p6/4q3/P1P1BQ1P/5PP1/1R3RK1',
  'r2r2k1/5ppp/p3pn2/1p6/4Q3/P1P1B2P/5PP1/1R3RK1',
  'r2r2k1/5ppp/p3p3/1p6/4n3/P1P1B2P/5PP1/1R3RK1',
  'r2r2k1/5ppp/p3p3/1p6/2P1n3/P3B2P/5PP1/1R3RK1',
  'r2r2k1/5ppp/p3p3/8/2p1n3/P3B2P/5PP1/1R3RK1',
  'r2r2k1/5ppp/p3p3/8/2p1n3/P3B2P/5PP1/1RR3K1',
  '2rr2k1/5ppp/p3p3/8/2p1n3/P3B2P/5PP1/1RR3K1',
  '2rr2k1/5ppp/p3p3/8/1Rp1n3/P3B2P/5PP1/2R3K1',
  '2rr2k1/5ppp/p2np3/8/1Rp5/P3B2P/5PP1/2R3K1',
  '2rr2k1/5ppp/p2np3/8/R1p5/P3B2P/5PP1/2R3K1',
  '3r2k1/5ppp/p1rnp3/8/R1p5/P3B2P/5PP1/2R3K1',
  '3r2k1/5ppp/p1rnp3/8/R1p5/P3B2P/5PP1/2R2K2',
  '3r2k1/5ppp/p1rnp3/8/R7/P1p1B2P/5PP1/2R2K2',
  '3r2k1/5ppp/p1rnp3/8/3R4/P1p1B2P/5PP1/2R2K2',
  '3r2k1/5ppp/p1rn4/4p3/3R4/P1p1B2P/5PP1/2R2K2',
  '3r2k1/5ppp/p1rn4/3Rp3/8/P1p1B2P/5PP1/2R2K2',
  '4r1k1/5ppp/p1rn4/3Rp3/8/P1p1B2P/5PP1/2R2K2',
  '4r1k1/5ppp/p1rn4/2R1p3/8/P1p1B2P/5PP1/2R2K2',
  '4r1k1/5ppp/p2n4/2r1p3/8/P1p1B2P/5PP1/2R2K2',
  '4r1k1/5ppp/p2n4/2B1p3/8/P1p4P/5PP1/2R2K2',
  '4r1k1/5ppp/p7/2B1p3/4n3/P1p4P/5PP1/2R2K2',
  '4r1k1/5ppp/p7/4p3/4n3/P1p1B2P/5PP1/2R2K2',
  '2r3k1/5ppp/p7/4p3/4n3/P1p1B2P/5PP1/2R2K2',
  '2r3k1/5ppp/p7/4p3/4n1P1/P1p1B2P/5P2/2R2K2',
  '2r3k1/5ppp/p7/4p3/4n1P1/P3B2P/2p2P2/2R2K2',
  '2r3k1/5ppp/p7/4p3/4n1P1/P3B2P/2p1KP2/2R5',
  '2r3k1/6pp/p7/4pp2/4n1P1/P3B2P/2p1KP2/2R5',
  '2r3k1/6pp/p7/4pP2/4n3/P3B2P/2p1KP2/2R5',
  '2r3k1/6pp/p2n4/4pP2/8/P3B2P/2p1KP2/2R5',
  '2r3k1/6pp/p2n1P2/4p3/8/P3B2P/2p1KP2/2R5',
  '2r3k1/7p/p2n1p2/4p3/8/P3B2P/2p1KP2/2R5',
  '2r3k1/7p/p2n1p2/4p3/8/P2KB2P/2p2P2/2R5',
  '2r3k1/7p/p4p2/4pn2/8/P2KB2P/2p2P2/2R5',
  '2r3k1/7p/p4p2/4pn2/8/P2K3P/2pB1P2/2R5',
  '2r5/5k1p/p4p2/4pn2/8/P2K3P/2pB1P2/2R5',
  '2r5/5k1p/p4p2/4pn2/8/P1BK3P/2p2P2/2R5',
  '2r5/5k1p/p4p2/4p3/3n4/P1BK3P/2p2P2/2R5',
  '2r5/5k1p/p4p2/4p3/3B4/P2K3P/2p2P2/2R5',
  '2r5/5k1p/p4p2/8/3p4/P2K3P/2p2P2/2R5',
];
// the engine's score for White, in hundredths of a pawn
const SCORES = [32, 32, 30, 26, 26, 15, 14, 16, 22, 15, 2, -6, 10, 10, -13, -31, -35, -36, -52, -55, -97, -106, -133, -140, -173, -161, -188, -190, -158, -156, -181, -187, -203, -203, -203, -230, -157, -189, -208, -229, -260, -229, -237, -226, -268, -251, -295, -243, -319, -255, -333, -361, -387, -439, -406, -450, -404, -398, -359, -386, -374, -400, -413, -412, -495, -495, -412, -411, -440, -450, -488, -509, -562, -583, -615, -548, -606, -426, -483, -413, -413];

const STEP = 1300, REST = 5000, STILL = 24;

export function initHomePlates(main) {
  const root = main.querySelector('[data-miniboard]');
  const grid = root && root.querySelector('.mini-board');
  if (!grid) return null;
  const fill = root.querySelector('.mini-bar-fill');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const squares = [];
  const shown = new Array(64).fill('');
  for (let i = 0; i < 64; i++) {
    const sq = document.createElement('span');
    sq.className = 'mini-sq';
    grid.appendChild(sq);
    squares.push(sq);
  }

  function set(i, piece) {
    if (shown[i] === piece) return;
    shown[i] = piece;
    squares[i].innerHTML = piece ? pieceSVG(piece) : '';
  }
  function place(n) {
    let i = 0;
    for (const ch of ROWS[n]) {
      if (ch === '/') continue;
      if (ch >= '1' && ch <= '8') { for (let k = 0; k < Number(ch); k++) set(i++, ''); } else set(i++, ch);
    }
    if (fill) {
      const share = 1 / (1 + Math.pow(10, -SCORES[n] / 400));
      fill.style.transform = `scaleY(${Math.max(0.04, Math.min(0.96, share)).toFixed(3)})`;
    }
  }

  let at = 0, timer = 0, alive = true, onScreen = true;
  const running = () => alive && onScreen && !document.hidden && !reduced.matches;
  function tick() {
    timer = 0;
    if (!running()) return;
    at = at + 1 < ROWS.length ? at + 1 : 0;
    place(at);
    timer = setTimeout(tick, at === ROWS.length - 1 ? REST : STEP);
  }
  function wake() {
    if (!alive) return;
    if (reduced.matches) { clearTimeout(timer); timer = 0; at = STILL; place(at); return; }
    if (!timer && running()) timer = setTimeout(tick, STEP);
  }

  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => { onScreen = entries[0].isIntersecting; wake(); }) : null;
  if (io) io.observe(root);
  document.addEventListener('visibilitychange', wake);
  if (reduced.addEventListener) reduced.addEventListener('change', wake);

  if (reduced.matches) at = STILL;
  place(at);
  wake();

  return {
    destroy() {
      alive = false;
      clearTimeout(timer);
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', wake);
      if (reduced.removeEventListener) reduced.removeEventListener('change', wake);
    },
  };
}
