/* nnue.c -- port of the inference path of cg_nnue.py and cg_eval.py, plus is_insufficient
 * from cg_hce.py. Read PORTING.md and ransom.h first.
 *
 * Float types follow numba's inference (PORTING.md rules 2 and 6):
 *   - acc, W1, B1, W2 and every np.float32(...) value are float32 (`float`);
 *     float32 op float32 stays float32.
 *   - B2 and SCALE are float64 (`double`), so `(s + b2[bucket]) * scale` is computed in double.
 *   - `v < 0.0` compares a float32 with a float64 literal: the float32 is widened (exactly).
 *   - int(x) truncates toward zero, which is what a C cast does.
 * Every floating-point operation is written in the source order, one operation per statement
 * where the order matters. The build uses -ffp-contract=off and no fast-math; the original's
 * numba fastmath flags are emptied in the reference this port is tested against.
 */
#include "ransom.h"

/* ------------------------------------------------------------------------------------- */
/* The weights (cg_eval.py:32  W1, B1, W2, B2, SCALE, L1 = _load(_NET); cg_nnue.py:41 load) */
/* ------------------------------------------------------------------------------------- */

float  W1[N_FEATURES * L1];        /* float32 (768, 256) */
float  B1[L1];                     /* float32 (256,)     */
float  W2[N_BUCKETS * 2 * L1];     /* float32 (8, 512)   */
double B2[N_BUCKETS];              /* float64 (8,): load() widens it (cg_nnue.py:49) */
/* cg_eval.py:48  SCALE = float(SCALE) * float(EVAL_MULT). Until nnue_set_weights runs this
 * holds the shipped net's value (scale 400.0 in the file); the weights are all zero then. */
double SCALE = 400.0 * EVAL_MULT;

/* cg_nnue.py:41 load (the part that is left once the file is raw bytes) and cg_eval.py:48.
 * w1/b1/w2/b2 point into the 4-byte aligned weight-file buffer. */
void nnue_set_weights(const float *w1, const float *b1, const float *w2, const float *b2,
                      float scale)
{
    i64 i;
    for (i = 0; i < (i64)N_FEATURES * L1; i++)
        W1[i] = w1[i];
    for (i = 0; i < L1; i++)
        B1[i] = b1[i];
    for (i = 0; i < (i64)N_BUCKETS * 2 * L1; i++)
        W2[i] = w2[i];
    /* cg_nnue.py:49  b2 = np.asarray(z["b2"], dtype=np.float64): exact widening */
    for (i = 0; i < N_BUCKETS; i++)
        B2[i] = (double)b2[i];
    /* cg_nnue.py:59 float(z["scale"]) widens the file's float32 exactly;
     * cg_eval.py:48 multiplies in float64. */
    SCALE = (double)scale * (double)EVAL_MULT;
}

/* ------------------------------------------------------------------------------------- */
/* cg_nnue.py                                                                            */
/* ------------------------------------------------------------------------------------- */

/* cg_nnue.py:174 white_index. piece is 0..11, so % is on a non-negative value. */
static inline i64 white_index(i64 piece, i64 sq)
{
    return ((piece % 6) + (piece < 6 ? 0 : 6)) * 64 + sq;
}

/* cg_nnue.py:180 black_index */
static inline i64 black_index(i64 piece, i64 sq)
{
    return ((piece % 6) + (piece < 6 ? 6 : 0)) * 64 + (sq ^ 56);
}

/* cg_nnue.py:186 refresh_colour. acc is ONE accumulator row [2][l1], bb ONE board row.
 * l1 is always L1 (the index macros are built on L1). Each element gets one float32 add
 * per piece, pieces p-ascending then lsb-ascending, stored back between pieces. */
static void refresh_colour(float *acc, const float *w1, const float *b1, const u64 *bb, i64 l1)
{
    i64 i, p;
    for (i = 0; i < l1; i++) {
        acc[IX_ACC_ROW(0, i)] = b1[i];
        acc[IX_ACC_ROW(1, i)] = b1[i];
    }
    for (p = 0; p < 12; p++) {
        u64 b = bb[p];
        while (b != U0) {
            i64 sq = lsb(b);
            i64 wi, bi;
            b &= b - U1;
            wi = white_index(p, sq);
            bi = black_index(p, sq);
            for (i = 0; i < l1; i++) {
                acc[IX_ACC_ROW(0, i)] = acc[IX_ACC_ROW(0, i)] + w1[IX_W1(wi, i)];
                acc[IX_ACC_ROW(1, i)] = acc[IX_ACC_ROW(1, i)] + w1[IX_W1(bi, i)];
            }
        }
    }
}

/* cg_nnue.py:214 apply_diff_serial. Rows: acc_from/acc_to are [2][l1], bb_from/bb_to are
 * one board row each. Reached from acc_push for castling (4 changed squares) and for the
 * impossible counts 0, 1, 5+. acc_from and acc_to never alias (different plies). */
static void apply_diff_serial(const float *acc_from, float *acc_to, const u64 *bb_from,
                              const u64 *bb_to, const float *w1, i64 l1)
{
    i64 i, p;
    int done = 0;
    for (p = 0; p < 12; p++) {
        u64 changed = bb_from[p] ^ bb_to[p];
        while (changed != U0) {
            i64 sq = lsb(changed);
            i64 wi, bi;
            int gained;
            changed &= changed - U1;
            wi = white_index(p, sq);
            bi = black_index(p, sq);
            gained = (bb_to[p] & (U1 << (u64)sq)) != U0;
            if (!done) {
                if (gained) {
                    for (i = 0; i < l1; i++) {
                        acc_to[IX_ACC_ROW(0, i)] = acc_from[IX_ACC_ROW(0, i)] + w1[IX_W1(wi, i)];
                        acc_to[IX_ACC_ROW(1, i)] = acc_from[IX_ACC_ROW(1, i)] + w1[IX_W1(bi, i)];
                    }
                } else {
                    for (i = 0; i < l1; i++) {
                        acc_to[IX_ACC_ROW(0, i)] = acc_from[IX_ACC_ROW(0, i)] - w1[IX_W1(wi, i)];
                        acc_to[IX_ACC_ROW(1, i)] = acc_from[IX_ACC_ROW(1, i)] - w1[IX_W1(bi, i)];
                    }
                }
                done = 1;
            } else if (gained) {
                for (i = 0; i < l1; i++) {
                    acc_to[IX_ACC_ROW(0, i)] = acc_to[IX_ACC_ROW(0, i)] + w1[IX_W1(wi, i)];
                    acc_to[IX_ACC_ROW(1, i)] = acc_to[IX_ACC_ROW(1, i)] + w1[IX_W1(bi, i)];
                }
            } else {
                for (i = 0; i < l1; i++) {
                    acc_to[IX_ACC_ROW(0, i)] = acc_to[IX_ACC_ROW(0, i)] - w1[IX_W1(wi, i)];
                    acc_to[IX_ACC_ROW(1, i)] = acc_to[IX_ACC_ROW(1, i)] - w1[IX_W1(bi, i)];
                }
            }
        }
    }
    if (!done) {                      /* a move that changed no piece bitboard cannot happen */
        for (i = 0; i < l1; i++) {
            acc_to[IX_ACC_ROW(0, i)] = acc_from[IX_ACC_ROW(0, i)];
            acc_to[IX_ACC_ROW(1, i)] = acc_from[IX_ACC_ROW(1, i)];
        }
    }
}

/* cg_nnue.py:348 forward_colour. acc is ONE accumulator row [2][l1]; w2 is [N_BUCKETS][2*l1];
 * b2 and scale are float64. Returns centipawns for the side to move, in +/-EVAL_LIMIT.
 * The running sum s and every term are float32, in the source order own[0], other[0],
 * own[1], other[1], ... ; only the last step (s + b2) * scale is float64. */
static i64 forward_colour(const float *acc, i64 stm, i64 bucket, const float *w2,
                          const double *b2, double scale, i64 l1)
{
    i64 own = stm;
    i64 other = 1 - stm;
    i64 i;
    i64 v_out;
    double x;
    float s = 0.0f;

    /* QUIRK: numba wraps a negative index, so a board with no pieces (bucket -1) reads the
     * last bucket. More than 32 pieces (bucket > 7) reads out of bounds in the original
     * (no bounds checks); here it is held at the last bucket so that a hostile FEN cannot
     * read outside W2. Neither happens for a legal position (2..32 pieces, bucket 0..7). */
    if (bucket < 0)
        bucket += N_BUCKETS;
    if (bucket > N_BUCKETS - 1)
        bucket = N_BUCKETS - 1;

    for (i = 0; i < l1; i++) {
        float v, u, t;
        v = acc[IX_ACC_ROW(own, i)];
        if ((double)v < 0.0)              /* float32 against a float64 literal: exact widening */
            v = 0.0f;
        else if ((double)v > 1.0)
            v = 1.0f;
        t = v * v;                        /* s += v * v * w2[bucket, i]  ==  s + ((v*v) * w2) */
        t = t * w2[IX_W2(bucket, i)];
        s = s + t;
        u = acc[IX_ACC_ROW(other, i)];
        if ((double)u < 0.0)
            u = 0.0f;
        else if ((double)u > 1.0)
            u = 1.0f;
        t = u * u;
        t = t * w2[IX_W2(bucket, l1 + i)];
        s = s + t;
    }
    /* v = int((s + b2[bucket]) * scale): float32 + float64 is a float64 add, then a float64
     * multiply, then truncation toward zero. (Python reuses the name v here; numba's SSA
     * keeps it a clean int64.) */
    x = (double)s + b2[bucket];
    x = x * scale;
    v_out = (i64)x;
    if (v_out > EVAL_LIMIT)
        return EVAL_LIMIT;
    if (v_out < -EVAL_LIMIT)
        return -EVAL_LIMIT;
    return v_out;
}

/* ------------------------------------------------------------------------------------- */
/* cg_eval.py                                                                            */
/* ------------------------------------------------------------------------------------- */

/* cg_eval.py:65 _bucket. _popcnt is LLVM ctpop: an ordinary 64-bit population count.
 * (n - 1) >> 2 is an arithmetic shift on int64. */
static i64 _bucket(const u64 *bb)
{
    i64 n = (i64)__builtin_popcountll(bb[OCC_W] | bb[OCC_B]);
    return (n - 1) >> 2;
}

/* cg_eval.py:72 evaluate */
i64 evaluate(const u64 *bb_row, i64 side, const float *acc_row)
{
    return forward_colour(acc_row, side, _bucket(bb_row), W2, B2, SCALE, L1);
}

/* cg_eval.py:78 evaluate_inc. QUIRK: strow is unused; it stays in the signature as in the
 * Python. */
i64 evaluate_inc(const u64 *bb_row, i64 side, const float *acc_row, const i64 *st_row)
{
    (void)st_row;
    return forward_colour(acc_row, side, _bucket(bb_row), W2, B2, SCALE, L1);
}

/* cg_eval.py:84 acc_root */
void acc_root(float *acc_row, const u64 *bb_row)
{
    refresh_colour(acc_row, W1, B1, bb_row, L1);
}

/* cg_eval.py:90 acc_push. WHOLE arrays. The shipped build does NOT call cg_nnue.apply_diff:
 * this is its re-written twin with three slots; four changed squares (castling) and the
 * impossible counts go to apply_diff_serial.
 * Per element the order is ((acc + s0*w0) + s1*w1) + s2*w2 in float32. Each s is exactly
 * +1.0f or -1.0f, so every product is exact and each step is one float32 add or subtract. */
void acc_push(float *acc, i64 ply, const u64 *bb)
{
    i64 n = 0;
    i64 iw0 = 0;
    i64 ib0 = 0;
    float s0 = 0.0f;
    i64 iw1 = 0;
    i64 ib1 = 0;
    float s1 = 0.0f;
    i64 iw2 = 0;
    i64 ib2 = 0;
    float s2 = 0.0f;
    i64 q = ply + 1;
    i64 p, i;

    for (p = 0; p < 12; p++) {
        u64 changed = bb[IX_BB(ply, p)] ^ bb[IX_BB(q, p)];
        while (changed != U0) {
            i64 sq = lsb(changed);
            i64 wi, bi;
            float s;
            changed &= changed - U1;
            wi = white_index(p, sq);
            bi = black_index(p, sq);
            if ((bb[IX_BB(q, p)] & (U1 << (u64)sq)) != U0)
                s = 1.0f;                 /* the square gained a piece: add its row */
            else
                s = -1.0f;                /* it lost one: subtract the row          */
            if (n == 0) {
                iw0 = wi;
                ib0 = bi;
                s0 = s;
            } else if (n == 1) {
                iw1 = wi;
                ib1 = bi;
                s1 = s;
            } else if (n == 2) {
                iw2 = wi;
                ib2 = bi;
                s2 = s;
            }
            n += 1;                       /* keeps counting past the three slots */
        }
    }
    if (n == 2) {                                     /* quiet move, promotion */
        for (i = 0; i < L1; i++) {
            float t;
            t = s0 * W1[IX_W1(iw0, i)];
            t = acc[IX_ACC(ply, 0, i)] + t;
            t = t + s1 * W1[IX_W1(iw1, i)];
            acc[IX_ACC(q, 0, i)] = t;
            t = s0 * W1[IX_W1(ib0, i)];
            t = acc[IX_ACC(ply, 1, i)] + t;
            t = t + s1 * W1[IX_W1(ib1, i)];
            acc[IX_ACC(q, 1, i)] = t;
        }
    } else if (n == 3) {                              /* capture, en passant, capture-promotion */
        for (i = 0; i < L1; i++) {
            float t;
            t = s0 * W1[IX_W1(iw0, i)];
            t = acc[IX_ACC(ply, 0, i)] + t;
            t = t + s1 * W1[IX_W1(iw1, i)];
            t = t + s2 * W1[IX_W1(iw2, i)];
            acc[IX_ACC(q, 0, i)] = t;
            t = s0 * W1[IX_W1(ib0, i)];
            t = acc[IX_ACC(ply, 1, i)] + t;
            t = t + s1 * W1[IX_W1(ib1, i)];
            t = t + s2 * W1[IX_W1(ib2, i)];
            acc[IX_ACC(q, 1, i)] = t;
        }
    } else {                                          /* castling (4), or the impossible 0/1/5+ */
        apply_diff_serial(ACC_ROW(acc, ply), ACC_ROW(acc, q), BB_ROW(bb, ply), BB_ROW(bb, q),
                          W1, L1);
    }
}

/* cg_eval.py:157 acc_copy */
void acc_copy(float *acc, i64 ply)
{
    i64 c, i;
    for (c = 0; c < 2; c++)
        for (i = 0; i < L1; i++)
            acc[IX_ACC(ply + 1, c, i)] = acc[IX_ACC(ply, c, i)];
}

/* ------------------------------------------------------------------------------------- */
/* cg_hce.py                                                                             */
/* ------------------------------------------------------------------------------------- */

/* cg_hce.py:67 is_insufficient. bb[3], bb[9], bb[4], bb[10] are the rooks and queens, written
 * as bare numbers in the Python. popcount is cg_position.popcount (position.c). */
int is_insufficient(const u64 *bb_row)
{
    u64 knights, bishops;
    i64 minors;
    if ((bb_row[WP] | bb_row[6 + WP] | bb_row[3] | bb_row[9] | bb_row[4] | bb_row[10]) != U0)
        return 0;
    knights = bb_row[WN] | bb_row[6 + WN];
    bishops = bb_row[WB] | bb_row[6 + WB];
    if (knights == U0) {
        if ((bishops & DARK_SQUARES) == U0 || (bishops & LIGHT_SQUARES) == U0)
            return 1;
    }
    minors = popcount(bishops | knights);
    return minors <= 1;
}
