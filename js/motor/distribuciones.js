/* Tharp · motor estadístico · Distribuciones de probabilidad, valores críticos y distribuciones exactas */
import { J, lfact } from './base.js';

const pT = (t, df) => 2 * (1 - J.studentt.cdf(Math.abs(t), df));
const pF = (F, d1, d2) => 1 - J.centralF.cdf(F, d1, d2);
const pChi = (x, df) => 1 - J.chisquare.cdf(x, df);
const pZ = z => 2 * (1 - J.normal.cdf(Math.abs(z), 0, 1));
const tcrit = df => J.studentt.inv(0.975, df);
// p según la hipótesis alternativa: 'two' (bilateral), 'greater' (estadístico mayor que lo esperado), 'less'
const pTalt = (t, df, alt) =>
  alt === 'greater' ? 1 - J.studentt.cdf(t, df) : alt === 'less' ? J.studentt.cdf(t, df) : pT(t, df);
const pZalt = (z, alt) =>
  alt === 'greater' ? 1 - J.normal.cdf(z, 0, 1) : alt === 'less' ? J.normal.cdf(z, 0, 1) : pZ(z);
// función de distribución de la t no central (algoritmo AS 243 de Lenth, como pt(ncp =) de R)
function pnct(t, df, ncp) {
  let tt = t,
    del = ncp,
    neg = false;
  if (t < 0) {
    neg = true;
    tt = -t;
    del = -ncp;
  }
  if (df > 4e5 || del * del > 2 * Math.LN2 * 1021) {
    // como R: aproximación de Abramowitz y Stegun 26.7.10 cuando la serie desborda
    const s = 1 / (4 * df),
      pr = J.normal.cdf(tt * (1 - s), del, Math.sqrt(1 + tt * tt * 2 * s));
    return neg ? 1 - pr : pr;
  }
  const x = (tt * tt) / (tt * tt + df);
  let tnc = 0;
  if (x > 0) {
    const lambda = del * del;
    let p = 0.5 * Math.exp(-0.5 * lambda),
      q = Math.sqrt(2 / Math.PI) * p * del,
      s = 0.5 - p;
    if (s < 1e-7) s = -0.5 * Math.expm1(-0.5 * lambda);
    let a = 0.5;
    const b = 0.5 * df,
      rxb = Math.pow(1 - x, b),
      albeta = 0.5 * Math.log(Math.PI) + J.gammaln(b) - J.gammaln(0.5 + b);
    let xodd = J.ibeta(x, a, b),
      godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta),
      xeven = b * x < 2.2e-16 ? b * x : 1 - rxb,
      geven = b * x * rxb;
    tnc = p * xodd + q * xeven;
    for (let it = 1; it <= 2000; it++) {
      a += 1;
      xodd -= godd;
      xeven -= geven;
      godd *= (x * (a + b - 1)) / a;
      geven *= (x * (a + b - 0.5)) / (a + 0.5);
      p *= lambda / (2 * it);
      q *= lambda / (2 * it + 1);
      tnc += p * xodd + q * xeven;
      s -= p;
      if (s < -1e-10 || (s <= 0 && it > 1)) break;
      if (Math.abs(2 * s * (xodd - godd)) < 1e-12) break;
    }
  }
  tnc += J.normal.cdf(-del, 0, 1);
  tnc = Math.min(tnc, 1);
  return neg ? 1 - tnc : tnc;
}
// límites del parámetro de no centralidad para un t observado (como MBESS::conf.limits.nct, que usa JASP)
function ncpCI(t, df, level = 0.95, alt = 'two') {
  const aL = alt === 'two' ? (1 - level) / 2 : 1 - level;
  const solve = target => {
    let lo = t - 10 - Math.abs(t),
      hi = t + 10 + Math.abs(t);
    while (pnct(t, df, lo) < target) lo -= 10;
    while (pnct(t, df, hi) > target) hi += 10;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (pnct(t, df, mid) > target) lo = mid;
      else hi = mid;
      if (hi - lo < 1e-10) break;
    }
    return (lo + hi) / 2;
  };
  return [alt === 'less' ? -Infinity : solve(1 - aL), alt === 'greater' ? Infinity : solve(aL)];
}
// distribuciones exactas (como pwilcox y psignrank de R) para muestras pequeñas sin empates
function wilcoxCounts(n1, n2) {
  // número de formas de obtener cada U (0..n1·n2)
  const N = n1 + n2,
    maxS = (n1 * (2 * N - n1 + 1)) / 2;
  const dp = Array.from({ length: n1 + 1 }, () => new Float64Array(maxS + 1));
  dp[0][0] = 1;
  for (let r = 1; r <= N; r++)
    for (let j = Math.min(r, n1); j >= 1; j--) {
      const row = dp[j],
        prev = dp[j - 1];
      for (let s = maxS; s >= r; s--) row[s] += prev[s - r];
    }
  const base = (n1 * (n1 + 1)) / 2,
    out = new Float64Array(n1 * n2 + 1);
  for (let u = 0; u <= n1 * n2; u++) out[u] = dp[n1][u + base];
  return out;
}
function signrankCounts(n) {
  const max = (n * (n + 1)) / 2,
    c = new Float64Array(max + 1);
  c[0] = 1;
  for (let r = 1; r <= n; r++) for (let s = max; s >= r; s--) c[s] += c[s - r];
  return c;
}
const cdfCounts = (c, x) => {
  let tot = 0,
    acc = 0;
  for (let i = 0; i < c.length; i++) {
    tot += c[i];
    if (i <= x) acc += c[i];
  }
  return acc / tot;
};
const exactP = (c, stat, mid, alt) => {
  const lower = cdfCounts(c, stat),
    upper = 1 - cdfCounts(c, stat - 1);
  if (alt === 'greater') return upper;
  if (alt === 'less') return lower;
  return Math.min(1, 2 * (stat > mid ? 1 - cdfCounts(c, stat - 1) : cdfCounts(c, stat)));
};
// intervalo de la diferencia de medias según la alternativa
const ciAlt = (est, se, df, alt) => {
  if (alt === 'two') {
    const h = tcrit(df) * se;
    return [est - h, est + h];
  }
  const h = J.studentt.inv(0.95, df) * se;
  return alt === 'greater' ? [est - h, Infinity] : [-Infinity, est + h];
};
// F no central: mezcla de Poisson de betas incompletas
function pncf(x, d1, d2, lambda) {
  if (x <= 0) return 0;
  if (lambda <= 0) return J.centralF.cdf(x, d1, d2);
  const y = (d1 * x) / (d1 * x + d2),
    h = lambda / 2,
    j0 = Math.floor(h);
  let s = 0;
  const term = j => Math.exp(-h + j * Math.log(h) - J.gammaln(j + 1)) * J.ibeta(y, d1 / 2 + j, d2 / 2);
  for (let j = j0; j < j0 + 5000; j++) {
    const t = term(j);
    s += t;
    if (t < 1e-14 && j > j0 + 10) break;
  }
  for (let j = j0 - 1; j >= 0; j--) {
    const t = term(j);
    s += t;
    if (t < 1e-14) break;
  }
  return Math.min(1, s);
}
// X: n × p (casos completos); factores: lista de listas de índices de columna (cada ítem en un solo factor; el primero, marcador = 1)
function ncChisqCdf(x, df, ncp) {
  // ji-cuadrado no central (mezcla de Poisson)
  if (ncp <= 0) return J.chisquare.cdf(x, df);
  const h = ncp / 2,
    j0 = Math.floor(h);
  let s = 0;
  const term = j => Math.exp(-h + j * Math.log(h) - lfact(j)) * J.chisquare.cdf(x, df + 2 * j);
  for (let j = j0; j < j0 + 2000; j++) {
    const t = term(j);
    s += t;
    if (t < 1e-14 && j > j0 + 10) break;
  }
  for (let j = j0 - 1; j >= 0; j--) {
    const t = term(j);
    s += t;
    if (t < 1e-14) break;
  }
  return s;
}

export {
  pT,
  pF,
  pChi,
  pZ,
  tcrit,
  pTalt,
  pZalt,
  pnct,
  ncpCI,
  wilcoxCounts,
  signrankCounts,
  cdfCounts,
  exactP,
  ciAlt,
  pncf,
  ncChisqCdf,
};
