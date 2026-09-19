// The engine's own thread. It loads the WebAssembly build of Ransom, feeds it
// positions and posts back the move it chose. A search blocks this thread until it
// is done, which is why it lives here and not on the page.
//
// Messages in:  { type: 'init', module, net, ttBits }
//               { type: 'newgame' }
//               { type: 'go', id, fen, earlier: [fen...], softMs, hardMs, depth }
// Messages out: { type: 'ready' } | { type: 'error', message }
//               { type: 'iteration', id, depth, score, nodes, move }
//               { type: 'bestmove', id, move, depth, score, nodes, ms }

let ex = null;
let currentId = 0;

const text = (ptr) => {
  const bytes = new Uint8Array(ex.memory.buffer, ptr, 8);
  let s = '';
  for (let i = 0; i < 8 && bytes[i] !== 0; i++) s += String.fromCharCode(bytes[i]);
  return s;
};
const putFen = (fen) => {
  const ptr = ex.rn_fen_buffer();
  const bytes = new Uint8Array(ex.memory.buffer, ptr, 128);
  const n = Math.min(fen.length, 127);
  for (let i = 0; i < n; i++) bytes[i] = fen.charCodeAt(i) & 0x7f;
  bytes[n] = 0;
};
const uci = (move) => text(ex.rn_move_uci(BigInt(move)));

async function init({ module, net, ttBits }) {
  // The build names its two imports itself; match them by what they do.
  const env = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (/now/.test(imp.name)) env[imp.name] = () => performance.now();
    else if (/iteration/.test(imp.name)) {
      env[imp.name] = (depth, score, nodes, move) => {
        postMessage({ type: 'iteration', id: currentId, depth: Number(depth), score: Number(score), nodes: Number(nodes), move: uci(move) });
      };
    } else throw new Error('The engine asks for something this page does not provide: ' + imp.name);
  }
  const instance = await WebAssembly.instantiate(module, { env });
  ex = instance.exports;
  if (Number(ex.rn_init(ttBits)) !== 0) throw new Error('The engine could not set itself up (not enough memory?).');
  const bytes = new Uint8Array(net);
  const ptr = ex.rn_net_buffer(bytes.length);
  new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
  if (Number(ex.rn_net_load()) !== 0) throw new Error('The engine did not accept its weights file.');
  ex.rn_new_game();
}

function go({ id, fen, earlier, softMs, hardMs, depth }) {
  currentId = id;
  // Tell the engine which positions this game has already seen, so it can see a repetition coming.
  // Only positions since the last capture or pawn move can ever come back, and the engine looks no
  // further than that, so that is all it is given (the fifth FEN field counts those half-moves).
  const sinceLastChange = Math.max(0, Math.min(earlier.length, parseInt(fen.split(' ')[4], 10) || 0));
  ex.rn_history_clear();
  for (const f of earlier.slice(earlier.length - sinceLastChange)) { putFen(f); ex.rn_history_push_fen(); }
  putFen(fen);
  const t0 = performance.now();
  const move = ex.rn_go(softMs, hardMs, depth);
  const ms = performance.now() - t0;
  postMessage({
    type: 'bestmove', id, move: move ? uci(move) : '', ms,
    depth: Number(ex.rn_info(1)), score: Number(ex.rn_info(2)), nodes: Number(ex.rn_info(0)),
  });
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') { await init(m); postMessage({ type: 'ready' }); }
    else if (m.type === 'newgame') ex.rn_new_game();
    else if (m.type === 'go') go(m);
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
