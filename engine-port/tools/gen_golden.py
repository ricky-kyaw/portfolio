"""Produce the reference numbers the C port is tested against.

    python engine-port/tools/gen_golden.py PATH_TO_ORIGINAL_ENGINE_FOLDER

It runs the ORIGINAL Python engine (needs numba, numpy, python-chess) twice:

  fastmath   the engine exactly as it is.
  strict     a temporary copy where the only change is that the numba `fastmath`
             flag sets in cg_nnue.py (FM and FM_DIFF) are emptied. With fastmath
             the original lets its compiler reorder float sums, so its evaluations
             are not bit-reproducible from one machine to the next. With the flags
             emptied the arithmetic follows the source order, and a faithful port
             has to match it exactly: same evaluation, same move, same score and
             same node count at a fixed depth.

For every position of tests/suite.json it records, per variant:
  static evaluation, the generated move list in generation order, which of those
  moves are legal, perft 1..3 from the engine's own generator, and a fixed-depth
  search from a freshly reset engine (best move, score, depth, nodes).

Each variant runs in its own Python process because numba compiles at import.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TESTS = HERE.parent / "tests"
DEPTHS = (4, 7)

WORKER = r'''
import json, os, sys, time
sys.path.insert(0, os.getcwd())
import numpy as np
import agent
from cg_movegen import gen_moves
from cg_position import make_move, move_to_uci, set_fen, in_check
from cg_eval import evaluate, acc_root

suite = json.load(open(sys.argv[1], encoding="utf-8"))
depths = [int(x) for x in sys.argv[3].split(",")]

def perft(ply, depth):
    n = gen_moves(agent._BB[ply], agent._ST[ply], agent._BUF[ply])
    total = 0
    for i in range(n):
        if make_move(agent._BB, agent._ST, agent._KEY, ply, agent._BUF[ply, i]):
            total += 1 if depth == 1 else perft(ply + 1, depth - 1)
    return total

out = []
for pos in suite:
    fen = pos["fen"]
    rec = {"id": pos["id"], "fen": fen}
    set_fen(agent._BB, agent._ST, agent._KEY, fen)
    side = int(agent._ST[0, 0])
    acc_root(agent._ACC[0], agent._BB[0])
    rec["eval"] = int(evaluate(agent._BB[0], side, agent._ACC[0]))
    rec["key"] = "%016x" % int(agent._KEY[0])
    rec["in_check"] = bool(in_check(agent._BB[0], side))
    n = gen_moves(agent._BB[0], agent._ST[0], agent._BUF[0])
    moves, legal = [], []
    for i in range(n):
        mv = int(agent._BUF[0, i])
        moves.append(move_to_uci(mv))
        legal.append(bool(make_move(agent._BB, agent._ST, agent._KEY, 0, mv)))
    rec["moves"] = moves
    rec["legal"] = legal
    rec["perft"] = [perft(0, d) for d in (1, 2, 3)]
    rec["search"] = {}
    for d in depths:
        agent._reset_game()
        agent._LAST_FULLMOVE = 0
        agent._INCREMENT_EST = -1.0
        agent._FIXED_DEPTH = d
        if not any(legal):
            rec["search"][str(d)] = None
            continue
        uci = agent.get_move(fen, 10_000_000)
        rec["search"][str(d)] = {"move": uci, "score": int(agent._OUT[1]), "depth": int(agent._OUT[2]), "nodes": int(agent._INFO[0])}
    out.append(rec)

json.dump(out, open(sys.argv[2], "w", encoding="utf-8", newline="\n"), indent=0)  # LF on every system, so the file can be compared byte for byte
'''


def run_variant(engine_dir: Path, strict: bool, suite: Path, out: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "engine"
        shutil.copytree(engine_dir, work, ignore=shutil.ignore_patterns("__pycache__"))
        if strict:
            src = (work / "cg_nnue.py").read_text(encoding="utf-8")
            a = 'FM = {"reassoc", "contract", "nsz", "arcp"}'
            b = 'FM_DIFF = {"contract", "nsz", "arcp"}'
            assert src.count(a) == 1 and src.count(b) == 1, "fastmath flag lines not found"
            src = src.replace(a, "FM = False").replace(b, "FM_DIFF = False")
            (work / "cg_nnue.py").write_text(src, encoding="utf-8")
        (work / "_golden_worker.py").write_text(WORKER, encoding="utf-8")
        env = dict(os.environ, CG_INIT_BUDGET="600", PYTHONIOENCODING="utf-8")
        env.pop("CG_CACHE", None)
        env.pop("CG_FIXED_DEPTH", None)
        subprocess.run(
            [sys.executable, "_golden_worker.py", str(suite), str(out), ",".join(map(str, DEPTHS))],
            cwd=work, env=env, check=True, stderr=subprocess.DEVNULL,
        )


def main() -> None:
    engine_dir = Path(sys.argv[1]).resolve()
    suite = TESTS / "suite.json"
    for name, strict in (("strict", True), ("fastmath", False)):
        out = TESTS / f"golden_{name}.json"
        print(f"running the {name} reference ...", flush=True)
        run_variant(engine_dir, strict, suite, out)
        data = json.load(open(out, encoding="utf-8"))
        print(f"  {len(data)} positions -> {out}")


if __name__ == "__main__":
    main()
