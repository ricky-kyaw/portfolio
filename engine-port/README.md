# Ransom in the browser

Ransom is the chess engine from
[ricky-kyaw/optiver-chessathon-engine](https://github.com/ricky-kyaw/optiver-chessathon-engine).
The original is Python compiled with numba, which a browser cannot run. This folder is
the same engine rewritten in C, function by function, and built as WebAssembly for the
[Play page](https://rickydx.dev/play/). Like the original, it was built with Claude Code.

The port makes no changes to how the engine thinks. No pruning rule, table size, margin
or evaluation step was altered, and it uses the same network weights, stored as the same
float32 numbers.

## How we know it is the same engine

`tests/run_fidelity.py` runs the built `.wasm` file (the very file the page loads) and
compares it with numbers recorded from the original Python engine:

| What | How many | Must be |
|---|---|---|
| Static evaluation | 104 positions | identical |
| Generated moves, in generation order | 104 positions | identical |
| Which of those moves are legal | 104 positions | identical |
| Perft 1, 2 and 3 | 312 counts | identical (and equal to python-chess) |
| Fixed-depth search from a fresh engine, depths 4 and 7: move, score, depth, node count | 208 searches | identical |
| Whole games at fixed depth, where the engine's tables carry over between moves: move, score, depth, node count | 4 games, 261 moves | identical |

The 104 positions come from the engine's own benchmark, test and game files.

One detail about floating point. A few functions of the original use numba's `fastmath`
flags, which let its compiler reorder float sums, so the original is not guaranteed to
give the same last bit on every machine. The reference numbers are therefore recorded
from a copy of the original whose **only** change is that those flag sets are emptied
(`tools/gen_golden.py` shows the two replaced lines). On the machine they were recorded
on, that strict copy and the untouched original gave the same result for every position
and every game move. `run_fidelity.py` also checks the evaluations against the untouched
original.

## Files

```
src/ransom.h      shared declarations                    src/nnue.c     cg_nnue.py, cg_eval.py, is_insufficient
src/tables.c      cg_tables.py (what the engine reads)   src/search.c   cg_search.py
src/position.c    cg_position.py                         src/api.c      the core of agent.py, plus the functions the page calls
src/movegen.c     cg_movegen.py
PORTING.md        the rules the port follows
build.py          builds assets/wasm/ransom.wasm and ransom-simd.wasm
tools/export_net.py        turns the original weights/net.npz into assets/wasm/ransom-net.bin (no rounding)
tools/gen_golden.py        records the reference numbers from the original engine
tools/gen_golden_games.py  records the reference games
tests/run_fidelity.py      the comparison described above
tests/bench.py             nodes per second
```

## Doing it yourself

```
pip install ziglang wasmtime                 # a C compiler and a WebAssembly runtime
python engine-port/build.py
python engine-port/tests/run_fidelity.py
python engine-port/tests/run_fidelity.py --simd
```

To record the reference numbers again you also need the original engine and its
requirements (`pip install numba numpy chess`):

```
python engine-port/tools/gen_golden.py        PATH/TO/optiver-chessathon-engine/engine
python engine-port/tools/gen_golden_games.py  PATH/TO/optiver-chessathon-engine/engine
```

## What is different from the original, on purpose

- The page tells the engine which positions the game has already seen before every
  search, so taking a move back cannot leave a stale history behind. The original keeps
  that list by itself, one position per call.
- "Gentle" and "Club" on the page are the same engine with a depth limit (2 and 5
  half-moves). "Full strength" gives it about a second a move instead of a game clock.
- On phones the transposition table has 2^20 entries instead of 2^22, to use 16 MB
  instead of 64 MB. The tests run with 2^22, as the original does.
- It reports each finished depth to the page, so the page can show what it is thinking.
