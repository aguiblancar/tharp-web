/* Tharp · motor estadístico · Comparación de dos o más grupos independientes y de una muestra */
import { J, mean, minOf, quantile, ranks, sd, sorted, sum, variance } from './base.js';
import { ciAlt, exactP, ncpCI, pChi, pF, pT, pTalt, pZalt, signrankCounts, wilcoxCounts } from './distribuciones.js';
import { binomTest, chiSquare, fisherRxC } from './contingencia.js';

function anova(groups) {
  // groups: [[...], ...]
  const all = groups.flat(),
    N = all.length,
    k = groups.length,
    gm = mean(all);
  let ssb = 0,
    ssw = 0;
  groups.forEach(g => {
    const m = mean(g);
    ssb += g.length * (m - gm) ** 2;
    for (const v of g) ssw += (v - m) ** 2;
  });
  const df1 = k - 1,
    df2 = N - k,
    msw = ssw / df2,
    F = ssb / df1 / msw;
  return {
    F,
    df1,
    df2,
    p: pF(F, df1, df2),
    ssb,
    ssw,
    msw,
    eta2: ssb / (ssb + ssw),
    omega2: Math.max(0, (ssb - df1 * msw) / (ssb + ssw + msw)),
  };
}
function levene(groups) {
  // centrado en la media (como SPSS)
  const z = groups.map(g => {
    const m = mean(g);
    return g.map(v => Math.abs(v - m));
  });
  const r = anova(z);
  return { F: r.F, df1: r.df1, df2: r.df2, p: isFinite(r.F) ? r.p : 1 };
}
function welchAnova(groups) {
  const k = groups.length,
    n = groups.map(g => g.length),
    m = groups.map(mean),
    v = groups.map(variance);
  const w = n.map((ni, i) => ni / v[i]),
    W = sum(w),
    xw = sum(w.map((wi, i) => wi * m[i])) / W;
  const A = sum(w.map((wi, i) => wi * (m[i] - xw) ** 2)) / (k - 1);
  const tmp = sum(w.map((wi, i) => (1 - wi / W) ** 2 / (n[i] - 1)));
  const B = 1 + ((2 * (k - 2)) / (k * k - 1)) * tmp,
    F = A / B,
    df1 = k - 1,
    df2 = (k * k - 1) / (3 * tmp);
  return { F, df1, df2, p: pF(F, df1, df2) };
}
// d de Cohen como JASP: varianza combinada (Student) o media de las dos varianzas (Welch); IC por la t no central (MBESS)
function tTestInd(a, b, equalVar, alt = 'two') {
  const n1 = a.length,
    n2 = b.length,
    m1 = mean(a),
    m2 = mean(b),
    v1 = variance(a),
    v2 = variance(b);
  const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2),
    d = (m1 - m2) / Math.sqrt(equalVar ? sp2 : (v1 + v2) / 2);
  let se, df;
  if (equalVar) {
    se = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
    df = n1 + n2 - 2;
  } else {
    se = Math.sqrt(v1 / n1 + v2 / n2);
    df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  }
  const t = (m1 - m2) / se,
    k = Math.sqrt((n1 * n2) / (n1 + n2)),
    nc = ncpCI(d * k, df, 0.95, alt);
  const dfg = n1 + n2 - 2,
    J_ = Math.exp(J.gammaln(dfg / 2) - Math.log(Math.sqrt(dfg / 2)) - J.gammaln((dfg - 1) / 2));
  return {
    t,
    df,
    p: pTalt(t, df, alt),
    alt,
    diff: m1 - m2,
    ci: ciAlt(m1 - m2, se, df, alt),
    d,
    dCI: nc.map(v => v / k),
    g: d * J_,
    se,
  };
}
// U de Mann-Whitney (W de R, del primer grupo); p exacta sin empates y n < 50 en ambos grupos (como wilcox.test);
// correlación biserial por rangos con IC (Kerby, 2014; como JASP)
function mannWhitney(a, b, alt = 'two') {
  const n1 = a.length,
    n2 = b.length,
    N = n1 + n2,
    { r, ties } = ranks(a.concat(b));
  const R1 = sum(r.slice(0, n1)),
    U = R1 - (n1 * (n1 + 1)) / 2,
    mu = (n1 * n2) / 2;
  const sig = Math.sqrt(((n1 * n2) / 12) * (N + 1 - ties / (N * (N - 1))));
  const dlt = U - mu,
    z = ((Math.abs(dlt) - 0.5) * Math.sign(dlt)) / sig;
  const zA = (dlt - (alt === 'two' ? Math.sign(dlt) * 0.5 : alt === 'greater' ? 0.5 : -0.5)) / sig;
  const exact = n1 < 50 && n2 < 50 && ties === 0,
    p = exact ? exactP(wilcoxCounts(n1, n2), U, mu, alt) : pZalt(zA, alt);
  const rb = (2 * U) / (n1 * n2) - 1,
    seRb = Math.sqrt((4 / (n1 * n2) ** 2) * ((n1 * n2 * (N + 1)) / 12));
  return { U, z, p, exact, alt, r: Math.abs(z) / Math.sqrt(N), rb, rbCI: rbCI(rb, seRb, alt) };
}
function rbCI(rb, se, alt) {
  const z = Math.atanh(Math.max(-0.9999999, Math.min(0.9999999, rb)));
  if (alt === 'two') return [Math.tanh(z - 1.959963984540054 * se), Math.tanh(z + 1.959963984540054 * se)];
  return alt === 'greater' ? [Math.tanh(z - 1.6448536269514722 * se), 1] : [-1, Math.tanh(z + 1.6448536269514722 * se)];
}
function kruskal(groups) {
  const all = groups.flat(),
    N = all.length,
    k = groups.length,
    { r, ties } = ranks(all);
  let off = 0,
    H = 0;
  const meanRanks = [];
  groups.forEach(g => {
    const R = sum(r.slice(off, off + g.length));
    meanRanks.push(R / g.length);
    H += (R * R) / g.length;
    off += g.length;
  });
  H = ((12 / (N * (N + 1))) * H - 3 * (N + 1)) / (1 - ties / (N ** 3 - N));
  return { H, df: k - 1, p: pChi(H, k - 1), eps2: H / (N - 1), meanRanks, ties, N };
}
// ANOVA de Brown-Forsythe para medias (F*), robusta a varianzas distintas
function brownForsythe(groups) {
  const k = groups.length,
    n = groups.map(g => g.length),
    N = sum(n),
    m = groups.map(mean),
    v = groups.map(variance),
    gm = sum(groups.map(g => sum(g))) / N;
  const num = sum(n.map((ni, i) => ni * (m[i] - gm) ** 2)),
    den = sum(n.map((ni, i) => (1 - ni / N) * v[i]));
  const c = n.map((ni, i) => ((1 - ni / N) * v[i]) / den),
    df2 = 1 / sum(c.map((ci, i) => (ci * ci) / (n[i] - 1))),
    F = num / den;
  return { F, df1: k - 1, df2, p: pF(F, k - 1, df2) };
}
// t para una muestra frente a un valor de referencia mu; d = (M − mu) / DT, IC por la t no central (como JASP)
function tTestOne(x, mu = 0, alt = 'two') {
  const n = x.length,
    m = mean(x),
    s = sd(x),
    se = s / Math.sqrt(n),
    df = n - 1,
    t = (m - mu) / se,
    d = (m - mu) / s;
  const nc = ncpCI(d * Math.sqrt(n), df, 0.95, alt);
  return {
    t,
    df,
    p: pTalt(t, df, alt),
    alt,
    diff: m - mu,
    ci: ciAlt(m - mu, se, df, alt),
    d,
    dCI: nc.map(v => v / Math.sqrt(n)),
    mean: m,
    sd: s,
    n,
  };
}
function tTestPaired(a, b, alt = 'two') {
  // a = momento 1, b = momento 2; diferencia b - a
  const d = b.map((v, i) => v - a[i]),
    r = tTestOne(d, 0, alt);
  return { t: r.t, df: r.df, p: r.p, alt, diff: r.diff, ci: r.ci, dz: r.d, dzCI: r.dCI };
}
// Wilcoxon de rangos con signo para una muestra (x − mu); p exacta sin empates ni ceros y n < 50 (como wilcox.test);
// biserial por rangos de pares emparejados con IC (como JASP)
function wilcoxonOne(x, mu = 0, alt = 'two') {
  const dAll = x.map(v => v - mu),
    zeros = dAll.filter(v => v === 0).length,
    d = dAll.filter(v => v !== 0),
    n = d.length;
  if (!n) return { V: 0, z: 0, p: 1, r: 0, n, rb: 0, rbCI: [NaN, NaN], exact: false, alt };
  const { r, ties } = ranks(d.map(Math.abs));
  const Wp = sum(r.filter((_, i) => d[i] > 0)),
    mu0 = (n * (n + 1)) / 4;
  const sig = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - ties / 48),
    dlt = Wp - mu0;
  const z = ((Math.abs(dlt) - 0.5) * Math.sign(dlt)) / sig,
    zA = (dlt - (alt === 'two' ? Math.sign(dlt) * 0.5 : alt === 'greater' ? 0.5 : -0.5)) / sig;
  const exact = n < 50 && ties === 0 && zeros === 0,
    p = exact ? exactP(signrankCounts(n), Wp, mu0, alt) : pZalt(zA, alt);
  const maxw = (n * (n + 1)) / 2,
    rb = (Wp / maxw) * 2 - 1,
    seRb = Math.sqrt(((Math.sqrt((n * (n + 1) * (2 * n + 1)) / 6) / 2) ** 2 * 4) / maxw ** 2);
  return { V: Wp, z, p, exact, alt, r: Math.abs(z) / Math.sqrt(n), n, rb, rbCI: rbCI(rb, seRb, alt) };
}
function wilcoxonSigned(a, b, alt = 'two') {
  return wilcoxonOne(
    b.map((v, i) => v - a[i]),
    0,
    alt
  );
}
// prueba de los signos: binomial exacta sobre las diferencias distintas de 0 (como binom.test / DescTools::SignTest)
function signTest(d, alt = 'two') {
  const nz = d.filter(v => v !== 0),
    pos = nz.filter(v => v > 0).length,
    r = binomTest(pos, nz.length, 0.5, alt);
  return {
    pos,
    neg: nz.length - pos,
    ties: d.length - nz.length,
    n: nz.length,
    p: r.p,
    median: quantile(sorted(d), 0.5),
  };
}
// prueba de la mediana (Mood): por encima de la mediana conjunta frente a igual o por debajo; χ² de Pearson y p exacta de Fisher
function medianTest(xs) {
  const all = xs.flat(),
    med = quantile(sorted(all), 0.5),
    tab = [xs.map(x => x.filter(v => v > med).length), xs.map(x => x.filter(v => v <= med).length)];
  if (tab.some(r => r.every(v => v === 0))) return { med, tab, chi: NaN, df: xs.length - 1, p: NaN, pFisher: NaN };
  const c = chiSquare(tab),
    fx = fisherRxC(tab);
  return { med, tab, chi: c.chi, df: c.df, p: c.p, pFisher: fx ? fx.p : null, minE: minOf(c.E.flat()) };
}
// Kolmogorov-Smirnov para dos muestras (como ks.test de R ≥ 4.3): p exacta si m·n < 10000 (también con empates), si no, asintótica
function ks2(x, y) {
  const m = x.length,
    n = y.length,
    xs = sorted(x),
    ys = sorted(y),
    all = sorted(x.concat(y));
  let D = 0,
    Dp = 0,
    Dm = 0,
    i = 0,
    j = 0;
  const vals = [...new Set(all)];
  vals.forEach(v => {
    while (i < m && xs[i] <= v) i++;
    while (j < n && ys[j] <= v) j++;
    const d = i / m - j / n;
    D = Math.max(D, Math.abs(d));
    Dp = Math.max(Dp, d);
    Dm = Math.max(Dm, -d);
  });
  let p;
  const exact = m * n < 10000;
  if (exact) {
    const tie = all.map((v, q) => q === all.length - 1 || all[q + 1] !== v),
      lim = Math.round(D * m * n) - 1e-7;
    const ok = (a, b) => !tie[a + b - 1] || Math.abs(a * n - b * m) < lim;
    const u = new Float64Array(n + 1);
    u[0] = 1;
    for (let b = 1; b <= n; b++) u[b] = ok(0, b) ? u[b - 1] : 0;
    for (let a = 1; a <= m; a++) {
      const w = a / (a + n);
      u[0] = ok(a, 0) ? w * u[0] : 0;
      for (let b = 1; b <= n; b++) u[b] = ok(a, b) ? w * u[b] + u[b - 1] : 0;
    }
    p = Math.min(1, Math.max(0, 1 - u[n]));
  } else {
    const z = Math.sqrt((m * n) / (m + n)) * D;
    let s = 0;
    for (let k = 1; k < 100; k++) s += (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * z * z);
    p = Math.min(1, Math.max(0, 2 * s));
  }
  return { D, Dplus: Dp, Dminus: Dm, p, exact, m, n };
}
// Jonckheere-Terpstra (grupos en orden creciente): exacta sin empates y N ≤ 100 (como clinfun), si no, normal con corrección por empates (como PMCMRplus)
function jonckheere(xs) {
  const ni = xs.map(x => x.length),
    N = sum(ni),
    all = xs.flat();
  let JT = 0;
  for (let a = 0; a < xs.length; a++)
    for (let b = a + 1; b < xs.length; b++)
      xs[a].forEach(u =>
        xs[b].forEach(v => {
          JT += v > u ? 1 : v === u ? 0.5 : 0;
        })
      );
  const mu = (N * N - sum(ni.map(v => v * v))) / 4,
    cnt = {};
  all.forEach(v => (cnt[v] = (cnt[v] || 0) + 1));
  const nt = Object.values(cnt),
    ties = nt.some(v => v > 1);
  const vr = !ties
    ? (N * N * (2 * N + 3) - sum(ni.map(v => v * v * (2 * v + 3)))) / 72
    : (N * (N - 1) * (2 * N + 5) -
        sum(ni.map(v => v * (v - 1) * (2 * v + 5))) -
        sum(nt.map(v => v * (v - 1) * (2 * v + 5)))) /
        72 +
      (sum(ni.map(v => v * (v - 1) * (v - 2))) * sum(nt.map(v => v * (v - 1) * (v - 2)))) /
        (36 * N * (N - 1) * (N - 2)) +
      (sum(ni.map(v => v * (v - 1))) * sum(nt.map(v => v * (v - 1)))) / (8 * N * (N - 1));
  const z = (JT - mu) / Math.sqrt(vr);
  let p;
  const exact = !ties && N <= 100;
  if (exact) {
    let dist = new Float64Array([1]),
      rest = N;
    ni.slice(0, -1).forEach(na => {
      rest -= na;
      const c = wilcoxCounts(na, rest),
        tot = c.reduce((s_, v) => s_ + v, 0),
        nd = new Float64Array(dist.length + c.length - 1);
      for (let a = 0; a < dist.length; a++)
        if (dist[a]) for (let b = 0; b < c.length; b++) nd[a + b] += (dist[a] * c[b]) / tot;
      dist = nd;
    });
    const J0 = Math.round(JT);
    let lo = 0,
      hi = 0;
    dist.forEach((v, q) => {
      if (q <= J0) lo += v;
      if (q >= J0) hi += v;
    });
    p = Math.min(1, 2 * Math.min(lo, hi, 0.5));
  } else p = 2 * Math.min(1 - J.normal.cdf(Math.abs(z), 0, 1), 0.5);
  return { JT, mu, sd: Math.sqrt(vr), z, p, exact, ties, N };
}
// prueba de rachas (aleatoriedad) respecto a la mediana, como DescTools::RunsTest: exacta con n ≤ 30, si no, normal con corrección por continuidad
function runsTest(xIn) {
  let x = xIn,
    med = null;
  if (new Set(xIn).size > 2) {
    med = quantile(sorted(xIn), 0.5);
    x = xIn.map(v => (v > med ? 1 : 0));
  } else {
    const lv = [...new Set(xIn)].sort((a, b) => (a < b ? -1 : 1));
    x = xIn.map(v => (v === lv[0] ? 0 : 1));
  }
  const runs = 1 + x.slice(1).filter((v, i) => v !== x[i]).length,
    m = x.filter(v => v === 0).length,
    n = x.length - m,
    N = m + n;
  if (!m || !n) return null;
  const E = 1 + (2 * n * m) / N,
    s2 = (2 * n * m * (2 * n * m - n - m)) / (N * N * (N - 1)),
    dd = runs - E;
  const z = dd < -0.5 ? (dd + 0.5) / Math.sqrt(s2) : dd > 0.5 ? (dd - 0.5) / Math.sqrt(s2) : 0,
    exact = N <= 30;
  let p;
  if (exact) {
    const lc = [0];
    for (let i = 1; i <= N; i++) lc[i] = lc[i - 1] + Math.log(i);
    const ch = (a, b) => (b < 0 || b > a ? 0 : Math.exp(lc[a] - lc[b] - lc[a - b]));
    const pp = r => {
      if (r % 2 === 0) {
        const k = r / 2;
        return 2 * ch(m - 1, k - 1) * ch(n - 1, k - 1);
      }
      const k = (r - 1) / 2;
      return ch(m - 1, k - 1) * ch(n - 1, k) + ch(m - 1, k) * ch(n - 1, k - 1);
    };
    const rmax = m === n ? 2 * m : 2 * Math.min(m, n) + 1,
      den = ch(N, m);
    p = 0;
    for (let r = 2; r <= rmax; r++) if (Math.abs(r - E) >= Math.abs(runs - E) - 1e-9) p += pp(r) / den;
    p = Math.min(1, p);
  } else p = 2 * Math.min(J.normal.cdf(z, 0, 1), 1 - J.normal.cdf(z, 0, 1));
  return { runs, m, n, E, z, p, exact, med };
}
// type: 'ind' (a, b; equalVar), 'paired' (diferencia b − a) o 'one' (a frente a mu). Límites [low, high] en unidades brutas de la
// diferencia o, con bound = 'd', en d de Cohen (se pasan a brutas con la DT combinada, la media de las varianzas, la DT de las diferencias o la de la muestra)
/**
 * Equivalencia por dos pruebas unilaterales (TOST).
 * @param {number[]} a
 * @param {number[]} [b]
 * @param {{ type?: string, mu?: number, low?: number, high?: number, bound?: string, equalVar?: boolean, alpha?: number }} [opciones]
 */
function tost(a, b, { type = 'ind', mu = 0, low, high, bound = 'raw', equalVar = true, alpha = 0.05 } = {}) {
  let est, se, df, sdS;
  if (type === 'ind') {
    const n1 = a.length,
      n2 = b.length,
      v1 = variance(a),
      v2 = variance(b);
    est = mean(a) - mean(b);
    if (equalVar) {
      const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
      se = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
      df = n1 + n2 - 2;
      sdS = Math.sqrt(sp2);
    } else {
      se = Math.sqrt(v1 / n1 + v2 / n2);
      df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
      sdS = Math.sqrt((v1 + v2) / 2);
    }
  } else {
    const x = type === 'paired' ? b.map((v, i) => v - a[i]) : a,
      n = x.length;
    est = mean(x) - (type === 'one' ? mu : 0);
    sdS = sd(x);
    se = sdS / Math.sqrt(n);
    df = n - 1;
  }
  const lo = bound === 'd' ? low * sdS : low,
    hi = bound === 'd' ? high * sdS : high;
  const t0 = est / se,
    tLo = (est - lo) / se,
    tHi = (est - hi) / se;
  const pLo = 1 - J.studentt.cdf(tLo, df),
    pHi = J.studentt.cdf(tHi, df),
    p = Math.max(pLo, pHi),
    tq = J.studentt.inv(1 - alpha, df);
  return {
    type,
    est,
    se,
    df,
    low: lo,
    high: hi,
    sd: sdS,
    t0,
    p0: pT(t0, df),
    tLo,
    pLo,
    tHi,
    pHi,
    p,
    alpha,
    equivalent: p < alpha,
    ci: [est - tq * se, est + tq * se],
    dEst: est / sdS,
  };
}

export {
  anova,
  levene,
  welchAnova,
  tTestInd,
  mannWhitney,
  rbCI,
  kruskal,
  brownForsythe,
  tTestOne,
  tTestPaired,
  wilcoxonOne,
  wilcoxonSigned,
  signTest,
  medianTest,
  ks2,
  jonckheere,
  runsTest,
  tost,
};
