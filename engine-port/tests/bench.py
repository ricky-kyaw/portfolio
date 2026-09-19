"""How fast is the built engine? Searches a few positions to a fixed depth and prints nodes per second.

    python engine-port/tests/bench.py [depth]

The node counts are deterministic, so they double as a quick "did anything change" check.
(This runs under wasmtime. A browser's speed will differ a little.)
"""
import sys
import time

from run_fidelity import Engine

POSITIONS = [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
]


def main() -> None:
    depth = int(sys.argv[1]) if len(sys.argv) > 1 else 11
    eng = Engine()
    total_nodes, total_secs = 0, 0.0
    for fen in POSITIONS:
        eng.call("rn_new_game")
        eng.fen(fen)
        t0 = time.perf_counter()
        mv = eng.call("rn_go", 1e12, 1e12, depth)
        secs = time.perf_counter() - t0
        nodes = eng.call("rn_info", 0)
        total_nodes += nodes
        total_secs += secs
        print(f"{eng.uci(mv):6} score {eng.call('rn_info', 2):6} nodes {nodes:9,} in {secs:6.2f} s  {fen}")
    print(f"depth {depth}: {total_nodes:,} nodes, {total_nodes / total_secs:,.0f} nodes a second")


if __name__ == "__main__":
    main()
