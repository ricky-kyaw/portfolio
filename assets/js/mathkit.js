// Exact arithmetic for the notebook cell. Written by hand, no eval().
// Whole numbers use BigInt, so 2^64 prints 18446744073709551616 exactly.
// Anything with a decimal point, or a division that does not come out even,
// falls back to ordinary floating point.

const MAX_POW = 4096;        // largest exponent we will compute exactly
const MAX_FACT = 1000n;      // largest n for n!
const MAX_FIB = 10000;       // largest n for fib n
const SHOW_DIGITS = 200;     // longer results are shortened in the middle
const MAX_BITS = 300000n;    // largest result we will build for a power

class MathError extends Error {}

// ---------- tokenizer ----------

function tokenize(src) {
  const out = [];
  let i = 0;
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9_]/.test(s[j])) j++;
      // 1,000,000 is one number when every comma is followed by exactly three digits.
      while (s[j] === ',' && /^\d{3}$/.test(s.slice(j + 1, j + 4)) && !/\d/.test(s[j + 4] || '')) j += 4;
      let isFloat = false;
      if (s[j] === '.') { isFloat = true; j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      if (/[eE]/.test(s[j] || '') && /[0-9+-]/.test(s[j + 1] || '')) {
        isFloat = true; j++;
        if (/[+-]/.test(s[j])) j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      const text = s.slice(i, j).replace(/[_,]/g, '');
      if (text === '.') throw new MathError('I did not understand that number.');
      out.push({ t: 'num', v: text, isFloat });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z0-9]/i.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/^%!(),'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new MathError(`I do not know what "${c}" means here.`);
  }
  return out;
}

// ---------- parser (recursive descent) ----------
// expr   := term (('+'|'-') term)*
// term   := unary (('*'|'/'|'%') unary)*
// unary  := '-' unary | power
// power  := postfix ('^' unary)?           (right-associative)
// postfix:= atom ('!')*
// atom   := num | id | id '(' args ')' | '(' expr ')'

function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => {
    if (!tokens[p] || tokens[p].t !== t) throw new MathError(t === ')' ? 'A bracket was not closed.' : 'That does not read as a sum.');
    return tokens[p++];
  };

  function expr() {
    let node = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[p++].t;
      node = { k: 'bin', op, a: node, b: term() };
    }
    return node;
  }
  function term() {
    let node = unary();
    while (peek() && (peek().t === '*' || peek().t === '/' || peek().t === '%')) {
      const op = tokens[p++].t;
      node = { k: 'bin', op, a: node, b: unary() };
    }
    return node;
  }
  function unary() {
    if (peek() && peek().t === '-') { p++; return { k: 'neg', a: unary() }; }
    if (peek() && peek().t === '+') { p++; return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (peek() && peek().t === '^') { p++; return { k: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function postfix() {
    let node = atom();
    while (peek() && peek().t === '!') { p++; node = { k: 'fact', a: node }; }
    return node;
  }
  function atom() {
    const tk = peek();
    if (!tk) throw new MathError('The sum ended early.');
    if (tk.t === 'num') { p++; return { k: 'num', v: tk.v, isFloat: tk.isFloat }; }
    if (tk.t === 'id') {
      p++;
      if (peek() && peek().t === '(') {
        p++;
        const args = [];
        if (!(peek() && peek().t === ')')) {
          args.push(expr());
          while (peek() && peek().t === ',') { p++; args.push(expr()); }
        }
        eat(')');
        return { k: 'call', name: tk.v, args };
      }
      return { k: 'const', name: tk.v };
    }
    if (tk.t === '(') { p++; const e = expr(); eat(')'); return e; }
    throw new MathError('That does not read as a sum.');
  }

  const tree = expr();
  if (p !== tokens.length) throw new MathError('There is something extra at the end.');
  return tree;
}

// ---------- values: {big: BigInt} or {num: Number} ----------

const big = (v) => ({ big: v });
const num = (v) => ({ num: v });
const toNum = (x) => ('big' in x ? Number(x.big) : x.num);

function bigPow(a, e) {
  if (e > BigInt(MAX_POW)) throw new MathError(`Powers above ${MAX_POW} are too big to print here.`);
  const mag = a < 0n ? -a : a;
  if (mag > 1n && BigInt(mag.toString(2).length) * e > MAX_BITS) throw new MathError('That result would have too many digits to print here.');
  let r = 1n, b = a, n = e;
  while (n > 0n) { if (n & 1n) r *= b; b *= b; n >>= 1n; }
  return r;
}

export function factorial(n) {
  if (n < 0n) throw new MathError('Factorial needs a whole number that is not negative.');
  if (n > MAX_FACT) throw new MathError(`Factorials above ${MAX_FACT}! are too big to print here.`);
  let r = 1n;
  for (let i = 2n; i <= n; i++) r *= i;
  return r;
}

const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 };
const FUNCS = {
  sqrt: (x) => Math.sqrt(x), abs: (x) => Math.abs(x), ln: (x) => Math.log(x), log: (x) => Math.log10(x),
  log2: (x) => Math.log2(x), exp: (x) => Math.exp(x), sin: Math.sin, cos: Math.cos, tan: Math.tan,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
};

function evalNode(n) {
  switch (n.k) {
    case 'num':
      return n.isFloat ? num(parseFloat(n.v)) : big(BigInt(n.v));
    case 'const':
      if (n.name in CONSTS) return num(CONSTS[n.name]);
      throw new MathError(`I do not know "${n.name}".`);
    case 'neg': {
      const a = evalNode(n.a);
      return 'big' in a ? big(-a.big) : num(-a.num);
    }
    case 'fact': {
      const a = evalNode(n.a);
      if (!('big' in a)) throw new MathError('Factorial needs a whole number.');
      return big(factorial(a.big));
    }
    case 'call': {
      const f = FUNCS[n.name];
      if (!f) throw new MathError(`I do not know "${n.name}".`);
      const args = n.args.map(evalNode);
      if (n.name === 'sqrt' && args.length === 1 && 'big' in args[0] && args[0].big >= 0n) {
        // exact square roots stay exact
        const r = isqrt(args[0].big);
        if (r * r === args[0].big) return big(r);
      }
      if (n.name === 'abs' && args.length === 1 && 'big' in args[0]) return big(args[0].big < 0n ? -args[0].big : args[0].big);
      if (args.length !== 1) throw new MathError(`${n.name} takes one number.`);
      return num(f(toNum(args[0])));
    }
    case 'bin': {
      const a = evalNode(n.a);
      const b = evalNode(n.b);
      const both = 'big' in a && 'big' in b;
      switch (n.op) {
        case '+': return both ? big(a.big + b.big) : num(toNum(a) + toNum(b));
        case '-': return both ? big(a.big - b.big) : num(toNum(a) - toNum(b));
        case '*': return both ? big(a.big * b.big) : num(toNum(a) * toNum(b));
        case '/':
          if (both) {
            if (b.big === 0n) throw new MathError('You cannot divide by zero.');
            if (a.big % b.big === 0n) return big(a.big / b.big);
          }
          if (toNum(b) === 0) throw new MathError('You cannot divide by zero.');
          return num(toNum(a) / toNum(b));
        case '%':
          if (both) {
            if (b.big === 0n) throw new MathError('You cannot divide by zero.');
            return big(((a.big % b.big) + b.big) % b.big);
          }
          return num(toNum(a) % toNum(b));
        case '^':
          if (both) {
            if (b.big >= 0n) return big(bigPow(a.big, b.big));
            return num(Math.pow(toNum(a), toNum(b)));
          }
          return num(Math.pow(toNum(a), toNum(b)));
        default:
          throw new MathError('Unknown operator.');
      }
    }
    default:
      throw new MathError('I could not work that out.');
  }
}

export function isqrt(n) {
  if (n < 0n) throw new MathError('No real square root of a negative number.');
  if (n < 2n) return n;
  // Start above the root and let Newton's method walk down. It stops on the
  // exact floor in a handful of steps, however big n is.
  let x = 1n << BigInt((n.toString(2).length >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

// ---------- formatting ----------

export function formatBig(v) {
  const s = v.toString();
  if (s.length <= SHOW_DIGITS) return groupDigits(s);
  return `${s.slice(0, 60)} … ${s.slice(-40)}  (${s.length} digits)`;
}

function groupDigits(s) {
  const neg = s.startsWith('-');
  const digits = neg ? s.slice(1) : s;
  if (digits.length <= 6) return s;
  return (neg ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatNum(v) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'not a number' : v > 0 ? 'infinity' : '-infinity';
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return groupDigits(String(v));
  let s = v.toPrecision(12);
  if (s.includes('e')) return s.replace(/\.?0+e/, 'e');
  s = s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  return s;
}

function formatValue(x) {
  return 'big' in x ? formatBig(x.big) : formatNum(x.num);
}

// Does this look like something to calculate, rather than a command?
export function looksLikeMath(text) {
  const t = text.trim();
  if (!t) return false;
  let toks;
  try {
    toks = tokenize(t);
  } catch (e) {
    return false;
  }
  if (!toks.length) return false;
  // Every word must be a known constant or function: "2*pi" is math, "e-mail" is not.
  const known = (k) => k.v in CONSTS || k.v in FUNCS;
  if (!toks.every((k) => k.t !== 'id' || known(k))) return false;
  if (toks.some((k) => k.t === 'num')) return true;
  if (toks.every((k) => k.t === 'id' && k.v in CONSTS)) return true; // "pi" on its own
  return toks.some((k) => '+-*/^%!('.includes(k.t)) && toks.some((k) => k.t === 'id');
}

// Main entry: returns {ok: true, text} or {ok: false, text}.
export function evaluate(text) {
  try {
    const tokens = tokenize(text);
    if (!tokens.length) return { ok: false, text: 'Type a sum, like 2^64 or 17 * 23.' };
    const tree = parse(tokens);
    const value = evalNode(tree);
    if ('num' in value && Number.isNaN(value.num)) return { ok: false, text: 'There is no real answer to that.' };
    if ('num' in value && !Number.isFinite(value.num)) return { ok: false, text: 'That number is too big to work out here.' };
    return { ok: true, text: formatValue(value) };
  } catch (e) {
    if (e instanceof MathError) return { ok: false, text: e.message };
    if (e instanceof RangeError) return { ok: false, text: 'That number is too big to work out here.' };
    return { ok: false, text: 'I could not work that out.' };
  }
}

// ---------- primes ----------

const SMALL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];

function modPow(b, e, m) {
  let r = 1n;
  b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}

// Deterministic Miller-Rabin. With the prime bases up to 41 the answer is
// exact for every n < 3,317,044,064,679,887,385,961,981 (about 3.3 x 10^24),
// which covers every number of 24 digits or fewer.
export function isPrime(n) {
  if (n < 2n) return false;
  for (const p of SMALL_PRIMES) { if (n === p) return true; if (n % p === 0n) return false; }
  let d = n - 1n, r = 0n;
  while ((d & 1n) === 0n) { d >>= 1n; r++; }
  outer: for (const a of SMALL_PRIMES) {
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let i = 1n; i < r; i++) {
      x = (x * x) % n;
      if (x === n - 1n) continue outer;
    }
    return false;
  }
  return true;
}

// Smallest factor by trial division up to `limit`, or null.
export function smallFactor(n, limit = 1000000n) {
  if (n % 2n === 0n) return 2n;
  if (n % 3n === 0n) return 3n;
  for (let f = 5n; f * f <= n && f <= limit; f += 6n) {
    if (n % f === 0n) return f;
    if (n % (f + 2n) === 0n) return f + 2n;
  }
  return null;
}

export function primeReport(raw) {
  const s = String(raw).replace(/[,_\s]/g, '');
  if (!/^\d+$/.test(s)) return 'Give me a whole number, like: prime 1000000007';
  if (s.length > 24) return 'I can check numbers up to 24 digits exactly. That one is longer.';
  const n = BigInt(s);
  if (n < 2n) return `${formatBig(n)} is not prime. Primes start at 2.`;
  if (isPrime(n)) return `${formatBig(n)} is prime.`;
  const f = smallFactor(n);
  if (f) return `${formatBig(n)} is not prime. It divides by ${formatBig(f)}: ${formatBig(f)} × ${formatBig(n / f)}.`;
  return `${formatBig(n)} is not prime, but all of its factors are above a million.`;
}

// ---------- Fibonacci by fast doubling ----------

export function fib(n) {
  // returns [F(n), F(n+1)]
  if (n === 0) return [0n, 1n];
  const [a, b] = fib(Math.floor(n / 2));
  const c = a * (2n * b - a);
  const d = a * a + b * b;
  return n % 2 === 0 ? [c, d] : [d, c + d];
}

export function fibReport(raw) {
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return 'Give me a whole number, like: fib 90';
  const n = Number(s);
  if (n > MAX_FIB) return `I stop at fib ${MAX_FIB}. That one has more digits than fit here.`;
  const [f] = fib(n);
  return `fib(${n}) = ${formatBig(f)}`;
}

export function gcd(a, b) {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}
