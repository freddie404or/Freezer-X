// Safe math expression evaluator (recursive descent). No eval(), no Function().
const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: Math.log10, ln: Math.log, exp: Math.exp,
};
const CONSTS = { pi: Math.PI, e: Math.E };

export function evaluate(input) {
  const src = String(input).toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '').replace(/\s+/g, '');
  if (!src) throw new Error('Empty expression.');
  if (src.length > 200) throw new Error('Expression too long.');
  let i = 0;

  const peek = () => src[i];
  const eat = (ch) => (src[i] === ch ? (i++, true) : false);

  function parseExpr() {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') v = src[i++] === '+' ? v + parseTerm() : v - parseTerm();
    return v;
  }
  function parseTerm() {
    let v = parsePower();
    for (;;) {
      if (eat('*')) v *= parsePower();
      else if (eat('/')) {
        const d = parsePower();
        if (d === 0) throw new Error('Division by zero.');
        v /= d;
      } else if (eat('%')) v %= parsePower();
      else if (peek() && /[a-z(]/.test(peek())) v *= parsePower(); // implicit multiplication: 2pi, 3(4+1)
      else return v;
    }
  }
  function parsePower() {
    const base = parseUnary();
    if (eat('^') || (peek() === '*' && src[i + 1] === '*' && (i += 2))) return base ** parsePower();
    return base;
  }
  function parseUnary() {
    if (eat('-')) return -parseUnary();
    if (eat('+')) return parseUnary();
    return parsePrimary();
  }
  function parsePrimary() {
    if (eat('(')) {
      const v = parseExpr();
      if (!eat(')')) throw new Error('Missing closing parenthesis.');
      return v;
    }
    const num = /^\d*\.?\d+(?:e[+-]?\d+)?/.exec(src.slice(i));
    if (num) { i += num[0].length; return parseFloat(num[0]); }
    const id = /^[a-z]+/.exec(src.slice(i));
    if (id) {
      i += id[0].length;
      if (id[0] in CONSTS) return CONSTS[id[0]];
      if (id[0] in FUNCS) {
        if (!eat('(')) throw new Error(`Use ${id[0]}(…) with parentheses.`);
        const v = parseExpr();
        if (!eat(')')) throw new Error('Missing closing parenthesis.');
        return FUNCS[id[0]](v);
      }
      throw new Error(`Unknown word "${id[0]}".`);
    }
    throw new Error(`Unexpected "${peek() ?? 'end'}" in expression.`);
  }

  const result = parseExpr();
  if (i < src.length) throw new Error(`Unexpected "${src[i]}" in expression.`);
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number.');
  return result;
}
