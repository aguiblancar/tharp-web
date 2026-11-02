/* Tharp · motor estadístico · Descriptivos, normalidad y densidad */
import { J, kurtosis, mean, quantile, sd, skewness, sorted } from './base.js';
import { tcrit } from './distribuciones.js';

function meanCI(a) {
  const n = a.length,
    m = mean(a);
  if (n < 2) return [m, m];
  const h = (tcrit(n - 1) * sd(a)) / Math.sqrt(n);
  return [m - h, m + h];
}
function describe(a) {
  const s = sorted(a),
    n = a.length;
  return {
    n,
    mean: mean(a),
    sd: n > 1 ? sd(a) : NaN,
    median: quantile(s, 0.5),
    q1: quantile(s, 0.25),
    q3: quantile(s, 0.75),
    min: s[0],
    max: s[n - 1],
    skew: skewness(a),
    kurt: kurtosis(a),
    ci: meanCI(a),
  };
}
// Kolmogorov-Smirnov con la corrección de Lilliefors (p de Dallal y Wilkinson, 1986, y Stephens, como nortest::lillie.test)
function lilliefors(xIn) {
  const x = xIn.slice().sort((a, b) => a - b),
    n = x.length;
  if (n < 5) return null;
  const m = mean(x),
    s = sd(x);
  if (!(s > 0)) return null;
  let K = 0;
  x.forEach((v, i) => {
    const p = J.normal.cdf((v - m) / s, 0, 1);
    K = Math.max(K, (i + 1) / n - p, p - i / n);
  });
  let Kd = K,
    nd = n;
  if (n > 100) {
    Kd = K * Math.pow(n / 100, 0.49);
    nd = 100;
  }
  let pv = Math.exp(
    -7.01256 * Kd * Kd * (nd + 2.78019) +
      2.99587 * Kd * Math.sqrt(nd + 2.78019) -
      0.122119 +
      0.974598 / Math.sqrt(nd) +
      1.67997 / nd
  );
  if (pv > 0.1) {
    const KK = (Math.sqrt(n) - 0.01 + 0.85 / Math.sqrt(n)) * K;
    pv =
      KK <= 0.302
        ? 1
        : KK <= 0.5
          ? 2.76773 - 19.828315 * KK + 80.709644 * KK ** 2 - 138.55152 * KK ** 3 + 81.218052 * KK ** 4
          : KK <= 0.9
            ? -4.901232 + 40.662806 * KK - 97.490286 * KK ** 2 + 94.029866 * KK ** 3 - 32.355711 * KK ** 4
            : KK <= 1.31
              ? 6.198765 - 19.558097 * KK + 23.186922 * KK ** 2 - 10.611969 * KK ** 3 + 1.484217 * KK ** 4
              : 0;
  }
  return { D: K, p: Math.max(0, Math.min(1, pv)) };
}
// errores típicos de la asimetría y la curtosis (como SPSS)
const seSkew = n => Math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3)));
const seKurt = n => 2 * seSkew(n) * Math.sqrt((n * n - 1) / ((n - 3) * (n + 5)));
const poly = (c, x) => {
  let r = 0;
  for (let i = c.length - 1; i >= 0; i--) r = r * x + c[i];
  return r;
};
const C1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056],
  C2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
const C3 = [0.544, -0.39978, 0.025054, -6.714e-4],
  C4 = [1.3822, -0.77857, 0.062767, -0.0020322];
const C5 = [-1.5861, -0.31082, -0.083751, 0.0038915],
  C6 = [-0.4803, -0.082676, 0.0030302];
function shapiro(xIn) {
  const x = sorted(xIn),
    n = x.length;
  if (n < 3 || n > 5000 || x[n - 1] - x[0] < 1e-12) return null;
  const nn2 = Math.floor(n / 2),
    a = new Array(nn2 + 1);
  if (n === 3) a[1] = Math.SQRT1_2;
  else {
    const an25 = n + 0.25,
      m = new Array(nn2 + 1);
    let summ2 = 0;
    for (let i = 1; i <= nn2; i++) {
      m[i] = J.normal.inv((i - 0.375) / an25, 0, 1);
      summ2 += m[i] * m[i];
    }
    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2),
      rsn = 1 / Math.sqrt(n);
    const a1 = poly(C1, rsn) - m[1] / ssumm2;
    let i1, fac;
    if (n > 5) {
      i1 = 3;
      const a2 = -m[2] / ssumm2 + poly(C2, rsn);
      fac = Math.sqrt((summ2 - 2 * m[1] ** 2 - 2 * m[2] ** 2) / (1 - 2 * a1 ** 2 - 2 * a2 ** 2));
      a[2] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * m[1] ** 2) / (1 - 2 * a1 ** 2));
    }
    a[1] = a1;
    for (let i = i1; i <= nn2; i++) a[i] = -m[i] / fac;
  }
  const mu = mean(x);
  let ss = 0;
  for (const v of x) ss += (v - mu) ** 2;
  let num = 0;
  for (let i = 1; i <= nn2; i++) num += a[i] * (x[n - i] - x[i - 1]);
  const W = Math.min(1, (num * num) / ss);
  let p;
  if (n === 3) p = Math.max(0, 1.90985931710274 * (Math.asin(Math.sqrt(W)) - 1.0471975511966));
  else {
    let y = Math.log(1 - W);
    const xx = Math.log(n);
    if (n <= 11) {
      const gamma = poly([-2.273, 0.459], n);
      if (y >= gamma) p = 1e-19;
      else {
        y = -Math.log(gamma - y);
        p = 1 - J.normal.cdf(y, poly(C3, n), Math.exp(poly(C4, n)));
      }
    } else p = 1 - J.normal.cdf(y, poly(C5, xx), Math.exp(poly(C6, xx)));
  }
  return { W, p };
}
// densidad suavizada con núcleo gaussiano y ancho de banda de Silverman (como bw.nrd0 de R), evaluada entre el mínimo y el máximo (como un violín recortado)
function kde(x, npts = 96) {
  const s = x.slice().sort((a, b) => a - b),
    n = s.length,
    q = p => {
      const h = (n - 1) * p,
        lo = Math.floor(h),
        hi = Math.min(lo + 1, n - 1);
      return s[lo] + (h - lo) * (s[hi] - s[lo]);
    };
  const m = s.reduce((a, b) => a + b, 0) / n,
    sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)),
    iqr = q(0.75) - q(0.25);
  let lo = Math.min(sd, iqr / 1.34);
  if (!(lo > 0)) lo = sd || Math.abs(x[0]) || 1; // como bw.nrd0: x[1] en el orden original
  const bw = 0.9 * lo * Math.pow(n, -0.2),
    a = s[0],
    b = s[n - 1],
    c = 1 / (n * bw * Math.sqrt(2 * Math.PI));
  const pts = Array.from({ length: npts }, (_, i) => {
    const y = b > a ? a + ((b - a) * i) / (npts - 1) : a;
    let d = 0;
    for (const v of s) {
      const z = (y - v) / bw;
      if (z > -8 && z < 8) d += Math.exp(-0.5 * z * z);
    }
    return [y, d * c];
  });
  return { bw, pts, q1: q(0.25), md: q(0.5), q3: q(0.75), n };
}

export { meanCI, describe, lilliefors, seSkew, seKurt, shapiro, kde };
