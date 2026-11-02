/* Tharp · motor estadístico · Correlaciones */
import { J, mean, ranks, sum } from './base.js';
import { pT, pZ } from './distribuciones.js';
import { olsCore } from './regresion.js';

function pearson(x, y) {
  const n = x.length,
    mx = mean(x),
    my = mean(y);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx,
      b = y[i] - my;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  const r = sxy / Math.sqrt(sxx * syy),
    t = r * Math.sqrt((n - 2) / (1 - r * r));
  return { r, n, df: n - 2, p: Math.abs(r) >= 1 ? 0 : pT(t, n - 2) };
}
// Spearman: con empates o n ≥ 1290, aproximación t; sin empates, distribución exacta de S = Σd² (n ≤ 9) o serie de Edgeworth
// (Best y Roberts, 1975, algoritmo AS 89), como cor.test de R y JASP
// distribuciones exactas de la S de Spearman ya calculadas, por tamaño de muestra
const cacheSpearman = {};
function spearmanUpper(is, n) {
  // P(S ≥ is)
  if (is <= 0) return 1;
  const n3 = (n * (n * n - 1)) / 3;
  if (is > n3) return 0;
  if (n <= 9) {
    let dist = cacheSpearman[n];
    if (!dist) {
      dist = new Map();
      const perm = Array.from({ length: n }, (_, i) => i),
        used = new Array(n).fill(false);
      const rec = (pos, s) => {
        if (pos === n) {
          dist.set(s, (dist.get(s) || 0) + 1);
          return;
        }
        for (let v = 0; v < n; v++)
          if (!used[v]) {
            used[v] = true;
            rec(pos + 1, s + (v - pos) ** 2);
            used[v] = false;
          }
      };
      rec(0, 0);
      cacheSpearman[n] = dist;
      void perm;
    }
    let tot = 0,
      up = 0;
    dist.forEach((c, s) => {
      tot += c;
      if (s >= is) up += c;
    });
    return up / tot;
  }
  const c = [0.2274, 0.2531, 0.1745, 0.0758, 0.1033, 0.3932, 0.0879, 0.0151, 0.0072, 0.0831, 0.0131, 4.6e-4];
  const b = 1 / n,
    x = ((6 * (is - 1) * b) / (n * n - 1) - 1) * Math.sqrt(1 / b - 1);
  let y = x * x;
  const u =
    x *
    b *
    (c[0] +
      b * (c[1] + c[2] * b) +
      y *
        (-c[3] +
          b * (c[4] + c[5] * b) -
          y * b * (c[6] + c[7] * b - y * (c[8] - c[9] * b + y * b * (c[10] - c[11] * y)))));
  y = u / Math.exp(y / 2);
  return Math.max(0, Math.min(1, y + (1 - J.normal.cdf(x, 0, 1))));
}
function spearman(x, y) {
  const rx = ranks(x),
    ry = ranks(y),
    r0 = pearson(rx.r, ry.r),
    n = x.length;
  if (rx.ties || ry.ties || n >= 1290 || n < 3 || Math.abs(r0.r) >= 1) return Object.assign(r0, { exact: false });
  const q = ((n ** 3 - n) * (1 - r0.r)) / 6,
    half = (n ** 3 - n) / 6;
  const p = q > half ? spearmanUpper(Math.round(q - 1), n) : 1 - spearmanUpper(Math.round(q) + 2, n);
  return Object.assign(r0, { p: Math.min(1, 2 * p), exact: true, S: q });
}
// tau-b de Kendall: p exacta sin empates y n < 50 (distribución del número de pares concordantes), si no, aproximación normal
// con la varianza corregida por empates, como cor.test(method = "kendall") de R
function kendall(x, y) {
  const n = x.length;
  let S = 0,
    tx = 0,
    ty = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = Math.sign(x[i] - x[j]),
        b = Math.sign(y[i] - y[j]);
      S += a * b;
      if (a === 0) tx++;
      if (b === 0) ty++;
    }
  const n0 = (n * (n - 1)) / 2,
    tau = S / Math.sqrt((n0 - tx) * (n0 - ty));
  if (!tx && !ty && n < 50) {
    // número de permutaciones con k inversiones (números mahonianos); T = pares concordantes = n0 − inversiones
    let c = [1];
    for (let m = 2; m <= n; m++) {
      const nc = new Array(c.length + m - 1).fill(0);
      c.forEach((v, k) => {
        for (let j = 0; j < m; j++) nc[k + j] += v;
      });
      c = nc;
    }
    const tot = c.reduce((a, b) => a + b, 0),
      T = (S + n0) / 2,
      cdf = t => {
        let s = 0;
        for (let k = 0; k <= Math.min(t, c.length - 1); k++) s += c[k];
        return s / tot;
      };
    const p = T > n0 / 2 ? 1 - cdf(Math.round(T) - 1) : cdf(Math.round(T));
    return { r: tau, tau, n, df: n - 2, p: Math.min(1, 2 * p), exact: true, z: null };
  }
  const tc = v => {
    const m = new Map();
    v.forEach(q => m.set(q, (m.get(q) || 0) + 1));
    return [...m.values()].filter(t => t > 1);
  };
  const xt = tc(x),
    yt = tc(y),
    v0 = n * (n - 1) * (2 * n + 5),
    vt = sum(xt.map(t => t * (t - 1) * (2 * t + 5))),
    vu = sum(yt.map(t => t * (t - 1) * (2 * t + 5)));
  const v1 = sum(xt.map(t => t * (t - 1))) * sum(yt.map(t => t * (t - 1))),
    v2 = sum(xt.map(t => t * (t - 1) * (t - 2))) * sum(yt.map(t => t * (t - 1) * (t - 2)));
  const varS = (v0 - vt - vu) / 18 + v1 / (2 * n * (n - 1)) + v2 / (9 * n * (n - 1) * (n - 2)),
    z = S / Math.sqrt(varS);
  return { r: tau, tau, n, df: n - 2, p: pZ(z), exact: false, z };
}
// IC 95 % de una correlación por la transformación z de Fisher; EE de Bonett y Wright (2000) para Spearman y de Fieller et al. (1957) para Kendall
function corrCI(r, n, method = 'pearson', level = 0.95) {
  const se =
    method === 'kendall'
      ? Math.sqrt(0.437 / (n - 4))
      : method === 'spearman'
        ? Math.sqrt((1 + (r * r) / 2) / (n - 3))
        : 1 / Math.sqrt(n - 3);
  const z = Math.atanh(Math.max(-0.9999999, Math.min(0.9999999, r))),
    q = J.normal.inv(1 - (1 - level) / 2, 0, 1);
  return [Math.tanh(z - q * se), Math.tanh(z + q * se)];
}
// correlación parcial: correlación entre los residuos de x e y tras regresarlas sobre las covariables (gl = n − 2 − q);
// con method = 'spearman', sobre los rangos (como ppcor)
function partialCorr(x, y, Z, method = 'pearson') {
  const rk = v => ranks(v).r,
    X = method === 'spearman' ? rk(x) : x,
    Yv = method === 'spearman' ? rk(y) : y;
  const Zm = method === 'spearman' ? Z.map(rk) : Z,
    n = x.length,
    q = Z.length;
  const D = Array.from({ length: n }, (_, i) => [1].concat(Zm.map(z => z[i])));
  const ex = olsCore(D, X),
    ey = olsCore(D, Yv);
  if (!ex || !ey) return null;
  const r = pearson(ex.e, ey.e).r,
    df = n - 2 - q,
    t = r * Math.sqrt(df / (1 - r * r));
  return { r, n, df, q, p: Math.abs(r) >= 1 ? 0 : pT(t, df), t };
}
function corMatrix(X) {
  // X: n × p
  const p = X[0].length,
    cols = Array.from({ length: p }, (_, j) => X.map(r => r[j]));
  return cols.map((a, i) => cols.map((b, j) => (i === j ? 1 : pearson(a, b).r)));
}

export { pearson, spearmanUpper, spearman, kendall, corrCI, partialCorr, corMatrix };
