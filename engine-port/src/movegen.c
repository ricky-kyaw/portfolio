/* movegen.c -- port of engine/cg_movegen.py (Ransom chess engine).
 *
 * Pseudo-legal move generation. Legality is settled by make_move rejecting self-check.
 * Two generators: every move, and captures-plus-queen-promotions for quiescence search.
 *
 * The generation ORDER is part of the contract (PORTING.md): pick_move breaks score ties by
 * buffer position, so every loop below scans bits in ascending order exactly as the Python
 * does (lsb, then b &= b - 1) and the helper calls stay in the same sequence.
 *
 * Naming: the Python parameters `bb`, `st`, `out` are ONE ROW each (bb[ply], st[ply],
 * buf[ply]). ransom.h keeps those names for the engine-state globals, so the rows are
 * called bb_row, st_row and moves_out here, as in the prototypes of ransom.h.
 */
#include "ransom.h"

/* cg_movegen.py:22-29 */
#define RANK3            ((u64)0x0000000000FF0000ULL)
#define RANK6            ((u64)0x0000FF0000000000ULL)
#define RANK8            ((u64)0xFF00000000000000ULL)
#define RANK1            ((u64)0x00000000000000FFULL)
#define CASTLE_WK_EMPTY  ((u64)0x0000000000000060ULL)
#define CASTLE_WQ_EMPTY  ((u64)0x000000000000000EULL)
#define CASTLE_BK_EMPTY  ((u64)0x6000000000000000ULL)
#define CASTLE_BQ_EMPTY  ((u64)0x0E00000000000000ULL)

/* cg_movegen.py:33 add_promotions -- order is queen, rook, bishop, knight */
static i64 add_promotions(i64 *moves_out, i64 n, i64 frm, i64 to)
{
    moves_out[n] = mk_move(frm, to, 4, 0);
    moves_out[n + 1] = mk_move(frm, to, 3, 0);
    moves_out[n + 2] = mk_move(frm, to, 2, 0);
    moves_out[n + 3] = mk_move(frm, to, 1, 0);
    return n + 4;
}

/* cg_movegen.py:42 gen_pawn_pushes */
static i64 gen_pawn_pushes(const u64 *bb_row, const i64 *st_row, i64 *moves_out, i64 n)
{
    i64 side = st_row[0];
    i64 off = (side == 0) ? 0 : 6;
    u64 empty = ~(bb_row[OCC_W] | bb_row[OCC_B]);
    u64 pawns = bb_row[off + WP];
    u64 one;
    u64 two;
    i64 back;
    u64 b;
    i64 to;
    i64 frm;

    if (side == 0) {
        one = (pawns << (u64)8) & empty;
        two = ((one & RANK3) << (u64)8) & empty;
        back = -8;
    } else {
        one = (pawns >> (u64)8) & empty;
        two = ((one & RANK6) >> (u64)8) & empty;
        back = 8;
    }

    b = one;
    while (b != U0) {
        to = lsb(b);
        b &= b - U1;
        frm = to + back;
        if (to >= 56 || to < 8) {
            n = add_promotions(moves_out, n, frm, to);
        } else {
            moves_out[n] = mk_move(frm, to, 0, 0);
            n += 1;
        }
    }
    b = two;
    while (b != U0) {
        to = lsb(b);
        b &= b - U1;
        moves_out[n] = mk_move(to + 2 * back, to, 0, 1);
        n += 1;
    }
    return n;
}

/* cg_movegen.py:76 gen_pawn_captures */
static i64 gen_pawn_captures(const u64 *bb_row, const i64 *st_row, i64 *moves_out, i64 n)
{
    i64 side = st_row[0];
    i64 ep = st_row[2];
    i64 off = (side == 0) ? 0 : 6;
    u64 them = (side == 0) ? bb_row[OCC_B] : bb_row[OCC_W];
    u64 b = bb_row[off + WP];
    u64 c;
    i64 frm;
    i64 to;

    while (b != U0) {
        frm = lsb(b);
        b &= b - U1;
        c = PAWN_ATT[IX_PAWN_ATT(side, frm)] & them;
        while (c != U0) {
            to = lsb(c);
            c &= c - U1;
            if (to >= 56 || to < 8) {
                n = add_promotions(moves_out, n, frm, to);
            } else {
                moves_out[n] = mk_move(frm, to, 0, 0);
                n += 1;
            }
        }
        /* `ep >= 0` is tested first (short-circuit, as the Python `and`), so the shift count
         * is never negative. QUIRK: the ep square is trusted as given by st[2]; nothing
         * checks that a pawn can really be taken there. */
        if (ep >= 0 && (PAWN_ATT[IX_PAWN_ATT(side, frm)] & (U1 << (u64)ep)) != U0) {
            moves_out[n] = mk_move(frm, ep, 0, 2);
            n += 1;
        }
    }
    return n;
}

/* cg_movegen.py:101 gen_piece_moves
 * Knights, bishops, rooks, queens and the king, restricted to `targets`.
 * `targets` is ~own_pieces for a full generation and the enemy occupancy for captures only,
 * which is the whole difference between the two generators. */
static i64 gen_piece_moves(const u64 *bb_row, const i64 *st_row, i64 *moves_out, i64 n,
                           u64 targets)
{
    i64 side = st_row[0];
    i64 off = (side == 0) ? 0 : 6;
    u64 occ = bb_row[OCC_W] | bb_row[OCC_B];
    u64 b;
    u64 t;
    i64 frm;

    b = bb_row[off + WN];
    while (b != U0) {
        frm = lsb(b);
        b &= b - U1;
        t = KNIGHT_ATT[frm] & targets;
        while (t != U0) {
            moves_out[n] = mk_move(frm, lsb(t), 0, 0);
            n += 1;
            t &= t - U1;
        }
    }
    b = bb_row[off + WB];
    while (b != U0) {
        frm = lsb(b);
        b &= b - U1;
        t = bishop_attacks(frm, occ) & targets;
        while (t != U0) {
            moves_out[n] = mk_move(frm, lsb(t), 0, 0);
            n += 1;
            t &= t - U1;
        }
    }
    b = bb_row[off + WR];
    while (b != U0) {
        frm = lsb(b);
        b &= b - U1;
        t = rook_attacks(frm, occ) & targets;
        while (t != U0) {
            moves_out[n] = mk_move(frm, lsb(t), 0, 0);
            n += 1;
            t &= t - U1;
        }
    }
    b = bb_row[off + WQ];
    while (b != U0) {
        frm = lsb(b);
        b &= b - U1;
        t = (bishop_attacks(frm, occ) | rook_attacks(frm, occ)) & targets;
        while (t != U0) {
            moves_out[n] = mk_move(frm, lsb(t), 0, 0);
            n += 1;
            t &= t - U1;
        }
    }
    b = bb_row[off + WK];
    while (b != U0) {
        frm = lsb(b);
        b &= b - U1;
        t = KING_ATT[frm] & targets;
        while (t != U0) {
            moves_out[n] = mk_move(frm, lsb(t), 0, 0);
            n += 1;
            t &= t - U1;
        }
    }
    return n;
}

/* cg_movegen.py:160 gen_castling
 * QUIRK: the king's DESTINATION square (g1/c1/g8/c8) is not tested here; make_move rejects
 * such a castle later through its own-king-attacked test. Do not add the test. */
static i64 gen_castling(const u64 *bb_row, const i64 *st_row, i64 *moves_out, i64 n)
{
    i64 side = st_row[0];
    i64 castling = st_row[1];
    u64 occ = bb_row[OCC_W] | bb_row[OCC_B];

    if (side == 0) {
        if ((castling & 1) && !(occ & CASTLE_WK_EMPTY)) {
            if (!attacked(bb_row, 4, 1) && !attacked(bb_row, 5, 1)) {
                moves_out[n] = mk_move(4, 6, 0, 3);
                n += 1;
            }
        }
        if ((castling & 2) && !(occ & CASTLE_WQ_EMPTY)) {
            if (!attacked(bb_row, 4, 1) && !attacked(bb_row, 3, 1)) {
                moves_out[n] = mk_move(4, 2, 0, 3);
                n += 1;
            }
        }
    } else {
        if ((castling & 4) && !(occ & CASTLE_BK_EMPTY)) {
            if (!attacked(bb_row, 60, 0) && !attacked(bb_row, 61, 0)) {
                moves_out[n] = mk_move(60, 62, 0, 3);
                n += 1;
            }
        }
        if ((castling & 8) && !(occ & CASTLE_BQ_EMPTY)) {
            if (!attacked(bb_row, 60, 0) && !attacked(bb_row, 59, 0)) {
                moves_out[n] = mk_move(60, 58, 0, 3);
                n += 1;
            }
        }
    }
    return n;
}

/* cg_movegen.py:186 gen_moves -- all pseudo-legal moves into moves_out. Returns the count. */
i64 gen_moves(const u64 *bb_row, const i64 *st_row, i64 *moves_out)
{
    u64 us = (st_row[0] == 0) ? bb_row[OCC_W] : bb_row[OCC_B];
    i64 n;

    n = gen_pawn_pushes(bb_row, st_row, moves_out, 0);
    n = gen_pawn_captures(bb_row, st_row, moves_out, n);
    n = gen_piece_moves(bb_row, st_row, moves_out, n, ~us);
    n = gen_castling(bb_row, st_row, moves_out, n);
    return n;
}

/* cg_movegen.py:197 gen_captures -- captures and queen promotions only: the quiescence set.
 * QUIRK: a straight push to the last rank yields the queen promotion only, while a CAPTURE
 * onto the last rank still expands to all four pieces (gen_pawn_captures is shared). */
i64 gen_captures(const u64 *bb_row, const i64 *st_row, i64 *moves_out)
{
    i64 side = st_row[0];
    i64 off = (side == 0) ? 0 : 6;
    u64 occ = bb_row[OCC_W] | bb_row[OCC_B];
    u64 them = (side == 0) ? bb_row[OCC_B] : bb_row[OCC_W];
    i64 n = 0;
    u64 pawns;
    u64 push;
    i64 back;
    u64 b;
    i64 to;

    /* a non-capturing push to the last rank is still a huge material swing */
    pawns = bb_row[off + WP];
    if (side == 0) {
        push = (pawns << (u64)8) & ~occ & RANK8;
        back = -8;
    } else {
        push = (pawns >> (u64)8) & ~occ & RANK1;
        back = 8;
    }
    b = push;
    while (b != U0) {
        to = lsb(b);
        b &= b - U1;
        moves_out[n] = mk_move(to + back, to, 4, 0);
        n += 1;
    }

    n = gen_pawn_captures(bb_row, st_row, moves_out, n);
    n = gen_piece_moves(bb_row, st_row, moves_out, n, them);
    return n;
}
