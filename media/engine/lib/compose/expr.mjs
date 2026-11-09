// Anchor expressions — the timing language of storyboards and presets. PURE.
//
//   expr := ternary ; ternary := or ('?' expr ':' expr)? ; or := and ('||' and)*
//   and := cmp ('&&' cmp)* ; cmp := sum (op sum)? ; sum := prod (('+'|'-') prod)*
//   prod := unary (('*'|'/') unary)* ; unary := ('-'|'!') unary | fallback
//   fallback := postfix ('??' postfix)* ; primary := number | string | ref | func(args) | (expr)
//
// Refs (`plan.stampAt`, `$clip`, `vo.line.end`, `beat.next`) are looked up through a
// resolver; an unknown ref is `undefined` (use `??` for fallbacks). Functions:
// max, min, clamp, round, abs, beatAfter, beatBefore, defined.

const TOKEN_RE = /\s*(?:(\d+(?:\.\d+)?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\$?[A-Za-z_](?:\w|-(?=[A-Za-z]))*(?:\.(?:[A-Za-z_](?:\w|-(?=[A-Za-z]))*|\d+))*)|(\?\?|==|!=|<=|>=|&&|\|\||[-+*/?:(),<>!]))/y;

export class ExprError extends Error {}

export function tokenize(src) {
  const out = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw new ExprError(`unexpected "${src.slice(pos).trim().slice(0, 12)}" in "${src}"`);
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].slice(1, -1).replace(/\\(.)/g, '$1') });
    else if (m[3] !== undefined) out.push({ t: 'id', v: m[3] });
    else out.push({ t: 'op', v: m[4] });
  }
  return out;
}

/** Parse to an AST (cached by source). */
const cache = new Map();
export function parse(src) {
  const key = String(src);
  if (cache.has(key)) return cache.get(key);
  const toks = tokenize(key);
  let i = 0;
  const peek = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const eat = (v) => {
    if (!peek(v)) throw new ExprError(`expected "${v}" in "${key}"`);
    i++;
  };
  const expr = () => ternary();
  const ternary = () => {
    const c = or();
    if (peek('?')) {
      i++;
      const a = expr();
      eat(':');
      const b = expr();
      return { k: 'if', c, a, b };
    }
    return c;
  };
  const binary = (next, ops) => () => {
    let l = next();
    while (toks[i] && toks[i].t === 'op' && ops.includes(toks[i].v)) {
      const op = toks[i++].v;
      l = { k: 'bin', op, l, r: next() };
    }
    return l;
  };
  const primary = () => {
    const tok = toks[i++];
    if (!tok) throw new ExprError(`unexpected end of "${key}"`);
    if (tok.t === 'num' || tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'op' && tok.v === '(') {
      const e = expr();
      eat(')');
      return e;
    }
    if (tok.t === 'id') {
      if (peek('(')) {
        i++;
        const args = [];
        if (!peek(')')) {
          args.push(expr());
          while (peek(',')) {
            i++;
            args.push(expr());
          }
        }
        eat(')');
        return { k: 'call', f: tok.v, args };
      }
      if (tok.v === 'true' || tok.v === 'false') return { k: 'lit', v: tok.v === 'true' };
      if (tok.v === 'null') return { k: 'lit', v: null };
      return { k: 'ref', path: tok.v };
    }
    throw new ExprError(`unexpected "${tok.v}" in "${key}"`);
  };
  const fallback = () => {
    let l = primary();
    while (peek('??')) {
      i++;
      l = { k: 'bin', op: '??', l, r: primary() };
    }
    return l;
  };
  const unary = () => {
    if (peek('-')) {
      i++;
      return { k: 'neg', e: unary() };
    }
    if (peek('!')) {
      i++;
      return { k: 'not', e: unary() };
    }
    return fallback();
  };
  const prod = binary(unary, ['*', '/']);
  const sum = binary(prod, ['+', '-']);
  const cmp = () => {
    const l = sum();
    if (toks[i] && toks[i].t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(toks[i].v)) {
      const op = toks[i++].v;
      return { k: 'bin', op, l, r: sum() };
    }
    return l;
  };
  const and = binary(cmp, ['&&']);
  const or = binary(and, ['||']);
  const ast = expr();
  if (i < toks.length) throw new ExprError(`unexpected "${toks[i].v}" in "${key}"`);
  cache.set(key, ast);
  return ast;
}

const num = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ExprError(`${what}: expected a number, got ${v === undefined ? 'undefined' : JSON.stringify(v)}`);
  return v;
};

const FUNCS = {
  max: (...a) => Math.max(...a.filter((x) => x !== undefined && x !== null)),
  min: (...a) => Math.min(...a.filter((x) => x !== undefined && x !== null)),
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  round: (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d,
  abs: (x) => Math.abs(x),
  defined: (x) => x !== undefined && x !== null,
};

/**
 * Evaluate `src` (number | string expression) with `resolve(path) → value`. `ctx.beats`
 * (sorted seconds, optional) powers beatAfter/beatBefore.
 */
export function evaluate(src, resolve, ctx = {}) {
  if (typeof src === 'number' || typeof src === 'boolean' || src === null || src === undefined) return src;
  const ev = (n) => {
    switch (n.k) {
      case 'lit':
        return n.v;
      case 'ref':
        return resolve(n.path);
      case 'neg':
        return -num(ev(n.e), `-${JSON.stringify(n.e.path ?? '')}`);
      case 'not':
        return !ev(n.e);
      case 'if':
        return ev(n.c) ? ev(n.a) : ev(n.b);
      case 'call': {
        const args = n.args.map(ev);
        if (n.f === 'beatAfter' || n.f === 'beatBefore') {
          const beats = ctx.beats ?? [];
          const t = num(args[0], n.f);
          const k = args[1] ?? 1;
          if (n.f === 'beatAfter') return beats.filter((b) => b > t + 1e-6)[k - 1];
          return beats.filter((b) => b < t - 1e-6).at(-k);
        }
        const f = FUNCS[n.f];
        if (!f) throw new ExprError(`unknown function ${n.f}()`);
        return f(...args);
      }
      case 'bin': {
        if (n.op === '??') {
          const l = ev(n.l);
          return l === undefined || l === null ? ev(n.r) : l;
        }
        if (n.op === '&&') return ev(n.l) && ev(n.r);
        if (n.op === '||') return ev(n.l) || ev(n.r);
        const l = ev(n.l);
        const r = ev(n.r);
        switch (n.op) {
          case '==':
            return l === r;
          case '!=':
            return l !== r;
          case '<':
            return l < r;
          case '<=':
            return l <= r;
          case '>':
            return l > r;
          case '>=':
            return l >= r;
          case '+':
            return num(l, 'left of +') + num(r, 'right of +');
          case '-':
            return num(l, 'left of -') - num(r, 'right of -');
          case '*':
            return num(l, 'left of *') * num(r, 'right of *');
          case '/':
            return num(l, 'left of /') / num(r, 'right of /');
          default:
            throw new ExprError(`unknown operator ${n.op}`);
        }
      }
      default:
        throw new ExprError('bad expression');
    }
  };
  const s = String(src).trim();
  return ev(parse(s));
}

/** Every ref path an expression reads (for validation / dependency hints). Pure. */
export function refsOf(src) {
  if (typeof src !== 'string') return [];
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.k === 'ref') out.push(n.path);
    for (const key of ['l', 'r', 'c', 'a', 'b', 'e']) walk(n[key]);
    (n.args ?? []).forEach(walk);
  };
  walk(parse(src.trim()));
  return out;
}
