/* api.c -- port of the playing core of engine/agent.py (Ransom chess engine), plus the
 * things PORTING.md assigns to this file:
 *
 *   - the engine-state globals (agent.py:66-99, the module globals _BB, _ST, ...)
 *   - the platform layer: plat_now_ms, plat_alloc, plat_on_iteration
 *   - rn_memcpy / rn_memset
 *   - _reset_game, _budget_ms, _remember and the core of get_move (as rn_go)
 *   - the rest of the rn_* API used by the web worker and the test driver
 *
 * NOT ported, on purpose (PORTING.md): the numba warm-up and its "valve" (agent.py:317-436),
 * the python-chess _fallback (the web page has its own rules referee: every path that ends
 * in `return _fallback(fen)` in the Python returns move 0 here), and the stderr prints.
 */
#include "ransom.h"

#ifndef __wasm__
/* PORTING.md rule 5: the platform layer is the only place libc is allowed. */
#include <stdlib.h>
#include <time.h>
#endif

/* Keep the compiler from turning the byte loops of rn_memcpy / rn_memset back into calls
 * to memcpy / memset, which do not exist in the freestanding build. */
#if defined(__has_attribute)
#if __has_attribute(no_builtin)
#define RN_NO_BUILTIN __attribute__((no_builtin))
#endif
#endif
#ifndef RN_NO_BUILTIN
#define RN_NO_BUILTIN
#endif

/* ===================================================================================== */
/* Engine state (agent.py:66-88). Zero-initialised here; rn_init sets the non-zero parts. */
/* ===================================================================================== */

u64   bb[MAXPLY * NBB];                 /* _BB        */
i64   st[MAXPLY * ST_COLS];             /* _ST        */
u64   key[MAXPLY];                      /* _KEY       */
i64   buf[MAXPLY * MAX_MOVES];          /* _BUF       */
i64   sbuf[MAXPLY * MAX_MOVES];         /* _SBUF      */
u64  *tt = NULL;                        /* _TT, plat_alloc'ed in rn_init */
i64   tt_size = 0;                      /* TT_SIZE    */
u64   tt_mask = 0;                      /* TT_MASK    */
i64   killers[(MAX_PLY + 2) * 2];       /* _KILLERS   */
i64   history[2 * 64 * 64];             /* _HISTORY   */
i64   quiets[(MAX_PLY + 2) * 64];       /* _QUIETS    */
i64   ss[(MAX_PLY + 4) * SS_COLS];      /* _SS        */
i16   conth[2 * CONT_N * CONT_N];       /* _CONTH     */
i32   corr[3 * 2 * CORR_SIZE];          /* _CORR      */
i64   info[4];                          /* _INFO      */
i64   out[4];                           /* _OUT       */
float acc[MAXPLY * 2 * L1];             /* _ACC       */
u64   game_keys[GAME_KEYS_MAX];         /* _GAME_KEYS */
i64   n_game = 0;                       /* _N_GAME    */

/* agent.py:89-99, the scalar module globals. Private to this file. */
static i64    moves_played = 0;         /* _MOVES_PLAYED  (written, never read: as the Python) */
static i64    last_fullmove = 0;        /* _LAST_FULLMOVE */
static double increment_est = -1.0;     /* _INCREMENT_EST: measured from the clock; -1 = unknown */
static double prev_left = -1.0;         /* _PREV_LEFT     */
static double prev_elapsed = 0.0;       /* _PREV_ELAPSED  */
static double overshoot = 1.3;          /* _OVERSHOOT     */
/* _PREV_SOFT (agent.py:99) is declared and never used in the Python; it is left out. */

/* agent.py:43-59  time control. Python ints stay integers, Python floats are doubles. */
#define BASE_MS       120000            /* unused in the Python as well */
#define INCREMENT_MS  500
#define SAFETY_MS     80
#define MIN_THINK_MS  15
/* TM_BASE_MS is float(os.environ.get("CG_BASE_MS", "120000")): the platform sets nothing. */
#define TM_BASE_MS    120000.0
#define TM_FLOOR      22.0
#define TM_INTERCEPT  63.0
#define TM_MAT_LO     0.8
#define TM_RESERVE    1
#define TM_R_HI       (TM_BASE_MS / 8.0)
#define TM_R_LO       (TM_BASE_MS / 30.0)
#define TM_R_SLOPE    ((TM_R_HI - TM_R_LO) / 40.0)

/* API-side state that has no counterpart in agent.py */
static char   fen_buf[RN_FEN_MAX];      /* rn_fen_buffer                                    */
static i64    move_list[MAX_MOVES];     /* rn_move_list                                     */
static char   uci_buf[8];               /* rn_move_uci ("e7e8q" + NUL needs 6)              */
static double clock_left_ms = 0.0;      /* rn_set_clock: get_move's time_left_ms argument   */
static u8    *net_buf = NULL;           /* rn_net_buffer                                    */
static size_t net_cap = 0;              /* bytes allocated behind net_buf                   */
static size_t net_len = 0;              /* bytes the caller announced                       */

/* ===================================================================================== */
/* rn_memcpy / rn_memset (PORTING.md rule 5). Byte loops. Both return dst.               */
/* ===================================================================================== */

RN_NO_BUILTIN
void *rn_memcpy(void *dst, const void *src, size_t n)
{
    u8 *d = (u8 *)dst;
    const u8 *s = (const u8 *)src;
    size_t i;
    for (i = 0; i < n; i++)
        d[i] = s[i];
    return dst;
}

RN_NO_BUILTIN
void *rn_memset(void *dst, int c, size_t n)
{
    u8 *d = (u8 *)dst;
    size_t i;
    for (i = 0; i < n; i++)
        d[i] = (u8)c;
    return dst;
}

/* ===================================================================================== */
/* Platform layer                                                                        */
/* ===================================================================================== */

#ifdef __wasm__

/* plat_now_ms and plat_on_iteration are imports from module "env" (declared in ransom.h). */

/* Grows linear memory by whole 64 KiB pages and returns the start of the new region, which
 * is page aligned (so 8-byte aligned). Called twice in a run (the TT, the weight buffer);
 * memory is never given back. */
void *plat_alloc(size_t nbytes)
{
    size_t pages = (nbytes + (size_t)65535) / (size_t)65536;
    size_t old;
    if (nbytes == 0 || pages == 0)      /* pages == 0: nbytes + 65535 wrapped around */
        return NULL;
    old = __builtin_wasm_memory_grow(0, pages);
    if (old == (size_t)-1)
        return NULL;
    return (void *)(old * (size_t)65536);
}

#else

double plat_now_ms(void)
{
    return (double)clock() * 1000.0 / (double)CLOCKS_PER_SEC;
}

void *plat_alloc(size_t nbytes)
{
    if (nbytes == 0)
        return NULL;
    return malloc(nbytes);              /* malloc aligns to at least 8 bytes */
}

void plat_on_iteration(int depth, i64 score, i64 nodes, i64 move)
{
    (void)depth;
    (void)score;
    (void)nodes;
    (void)move;
}

#endif

/* ===================================================================================== */
/* agent.py                                                                              */
/* ===================================================================================== */

/* agent.py:102 _reset_game -- forget everything that belongs to one game.
 * QUIRK: _INCREMENT_EST, _PREV_ELAPSED, _LAST_FULLMOVE, _QUIETS, _SS, _ACC and the contents
 * of _GAME_KEYS are NOT reset, exactly as in the Python. */
static void _reset_game(void)
{
    i64 i;
    n_game = 0;
    overshoot = 1.3;
    prev_left = -1.0;
    moves_played = 0;
    if (tt != NULL) {
        for (i = 0; i < tt_size; i++) {
            tt[IX_TT(i, TT_KEY)] = U0;          /* _TT[:, 0] = 0        */
            tt[IX_TT(i, TT_ENTRY)] = TT_EMPTY;  /* _TT[:, 1] = TT_EMPTY */
        }
    }
    rn_memset(history, 0, sizeof history);      /* _HISTORY[:] = 0 */
    rn_memset(killers, 0, sizeof killers);      /* _KILLERS[:] = 0 */
    rn_memset(conth, 0, sizeof conth);          /* _CONTH[:] = 0   */
    rn_memset(corr, 0, sizeof corr);            /* _CORR[:] = 0    */
}

/* agent.py:124 _budget_ms -- (soft, hard) thinking time in ms.
 * time_left_ms is a Python int in the original; it arrives here already truncated to a
 * whole number (rn_set_clock), so `left` holds the same integer value as a double.
 * Every operation after `left` is float64 in the Python and stays in the same order. */
static void _budget_ms(double time_left_ms, i64 pieces_left, i64 fullmove,
                       double *soft_out, double *hard_out)
{
    double left;
    double inc;
    double frac;
    i64 played;
    double sched;
    double mat;
    double moves_left;
    double reserve;
    double spend;
    double target;
    double soft;
    double hard;
    double hard_a;
    double hard_b;

    left = time_left_ms - (double)SAFETY_MS;            /* max(0, time_left_ms - SAFETY_MS) */
    if (!(left > 0.0))
        left = 0.0;
    if (left <= (double)MIN_THINK_MS) {
        *soft_out = (double)MIN_THINK_MS;
        *hard_out = (double)MIN_THINK_MS;
        return;
    }
    inc = (increment_est >= 0.0) ? increment_est : (double)INCREMENT_MS;
    frac = (double)(pieces_left - 6) / 26.0;
    if (frac < 0.0)
        frac = 0.0;
    else if (frac > 1.0)
        frac = 1.0;
    played = i64_max(0, fullmove - 1);
    /* max(TM_FLOOR, TM_INTERCEPT - 0.9 * played) * (TM_MAT_LO + (1.0 - TM_MAT_LO) * frac) */
    sched = 0.9 * (double)played;
    sched = TM_INTERCEPT - sched;
    if (!(sched > TM_FLOOR))
        sched = TM_FLOOR;
    mat = 1.0 - TM_MAT_LO;                              /* 0.19999999999999996, not 0.2 */
    mat = mat * frac;
    mat = TM_MAT_LO + mat;
    moves_left = sched * mat;
    reserve = 0.0;
    if (TM_RESERVE) {
        if (fullmove <= 70) {
            reserve = TM_R_HI;
        } else {
            /* max(TM_R_LO, TM_R_HI - TM_R_SLOPE * (fullmove - 70)) */
            reserve = TM_R_SLOPE * (double)(fullmove - 70);
            reserve = TM_R_HI - reserve;
            if (!(reserve > TM_R_LO))
                reserve = TM_R_LO;
        }
    }
    /* target = max(0.0, left - reserve) / moves_left + inc */
    spend = left - reserve;
    if (!(spend > 0.0))
        spend = 0.0;
    target = spend / moves_left;
    target = target + inc;
    soft = target / overshoot;
    /* hard = min(left * 0.20, soft * 3.0) */
    hard_a = left * 0.20;
    hard_b = soft * 3.0;
    hard = (hard_b < hard_a) ? hard_b : hard_a;
    if (soft > hard)
        soft = hard;
    *soft_out = (soft > (double)MIN_THINK_MS) ? soft : (double)MIN_THINK_MS;
    *hard_out = (hard > (double)MIN_THINK_MS) ? hard : (double)MIN_THINK_MS;
}

/* agent.py:174 _remember. QUIRK: beyond GAME_KEYS_MAX positions the key is silently dropped. */
static void _remember(u64 k)
{
    if (n_game < GAME_KEYS_MAX) {
        game_keys[n_game] = k;
        n_game += 1;
    }
}

/* agent.py:216  fullmove = int(fen.rsplit(" ", 1)[-1]) if fen.count(" ") >= 5 else 1
 * Returns 0 and writes *fullmove, or returns 1 where the Python int() would raise (a
 * non-numeric last field, or a trailing space that leaves it empty). */
static int parse_fullmove(const char *fen, i64 *fullmove)
{
    i64 spaces = 0;
    i64 last = -1;
    i64 i;
    i64 v = 0;
    i64 digits = 0;
    int neg = 0;
    char ch;

    for (i = 0; fen[i] != '\0'; i++) {
        if (fen[i] == ' ') {
            spaces += 1;
            last = i;
        }
    }
    if (spaces < 5) {
        *fullmove = 1;
        return 0;
    }
    i = last + 1;
    /* int() ignores surrounding whitespace; the space character cannot occur here */
    while (fen[i] == '\t' || fen[i] == '\n' || fen[i] == '\r' || fen[i] == '\v' || fen[i] == '\f')
        i++;
    if (fen[i] == '+' || fen[i] == '-') {
        neg = (fen[i] == '-');
        i++;
    }
    for (;;) {
        ch = fen[i];
        if (ch >= '0' && ch <= '9') {
            if (v < 100000000000000000LL)       /* saturate instead of overflowing */
                v = v * 10 + (i64)(ch - '0');
            digits += 1;
            i++;
        } else if (ch == '_' && digits > 0 && fen[i + 1] >= '0' && fen[i + 1] <= '9') {
            i++;                                /* int("1_0") == 10 */
        } else {
            break;
        }
    }
    if (digits == 0)
        return 1;
    while (fen[i] == '\t' || fen[i] == '\n' || fen[i] == '\r' || fen[i] == '\v' || fen[i] == '\f')
        i++;
    if (fen[i] != '\0')
        return 1;
    *fullmove = neg ? -v : v;
    return 0;
}

/* agent.py:232  pieces_left = sum(1 for c in fen.split(" ", 1)[0] if c.isalpha()) */
static i64 count_pieces(const char *fen)
{
    i64 n = 0;
    i64 i;
    char c;
    for (i = 0; fen[i] != '\0' && fen[i] != ' '; i++) {
        c = fen[i];
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))
            n += 1;
    }
    return n;
}

/* ===================================================================================== */
/* The exported API                                                                      */
/* ===================================================================================== */

/* agent.py:66-99: build the persistent state. new_state() fills the mailbox words of EVERY
 * ply with FULL; new_tt() sets column 1 to TT_EMPTY; everything else starts at zero.
 * Returns 0 = ok, 1 = tt_bits out of range, 2 = out of memory. */
RN_EXPORT(rn_init)
int rn_init(int tt_bits)
{
    i64 ply;
    i64 i;
    i64 rows;

    if (tt_bits < 1 || tt_bits > 27)            /* 2^27 rows * 16 bytes = 2 GiB */
        return 1;

    init_tables();

    rn_memset(bb, 0, sizeof bb);
    for (ply = 0; ply < MAXPLY; ply++) {
        for (i = 0; i < 4; i++)
            bb[IX_BB(ply, MBX + i)] = FULL;
    }
    rn_memset(st, 0, sizeof st);
    rn_memset(key, 0, sizeof key);
    rn_memset(buf, 0, sizeof buf);
    rn_memset(sbuf, 0, sizeof sbuf);
    rn_memset(killers, 0, sizeof killers);
    rn_memset(history, 0, sizeof history);
    rn_memset(quiets, 0, sizeof quiets);
    rn_memset(ss, 0, sizeof ss);
    rn_memset(conth, 0, sizeof conth);
    rn_memset(corr, 0, sizeof corr);
    rn_memset(info, 0, sizeof info);
    rn_memset(out, 0, sizeof out);
    rn_memset(acc, 0, sizeof acc);
    rn_memset(game_keys, 0, sizeof game_keys);
    n_game = 0;
    moves_played = 0;
    last_fullmove = 0;
    increment_est = -1.0;
    prev_left = -1.0;
    prev_elapsed = 0.0;
    overshoot = 1.3;
    clock_left_ms = 0.0;
    rn_memset(move_list, 0, sizeof move_list);

    rows = (i64)1 << tt_bits;
    if (tt == NULL || rows != tt_size) {
#ifndef __wasm__
        if (tt != NULL)
            free(tt);
#endif
        tt = NULL;
        tt_size = 0;
        tt_mask = 0;
        tt = (u64 *)plat_alloc((size_t)rows * 2 * sizeof(u64));
        if (tt == NULL)
            return 2;
        tt_size = rows;
        tt_mask = (u64)rows - U1;
    }
    for (i = 0; i < tt_size; i++) {
        tt[IX_TT(i, TT_KEY)] = U0;
        tt[IX_TT(i, TT_ENTRY)] = TT_EMPTY;
    }
    return 0;
}

/* Where the caller must copy the weight file. NULL if nbytes <= 0 or out of memory. */
RN_EXPORT(rn_net_buffer)
u8 *rn_net_buffer(int nbytes)
{
    if (nbytes <= 0)
        return NULL;
    if (net_buf == NULL || (size_t)nbytes > net_cap) {
#ifndef __wasm__
        if (net_buf != NULL)
            free(net_buf);
#endif
        net_cap = 0;
        net_len = 0;
        net_buf = (u8 *)plat_alloc((size_t)nbytes);
        if (net_buf == NULL)
            return NULL;
        net_cap = (size_t)nbytes;
    }
    net_len = (size_t)nbytes;
    return net_buf;
}

/* little-endian u32 at byte offset `at` of the weight buffer */
static u32 net_u32(size_t at)
{
    return (u32)net_buf[at] | ((u32)net_buf[at + 1] << 8) | ((u32)net_buf[at + 2] << 16)
         | ((u32)net_buf[at + 3] << 24);
}

/* Weight file (PORTING.md): "RNET", u32 version = 1, u32 l1, u32 n_buckets, f32 scale, then
 * w1 f32[768 * L1], b1 f32[L1], w2 f32[N_BUCKETS * 2 * L1], b2 f32[N_BUCKETS]; little-endian.
 * The f32 arrays are handed to nnue.c in place: the buffer is 8-byte aligned and the arrays
 * start at byte 20, and both targets (wasm, x86/arm natively) are little-endian.
 * Returns 0 = ok, 1 = no buffer / too short, 2 = bad magic, 3 = bad version,
 * 4 = l1 or n_buckets differ from the build. */
RN_EXPORT(rn_net_load)
int rn_net_load(void)
{
    const size_t header = 20;
    const size_t n_w1 = (size_t)N_FEATURES * L1;
    const size_t n_b1 = (size_t)L1;
    const size_t n_w2 = (size_t)N_BUCKETS * 2 * L1;
    const size_t n_b2 = (size_t)N_BUCKETS;
    const size_t need = header + 4 * (n_w1 + n_b1 + n_w2 + n_b2);
    u32 scale_bits;
    float scale;
    const float *w1;
    const float *b1;
    const float *w2;
    const float *b2;

    if (net_buf == NULL || net_len < need)
        return 1;
    if (net_buf[0] != 'R' || net_buf[1] != 'N' || net_buf[2] != 'E' || net_buf[3] != 'T')
        return 2;
    if (net_u32(4) != 1)
        return 3;
    if (net_u32(8) != (u32)L1 || net_u32(12) != (u32)N_BUCKETS)
        return 4;
    scale_bits = net_u32(16);
    rn_memcpy(&scale, &scale_bits, sizeof scale);

    w1 = (const float *)(const void *)(net_buf + header);
    b1 = w1 + n_w1;
    w2 = b1 + n_b1;
    b2 = w2 + n_w2;
    nnue_set_weights(w1, b1, w2, b2, scale);
    return 0;
}

/* agent._reset_game, plus the two lines the reference generator (tools/gen_golden.py) adds
 * to start a game from a clean slate: _LAST_FULLMOVE = 0 and _INCREMENT_EST = -1.0.
 * Neither can change a fixed-depth result; they only matter for clocked play. */
RN_EXPORT(rn_new_game)
void rn_new_game(void)
{
    _reset_game();
    last_fullmove = 0;
    increment_est = -1.0;
}

RN_EXPORT(rn_fen_buffer)
char *rn_fen_buffer(void)
{
    return fen_buf;
}

/* Not in the original: the door check for positions that arrive from outside.
   set_fen accepts any number of pieces, and a board with dozens of queens can produce
   more than MAX_MOVES moves, which would overrun the move buffers. A position from a
   real game has one king and at most 16 men and 8 pawns a side, so nothing that can
   be played is refused, and the engine's behaviour is unchanged. 0 = ok. */
static int load_fen(void)
{
    const u64 *row;
    fen_buf[RN_FEN_MAX - 1] = '\0';
    if (set_fen(bb, st, key, fen_buf) != 0)
        return 1;
    row = BB_ROW(bb, 0);
    if (popcount(row[WK]) != 1 || popcount(row[BK]) != 1)
        return 1;
    if (popcount(row[OCC_W]) > 16 || popcount(row[OCC_B]) > 16)
        return 1;
    if (popcount(row[WP]) > 8 || popcount(row[BP]) > 8)
        return 1;
    return 0;
}

/* set_fen(_BB, _ST, _KEY, fen) from the buffer. 0 = ok. */
RN_EXPORT(rn_set_fen)
int rn_set_fen(void)
{
    return load_fen();
}

/* get_move's time_left_ms argument for the _budget_ms path. The Python receives an int:
 * the value is truncated toward zero here, as int() would. */
RN_EXPORT(rn_set_clock)
void rn_set_clock(double time_left_ms)
{
    if (!(time_left_ms == time_left_ms))        /* NaN */
        time_left_ms = 0.0;
    if (time_left_ms > 9.0e15)
        time_left_ms = 9.0e15;
    if (time_left_ms < -9.0e15)
        time_left_ms = -9.0e15;
    clock_left_ms = (double)(i64)time_left_ms;
}

/* agent.py:202 get_move -- the core, for the FEN in the buffer. Returns the move or 0.
 *
 * soft_ms >= 0: soft_ms / hard_ms are used as given (the forced-move rule still overrides
 *               them) and the clock bookkeeping that needs time_left_ms is skipped.
 * soft_ms <  0: the original path: time_left_ms comes from rn_set_clock, the increment is
 *               measured and both budgets come from _budget_ms.
 * max_depth plays the part of _FIXED_DEPTH (CG_FIXED_DEPTH): 0 or less = MAX_PLY - 2.
 *
 * Left out: the deferred numba compile (agent.py:205-214) and the stderr prints. Every
 * `return _fallback(fen)` of the Python (including the blanket `except`) is `return 0`. */
RN_EXPORT(rn_go)
int rn_go(double soft_ms, double hard_ms, int max_depth)
{
    const int use_budget = (soft_ms < 0.0);
    double time_left_ms = clock_left_ms;
    i64 fullmove;
    double observed;
    i64 pieces_left;
    double b_soft;
    double b_hard;
    i64 n_legal;
    i64 n_all;
    i64 n_root;
    i64 i;
    double start;
    i64 move;
    int generated;
    double elapsed;
    double ratio;

    fen_buf[RN_FEN_MAX - 1] = '\0';

    /* A fullmove number that went backwards means this is a different game. */
    if (parse_fullmove(fen_buf, &fullmove) != 0)
        return 0;                               /* int() raised -> except -> _fallback */
    if (fullmove < last_fullmove)
        _reset_game();
    last_fullmove = fullmove;

    /* The referee gives back the increment after our move, so
     *   now = previous_left - what_we_spent + increment
     * Keep the smallest observation: underestimating the increment is safe, over is not.
     * (Only on the _budget_ms path: without a clock there is nothing to observe. On the
     * other path prev_left is kept at -1, see the bookkeeping below.) */
    if (use_budget && prev_left >= 0.0) {
        observed = prev_left - prev_elapsed;
        observed = time_left_ms - observed;
        if (0.0 <= observed && observed <= 10000.0) {
            if (increment_est < 0.0)
                increment_est = observed;
            else
                increment_est = (observed < increment_est) ? observed : increment_est;
        }
    }

    if (load_fen() != 0)
        return 0;                               /* set_fen raised -> except -> _fallback */
    _remember(key[0]);

    pieces_left = count_pieces(fen_buf);
    if (use_budget) {
        _budget_ms(time_left_ms, pieces_left, fullmove, &b_soft, &b_hard);
        soft_ms = b_soft;
        hard_ms = b_hard;
    }
    /* A forced move (one legal reply) needs no search time at all; a depth-4 look is enough
     * to keep the table warm, and the seconds stay on the clock for moves that matter. */
    n_legal = 0;
    n_all = gen_moves(BB_ROW(bb, 0), ST_ROW(st, 0), BUF_ROW(buf, 0));
    for (i = 0; i < n_all; i++) {
        if (make_move(bb, st, key, 0, buf[IX_BUF(0, i)])) {
            n_legal += 1;
            if (n_legal > 1)
                break;
        }
    }
    if (n_legal == 1) {
        soft_ms = (double)MIN_THINK_MS;
        hard_ms = (double)MIN_THINK_MS;
    }
    start = clock_now();
    info[0] = 0;
    info[1] = 0;
    rn_memset(killers, 0, sizeof killers);      /* _KILLERS[:, :] = 0 */
    /* age history, do not erase: last move's ordering knowledge is still good.
     * _HISTORY[:, :, :] //= 2 is FLOOR division and entries can be negative: -3 // 2 == -2. */
    for (i = 0; i < 2 * 64 * 64; i++)
        history[i] = floordiv(history[i], 2);

    search_root(n_game,
                (max_depth > 0) ? (i64)max_depth : (i64)(MAX_PLY - 2),
                start + hard_ms / 1000.0,
                start + soft_ms / 1000.0);

    move = out[0];
    if (move == 0)
        return 0;                               /* _fallback: mate, stalemate or no result */

    /* search_root takes its answer from the transposition table, so a 64-bit Zobrist
     * collision at the root would hand back a move belonging to a different position.
     * make_move below only verifies that our king is not left in check. So first require
     * the move to be one this position actually generates. */
    n_root = gen_moves(BB_ROW(bb, 0), ST_ROW(st, 0), BUF_ROW(buf, 0));
    generated = 0;
    for (i = 0; i < n_root; i++) {
        if (buf[IX_BUF(0, i)] == move) {
            generated = 1;
            break;
        }
    }
    if (!generated)
        return 0;                               /* "is not a move here" -> _fallback */

    /* Play it on our own board before returning it. This records the position our move
     * creates, so the repetition history stays gap-free -- and it is also the last check
     * that the move is legal at all (self-check). */
    if (!make_move(bb, st, key, 0, move))
        return 0;                               /* "is illegal" -> _fallback */
    _remember(key[1]);
    moves_played += 1;

    elapsed = clock_now() - start;
    elapsed = elapsed * 1000.0;
    prev_left = use_budget ? time_left_ms : -1.0;
    prev_elapsed = elapsed;
    /* update the overshoot estimate from this move (only when the search really ran) */
    if (n_legal > 1 && soft_ms > 50.0) {
        ratio = elapsed / soft_ms;
        if (ratio < 1.1)
            ratio = 1.1;
        else if (ratio > 1.6)
            ratio = 1.6;
        overshoot = 0.7 * overshoot + 0.3 * ratio;
    }
    return (int)move;
}

/* cg_position.move_to_uci into a static buffer, e.g. "e7e8q". */
RN_EXPORT(rn_move_uci)
char *rn_move_uci(i64 move)
{
    rn_memset(uci_buf, 0, sizeof uci_buf);
    move_to_uci(move, uci_buf);
    return uci_buf;
}

/* RN_INFO_*: 0 nodes, 1 depth reached, 2 score, 3 best move, 4 static eval of the current
 * root (acc_root + evaluate, as tools/gen_golden.py does), 5 in check. The "current root"
 * is ply 0, which rn_go leaves untouched (make_move writes ply 1). */
RN_EXPORT(rn_info)
i64 rn_info(int what)
{
    switch (what) {
    case RN_INFO_NODES:
        return info[0];
    case RN_INFO_DEPTH:
        return out[2];
    case RN_INFO_SCORE:
        return out[1];
    case RN_INFO_MOVE:
        return out[0];
    case RN_INFO_EVAL:
        acc_root(ACC_ROW(acc, 0), BB_ROW(bb, 0));
        return evaluate(BB_ROW(bb, 0), st[IX_ST(0, ST_SIDE)], ACC_ROW(acc, 0));
    case RN_INFO_IN_CHECK:
        return in_check(BB_ROW(bb, 0), st[IX_ST(0, ST_SIDE)]) ? 1 : 0;
    default:
        return 0;
    }
}

/* Legal moves of the current root, in generation order, into move_list. */
RN_EXPORT(rn_gen_legal)
int rn_gen_legal(void)
{
    i64 n = gen_moves(BB_ROW(bb, 0), ST_ROW(st, 0), BUF_ROW(buf, 0));
    i64 n_legal = 0;
    i64 i;
    for (i = 0; i < n; i++) {
        if (make_move(bb, st, key, 0, buf[IX_BUF(0, i)])) {
            move_list[n_legal] = buf[IX_BUF(0, i)];
            n_legal += 1;
        }
    }
    return (int)n_legal;
}

RN_EXPORT(rn_move_list)
i64 *rn_move_list(void)
{
    return move_list;
}

/* gen_moves output of the current root, unfiltered, into move_list. */
RN_EXPORT(rn_gen_pseudo)
int rn_gen_pseudo(void)
{
    return (int)gen_moves(BB_ROW(bb, 0), ST_ROW(st, 0), move_list);
}

/* tools/gen_golden.py perft: gen_moves + make_move, one buf row per ply. */
static u64 perft(i64 ply, i64 depth)
{
    i64 n = gen_moves(BB_ROW(bb, ply), ST_ROW(st, ply), BUF_ROW(buf, ply));
    u64 total = 0;
    i64 i;
    for (i = 0; i < n; i++) {
        if (make_move(bb, st, key, ply, buf[IX_BUF(ply, i)]))
            total += (depth == 1) ? (u64)1 : perft(ply + 1, depth - 1);
    }
    return total;
}

/* Leaf count from the current root. depth <= 0 counts the root itself (1); a depth that
 * does not fit the MAXPLY-high arrays returns 0. */
RN_EXPORT(rn_perft)
u64 rn_perft(int depth)
{
    if (depth <= 0)
        return 1;
    if (depth > MAXPLY - 1)
        return 0;
    return perft(0, (i64)depth);
}

/* Forget the game's position history (for take-backs and set-up positions): the caller
 * then feeds the positions again with rn_history_push_fen. last_fullmove is cleared as
 * well, otherwise the next rn_go on an EARLIER fullmove number would take the rewound game
 * for a new one, call _reset_game and throw away the history that was just rebuilt. */
RN_EXPORT(rn_history_clear)
void rn_history_clear(void)
{
    n_game = 0;
    last_fullmove = 0;
}

/* set_fen from the buffer, then _remember(key[0]). 0 = ok. */
RN_EXPORT(rn_history_push_fen)
int rn_history_push_fen(void)
{
    if (load_fen() != 0)
        return 1;
    _remember(key[0]);
    return 0;
}
