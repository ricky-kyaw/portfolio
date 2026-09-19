// Chess pieces drawn from 16 x 16 grids, in the same blocky hand as the Story
// lettering. No image files. '#' is the body of the piece, '-' is a line cut
// into it, and the outline is worked out by growing the body by one cell.
// White pieces have a light body and a dark outline; black pieces the reverse,
// so both stay readable on light and dark squares.

const SHAPES = {
  p: [
    '................', '................', '......####......', '.....######.....',
    '.....######.....', '......####......', '.....######.....', '......####......',
    '......####......', '.....######.....', '....########....', '...##########...',
    '...##########...', '................', '................', '................',
  ],
  n: [
    '................', '......#.##......', '.....#######....', '....#########...',
    '...##-########..', '..############..', '..#####.######..', '...###.#######..',
    '......########..', '.....########...', '.....#######....', '....#########...',
    '...###########..', '...###########..', '................', '................',
  ],
  b: [
    '................', '.......##.......', '......####......', '.....###-##.....',
    '.....##-###.....', '.....######.....', '......####......', '......####......',
    '.....######.....', '......####......', '.....######.....', '....########....',
    '...##########...', '...##########...', '................', '................',
  ],
  r: [
    '................', '................', '...##.####.##...', '...##.####.##...',
    '...##########...', '....########....', '.....######.....', '.....######.....',
    '.....######.....', '.....######.....', '....########....', '...##########...',
    '...##########...', '................', '................', '................',
  ],
  q: [
    '................', '.......##.......', '..#....##....#..', '..##..####..##..',
    '..###.####.###..', '...##########...', '...##########...', '....########....',
    '....#------#....', '.....######.....', '.....######.....', '....########....',
    '...##########...', '...##########...', '................', '................',
  ],
  k: [
    '.......##.......', '......####......', '.......##.......', '...###.##.###...',
    '..############..', '..############..', '..############..', '...##########...',
    '....#------#....', '.....######.....', '.....######.....', '....########....',
    '...##########...', '...##########...', '................', '................',
  ],
};

const LIGHT = '#F4F5F7', DARK = '#14161A';

function paths(rows) {
  const at = (x, y) => (y >= 0 && y < 16 && x >= 0 && x < 16 ? rows[y][x] : '.');
  let body = '', line = '', cut = '';
  for (let y = -1; y <= 16; y++) {     // one cell past the grid, so a piece that touches the edge still gets its outline
    for (let x = -1; x <= 16; x++) {
      const c = at(x, y);
      const cell = `M${x} ${y}h1v1h-1z`;
      if (c === '#') body += cell;
      else if (c === '-') cut += cell;
      else {
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) !== '.') { near = true; break; }
        if (near) line += cell;
      }
    }
  }
  return { body, line, cut };
}

const CACHE = {};

// piece: a FEN letter. Returns SVG markup for one piece.
export function pieceSVG(piece) {
  if (CACHE[piece]) return CACHE[piece];
  const white = piece === piece.toUpperCase();
  const { body, line, cut } = paths(SHAPES[piece.toLowerCase()]);
  const fill = white ? LIGHT : DARK, edge = white ? DARK : LIGHT;
  CACHE[piece] = `<svg class="piece" viewBox="-1 -1 18 18" aria-hidden="true" focusable="false" shape-rendering="crispEdges">`
    + `<path d="${line}${cut}" fill="${edge}"/><path d="${body}" fill="${fill}"/></svg>`;
  return CACHE[piece];
}

export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const pieceName = (piece) => (piece === piece.toUpperCase() ? 'white ' : 'black ') + PIECE_NAMES[piece.toLowerCase()];
