// The quiet backgrounds of the Story page: everything that is not a 3D city.
//
//   photo walls   one photograph of Taung Kwe pagoda in Loikaw, redrawn as dithered pixels in a few
//                 inks. The same picture is inked four ways (warm, dusk, pale, paler), smoke can
//                 rise behind the rocks, and press-and-hold dissolves it back to its real colours.
//   drawn walls   a dithered sky, two or three flat silhouettes, one small motion (clouds).
//
// The text is the hero. These stay behind it: still enough to read over, never busy.

const BAYER = [0, 136, 34, 170, 204, 68, 238, 102, 51, 187, 17, 153, 255, 119, 221, 85];

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const pack = (c) => (255 << 24 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0;
const ink = (s) => pack(hex(s));

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- what each slide shows ----------
// grade: how the photograph is inked. The sky and the land each get a short ramp of inks, dark to light; every
// pixel lands between two neighbouring inks by its brightness and is dithered between them. `dot` is the size
// of the dither (2 fine, 4 heavy).
export const WALLS = {
  // 1: warm green and gold
  'loikaw-gold': { kind: 'photo', grade: { sky: ['#0A1330', '#142658', '#2447A0', '#3F6BD0'], land: ['#0B120E', '#1F3322', '#6E5416', '#DFA02C', '#FBE3A0'], gain: 1.15, contrast: 1.25, dot: 2 } },
  // 3: the same place at dusk, quieter
  'loikaw-dusk': { kind: 'photo', grade: { sky: ['#060A18', '#0E1838', '#1B2C5C', '#2A4180'], land: ['#07090D', '#141B28', '#3E3220', '#9A7230', '#D6B878'], gain: 0.95, contrast: 1.2, dot: 2 }, clouds: { count: 3, speed: 2.2, tone: '#22366A', band: [0.04, 0.3] } },
  // 4: the colour drains away; the first smoke
  'loikaw-pale': { kind: 'photo', grade: { sky: ['#59606E', '#7C8390', '#A3A9B4', '#C4C9D1'], land: ['#3A4049', '#666B74', '#97978F', '#C8C1AC', '#E8E4D8'], gain: 1.1, contrast: 1.0, dot: 4 }, smoke: [{ x: 0.63, y: 0.52, size: 0.8 }] },
  // 5: pale grey, more smoke, the road out
  'loikaw-leaving': { kind: 'photo', grade: { sky: ['#666D7A', '#8A909B', '#ADB2BB', '#CBCFD6'], land: ['#4A505A', '#747982', '#9FA3AA', '#C8CBD0', '#E6E8EA'], gain: 1.1, contrast: 0.9, dot: 4 }, smoke: [{ x: 0.2, y: 0.5, size: 1.1 }, { x: 0.58, y: 0.44, size: 0.9 }, { x: 0.86, y: 0.56, size: 1.25 }], road: true },

  dawn: {
    kind: 'wall', seed: 61,
    sky: ['#0C1120', '#16213A', '#2B3556', '#5C5670', '#A9837E', '#D9AE8C'],
    clouds: { count: 5, speed: 3, tone: '#3A4568', band: [0.08, 0.42] },
    layers: [
      { shape: 'stupa-city', base: 0.64, scale: 1, color: '#27304C' },
      { shape: 'rooftops', base: 0.76, scale: 1, color: '#171D30' },
      { shape: 'palms', base: 0.9, scale: 1, color: '#0B0D10' },
    ],
  },
  sunrise: {
    kind: 'wall', seed: 73,
    sky: ['#181630', '#3A2748', '#8A3F46', '#D4683A', '#F09A3E', '#F8CD6A'],
    sun: { x: 0.68, y: 0.6, r: 0.085, core: '#FFF0BC', halo: '#F8CD6A' },
    clouds: { count: 7, speed: 11, tone: '#5A2F44', band: [0.06, 0.46] },
    layers: [
      { shape: 'stupa-city', base: 0.66, scale: 0.9, color: '#4A2A3C' },
      { shape: 'rooftops', base: 0.78, scale: 1.05, color: '#2A1828' },
      { shape: 'palms', base: 0.91, scale: 1.1, color: '#0B0D10' },
    ],
  },
  onward: {
    kind: 'wall', seed: 97,
    sky: ['#13204A', '#2C4486', '#6C62A0', '#C96D84', '#F2994F', '#FFDA8C'],
    sun: { x: 0.3, y: 0.63, r: 0.07, core: '#FFF4C8', halo: '#FFDA8C' },
    clouds: { count: 5, speed: 2.4, tone: '#8A79B4', band: [0.08, 0.4] },
    layers: [
      { shape: 'hills', base: 0.66, scale: 1, color: '#34407A' },
      { shape: 'yangon-london', base: 0.74, scale: 1, color: '#1B2347' },
      { shape: 'hedge', base: 0.9, scale: 1, color: '#0B0D10' },
    ],
  },
};

// ---------- silhouettes: a height for every column, in design units (the picture is 320 units wide) ----------
// The bell of a Burmese pagoda from its foot to the band under the spire, as (half-width, height) in units of the
// lip's half-width: a flared foot, the lip, near-vertical sides, then a shoulder that curves in toward the spire.
const BELL = [[1.2, 0.76], [1.1, 0.9], [1.0, 1.12], [0.98, 1.42], [0.93, 1.62], [0.82, 1.78], [0.68, 1.9], [0.62, 2.04]];

// Landmarks shrink a little on narrow pictures so a whole skyline still fits across a phone.
const fit = (n) => Math.min(1, Math.max(0.7, n / 300));

function outline(shape, seed, n) {
  const r = rng(seed);
  const h = new Float32Array(n);
  const stamp = (x0, w, f) => { for (let i = 0; i < w; i++) { const x = Math.round(x0 + i); if (x >= 0 && x < n) h[x] = Math.max(h[x], f(i / Math.max(1, w - 1))); } };
  const k = fit(n);
  // a pagoda at cx whose terraces start at `ground`: three stepped terraces, the bell (BELL above), a spire that
  // tapers in rings, and a pointed hti. R is the half-width of the bell's lip; small pagodas get a longer spire.
  const pagoda = (cx, R, ground) => {
    cx = Math.round(cx); R *= k;
    const s = 1 + 0.3 * Math.max(0, Math.min(1, (10 - R) / 5)), crown = 2.04 + 1.5 * s;
    const flat = (hw, top) => stamp(cx - hw, 2 * hw + 1, () => top);
    for (const [a, b] of [[2.3, 0.22], [1.95, 0.44], [1.6, 0.66]]) flat(a * R, ground + b * R);
    let hw0 = 1.32 * R, y0 = ground + 0.66 * R;
    for (const [a, b] of BELL) {
      const hw1 = a * R, y1 = ground + b * R;
      stamp(cx - hw0, 2 * hw0 + 1, (t) => { const d = Math.min(hw0, Math.abs(t - 0.5) * 2 * hw0); return d <= hw1 ? y1 : y0 + (y1 - y0) * (hw0 - d) / (hw0 - hw1); });
      hw0 = hw1; y0 = y1;
    }
    const rings = Math.max(2, Math.round(0.3 * R));          // the spire starts narrower than the band below it and steps in by about one unit per ring
    for (let i = 1; i <= rings; i++) flat(0.4 * R - (i - 1) * (0.3 * R / rings), ground + (2.04 + 1.5 * s * i / rings) * R);
    flat(0.1 * R, ground + (crown + 0.25) * R);               // the hti
    stamp(cx, 1, () => ground + (crown + 0.85) * R);          // its point
  };
  // low colonial blocks from x0 to x1: flat roofs with parapet posts at the corners, the odd pediment or slim tower
  const colonial = (x0, x1) => {
    let x = x0;
    while (x < x1) {
      const w = Math.min(x1 - x, 8 + Math.floor(r() * 13)), top = 6 + r() * 8, kind = r();
      stamp(x, w, () => top);
      stamp(x, 1, () => top + 1); stamp(x + w - 1, 1, () => top + 1);
      if (kind < 0.3 && w >= 9) stamp(x + w / 2 - 3, 7, (t) => top + (1 - Math.abs(t - 0.5) * 2) * 3);
      else if (kind < 0.45 && w >= 10) stamp(x + 2 + Math.floor(r() * (w - 6)), 4, () => top + 5);
      x += w + (r() < 0.3 ? 2 : 0);
    }
  };
  // London terraces from x0 to x1: flat runs with a chimney, gable ends, the odd taller office slab
  const london = (x0, x1) => {
    let x = x0;
    while (x < x1) {
      const w = Math.min(x1 - x, 7 + Math.floor(r() * 12)), body = 7 + r() * 8, kind = r();
      if (kind < 0.5) { stamp(x, w, () => body); stamp(x + 1 + Math.floor(r() * Math.max(1, w - 3)), 1, () => body + 2); }
      else if (kind < 0.8) stamp(x, w, (t) => body + (1 - Math.abs(t - 0.5) * 2) * w * 0.3);
      else stamp(x, w, () => body + 4 + r() * 5);
      x += w + 1;
    }
  };
  // small houses from x0 to x1: the quiet run where the two cities meet, and the bank under the Eye
  const houses = (x0, x1) => {
    let x = x0;
    while (x < x1) { const w = Math.min(x1 - x, 4 + Math.floor(r() * 5)), top = 3 + r() * 3; stamp(x, w, () => top); x += w + (r() < 0.5 ? 1 : 0); }
  };
  // Big Ben: a slim clock tower, a narrower belfry, a steep roof with a small lantern on it, and a spike. T is its height.
  const bigBen = (cx, T) => {
    cx = Math.round(cx);
    const hw = Math.max(2, Math.round(T * 0.075));
    stamp(cx - hw, 2 * hw + 1, () => T * 0.7);
    stamp(cx - hw + 1, 2 * hw - 1, (t) => T * 0.78 + (1 - Math.abs(t - 0.5) * 2) * T * 0.18);
    stamp(cx - 1, 3, () => T * 0.93);
    stamp(cx, 1, () => T);
  };
  // the Shard: a tall slim pyramid whose top breaks into separate thin fins. T is its height.
  const shard = (cx, T) => {
    cx = Math.round(cx);
    const hw = T * 0.105;
    stamp(cx - hw, 2 * hw + 1, (t) => { const d = Math.min(hw, Math.abs(t - 0.5) * 2 * hw); return d <= 2.5 ? T * 0.85 : T * 0.85 * (hw - d) / (hw - 2.5); });
    for (const [dx, f] of [[-2, 0.91], [0, 1], [2, 0.95]]) stamp(cx + dx, 1, () => T * f);
  };
  if (shape === 'hills') {
    const p = [r() * 6, r() * 6, r() * 6];
    for (let x = 0; x < n; x++) h[x] = 14 + 9 * Math.sin(x / 47 + p[0]) + 5 * Math.sin(x / 19 + p[1]) + 2 * Math.sin(x / 7 + p[2]);
  } else if (shape === 'rooftops') {
    let x = 0;
    while (x < n) {                                           // low blocks, some with a water tank on the roof
      const w = 7 + Math.floor(r() * 12), top = 10 + r() * 16;
      stamp(x, w, () => top);
      if (r() < 0.5) stamp(x + 2 + Math.floor(r() * (w - 5)), 3, () => top + 4);
      x += w + (r() < 0.3 ? 2 : 0);
    }
  } else if (shape === 'stupa-city') {
    // downtown Yangon: colonial blocks, one great pagoda and smaller ones along the skyline
    colonial(0, n);
    for (const [f, R] of [[0.08, 6.5], [0.2, 5.5], [0.52, 8], [0.66, 5.5], [0.82, 7], [0.93, 5]]) pagoda(n * (f + (r() - 0.5) * 0.04), R * (0.85 + r() * 0.3), 6 + r() * 4);
    pagoda(n * 0.36, 17, 10);
  } else if (shape === 'yangon-london') {
    // Yangon on the left, London on the right, a run of small houses where they meet
    colonial(0, n * 0.44);
    for (const [f, R] of [[0.05, 5], [0.15, 13], [0.32, 7], [0.41, 5.5]]) pagoda(n * f, R, 6 + r() * 3);
    houses(n * 0.44, n * 0.56);
    london(n * 0.56, n * 0.7); houses(n * 0.7, n * 0.81); london(n * 0.81, n);
    bigBen(n * 0.64, 48 * k); shard(n * 0.88, 72 * k);
  } else if (shape === 'palms') {
    for (let x = 0; x < n; x++) h[x] = 5 + 2 * Math.sin(x / 23) + (r() < 0.3 ? 1 : 0);
  } else if (shape === 'hedge') {
    for (let x = 0; x < n; x++) h[x] = 8 + 3 * Math.sin(x / 31 + 1) + 2 * Math.sin(x / 9) + (r() < 0.4 ? 1 : 0);
  }
  return h;
}

// tall things that are not a height field: palm trees in front
function palms(seed, n) {
  const r = rng(seed + 9);
  const out = [];
  for (let i = 0; i < 5; i++) out.push({ x: Math.floor(n * (0.06 + i * 0.22 + (r() - 0.5) * 0.1)), h: 34 + r() * 22, lean: (r() - 0.5) * 8 });
  return out;
}

// nor is the London Eye: where it stands and the radius of its wheel, in design units
// the wheel is as big as the room between Big Ben and the Shard allows: on narrow pictures it shrinks
function londonEye(n) { return { x: Math.round(n * 0.755), r: Math.min(21 * fit(n), 0.115 * n - 5.5) }; }

// The London Eye: a thin ring with spokes, standing on a slim A-frame. Drawn into buf (W by H) in colour c,
// at the scale of the layer whose ground line is baseY.
function drawEye(buf, W, H, u, scale, baseY, n, c) {
  const e = londonEye(n), R = e.r * u * scale, cx = e.x * u, cy = baseY - R - 3 * u, th = Math.max(1, Math.round(u * 0.8));
  if (!(R >= 1)) return;                                    // a picture too narrow for a wheel gets none
  const dot = (x, y) => { x = Math.round(x); y = Math.round(y); for (let dy = 0; dy < th; dy++) for (let dx = 0; dx < th; dx++) if (y + dy >= 0 && y + dy < H && x + dx >= 0 && x + dx < W) buf[(y + dy) * W + x + dx] = c; };
  const line = (x0, y0, x1, y1) => { const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= steps; i++) dot(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); };
  for (let a = 0; a < Math.PI * 2; a += 0.5 / R) dot(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  for (let i = 0; i < 8; i++) line(cx, cy, cx + Math.cos(i * Math.PI / 4) * R, cy + Math.sin(i * Math.PI / 4) * R);
  line(cx, cy, cx - R * 0.5, baseY); line(cx, cy, cx + R * 0.5, baseY);
}

// The pixel skyline along the bottom edge of every page in the dark theme (body::before in site.css): Yangon on
// the left running into London, a white silhouette at 3.5% that dithers away toward the bottom and thins out at
// both ends, so the picture can stop anywhere. /story/?capture=1 saves it as horizon.png.
export function horizonTile(canvas, W = 2400, H = 120) {
  const u = 1.5, n = Math.ceil(W / u) + 2, ground = H - 8;
  const hts = outline('yangon-london', 97, n);
  const mask = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    const top = Math.max(0, Math.round(ground - hts[Math.min(n - 1, Math.floor(x / u))] * u));
    for (let y = top; y < H; y++) mask[y * W + x] = 1;
  }
  drawEye(mask, W, H, u, 1, ground, n, 1);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H), out = new Uint32Array(img.data.buffer);
  const white = (9 << 24 | 0xFFFFFF) >>> 0;                    // white at 3.5%: the page shows through
  for (let x = 0; x < W; x++) {
    const edge = Math.min(1, x / 200, (W - 1 - x) / 200);
    let top = -1;
    for (let y = 0; y < H; y++) {
      if (!mask[y * W + x]) continue;
      if (top < 0) top = y;
      const k = (y - top) / Math.max(1, H - top);               // 0 at the skyline, 1 at the bottom edge
      if ((1 - k) * (1 - k) * 255 * edge > BAYER[((y >> 1) & 3) * 4 + ((x >> 1) & 3)]) out[y * W + x] = white;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export class WallRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.W = 0; this.H = 0;
    this.photo = null;      // the loaded <img>
    this.key = '';          // which wall the caches below belong to
  }

  resize(W, H) {
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H; this.key = '';
  }

  // Claim the canvas (the 3D renderer shares it and may have sized it differently).
  claim() {
    const { W, H } = this;
    if (this.canvas.width !== W || this.canvas.height !== H || !this.img || this.img.width !== W || this.img.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
      this.img = this.ctx.createImageData(W, H);
      this.out = new Uint32Array(this.img.data.buffer);
      this.key = '';
    }
  }

  setPhoto(img) { this.photo = img; this.key = ''; }

  // ---------- build the still parts once per wall and size ----------
  prepare(name) {
    const def = WALLS[name];
    const key = name + '@' + this.W + 'x' + this.H + (def.kind === 'photo' && this.photo ? '+p' : '');
    if (key === this.key) return def;
    this.key = key;
    const { W, H } = this, N = W * H;
    this.back = new Uint32Array(N);          // what is behind the moving things (the sky)
    this.front = new Uint32Array(N);         // what is in front of them (0 = see through)
    this.real = null;                        // the photograph's own colours, for press-and-hold
    if (def.kind === 'photo') this.preparePhoto(def); else this.prepareWall(def);
    return def;
  }

  // Tall, narrow screens carry the text across the bottom, so the skyline moves up to show above it.
  lift() { const { W, H } = this; return H > W * 1.1 ? 0.2 : H > W * 0.8 ? 0.12 : 0; }

  gradient(stops, dot, lift = 0) {
    const { W, H, back } = this;
    const cols = stops.map(ink), shift = dot >= 4 ? 2 : 1;
    const horizon = H * (0.78 - lift);
    for (let y = 0; y < H; y++) {
      const t = Math.min(0.9999, Math.max(0, y / horizon)) * (cols.length - 1);
      const i = Math.floor(t), f = (t - i) * 255;
      const a = cols[i], b = cols[Math.min(cols.length - 1, i + 1)];
      const row = y * W, by = (y >> shift) & 3;
      for (let x = 0; x < W; x++) back[row + x] = f > BAYER[by * 4 + ((x >> shift) & 3)] ? b : a;
    }
  }

  prepareWall(def) {
    const { W, H, back, front } = this;
    const lift = this.lift();
    this.gradient(def.sky, 2, lift);
    if (def.sun) {                                            // a half-toned sun low in the sky
      const cx = def.sun.x * W, cy = (def.sun.y - lift) * H, R = def.sun.r * Math.max(W, H * 0.8);
      const core = ink(def.sun.core), halo = ink(def.sun.halo);
      for (let y = Math.max(0, Math.floor(cy - R * 2.2)); y < Math.min(H, cy + R * 2.2); y++) for (let x = Math.max(0, Math.floor(cx - R * 2.2)); x < Math.min(W, cx + R * 2.2); x++) {
        const d = Math.hypot(x - cx, y - cy) / R;
        if (d < 1) back[y * W + x] = core;
        else if (d < 2.2 && (1 - (d - 1) / 1.2) * 200 > BAYER[((y >> 1) & 3) * 4 + ((x >> 1) & 3)]) back[y * W + x] = halo;
      }
    }
    const u = Math.max(W / 320, H / 300);                     // one design unit in pixels
    const n = Math.ceil(W / u) + 2;
    def.layers.forEach((layer, li) => {
      const hts = outline(layer.shape, def.seed + li * 7, n);
      const c = ink(layer.color), baseY = Math.round((layer.base - lift * (li === def.layers.length - 1 ? 0.6 : 1)) * H);
      for (let x = 0; x < W; x++) {
        const top = Math.max(0, Math.round(baseY - hts[Math.min(n - 1, Math.floor(x / u))] * u * layer.scale));
        for (let y = top; y < H; y++) front[y * W + x] = c;
      }
      if (layer.shape === 'palms') for (const p of palms(def.seed, n)) {
        const x0 = p.x * u, ground = baseY - 5 * u, hgt = p.h * u * layer.scale;
        for (let k = 0; k < hgt; k++) { const x = Math.round(x0 + p.lean * u * (k / hgt) * (k / hgt)), y = Math.round(ground - k); for (let dx = 0; dx < Math.max(1, Math.round(u)); dx++) if (y >= 0 && x + dx >= 0 && x + dx < W) front[y * W + x + dx] = c; }
        const tx = x0 + p.lean * u, ty = ground - hgt;
        for (let a = 0; a < 7; a++) {                           // fronds: short arcs falling away from the crown
          const ang = -Math.PI + a * (Math.PI / 6);
          for (let k = 0; k < 12 * u; k++) {
            const fx = Math.round(tx + Math.cos(ang) * k), fy = Math.round(ty + Math.sin(ang) * k * 0.5 + (k * k) / (26 * u));
            for (let t = 0; t < Math.max(1, Math.round(u * 0.8)); t++) if (fy + t >= 0 && fy + t < H && fx >= 0 && fx < W) front[(fy + t) * W + fx] = c;
          }
        }
      }
      if (layer.shape === 'yangon-london') drawEye(front, W, H, u, layer.scale, baseY, n, c);
    });
  }

  preparePhoto(def) {
    const { W, H, back, front } = this, g = def.grade;
    this.gradient([g.sky[0], g.sky[1], g.sky[2]], g.dot);      // shown until the picture has loaded, and behind the smoke
    if (!this.photo) return;
    // fit the picture to cover the frame, keeping the crags in view
    const iw = this.photo.naturalWidth, ih = this.photo.naturalHeight;
    const s = Math.max(W / iw, H / ih), sw = W / s, sh = H / s;
    const sx = (iw - sw) * 0.5, sy = (ih - sh) * 0.42;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(this.photo, sx, sy, sw, sh, 0, 0, W, H);
    const px = cx.getImageData(0, 0, W, H).data;
    const real = this.real = new Uint32Array(W * H);
    const skyInks = g.sky.map(ink), landInks = g.land.map(ink);
    const gain = g.gain * 256, contrast = g.contrast * 256, shift = g.dot >= 4 ? 2 : 1;
    for (let x = 0; x < W; x++) {
      const bx = (x >> shift) & 3;
      let open = true, solid = 0;                               // sky is whatever is blue and reaches the top of its column
      for (let y = 0; y < H; y++) {
        const p = y * W + x, i = p * 4;
        const r = px[i], gg = px[i + 1], b = px[i + 2];
        real[p] = (255 << 24 | (b & 0xF8) << 16 | (gg & 0xF8) << 8 | (r & 0xF8)) >>> 0;
        let L = ((r * 77 + gg * 150 + b * 29) >> 8) * gain >> 8;
        L = (((L - 118) * contrast) >> 8) + 128;
        L = L < 0 ? 0 : L > 254 ? 254 : L;
        const blue = b > r * 1.18 && b > gg * 1.02 && b > 20;
        if (open) { solid = blue ? 0 : solid + 1; if (solid >= 4) open = false; }
        const sky = open && blue;
        const inks = sky ? skyInks : landInks;
        const pos = (L * (inks.length - 1)) / 255, k = pos | 0;
        const c2 = inks[Math.min(inks.length - 1, k + ((pos - k) * 255 > BAYER[((y >> shift) & 3) * 4 + bx] ? 1 : 0))];
        if (sky) back[p] = c2; else front[p] = c2;               // smoke and clouds pass between the two
      }
    }
    if (def.road) {
      // The road out: the ground fades in over the bottom of the picture, and a pale road with a broken
      // middle line runs from the bottom edge to a point where the ground begins.
      const ground = landInks[0], verge = landInks[1], tar = landInks[2], paint = landInks[landInks.length - 1];
      const top = H * 0.78, span = H - top, vx = W * 0.42;
      for (let y = Math.round(top); y < H; y++) {
        const k = (y - top) / span;                              // 0 where the ground begins, 1 at the bottom edge
        const row = y * W, by = ((y >> 2) & 3) * 4;
        const mid = vx + (W * 0.56 - vx) * k, half = W * (0.004 + 0.2 * k * k + 0.05 * k);
        const dash = ((Math.log(1 + k * 14) * 3.2) % 1) < 0.5;   // dashes lengthen toward the viewer
        for (let x = 0; x < W; x++) {
          const t = BAYER[by + ((x >> 2) & 3)];
          if (k * 640 < t) continue;                             // the fade: the photograph still shows through
          const d = Math.abs(x - mid);
          let c2 = (60 - k * 40) > t ? verge : ground;
          if (d < half) c2 = (dash && d < Math.max(1, half * 0.05)) ? paint : tar;
          front[row + x] = c2;
        }
      }
    }
  }

  // ---------- one frame ----------
  // t: seconds (0 for a still). clarity: 0..1, how much of the photograph's real colour shows.
  render(name, t, clarity) {
    this.claim();
    const def = this.prepare(name);
    const { W, H, out, back, front } = this;
    out.set(back);
    if (def.clouds) this.clouds(def.clouds, t);
    if (def.smoke) for (let i = 0; i < def.smoke.length; i++) this.smoke(def.smoke[i], t, i, def.grade);
    for (let p = 0, n = W * H; p < n; p++) if (front[p]) out[p] = front[p];
    const level = Math.round(Math.max(0, Math.min(1, clarity || 0)) * 256);
    if (level > 0 && this.real) {
      const real = this.real;
      for (let y = 0; y < H; y++) { const by = (y >> 1) & 3, row = y * W; for (let x = 0; x < W; x++) if (level > BAYER[by * 4 + (((x >> 1) + 2) & 3)]) out[row + x] = real[row + x]; }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  clouds(c, t) {
    const { W, H, out } = this, tone = ink(c.tone), r = rng(911);
    for (let i = 0; i < c.count; i++) {
      const w = (0.14 + r() * 0.2) * W, h = (0.012 + r() * 0.022) * H, y0 = (c.band[0] + r() * (c.band[1] - c.band[0])) * H;
      const speed = c.speed * (0.6 + r() * 0.8) * (W / 640);
      const x0 = ((r() * (W + w * 2) + t * speed) % (W + w * 2)) - w;
      for (let y = Math.max(0, Math.floor(y0 - h)); y < Math.min(H, y0 + h); y++) {
        const ry = (y - y0) / h, row = y * W, by = (y >> 1) & 3;
        for (let x = Math.max(0, Math.floor(x0 - w / 2)); x < Math.min(W, x0 + w / 2); x++) {
          const rx = (x - x0) / (w / 2), d = rx * rx + ry * ry;
          if (d < 1 && (1 - d) * 230 > BAYER[by * 4 + ((x >> 1) & 3)]) out[row + x] = tone;
        }
      }
    }
  }

  smoke(s, t, index, g) {
    const { W, H, out } = this;
    const low = ink(g.land[0]), high = ink(g.land[1]);           // dark where it leaves the ground, greyer as it thins
    const puffs = 16, rise = H * 0.62, r = rng(300 + index * 17);
    for (let k = 0; k < puffs; k++) {
      const phase = ((k / puffs) + t * 0.02 * (0.8 + index * 0.15)) % 1;    // 0 at the ground, 1 at the top, slowly
      const wob = Math.sin(t * 0.25 + k * 1.7 + index) * 0.012 + (r() - 0.5) * 0.02;
      const cx = (s.x + phase * phase * 0.16 + wob) * W;                     // the column leans with the wind as it climbs
      const cy = s.y * H - phase * rise;
      const R = (0.012 + phase * 0.06) * Math.max(W, H * 0.7) * s.size;
      const dens = (1 - phase) * 235 + 10;
      for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(H, cy + R); y++) {
        const row = y * W, by = (y >> 2) & 3;
        for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(W, cx + R); x++) {
          const d = Math.hypot(x - cx, y - cy) / R;
          if (d < 1 && (1 - d * d) * dens > BAYER[by * 4 + ((x >> 2) & 3)]) out[row + x] = (phase < 0.4 ? low : high);
        }
      }
    }
  }
}
