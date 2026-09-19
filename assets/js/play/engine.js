// The page's side of the engine: downloads the two files once, starts the worker,
// and turns "find a move for this position" into a promise.

const WASM_URL = '/assets/wasm/ransom.wasm';
const WASM_SIMD_URL = '/assets/wasm/ransom-simd.wasm'; // same engine, about a fifth faster
const NET_URL = '/assets/wasm/ransom-net.bin';
const WORKER_URL = '/assets/js/play/worker.js';

// A seven-instruction module that uses one SIMD operation. If the browser accepts it, it can load the faster build.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const hasSimd = () => { try { return WebAssembly.validate(SIMD_PROBE); } catch (e) { return false; } };

async function download(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url} (${res.status}).`);
  if (!res.body || !res.body.getReader) { const all = await res.arrayBuffer(); onBytes(all.byteLength); return all; }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out.buffer;
}

export function createEngine({ onProgress = () => {}, onIteration = () => {} } = {}) {
  let worker = null, module = null, net = null;
  let nextId = 1, pending = null, dead = false;
  let up = false; // true once the worker has finished setting itself up
  let starting = null; // the promise of a worker that is being set up right now
  // Phones get a smaller memory table (16 MB instead of 64 MB). It only changes what the engine remembers, not how it thinks.
  const ttBits = matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory && navigator.deviceMemory < 4) ? 20 : 22;

  function spawn() {
    up = false;
    if (dead) return Promise.reject(new Error('cancelled')); // the page was left while the files were still arriving
    const p = new Promise((resolve, reject) => {
      worker = new Worker(WORKER_URL);
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { up = true; resolve(); }
        else if (m.type === 'error') { if (pending && pending.id === m.id) { pending.reject(new Error(m.message)); pending = null; } else reject(new Error(m.message)); }
        else if (m.type === 'iteration') { if (pending && pending.id === m.id) onIteration(m); }
        else if (m.type === 'bestmove' && pending && pending.id === m.id) { const p = pending; pending = null; p.resolve(m); }
      };
      worker.onerror = (e) => reject(new Error(e.message || 'The engine thread stopped.'));
      worker.postMessage({ type: 'init', module, net: net.slice(0), ttBits });
    });
    starting = p;
    const done = () => { if (starting === p) starting = null; };
    p.then(done, done);
    return p;
  }

  const ready = (async () => {
    if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') throw new Error('This browser cannot run WebAssembly.');
    let got = 0;
    const total = 1; // sizes are not always reported, so progress is shown as bytes received
    const tick = (n) => { got += n; onProgress(got, total); };
    const simd = hasSimd();
    const [wasmBytes, netBytes] = await Promise.all([download(simd ? WASM_SIMD_URL : WASM_URL, tick), download(NET_URL, tick)]);
    try { module = await WebAssembly.compile(wasmBytes); } catch (e) {
      if (!simd) throw e;
      module = await WebAssembly.compile(await download(WASM_URL, tick)); // the probe was wrong about this browser
    }
    net = netBytes;
    if (dead) throw new Error('cancelled');
    await spawn();
  })();

  return {
    ready,
    ttBits,
    newGame() { if (worker && up) worker.postMessage({ type: 'newgame' }); }, // a fresh worker starts with a fresh game anyway
    // Resolves with { move, depth, score, nodes, ms }.
    go({ fen, earlier = [], softMs, hardMs, depth = 0 }) {
      if (pending) return Promise.reject(new Error('The engine is already thinking.'));
      if (!worker || !up) return Promise.reject(new Error('The engine is not ready yet.'));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending = { id, resolve, reject };
        worker.postMessage({ type: 'go', id, fen, earlier, softMs, hardMs, depth });
      });
    },
    get thinking() { return Boolean(pending); },
    // Resolves when no worker is in the middle of being set up (it never rejects).
    whenUp() { return starting ? starting.then(() => {}, () => {}) : Promise.resolve(); },
    // A search cannot be interrupted from outside, so stopping means a fresh thread.
    // What the engine had learned during this game (its tables) is lost, which is fine for a new game.
    async cancel() {
      if (!pending) return;
      const p = pending;
      pending = null;
      p.reject(new Error('cancelled'));
      worker.terminate();
      if (!dead) { try { await spawn(); } catch (e) { /* the next go() reports it */ } }
    },
    destroy() { dead = true; if (worker) worker.terminate(); worker = null; if (pending) { pending.reject(new Error('cancelled')); pending = null; } },
  };
}
