/* Tharp · motor estadístico · Estadísticos básicos y utilidades comunes */

/**
 * Resultado cuyos campos se completan por pasos (por ejemplo, la p ajustada de cada comparación, que solo puede
 * calcularse cuando están todas). Las funciones públicas documentan sus campos en su comentario.
 * @typedef {Record<string, any>} Registro
 */

// mínimo y máximo sin «Math.min(...a)», que desborda la pila con decenas de miles de valores; mismo resultado (NaN si hay NaN; ±Infinity si está vacío)
const minOf = a => {
  let m = Infinity;
  for (const v of a) {
    if (v !== v) return NaN;
    if (v < m) m = v;
  }
  return m;
};
const maxOf = a => {
  let m = -Infinity;
  for (const v of a) {
    if (v !== v) return NaN;
    if (v > m) m = v;
  }
  return m;
};
const J = globalThis.jStat;
const sum = a => {
  let s = 0;
  for (const v of a) s += v;
  return s;
};
const mean = a => sum(a) / a.length;
function variance(a) {
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return s / (a.length - 1);
}
const sd = a => Math.sqrt(variance(a));
const sorted = a => a.slice().sort((x, y) => x - y);
function quantile(s, p) {
  const h = (s.length - 1) * p,
    lo = Math.floor(h),
    hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}
const median = a => quantile(sorted(a), 0.5);
function skewness(a) {
  // G1 (SPSS)
  const n = a.length;
  if (n < 3) return NaN;
  const m = mean(a),
    s = sd(a);
  if (!s) return NaN;
  let t = 0;
  for (const v of a) t += ((v - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * t;
}
function kurtosis(a) {
  // G2 (SPSS), exceso
  const n = a.length;
  if (n < 4) return NaN;
  const m = mean(a),
    s = sd(a);
  if (!s) return NaN;
  let t = 0;
  for (const v of a) t += ((v - m) / s) ** 4;
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * t - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}
function ranks(a) {
  // rangos promedio + corrección de empates
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  let ties = 0;
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1,
      t = j - i + 1;
    if (t > 1) ties += t ** 3 - t;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return { r, ties };
}
function holm(ps) {
  const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]),
    m = ps.length,
    out = new Array(m);
  let prev = 0;
  o.forEach(([p, i], k) => {
    prev = Math.max(prev, Math.min(1, (m - k) * p));
    out[i] = prev;
  });
  return out;
}
function lfact(n) {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}
function binomTwoSided(x, n) {
  // binomial exacta con p = 0.5 (como binom.test de R)
  const lf = [0];
  for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  const pr = k => Math.exp(lf[n] - lf[k] - lf[n - k] - n * Math.LN2),
    d = pr(x);
  let p = 0;
  for (let k = 0; k <= n; k++) {
    const v = pr(k);
    if (v <= d * (1 + 1e-7)) p += v;
  }
  return Math.min(1, p);
}
// digamma y trigamma: recurrencia hasta x ≥ 6 y serie asintótica (error < 1e-13)
function digamma(x) {
  let r = 0;
  while (x < 6) {
    r -= 1 / x;
    x += 1;
  }
  const f = 1 / (x * x);
  return r + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132))));
}
function trigamma(x) {
  let r = 0;
  while (x < 6) {
    r += 1 / (x * x);
    x += 1;
  }
  const f = 1 / (x * x);
  return r + 1 / x + f / 2 + (f / x) * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f / 30)));
}

/**
 * Generador pseudoaleatorio con semilla (mulberry32): la misma secuencia en todos los navegadores y en Node,
 * para que los bootstrap y el análisis paralelo sean reproducibles.
 * @param {number} seed semilla entera
 * @returns {() => number} uniforme en [0, 1)
 */
function aleatorioConSemilla(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Índices de una remuestra bootstrap (con reemplazo) de n casos */
function remuestra(n, rnd) {
  const idx = new Int32Array(n);
  for (let t = 0; t < n; t++) idx[t] = Math.floor(rnd() * n);
  return idx;
}

export {
  minOf,
  maxOf,
  J,
  sum,
  mean,
  variance,
  sd,
  sorted,
  quantile,
  median,
  skewness,
  kurtosis,
  ranks,
  holm,
  lfact,
  binomTwoSided,
  digamma,
  trigamma,
  aleatorioConSemilla,
  remuestra,
};
