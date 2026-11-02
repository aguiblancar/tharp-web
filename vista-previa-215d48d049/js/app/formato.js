/* Tharp · aplicación · Formato de números y textos en estilo APA */

const f = (x, d = 2) =>
  x === null || x === undefined || !isFinite(x) ? '—' : Math.abs(x) >= 1e9 ? x.toExponential(2) : x.toFixed(d);
const nz = s => s.replace(/^(-?)0\./, '$1.');
// sin cero inicial (p, r, β)
const pv = p => (!isFinite(p) ? '—' : p < 0.001 ? '< .001' : nz(p.toFixed(3)));
// p en tablas
const pt = p => '<i>p</i> ' + (!isFinite(p) ? 'no calculable' : p < 0.001 ? '< .001' : '= ' + nz(p.toFixed(3)));
// p en texto
const r2s = r => nz(r.toFixed(2));
const dfF = d => (Math.abs(d - Math.round(d)) < 1e-9 ? String(Math.round(d)) : d.toFixed(2));
const stars = p => (p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : '');
// intervalo con extremos infinitos (hipótesis unilaterales) y valor de referencia sin ceros sobrantes
const ciTxt = c => `[${isFinite(c[0]) ? f(c[0]) : '−∞'}, ${isFinite(c[1]) ? f(c[1]) : '∞'}]`;
const fmtNum = v => String(Math.round(v * 1e6) / 1e6);
const J_inv = p => window.jStat.normal.inv(p, 0, 1),
  f_ = (x, d = 2) => f(x, d);
const lbl = {
  d: v => {
    v = Math.abs(v);
    return v < 0.2 ? 'trivial' : v < 0.5 ? 'pequeño' : v < 0.8 ? 'mediano' : 'grande';
  },
  eta: v => (v < 0.01 ? 'trivial' : v < 0.06 ? 'pequeño' : v < 0.14 ? 'mediano' : 'grande'),
  r: v => {
    v = Math.abs(v);
    return v < 0.1 ? 'trivial' : v < 0.3 ? 'pequeño' : v < 0.5 ? 'mediano' : 'grande';
  },
  corr: v => {
    v = Math.abs(v);
    return v < 0.1 ? 'muy débil' : v < 0.3 ? 'débil' : v < 0.5 ? 'moderada' : 'fuerte';
  },
};
const rn = n => (/^[A-Za-z.][A-Za-z0-9._]*$/.test(n) ? n : '`' + n.replace(/`/g, '\\`') + '`');
const rq = n => JSON.stringify(n);
const cmp = (a, b) => {
  const na = Number(a),
    nb = Number(b);
  return a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)
    ? na - nb
    : a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
};
const list = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]);

export { f, nz, pv, pt, r2s, dfF, stars, ciTxt, fmtNum, J_inv, f_, lbl, rn, rq, cmp, list };
