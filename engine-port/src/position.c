/* position.c -- port of engine/cg_position.py (Ransom chess engine). Read PORTING.md first.
 *
 * Board state is three parallel arrays indexed by ply, so make_move is a copy from ply to
 * ply + 1 and "unmake" is simply not advancing.
 *
 *   bb[ply]  u64[18]  12 piece bitboards + white/black occupancy + 4 mailbox words
 *                     (16 four-bit squares each: piece index 0..11, 15 = empty)
 *   st[ply]  i64[7]   side, castling rights, en-passant square (-1 none), halfmove clock,
 *                     incremental (mg, eg, phase)
 *   key[ply] u64      Zobrist hash, maintained incrementally
 *
 * The inline="always" helpers other files call (lsb, bishop_attacks, rook_attacks, mk_move,
 * piece_on_any, piece_on) are `static inline` in ransom.h and are not repeated here.
 * Not ported, as PORTING.md says: ray_attack (a copy lives in tables.c, which rebuilds the
 * slider tables from it), see_value (superseded by see_ge), new_state (arrays are static; rn_init
 * in api.c fills the mailbox words with FULL).
 */
#include "ransom.h"

/* cg_position.py:75 msb. Unused by the engine (only ray_attack called it); ported for completeness. */
static i64 msb(u64 b)
{
    b |= b >> (u64)1;
    b |= b >> (u64)2;
    b |= b >> (u64)4;
    b |= b >> (u64)8;
    b |= b >> (u64)16;
    b |= b >> (u64)32;
    return DEBRUIJN_IDX[((b - (b >> U1)) * DEBRUIJN) >> (u64)58];
}

/* cg_position.py:86 popcount */
i64 popcount(u64 b)
{
    i64 n = 0;
    while (b != U0) {
        b &= b - U1;
        n += 1;
    }
    return n;
}

/* cg_position.py:119 attacked: is `sq` attacked by the side named by `by_black`? */
int attacked(const u64 *bb_row, i64 sq, int by_black)
{
    u64 occ = bb_row[OCC_W] | bb_row[OCC_B];
    i64 off = by_black ? 6 : 0;
    u64 diag, ortho;
    /* index the pawn table by the DEFENDER's colour: a defending pawn on sq attacks exactly the
     * squares an attacking pawn would have to stand on. */
    if ((PAWN_ATT[IX_PAWN_ATT(by_black ? 0 : 1, sq)] & bb_row[off + WP]) != U0)
        return 1;
    if ((KNIGHT_ATT[sq] & bb_row[off + WN]) != U0)
        return 1;
    if ((KING_ATT[sq] & bb_row[off + WK]) != U0)
        return 1;
    diag = bb_row[off + WB] | bb_row[off + WQ];
    if (diag != U0 && (bishop_attacks(sq, occ) & diag) != U0)
        return 1;
    ortho = bb_row[off + WR] | bb_row[off + WQ];
    if (ortho != U0 && (rook_attacks(sq, occ) & ortho) != U0)
        return 1;
    return 0;
}

/* cg_position.py:142 in_check */
int in_check(const u64 *bb_row, i64 side)
{
    i64 off = side == 0 ? 0 : 6;
    return attacked(bb_row, lsb(bb_row[off + WK]), side == 0);
}

/* cg_position.py:153 mb_set: record piece `p` (0..11) on `sq` in the mailbox nibbles. */
static inline void mb_set(u64 *nb, i64 sq, i64 p)
{
    i64 w = MBX + (sq >> 4);
    u64 sh = (u64)((sq & 15) << 2);
    nb[w] = (nb[w] & ~((u64)15 << sh)) | ((u64)p << sh);
}

/* cg_position.py:161 mb_clear: mark `sq` empty (nibble 15) in the mailbox. */
static inline void mb_clear(u64 *nb, i64 sq)
{
    i64 w = MBX + (sq >> 4);
    nb[w] |= (u64)15 << (u64)((sq & 15) << 2);
}

/* cg_position.py:182 attackers_to: every piece of either colour attacking `sq`, given `occ`. */
static u64 attackers_to(const u64 *bb_row, i64 sq, u64 occ)
{
    u64 att, bat, rat;
    att = PAWN_ATT[IX_PAWN_ATT(1, sq)] & bb_row[WP];
    att |= PAWN_ATT[IX_PAWN_ATT(0, sq)] & bb_row[6 + WP];
    att |= KNIGHT_ATT[sq] & (bb_row[WN] | bb_row[6 + WN]);
    att |= KING_ATT[sq] & (bb_row[WK] | bb_row[6 + WK]);
    bat = bishop_attacks(sq, occ);
    att |= bat & (bb_row[WB] | bb_row[6 + WB] | bb_row[WQ] | bb_row[6 + WQ]);
    rat = rook_attacks(sq, occ);
    att |= rat & (bb_row[WR] | bb_row[6 + WR] | bb_row[WQ] | bb_row[6 + WQ]);
    return att;
}

/* cg_position.py:250 see_ge: is the exchange on `to` worth at least `threshold`?
 * QUIRK: the docstring says "same answer as see_value(...) >= threshold". That holds for
 * threshold 0 only (see_value stops early and is sign-accurate, not value-accurate). The search
 * asks see_ge, so see_ge is what is ported; never substitute see_value. */
int see_ge(const u64 *bb_row, i64 frm, i64 to, i64 side, i64 threshold)
{
    i64 captured = piece_on_any(bb_row, to);
    i64 attacker = piece_on_any(bb_row, frm);
    i64 balance, stm, off, found, fsq, p;
    u64 occ, atts, s;

    if (attacker < 0)
        return 0 >= threshold;
    /* `captured % 6` is only evaluated for captured >= 0, so C's % agrees with Python's */
    balance = (captured >= 0 ? (i64)SEE_VALUE[captured % 6] : 0) - threshold;
    if (balance < 0)
        return 0;
    balance -= (i64)SEE_VALUE[attacker % 6];
    if (balance >= 0)
        return 1;
    occ = (bb_row[OCC_W] | bb_row[OCC_B]) ^ (U1 << (u64)frm);
    stm = 1 - side;
    for (;;) {
        atts = attackers_to(bb_row, to, occ) & occ;
        off = stm == 0 ? 0 : 6;
        found = -1;
        fsq = 0;
        for (p = off; p < off + 6; p++) {
            s = atts & bb_row[p];
            if (s != U0) {
                fsq = lsb(s);
                found = p;
                break;
            }
        }
        if (found < 0)
            break;
        occ ^= U1 << (u64)fsq;
        /* negamax the balance: each side in turn must beat what the other just achieved */
        balance = -balance - 1 - (i64)SEE_VALUE[found % 6];
        stm = 1 - stm;
        if (balance >= 0)
            break;
    }
    return stm != side;
}

/* cg_position.py:300 make_move: copy-make ply -> ply + 1. Returns 0 if the move leaves our own
 * king in check. Row ply + 1 of bb, st and key is fully written even then. */
int make_move(u64 *bb, i64 *st, u64 *key, i64 ply, i64 move)
{
    u64 *nb = BB_ROW(bb, ply + 1);
    const u64 *ob = BB_ROW(bb, ply);
    i64 i;
    u64 k;
    i64 side, off, xoff, frm, to, promo, flag;
    u64 fbb, tbb;
    i64 piece, dmg, deg, dph, captured, capsq;
    u64 w, bl;
    i64 old_castle, new_castle, old_ep, new_ep;

    for (i = 0; i < NBB; i++)
        nb[i] = ob[i];
    k = key[ply];

    side = st[IX_ST(ply, 0)];
    off = side == 0 ? 0 : 6;
    xoff = 6 - off;
    frm = move & 63;
    to = (move >> 6) & 63;
    promo = (move >> 12) & 15;
    flag = (move >> 16) & 7;
    fbb = U1 << (u64)frm;
    tbb = U1 << (u64)to;

    piece = piece_on(nb, frm, off, off + 6);
    /* NOT IN THE PYTHON, memory safety only: a move whose `frm` holds no piece of the side to
     * move gives piece = -1. numba then wraps the negative index (nb[-1] is nb[17], a mailbox
     * word) and silently corrupts row ply + 1; in C the same access is out of bounds. The engine
     * only ever makes generated moves, so this cannot trigger for valid input and cannot change
     * a result. Such a move is reported as illegal. */
    if (piece < 0)
        return 0;
    nb[piece] ^= fbb | tbb;
    k ^= ZOB_PIECE[IX_ZOB_PIECE(piece, frm)] ^ ZOB_PIECE[IX_ZOB_PIECE(piece, to)];
    /* incremental (mg, eg, phase): the mover leaves frm and arrives on to */
    dmg = MG_SIGNED[IX_PSQ(piece, to)] - MG_SIGNED[IX_PSQ(piece, frm)];
    deg = EG_SIGNED[IX_PSQ(piece, to)] - EG_SIGNED[IX_PSQ(piece, frm)];
    dph = 0;

    captured = -1;
    if (flag == 2) {
        capsq = side == 0 ? to - 8 : to + 8;
        nb[xoff + WP] ^= U1 << (u64)capsq;
        k ^= ZOB_PIECE[IX_ZOB_PIECE(xoff + WP, capsq)];
        captured = xoff + WP;
        dmg -= MG_SIGNED[IX_PSQ(captured, capsq)];
        deg -= EG_SIGNED[IX_PSQ(captured, capsq)];
        dph -= (i64)PHASE_INC[captured];
        mb_clear(nb, capsq);
    } else {
        /* read the victim from the mailbox BEFORE the mover overwrites that square below */
        captured = piece_on(nb, to, xoff, xoff + 6);
        if (captured >= 0) {
            nb[captured] ^= tbb;
            k ^= ZOB_PIECE[IX_ZOB_PIECE(captured, to)];
            dmg -= MG_SIGNED[IX_PSQ(captured, to)];
            deg -= EG_SIGNED[IX_PSQ(captured, to)];
            dph -= (i64)PHASE_INC[captured];
        }
    }
    mb_clear(nb, frm);
    mb_set(nb, to, piece);

    if (promo != 0) {
        nb[piece] ^= tbb;
        nb[off + promo] |= tbb;
        k ^= ZOB_PIECE[IX_ZOB_PIECE(piece, to)] ^ ZOB_PIECE[IX_ZOB_PIECE(off + promo, to)];
        dmg += MG_SIGNED[IX_PSQ(off + promo, to)] - MG_SIGNED[IX_PSQ(piece, to)];
        deg += EG_SIGNED[IX_PSQ(off + promo, to)] - EG_SIGNED[IX_PSQ(piece, to)];
        dph += (i64)PHASE_INC[off + promo] - (i64)PHASE_INC[piece];
        mb_set(nb, to, off + promo);
    }

    if (flag == 3) {
        if (to == 6) {
            nb[WR] ^= (u64)0x00000000000000A0ULL;
            k ^= ZOB_PIECE[IX_ZOB_PIECE(WR, 7)] ^ ZOB_PIECE[IX_ZOB_PIECE(WR, 5)];
            dmg += MG_SIGNED[IX_PSQ(WR, 5)] - MG_SIGNED[IX_PSQ(WR, 7)];
            deg += EG_SIGNED[IX_PSQ(WR, 5)] - EG_SIGNED[IX_PSQ(WR, 7)];
            mb_clear(nb, 7);
            mb_set(nb, 5, WR);
        } else if (to == 2) {
            nb[WR] ^= (u64)0x0000000000000009ULL;
            k ^= ZOB_PIECE[IX_ZOB_PIECE(WR, 0)] ^ ZOB_PIECE[IX_ZOB_PIECE(WR, 3)];
            dmg += MG_SIGNED[IX_PSQ(WR, 3)] - MG_SIGNED[IX_PSQ(WR, 0)];
            deg += EG_SIGNED[IX_PSQ(WR, 3)] - EG_SIGNED[IX_PSQ(WR, 0)];
            mb_clear(nb, 0);
            mb_set(nb, 3, WR);
        } else if (to == 62) {
            nb[9] ^= (u64)0xA000000000000000ULL;
            k ^= ZOB_PIECE[IX_ZOB_PIECE(9, 63)] ^ ZOB_PIECE[IX_ZOB_PIECE(9, 61)];
            dmg += MG_SIGNED[IX_PSQ(9, 61)] - MG_SIGNED[IX_PSQ(9, 63)];
            deg += EG_SIGNED[IX_PSQ(9, 61)] - EG_SIGNED[IX_PSQ(9, 63)];
            mb_clear(nb, 63);
            mb_set(nb, 61, 9);
        } else {
            /* QUIRK: any other `to` (not only c8 = 58) takes the black queenside branch. */
            nb[9] ^= (u64)0x0900000000000000ULL;
            k ^= ZOB_PIECE[IX_ZOB_PIECE(9, 56)] ^ ZOB_PIECE[IX_ZOB_PIECE(9, 59)];
            dmg += MG_SIGNED[IX_PSQ(9, 59)] - MG_SIGNED[IX_PSQ(9, 56)];
            deg += EG_SIGNED[IX_PSQ(9, 59)] - EG_SIGNED[IX_PSQ(9, 56)];
            mb_clear(nb, 56);
            mb_set(nb, 59, 9);
        }
    }

    w = U0;
    bl = U0;
    for (i = 0; i < 6; i++) {
        w |= nb[i];
        bl |= nb[6 + i];
    }
    nb[OCC_W] = w;
    nb[OCC_B] = bl;

    old_castle = st[IX_ST(ply, 1)];
    new_castle = old_castle & CASTLE_MASK[frm] & CASTLE_MASK[to];
    old_ep = st[IX_ST(ply, 2)];
    new_ep = flag == 1 ? ((frm + to) / 2) : -1;     /* frm + to >= 0: / is Python's // here */

    k ^= ZOB_CASTLE[old_castle] ^ ZOB_CASTLE[new_castle];
    if (old_ep >= 0)
        k ^= ZOB_EP[old_ep & 7];
    if (new_ep >= 0)
        k ^= ZOB_EP[new_ep & 7];
    k ^= ZOB_SIDE;

    st[IX_ST(ply + 1, 0)] = 1 - side;
    st[IX_ST(ply + 1, 1)] = new_castle;
    st[IX_ST(ply + 1, 2)] = new_ep;
    if (piece == off + WP || captured >= 0)
        st[IX_ST(ply + 1, 3)] = 0;
    else
        st[IX_ST(ply + 1, 3)] = st[IX_ST(ply, 3)] + 1;
    st[IX_ST(ply + 1, 4)] = st[IX_ST(ply, 4)] + dmg;
    st[IX_ST(ply + 1, 5)] = st[IX_ST(ply, 5)] + deg;
    st[IX_ST(ply + 1, 6)] = st[IX_ST(ply, 6)] + dph;
    key[ply + 1] = k;

    return !attacked(nb, lsb(nb[off + WK]), side == 0);
}

/* cg_position.py:423 make_null: pass the move to the opponent. Used by null-move pruning. */
void make_null(u64 *bb, i64 *st, u64 *key, i64 ply)
{
    i64 i;
    u64 k;
    for (i = 0; i < NBB; i++)
        bb[IX_BB(ply + 1, i)] = bb[IX_BB(ply, i)];
    k = key[ply] ^ ZOB_SIDE;
    if (st[IX_ST(ply, 2)] >= 0)
        k ^= ZOB_EP[st[IX_ST(ply, 2)] & 7];
    st[IX_ST(ply + 1, 0)] = 1 - st[IX_ST(ply, 0)];
    st[IX_ST(ply + 1, 1)] = st[IX_ST(ply, 1)];
    st[IX_ST(ply + 1, 2)] = -1;
    st[IX_ST(ply + 1, 3)] = st[IX_ST(ply, 3)] + 1;
    st[IX_ST(ply + 1, 4)] = st[IX_ST(ply, 4)];
    st[IX_ST(ply + 1, 5)] = st[IX_ST(ply, 5)];
    st[IX_ST(ply + 1, 6)] = st[IX_ST(ply, 6)];
    key[ply + 1] = k;
}

/* cg_position.py:441 compute_key: full Zobrist recomputation. */
u64 compute_key(const u64 *bb, const i64 *st, i64 ply)
{
    u64 k = U0;
    u64 b;
    i64 p, sq;
    for (p = 0; p < 12; p++) {
        b = bb[IX_BB(ply, p)];
        while (b != U0) {
            sq = lsb(b);
            b &= b - U1;
            k ^= ZOB_PIECE[IX_ZOB_PIECE(p, sq)];
        }
    }
    k ^= ZOB_CASTLE[st[IX_ST(ply, 1)]];
    if (st[IX_ST(ply, 2)] >= 0)
        k ^= ZOB_EP[st[IX_ST(ply, 2)] & 7];
    if (st[IX_ST(ply, 0)] == 1)
        k ^= ZOB_SIDE;
    return k;
}

/* ---- helpers of set_fen: the pieces of Python that set_fen leans on ---- */

/* str.split() separators among the ASCII characters (str.isspace): TAB LF VT FF CR, the four
 * separators 0x1C..0x1F, and the space. */
static int fen_is_space(char c)
{
    return (c >= 0x09 && c <= 0x0D) || (c >= 0x1C && c <= 0x1F) || c == 0x20;
}

/* cg_position.py:468 CHAR_TO_PIECE; -1 stands for the KeyError. */
static i64 char_to_piece(char ch)
{
    switch (ch) {
    case 'P': return 0;
    case 'N': return 1;
    case 'B': return 2;
    case 'R': return 3;
    case 'Q': return 4;
    case 'K': return 5;
    case 'p': return 6;
    case 'n': return 7;
    case 'b': return 8;
    case 'r': return 9;
    case 'q': return 10;
    case 'k': return 11;
    default:  return -1;
    }
}

/* Python int(s) for an ASCII token, base 10: optional sign, digits, single underscores allowed
 * BETWEEN digits ("1_0" is 10). Returns 0 and the value in *out, or non-zero where Python raises
 * (ValueError, or OverflowError when the value does not fit the int64 array element). */
static int fen_parse_int(const char *s, i64 len, i64 *out)
{
    i64 i = 0;
    int neg = 0;
    int prev_digit = 0;
    u64 mag = U0;
    u64 limit;
    u64 d;

    if (i < len && (s[i] == '+' || s[i] == '-')) {
        neg = s[i] == '-';
        i++;
    }
    limit = neg ? ((u64)1 << 63) : (((u64)1 << 63) - U1);
    if (i >= len)
        return 1;
    for (; i < len; i++) {
        if (s[i] == '_') {
            if (!prev_digit || i + 1 >= len)
                return 1;
            prev_digit = 0;
        } else if (s[i] >= '0' && s[i] <= '9') {
            d = (u64)(s[i] - '0');
            if (mag > (limit - d) / (u64)10)
                return 1;
            mag = mag * (u64)10 + d;
            prev_digit = 1;
        } else {
            return 1;
        }
    }
    *out = neg ? (i64)(U0 - mag) : (i64)mag;
    return 0;
}

/* cg_position.py:474 set_fen: parse a FEN into ply 0. The Python raises on malformed input;
 * here the return value is 0 = ok, non-zero = the Python would have raised (ply 0 is then
 * unspecified). Accepts what the Python accepts, including its lack of validation:
 *   - the board field is not checked for rank lengths or piece counts; a piece simply lands on
 *     rank * 8 + file, and only a square outside 0..63 is an error (in the Python:
 *     np.uint64(negative) overflows, a square >= 64 indexes past the mailbox);
 *   - QUIRK: any side field other than exactly "w" means black;
 *   - QUIRK: castling letters are a substring test ("-" gives 0, other letters are ignored);
 *   - QUIRK: the en-passant field is trusted: ord(first char) - 97 + 8 * (int(second char) - 1),
 *     whatever the characters are, and characters after the second are ignored;
 *   - a missing halfmove field reads as 0; the fullmove field is ignored.
 * One deliberate narrowing: the buffer is bytes, not a Python str, so any byte >= 0x80 is
 * reported as malformed (Python would see Unicode characters there). */
int set_fen(u64 *bb, i64 *st, u64 *key, const char *fen)
{
    const char *part[5];
    i64 plen[5];
    i64 nparts = 0;
    i64 i, j, rank, file, sq, p, w, rights, mg, eg, phase, hm;
    u64 sh, wocc, bocc, bits;
    char ch;

    /* bb[0, :] = U0 ; bb[0, MBX:MBX + 4] = FULL */
    for (i = 0; i < NBB; i++)
        bb[IX_BB(0, i)] = U0;
    for (i = MBX; i < MBX + 4; i++)
        bb[IX_BB(0, i)] = FULL;

    /* parts = fen.split() -- only the first five parts are ever read */
    for (i = 0; fen[i] != '\0'; i++) {
        if ((unsigned char)fen[i] >= 0x80)
            return 1;
    }
    i = 0;
    for (;;) {
        while (fen[i] != '\0' && fen_is_space(fen[i]))
            i++;
        if (fen[i] == '\0')
            break;
        j = i;
        while (fen[j] != '\0' && !fen_is_space(fen[j]))
            j++;
        if (nparts < 5) {
            part[nparts] = fen + i;
            plen[nparts] = j - i;
        }
        nparts++;
        i = j;
    }
    if (nparts < 1)
        return 1;                               /* parts[0]: IndexError */

    rank = 7;
    file = 0;
    for (i = 0; i < plen[0]; i++) {
        ch = part[0][i];
        if (ch == '/') {
            rank -= 1;
            file = 0;
        } else if (ch >= '0' && ch <= '9') {    /* str.isdigit: '0' and '9' just add */
            file += (i64)(ch - '0');
        } else {
            sq = rank * 8 + file;
            p = char_to_piece(ch);
            if (p < 0)
                return 1;                       /* KeyError */
            if (sq < 0 || sq > 63)
                return 1;                       /* OverflowError / IndexError */
            bb[IX_BB(0, p)] |= U1 << (u64)sq;
            w = MBX + (sq >> 4);
            sh = (u64)((sq & 15) << 2);
            bb[IX_BB(0, w)] = (bb[IX_BB(0, w)] & ~((u64)15 << sh)) | ((u64)p << sh);
            file += 1;
        }
    }
    wocc = U0;
    bocc = U0;
    for (i = 0; i < 6; i++) {
        wocc |= bb[IX_BB(0, i)];
        bocc |= bb[IX_BB(0, 6 + i)];
    }
    bb[IX_BB(0, OCC_W)] = wocc;
    bb[IX_BB(0, OCC_B)] = bocc;

    if (nparts < 2)
        return 1;                               /* parts[1]: IndexError */
    st[IX_ST(0, 0)] = (plen[1] == 1 && part[1][0] == 'w') ? 0 : 1;

    if (nparts < 3)
        return 1;                               /* parts[2]: IndexError */
    rights = 0;
    for (i = 0; i < plen[2]; i++) {
        ch = part[2][i];
        if (ch == 'K')
            rights |= 1;
        else if (ch == 'Q')
            rights |= 2;
        else if (ch == 'k')
            rights |= 4;
        else if (ch == 'q')
            rights |= 8;
    }
    st[IX_ST(0, 1)] = rights;

    if (nparts < 4)
        return 1;                               /* parts[3]: IndexError */
    if (plen[3] == 1 && part[3][0] == '-') {
        st[IX_ST(0, 2)] = -1;
    } else {
        if (plen[3] < 2)
            return 1;                           /* parts[3][1]: IndexError */
        ch = part[3][1];
        if (ch < '0' || ch > '9')
            return 1;                           /* int(): ValueError */
        st[IX_ST(0, 2)] = ((i64)(unsigned char)part[3][0] - 97) + 8 * ((i64)(ch - '0') - 1);
    }

    if (nparts > 4) {
        if (fen_parse_int(part[4], plen[4], &hm))
            return 1;                           /* int(): ValueError / OverflowError */
        st[IX_ST(0, 3)] = hm;
    } else {
        st[IX_ST(0, 3)] = 0;
    }

    mg = 0;
    eg = 0;
    phase = 0;
    for (p = 0; p < 12; p++) {
        bits = bb[IX_BB(0, p)];
        while (bits != U0) {
            sq = lsb(bits);                     /* (bits & -bits).bit_length() - 1 */
            bits &= bits - U1;
            mg += MG_SIGNED[IX_PSQ(p, sq)];
            eg += EG_SIGNED[IX_PSQ(p, sq)];
            phase += (i64)PHASE_INC[p];
        }
    }
    st[IX_ST(0, 4)] = mg;
    st[IX_ST(0, 5)] = eg;
    st[IX_ST(0, 6)] = phase;
    key[0] = compute_key(bb, st, 0);
    return 0;
}

/* cg_position.py:527 move_to_uci: "e2e4" or "e7e8q" plus NUL into s (at least 6 bytes).
 * QUIRK: the Python raises KeyError for a promotion code outside 1..4; here such a code writes
 * no suffix. No generated move carries one. */
void move_to_uci(i64 move, char *s)
{
    static const char FILES[8] = { 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h' };     /* _FILES */
    static const char PROMO_CH[5] = { 0, 'n', 'b', 'r', 'q' };                   /* _PROMO_CH */
    i64 frm = move & 63;
    i64 to = (move >> 6) & 63;
    i64 promo = (move >> 12) & 15;
    i64 n = 0;
    s[n++] = FILES[frm & 7];
    s[n++] = (char)('0' + (frm >> 3) + 1);
    s[n++] = FILES[to & 7];
    s[n++] = (char)('0' + (to >> 3) + 1);
    if (promo >= 1 && promo <= 4)
        s[n++] = PROMO_CH[promo];
    s[n] = '\0';
}
