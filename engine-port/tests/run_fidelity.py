"""Compare the built WebAssembly engine with the original Python engine's numbers.

    python engine-port/tests/run_fidelity.py            # everything
    python engine-port/tests/run_fidelity.py --quick    # skips the depth-7 searches
    python engine-port/tests/run_fidelity.py --simd     # tests ransom-simd.wasm instead of ransom.wasm

Needs the `wasmtime` Python package. It runs the very file the web page loads
(assets/wasm/ransom.wasm) with the very weights the page loads, and checks, for each
position of suite.json:

  against golden_strict.json (the original with its fastmath flags emptied):
    static evaluation, the generated move list IN ORDER, which moves are legal, perft 1..3,
    and fixed-depth searches from a fresh engine: best move, score, depth reached and node
    count. All must be IDENTICAL.
  against golden_games.json (the original playing whole games at a fixed depth):
    every move of every game, again with score, depth and node count, IDENTICAL.
  against golden_fastmath.json (the original, untouched):
    static evaluation within 1 unit; how often the searched move agrees is reported.

Exit code 0 only when every exact check passes.
"""
import json
import sys
import time
from pathlib import Path

import wasmtime

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WASM = ROOT / "assets" / "wasm" / ("ransom-simd.wasm" if "--simd" in sys.argv else "ransom.wasm")
NET = ROOT / "assets" / "wasm" / "ransom-net.bin"


class Engine:
    def __init__(self, tt_bits: int = 22):
        self.store = wasmtime.Store(wasmtime.Engine())
        module = wasmtime.Module.from_file(self.store.engine, str(WASM))
        imports = []
        for imp in module.imports:
            name = imp.name or ""
            ty = imp.type
            if "now" in name:
                imports.append(wasmtime.Func(self.store, ty, lambda: time.perf_counter() * 1000.0))
            elif "iteration" in name:
                imports.append(wasmtime.Func(self.store, ty, lambda *a: None))
            else:
                raise SystemExit(f"unexpected import: {imp.module}.{name}")
        self.inst = wasmtime.Instance(self.store, module, imports)
        ex = self.inst.exports(self.store)
        self.ex = ex
        self.mem = ex["memory"]
        if self.call("rn_init", tt_bits) != 0:
            raise SystemExit("rn_init failed")
        blob = NET.read_bytes()
        ptr = self.call("rn_net_buffer", len(blob))
        self.mem.write(self.store, blob, ptr)
        if self.call("rn_net_load") != 0:
            raise SystemExit("rn_net_load failed")

    def call(self, name, *args):
        return self.ex[name](self.store, *args)

    def cstr(self, ptr: int) -> str:
        raw = self.mem.read(self.store, ptr, ptr + 8)
        return bytes(raw).split(b"\0", 1)[0].decode()

    def fen(self, fen: str) -> None:
        ptr = self.call("rn_fen_buffer")
        self.mem.write(self.store, fen.encode() + b"\0", ptr)

    def set_fen(self, fen: str) -> int:
        self.fen(fen)
        return self.call("rn_set_fen")

    def moves(self, n: int):
        ptr = self.call("rn_move_list")
        raw = bytes(self.mem.read(self.store, ptr, ptr + 8 * n))
        return [int.from_bytes(raw[i * 8:i * 8 + 8], "little", signed=True) for i in range(n)]

    def uci(self, move: int) -> str:
        return self.cstr(self.call("rn_move_uci", move))


def main() -> int:
    quick = "--quick" in sys.argv
    strict = {r["id"]: r for r in json.load(open(HERE / "golden_strict.json", encoding="utf-8"))}
    fast = {r["id"]: r for r in json.load(open(HERE / "golden_fastmath.json", encoding="utf-8"))}
    eng = Engine()
    fails = []
    counts = {"eval": 0, "moves": 0, "legal": 0, "perft": 0, "search": 0}
    eval_off_by = {0: 0, 1: 0, "more": 0}
    agree = [0, 0]
    t0 = time.perf_counter()

    def check(kind, pid, got, want):
        counts[kind] += 1
        if got != want:
            fails.append(f"#{pid} {kind}: got {got!r}, original {want!r}")

    for pid, ref in strict.items():
        fen = ref["fen"]
        if eng.set_fen(fen) != 0:
            fails.append(f"#{pid} set_fen rejected {fen}")
            continue
        check("eval", pid, eng.call("rn_info", 4), ref["eval"])
        d = abs(eng.call("rn_info", 4) - fast[pid]["eval"])
        eval_off_by[d if d in (0, 1) else "more"] += 1
        n = eng.call("rn_gen_pseudo")
        check("moves", pid, [eng.uci(m) for m in eng.moves(n)], ref["moves"])
        n = eng.call("rn_gen_legal")
        check("legal", pid, [eng.uci(m) for m in eng.moves(n)], [m for m, ok in zip(ref["moves"], ref["legal"]) if ok])
        for depth, want in zip((1, 2, 3), ref["perft"]):
            check("perft", pid, eng.call("rn_perft", depth), want)
        forced = sum(ref["legal"]) == 1  # the original gives a forced move 15 ms, so its node count depends on the clock
        for depth, want in ref["search"].items():
            if want is None or (quick and int(depth) > 4):
                continue
            eng.call("rn_new_game")
            eng.fen(fen)
            mv = eng.call("rn_go", 1e12, 1e12, int(depth))
            got = {"move": eng.uci(mv), "score": eng.call("rn_info", 2), "depth": eng.call("rn_info", 1), "nodes": eng.call("rn_info", 0)}
            if forced:
                got, want = {"move": got["move"]}, {"move": want["move"]}
            check("search", pid, got, want)
            fm = fast[pid]["search"].get(depth)
            if fm and not forced:
                agree[0] += got["move"] == fm["move"]
                agree[1] += 1

    # Whole games: the engine's tables and its list of seen positions carry over from move to move.
    games_path = HERE / "golden_games.json"
    game_moves = 0
    if games_path.exists() and not quick:
        for game in json.load(open(games_path, encoding="utf-8")):
            eng.call("rn_new_game")
            for i, ref in enumerate(game["moves"]):
                eng.fen(ref["fen"])
                mv = eng.call("rn_go", 1e12, 1e12, game["depth"])
                got = {"move": eng.uci(mv), "score": eng.call("rn_info", 2), "depth": eng.call("rn_info", 1), "nodes": eng.call("rn_info", 0)}
                want = {k: ref[k] for k in ("move", "score", "depth", "nodes")}
                if ref["forced"]:  # see above: the original's node count for a forced move depends on its clock
                    got, want = {"move": got["move"]}, {"move": want["move"]}
                game_moves += 1
                if got != want:
                    fails.append(f'game "{game["name"]}" move {i + 1}: got {got!r}, original {want!r}')
                    break  # after the first difference the two games are no longer the same game

    secs = time.perf_counter() - t0
    print(f"{WASM.name}: {len(strict)} positions in {secs:.1f} s")
    print("exact checks against the strict reference:", ", ".join(f"{k} {v}" for k, v in counts.items()))
    if game_moves:
        print(f"whole games replayed move by move: {game_moves} moves, each compared exactly")
    print(f"static evaluation against the untouched original: same {eval_off_by[0]}, off by one {eval_off_by[1]}, off by more {eval_off_by['more']}")
    if agree[1]:
        print(f"searched move equals the untouched original's in {agree[0]} of {agree[1]} searches")
    for f in fails[:40]:
        print("FAIL", f)
    if len(fails) > 40:
        print(f"... and {len(fails) - 40} more")
    ok = not fails and eval_off_by["more"] == 0
    print("PASS" if ok else f"FAILED: {len(fails)} exact checks, {eval_off_by['more']} evaluations off by more than one")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
