// Three small worlds, built by code. No image files.
//
//   loikaw  Taung Kwe pagoda on its limestone crags, overlooking the town
//   yangon  Shwedagon on its hill, Karaweik on its lake, City Hall and Sule, the river and its cranes
//   london  Westminster and Big Ben, the Eye, the Shard, Tower Bridge, one red bus, one crane
//
// Every scene is made from the same few shapes in engine.js and a seeded
// random number generator, so it comes out the same on every visit.

import { Grid, buildFaces, rng, makeNoise } from './engine.js';

// id -> [r, g, b, accent]   accent: 1 amber, 2 water, 3 a window that can light up, 4 red
const M = {
  grass: 1, earth: 2, road: 3, rock: 4, rockDark: 5, white: 6, cream: 7, concrete: 8,
  roofRed: 9, roofBlue: 10, roofGreen: 11, gold: 12, goldDark: 13, leaf: 14, trunk: 15,
  water: 16, glass: 17, lit: 18, stone: 19, slate: 20, bridge: 21, palm: 22, stupaWhite: 23,
  pavement: 24, glassDark: 25, steel: 26, tin: 27, window: 28, lawn: 29,
  tank: 30, clock: 31, busRed: 32, kGold: 33, kDark: 34, paleGold: 35,
};
const MATERIALS = {
  1: [64, 92, 58, 0], 2: [58, 48, 40, 0], 3: [34, 36, 42, 0], 4: [206, 204, 196, 0], 5: [128, 126, 120, 0],
  6: [234, 232, 224, 0], 7: [216, 198, 162, 0], 8: [152, 154, 160, 0], 9: [172, 74, 60, 0], 10: [62, 112, 192, 0],
  11: [96, 170, 120, 0], 12: [244, 188, 62, 1], 13: [190, 136, 38, 1], 14: [86, 140, 84, 0], 15: [70, 54, 40, 0],
  16: [62, 112, 212, 2], 17: [156, 182, 212, 0], 18: [255, 204, 96, 3], 19: [200, 190, 164, 0], 20: [84, 88, 100, 0],
  21: [146, 146, 152, 0], 22: [74, 144, 84, 0], 23: [242, 240, 232, 0], 24: [180, 178, 172, 0], 25: [72, 88, 114, 0],
  26: [196, 202, 212, 0], 27: [186, 190, 194, 0], 28: [30, 34, 44, 0], 29: [92, 128, 80, 0],
  30: [44, 56, 78, 0], 31: [238, 232, 210, 0], 32: [214, 44, 40, 4], 33: [246, 196, 74, 1], 34: [168, 116, 34, 1],
  35: [232, 212, 156, 1],
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
  'yangon-day': { ...MOOD, inkLight: '#F6EEDA', skyLight: '#3A4C66', ring: '#3C4658', skyGlow: 0.85, gain: 1.12, blueLo: '#121B28', blueHi: '#4A5B72' },
  // amber here is Big Ben's pale gold: the one colour in London besides the red bus
  'london-rain': { ...MOOD, inkDark: '#0A0F16', inkLight: '#D3DEEE', skyDark: '#0A0F16', skyLight: '#2A3850', ring: '#2E3B54', skyGlow: 0.6, gain: 1.22, contrast: 1.5, amberLo: '#6E5B32', amberHi: '#EADCA8', blueLo: '#0E1520', blueHi: '#3A4A66', redLo: '#5A1512', redHi: '#E8402F', rain: true, rainInk: '#8FA3C4' },
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

// An eight-sided slab: a square with its corners cut off, the shape of a stupa's terraces.
function octagon(g, cx, cz, y, r, m) {
  const cut = r * Math.SQRT2;
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = Math.abs(x + 0.5 - cx), dz = Math.abs(z + 0.5 - cz);
      if (dx <= r && dz <= r && dx + dz <= cut) g.set(x, y, z, m);
    }
  }
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
// The highest block in the world and where it stands: the page uses it to keep the top of the tallest landmark in view.
function peakOf(g) {
  const { X, Y, Z, d } = g;
  for (let y = Y - 1; y >= 0; y--) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) if (d[(y * Z + z) * X + x]) return [x + 0.5, y + 1, z + 0.5];
  return [X / 2, 0, Z / 2];
}

function finish(w, tallest, ringKind, start, shade) {
  const faces = buildFaces(w.g, MATERIALS, shade);
  const span = w.R * 2 + 4;
  return {
    size: [w.X, w.Y, w.Z], faces, ring: ringOf(w.X * 7 + tallest, ringKind), start, span, tallest, waterY: 2, peak: peakOf(w.g),
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
  // a second gilded stupa on its white drum
  t = g.top(38, 17);
  g.cylinder(38.5, 17.5, t, t + 1, 3.4, M.stupaWhite);
  stupa(g, 38.5, 17.5, t + 2, 1.1);
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

// ---------- Yangon: Shwedagon, Karaweik on its lake, City Hall, Sule, the river and its cranes ----------
export function yangon() {
  const B = 1;                                   // water level
  const w = world(100, 70, 100, 48, 2012);
  const { g, r, n, X, Z, hm, occ, inDisc } = w;
  const SX = 40.5, SZ = 38.5;                    // Shwedagon
  const KX = 74, KZ = 63;                        // Karaweik, on the water by the lake's north shore

  const hill = (x, z) => Math.max(0, 1 - Math.hypot(x + 0.5 - SX, z + 0.5 - SZ) / 21);
  ground(w, 0, (x, z) => B + 1 + Math.round(hill(x, z) * 6));

  // Kandawgyi Lake (front right) and the Yangon River (front left edge)
  const lake = (x, z) => {
    const d = (cx, cz, rx, rz) => Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz);
    return Math.min(d(72, 70, 21, 14), d(58, 79, 10, 7), d(86, 62, 8, 9)) + (n(x / 5, z / 5) - 0.5) * 0.3;
  };
  const river = (x, z) => (z + 0.5) - (84 + (x - 30) * 0.22 + (n(x / 9, 3) - 0.5) * 2) ;   // > 0 means in the river
  for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
    if (!inDisc(x, z)) continue;
    const i = z * X + x;
    const inRiver = x < 58 && river(x, z) > 0;
    const v = lake(x, z);
    if (v < 1 || inRiver) {
      g.box(x, B, z, x, hm[i], z, 0); g.set(x, B, z, M.water); hm[i] = B; occ[i] = 3;
    } else if (v < 1.13 || (x < 60 && river(x, z) > -2.2)) { g.set(x, hm[i], z, M.pavement); occ[i] = 5; }
  }

  // ---- Shwedagon: eight-sided terraces, the wide bell, the banded turban, lotus, banana bud, the hti; shrines all round ----
  const base = B + 7;
  g.cylinder(SX, SZ, base - 1, base, 18.5, M.pavement);              // the marble platform
  mark(w, 19, 17, 62, 60, 5);
  let y = base + 1;
  // six eight-sided terraces, each a little smaller than the one below, a dark course at the foot of each step
  for (const [rad, h] of [[12.6, 2], [11.4, 2], [10.4, 2], [9.5, 2], [8.7, 2], [8.0, 1]]) {
    for (let i = 0; i < h; i++) octagon(g, SX, SZ, y + i, rad, i === 0 && h > 1 ? M.goldDark : M.gold);
    y += h;
  }
  // the bell: as wide as the top terrace at its lip, curving in smoothly; a dark line above the lip and round its waist
  const bellH = 11;
  for (let i = 0; i < bellH; i++) {
    const t = i / (bellH - 1), line = i === 1 || i === 5;
    g.disc(SX, SZ, y + i, 4.0 + 3.6 * Math.pow(1 - t, 1.6) - (line ? 0.35 : 0), line ? M.goldDark : M.gold);
  }
  y += bellH;
  // the turban: eight bands, gold and dark gold by turns, each a little smaller, the dark ones set in
  for (let i = 0; i < 8; i++) { const rad = 3.8 - i * 0.16; g.disc(SX, SZ, y, i % 2 ? rad - 0.4 : rad, i % 2 ? M.goldDark : M.gold); y += 1; }
  // the lotus: a short flare
  for (const [rad, m] of [[2.9, M.goldDark], [3.1, M.gold]]) { g.disc(SX, SZ, y, rad, m); y += 1; }
  // the banana bud: a long smooth swelling drawn to a point, then a thin neck
  for (const rad of [2.0, 2.2, 2.3, 2.3, 2.2, 2.0, 1.7, 1.3, 0.9]) { g.disc(SX, SZ, y, rad, M.gold); y += 1; }
  g.box(Math.floor(SX), y, Math.floor(SZ), Math.floor(SX), y + 1, Math.floor(SZ), M.gold); y += 2;
  // the umbrella (hti): three small tiers, then the vane and the orb
  g.disc(SX, SZ, y, 1.7, M.goldDark); g.disc(SX, SZ, y + 1, 1.3, M.gold); g.disc(SX, SZ, y + 2, 0.9, M.goldDark);
  g.box(Math.floor(SX), y + 3, Math.floor(SZ), Math.floor(SX), y + 5, Math.floor(SZ), M.gold);
  g.set(Math.floor(SX) + 1, y + 4, Math.floor(SZ), M.gold);
  g.set(Math.floor(SX), y + 6, Math.floor(SZ), M.gold);
  const top = y + 6;
  // a small gilded shrine: a pale foot, then one cone from its bell to a point, with two dark rings and a short finial.
  // k: 0 short .. 1 tall; even the tallest stay well below the top of the terraces, so the bell shows between them
  const spire = (sx, sz, k) => {
    const fx = Math.floor(sx), fz = Math.floor(sz);
    sx = fx + 0.5; sz = fz + 0.5;                                     // centred on one cell, so the shape comes out even
    const rr = 0.6 + k * 0.7, h = 3 + Math.round(k * 5);
    g.disc(sx, sz, base + 1, rr + 0.4, M.stupaWhite);
    for (let j = 0; j <= h; j++) {
      const ringLine = j === Math.round(h * 0.4) || j === Math.round(h * 0.7);
      g.disc(sx, sz, base + 2 + j, rr + (0.5 - rr) * j / h, ringLine ? M.goldDark : M.gold);
    }
    g.box(fx, base + 3 + h, fz, fx, base + 3 + h + Math.round(k), fz, M.goldDark);
  };
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) spire(SX + dx * 11, SZ + dz * 11, 0.9);   // the four corner stupas
  // two dense rings of shrines, tall and short by turns, with gaps where the four stairs arrive and where the corner stupas stand
  const shrineRing = (rad, count, ks) => {
    for (let i = 0; i < count; i++) {
      const deg = i * 360 / count;
      const toStair = Math.abs(((deg + 45) % 90) - 45), toCorner = Math.abs((deg % 90) - 45);
      if (toStair < 16 || toCorner < 12) continue;
      const a = deg * Math.PI / 180;
      spire(SX + Math.cos(a) * rad, SZ + Math.sin(a) * rad, ks[i % ks.length]);
    }
  };
  shrineRing(13.6, 48, [0.05, 0.3, 0.15, 0.4]);
  shrineRing(16.3, 56, [0.2, 0.55, 0.35, 0.65, 0.45]);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // a shrine hall with a tiered roof at the head of each stair, and the covered stair running down the hill
    const hx = Math.floor(SX + dx * 15.8), hz = Math.floor(SZ + dz * 15.8);
    g.box(hx - 2, base + 1, hz - 2, hx + 2, base + 2, hz + 2, M.white);
    for (let t = 0; t < 3; t++) { g.box(hx - 2 + t, base + 3 + t * 2, hz - 2 + t, hx + 2 - t, base + 3 + t * 2, hz + 2 - t, M.goldDark); if (t < 2) g.box(hx - 1 + t, base + 4 + t * 2, hz - 1 + t, hx + 1 - t, base + 4 + t * 2, hz + 1 - t, M.white); }
    g.box(hx, base + 8, hz, hx, base + 10, hz, M.gold);
    for (let k = 19; k < 28; k++) {
      const x = Math.floor(SX + dx * k), z = Math.floor(SZ + dz * k);
      if (!inDisc(x, z, 2)) break;
      const yy = hm[z * X + x] + 1;
      g.box(x - Math.abs(dz), yy, z - Math.abs(dx), x + Math.abs(dz), yy + 1, z + Math.abs(dx), M.white);
      g.box(x - Math.abs(dz), yy + 2, z - Math.abs(dx), x + Math.abs(dz), yy + 2, z + Math.abs(dx), M.roofRed);
      mark(w, x - 1, z - 1, x + 1, z + 1, 5);
    }
  }

  // ---- Karaweik: two great golden birds side by side, carrying a tiered palace on their backs ----
  {
    const put = (x0, h0, z0, x1, h1, z1, m) => g.box(x0, B + 1 + h0, z0, x1, B + 1 + h1, z1, m);
    for (const side of [-1, 1]) {
      const zc = KZ + side * 3;
      put(KX - 7, 0, zc - 1, KX + 6, 1, zc + 1, M.kGold);             // the bird's body (the hull)
      put(KX - 9, 1, zc - 1, KX - 8, 2, zc + 1, M.kGold);             // breast
      put(KX - 10, 2, zc, KX - 9, 6, zc, M.kGold);                    // neck
      put(KX - 11, 6, zc, KX - 9, 7, zc, M.kGold);                    // head
      put(KX - 12, 6, zc, KX - 12, 6, zc, M.kDark);                   // beak
      put(KX - 10, 8, zc, KX - 10, 8, zc, M.kGold);                   // crest
      put(KX + 7, 1, zc - 1, KX + 8, 3, zc + 1, M.kGold);             // tail, rising
      put(KX + 9, 3, zc, KX + 9, 7, zc, M.kGold);
    }
    put(KX - 6, 2, KZ - 4, KX + 5, 2, KZ + 4, M.kDark);               // the deck across both backs
    put(KX - 5, 3, KZ - 3, KX + 4, 4, KZ + 3, M.cream);               // the hall
    for (let x = KX - 4; x <= KX + 3; x += 2) for (const z of [KZ - 3, KZ + 3]) put(x, 4, z, x, 4, z, M.window);
    for (let t = 0; t < 4; t++) {                                     // the tiered roof, shrinking as it rises
      put(KX - 6 + t * 1.5 | 0, 5 + t * 2, KZ - 4 + t, KX + 5 - (t * 1.5 | 0), 5 + t * 2, KZ + 4 - t, M.kDark);
      if (t < 3) put(KX - 4 + (t * 1.5 | 0), 6 + t * 2, KZ - 2 + t, KX + 3 - (t * 1.5 | 0), 6 + t * 2, KZ + 2 - t, M.cream);
    }
    put(KX - 1, 12, KZ, KX, 14, KZ, M.kGold);
    put(KX, 15, KZ, KX, 17, KZ, M.kGold);
    mark(w, KX - 13, KZ - 5, KX + 10, KZ + 5, 3);
  }

  // ---- City Hall: a long pale block with tiered Burmese roofs at the corners and over the door; Sule Pagoda beside it ----
  {
    const x0 = 64, z0 = 22, wd = 26, dp = 11;
    const topY = block(w, x0, z0, wd, dp, 4, M.cream, { floor: 2 });
    g.box(x0, topY, z0, x0 + wd - 1, topY, z0 + dp - 1, M.stone);
    const tier = (cx, cz, k) => { for (let t = 0; t < k; t++) { g.box(cx - (k - t), topY + 1 + t * 2, cz - (k - t), cx + (k - t), topY + 1 + t * 2, cz + (k - t), M.slate); g.box(cx - (k - t - 1), topY + 2 + t * 2, cz - (k - t - 1), cx + (k - t - 1), topY + 2 + t * 2, cz + (k - t - 1), M.cream); } g.box(cx, topY + 1 + k * 2, cz, cx, topY + 2 + k * 2, cz, M.stone); };
    tier(x0 + 3, z0 + 3, 3); tier(x0 + wd - 4, z0 + 3, 3); tier(x0 + 3, z0 + dp - 4, 3); tier(x0 + wd - 4, z0 + dp - 4, 3);
    tier(x0 + Math.floor(wd / 2), z0 + dp - 5, 4);
    // Sule: a small eight-sided stupa on its roundabout (gilded, like Shwedagon and Karaweik: gold is the only colour in this scene)
    const sx = 56.5, sz = 12.5, sy = hm[12 * X + 56] + 1;
    for (let a = 0; a < 40; a++) { const t = a / 40 * Math.PI * 2; roadCell(w, Math.floor(sx + Math.cos(t) * 5.5), Math.floor(sz + Math.sin(t) * 5.5)); }
    g.cylinder(sx, sz, sy, sy, 3.6, M.stupaWhite);
    g.taper(sx, sz, sy + 1, sy + 4, 2.8, 1.3, M.gold);
    g.taper(sx, sz, sy + 5, sy + 9, 1.2, 0.5, M.gold);
    g.box(56, sy + 10, 12, 56, sy + 12, 12, M.gold);
    mark(w, 50, 6, 63, 19, 5);
  }

  // ---- the port: a quay and two big gantry cranes on the river ----
  for (const cx of [20, 38]) {
    const cz = Math.floor(84 + (cx - 30) * 0.22) - 5;
    const gy = hm[cz * X + cx] + 1;
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) g.box(cx + dx, gy, cz + dz, cx + dx, gy + 17, cz + dz, M.steel);
    for (const dz of [-3, 3]) { g.box(cx - 3, gy + 9, cz + dz, cx + 3, gy + 9, cz + dz, M.steel); g.box(cx - 3, gy + 17, cz + dz, cx + 3, gy + 17, cz + dz, M.steel); }
    g.box(cx - 1, gy + 18, cz - 8, cx + 1, gy + 18, cz + 11, M.steel);          // the boom, out over the water
    g.box(cx, gy + 19, cz - 3, cx, gy + 27, cz - 3, M.steel);                  // the mast
    for (let k = 0; k <= 18; k++) g.set(cx, gy + 27 - Math.round(k * 0.45), cz - 3 + k, M.steel);   // the forestay
    for (let k = 0; k <= 5; k++) g.set(cx, gy + 27 - Math.round(k * 1.6), cz - 3 - k, M.steel);      // the backstay
    g.box(cx - 1, gy + 15, cz + 12, cx + 1, gy + 17, cz + 14, M.tank);           // the driver's cab under the boom
    mark(w, cx - 4, cz - 9, cx + 4, cz + 4, 2);
  }
  for (let i = 0; i < 9; i++) {                                                 // containers piled on the quay
    const x0 = 10 + i * 5, z0 = Math.floor(84 + (x0 - 30) * 0.22) - 9;
    if (!areaFree(w, x0, z0, x0 + 3, z0 + 1, 0)) continue;
    const gy = hm[z0 * X + x0] + 1, hgt = 1 + (i % 3);
    g.box(x0, gy, z0, x0 + 3, gy + hgt - 1, z0 + 1, [M.roofBlue, M.tin, M.roofRed][i % 3]);
    mark(w, x0, z0, x0 + 3, z0 + 1, 2);
  }

  // streets
  for (let z = 2; z < 98; z++) for (const xx of [14, 15, 64, 65, 88]) roadCell(w, xx, z);
  for (let x = 2; x < 98; x++) for (const zz of [8, 9, 32, 33, 60, 61]) roadCell(w, x, zz);

  // low blocks everywhere else, many with a water tank on the roof
  const walls = [M.cream, M.concrete, M.white, M.cream, M.stone];
  for (let i = 0; i < 2600; i++) {
    const wd = 3 + Math.floor(r() * 4), dp = 3 + Math.floor(r() * 4);
    const x0 = 4 + Math.floor(r() * 92), z0 = 4 + Math.floor(r() * 92);
    if (!areaFree(w, x0, z0, x0 + wd - 1, z0 + dp - 1, 0)) continue;
    const downtown = x0 > 50 && z0 < 50;
    const floors = downtown ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 3);
    const topY = block(w, x0, z0, wd, dp, floors, walls[Math.floor(r() * walls.length)], { lit: 0.05 });
    g.box(x0, topY, z0, x0 + wd - 1, topY, z0 + dp - 1, M.tin);
    if (r() < 0.45) {                                                          // the tank: a dark drum on short legs
      const tx = x0 + 1 + Math.floor(r() * (wd - 2)), tz = z0 + 1 + Math.floor(r() * (dp - 2));
      g.set(tx, topY + 1, tz, M.steel); g.set(tx, topY + 2, tz, M.tank);
    }
  }
  scatterTrees(w, 1500, (x, z) => lake(x, z) > 1.45);   // keep the lake shore clear so the water can mirror what stands on it
  return finish(w, top, 'skyline', { yaw: 0.62, pitch: 0.52 }, [1, 0.74, 0.30, 0.52, 0.40]);
}

// ---------- London: Westminster and Big Ben in front, the Eye, the Shard, Tower Bridge, one red bus, one crane ----------
export function london() {
  const w = world(108, 72, 108, 52, 2024);
  const { g, r, n, X, Z, hm, occ, inDisc } = w;
  // Seen from the opening angle: the near bank is large z, the Thames runs across the middle, the far bank is small z.
  const HZ = 50;
  const riverZ = () => HZ;
  const distRiver = (x, z) => {
    const px = x + 0.5, pz = z + 0.5;
    let d = px <= 72 ? Math.abs(pz - HZ) : 1e9;                                             // the leg across the middle
    if (pz >= 64) d = Math.min(d, Math.abs(px - 86));                                        // the leg toward the viewer
    if (px > 72 && pz < 64) d = Math.min(d, Math.abs(Math.hypot(px - 72, pz - 64) - 14));    // the bend between them
    return d;
  };
  const inRiver = (x, z) => distRiver(x, z) < 6.2 + (n(x / 8, z / 8) - 0.5) * 1.2;
  ground(w, 0, () => 3);
  for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
    if (!inDisc(x, z)) continue;
    const i = z * X + x;
    if (inRiver(x, z)) { g.box(x, 1, z, x, 3, z, 0); g.set(x, 1, z, M.water); hm[i] = 1; occ[i] = 3; }
    else if (distRiver(x, z) < 8.2) { g.set(x, 3, z, M.pavement); occ[i] = 5; }               // the embankment
  }

  const bridge = (x0, wd, mat, piers) => {
    const zc = Math.round(riverZ(x0));
    g.box(x0, 4, zc - 9, x0 + wd - 1, 4, zc + 9, mat);
    for (const dz of piers) g.box(x0, 1, zc + dz, x0 + wd - 1, 3, zc + dz, M.stone);
    for (let z = zc - 9; z <= zc + 9; z++) { g.set(x0 - 1, 5, z, mat); g.set(x0 + wd, 5, z, mat); }  // parapets
    mark(w, x0 - 1, zc - 10, x0 + wd, zc + 10, 5);
    return zc;
  };

  // ---- Westminster: the long palace on the near bank, the Victoria Tower at one end, Big Ben at the other ----
  const pz = Math.round(riverZ(44)) + 9;                 // the palace's river front
  g.box(20, 4, pz, 54, 10, pz + 7, M.stone);
  for (let x = 20; x <= 54; x += 2) {
    g.box(x, 11, pz, x, 12, pz, M.stone); g.box(x, 11, pz + 7, x, 12, pz + 7, M.stone);             // pinnacles along both fronts
    for (const y of [6, 8]) { g.set(x + 1, y, pz, M.window); g.set(x + 1, y, pz + 7, M.window); }
  }
  g.box(21, 11, pz + 1, 53, 11, pz + 6, M.slate);
  g.box(13, 4, pz - 1, 20, 24, pz + 8, M.stone);                                                  // Victoria Tower
  for (const [x, z] of [[13, pz - 1], [20, pz - 1], [13, pz + 8], [20, pz + 8]]) g.box(x, 25, z, x, 29, z, M.stone);
  for (let y = 7; y < 23; y += 4) for (let x = 15; x <= 18; x += 3) { g.box(x, y, pz - 1, x, y + 1, pz - 1, M.window); g.box(x, y, pz + 8, x, y + 1, pz + 8, M.window); }
  g.pyramid(37.5, pz + 4, 12, 17, 1.8, 0.5, M.slate);                                             // the central spire
  // Big Ben (the Elizabeth Tower), in pale gold: the shaft, a clock stage standing proud with a large pale face on each side,
  // then the stepped roof, the lantern and the spire
  const bx = 56, bz = pz + 1;
  g.box(bx, 4, bz, bx + 6, 30, bz + 6, M.paleGold);
  for (let y = 7; y < 29; y += 3) for (const k of [2, 4]) { g.set(bx + k, y, bz, M.window); g.set(bx + k, y, bz + 6, M.window); g.set(bx, y, bz + k, M.window); g.set(bx + 6, y, bz + k, M.window); }
  g.box(bx - 1, 31, bz - 1, bx + 7, 39, bz + 7, M.paleGold);
  for (let i = 1; i <= 5; i++) for (let y = 33; y <= 37; y++) {
    const face = (i === 3 && (y === 35 || y === 36)) || (i === 4 && y === 35) ? M.window : M.clock;   // the two hands
    g.set(bx + i, y, bz - 1, face); g.set(bx + i, y, bz + 7, face); g.set(bx - 1, y, bz + i, face); g.set(bx + 7, y, bz + i, face);
  }
  g.pyramid(bx + 3.5, bz + 3.5, 40, 44, 4.4, 2.2, M.paleGold);
  g.box(bx + 2, 45, bz + 2, bx + 4, 46, bz + 4, M.paleGold);
  g.pyramid(bx + 3.5, bz + 3.5, 47, 52, 1.6, 0.5, M.paleGold);
  g.box(bx + 3, 53, bz + 3, bx + 3, 55, bz + 3, M.paleGold);
  mark(w, 11, pz - 3, 64, pz + 10, 2);

  // Westminster Bridge beside Big Ben, and the road it carries across the near bank
  const wzc = bridge(65, 4, M.bridge, [-4, 0, 4]);
  for (let z = wzc + 9; z < Z; z++) for (let x = 65; x <= 68; x++) roadCell(w, x, z);
  for (let x = 4; x < 104; x++) for (const zz of [pz + 13, pz + 14]) roadCell(w, x, zz);             // the road in front of Parliament
  // the one red bus: a double-decker on that road, with open lawn in front so nothing hides it
  {
    const x0 = 36, z0 = pz + 13;
    for (let z = z0 + 2; z <= z0 + 9; z++) for (let x = 26; x <= 56; x++) if (inDisc(x, z, 2) && !occ[z * X + x]) { g.set(x, 3, z, M.lawn); occ[z * X + x] = 5; }
    g.box(x0, 4, z0, x0 + 7, 8, z0 + 1, M.busRed);
    for (let x = x0; x <= x0 + 7; x++) for (const y of [5, 7]) if (x !== x0 + 3) { g.set(x, y, z0 + 1, M.window); g.set(x, y, z0, M.window); }
    g.set(x0 + 7, 5, z0, M.window); g.set(x0 + 7, 5, z0 + 1, M.window);
  }

  // ---- the London Eye on the far bank, left: a wheel facing the river, its hub, legs and pods ----
  {
    const ex = 30.5, ez = Math.round(riverZ(30)) - 9, ey = 22.5, R = 16;
    for (let a = 0; a < 360; a += 2) {
      const t = a * Math.PI / 180;
      g.set(Math.round(ex + Math.cos(t) * R - 0.5), Math.round(ey + Math.sin(t) * R - 0.5), ez, M.steel);
      if (a % 20 === 0) g.set(Math.round(ex + Math.cos(t) * (R + 1.5) - 0.5), Math.round(ey + Math.sin(t) * (R + 1.5) - 0.5), ez, M.glass);  // pods
    }
    for (let a = 0; a < 360; a += 30) { const t = a * Math.PI / 180; for (let k = 2; k < R; k += 2) g.set(Math.round(ex + Math.cos(t) * k - 0.5), Math.round(ey + Math.sin(t) * k - 0.5), ez, M.steel); }  // spokes
    g.box(29, 22, ez - 1, 31, 23, ez + 1, M.white);                                                 // hub
    for (let k = 0; k <= 19; k++) { g.set(Math.round(30 - k * 0.45), 22 - k, ez - 1 - Math.round(k * 0.35), M.steel); g.set(Math.round(30 + k * 0.45), 22 - k, ez - 1 - Math.round(k * 0.35), M.steel); }  // A-frame legs, leaning back
    mark(w, 12, ez - 9, 49, ez + 2, 5);
  }

  // ---- the Shard: a glass pyramid at the back, its faces set back in facets, a floor line on every level,
  //      and at the top the faces go on as separate fins that never meet ----
  {
    const cx = 60, cz = 20, top = 52;
    const pane = (y) => (y % 2 ? M.glass : M.glassDark);          // a bright floor, then a dark one
    for (let y = 4; y <= top; y++) {
      const h = 2.5 + 3.0 * (1 - (y - 4) / (top - 4));              // half-width: 5.5 at the foot, 2.5 at the top
      const x0 = Math.round(cx - h), x1 = Math.round(cx + h) - 1, z0 = Math.round(cz - h), z1 = Math.round(cz + h) - 1;
      g.box(x0, y, z0, x1, y, z1, pane(y));
      if (x1 - x0 >= 5) {                                           // one half of each face stands a step back: the facet edges
        g.box(x1, y, cz, x1, y, z1, 0); g.box(x0, y, z0, x0, y, cz - 1, 0);
        g.box(x0, y, z1, cx - 1, y, z1, 0); g.box(cx, y, z0, x1, y, z0, 0);
      }
    }
    // the fins: each face of the top goes on alone, narrowing as it rises, none of them touching at the corners
    for (const [x0, z0, x1, z1, y0, y1] of [
      [cx - 2, cz - 1, cx - 2, cz + 1, top + 1, 58], [cx - 2, cz - 1, cx - 2, cz, 59, 62], [cx - 2, cz - 1, cx - 2, cz - 1, 63, 64],   // west, the tallest
      [cx + 2, cz - 1, cx + 2, cz + 1, top + 1, 56], [cx + 2, cz, cx + 2, cz + 1, 57, 59],                                             // east
      [cx, cz - 2, cx + 1, cz - 2, top + 1, 58], [cx + 1, cz - 2, cx + 1, cz - 2, 59, 61],                                             // north
      [cx - 1, cz + 2, cx, cz + 2, top + 1, 55], [cx - 1, cz + 2, cx - 1, cz + 2, 56, 56],                                             // south
    ]) for (let y = y0; y <= y1; y++) g.box(x0, y, z0, x1, y, z1, pane(y));
    mark(w, cx - 7, cz - 7, cx + 7, cz + 7, 2);
  }

  // ---- Tower Bridge, right: two stone towers side by side, the high walkways, the road deck, the hanging side spans ----
  {
    const tz = 82, xc = 86;
    g.box(xc - 13, 4, tz, xc + 13, 4, tz + 3, M.bridge);                                            // the road
    for (const dx of [-5, 5]) {
      const x0 = xc + dx - 2;
      g.box(x0, 1, tz - 1, x0 + 4, 3, tz + 4, M.stone);                                             // pier
      g.box(x0, 5, tz - 1, x0 + 4, 22, tz + 4, M.stone);                                            // tower
      g.box(x0, 5, tz, x0 + 4, 8, tz + 3, 0);                                                       // the road runs through the arch
      for (let y = 11; y < 21; y += 3) for (const z of [tz - 1, tz + 4]) { g.set(x0 + 1, y, z, M.window); g.set(x0 + 3, y, z, M.window); }
      for (const [x, z] of [[x0, tz - 1], [x0 + 4, tz - 1], [x0, tz + 4], [x0 + 4, tz + 4]]) g.box(x, 23, z, x, 26, z, M.stone);   // corner turrets
      g.pyramid(x0 + 2.5, tz + 2, 23, 28, 2.6, 0.5, M.slate);
      g.box(x0 + 2, 29, tz + 1, x0 + 2, 31, tz + 1, M.stone);
    }
    for (const z of [tz, tz + 3]) g.box(xc - 3, 18, z, xc + 3, 19, z, M.steel);                     // the two high walkways
    for (const sgn of [-1, 1]) for (let k = 0; k <= 10; k++) {                                      // the chains of the side spans
      const x = xc + sgn * (8 + k), y = Math.max(6, Math.round(21 - k * 1.7 + k * k * 0.03));
      for (const z of [tz - 1, tz + 4]) { g.set(x, y, z, M.steel); if (k % 3 === 1) g.box(x, 5, z, x, y, z, M.steel); }
    }
    for (const sgn of [-1, 1]) g.box(xc + sgn * 19 - 1, 1, tz - 1, xc + sgn * 19 + 1, 9, tz + 4, M.stone);   // the abutment towers
    mark(w, xc - 21, tz - 3, xc + 21, tz + 6, 5);
  }

  // ---- one tower crane, near the Shard ----
  {
    const cx = 76, cz = 26;
    g.box(cx, 4, cz, cx, 34, cz, M.steel);
    g.box(cx - 6, 35, cz, cx + 17, 35, cz, M.steel);                                                // jib and counter-jib
    g.box(cx - 6, 33, cz, cx - 4, 34, cz, M.slate);                                                 // counterweight
    g.box(cx, 36, cz, cx, 39, cz, M.steel);
    for (let k = 1; k <= 8; k++) { g.set(cx + k * 2, 39 - Math.ceil(k / 2), cz, M.steel); if (k <= 3) g.set(cx - k * 2, 39 - k, cz, M.steel); }  // the stays
    g.box(cx + 12, 30, cz, cx + 12, 34, cz, M.steel);                                               // the hook line
    block(w, cx - 4, cz + 3, 9, 7, 5, M.concrete); // the building it is putting up
    mark(w, cx - 1, cz - 1, cx + 1, cz + 1, 2);
  }

  // two plain bridges between Westminster and Tower Bridge, a park, streets, and the rest of the city
  bridge(6, 3, M.bridge, [-4, 0, 4]);
  for (let z = 4; z < 104; z++) for (const xx of [8, 9, 52, 53, 98]) roadCell(w, xx, z);
  for (let x = 4; x < 104; x++) for (const zz of [12, 13, 30, 31, 92, 93]) roadCell(w, x, zz);
  for (let z = 80; z < 92; z++) for (let x = 20; x < 46; x++) if (inDisc(x, z, 2) && !occ[z * X + x]) { g.set(x, 3, z, M.lawn); if (r() < 0.12) tree(w, x, z); else occ[z * X + x] = 5; }

  const walls = [M.stone, M.cream, M.concrete, M.white, M.stone];
  for (let i = 0; i < 3200; i++) {
    const far = r() < 0.55;
    const wd = 3 + Math.floor(r() * 5), dp = 3 + Math.floor(r() * 4);
    const x0 = 4 + Math.floor(r() * 100), z0 = far ? 4 + Math.floor(r() * 38) : 60 + Math.floor(r() * 44);
    if (!areaFree(w, x0, z0, x0 + wd - 1, z0 + dp - 1, 0)) continue;
    const city = far && x0 > 44;
    const floors = city ? 3 + Math.floor(r() * 3) : 2 + Math.floor(r() * 2);
    const topY = block(w, x0, z0, wd, dp, floors, walls[Math.floor(r() * walls.length)], { lit: 0.08 });
    if (city) g.box(x0, topY, z0, x0 + wd - 1, topY, z0 + dp - 1, M.steel); else gable(g, x0, z0, wd, dp, topY, M.slate);
  }
  scatterTrees(w, 900);
  return finish(w, 64, 'skyline', { yaw: 0.32, pitch: 0.5 }, [1, 0.66, 0.36, 0.86, 0.30]);
}

export const SCENES = { loikaw, yangon, london };
