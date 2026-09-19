# Porting rules: Ransom (Python + numba) to C, built as WebAssembly

The original engine lives in `ricky-kyaw/optiver-chessathon-engine`, folder `engine/`.
This folder holds a line-by-line port of the parts that play chess, so the same
engine can run inside a web page. The port is judged by one thing: **given the same
position and the same fixed depth, it must return the same move, the same score and
the same node count as the original.** Speed comes second. Cleverness is not wanted.

## What is ported

| Python module | C file | Notes |
|---|---|---|
| `cg_tables.py` | `tables.c` | Only tables the playing engine reads. Magic numbers and Zobrist keys are embedded as constants; the slider attack tables are rebuilt at start-up from the magics (bit-identical to `magics.npz`). Hand-crafted-eval tables are included only where `cg_position.py` or `is_insufficient` read them. |
| `cg_position.py` | `position.c` | Everything except `ray_attack`, `see_value`, `new_state` (arrays are static in C). |
| `cg_movegen.py` | `movegen.c` | Same generation ORDER. Order changes search results. |
| `cg_nnue.py`, `cg_eval.py` | `nnue.c` | Only the inference path the shipped build uses (`acc_root`, `acc_push`, `acc_copy`, `evaluate`, `evaluate_inc`, `_bucket`, and what they call). Not `load` (weights arrive as raw bytes), not the training helpers. |
| `cg_hce.py` | `nnue.c` | Only `is_insufficient`. The hand-crafted evaluation is not used by the shipped build. |
| `cg_search.py` | `search.c` | All of it. |
| `agent.py` | `api.c` | `_reset_game`, `_budget_ms`, `_remember`, the core of `get_move`. Not the numba warm-up, not the python-chess fallback (the web page has its own rules referee). |

## Conventions (every file follows these)

1. **Same names.** A Python function `make_move` is the C function `make_move`. A Python
   constant `TT_BITS` is the C macro or `static const` `TT_BITS`. A reader should be able
   to hold the two files side by side.
2. **Types.** `typedef uint64_t u64; typedef int64_t i64; typedef uint32_t u32; typedef int32_t i32;`
   numba `int64` is `i64`, `uint64` is `u64`, `float32` is `float`, `float64` is `double`.
   Follow numba's type inference, not what looks natural: a Python float literal is a
   `double`, so `x * 0.5` with a float32 `x` is computed in `double`. Integer literals and
   loop counters in numba are `int64`. Where the spec says an expression mixes `uint64`
   with a signed integer (numba turns that into `float64`), reproduce the original result
   exactly and leave a comment.
3. **Integer division and modulo.** Python `//` and `%` round toward minus infinity. C
   rounds toward zero. Use the helpers `floordiv(a, b)` and `pymod(a, b)` from `ransom.h`
   wherever an operand can be negative. Python `>>` on a negative `int64` is an arithmetic
   shift; on wasm and every compiler we use, `>>` on `i64` is arithmetic too, which we rely on.
4. **Arrays.** numpy arrays become flat C arrays in row-major order with the same index
   formula: `a[i, j, k]` is `a[(i * D1 + j) * D2 + k]`. Use the index macros in `ransom.h`.
   The engine state that `agent.py` keeps in module globals (`_BB`, `_ST`, `_KEY`, `_BUF`,
   `_SBUF`, `_TT`, `_KILLERS`, `_HISTORY`, `_QUIETS`, `_SS`, `_CONTH`, `_CORR`, `_INFO`,
   `_OUT`, `_ACC`, `_GAME_KEYS`, `_N_GAME`) becomes C globals with the same names without
   the underscore, lower-cased: `bb`, `st`, `key`, `buf`, `sbuf`, `tt`, `killers`, `history`,
   `quiets`, `ss`, `conth`, `corr`, `info`, `out`, `acc`, `game_keys`, `n_game`.
   Functions in `position.c`, `movegen.c` and `nnue.c` keep the array PARAMETERS the Python
   functions have (a row such as `bb[ply]` is passed as a pointer to that row; a whole
   array is passed as its base pointer). Functions in `search.c` read the globals directly
   instead of taking twenty array parameters; every other parameter stays, in the same order.
5. **No libc.** The WebAssembly build is freestanding: no `malloc`, no `printf`, no
   `memcpy` from a library. `ransom.h` declares `rn_memcpy`, `rn_memset` (defined in
   `api.c`). Do not include anything except `<stdint.h>` and `<stddef.h>`. The large tables
   (`tt`) are allocated once by `plat_alloc()` in `api.c`.
6. **Floating point.** Keep every floating-point operation in the SAME ORDER as the Python
   source, one operation per statement where the order matters. No `-ffast-math`. The
   build uses `-ffp-contract=off`. The original uses numba `fastmath` flags on a few
   functions, which lets its compiler reorder sums, so the original itself is not
   bit-reproducible across machines. The port is tested against a reference copy of the
   original with those flags emptied (strict IEEE, source order), where results must match
   exactly, and against the untouched original, where static evaluations must agree within
   one unit.
7. **The clock.** `clock_now()` returns seconds as a `double`. In C it calls the imported
   `plat_now_ms() / 1000.0`. Fixed-depth tests pass a deadline of `1e18`.
8. **Nothing extra.** No new pruning, no new tables, no "fixes". If the Python has a quirk
   (a stale comment, an unused value, an odd tie-break), port the code, not the comment, and
   note the quirk in a comment starting with `QUIRK:`. The only additions allowed are the
   reporting hook `plat_on_iteration()` called once per finished depth in `search_root`,
   and the functions in `api.c`.
9. **Comments.** One short comment above each function naming the Python function and line
   it ports, e.g. `/* cg_search.py:492 negamax */`.

## The API that `api.c` exports (used by the web worker and by the test driver)

```c
int    rn_init(int tt_bits);        /* tables, state, TT of 2^tt_bits entries (original: 22). 0 = ok */
u8    *rn_net_buffer(int nbytes);   /* returns where the caller must copy the weight file */
int    rn_net_load(void);           /* reads the buffer: see "Weight file" below. 0 = ok */
void   rn_new_game(void);           /* agent._reset_game */
char  *rn_fen_buffer(void);         /* 128-byte buffer for a NUL-terminated FEN */
int    rn_set_fen(void);            /* set_fen(bb, st, key, fen) from the buffer. 0 = ok */
int    rn_go(double soft_ms, double hard_ms, int max_depth);
                                    /* the core of agent.get_move for the FEN in the buffer:
                                       set_fen, _remember, forced-move rule, clear killers, halve
                                       history, search_root, the "is it generated here" check,
                                       make the move, _remember the new key. Returns the move
                                       (engine encoding) or 0. soft_ms/hard_ms are used as given;
                                       a negative soft_ms means "compute both with _budget_ms"
                                       from rn_clock_left_ms (see below). */
void   rn_set_clock(double time_left_ms);  /* only for the _budget_ms path */
char  *rn_move_uci(i64 move);       /* static 6-byte buffer, e.g. "e7e8q" */
i64    rn_info(int what);           /* 0 nodes, 1 depth reached, 2 score, 3 best move,
                                       4 static eval of the current root (evaluate), 5 in check (0/1) */
int    rn_gen_legal(void);          /* legal moves of the current root into a static i64[256]; returns n */
i64   *rn_move_list(void);          /* that array */
int    rn_gen_pseudo(void);         /* gen_moves output order, unfiltered, same array; returns n */
u64    rn_perft(int depth);         /* counts leaf nodes with gen_moves + make_move from the current root */
void   rn_history_clear(void);      /* n_game = 0 */
int    rn_history_push_fen(void);   /* set_fen from the buffer, then _remember(key[0]). For take-backs. */
```

Platform layer (two implementations, chosen by `#ifdef __wasm__`): `plat_now_ms()`,
`plat_alloc(size_t)`, `plat_on_iteration(int depth, i64 score, i64 nodes, i64 move)`.
On wasm the first and third are imports from module `env`; `plat_alloc` grows memory.
Natively they use `<time.h>`, `malloc` and do nothing (these three are the only place
libc is allowed, inside `#ifndef __wasm__`).

## Weight file

`tools/export_net.py` turns `weights/net.npz` into one little-endian binary:
`"RNET"`, `u32 version = 1`, `u32 l1 = 256`, `u32 n_buckets = 8`, `f32 scale = 400.0`,
then `w1` as `f32[768 * 256]` row-major, `b1 f32[256]`, `w2 f32[8 * 512]`, `b2 f32[8]`.
`EVAL_MULT = 1.619` is applied in C exactly where `cg_eval.py` applies it.
