"""Reference numbers for whole games, where the engine's memory carries over between moves.

    python engine-port/tools/gen_golden_games.py PATH_TO_ORIGINAL_ENGINE_FOLDER

The single-position suite starts every search from a freshly reset engine. A real game
does not: the transposition table, the history tables and the list of positions already
seen all carry over from one move to the next, and the history is halved before each
search. This script lets the ORIGINAL engine play both sides of a few games at a fixed
depth and records, for every move, the position it was given and what it answered
(move, score, depth reached, node count). The C port is then fed the same positions in
the same order and has to answer identically every time.
"""
import json
import os
import subprocess
import sys
import tempfile
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
TESTS = HERE.parent / "tests"

GAMES = [
    {"name": "from the start, depth 6", "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "depth": 6, "plies": 80},
    {"name": "open middlegame, depth 7", "fen": "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", "depth": 7, "plies": 60},
    {"name": "rook endgame, depth 8", "fen": "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", "depth": 8, "plies": 80},
    {"name": "sharp tactics, depth 6", "fen": "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", "depth": 6, "plies": 60},
]

WORKER = r'''
import json, os, sys
sys.path.insert(0, os.getcwd())
import chess
import agent

games = json.load(open(sys.argv[1], encoding="utf-8"))
out = []
for g in games:
    agent._reset_game()
    agent._LAST_FULLMOVE = 0
    agent._INCREMENT_EST = -1.0
    agent._FIXED_DEPTH = g["depth"]
    board = chess.Board(g["fen"])
    record = []
    for _ in range(g["plies"]):
        if board.is_game_over(claim_draw=False):
            break
        fen = board.fen()
        forced = board.legal_moves.count() == 1
        uci = agent.get_move(fen, 10_000_000)
        record.append({"fen": fen, "move": uci, "score": int(agent._OUT[1]), "depth": int(agent._OUT[2]), "nodes": int(agent._INFO[0]), "forced": forced})
        board.push_uci(uci)
    out.append({"name": g["name"], "depth": g["depth"], "moves": record, "result": board.result(claim_draw=True)})
json.dump(out, open(sys.argv[2], "w", encoding="utf-8", newline="\n"), indent=0)  # LF on every system, so the file can be compared byte for byte
'''


def main() -> None:
    engine_dir = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "engine"
        shutil.copytree(engine_dir, work, ignore=shutil.ignore_patterns("__pycache__"))
        # Same "strict" variant as gen_golden.py: only the numba fastmath flag sets are emptied, so the
        # float arithmetic follows the source order and the numbers are the same on every machine.
        src = (work / "cg_nnue.py").read_text(encoding="utf-8")
        flags = ('FM = {"reassoc", "contract", "nsz", "arcp"}', 'FM_DIFF = {"contract", "nsz", "arcp"}')
        assert all(src.count(f) == 1 for f in flags), "fastmath flag lines not found"
        src = src.replace(flags[0], "FM = False").replace(flags[1], "FM_DIFF = False")
        (work / "cg_nnue.py").write_text(src, encoding="utf-8")
        (work / "_games_worker.py").write_text(WORKER, encoding="utf-8")
        spec = Path(tmp) / "games.json"
        spec.write_text(json.dumps(GAMES), encoding="utf-8")
        out = TESTS / "golden_games.json"
        env = dict(os.environ, CG_INIT_BUDGET="600", PYTHONIOENCODING="utf-8")
        env.pop("CG_CACHE", None)
        env.pop("CG_FIXED_DEPTH", None)
        subprocess.run([sys.executable, "_games_worker.py", str(spec), str(out)], cwd=work, env=env, check=True, stderr=subprocess.DEVNULL)
    data = json.load(open(out, encoding="utf-8"))
    for g in data:
        print(f'{g["name"]}: {len(g["moves"])} moves, {sum(m["nodes"] for m in g["moves"]):,} nodes, result {g["result"]}')


if __name__ == "__main__":
    main()
