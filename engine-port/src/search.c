/* search.c -- line-by-line port of engine/cg_search.py (Ransom).
 *
 * Alpha-beta search: PVS, transposition table, quiescence, null move, LMR, killers, history,
 * continuation history, correction history. Read PORTING.md first.
 *
 * The twenty array parameters of the Python functions are the globals of ransom.h section 5
 * (PORTING.md rule 4); every other parameter stays, in the Python's order. `n_game` stays a
 * PARAMETER (named n_game_ so it cannot be confused with the global).
 *
 * Everything here is integer arithmetic except the clock compare and the one-off LMR table.
 * Every Python `//` is written floordiv(), also where the operands cannot be negative, so the
 * two files read the same.
 */
#include "ransom.h"

/* ---- constants only this module reads (cg_search.py:58-82) ---- */
#define SS_NONE         (-INF)               /* cg_search.py:60 */
#define CONT_MAX_BONUS  400                  /* cg_search.py:71 */
#define CONT_MULT       32
#define CONT_DIV        512
#define CORR_SHIFT      ((u64)(64 - CORR_BITS))   /* cg_search.py:75 */
#define CORR_GRAIN      256
#define CORR_LIMIT      (160 * CORR_GRAIN)
#define CORR_ERR        400
#define CORR_W_MAX      16
#define CM_P            0x9E3779B97F4A7C15ULL
#define CM_Q            0xC2B2AE3D27D4EB4FULL
#define CM_N            0x165667B19E3779F9ULL
#define CM_B            0x27D4EB2F165667C5ULL
#define CM_R            0x94D049BB133111EBULL
#define CM_QQ           0xBF58476D1CE4E5B9ULL
#define CM_K            0x2545F4914F6CDD1DULL
#define S29             ((u64)29)

/* Functions of this file that api.c calls but ransom.h does not declare (see the summary of
 * this port: headerIssues). api.c needs matching local prototypes. */
void search_init(void);   /* builds LMR, cg_search.py:121-124 (module import time)   */
void new_corr(void);      /* cg_search.py:85  : corr  = 0                            */
void new_tt(void);        /* cg_search.py:127 : tt[:,0] = 0, tt[:,1] = TT_EMPTY      */
void new_conth(void);     /* cg_search.py:145 : conth = 0                            */
void new_stack(void);     /* cg_search.py:155 : ss    = 0                            */

static i64 negamax(i64 n_game_, i64 ply, i64 depth, i64 alpha, i64 beta, double deadline,
                   int can_null);

/* ===================================================================================== */
/* LMR table (cg_search.py:120-124)                                                      */
/* ===================================================================================== */

/* Late move reduction table: LMR[d, m] = LMR[d * 64 + m]. Row 0 and column 0 stay 0. */
static i64 LMR[64 * 64];
static int lmr_ready = 0;

/* Natural logarithm for the LMR table only (the build has no libm). x >= 1.
 * x = m * 2^e with m in [1, sqrt 2]; ln m = 2 * atanh((m - 1) / (m + 1)) as a power series
 * (|s| <= 0.172, 20 terms: far below one ulp of truncation error). Accurate to a few ulp;
 * the closest any 0.80 + ln(d) * ln(m) / 2.45 comes to an integer is 2.7e-4, so int() of it
 * is the same number CPython's math.log gives (checked against CPython for all 64 x 64). */
static double rn_log(double x)
{
    i64 e = 0;
    while (x > 1.4142135623730951) {
        x = x / 2.0;
        e += 1;
    }
    double s = (x - 1.0) / (x + 1.0);
    double s2 = s * s;
    double term = s;
    double sum = 0.0;
    for (i64 k = 0; k < 20; k++) {
        sum = sum + term / (double)(2 * k + 1);
        term = term * s2;
    }
    return 2.0 * sum + (double)e * 0.6931471805599453;
}

/* cg_search.py:121-124 the module-level loop that fills LMR. Safe to call twice.
 * search_root calls it if nobody has (the Python builds the table at import). */
void search_init(void)
{
    for (i64 i = 0; i < 64 * 64; i++)
        LMR[i] = 0;
    for (i64 _d = 1; _d < 64; _d++) {
        for (i64 _m = 1; _m < 64; _m++) {
            /* int(0.80 + math.log(_d) * math.log(_m) / 2.45): one operation per statement,
             * source order (PORTING.md rule 6). The value is never negative, so the cast
             * truncates exactly as Python's int() does. */
            double ld = rn_log((double)_d);
            double lm = rn_log((double)_m);
            double p = ld * lm;
            double q = p / 2.45;
            double v = 0.80 + q;
            LMR[_d * 64 + _m] = (i64)v;
        }
    }
    lmr_ready = 1;
}

/* ===================================================================================== */
/* Allocators become clear functions (the arrays are static globals defined in api.c)    */
/* ===================================================================================== */

/* cg_search.py:85 new_corr */
void new_corr(void)
{
    rn_memset(corr, 0, sizeof(corr[0]) * 3 * 2 * CORR_SIZE);
}

/* cg_search.py:127 new_tt */
void new_tt(void)
{
    if (tt == NULL)
        return;
    for (i64 i = 0; i < TT_SIZE; i++) {
        tt[IX_TT(i, TT_KEY)] = U0;
        tt[IX_TT(i, TT_ENTRY)] = TT_EMPTY;
    }
}

/* cg_search.py:145 new_conth */
void new_conth(void)
{
    rn_memset(conth, 0, sizeof(conth[0]) * 2 * CONT_N * CONT_N);
}

/* cg_search.py:155 new_stack */
void new_stack(void)
{
    rn_memset(ss, 0, sizeof(ss[0]) * (MAX_PLY + 4) * SS_COLS);
}

/* cg_search.py:162 clock_now */
double clock_now(void)
{
    return plat_now_ms() / 1000.0;
}

/* ===================================================================================== */
/* Correction history                                                                    */
/* ===================================================================================== */

/* cg_search.py:91 corr_keys. All uint64, wrap-around multiply, logical shifts. */
static inline void corr_keys(const u64 *row, i64 *ip, i64 *iw, i64 *ib)
{
    u64 pk = (row[0] * CM_P) ^ (row[6] * CM_Q);
    u64 wk = (row[1] * CM_N) ^ (row[2] * CM_B) ^ (row[3] * CM_R) ^ (row[4] * CM_QQ) ^ (row[5] * CM_K);
    u64 bk = (row[7] * CM_N) ^ (row[8] * CM_B) ^ (row[9] * CM_R) ^ (row[10] * CM_QQ) ^ (row[11] * CM_K);
    pk = (pk ^ (pk >> S29)) * CM_K; wk = (wk ^ (wk >> S29)) * CM_P; bk = (bk ^ (bk >> S29)) * CM_Q;
    *ip = (i64)(pk >> CORR_SHIFT);
    *iw = (i64)(wk >> CORR_SHIFT);
    *ib = (i64)(bk >> CORR_SHIFT);
}

/* cg_search.py:100 corr_value */
static inline i64 corr_value(i64 side, i64 ip, i64 iw, i64 ib)
{
    i64 v = 2 * (i64)corr[IX_CORR(0, side, ip)] + (i64)corr[IX_CORR(1, side, iw)]
            + (i64)corr[IX_CORR(2, side, ib)];
    return floordiv(v, 4 * CORR_GRAIN);
}

/* cg_search.py:106 corr_update */
static void corr_update(i64 side, i64 ip, i64 iw, i64 ib, i64 diff, i64 depth)
{
    i64 w = depth + 1;
    if (w > CORR_W_MAX) w = CORR_W_MAX;
    if (diff > CORR_ERR) diff = CORR_ERR;
    else if (diff < -CORR_ERR) diff = -CORR_ERR;
    i64 target = diff * CORR_GRAIN;
    for (i64 t = 0; t < 3; t++) {
        i64 idx = t == 0 ? ip : (t == 1 ? iw : ib);
        i64 e = (i64)corr[IX_CORR(t, side, idx)];
        e = floordiv(e * (256 - w) + target * w, 256);
        if (e > CORR_LIMIT) e = CORR_LIMIT;
        else if (e < -CORR_LIMIT) e = -CORR_LIMIT;
        corr[IX_CORR(t, side, idx)] = (i32)e;
    }
}

/* ===================================================================================== */
/* Transposition table                                                                   */
/* ===================================================================================== */

/* cg_search.py:169 tt_pack. Each field is masked (as a signed int64) to its width first. */
static inline u64 tt_pack(i64 move, i64 score, i64 depth, i64 bound)
{
    return ((u64)(move & 0xFFFFFFFFLL)
            | ((u64)(score & 0xFFFF) << TT_SH_SCORE)
            | ((u64)(depth & 0xFF) << TT_SH_DEPTH)
            | ((u64)(bound & 0xFF) << TT_SH_BOUND));
}

/* cg_search.py:179 tt_move */
static inline i64 tt_move(u64 e)
{
    return (i64)(e & TT_M32);
}

/* cg_search.py:184 tt_score: the int16 field, sign-extended. */
static inline i64 tt_score(u64 e)
{
    i64 s = (i64)((e >> TT_SH_SCORE) & TT_M16);
    if (s >= 32768)
        s -= 65536;
    return s;
}

/* cg_search.py:193 tt_depth: the int8 field, sign-extended: the empty entry decodes to -1. */
static inline i64 tt_depth(u64 e)
{
    i64 d = (i64)((e >> TT_SH_DEPTH) & TT_M8);
    if (d >= 128)
        d -= 256;
    return d;
}

/* cg_search.py:202 tt_bound */
static inline i64 tt_bound(u64 e)
{
    return (i64)(e >> TT_SH_BOUND);
}

/* cg_search.py:207 tt_probe. Returns (hit_score, found, tt_move) through the pointers.
 * hit_score is valid only when found == 1. */
static void tt_probe(u64 key_, i64 ply, i64 depth, i64 alpha, i64 beta,
                     i64 *hit, i64 *found, i64 *move_out)
{
    i64 i = (i64)(key_ & TT_MASK);
    if (tt[IX_TT(i, TT_KEY)] != key_) {
        *hit = 0; *found = 0; *move_out = 0;
        return;
    }
    u64 e = tt[IX_TT(i, TT_ENTRY)];
    i64 move = tt_move(e);
    if (tt_depth(e) < depth) {
        *hit = 0; *found = 2; *move_out = move;     /* 2 = move usable for ordering, score is not */
        return;
    }
    i64 s = tt_score(e);
    if (s > MATE_IN_MAX)
        s -= ply;
    else if (s < -MATE_IN_MAX)
        s += ply;
    i64 b = tt_bound(e);
    if (b == BOUND_EXACT) {
        *hit = s; *found = 1; *move_out = move;
        return;
    }
    if (b == BOUND_LOWER && s >= beta) {
        *hit = s; *found = 1; *move_out = move;
        return;
    }
    if (b == BOUND_UPPER && s <= alpha) {
        *hit = s; *found = 1; *move_out = move;
        return;
    }
    *hit = 0; *found = 2; *move_out = move;
}

/* cg_search.py:232 tt_store */
static void tt_store(u64 key_, i64 ply, i64 depth, i64 score, i64 bound, i64 move)
{
    i64 i = (i64)(key_ & TT_MASK);
    /* depth-preferred, but always replace a different position */
    if (tt[IX_TT(i, TT_KEY)] == key_ && tt_depth(tt[IX_TT(i, TT_ENTRY)]) > depth
            && bound != BOUND_EXACT)
        return;
    if (score > MATE_IN_MAX)
        score += ply;
    else if (score < -MATE_IN_MAX)
        score -= ply;
    /* the narrow fields must never wrap silently */
    if (score > 32000)
        score = 32000;
    else if (score < -32000)
        score = -32000;
    if (depth > 127)
        depth = 127;
    tt[IX_TT(i, TT_KEY)] = key_;
    tt[IX_TT(i, TT_ENTRY)] = tt_pack(move, score, depth, bound);
}

/* ===================================================================================== */
/* Repetition, continuation history, move ordering                                       */
/* ===================================================================================== */

/* cg_search.py:253 is_repetition. Two-fold anywhere counts as a draw inside search. */
static int is_repetition(i64 ply, i64 n_game_)
{
    u64 k = key[ply];
    i64 limit = st[IX_ST(ply, 3)];
    i64 cur = n_game_ - 1 + ply;
    i64 i = cur - 2;
    i64 steps = 2;
    while (i >= 0 && steps <= limit) {
        u64 kk;
        if (i < n_game_)
            kk = game_keys[i];
        else
            kk = key[i - n_game_ + 1];
        if (kk == k)
            return 1;
        i -= 2;
        steps += 2;
    }
    return 0;
}

/* cg_search.py:273 cont_index: (piece type, to-square) of a move as one index. */
static i64 cont_index(const u64 *bb_row, i64 side, i64 mv)
{
    i64 off = side == 0 ? 0 : 6;
    i64 pt = piece_on(bb_row, mv & 63, off, off + 6) - off;
    return pt * 64 + ((mv >> 6) & 63);
}

/* cg_search.py:281 cont_update: gravity update. The int16 entry is widened to int64, the
 * expression is evaluated in int64 (floor division, e may be negative) and truncated to
 * int16 on the store. */
static void cont_update(i64 k, i64 p, i64 idx, i64 delta)
{
    i64 e = (i64)conth[IX_CONTH(k, p, idx)];
    i64 ad = delta >= 0 ? delta : -delta;
    e = e + CONT_MULT * delta - floordiv(e * ad, CONT_DIV);
    conth[IX_CONTH(k, p, idx)] = (i16)e;
}

/* cg_search.py:291 score_moves. p1/p2 are the continuation indices of the previous move and
 * the one before it, or -1. (The Python parameter tt_move is tt_move_ here: tt_move is a
 * function in C.) */
static void score_moves(const u64 *bb_row, const i64 *st_row, const i64 *moves, i64 n,
                        i64 *scores, i64 tt_move_, i64 p1, i64 p2, i64 ply)
{
    i64 side = st_row[0];
    i64 off = side == 0 ? 0 : 6;
    i64 xoff = 6 - off;
    i64 k1 = killers[IX_KILLERS(ply, 0)];
    i64 k2 = killers[IX_KILLERS(ply, 1)];
    for (i64 i = 0; i < n; i++) {
        i64 mv = moves[i];
        if (mv == tt_move_) {
            scores[i] = 10000000;
            continue;
        }
        i64 frm = mv & 63;
        i64 to = (mv >> 6) & 63;
        i64 promo = (mv >> 12) & 15;
        i64 flag = (mv >> 16) & 7;
        i64 victim = piece_on(bb_row, to, xoff, xoff + 6);
        if (victim >= 0 || flag == 2) {
            i64 vv = victim >= 0 ? (i64)SEE_VALUE[victim - xoff] : 100;
            i64 att = piece_on(bb_row, frm, off, off + 6);
            i64 av = att >= 0 ? (i64)SEE_VALUE[att - off] : 0;
            if (flag == 2 || see_ge(bb_row, frm, to, side, 0))
                scores[i] = 8000000 + vv * 16 - av;      /* winning or even capture */
            else
                scores[i] = 1000000 + vv * 16 - av;      /* loses material: below killers */
        } else if (promo != 0) {
            scores[i] = 7000000 + promo;
        } else if (mv == k1) {
            scores[i] = 6000000;
        } else if (mv == k2) {
            scores[i] = 5900000;
        } else {
            i64 h = history[IX_HISTORY(side, frm, to)];
            if (p1 >= 0 || p2 >= 0) {
                i64 att = piece_on(bb_row, frm, off, off + 6);
                i64 idx = (att - off) * 64 + to;
                if (p1 >= 0)
                    h += (i64)conth[IX_CONTH(0, p1, idx)];
                if (p2 >= 0)
                    h += (i64)conth[IX_CONTH(1, p2, idx)];
            }
            scores[i] = h;
        }
    }
}

/* cg_search.py:335 pick_move: selection sort one slot at a time. Strict `>`: the lowest index
 * among equal maxima wins. A SWAP, not a rotate: the displaced element's new position decides
 * later tie-breaks. */
static inline void pick_move(i64 *moves, i64 *scores, i64 n, i64 i)
{
    i64 best = i;
    for (i64 j = i + 1; j < n; j++) {
        if (scores[j] > scores[best])
            best = j;
    }
    if (best != i) {
        i64 tm = moves[i]; moves[i] = moves[best]; moves[best] = tm;
        i64 ts = scores[i]; scores[i] = scores[best]; scores[best] = ts;
    }
}

/* cg_search.py:347 has_big_pieces */
static int has_big_pieces(const u64 *bb_row, i64 side)
{
    if (side == 0)
        return (bb_row[1] | bb_row[2] | bb_row[3] | bb_row[4]) != U0;
    return (bb_row[7] | bb_row[8] | bb_row[9] | bb_row[10]) != U0;
}

/* cg_search.py:355 lmr_reduce */
static i64 lmr_reduce(i64 depth, i64 legal, int pv_node, i64 hs, int improving)
{
    i64 d = depth < 63 ? depth : 63;
    i64 m = legal < 63 ? legal : 63;
    i64 r = LMR[d * 64 + m];
    if (pv_node && r > 0)
        r -= 1;
    if (!improving && r > 0)
        r += 1;
    /* written to truncate towards zero, on purpose */
    i64 a = hs >= 0 ? floordiv(hs, 5000) : -floordiv(-hs, 5000);
    if (a > 2)
        a = 2;
    else if (a < -2)
        a = -2;
    r -= a;
    if (r < 0)
        r = 0;
    if (r > depth - 2)
        r = depth - 2;
    return r;
}

/* cg_search.py:384 reward_quiet */
static void reward_quiet(i64 side, i64 ply, i64 mv, i64 frm, i64 to, i64 depth, i64 idx,
                         i64 p1, i64 p2)
{
    if (killers[IX_KILLERS(ply, 0)] != mv) {
        killers[IX_KILLERS(ply, 1)] = killers[IX_KILLERS(ply, 0)];
        killers[IX_KILLERS(ply, 0)] = mv;
    }
    i64 h = history[IX_HISTORY(side, frm, to)] + depth * depth;
    history[IX_HISTORY(side, frm, to)] = h < (1 << 20) ? h : (1 << 20);
    i64 bonus = depth * depth;
    if (bonus > CONT_MAX_BONUS)
        bonus = CONT_MAX_BONUS;
    if (p1 >= 0)
        cont_update(0, p1, idx, bonus);
    if (p2 >= 0)
        cont_update(1, p2, idx, bonus);
}

/* cg_search.py:401 punish_quiets.
 * QUIRK: nq is capped at 64 by the caller, so when more than 64 quiets were searched the
 * cutting move is not in the list and quiets[ply][63] escapes the malus. Ported as is. */
static void punish_quiets(const u64 *bb_row, i64 side, i64 ply, i64 nq, i64 depth,
                          i64 p1, i64 p2)
{
    i64 bonus = depth * depth;
    if (bonus > CONT_MAX_BONUS)
        bonus = CONT_MAX_BONUS;
    for (i64 j = 0; j < nq - 1; j++) {
        i64 q = quiets[IX_QUIETS(ply, j)];
        i64 frm = q & 63;
        i64 to = (q >> 6) & 63;
        i64 h = history[IX_HISTORY(side, frm, to)] - depth * depth;
        history[IX_HISTORY(side, frm, to)] = h > -(1 << 20) ? h : -(1 << 20);
        if (p1 >= 0 || p2 >= 0) {
            i64 idx = cont_index(bb_row, side, q);
            if (p1 >= 0)
                cont_update(0, p1, idx, -bonus);
            if (p2 >= 0)
                cont_update(1, p2, idx, -bonus);
        }
    }
}

/* ===================================================================================== */
/* Quiescence                                                                            */
/* ===================================================================================== */

/* cg_search.py:435 quiescence */
static i64 quiescence(i64 n_game_, i64 ply, i64 alpha, i64 beta, double deadline)
{
    info[0] += 1;
    if ((info[0] & 2047) == 0 && clock_now() >= deadline)
        info[1] = 1;
    if (info[1] == 1 || ply >= MAX_PLY - 1)
        return evaluate_inc(BB_ROW(bb, ply), st[IX_ST(ply, 0)], ACC_ROW(acc, ply),
                            ST_ROW(st, ply));

    const u64 *row = BB_ROW(bb, ply);
    i64 ip, iw, ib;
    corr_keys(row, &ip, &iw, &ib);
    i64 stand = evaluate_inc(row, st[IX_ST(ply, 0)], ACC_ROW(acc, ply), ST_ROW(st, ply))
                + corr_value(st[IX_ST(ply, 0)], ip, iw, ib);
    if (stand >= beta)
        return stand;
    if (stand > alpha)
        alpha = stand;
    i64 best = stand;

    i64 n = gen_captures(BB_ROW(bb, ply), ST_ROW(st, ply), BUF_ROW(buf, ply));
    score_moves(BB_ROW(bb, ply), ST_ROW(st, ply), BUF_ROW(buf, ply), n, BUF_ROW(sbuf, ply),
                0, -1, -1, ply);
    i64 *moves = BUF_ROW(buf, ply);
    i64 *scores = BUF_ROW(sbuf, ply);
    for (i64 i = 0; i < n; i++) {
        pick_move(moves, scores, n, i);
        i64 mv = moves[i];
        /* delta pruning: even winning this piece cannot reach alpha */
        i64 to = (mv >> 6) & 63;
        i64 side = st[IX_ST(ply, 0)];
        i64 xoff = side == 0 ? 6 : 0;
        i64 victim = piece_on(row, to, xoff, xoff + 6);
        i64 vv = victim >= 0 ? (i64)SEE_VALUE[victim - xoff] : 100;
        if (stand + vv + 200 < alpha && ((mv >> 12) & 15) == 0)
            continue;
        /* a capture that simply loses material is not worth a node in quiescence: the
         * 1,000,000 band of score_moves holds exactly the non-en-passant captures whose SEE
         * was negative. Promotions stay exempt. */
        if (scores[i] < 2000000 && ((mv >> 12) & 15) == 0)
            continue;
        if (!make_move(bb, st, key, ply, mv))
            continue;
        acc_push(acc, ply, bb);
        i64 score = -quiescence(n_game_, ply + 1, -beta, -alpha, deadline);
        if (info[1] == 1)
            return best;
        if (score > best) {
            best = score;
            if (score > alpha) {
                alpha = score;
                if (alpha >= beta)
                    break;
            }
        }
    }
    return best;
}

/* ===================================================================================== */
/* Negamax                                                                               */
/* ===================================================================================== */

/* cg_search.py:492 negamax. The Python locals `static` and `tt_move` are static_eval and
 * tt_move_ here (a C keyword and a C function). */
static i64 negamax(i64 n_game_, i64 ply, i64 depth, i64 alpha, i64 beta, double deadline,
                   int can_null)
{
    info[0] += 1;
    if ((info[0] & 2047) == 0 && clock_now() >= deadline)
        info[1] = 1;
    if (info[1] == 1)
        return 0;

    int root = ply == 0;
    i64 side = st[IX_ST(ply, 0)];
    int checked = in_check(BB_ROW(bb, ply), side);

    if (!root) {
        /* 99, not 100: the referee grants the fifty-move claim one ply before the counter
         * reaches 100. `not checked`: checkmate takes precedence over the claim. */
        if ((st[IX_ST(ply, 3)] >= 99 && !checked) || is_insufficient(BB_ROW(bb, ply)))
            return 0;
        if (is_repetition(ply, n_game_))
            return 0;
        /* mate distance pruning: a shorter mate elsewhere makes this subtree irrelevant */
        if (alpha < -MATE + ply)
            alpha = -MATE + ply;
        if (beta > MATE - ply - 1)
            beta = MATE - ply - 1;
        if (alpha >= beta)
            return alpha;
    }

    if (checked)
        depth += 1;                     /* check extension */
    if (depth <= 0 || ply >= MAX_PLY - 1)
        return quiescence(n_game_, ply, alpha, beta, deadline);

    int pv_node = beta - alpha > 1;
    i64 tt_move_ = 0;
    if (!root) {
        i64 hit, found, mv0;
        tt_probe(key[ply], ply, depth, alpha, beta, &hit, &found, &mv0);
        if (found == 1 && !pv_node)
            return hit;
        tt_move_ = mv0;
    } else {
        /* The root never probes the table, but it does order the previous iteration's best
         * move first -- search_root leaves it in ss[0, 3]. */
        tt_move_ = ss[IX_SS(0, 3)];
    }

    /* the two moves that led here, for the continuation history (-1: none, or a null move) */
    i64 p1 = ply >= 1 ? ss[IX_SS(ply - 1, 1)] : -1;
    i64 p2 = ply >= 2 ? ss[IX_SS(ply - 2, 1)] : -1;

    /* Static evaluation at every node not in check; kept on the search stack so that two
     * plies further down the same side can tell whether its position is IMPROVING. */
    const u64 *row = BB_ROW(bb, ply);
    i64 static_eval = 0; int improving = 1;
    i64 ip, iw, ib;
    corr_keys(row, &ip, &iw, &ib);
    if (checked) {
        ss[IX_SS(ply, 0)] = SS_NONE;
    } else {
        static_eval = evaluate_inc(row, side, ACC_ROW(acc, ply), ST_ROW(st, ply))
                      + corr_value(side, ip, iw, ib);
        if (static_eval > 2999) static_eval = 2999;      /* stay inside EVAL_LIMIT */
        else if (static_eval < -2999) static_eval = -2999;
        ss[IX_SS(ply, 0)] = static_eval;
        if (ply >= 2 && ss[IX_SS(ply - 2, 0)] != SS_NONE)
            improving = static_eval > ss[IX_SS(ply - 2, 0)];
        else if (ply >= 4 && ss[IX_SS(ply - 4, 0)] != SS_NONE)
            improving = static_eval > ss[IX_SS(ply - 4, 0)];
    }
    i64 score = 0;
    if (!pv_node && !checked) {
        /* reverse futility: we are so far ahead that even giving up material holds beta */
        if (depth <= 8 && i64_abs(beta) < MATE_IN_MAX
                && static_eval - 80 * (depth - (improving ? 1 : 0)) >= beta)
            return static_eval;
        /* null move: pass, and if the opponent still cannot hurt us, this node is a cutoff */
        if (can_null && depth >= 3 && static_eval >= beta) {
            if (has_big_pieces(BB_ROW(bb, ply), side)) {
                i64 r = 3 + floordiv(depth, 5);
                make_null(bb, st, key, ply);
                acc_copy(acc, ply);
                ss[IX_SS(ply, 1)] = -1;
                score = -negamax(n_game_, ply + 1, depth - 1 - r, -beta, -beta + 1, deadline, 0);
                if (info[1] == 1)
                    return 0;
                if (score >= beta)
                    return score > MATE_IN_MAX ? beta : score;
            }
        }
    }

    /* late move pruning allows half as many quiet moves when the position is not improving */
    i64 lmp_limit = 3 + depth * depth;
    if (!improving)
        lmp_limit = floordiv(lmp_limit, 2);

    i64 n = gen_moves(BB_ROW(bb, ply), ST_ROW(st, ply), BUF_ROW(buf, ply));
    score_moves(BB_ROW(bb, ply), ST_ROW(st, ply), BUF_ROW(buf, ply), n, BUF_ROW(sbuf, ply),
                tt_move_, p1, p2, ply);
    i64 *moves = BUF_ROW(buf, ply);
    i64 *scores = BUF_ROW(sbuf, ply);

    i64 best = -INF;
    i64 best_move = 0;
    int best_quiet = 0;
    i64 legal = 0;
    i64 nq = 0;
    i64 bound = BOUND_UPPER;
    /* QUIRK: the Python also sets old_alpha = alpha here and never reads it. Not ported. */

    for (i64 i = 0; i < n; i++) {
        pick_move(moves, scores, n, i);
        i64 mv = moves[i];
        i64 to = (mv >> 6) & 63;
        i64 xoff = side == 0 ? 6 : 0;
        int is_cap = piece_on(row, to, xoff, xoff + 6) >= 0 || ((mv >> 16) & 7) == 2;
        int is_quiet = !is_cap && ((mv >> 12) & 15) == 0;

        /* late move pruning: deep in a quiet move list at low depth, stop looking.
         * `i` is the index into the ordered pseudo-legal list, not `legal`. */
        if (!pv_node && !checked && is_quiet && depth <= 6
                && legal > 0 && i > lmp_limit && i64_abs(alpha) < MATE_IN_MAX)
            continue;

        /* futility: this node is so far below alpha that a quiet move cannot close the gap */
        if (!pv_node && !checked && is_quiet && depth <= 6
                && legal > 0 && i64_abs(alpha) < MATE_IN_MAX
                && static_eval + 120 + 110 * depth <= alpha)
            continue;

        /* SEE pruning: a capture that loses more than 20*d^2, or a quiet move that hangs
         * more than 64*d of material, is not searched. */
        if (!pv_node && !checked && depth <= 6 && legal > 0
                && i64_abs(alpha) < MATE_IN_MAX) {
            if (is_quiet) {
                if (!see_ge(row, mv & 63, to, side, -64 * depth))
                    continue;
            } else if (scores[i] < 2000000 && ((mv >> 12) & 15) == 0) {
                if (!see_ge(row, mv & 63, to, side, -20 * depth * depth))
                    continue;
            }
        }

        if (!make_move(bb, st, key, ply, mv))
            continue;
        acc_push(acc, ply, bb);
        legal += 1;
        i64 idx = cont_index(row, side, mv);
        ss[IX_SS(ply, 1)] = idx;
        if (is_quiet && nq < 64) {
            quiets[IX_QUIETS(ply, nq)] = mv;
            nq += 1;
        }

        if (legal == 1) {
            score = -negamax(n_game_, ply + 1, depth - 1, -beta, -alpha, deadline, 1);
        } else {
            i64 r = 0;
            if (depth >= 3 && !checked) {
                if (is_quiet) {
                    i64 hs = 0;
                    if (p1 >= 0)
                        hs += (i64)conth[IX_CONTH(0, p1, idx)];
                    if (p2 >= 0)
                        hs += (i64)conth[IX_CONTH(1, p2, idx)];
                    r = lmr_reduce(depth, legal, pv_node, hs, improving);
                } else if (scores[i] < 2000000 && ((mv >> 12) & 15) == 0) {
                    /* a capture that loses material by SEE is reduced like a quiet move,
                     * without a history term */
                    r = lmr_reduce(depth, legal, pv_node, 0, improving);
                }
            }
            score = -negamax(n_game_, ply + 1, depth - 1 - r, -alpha - 1, -alpha, deadline, 1);
            if (!info[1] && score > alpha && (r > 0 || pv_node))
                score = -negamax(n_game_, ply + 1, depth - 1, -beta, -alpha, deadline, 1);
        }
        if (info[1] == 1)
            return legal > 1 ? best : 0;

        if (score > best) {
            best = score;
            best_move = mv;
            best_quiet = is_quiet;
            if (score > alpha) {
                alpha = score;
                bound = BOUND_EXACT;
                if (root) {
                    /* A root move that raised alpha did so on a COMPLETED full-window
                     * search; search_root reads these two slots on abort. */
                    info[2] = mv;
                    info[3] = score;
                }
                if (alpha >= beta) {
                    bound = BOUND_LOWER;
                    if (is_quiet) {
                        reward_quiet(side, ply, mv, mv & 63, to, depth, idx, p1, p2);
                        punish_quiets(row, side, ply, nq, depth, p1, p2);
                    }
                    break;
                }
            }
        }
    }

    if (legal == 0)
        return checked ? -MATE + ply : 0;

    if (!checked && best_quiet && best < MATE_IN_MAX && best > -MATE_IN_MAX
            && !(bound == BOUND_LOWER && best <= static_eval)
            && !(bound == BOUND_UPPER && best >= static_eval))
        corr_update(side, ip, iw, ib, best - static_eval, depth);
    tt_store(key[ply], ply, depth, best, bound, best_move);
    return best;
}

/* ===================================================================================== */
/* Root                                                                                  */
/* ===================================================================================== */

/* cg_search.py:714 search_root. Iterative deepening. out[0] = best move, out[1] = score,
 * out[2] = depth reached. */
i64 search_root(i64 n_game_, i64 max_depth, double deadline, double soft_deadline)
{
    /* The Python fills LMR when the module is imported. Here: once, if api.c has not. */
    if (!lmr_ready)
        search_init();

    i64 best_move = 0;
    i64 best_score = 0;
    i64 completed = 0;
    i64 score = 0;

    acc_root(ACC_ROW(acc, 0), BB_ROW(bb, 0));
    i64 n = gen_moves(BB_ROW(bb, 0), ST_ROW(st, 0), BUF_ROW(buf, 0));
    for (i64 i = 0; i < n; i++) {
        if (make_move(bb, st, key, 0, buf[IX_BUF(0, i)])) {
            best_move = buf[IX_BUF(0, i)];
            break;
        }
    }

    for (i64 depth = 1; depth < max_depth + 1; depth++) {
        info[2] = 0;
        info[3] = 0;
        ss[IX_SS(0, 3)] = completed > 0 ? best_move : 0;
        /* Aspiration windows. Shallow depths and mate scores use the full window. */
        if (depth < 5 || best_score > MATE_IN_MAX || best_score < -MATE_IN_MAX) {
            score = negamax(n_game_, 0, depth, -INF, INF, deadline, 1);
        } else {
            i64 delta = 12 + floordiv(best_score * best_score, 15000);
            if (delta > 400)
                delta = 400;
            i64 alpha = best_score - delta;
            i64 beta = best_score + delta;
            for (;;) {
                score = negamax(n_game_, 0, depth, alpha, beta, deadline, 1);
                if (info[1] == 1)
                    break;
                if (score <= alpha) {
                    /* halve the other bound too, or the re-search tends to fail high instead */
                    beta = floordiv(alpha + beta, 2);
                    alpha = score - delta;
                    if (alpha < -INF)
                        alpha = -INF;
                } else if (score >= beta) {
                    beta = score + delta;
                    if (beta > INF)
                        beta = INF;
                } else {
                    break;
                }
                delta += floordiv(delta, 3);
                if (delta > 2000) {
                    alpha = -INF;
                    beta = INF;
                }
            }
        }
        if (info[1] == 1) {
            if (info[2] != 0) {
                best_move = info[2];
                best_score = info[3];
            }
            break;
        }
        i64 hit, found, mv;
        tt_probe(key[0], 0, depth, -INF, INF, &hit, &found, &mv);
        (void)hit;
        if (found != 0 && mv != 0)
            best_move = mv;
        best_score = score;
        completed = depth;
        /* The one permitted addition (PORTING.md rule 8): report the finished iteration. */
        plat_on_iteration((int)depth, best_score, info[0], best_move);
        if (clock_now() >= soft_deadline)
            break;
        if (score > MATE_IN_MAX || score < -MATE_IN_MAX)
            break;
    }

    out[0] = best_move;
    out[1] = best_score;
    out[2] = completed;
    return best_move;
}
