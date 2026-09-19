// Three small worlds, built by code. No image files.
//
//   loikaw  Taung Kwe pagoda on its limestone crags, overlooking the town
//   yangon  Shwedagon on its hill, Inya Lake, tall glass malls, rows of flats
//   london  the Thames from Big Ben, past The Shard at London Bridge,
//           out to the towers of Canary Wharf
//
// Every scene is made from the same few shapes in engine.js and a seeded
// random number generator, so it comes out the same on every visit.

import { Grid, buildFaces, rng, makeNoise } from './engine.js';

// id -> [r, g, b, accent]   accent: 1 amber, 2 blue, 3 a window that can light up
const M = {
  grass: 1, earth: 2, road: 3, rock: 4, rockDark: 5, white: 6, cream: 7, concrete: 8,
  roofRed: 9, roofBlue: 10, roofGreen: 11, gold: 12, goldDark: 13, leaf: 14, trunk: 15,
  water: 16, glass: 17, lit: 18, stone: 19, slate: 20, bridge: 21, palm: 22, stupaWhite: 23,
  pavement: 24, glassDark: 25, steel: 26, tin: 27, window: 28, lawn: 29,
};
const MATERIALS = {
  1: [64, 92, 58, 0], 2: [58, 48, 40, 0], 3: [34, 36, 42, 0], 4: [206, 204, 196, 0], 5: [128, 126, 120, 0],
  6: [234, 232, 224, 0], 7: [216, 198, 162, 0], 8: [152, 154, 160, 0], 9: [172, 74, 60, 0], 10: [62, 112, 192, 0],
  11: [96, 170, 120, 0], 12: [244, 188, 62, 1], 13: [190, 136, 38, 1], 14: [86, 140, 84, 0], 15: [70, 54, 40, 0],
  16: [62, 112, 212, 2], 17: [156, 182, 212, 0], 18: [255, 204, 96, 3], 19: [200, 190, 164, 0], 20: [84, 88, 100, 0],
  21: [146, 146, 152, 0], 22: [74, 144, 84, 0], 23: [242, 240, 232, 0], 24: [180, 178, 172, 0], 25: [72, 88, 114, 0],
  26: [196, 202, 212, 0], 27: [186, 190, 194, 0], 28: [30, 34, 44, 0], 29: [92, 128, 80, 0],
};

// ---------- moods: the same world in a different light ----------
const MOOD = {
  dot: 2, gain: 1.05, skyGlow: 0.6, ringLevel: 150, lights: false, clearBright: 1.05,
  inkDark: '#0B0D10', inkLight: '#ECE7DA', skyDark: '#0B0D10', skyLight: '#2B313D', ring: '#394050',
  amberLo: '#7A5410', amberHi: '#F2B233', blueLo: '#12306F', blueHi: '#5B8CFF',
};
export const MOODS = {
  'loikaw-day': { ...MOOD },
  'loikaw-drained': { ...MOOD, inkLight: '#A7ADB8', amberLo: '#4A4030', amberHi: '#B39F6C', blueLo: '#1B2740', blueHi: '#5F7196', gain: 0.85, skyGlow: 0.35, ringLevel: 110 },
  'loikaw-dark': { ...MOOD, inkLight: '#566070', amberLo: '#2A2620', amberHi: '#F2B233', blueLo: '#10182A', blueHi: '#2E3C5C', gain: 0.5, skyGlow: 0.14, ringLevel: 70, lights: true },
  'loikaw-leaving': { ...MOOD, inkLight: '#7C8594', amberLo: '#3A3326', amberHi: '#9C8B5E', blueLo: '#141D33', blueHi: '#42527A', gain: 0.68, skyGlow: 0.22, ringLevel: 90 },
  'yangon-day': { ...MOOD, inkLight: '#EFE9DC' },
  'yangon-return': { ...MOOD, inkLight: '#D9DEE6', skyLight: '#27303D', gain: 0.98, skyGlow: 0.5 },
  'yangon-dawn': { ...MOOD, inkLight: '#F4DDB6', skyLight: '#5B4738', ring: '#4A3E38', skyGlow: 0.85, gain: 1.1 },
  'london-day': { ...MOOD, inkLight: '#DDE4EF', skyLight: '#28313F', ring: '#343C4B' },
  'london-night': { ...MOOD, inkLight: '#8C9DB8', skyLight: '#1B2330', ring: '#262E3C', gain: 0.72, skyGlow: 0.3, ringLevel: 100, lights: true },
};

// ---------- shared building blocks ----------
function world(X, Y, Z, R, seed) {
  const g = new Grid(X, Y, Z);
  const c = X / 2;
  const hm = new Int16Array(X * Z).fill(-1);  // ground height
  const occ = new Uint8Array(X * Z);          // 0 free, 1 road, 2 building, 3 water, 4 tree, 5 reserved
  const inDisc = (x, z, pad = 0) => { const dx = x + 0.5 - c, dz = z + 0.5 - Z / 2; return dx * dx + dz * dz <= (R - pad) * (R - pad); };
  return { g, hm, occ, inDisc, X, Y, Z, R, r: rng(seed), n: makeNoise(seed + 5) };
}

function ground(w, amp, heightAt) {
  const { g, hm, inDisc, X, Z, n } = w;
  for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
    if (!inDisc(x, z)) continue;
    const h = heightAt ? heightAt(x, z) : 2 + Math.floor(n(x / 16, z / 16) * amp);
    g.box(x, 0, z, x, h - 1, z, M.earth);
    g.set(x, h, z, M.grass);
    hm[z * X + x] = h;
  }
}

function roadCell(w, x, z, mat = M.road) {
  const { g, hm, occ, X, inDisc } = w;
  if (!inDisc(x, z) || occ[z * X + x] === 3 || occ[z * X + x] === 5) return;
  g.set(x, hm[z * X + x], z, mat);
  occ[z * X + x] = 1;
}

function areaFree(w, x0, z0, x1, z1, pad = 1) {
  const { occ, X, Z, inDisc } = w;
  for (let z = z0 - pad; z <= z1 + pad; z++) for (let x = x0 - pad; x <= x1 + pad; x++) {
    if (x < 0 || z < 0 || x >= X || z >= Z || !inDisc(x, z, 2) || occ[z * X + x]) return false;
  }
  return true;
}
function mark(w, x0, z0, x1, z1, v) {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (x >= 0 && z >= 0 && x < w.X && z < w.Z) w.occ[z * w.X + x] = v;
}
function baseHeight(w, x0, z0, x1, z1) {
  let h = 0;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) h = Math.max(h, w.hm[z * w.X + x]);
  return h;
}

// A solid block with a band of windows on each floor.
function block(w, x0, z0, wd, dp, floors, wall, opts = {}) {
  const { g, r } = w;
  const x1 = x0 + wd - 1, z1 = z0 + dp - 1;
  const y0 = baseHeight(w, x0, z0, x1, z1) + 1;
  const h = floors * (opts.floor || 2);
  g.box(x0, 1, z0, x1, y0 + h - 1, z1, wall);
  const win = opts.window || M.window;
  for (let y = y0 + 1; y < y0 + h; y += (opts.floor || 2)) {
    for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) if ((x - x0) % 2 === (opts.phase || 0)) g.set(x, y, z, r() < (opts.lit || 0) ? M.lit : win);
    for (let z = z0; z <= z1; z++) for (const x of [x0, x1]) if ((z - z0) % 2 === (opts.phase || 0)) g.set(x, y, z, r() < (opts.lit || 0) ? M.lit : win);
  }
  mark(w, x0, z0, x1, z1, 2);
  return y0 + h; // first free layer above the block
}

function gable(g, x0, z0, wd, dp, y, roof) {
  // ridge runs along the longer side
  const alongX = wd >= dp;
  const half = Math.ceil((alongX ? dp : wd) / 2);
  for (let i = 0; i < half; i++) {
    if (alongX) g.box(x0 - (i === 0 ? 1 : 0), y + i, z0 + i, x0 + wd - 1 + (i === 0 ? 1 : 0), y + i, z0 + dp - 1 - i, roof);
    else g.box(x0 + i, y + i, z0 - (i === 0 ? 1 : 0), x0 + wd - 1 - i, y + i, z0 + dp - 1 + (i === 0 ? 1 : 0), roof);
  }
}

function tree(w, x, z) {
  const { g, hm, occ, X, r } = w;
  if (occ[z * X + x]) return;
  const y = hm[z * X + x] + 1;
  if (r() < 0.28) {
    const h = 5 + Math.floor(r() * 3);
    g.box(x, y, z, x, y + h - 1, z, M.trunk);
    const t = y + h - 1;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.set(x + dx, t, z + dz, M.palm); g.set(x + dx * 2, t - 1, z + dz * 2, M.palm); }
    g.set(x, t + 1, z, M.palm);
  } else {
    const h = 1 + Math.floor(r() * 2);
    g.box(x, y, z, x, y + h, z, M.trunk);
    const rad = 1.5 + r() * 1.1;
    g.ellipsoid(x + 0.5, y + h + rad * 0.8, z + 0.5, rad, rad * 0.9, rad, M.leaf);
  }
  occ[z * X + x] = 4;
}

function scatterTrees(w, count, where) {
  const { X, Z, r, inDisc, occ } = w;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(r() * X), z = Math.floor(r() * Z);
    if (!inDisc(x, z, 2) || occ[z * X + x]) continue;
    if (where && !where(x, z)) continue;
    tree(w, x, z);
  }
}

// A gilded stupa: square terraces, a bell, rings, a long spire and its umbrella.
function stupa(g, cx, cz, y0, k) {
  let y = y0;
  for (const [half, h] of [[3.6 * k, 2], [2.9 * k, 2], [2.3 * k, 1]]) { g.pyramid(cx, cz, y, y + h - 1, half, half, M.goldDark); y += h; }
  let h = Math.round(4 * k); g.taper(cx, cz, y, y + h, 2.5 * k, 1.6 * k, M.gold); y += h + 1;
  g.cylinder(cx, cz, y, y, 1.8 * k, M.goldDark); y += 1;
  h = Math.round(3 * k); g.taper(cx, cz, y, y + h, 1.4 * k, 0.8 * k, M.gold); y += h + 1;
  h = Math.round(4 * k); g.taper(cx, cz, y, y + h, 0.8 * k, 0.5, M.gold); y += h + 1;
  h = Math.round(2 * k); g.box(Math.floor(cx), y, Math.floor(cz), Math.floor(cx), y + h, Math.floor(cz), M.gold); y += h;
  g.disc(cx, cz, y - 1, 1.3, M.goldDark);
  g.set(Math.floor(cx), y + 1, Math.floor(cz), M.gold);
  return y + 1;
}

function ringOf(seed, kind) {
  const r = rng(seed);
  const ring = new Float32Array(360);
  if (kind === 'hills') {
    const p = [r() * 6, r() * 6, r() * 6];
    for (let a = 0; a < 360; a++) {
      const t = a * Math.PI / 180;
      ring[a] = Math.max(0.05, 0.42 + 0.26 * Math.sin(t * 2 + p[0]) + 0.16 * Math.sin(t * 5 + p[1]) + 0.08 * Math.sin(t * 11 + p[2]));
    }
  } else {
    // a far, low skyline: haze with the odd taller block
    let a = 0;
    while (a < 360) {
      const wdt = 2 + Math.floor(r() * 5);
      const h = r() < 0.12 ? 0.35 + r() * 0.4 : 0.1 + r() * 0.16;
      for (let i = 0; i < wdt && a < 360; i++, a++) ring[a] = h;
    }
  }
  return ring;
}

// shade: brightness of [top, +x, -x, +z, -z]. Each scene puts its sun where the
// opening view looks at lit walls, not shadowed ones.
function finish(w, tallest, ringKind, start, shade) {
  const faces = buildFaces(w.g, MATERIALS, shade);
  const span = w.R * 2 + 4;
  return {
    size: [w.X, w.Y, w.Z], faces, ring: ringOf(w.X * 7 + tallest, ringKind), start, span, tallest,
  };
}

// ---------- Loikaw: Taung Kwe pagoda over the town ----------
export function loikaw() {
  const w = world(88, 62, 88, 42, 1207);
  const { g, r, n } = w;
  ground(w, 2.4);

  // limestone crags, broken up with noise so they read as rock, not as domes
  const crag = (cx, cz, rx, ry, rz) => {
    g.ellipsoid(cx, 2, cz, rx, ry, rz,
      (x, y, z) => ((y + Math.floor(n(x / 6, z / 6) * 3)) % 7 === 0 ? M.rockDark : M.rock),
      (v, x, y, z) => y >= 2 && v + (n(x / 5 + 9, z / 5 + 3) - 0.5) * 0.42 + (n(x / 3 + 31, y / 3) - 0.5) * 0.14 <= 1);
    mark(w, Math.floor(cx - rx - 1), Math.floor(cz - rz - 1), Math.ceil(cx + rx + 1), Math.ceil(cz + rz + 1), 5);
  };
  crag(25, 27, 11, 23, 10);
  crag(38, 17, 8, 16, 7);
  crag(14, 38, 6, 11, 6);
  crag(31, 38, 4, 6, 4);
  crag(45, 26, 3, 4, 3);

  // the tall gilded stupa on the highest crag
  let t = g.top(25, 27);
  g.cylinder(25.5, 27.5, t - 1, t, 5.4, M.stupaWhite);
  stupa(g, 25.5, 27.5, t + 1, 1.3);
  // the golden boulder on its white drum, with a small spire
  t = g.top(38, 17);
  g.cylinder(38.5, 17.5, t, t + 1, 3.4, M.stupaWhite);
  g.ellipsoid(38.5, t + 5.4, 17.5, 3.7, 3.6, 3.7, M.gold);
  g.taper(38.5, 17.5, t + 9, t + 11, 1.2, 0.5, M.gold);
  g.box(38, t + 12, 17, 38, t + 14, 17, M.gold);
  // a small white shrine with a blue roof on the third crag
  t = g.top(14, 38);
  g.box(12, t + 1, 36, 16, t + 3, 40, M.white);
  g.pyramid(14.5, 38.5, t + 4, t + 6, 3.2, 0.6, M.roofBlue);
  g.box(14, t + 7, 38, 14, t + 8, 38, M.gold);

  // streets
  for (let z = 2; z < 86; z++) for (let x = 52; x <= 53; x++) roadCell(w, x, z);
  for (let x = 2; x < 86; x++) for (let z = 50; z <= 51; z++) roadCell(w, x, z);
  for (const zz of [22, 36, 66, 78]) for (let x = 40; x < 86; x++) roadCell(w, x, zz);
  for (const xx of [38, 66, 78]) for (let z = 8; z < 86; z++) roadCell(w, xx, z);
  for (let x = 6; x < 38; x++) roadCell(w, x, 64);
  for (let z = 52; z < 84; z++) roadCell(w, 22, z);

  // a handful of taller buildings near the crossroads, then houses everywhere else
  const walls = [M.cream, M.white, M.concrete, M.cream, M.white];
  const roofs = [M.roofRed, M.roofRed, M.tin, M.tin, M.roofBlue, M.roofGreen, M.slate];
  for (let i = 0; i < 60; i++) {
    const wd = 4 + Math.floor(r() * 3), dp = 4 + Math.floor(r() * 3);
    const x0 = 44 + Math.floor(r() * 26), z0 = 40 + Math.floor(r() * 26);
    if (!areaFree(w, x0, z0, x0 + wd - 1, z0 + dp - 1)) continue;
    const top = block(w, x0, z0, wd, dp, 2 + Math.floor(r() * 2), walls[Math.floor(r() * walls.length)]);
    g.box(x0, top, z0, x0 + wd - 1, top, z0 + dp - 1, roofs[Math.floor(r() * roofs.length)]);
  }
  let litPlaced = false;
  for (let i = 0; i < 1400; i++) {
    const wd = 3 + Math.floor(r() * 3), dp = 3 + Math.floor(r() * 3);
    const x0 = 4 + Math.floor(r() * 80), z0 = 4 + Math.floor(r() * 80);
    if (!areaFree(w, x0, z0, x0 + wd - 1, z0 + dp - 1)) continue;
    const top = block(w, x0, z0, wd, dp, 1, walls[Math.floor(r() * walls.length)], { floor: 2 + Math.floor(r() * 2) });
    gable(g, x0, z0, wd, dp, top, roofs[Math.floor(r() * roofs.length)]);
    // one window stays lit in the dark chapters: someone kept a notebook
    if (!litPlaced && x0 > 46 && x0 < 60 && z0 > 56 && z0 < 70) { g.set(x0, top - 1, z0 + 1, M.lit); g.set(x0 + 1, top - 1, z0, M.lit); litPlaced = true; }
  }
  // a blue-roofed hut at the foot of the crags, as on the hill itself
  if (areaFree(w, 40, 30, 44, 33, 0)) { const top = block(w, 40, 30, 5, 4, 1, M.white); gable(g, 40, 30, 5, 4, top, M.roofBlue); }

  scatterTrees(w, 900);
  return finish(w, 50, 'hills', { yaw: 3.95, pitch: 0.56 }, [1, 0.30, 0.74, 0.40, 0.52]);
}

// ---------- Yangon ----------
export function yangon() {
  const w = world(96, 50, 96, 46, 2012);
  const { g, r, n, X, Z, hm, occ, inDisc } = w;

  // Inya Lake: an uneven shore made from a few overlapping circles
  const lake = (x, z) => {
    const d = (cx, cz, rr) => Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / rr;
    const v = Math.min(d(30, 66, 15), d(42, 72, 10), d(22, 56, 9), d(34, 54, 7));
    return v + (n(x / 5, z / 5) - 0.5) * 0.35;
  };
  // Shwedagon stands on a low hill
  const hill = (x, z) => Math.max(0, 1 - Math.hypot(x + 0.5 - 66, z + 0.5 - 30) / 19);
  ground(w, 0, (x, z) => 2 + Math.round(hill(x, z) * 5));
  for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
    if (!inDisc(x, z)) continue;
    const v = lake(x, z);
    if (v < 1) { g.box(x, 1, z, x, hm[z * X + x], z, 0); g.set(x, 1, z, M.water); hm[z * X + x] = 1; occ[z * X + x] = 3; }
    else if (v < 1.14) { g.set(x, hm[z * X + x], z, M.pavement); occ[z * X + x] = 5; }
  }

  // the pagoda: terraces, the great stupa, a ring of small ones, four stair halls
  g.cylinder(66.5, 30.5, 6, 8, 14.5, M.pavement);
  g.cylinder(66.5, 30.5, 9, 9, 12.5, M.stupaWhite);
  mark(w, 48, 12, 85, 49, 5);
  g.taper(66.5, 30.5, 10, 13, 8.2, 6.4, M.goldDark);
  g.taper(66.5, 30.5, 14, 22, 6.2, 2.4, M.gold);
  g.cylinder(66.5, 30.5, 23, 23, 2.9, M.goldDark);
  g.taper(66.5, 30.5, 24, 27, 2.2, 1.5, M.gold);
  g.ellipsoid(66.5, 29.5, 30.5, 1.9, 2.2, 1.9, M.gold);
  g.taper(66.5, 30.5, 31, 38, 1.4, 0.5, M.gold);
  g.box(66, 39, 30, 66, 42, 30, M.gold);
  g.disc(66.5, 30.5, 40, 1.4, M.goldDark);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6 + 0.26;
    const sx = 66.5 + Math.cos(a) * 10.6, sz = 30.5 + Math.sin(a) * 10.6;
    g.cylinder(sx, sz, 10, 10, 1.3, M.stupaWhite);
    g.taper(sx, sz, 11, 14, 1.2, 0.5, M.gold);
    g.box(Math.floor(sx), 15, Math.floor(sz), Math.floor(sx), 16, Math.floor(sz), M.gold);
  }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let k = 13; k < 21; k++) {
      const x = Math.floor(66.5 + dx * k), z = Math.floor(30.5 + dz * k);
      const y = Math.max(hm[z * X + x] || 2, 2) + 1;
      g.box(x - Math.abs(dz), y, z - Math.abs(dx), x + Math.abs(dz), y + 1, z + Math.abs(dx), M.white);
      g.box(x - Math.abs(dz), y + 2, z - Math.abs(dx), x + Math.abs(dz), y + 2, z + Math.abs(dx), k % 3 === 0 ? M.goldDark : M.roofRed);
    }
  }

  // street grid
  for (let z = 2; z < 94; z++) for (const xx of [12, 13, 28, 29, 44, 45]) if (z < 50 || xx > 40) roadCell(w, xx, z);
  for (let x = 2; x < 94; x++) for (const zz of [10, 11, 24, 25, 38, 39]) roadCell(w, x, zz);
  for (let x = 46; x < 94; x++) for (const zz of [56, 57, 88]) roadCell(w, x, zz);
  for (let z = 50; z < 94; z++) for (const xx of [58, 59, 90]) roadCell(w, xx, z);

  // tall glass malls near the lake, on wide podiums
  const tower = (x0, z0, wd, dp, floors, lit) => {
    const y0 = baseHeight(w, x0 - 2, z0 - 2, x0 + wd + 1, z0 + dp + 1) + 1;
    g.box(x0 - 2, 1, z0 - 2, x0 + wd + 1, y0 + 3, z0 + dp + 1, M.concrete);
    for (let x = x0 - 2; x <= x0 + wd + 1; x += 2) { g.set(x, y0 + 1, z0 - 2, M.window); g.set(x, y0 + 1, z0 + dp + 1, M.window); }
    const h = floors * 2;
    for (let y = y0 + 4; y < y0 + 4 + h; y++) g.box(x0, y, z0, x0 + wd - 1, y, z0 + dp - 1, (y - y0) % 3 === 0 ? M.glassDark : M.glass);
    if (lit) for (let i = 0; i < floors; i++) g.set(x0 + Math.floor(r() * wd), y0 + 5 + Math.floor(r() * (h - 2)), z0, M.lit);
    g.box(x0 + 1, y0 + 4 + h, z0 + 1, x0 + wd - 2, y0 + 4 + h, z0 + dp - 2, M.steel);
    mark(w, x0 - 3, z0 - 3, x0 + wd + 2, z0 + dp + 2, 2);
  };
  tower(48, 60, 7, 7, 12, true);
  tower(62, 62, 6, 8, 14, true);
  tower(50, 74, 8, 6, 10, true);
  tower(18, 30, 6, 6, 11, true);
  tower(33, 14, 7, 6, 9, true);

  // Yankin: long slabs of flats in rows, water tanks on the roofs
  for (let row = 0; row < 5; row++) {
    const z0 = 60 + row * 6;
    for (const x0 of [64, 78]) {
      if (!areaFree(w, x0, z0, x0 + 11, z0 + 2, 0)) continue;
      const top = block(w, x0, z0, 12, 3, 3, row % 2 ? M.cream : M.concrete);
      for (let x = x0 + 1; x < x0 + 12; x += 4) g.set(x, top, z0 + 1, M.slate);
    }
  }

  // downtown: mid-rise blocks between the streets
  const walls = [M.cream, M.concrete, M.white, M.cream, M.stone];
  for (let i = 0; i < 1500; i++) {
    const wd = 3 + Math.floor(r() * 4), dp = 3 + Math.floor(r() * 4);
    const x0 = 4 + Math.floor(r() * 88), z0 = 4 + Math.floor(r() * 88);
    if (!areaFree(w, x0, z0, x0 + wd - 1, z0 + dp - 1, 0)) continue;
    const downtown = x0 < 46 && z0 < 50;
    const floors = downtown ? 2 + Math.floor(r() * 4) : 1 + Math.floor(r() * 2);
    const top = block(w, x0, z0, wd, dp, floors, walls[Math.floor(r() * walls.length)], { lit: 0.06 });
    if (downtown || r() < 0.5) { g.box(x0, top, z0, x0 + wd - 1, top, z0 + dp - 1, M.tin); if (r() < 0.5) g.set(x0 + 1, top + 1, z0 + 1, M.slate); }
    else gable(g, x0, z0, wd, dp, top, r() < 0.5 ? M.roofRed : M.tin);
  }
  scatterTrees(w, 1100);
  return finish(w, 42, 'skyline', { yaw: 2.2, pitch: 0.58 }, [1, 0.74, 0.30, 0.40, 0.52]);
}

// ---------- London ----------
export function london() {
  const w = world(104, 58, 104, 50, 2024);
  const { g, r, X, Z, hm, occ, inDisc } = w;
  ground(w, 0, () => 2);

  // the Thames: a slow S, then the loop around the Isle of Dogs
  const river = (x) => 52 + 9 * Math.sin(x / 15) + (x > 70 ? 15 * Math.sin((x - 70) / 9.5) : 0);
  for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
    if (!inDisc(x, z)) continue;
    const d = Math.abs(z + 0.5 - river(x));
    if (d < 4.6) { g.set(x, 2, z, 0); g.set(x, 1, z, M.water); hm[z * X + x] = 1; occ[z * X + x] = 3; }
    else if (d < 6) { g.set(x, 2, z, M.pavement); occ[z * X + x] = 5; }
  }
  const bridge = (x0, wd, mat = M.bridge) => {
    const zc = Math.round(river(x0));
    g.box(x0, 3, zc - 7, x0 + wd - 1, 3, zc + 7, mat);
    for (const dz of [-3, 0, 3]) g.box(x0, 1, zc + dz, x0 + wd - 1, 2, zc + dz, M.stone);
    mark(w, x0, zc - 8, x0 + wd - 1, zc + 8, 5);
  };

  // Westminster: the long palace on the north bank, and the clock tower at its end
  {
    const zr = Math.round(river(22));
    g.box(8, 3, zr - 15, 32, 9, zr - 9, M.stone);
    for (let x = 8; x <= 32; x += 2) {
      g.set(x, 10, zr - 15, M.stone); g.set(x, 10, zr - 9, M.stone);
      for (const y of [5, 7]) { g.set(x, y, zr - 9, M.window); g.set(x, y, zr - 15, M.window); }
    }
    g.box(9, 10, zr - 14, 31, 10, zr - 10, M.slate);
    g.box(6, 3, zr - 17, 12, 20, zr - 11, M.stone);                 // the big square tower at the far end
    for (const [x, z] of [[6, zr - 17], [12, zr - 17], [6, zr - 11], [12, zr - 11]]) g.box(x, 21, z, x, 24, z, M.stone);
    g.pyramid(19.5, zr - 12, 11, 15, 1.6, 0.5, M.slate);            // the central spire
    // Elizabeth Tower, "Big Ben": a tall square shaft, the clock stage, a steep roof
    g.box(34, 3, zr - 14, 38, 28, zr - 10, M.stone);
    for (let y = 6; y < 27; y += 3) for (const [x, z] of [[36, zr - 14], [36, zr - 10], [34, zr - 12], [38, zr - 12]]) g.set(x, y, z, M.window);
    g.box(33, 29, zr - 15, 39, 34, zr - 9, M.stone);
    for (const [x0, z0, x1, z1] of [[35, zr - 15, 37, zr - 15], [35, zr - 9, 37, zr - 9], [33, zr - 13, 33, zr - 11], [39, zr - 13, 39, zr - 11]]) g.box(x0, 30, z0, x1, 32, z1, M.gold);
    g.pyramid(36.5, zr - 11.5, 35, 38, 3.4, 1.8, M.slate);
    g.box(35, 39, zr - 13, 37, 40, zr - 11, M.gold);               // the lantern
    g.pyramid(36.5, zr - 11.5, 41, 44, 1.5, 0.5, M.slate);
    g.box(36, 45, zr - 12, 36, 46, zr - 12, M.gold);
    mark(w, 4, zr - 19, 41, zr - 7, 2);
    bridge(43, 3);
  }

  // London Bridge, and The Shard just south of it
  bridge(58, 3, M.concrete);
  {
    const zr = Math.round(river(63));
    const cx = 64, cz = zr + 13;
    for (let y = 3; y <= 50; y++) {
      const h = 3.9 * (1 - (y - 3) / 49) + 0.5;
      g.box(Math.round(cx - h), y, Math.round(cz - h), Math.round(cx + h) - 1, y, Math.round(cz + h) - 1, y % 4 === 0 ? M.glassDark : M.glass);
    }
    g.box(cx, 51, cz, cx, 53, cz, M.steel); g.box(cx - 1, 51, cz - 1, cx - 1, 52, cz - 1, M.steel); // the open, broken tip
    mark(w, cx - 6, cz - 6, cx + 6, cz + 6, 2);
  }

  const glassTower = (x0, z0, wd, dp, floors, cap) => {
    if (!areaFree(w, x0, z0, x0 + wd - 1, z0 + dp - 1, 0)) return;
    const h = floors * 2;
    for (let y = 3; y < 3 + h; y++) g.box(x0, y, z0, x0 + wd - 1, y, z0 + dp - 1, y % 3 === 0 ? M.glassDark : M.glass);
    for (let i = 0; i < floors * 2; i++) {
      const side = r() < 0.5;
      g.set(side ? x0 + Math.floor(r() * wd) : (r() < 0.5 ? x0 : x0 + wd - 1), 4 + Math.floor(r() * (h - 2)), side ? (r() < 0.5 ? z0 : z0 + dp - 1) : z0 + Math.floor(r() * dp), M.lit);
    }
    if (cap) { g.pyramid(x0 + wd / 2, z0 + dp / 2, 3 + h, 3 + h + 4, wd / 2, 0.5, M.steel); g.set(Math.floor(x0 + wd / 2), 3 + h + 5, Math.floor(z0 + dp / 2), M.lit); }
    else g.box(x0 + 1, 3 + h, z0 + 1, x0 + wd - 2, 3 + h, z0 + dp - 2, M.steel);
    mark(w, x0 - 1, z0 - 1, x0 + wd, z0 + dp, 2);
  };
  // the City, north of the river
  for (const [x, z, a, b, f] of [[50, 30, 5, 5, 11], [57, 27, 4, 6, 14], [63, 31, 5, 4, 9], [54, 37, 4, 4, 8], [68, 26, 5, 5, 12]]) glassTower(x, z, a, b, f, false);
  // Canary Wharf, inside the river's loop: the pyramid-topped tower and its neighbours
  {
    const zc = Math.round(river(88)) - 16;
    glassTower(84, zc, 7, 7, 15, true);
    for (const [dx, dz, a, b, f] of [[-8, 1, 5, 6, 12], [9, 0, 5, 5, 13], [-3, -9, 6, 5, 10], [5, -9, 5, 5, 11], [-10, -8, 4, 5, 9], [1, 9, 5, 4, 8]]) glassTower(84 + dx, zc + dz, a, b, f, false);
  }
  bridge(50, 2); bridge(76, 2);

  // parks, then streets of terraced houses with slate roofs
  const park = (x, z) => Math.hypot(x - 24, z - 28) < 9 || Math.hypot(x - 40, z - 84) < 8 || Math.hypot(x - 78, z - 80) < 7;
  for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) if (inDisc(x, z) && !occ[z * X + x] && park(x, z)) g.set(x, 2, z, M.lawn);
  for (let z = 4; z < 100; z += 9) for (let x = 2; x < 102; x++) if (!park(x, z)) roadCell(w, x, z);
  for (let x = 6; x < 100; x += 14) for (let z = 2; z < 102; z++) if (!park(x, z)) roadCell(w, x, z);
  const walls = [M.stone, M.cream, M.concrete, M.stone, M.roofRed];
  for (let i = 0; i < 2600; i++) {
    const alongX = r() < 0.6;
    const wd = alongX ? 5 + Math.floor(r() * 6) : 3, dp = alongX ? 3 : 5 + Math.floor(r() * 6);
    const x0 = 4 + Math.floor(r() * 96), z0 = 4 + Math.floor(r() * 96);
    if (park(x0, z0) || !areaFree(w, x0, z0, x0 + wd - 1, z0 + dp - 1, 0)) continue;
    const top = block(w, x0, z0, wd, dp, 1 + (r() < 0.35 ? 1 : 0), walls[Math.floor(r() * walls.length)], { lit: 0.12 });
    gable(g, x0, z0, wd, dp, top, M.slate);
  }
  scatterTrees(w, 500, (x, z) => park(x, z));
  scatterTrees(w, 260);
  return finish(w, 48, 'skyline', { yaw: 5.38, pitch: 0.56 }, [1, 0.30, 0.74, 0.52, 0.40]);
}

export const SCENES = { loikaw, yangon, london };
