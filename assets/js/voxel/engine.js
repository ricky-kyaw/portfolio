// A small voxel toolkit and a hand-written software renderer.
//
// No WebGL and no library: every frame is drawn into a plain pixel buffer.
// The picture is low resolution and dithered on purpose, so this is fast
// enough, and it works on any device that can show a <canvas>.
//
//   Grid       a box of voxels you can fill with simple shapes
//   buildFaces turns a Grid into the list of faces that can ever be seen
//   Renderer   draws those faces from any angle, with a depth buffer,
//              flat shading, ordered dithering and a far "ring" backdrop

// ---------- seeded random numbers and smooth noise ----------
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise(seed) {
  const r = rng(seed);
  const P = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) P[i] = r();
  const at = (ix, iz) => P[(ix * 73 + iz * 179) & 4095];
  const smooth = (t) => t * t * (3 - 2 * t);
  return function noise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = smooth(x - ix), fz = smooth(z - iz);
    const a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz; // 0..1
  };
}

// ---------- the voxel grid ----------
export class Grid {
  constructor(X, Y, Z) {
    this.X = X; this.Y = Y; this.Z = Z;
    this.d = new Uint8Array(X * Y * Z);
  }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.X && y < this.Y && z < this.Z; }
  get(x, y, z) { return this.inside(x, y, z) ? this.d[(y * this.Z + z) * this.X + x] : 0; }
  set(x, y, z, m) { if (this.inside(x, y, z)) this.d[(y * this.Z + z) * this.X + x] = m; }

  // All ranges are inclusive.
  box(x0, y0, z0, x1, y1, z1, m) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, m);
  }
  disc(cx, cz, y, r, m) {
    const r2 = r * r;
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
        if (dx * dx + dz * dz <= r2) this.set(x, y, z, m);
      }
    }
  }
  cylinder(cx, cz, y0, y1, r, m) { for (let y = y0; y <= y1; y++) this.disc(cx, cz, y, r, m); }
  // A round shape whose radius changes evenly from r0 (bottom) to r1 (top).
  taper(cx, cz, y0, y1, r0, r1, m) {
    const n = Math.max(1, y1 - y0);
    for (let y = y0; y <= y1; y++) this.disc(cx, cz, y, r0 + (r1 - r0) * ((y - y0) / n), m);
  }
  // The same, but square: half-width h0 at the bottom, h1 at the top.
  pyramid(cx, cz, y0, y1, h0, h1, m) {
    const n = Math.max(1, y1 - y0);
    for (let y = y0; y <= y1; y++) {
      const h = h0 + (h1 - h0) * ((y - y0) / n);
      this.box(Math.round(cx - h), y, Math.round(cz - h), Math.round(cx + h) - 1, y, Math.round(cz + h) - 1, m);
    }
  }
  ellipsoid(cx, cy, cz, rx, ry, rz, m, test) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
          const v = dx * dx + dy * dy + dz * dz;
          if (test ? test(v, x, y, z) : v <= 1) this.set(x, y, z, typeof m === 'function' ? m(x, y, z) : m);
        }
      }
    }
  }
  // Height of the highest filled voxel in a column, or -1.
  top(x, z) {
    for (let y = this.Y - 1; y >= 0; y--) if (this.get(x, y, z)) return y;
    return -1;
  }
}

// ---------- faces ----------
// direction: 0 top, 1 +x, 2 -x, 3 +z, 4 -z. The bottom is never seen.
const NB = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
// the four cells that touch a face's edges, in the layer just outside it
const EDGE = [
  [[1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]],
  [[1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1]],
  [[-1, 1, 0], [-1, -1, 0], [-1, 0, 1], [-1, 0, -1]],
  [[0, 1, 1], [0, -1, 1], [1, 0, 1], [-1, 0, 1]],
  [[0, 1, -1], [0, -1, -1], [1, 0, -1], [-1, 0, -1]],
];
// which corner a face starts at, and the two edges that span it
const ORIGIN = [[0, 1, 0], [1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 0, 0]];
const EDGE_U = [[1, 0, 0], [0, 0, 1], [0, 0, 1], [1, 0, 0], [1, 0, 0]];
const EDGE_V = [[0, 0, 1], [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]];
// A fixed sun, so light and shade stay put while you walk around the model.
const SHADE = [1.0, 0.72, 0.28, 0.50, 0.38];

// materials: id -> [r, g, b, accent]   accent: 0 none, 1 amber, 2 water (it mirrors), 3 a lit window, 4 red
export function buildFaces(grid, materials, shade = SHADE) {
  const { X, Y, Z } = grid;
  let n = 0;
  for (let pass = 0; pass < 2; pass++) {
    var fx, fy, fz, fdir, fcol, fedge, fflag;
    if (pass === 1) {
      fx = new Int16Array(n); fy = new Int16Array(n); fz = new Int16Array(n);
      fdir = new Uint8Array(n); fcol = new Uint32Array(n);
      fedge = new Uint32Array(n); fflag = new Uint8Array(n);
      n = 0;
    }
    for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
      const m = grid.d[(y * Z + z) * X + x];
      if (!m) continue;
      for (let dir = 0; dir < 5; dir++) {
        const nb = NB[dir];
        if (grid.get(x + nb[0], y + nb[1], z + nb[2])) continue;
        if (pass === 1) {
          let ao = 0;
          const e = EDGE[dir];
          for (let k = 0; k < 4; k++) if (grid.get(x + e[k][0], y + e[k][1], z + e[k][2])) ao++;
          const mat = materials[m] || materials[1];
          const s = shade[dir] * (1 - 0.11 * ao);
          const r = Math.min(255, mat[0] * s) | 0, g = Math.min(255, mat[1] * s) | 0, b = Math.min(255, mat[2] * s) | 0;
          fx[n] = x; fy[n] = y; fz[n] = z; fdir[n] = dir;
          fcol[n] = (r | (g << 8) | (b << 16) | ((mat[3] || 0) << 24)) >>> 0;
          // the same colour, much darker: used for the thin outline on exposed edges
          fedge[n] = ((r * 0.3) | ((g * 0.3) << 8) | ((b * 0.3) << 16) | ((mat[3] === 3 ? 0 : (mat[3] || 0)) << 24)) >>> 0;
          // An edge gets a line when the surface stops there (nothing beside it)
          // or folds inward (something stands on the cell beside it).
          const U = EDGE_U[dir], V = EDGE_V[dir];
          let fl = 0;
          const sides = [[-U[0], -U[1], -U[2]], U, [-V[0], -V[1], -V[2]], V];
          for (let k = 0; k < 4; k++) {
            const o = sides[k];
            if (!grid.get(x + o[0], y + o[1], z + o[2]) || grid.get(x + o[0] + nb[0], y + o[1] + nb[1], z + o[2] + nb[2])) fl |= 1 << k;
          }
          fflag[n] = fl;
        }
        n++;
      }
    }
  }
  return { n, fx, fy, fz, fdir, fcol, fedge, fflag };
}

// ---------- the renderer ----------
// 4 x 4 ordered-dither thresholds, 0..255
const BAYER = new Uint8Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => Math.round((v + 0.5) * 16)));


const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.W = 0; this.H = 0;
  }

  resize(W, H) {
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.canvas.width = W; this.canvas.height = H;
    this.img = this.ctx.createImageData(W, H);
    this.out = new Uint32Array(this.img.data.buffer);
    this.col = new Uint32Array(W * H);
    this.zb = new Float32Array(W * H);
    this.hb = new Float32Array(W * H);     // how high above the ground each pixel's surface is, for reflections
    this.refl = new Uint32Array(W * H);    // what the water mirrors at each pixel (0 = nothing)
    this.reflH = new Float32Array(W * H);
    this.still = null;                     // a copy of the last picture, so rain can be redrawn over it cheaply
  }

  // scene: { faces, size: [X, Y, Z], ring: Float32Array(360), span }  (span: how many voxels fill the picture's width at zoom 1)
  // cam:   { yaw, pitch, zoom, shiftX, shiftY }
  // mood:  see MOODS in scenes.js (optional extras: dot 1|2|4, line, contrast)
  render(scene, cam, mood, clarity) {
    const { W, H, out, col, zb, hb, refl, reflH } = this;
    if (!W || !H) return; // not sized yet
    const dot = mood.dot || 2;                 // dither cell size in pixels
    const shift = dot <= 1 ? 0 : dot < 4 ? 1 : 2;

    // ---- background: a dithered sky, a far ring that turns with you, a dark floor ----
    const skyA = hex(mood.skyDark), skyB = hex(mood.skyLight), ringC = hex(mood.ring);
    const pack = (c) => (255 << 24 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0;
    const pSkyA = pack(skyA), pSkyB = pack(skyB), pRing = pack(ringC);
    const horizon = Math.round(H * (0.46 + (cam.shiftY || 0) * 0.5));
    const span = 110; // degrees of ring visible across the picture
    const yawDeg = cam.yaw * 180 / Math.PI;
    const ring = scene.ring;
    const ringMax = H * 0.16;
    for (let y = 0; y < H; y++) {
      // tone rises toward the horizon, then falls away below it
      const t = y <= horizon ? (y / horizon) : Math.max(0, 1 - (y - horizon) / (H - horizon) * 1.6);
      const level = (mood.skyGlow * t * t * 255) | 0;
      const row = y * W;
      const by = (y >> shift) & 3;
      for (let x = 0; x < W; x++) {
        out[row + x] = level > BAYER[by * 4 + ((x >> shift) & 3)] ? pSkyB : pSkyA;
      }
    }
    if (ring) {
      for (let x = 0; x < W; x++) {
        let a = Math.floor((x / W - 0.5) * span - yawDeg) % 360; // moves with the far side of the model, not against it
        if (a < 0) a += 360;
        const h = Math.round(ring[a] * ringMax);
        for (let y = horizon - h; y < horizon; y++) {
          if (y < 0) continue;
          // the ring is a soft, half-toned silhouette
          const on = mood.ringLevel > BAYER[((y >> shift) & 3) * 4 + ((x >> shift) & 3)];
          out[y * W + x] = on ? pRing : pSkyA;
        }
      }
    }

    // ---- the model ----
    zb.fill(-1e9);
    const [X, , Z] = scene.size;
    const cx = X / 2, cz = Z / 2;
    const s = (W / scene.span) * (cam.zoom || 1);
    const st = Math.sin(cam.yaw), ct = Math.cos(cam.yaw);
    const sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    // screen-space images of the three world axes
    const Exx = ct * s, Exy = st * sp * s;
    const Ezx = -st * s, Ezy = ct * sp * s;
    const Eyy = -cp * s;
    // depth: bigger is nearer
    const dX = st * cp, dZ = ct * cp, dY = sp;
    const Cx = W * (0.5 + (cam.shiftX || 0)) - (cx * Exx + cz * Ezx);
    const Cy = H * (0.64 + (cam.shiftY || 0)) - (cx * Exy + cz * Ezy);

    // per direction: is it facing us, and the numbers needed to fill it
    const vis = [true, st > 0, st < 0, ct > 0, ct < 0];
    const Ax = [], Ay = [], Bx = [], By = [], inv = [], dU = [], dV = [], minX = [], maxX = [], minY = [], maxY = [], eU = [], eV = [];
    const line = mood.line == null ? 1 : mood.line; // outline width in pixels
    for (let d = 0; d < 5; d++) {
      const u = EDGE_U[d], v = EDGE_V[d];
      Ax[d] = u[0] * Exx + u[2] * Ezx; Ay[d] = u[0] * Exy + u[1] * Eyy + u[2] * Ezy;
      Bx[d] = v[0] * Exx + v[2] * Ezx; By[d] = v[0] * Exy + v[1] * Eyy + v[2] * Ezy;
      const det = Ax[d] * By[d] - Ay[d] * Bx[d];
      if (Math.abs(det) < 0.05) vis[d] = false; else inv[d] = 1 / det;
      eU[d] = Math.min(0.34, line / Math.max(1, Math.hypot(Ax[d], Ay[d])));
      eV[d] = Math.min(0.34, line / Math.max(1, Math.hypot(Bx[d], By[d])));
      dU[d] = u[0] * dX + u[1] * dY + u[2] * dZ;
      dV[d] = v[0] * dX + v[1] * dY + v[2] * dZ;
      minX[d] = Math.min(0, Ax[d], Bx[d], Ax[d] + Bx[d]); maxX[d] = Math.max(0, Ax[d], Bx[d], Ax[d] + Bx[d]);
      minY[d] = Math.min(0, Ay[d], By[d], Ay[d] + By[d]); maxY[d] = Math.max(0, Ay[d], By[d], Ay[d] + By[d]);
    }

    const f = scene.faces;
    const { fx, fy, fz, fdir, fcol, fedge, fflag } = f;
    for (let i = 0; i < f.n; i++) {
      const d = fdir[i];
      if (!vis[d]) continue;
      const o = ORIGIN[d];
      const wx = fx[i] + o[0], wy = fy[i] + o[1], wz = fz[i] + o[2];
      const px0 = Cx + wx * Exx + wz * Ezx;
      const py0 = Cy + wx * Exy + wy * Eyy + wz * Ezy;
      let x0 = Math.ceil(px0 + minX[d] - 0.5), x1 = Math.floor(px0 + maxX[d] - 0.5);
      let y0 = Math.ceil(py0 + minY[d] - 0.5), y1 = Math.floor(py0 + maxY[d] - 0.5);
      if (x1 < 0 || y1 < 0 || x0 >= W || y0 >= H) continue;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= W) x1 = W - 1; if (y1 >= H) y1 = H - 1;
      const d0 = wx * dX + wy * dY + wz * dZ;
      const ax = Ax[d], ay = Ay[d], bx = Bx[d], by = By[d], k = inv[d], du = dU[d], dv = dV[d];
      const c = fcol[i], ce = fedge[i], fl = fflag[i];
      const hgt = fy[i] + (d === 0 ? 1 : 0.5);
      const eu = eU[d], ev = eV[d], eu1 = 1 - eu, ev1 = 1 - ev;
      for (let y = y0; y <= y1; y++) {
        const qy = y + 0.5 - py0;
        const row = y * W;
        for (let x = x0; x <= x1; x++) {
          const qx = x + 0.5 - px0;
          const u = (by * qx - bx * qy) * k;
          if (u < 0 || u >= 1) continue;
          const v = (ax * qy - ay * qx) * k;
          if (v < 0 || v >= 1) continue;
          const depth = d0 + u * du + v * dv;
          const p = row + x;
          if (depth > zb[p]) {
            zb[p] = depth;
            hb[p] = hgt;
            col[p] = fl && ((fl & 1 && u < eu) || (fl & 2 && u >= eu1) || (fl & 4 && v < ev) || (fl & 8 && v >= ev1)) ? ce : c;
          }
        }
      }
    }

    // ---- still water mirrors what stands above it ----
    // The view has no perspective, so a point h above the water shows again 2h lower on the screen: the mirror
    // image is made by copying pixels straight down. Where two things land on one spot, the lower one wins.
    const mirror = scene.waterY != null && mood.reflect !== false;
    if (mirror) {
      refl.fill(0);
      const kpx = cp * s, level = scene.waterY;
      for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
          const p = row + x;
          if (zb[p] === -1e9) continue;
          const c = col[p];
          if ((c >>> 24) === 2) continue;
          const h = hb[p] - level;
          if (h <= 0.2) continue;
          const ty = y + Math.round(2 * h * kpx);
          if (ty >= H) continue;
          const tp = ty * W + x;
          if (zb[tp] === -1e9 || (col[tp] >>> 24) !== 2) continue;
          if (refl[tp] === 0 || h < reflH[tp]) { refl[tp] = ((c & 0xFFFFFF) | (((c >>> 24) + 1) << 24)) >>> 0; reflH[tp] = h; }
        }
      }
    }

    // ---- resolve: two-tone dither, accents keep their colour, and the "clear" dissolve ----
    const inkA = pack(hex(mood.inkDark)), inkB = pack(hex(mood.inkLight));
    const amA = pack(hex(mood.amberLo)), amB = pack(hex(mood.amberHi));
    const blA = pack(hex(mood.blueLo)), blB = pack(hex(mood.blueHi));
    const rdA = pack(hex(mood.redLo || '#5A1512')), rdB = pack(hex(mood.redHi || '#E8402F'));
    const gain = Math.round(mood.gain * 256);
    const contrast = Math.round((mood.contrast || 1.35) * 256);
    const lights = mood.lights ? 1 : 0;
    const clearLevel = Math.round(Math.max(0, Math.min(1, clarity || 0)) * 256);
    const cb = Math.round((mood.clearBright || 1) * 256);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const by = (y >> shift) & 3;
      for (let x = 0; x < W; x++) {
        const p = row + x;
        if (zb[p] === -1e9) continue;
        const c = col[p];
        let r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255, acc = c >>> 24;
        // water showing a mirror image: every other line stays water, the lines between show a dimmer copy in its own colours
        if (mirror && acc === 2 && refl[p] && ((y >> shift) & 1) === 0) {
          const m = refl[p];
          r = (m & 255) * 0.8 | 0; g = ((m >>> 8) & 255) * 0.8 | 0; b = ((m >>> 16) & 255) * 0.8 | 0;
          acc = (m >>> 24) - 1;
          if (acc === 3) acc = 0;
        }
        const bx = (x >> shift) & 3;
        // the dissolve uses a shifted pattern so it does not line up with the shading dots
        if (clearLevel > 0 && clearLevel > BAYER[by * 4 + ((bx + 2) & 3)]) {
          const R = Math.min(255, (r * cb) >> 8) & 0xF8, G = Math.min(255, (g * cb) >> 8) & 0xF8, B = Math.min(255, (b * cb) >> 8) & 0xF8;
          out[p] = (255 << 24 | B << 16 | G << 8 | R) >>> 0;
          continue;
        }
        if (acc === 3) { out[p] = lights ? amB : inkA; continue; }
        let L = ((r * 77 + g * 150 + b * 29) >> 8) * gain >> 8;
        L = (((L - 120) * contrast) >> 8) + 128;
        const on = L > BAYER[by * 4 + bx];
        out[p] = acc === 1 ? (on ? amB : amA) : acc === 2 ? (on ? blB : blA) : acc === 4 ? (on ? rdB : rdA) : (on ? inkB : inkA);
      }
    }
    if (mood.rain) { if (!this.still || this.still.length !== out.length) this.still = new Uint32Array(out.length); this.still.set(out); }
    this.ctx.putImageData(this.img, 0, 0);
  }

  // Rain over the last picture: short slanted streaks, without drawing the city again. t is in seconds.
  rain(t, inkHex) {
    const { W, H, out, still } = this;
    if (!still || still.length !== out.length) return;
    out.set(still);
    const c = hex(inkHex), px = (255 << 24 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0;
    const drops = Math.round((W * H) / 4200);
    for (let i = 0; i < drops; i++) {
      const hsh = Math.imul(i + 1, 2654435761) >>> 0;
      const speed = 0.9 + ((hsh >>> 8) & 255) / 255 * 0.7;
      const x0 = hsh % W, len = 5 + (hsh & 7);
      const y0 = (((hsh >>> 12) % H) + t * H * speed) % (H + 40) - 20;
      for (let k = 0; k < len; k++) {
        const y = (y0 + k) | 0, x = (x0 - (k >> 1) + W) % W;
        if (y >= 0 && y < H) out[y * W + x] = px;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
