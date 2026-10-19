/* Tharp · motor estadístico · Fiabilidad y acuerdo entre jueces */
import { J, mean, ranks, sd, sum, variance } from './base.js';
import { pChi, pF, pT, pZ } from './distribuciones.js';
import { corMatrix, pearson } from './correlacion.js';
import { ols } from './regresion.js';
import { paFactor } from './factorial.js';

function cronbach(items) {
  // items: k arrays de igual longitud (casos completos)
  const k = items.length,
    n = items[0].length,
    total = items[0].map((_, i) => sum(items.map(it => it[i])));
  const alphaOf = its => {
    const kk = its.length,
      tot = its[0].map((_, i) => sum(its.map(it => it[i])));
    return (kk / (kk - 1)) * (1 - sum(its.map(variance)) / variance(tot));
  };
  const alpha = alphaOf(items);
  let rs = 0,
    cnt = 0;
  for (let a = 0; a < k; a++)
    for (let b = a + 1; b < k; b++) {
      rs += pearson(items[a], items[b]).r;
      cnt++;
    }
  const rbar = rs / cnt,
    alphaStd = (k * rbar) / (1 + (k - 1) * rbar);
  const stats = items.map((it, j) => {
    const rest = total.map((t, i) => t - it[i]);
    return {
      mean: mean(it),
      sd: sd(it),
      rit: pearson(it, rest).r,
      alphaDel: k > 2 ? alphaOf(items.filter((_, q) => q !== j)) : NaN,
    };
  });
  // IC 95 % de Feldt (como psych::alpha.ci)
  const d1 = n - 1,
    d2 = (n - 1) * (k - 1),
    ci = [1 - (1 - alpha) * J.centralF.inv(0.975, d1, d2), 1 - (1 - alpha) * J.centralF.inv(0.025, d1, d2)];
  // dos mitades como SPSS: primera mitad de los ítems (una más si k es impar) frente a la segunda
  let split = null;
  if (k >= 4) {
    const k1 = Math.ceil(k / 2),
      k2 = k - k1,
      h1 = items.slice(0, k1),
      h2 = items.slice(k1),
      s1 = h1[0].map((_, i) => sum(h1.map(it => it[i]))),
      s2 = h2[0].map((_, i) => sum(h2.map(it => it[i])));
    const r = pearson(s1, s2).r,
      sbEq = (2 * r) / (1 + r),
      q = (k1 * k2) / (k * k),
      sbUneq = (Math.sqrt(r ** 4 + 4 * r * r * (1 - r * r) * q) - r * r) / (2 * (1 - r * r) * q);
    split = {
      k1,
      k2,
      r,
      sbEq,
      sbUneq,
      guttman: 2 * (1 - (variance(s1) + variance(s2)) / variance(total)),
      alpha1: k1 > 1 ? alphaOf(h1) : NaN,
      alpha2: k2 > 1 ? alphaOf(h2) : NaN,
    };
  }
  return { alpha, alphaStd, rbar, k, n, stats, totalMean: mean(total), totalSd: sd(total), ci, split };
}
const qf = (p, d1, d2) => J.centralF.inv(p, d1, d2);
/** CCI de un factor, efectos aleatorios (ICC1 e ICC1k) */
function iccUnFactor({ n, k, MSR, MSW }, a2) {
  const out = [];
  // un factor, efectos aleatorios
  const F = MSR / MSW,
    d1 = n - 1,
    d2 = n * (k - 1),
    FL = F / qf(1 - a2, d1, d2),
    FU = F * qf(1 - a2, d2, d1);
  out.push({
    type: 'ICC1',
    model: 'oneway',
    unit: 'single',
    icc: (MSR - MSW) / (MSR + (k - 1) * MSW),
    F,
    df1: d1,
    df2: d2,
    p: pF(F, d1, d2),
    ci: [(FL - 1) / (FL + k - 1), (FU - 1) / (FU + k - 1)],
  });
  out.push({
    type: 'ICC1k',
    model: 'oneway',
    unit: 'average',
    icc: (MSR - MSW) / MSR,
    F,
    df1: d1,
    df2: d2,
    p: pF(F, d1, d2),
    ci: [1 - 1 / FL, 1 - 1 / FU],
  });
  return out;
}
/** CCI de dos factores, acuerdo absoluto (ICC2 e ICC2k) */
function iccAcuerdo({ n, k, MSR, MSC, MSE }, a2) {
  const out = [];
  // dos factores, acuerdo absoluto
  const F = MSR / MSE,
    d1 = n - 1,
    d2 = (n - 1) * (k - 1),
    r1 = (MSR - MSE) / (MSR + (k - 1) * MSE + (k * (MSC - MSE)) / n);
  const a = (k * r1) / (n * (1 - r1)),
    b = 1 + (k * r1 * (n - 1)) / (n * (1 - r1)),
    v = (a * MSC + b * MSE) ** 2 / ((a * MSC) ** 2 / (k - 1) + (b * MSE) ** 2 / ((n - 1) * (k - 1)));
  const FL = qf(1 - a2, n - 1, v),
    FU = qf(1 - a2, v, n - 1);
  const lo = (n * (MSR - FL * MSE)) / (FL * (k * MSC + (k * n - k - n) * MSE) + n * MSR),
    hi = (n * (FU * MSR - MSE)) / (k * MSC + (k * n - k - n) * MSE + n * FU * MSR);
  out.push({
    type: 'ICC2',
    model: 'twoway',
    agreement: 'absolute',
    unit: 'single',
    icc: r1,
    F,
    df1: d1,
    df2: d2,
    p: pF(F, d1, d2),
    ci: [lo, hi],
  });
  // medida promedio: IC de McGraw y Wong (1996), con gl de Satterthwaite calculados con el CCI promedio (como SPSS e irr)
  const rk = (MSR - MSE) / (MSR + (MSC - MSE) / n),
    ak = (k * rk) / (n * (1 - rk)),
    bk = 1 + (k * rk * (n - 1)) / (n * (1 - rk));
  const vk = (ak * MSC + bk * MSE) ** 2 / ((ak * MSC) ** 2 / (k - 1) + (bk * MSE) ** 2 / ((n - 1) * (k - 1))),
    FLk = qf(1 - a2, n - 1, vk),
    FUk = qf(1 - a2, vk, n - 1);
  out.push({
    type: 'ICC2k',
    model: 'twoway',
    agreement: 'absolute',
    unit: 'average',
    icc: rk,
    F,
    df1: d1,
    df2: d2,
    p: pF(F, d1, d2),
    ci: [
      (n * (MSR - FLk * MSE)) / (FLk * (MSC - MSE) + n * MSR),
      (n * (FUk * MSR - MSE)) / (MSC - MSE + n * FUk * MSR),
    ],
  });
  return out;
}
/** CCI de dos factores, consistencia (ICC3 e ICC3k) */
function iccConsistencia({ n, k, MSR, MSE }, a2) {
  const out = [];
  // dos factores, consistencia
  const F = MSR / MSE,
    d1 = n - 1,
    d2 = (n - 1) * (k - 1),
    FL = F / qf(1 - a2, d1, d2),
    FU = F * qf(1 - a2, d2, d1);
  out.push({
    type: 'ICC3',
    model: 'twoway',
    agreement: 'consistency',
    unit: 'single',
    icc: (MSR - MSE) / (MSR + (k - 1) * MSE),
    F,
    df1: d1,
    df2: d2,
    p: pF(F, d1, d2),
    ci: [(FL - 1) / (FL + k - 1), (FU - 1) / (FU + k - 1)],
  });
  out.push({
    type: 'ICC3k',
    model: 'twoway',
    agreement: 'consistency',
    unit: 'average',
    icc: (MSR - MSE) / MSR,
    F,
    df1: d1,
    df2: d2,
    p: pF(F, d1, d2),
    ci: [1 - 1 / FL, 1 - 1 / FU],
  });
  return out;
}
// CCI de Shrout y Fleiss / McGraw y Wong: Y n sujetos × k jueces (casos completos); las 6 formas con F, p e IC 95 %
function icc(Y, level = 0.95) {
  const n = Y.length,
    k = Y[0].length,
    gm = mean(Y.flat()),
    rm = Y.map(mean),
    cm = Y[0].map((_, j) => mean(Y.map(r => r[j])));
  const ssR = k * sum(rm.map(m => (m - gm) ** 2)),
    ssC = n * sum(cm.map(m => (m - gm) ** 2)),
    ssT = sum(Y.flat().map(v => (v - gm) ** 2)),
    ssE = ssT - ssR - ssC;
  const ms = {
    n,
    k,
    MSR: ssR / (n - 1),
    MSC: ssC / (k - 1),
    MSE: ssE / ((n - 1) * (k - 1)),
    MSW: (ssC + ssE) / (n * (k - 1)),
  };
  const a2 = (1 - level) / 2;
  return { ...ms, forms: [...iccUnFactor(ms, a2), ...iccAcuerdo(ms, a2), ...iccConsistencia(ms, a2)] };
}
// W de Kendall: concordancia de m jueces que puntúan n sujetos (con corrección por empates, como irr::kendall(correct = TRUE))
function kendallW(Y) {
  // Y: n sujetos × m jueces
  const n = Y.length,
    m = Y[0].length,
    R = new Array(n).fill(0);
  let T = 0;
  for (let j = 0; j < m; j++) {
    const rk = ranks(Y.map(r => r[j]));
    rk.r.forEach((v, i) => {
      R[i] += v;
    });
    const cnt = new Map();
    Y.forEach(r => cnt.set(r[j], (cnt.get(r[j]) || 0) + 1));
    cnt.forEach(t => {
      if (t > 1) T += t ** 3 - t;
    });
  }
  const mR = mean(R),
    Sq = sum(R.map(v => (v - mR) ** 2)),
    W = (12 * Sq) / (m * m * (n ** 3 - n) - m * T),
    chi = m * (n - 1) * W;
  return { W, chi, df: n - 1, p: pChi(chi, n - 1), n, m };
}
// alfa de Krippendorff con matriz de coincidencias (admite valores perdidos); nivel 'nominal' | 'ordinal' | 'interval' | 'ratio'
function krippAlpha(units, level = 'nominal', order = null) {
  // units: n sujetos × m jueces con null = sin valoración
  const vals =
    order ||
    [...new Set(units.flat().filter(v => v !== null))].sort((a, b) =>
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
    );
  const ix = new Map(vals.map((v, i) => [String(v), i])),
    V = vals.length,
    o = Array.from({ length: V }, () => new Array(V).fill(0));
  units.forEach(u => {
    const r = u.filter(v => v !== null).map(v => ix.get(String(v))),
      mu = r.length;
    if (mu < 2) return;
    for (let a = 0; a < mu; a++) for (let b = 0; b < mu; b++) if (a !== b) o[r[a]][r[b]] += 1 / (mu - 1);
  });
  const nc = o.map(row => sum(row)),
    N = sum(nc);
  const d2 = (c, k) => {
    if (level === 'nominal') return c === k ? 0 : 1;
    if (level === 'ordinal') {
      const lo = Math.min(c, k),
        hi = Math.max(c, k);
      let s = 0;
      for (let g = lo; g <= hi; g++) s += nc[g];
      return (s - (nc[c] + nc[k]) / 2) ** 2;
    }
    const x = +vals[c],
      y = +vals[k];
    return level === 'ratio' ? ((x - y) / (x + y)) ** 2 : (x - y) ** 2;
  };
  let Do = 0,
    De = 0;
  for (let c = 0; c < V; c++)
    for (let k = 0; k < V; k++) {
      const dd = d2(c, k);
      Do += o[c][k] * dd;
      De += nc[c] * nc[k] * dd;
    }
  Do /= N;
  De /= N * (N - 1);
  return { alpha: 1 - Do / De, level, nPairable: N, values: V };
}
// Bland-Altman: sesgo, límites de acuerdo al 95 % con sus IC (Bland y Altman, 1999) y sesgo proporcional
function blandAltman(a, b) {
  const d = a.map((v, i) => v - b[i]),
    mm = a.map((v, i) => (v + b[i]) / 2),
    n = d.length,
    bias = mean(d),
    s = sd(d),
    t = J.studentt.inv(0.975, n - 1);
  const lo = bias - 1.959963984540054 * s,
    hi = bias + 1.959963984540054 * s,
    seB = s / Math.sqrt(n),
    seL = Math.sqrt((3 * s * s) / n);
  const reg = ols(
    mm.map(v => [1, v]),
    d
  );
  return {
    n,
    bias,
    sd: s,
    biasCI: [bias - t * seB, bias + t * seB],
    lo,
    hi,
    loCI: [lo - t * seL, lo + t * seL],
    hiCI: [hi - t * seL, hi + t * seL],
    diff: d,
    mean: mm,
    prop: { b: reg.b[1], se: reg.se[1], t: reg.t[1], p: reg.pv[1] },
    pBias: pT(bias / seB, n - 1),
  };
}
// kappa de Cohen (2 jueces), opcionalmente ponderada ('linear' | 'quadratic') para categorías ordenadas;
// z y p con la varianza bajo H0 (Fleiss, Cohen y Everitt, 1969), IC con la varianza asintótica, como irr::kappa2 y psych::cohen.kappa
function cohenKappa(a, b, levels, weight = 'none') {
  const k = levels.length,
    n = a.length,
    idx = v => levels.indexOf(v),
    P = Array.from({ length: k }, () => new Array(k).fill(0));
  a.forEach((v, t) => {
    P[idx(v)][idx(b[t])] += 1 / n;
  });
  const W = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) =>
      weight === 'linear'
        ? 1 - Math.abs(i - j) / (k - 1)
        : weight === 'quadratic'
          ? 1 - ((i - j) / (k - 1)) ** 2
          : i === j
            ? 1
            : 0
    )
  );
  const pr = P.map(r => sum(r)),
    pc = P[0].map((_, j) => sum(P.map(r => r[j])));
  let po = 0,
    pe = 0;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      po += W[i][j] * P[i][j];
      pe += W[i][j] * pr[i] * pc[j];
    }
  const kap = (po - pe) / (1 - pe);
  const wr = pr.map((_, i) => sum(pc.map((c, j) => W[i][j] * c))),
    wc = pc.map((_, j) => sum(pr.map((r, i) => W[i][j] * r)));
  let v0 = 0,
    v1 = 0;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      v0 += pr[i] * pc[j] * (W[i][j] - (wr[i] + wc[j])) ** 2;
      v1 += P[i][j] * (W[i][j] - (wr[i] + wc[j]) * (1 - kap)) ** 2;
    }
  const var0 = (v0 - pe * pe) / (n * (1 - pe) ** 2),
    var1 = (v1 - (kap - pe * (1 - kap)) ** 2) / (n * (1 - pe) ** 2);
  const z = kap / Math.sqrt(var0),
    se = Math.sqrt(Math.max(0, var1));
  return {
    kappa: kap,
    po,
    pe,
    n,
    z,
    p: pZ(z),
    se,
    ci: [kap - 1.959963984540054 * se, kap + 1.959963984540054 * se],
    weight,
  };
}
// kappa de Fleiss (3 o más jueces, categorías nominales), con z y p como irr::kappam.fleiss
function fleissKappa(R, levels) {
  // R: n sujetos × m jueces
  const n = R.length,
    m = R[0].length,
    cnt = R.map(r => levels.map(l => r.filter(v => v === l).length));
  const pj = levels.map((_, j) => sum(cnt.map(c => c[j])) / (n * m)),
    Pi = cnt.map(c => (sum(c.map(x => x * x)) - m) / (m * (m - 1)));
  const Pbar = mean(Pi),
    Pe = sum(pj.map(p => p * p)),
    kap = (Pbar - Pe) / (1 - Pe);
  const se0 =
    (Math.sqrt(2) / (sum(pj.map(p => p * (1 - p))) * Math.sqrt(n * m * (m - 1)))) *
    Math.sqrt(sum(pj.map(p => p * (1 - p))) ** 2 - sum(pj.map(p => p * (1 - p) * (1 - 2 * p))));
  const z = kap / se0;
  return {
    kappa: kap,
    n,
    m,
    z,
    p: pZ(z),
    byCat: levels.map((l, j) => {
      const q = pj[j];
      const kj = 1 - sum(cnt.map(c => c[j] * (m - c[j]))) / (n * m * (m - 1) * q * (1 - q));
      return { level: l, kappa: kj };
    }),
  };
}
function omegaTotal(X) {
  // ω de McDonald a partir de un modelo de un factor (ejes principales)
  const R = corMatrix(X),
    l = paFactor(R, 1).L.map(r => r[0]),
    sl = sum(l) * (sum(l) < 0 ? -1 : 1),
    u = sum(l.map(v => 1 - v * v));
  return { omega: (sl * sl) / (sl * sl + u), loadings: l.map(v => v * (sum(l) < 0 ? -1 : 1)) };
}

export { cronbach, icc, kendallW, krippAlpha, blandAltman, cohenKappa, fleissKappa, omegaTotal };
