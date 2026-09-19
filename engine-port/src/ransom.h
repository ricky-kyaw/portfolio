/* ransom.h -- the one shared header of the C port of the Ransom chess engine.
 *
 * Read PORTING.md first. This header is the contract between the C files:
 *
 *   C file       ports (Python module)              what it holds
 *   ---------    -------------------------------    ------------------------------------------
 *   tables.c     cg_tables.py                       attack tables, magics, Zobrist keys, signed
 *                                                   piece-square tables, init_tables()
 *   position.c   cg_position.py                     attacked, in_check, see_ge, make_move,
 *                                                   make_null, compute_key, set_fen, move_to_uci
 *                                                   (not ray_attack, see_value, new_state)
 *   movegen.c    cg_movegen.py                      gen_moves, gen_captures and their helpers
 *   nnue.c       cg_nnue.py + cg_eval.py            the inference path only: acc_root, acc_push,
 *                + cg_hce.py (is_insufficient)      acc_copy, evaluate, evaluate_inc, _bucket,
 *                                                   refresh_colour, apply_diff_serial,
 *                                                   forward_colour; the weights W1 B1 W2 B2 SCALE
 *   search.c     cg_search.py                       all of it (LMR table is private to search.c)
 *   api.c        agent.py                           the engine-state globals, _reset_game,
 *                                                   _budget_ms, _remember, the core of get_move,
 *                                                   the rn_* API, the platform layer,
 *                                                   rn_memcpy / rn_memset
 *
 * Rules of this header:
 *   - Every constant defined here must NOT be defined again in a .c file. Constants that only
 *     one module reads (RANK3, CASTLE_WK_EMPTY, CONT_MAX_BONUS, CORR_GRAIN, CM_P, SS_NONE,
 *     BASE_MS, ...) are NOT here: define them in that .c file, named as in the Python.
 *   - Every function prototyped here is called from another file and must be defined
 *     non-static in the file it is listed under, with exactly this signature. Every function
 *     that is NOT listed here is private to its file: make it `static`.
 *   - The Python helpers marked inline="always" that several files call (lsb, bishop_attacks,
 *     rook_attacks, mk_move, piece_on_any, piece_on) are `static inline` HERE, because the
 *     build has no link-time optimisation and they sit in the hottest loops. position.c must
 *     not define them again.
 *   - Nothing but <stdint.h> and <stddef.h> is included (PORTING.md rule 5).
 */
#ifndef RANSOM_H
#define RANSOM_H

#include <stdint.h>
#include <stddef.h>

/* ===================================================================================== */
/* 1. Types and arithmetic helpers                                                       */
/* ===================================================================================== */

typedef uint8_t  u8;
typedef int16_t  i16;   /* conth is numpy int16 */
typedef uint32_t u32;
typedef int32_t  i32;
typedef uint64_t u64;
typedef int64_t  i64;

/* Python `a // b`: rounds toward minus infinity. b must not be 0. */
static inline i64 floordiv(i64 a, i64 b)
{
    i64 q = a / b;
    i64 r = a % b;
    if (r != 0 && ((r < 0) != (b < 0)))
        q -= 1;
    return q;
}

/* Python `a % b`: the result has the sign of b. b must not be 0. */
static inline i64 pymod(i64 a, i64 b)
{
    i64 r = a % b;
    if (r != 0 && ((r < 0) != (b < 0)))
        r += b;
    return r;
}

/* Named i64_* and not min/max/abs on purpose: the native build of api.c includes <stdlib.h>,
 * where mingw defines min and max as MACROS and every libc declares abs(int). */
static inline i64 i64_min(i64 a, i64 b) { return a < b ? a : b; }
static inline i64 i64_max(i64 a, i64 b) { return a > b ? a : b; }
static inline i64 i64_abs(i64 a)        { return a < 0 ? -a : a; }

/* ===================================================================================== */
/* 2. Constants (values and names from the Python)                                       */
/* ===================================================================================== */

/* ---- cg_tables.py:14-23  piece indices and the layout of one bb row ---- */
enum {
    WP = 0, WN = 1, WB = 2, WR = 3, WQ = 4, WK = 5,
    BP = 6, BN = 7, BB = 8, BR = 9, BQ = 10, BK = 11,
    OCC_W = 12,     /* white occupancy                                   */
    OCC_B = 13,     /* black occupancy                                   */
    MBX   = 14,     /* first of four mailbox words (16 nibbles each; 15 = empty square) */
    NBB   = 18      /* length of one bb row                              */
};

/* ---- cg_tables.py:25-37 and cg_position.py:65  uint64 scalars ---- */
#define U1            ((u64)1)
#define U0            ((u64)0)
#define FULL          0xFFFFFFFFFFFFFFFFULL
#define DARK_SQUARES  0xAA55AA55AA55AA55ULL     /* a1 is dark */
#define LIGHT_SQUARES 0x55AA55AA55AA55AAULL
#define DEBRUIJN      0x03F79D71B4CB0A89ULL
/* cg_tables.py:108. A scalar, so a macro here; tables.c must not define it again. */
#define ZOB_SIDE      0xA0B60762ECD05DD6ULL

/* ---- cg_position.py:66 and cg_search.py:58. Two DIFFERENT constants, do not merge. ---- */
#define MAXPLY   128    /* height of bb, st, key, buf, sbuf, acc                */
#define MAX_PLY  100    /* search depth limit; killers/quiets/ss are sized from it */

/* ---- state row st[ply]: int64[7] (cg_position.py:9, :463). The Python writes the bare
 *      numbers 0..6; the names are for readability only. ---- */
#define ST_SIDE      0   /* side to move: 0 white, 1 black      */
#define ST_CASTLE    1   /* castling rights, bits below         */
#define ST_EP        2   /* en-passant square, -1 for none      */
#define ST_HALFMOVE  3   /* halfmove clock                      */
#define ST_MG        4   /* incremental middlegame sum (kept, unused by the shipped eval) */
#define ST_EG        5   /* incremental endgame sum                                        */
#define ST_PHASE     6   /* incremental game phase                                         */
#define ST_COLS      7

/* ---- castling-right bits of st[ply][1] (cg_position.py:502) ---- */
#define CASTLE_WK  1
#define CASTLE_WQ  2
#define CASTLE_BK  4
#define CASTLE_BQ  8

/* ---- move encoding, int64 (cg_position.py:12-14, :148, :311-314):
 *      bits 0-5 from | 6-11 to | 12-15 promotion | 16-18 flag. Move 0 means "no move".
 *      The Python writes these shifts and masks as bare numbers. ---- */
#define MOVE_TO_SHIFT     6
#define MOVE_PROMO_SHIFT  12
#define MOVE_FLAG_SHIFT   16
#define MOVE_SQ_MASK      63
#define MOVE_PROMO_MASK   15
#define MOVE_FLAG_MASK    7
#define MOVE_FROM(m)   ((i64)(m) & 63)
#define MOVE_TO(m)     (((i64)(m) >> 6) & 63)
#define MOVE_PROMO(m)  (((i64)(m) >> 12) & 15)
#define MOVE_FLAG(m)   (((i64)(m) >> 16) & 7)
#define PROMO_NONE   0
#define PROMO_N      1
#define PROMO_B      2
#define PROMO_R      3
#define PROMO_Q      4
#define FLAG_NORMAL  0
#define FLAG_DOUBLE  1   /* double pawn push */
#define FLAG_EP      2   /* en passant       */
#define FLAG_CASTLE  3
#define MAX_MOVES    256 /* width of one buf / sbuf row (agent.py:67) */

/* ---- cg_search.py:36-58  scores and the transposition table ---- */
#define MATE         30000
#define MATE_IN_MAX  (MATE - 1000)
#define INF          (1 << 20)

/* TT_BITS is the ORIGINAL's size and the default. In C the size is chosen at rn_init, so
 * TT_SIZE and TT_MASK read the run-time variables tt_size / tt_mask (defined in api.c).
 * Fixed-depth fidelity tests must run with 22 bits or node counts will differ. */
#define TT_BITS      22
#define TT_SIZE      tt_size
#define TT_MASK      tt_mask
#define BOUND_EXACT  0
#define BOUND_LOWER  1
#define BOUND_UPPER  2
#define TT_SH_SCORE  ((u64)32)
#define TT_SH_DEPTH  ((u64)48)
#define TT_SH_BOUND  ((u64)56)
#define TT_M32       ((u64)0xFFFFFFFFULL)
#define TT_M16       ((u64)0xFFFFULL)
#define TT_M8        ((u64)0xFFULL)
#define TT_EMPTY     (TT_M8 << TT_SH_DEPTH)      /* 0x00FF000000000000: depth decodes to -1 */
#define TT_KEY       0   /* tt row column 0: full Zobrist key  */
#define TT_ENTRY     1   /* tt row column 1: packed entry      */

/* ---- cg_search.py:67, :75  table dimensions api.c needs to define conth and corr ---- */
#define CONT_N       384                 /* 6 piece types * 64 squares */
#define CORR_BITS    14
#define CORR_SIZE    (1 << CORR_BITS)

/* ---- search stack ss[ply]: int64[4] (cg_search.py:155-158, :541, :745) ---- */
#define SS_STATIC     0   /* static eval, or SS_NONE (search.c) when in check          */
#define SS_CONT       1   /* continuation index of the move made at this ply, or -1    */
#define SS_ROOT_MOVE  3   /* only ss[0][3]: previous iteration's best root move        */
#define SS_COLS       4

/* ---- info: int64[4] and out: int64[4] (cg_search.py:437-440, :691, :797-799) ---- */
#define INFO_NODES       0
#define INFO_ABORT       1
#define INFO_ROOT_MOVE   2
#define INFO_ROOT_SCORE  3
#define OUT_MOVE         0
#define OUT_SCORE        1
#define OUT_DEPTH        2

/* ---- cg_nnue.py:35-38, cg_eval.py:32, :47  the network ---- */
#define L1           256                 /* hidden width; agent.py reads it from net.npz */
#define N_BUCKETS    8
#define N_FEATURES   768                 /* rows of W1: 12 piece slots * 64 squares      */
#define EVAL_LIMIT   3000
#define EVAL_MULT    1.619               /* double, as the Python float literal          */

/* ---- agent.py:87 ---- */
#define GAME_KEYS_MAX  1024              /* _GAME_KEYS.shape[0] */

/* ===================================================================================== */
/* 3. Index macros: a[i, j, k] is a[(i * D1 + j) * D2 + k]  (PORTING.md rule 4)          */
/*    Each IX_* macro yields the FLAT INDEX, so it works on a global and on a pointer    */
/*    parameter alike:  bb[IX_BB(ply, WK)],  st[IX_ST(ply + 1, ST_EP)].                  */
/*    Each *_ROW macro yields a POINTER to a row of the base pointer it is given.        */
/* ===================================================================================== */

/* engine state */
#define IX_BB(ply, i)             ((ply) * NBB + (i))                      /* bb      [MAXPLY][NBB]        */
#define IX_ST(ply, c)             ((ply) * ST_COLS + (c))                  /* st      [MAXPLY][7]          */
#define IX_BUF(ply, i)            ((ply) * MAX_MOVES + (i))                /* buf,sbuf[MAXPLY][256]        */
#define IX_TT(i, c)               ((i) * 2 + (c))                          /* tt      [TT_SIZE][2]         */
#define IX_KILLERS(ply, s)        ((ply) * 2 + (s))                        /* killers [MAX_PLY+2][2]       */
#define IX_HISTORY(side, f, t)    (((side) * 64 + (f)) * 64 + (t))         /* history [2][64][64]          */
#define IX_QUIETS(ply, j)         ((ply) * 64 + (j))                       /* quiets  [MAX_PLY+2][64]      */
#define IX_SS(ply, c)             ((ply) * SS_COLS + (c))                  /* ss      [MAX_PLY+4][4]       */
#define IX_CONTH(k, p, idx)       (((k) * CONT_N + (p)) * CONT_N + (idx))  /* conth   [2][384][384]        */
#define IX_CORR(t, side, idx)     (((t) * 2 + (side)) * CORR_SIZE + (idx)) /* corr    [3][2][CORR_SIZE]    */
#define IX_ACC(ply, c, i)         (((ply) * 2 + (c)) * L1 + (i))           /* acc     [MAXPLY][2][L1]      */
#define IX_ACC_ROW(c, i)          ((c) * L1 + (i))                         /* one acc[ply]: [2][L1]        */

#define BB_ROW(bb_, ply)          ((bb_) + (ply) * NBB)
#define ST_ROW(st_, ply)          ((st_) + (ply) * ST_COLS)
#define BUF_ROW(buf_, ply)        ((buf_) + (ply) * MAX_MOVES)
#define ACC_ROW(acc_, ply)        ((acc_) + (ply) * 2 * L1)

/* network weights */
#define IX_W1(f, i)               ((f) * L1 + (i))                         /* W1 [768][L1]                 */
#define IX_W2(b, i)               ((b) * (2 * L1) + (i))                   /* W2 [N_BUCKETS][2*L1]         */

/* tables */
#define IX_PAWN_ATT(c, sq)        ((c) * 64 + (sq))                        /* PAWN_ATT  [2][64]            */
#define IX_ZOB_PIECE(p, sq)       ((p) * 64 + (sq))                        /* ZOB_PIECE [12][64]           */
#define IX_PSQ(p, sq)             ((p) * 64 + (sq))                        /* MG_SIGNED, EG_SIGNED [12][64] */

/* ===================================================================================== */
/* 4. Tables. DEFINED in tables.c.                                                       */
/*    `const` tables carry a static initialiser (values in spec/cg_tables_ref.h and      */
/*    cg_tables_ref.json). The others are filled by init_tables(), or may be given a     */
/*    static initialiser too, but must then be defined WITHOUT const to match.           */
/*    Element types are the numpy dtypes. RAYS, MG_TABLE, EG_TABLE and the hand-crafted- */
/*    eval tables are not read outside tables.c and are not declared here.               */
/* ===================================================================================== */

extern const i64 DEBRUIJN_IDX[64];        /* int64  cg_tables.py:38  */

extern u64 KNIGHT_ATT[64];                /* uint64 cg_tables.py:83  */
extern u64 KING_ATT[64];                  /* uint64                  */
extern u64 PAWN_ATT[2 * 64];              /* uint64 [colour][sq]: squares a pawn of that colour on sq attacks */

extern u64       R_MASK[64];              /* uint64 cg_tables.py:92-101 */
extern const u64 R_MAGIC[64];             /* uint64 */
extern u64       R_SHIFT[64];             /* uint64 (52..54) */
extern i64       R_OFF[64];               /* int64  */
extern u64       R_TABLE[102400];         /* uint64 */
extern u64       B_MASK[64];              /* uint64 */
extern const u64 B_MAGIC[64];             /* uint64 */
extern u64       B_SHIFT[64];             /* uint64 (55..59) */
extern i64       B_OFF[64];               /* int64  */
extern u64       B_TABLE[5248];           /* uint64 */

extern const u64 ZOB_PIECE[12 * 64];      /* uint64 [piece][sq] cg_tables.py:105 */
extern const u64 ZOB_CASTLE[16];          /* uint64 */
extern const u64 ZOB_EP[8];               /* uint64, indexed by FILE of the ep square */

extern i64 CASTLE_MASK[64];               /* int64  cg_tables.py:111 */
extern i64 MG_SIGNED[12 * 64];            /* int64  [piece][sq] cg_tables.py:268 (white +, black -) */
extern i64 EG_SIGNED[12 * 64];            /* int64  */
extern const i32 PHASE_INC[12];           /* int32  cg_tables.py:277 */
extern const i32 SEE_VALUE[6];            /* int32  cg_tables.py:280; mixed with int64 it widens to i64 */

/* ===================================================================================== */
/* 5. Engine state. ALL of these are DEFINED in api.c (they are agent.py's module        */
/*    globals, agent.py:66-88). position.c, movegen.c and nnue.c never touch them: they  */
/*    work on the pointers they are handed. search.c reads them directly.                */
/*    (The only search array that is NOT here is LMR[64][64]: static const in search.c.) */
/*    rn_init must set bb[ply][MBX .. MBX+3] = FULL for EVERY ply, as new_state() does,  */
/*    and tt[i][1] = TT_EMPTY for every row, as new_tt() does. Everything else is zero.  */
/* ===================================================================================== */

extern u64   bb[MAXPLY * NBB];                 /* _BB        uint64 (128, 18)      */
extern i64   st[MAXPLY * ST_COLS];             /* _ST        int64  (128, 7)       */
extern u64   key[MAXPLY];                      /* _KEY       uint64 (128,)         */
extern i64   buf[MAXPLY * MAX_MOVES];          /* _BUF       int64  (128, 256)     */
extern i64   sbuf[MAXPLY * MAX_MOVES];         /* _SBUF      int64  (128, 256)     */
extern u64  *tt;                               /* _TT        uint64 (TT_SIZE, 2); plat_alloc'ed in rn_init */
extern i64   tt_size;                          /*            rows in tt = 1 << tt_bits (TT_SIZE)           */
extern u64   tt_mask;                          /*            tt_size - 1              (TT_MASK)            */
extern i64   killers[(MAX_PLY + 2) * 2];       /* _KILLERS   int64  (102, 2)       */
extern i64   history[2 * 64 * 64];             /* _HISTORY   int64  (2, 64, 64)    */
extern i64   quiets[(MAX_PLY + 2) * 64];       /* _QUIETS    int64  (102, 64)      */
extern i64   ss[(MAX_PLY + 4) * SS_COLS];      /* _SS        int64  (104, 4)       */
extern i16   conth[2 * CONT_N * CONT_N];       /* _CONTH     int16  (2, 384, 384)  */
extern i32   corr[3 * 2 * CORR_SIZE];          /* _CORR      int32  (3, 2, 16384)  */
extern i64   info[4];                          /* _INFO      int64  (4,)           */
extern i64   out[4];                           /* _OUT       int64  (4,)           */
extern float acc[MAXPLY * 2 * L1];             /* _ACC       float32 (128, 2, 256) */
extern u64   game_keys[GAME_KEYS_MAX];         /* _GAME_KEYS uint64 (1024,)        */
extern i64   n_game;                           /* _N_GAME                          */

/* ===================================================================================== */
/* 6. Network weights. DEFINED in nnue.c (cg_eval.py:32, cg_nnue.py:41-61).              */
/*    W1, B1, W2 are float32. B2 is DOUBLE: load() widens it to float64 on purpose, so   */
/*    `s + b2[bucket]` is a float64 add. SCALE is DOUBLE and already includes EVAL_MULT: */
/*    SCALE = (double)scale_from_file * EVAL_MULT   (400.0 * 1.619 for the shipped net). */
/* ===================================================================================== */

extern float  W1[N_FEATURES * L1];        /* float32 (768, 256) row-major          */
extern float  B1[L1];                     /* float32 (256,)                        */
extern float  W2[N_BUCKETS * 2 * L1];     /* float32 (8, 512)                      */
extern double B2[N_BUCKETS];              /* float64 (8,)  exact widening of the file's f32 */
extern double SCALE;                      /* float64       cg_eval.py:48           */

/* Called by rn_net_load in api.c after it has checked the file header ("RNET", version 1,
 * l1 == L1, n_buckets == N_BUCKETS). The pointers point INTO the weight-file buffer, which
 * is 4-byte aligned (w1 starts at byte 20). Copies w1/b1/w2, widens b2 to double, and sets
 * SCALE = (double)scale * EVAL_MULT, in double, exactly as cg_eval.py:48 does. */
void nnue_set_weights(const float *w1, const float *b1, const float *w2, const float *b2,
                      float scale);

/* ===================================================================================== */
/* 7. Functions called across files, grouped by the file that DEFINES them.              */
/*    Parameter naming: `bb_row`, `st_row`, `acc_row` = pointer to ONE row (bb[ply]);    */
/*    `bb`, `st`, `key`, `acc` = base pointer of the WHOLE array. Booleans are int 0/1.  */
/*    Squares, pieces, sides, plies, counts, moves and scores are i64, as in numba.      */
/* ===================================================================================== */

/* ------------------------------------------------------------------ tables.c --------- */

/* Fills every non-const table of section 4 (leapers, masks, shifts, offsets, slider
 * tables rebuilt from the magics, CASTLE_MASK, MG_SIGNED, EG_SIGNED). Called once, first
 * thing in rn_init. Must be safe to call twice. */
void init_tables(void);

/* ------------------------------------------------------------------ position.c ------- */

/* The inline="always" helpers of cg_position.py that other files call. Defined HERE. */

/* cg_position.py:70 lsb. lsb(0) returns DEBRUIJN_IDX[0] = 0, as the original does. */
static inline i64 lsb(u64 b)
{
    return DEBRUIJN_IDX[((b & (FULL - b + U1)) * DEBRUIJN) >> (u64)58];
}

/* cg_position.py:107 bishop_attacks */
static inline u64 bishop_attacks(i64 sq, u64 occ)
{
    return B_TABLE[B_OFF[sq] + (i64)(((occ & B_MASK[sq]) * B_MAGIC[sq]) >> B_SHIFT[sq])];
}

/* cg_position.py:114 rook_attacks */
static inline u64 rook_attacks(i64 sq, u64 occ)
{
    return R_TABLE[R_OFF[sq] + (i64)(((occ & R_MASK[sq]) * R_MAGIC[sq]) >> R_SHIFT[sq])];
}

/* cg_position.py:148 mk_move */
static inline i64 mk_move(i64 frm, i64 to, i64 promo, i64 flag)
{
    return frm | (to << 6) | (promo << 12) | (flag << 16);
}

/* cg_position.py:168 piece_on_any: piece index 0..11 on sq, or -1. bb_row is one row. */
static inline i64 piece_on_any(const u64 *bb_row, i64 sq)
{
    i64 p = (i64)((bb_row[MBX + (sq >> 4)] >> (u64)((sq & 15) << 2)) & (u64)15);
    return p == 15 ? -1 : p;
}

/* cg_position.py:175 piece_on: the piece on sq if it lies in [lo, hi), else -1. */
static inline i64 piece_on(const u64 *bb_row, i64 sq, i64 lo, i64 hi)
{
    i64 p = piece_on_any(bb_row, sq);
    return (p >= lo && p < hi) ? p : -1;
}

/* cg_position.py:86 popcount (the while-loop form; called by is_insufficient in nnue.c) */
i64  popcount(u64 b);
/* cg_position.py:119 attacked: is sq attacked by black (by_black != 0) or by white? */
int  attacked(const u64 *bb_row, i64 sq, int by_black);
/* cg_position.py:142 in_check: is `side`'s king attacked? */
int  in_check(const u64 *bb_row, i64 side);
/* cg_position.py:250 see_ge: is the exchange frm x to worth at least threshold? */
int  see_ge(const u64 *bb_row, i64 frm, i64 to, i64 side, i64 threshold);
/* cg_position.py:300 make_move: copy-make ply -> ply + 1 on the WHOLE arrays.
 * Returns 1 if legal, 0 if the mover's king is left in check (row ply + 1 is then garbage). */
int  make_move(u64 *bb, i64 *st, u64 *key, i64 ply, i64 move);
/* cg_position.py:423 make_null */
void make_null(u64 *bb, i64 *st, u64 *key, i64 ply);
/* cg_position.py:441 compute_key: full Zobrist key of row `ply` of the WHOLE arrays. */
u64  compute_key(const u64 *bb, const i64 *st, i64 ply);
/* cg_position.py:474 set_fen: parse a NUL-terminated FEN into ply 0 of the WHOLE arrays.
 * The Python raises on a malformed FEN; C returns 0 = ok, non-zero = malformed (and then
 * ply 0 is unspecified). A missing halfmove field reads as 0, as in the Python. */
int  set_fen(u64 *bb, i64 *st, u64 *key, const char *fen);
/* cg_position.py:527 move_to_uci: writes "e2e4" or "e7e8q" plus NUL into s (>= 6 bytes). */
void move_to_uci(i64 move, char *s);
/* Private to position.c (static): msb, mb_set, mb_clear, attackers_to. */

/* ------------------------------------------------------------------ movegen.c -------- */

/* cg_movegen.py:186 gen_moves: all pseudo-legal moves of one position into moves_out
 * (one buf row, MAX_MOVES long). Returns the count. bb_row = bb[ply], st_row = st[ply]. */
i64  gen_moves(const u64 *bb_row, const i64 *st_row, i64 *moves_out);
/* cg_movegen.py:197 gen_captures: captures and queen promotions (the quiescence set). */
i64  gen_captures(const u64 *bb_row, const i64 *st_row, i64 *moves_out);
/* Private to movegen.c (static): add_promotions, gen_pawn_pushes, gen_pawn_captures,
 * gen_piece_moves, gen_castling -- same parameters as the Python, rows as above. */

/* ------------------------------------------------------------------ nnue.c ----------- */

/* nnue_set_weights is declared in section 6. */

/* cg_eval.py:84 acc_root: rebuild ONE accumulator row from ONE bb row.
 * Called as acc_root(ACC_ROW(acc, 0), BB_ROW(bb, 0)). */
void acc_root(float *acc_row, const u64 *bb_row);
/* cg_eval.py:90 acc_push: carry acc[ply] -> acc[ply + 1] by diffing bb[ply] and bb[ply + 1].
 * WHOLE arrays, in the Python's parameter order (acc, ply, bb). */
void acc_push(float *acc, i64 ply, const u64 *bb);
/* cg_eval.py:157 acc_copy: acc[ply + 1] = acc[ply] (after a null move). WHOLE array. */
void acc_copy(float *acc, i64 ply);
/* cg_eval.py:72 evaluate: network score for the side to move, clamped to +/-EVAL_LIMIT. */
i64  evaluate(const u64 *bb_row, i64 side, const float *acc_row);
/* cg_eval.py:78 evaluate_inc: the same value; st_row is unused but stays in the signature. */
i64  evaluate_inc(const u64 *bb_row, i64 side, const float *acc_row, const i64 *st_row);
/* cg_hce.py:67 is_insufficient: the arbiter's insufficient-material rule. */
int  is_insufficient(const u64 *bb_row);
/* Private to nnue.c (static): _bucket, white_index, black_index, refresh_colour,
 * apply_diff_serial, forward_colour. */

/* ------------------------------------------------------------------ search.c --------- */

/* cg_search.py:162 clock_now: seconds as a double = plat_now_ms() / 1000.0.
 * api.c uses it where agent.py calls time.perf_counter(). */
double clock_now(void);

/* cg_search.py:714 search_root. The twenty array parameters of the Python are the globals
 * of section 5; the scalar parameters stay, in the same order:
 *   Python: search_root(bb, st, key, buf, sbuf, tt, killers, history, quiets, ss, conth, corr,
 *                       game_keys, n_game, max_depth, info, deadline, soft_deadline, acc, out)
 * n_game_ stays a PARAMETER (agent.py passes _N_GAME, the warm-up passed 0); search.c must
 * use the parameter, not the global n_game. Deadlines are absolute clock_now() seconds;
 * fixed-depth tests pass 1e18 for both. Writes out[0..2], returns the best move. Calls
 * plat_on_iteration once per completed depth (PORTING.md rule 8). */
i64  search_root(i64 n_game_, i64 max_depth, double deadline, double soft_deadline);

/* Private to search.c (static), globals read directly, remaining parameters in Python order.
 * Row parameters stay parameters, because a row is not a global:
 *   corr_keys(bb_row, &ip, &iw, &ib)            corr_value(side, ip, iw, ib)
 *   corr_update(side, ip, iw, ib, diff, depth)  tt_pack / tt_move / tt_score / tt_depth / tt_bound
 *   tt_probe(key_, ply, depth, alpha, beta, &hit, &found, &move)
 *   tt_store(key_, ply, depth, score, bound, move)
 *   is_repetition(ply, n_game_)                 cont_index(bb_row, side, mv)
 *   cont_update(k, p, idx, delta)
 *   score_moves(bb_row, st_row, moves, n, scores, tt_move_, p1, p2, ply)
 *   pick_move(moves, scores, n, i)              has_big_pieces(bb_row, side)
 *   lmr_reduce(depth, legal, pv_node, hs, improving)
 *   reward_quiet(side, ply, mv, frm, to, depth, idx, p1, p2)
 *   punish_quiets(bb_row, side, ply, nq, depth, p1, p2)
 *   quiescence(n_game_, ply, alpha, beta, deadline)
 *   negamax(n_game_, ply, depth, alpha, beta, deadline, can_null)
 * (`static` is a C keyword: the Python local of that name in negamax needs another name.) */

/* ------------------------------------------------------------------ api.c ------------ */

/* PORTING.md rule 5: the only memory helpers. Byte loops, defined in api.c. Both return dst. */
void *rn_memcpy(void *dst, const void *src, size_t n);
void *rn_memset(void *dst, int c, size_t n);

/* Platform layer, two implementations chosen by #ifdef __wasm__ in api.c.
 * On wasm plat_now_ms and plat_on_iteration are IMPORTS from module "env"; plat_alloc grows
 * linear memory. Natively: <time.h>, malloc, and a no-op. */
#ifdef __wasm__
#define RN_IMPORT(name) __attribute__((import_module("env"), import_name(#name)))
#define RN_EXPORT(name) __attribute__((export_name(#name)))
#else
#define RN_IMPORT(name)
#define RN_EXPORT(name)
#endif

RN_IMPORT(plat_now_ms)       double plat_now_ms(void);           /* monotonic milliseconds  */
                             void  *plat_alloc(size_t nbytes);   /* 8-byte aligned; contents unspecified, the caller clears. NULL on failure */
RN_IMPORT(plat_on_iteration) void   plat_on_iteration(int depth, i64 score, i64 nodes, i64 move);

/* rn_info(what) selectors */
#define RN_INFO_NODES     0
#define RN_INFO_DEPTH     1
#define RN_INFO_SCORE     2
#define RN_INFO_MOVE      3
#define RN_INFO_EVAL      4   /* evaluate() of the current root      */
#define RN_INFO_IN_CHECK  5   /* 0 / 1                               */

#define RN_FEN_MAX  128       /* size of the rn_fen_buffer() buffer  */

/* The exported API (PORTING.md). On wasm every one of these is exported under its own name. */
RN_EXPORT(rn_init)             int    rn_init(int tt_bits);        /* tables, state, TT of 2^tt_bits rows (original: TT_BITS). 0 = ok */
RN_EXPORT(rn_net_buffer)       u8    *rn_net_buffer(int nbytes);   /* where the caller must copy the weight file */
RN_EXPORT(rn_net_load)         int    rn_net_load(void);           /* parse the buffer, call nnue_set_weights. 0 = ok */
RN_EXPORT(rn_new_game)         void   rn_new_game(void);           /* agent._reset_game */
RN_EXPORT(rn_fen_buffer)       char  *rn_fen_buffer(void);         /* RN_FEN_MAX bytes for a NUL-terminated FEN */
RN_EXPORT(rn_set_fen)          int    rn_set_fen(void);            /* set_fen(bb, st, key, fen buffer). 0 = ok */
RN_EXPORT(rn_go)               int    rn_go(double soft_ms, double hard_ms, int max_depth);
                                                                   /* the core of agent.get_move; returns the move or 0.
                                                                      soft_ms < 0: budget with _budget_ms from rn_set_clock */
RN_EXPORT(rn_set_clock)        void   rn_set_clock(double time_left_ms);
RN_EXPORT(rn_move_uci)         char  *rn_move_uci(i64 move);       /* static 6-byte buffer, e.g. "e7e8q" */
RN_EXPORT(rn_info)             i64    rn_info(int what);           /* RN_INFO_* */
RN_EXPORT(rn_gen_legal)        int    rn_gen_legal(void);          /* legal moves of the root into a static i64[256]; returns n */
RN_EXPORT(rn_move_list)        i64   *rn_move_list(void);          /* that array */
RN_EXPORT(rn_gen_pseudo)       int    rn_gen_pseudo(void);         /* gen_moves order, unfiltered, same array; returns n */
RN_EXPORT(rn_perft)            u64    rn_perft(int depth);         /* leaf count with gen_moves + make_move from the root */
RN_EXPORT(rn_history_clear)    void   rn_history_clear(void);      /* n_game = 0 */
RN_EXPORT(rn_history_push_fen) int    rn_history_push_fen(void);   /* set_fen from the buffer, then _remember(key[0]) */

#endif /* RANSOM_H */
