/* Tharp · motor estadístico · Modelos lineales con factores: ANOVA factorial, ANCOVA, MANOVA */
import { J, holm, maxOf, mean, sum } from './base.js';
import { pChi, pF, pT, tcrit } from './distribuciones.js';
import { det, eigSym, inv, matMul, tr } from './algebra.js';
import { olsCore } from './regresion.js';
/** @typedef {import('./base.js').Registro} Registro */

/**
 * Diseño factorial con codificación de efectos (contr.sum): constante, cada término (efectos principales e
 * interacciones, por orden) y las covariables. Devuelve X, los términos con sus columnas y la función de fila.
 * @param {number[][]} F n × k índices de nivel
 * @param {number[]} L niveles por factor
 * @param {number[][]} C q arrays de covariables
 */
function disenoFactorial(F, L, C) {
  const k = L.length,
    codes = (f, lvl) => Array.from({ length: L[f] - 1 }, (_, j) => (lvl === j ? 1 : lvl === L[f] - 1 ? -1 : 0));
  const subsets = [];
  for (let mask = 1; mask < 1 << k; mask++) subsets.push([...Array(k).keys()].filter(f => mask & (1 << f)));
  subsets.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
  const termCols = lv =>
    subsets.map(sub =>
      sub.reduce(
        (acc, f) => {
          const c = codes(f, lv[f]),
            out = [];
          acc.forEach(a => c.forEach(b => out.push(a * b)));
          return out;
        },
        [1]
      )
    );
  const rowOf = (lv, cov) => [1].concat(...termCols(lv)).concat(cov);
  const X = F.map((lv, i) =>
    rowOf(
      lv,
      C.map(c => c[i])
    )
  );
  const terms = /** @type {Registro[]} */ (
    subsets.map(sub => ({ factors: sub, df: sub.reduce((a, f) => a * (L[f] - 1), 1) }))
  ).concat(C.map((_, j) => ({ cov: j, df: 1 })));
  let off = 1;
  terms.forEach(t => {
    t.cols = Array.from({ length: t.df }, (_, j) => off + j);
    off += t.df;
  });
  return { X, terms, rowOf };
}

/** Columnas de X sin las del término t (modelo reducido para la SC de tipo III) */
const sinTermino = (X, t) => {
  const keep = X[0].map((_, j) => j).filter(j => !t.cols.includes(j));
  return X.map(r => keep.map(j => r[j]));
};

/** Todas las combinaciones de niveles de los factores fs, como listas de pares [factor, nivel] */
function rejilla(fs, L) {
  let combos = [[]];
  fs.forEach(f => {
    const nx = [];
    combos.forEach(c => {
      for (let l = 0; l < L[f]; l++) nx.push(c.concat([[f, l]]));
    });
    combos = nx;
  });
  return combos;
}

/** Medias marginales estimadas de los factores fs promediando la rejilla del resto, con su EE (como emmeans) */
function mediasMarginales(fs, L, rowOf, covMean, b, V) {
  const k = L.length,
    combos = rejilla(
      [...Array(k).keys()].filter(f => !fs.includes(f)),
      L
    );
  return rejilla(fs, L).map(tg => {
    const rows = combos.map(cb => {
      const lv = new Array(k).fill(0);
      tg.concat(cb).forEach(([f, l]) => {
        lv[f] = l;
      });
      return rowOf(lv, covMean);
    });
    const c = rows[0].map((_, j) => mean(rows.map(r => r[j]))),
      em = sum(c.map((v, j) => v * b[j])),
      se = Math.sqrt(sum(c.map((v, a) => sum(c.map((w, q) => v * V[a][q] * w)))));
    return { levels: tg.map(([, l]) => l), c, em, se };
  });
}

/** Comparaciones por pares de medias marginales con ajuste de Tukey (t si hay dos) y d = diferencia / √MCE */
function paresTukey(e, V, dfE, mse) {
  const out = [],
    K = e.length;
  for (let i = 0; i < K; i++)
    for (let j = i + 1; j < K; j++) {
      const c = e[i].c.map((v, a) => v - e[j].c[a]),
        est = e[i].em - e[j].em,
        se = Math.sqrt(sum(c.map((v, a) => sum(c.map((w, b) => v * V[a][b] * w))))),
        t = est / se;
      out.push({
        i,
        j,
        est,
        se,
        t,
        p: K === 2 ? pT(t, dfE) : Math.min(1, 1 - J.tukey.cdf(Math.abs(t) * Math.SQRT2, K, dfE)),
        d: est / Math.sqrt(mse),
      });
    }
  return out;
}

// SC de tipo III con codificación de efectos (como car::Anova(type = 3) con contr.sum), medias marginales estimadas
// promediando sin ponderar la rejilla de niveles con las covariables en su media (como emmeans)
function glmFactorial(y, F, L, C = []) {
  // F: n × k índices de nivel; L: niveles por factor; C: q arrays de covariables
  const n = y.length,
    { X, terms, rowOf } = disenoFactorial(F, L, C);
  const full = olsCore(X, y);
  if (!full) return null;
  const dfE = n - X[0].length,
    mse = full.sse / dfE;
  terms.forEach(t => {
    const red = olsCore(sinTermino(X, t), y);
    t.ss = red.sse - full.sse;
    t.ms = t.ss / t.df;
    t.F = t.ms / mse;
    t.p = pF(t.F, t.df, dfE);
    t.peta2 = t.ss / (t.ss + full.sse);
    t.pomega2 = Math.max(0, (t.df * (t.F - 1)) / (t.df * (t.F - 1) + n));
  });
  const covMean = C.map(c => mean(c)),
    V = full.Ai.map(r => r.map(v => v * mse));
  const emm = fs => mediasMarginales(fs, L, rowOf, covMean, full.b, V);
  const pairs = f => {
    const e = emm([f]);
    return { emm: e, pairs: paresTukey(e, V, dfE, mse) };
  };
  return { terms, sse: full.sse, dfE, mse, resid: full.e, b: full.b, emm, pairs, covMean, n };
}

/** Matriz SCPC residual de las variables dependientes en el modelo Xm; null si X'X es singular */
function scpcResidual(Xm, Ys) {
  const n = Ys[0].length,
    Ai = inv(matMul(tr(Xm), Xm));
  if (!Ai) return null;
  const P = matMul(Xm, matMul(Ai, tr(Xm)));
  const Y = Array.from({ length: n }, (_, i) => Ys.map(y => y[i])),
    R = Y.map((r, i) => r.map((v, d) => v - sum(P[i].map((w, j) => w * Y[j][d]))));
  return matMul(tr(R), R);
}

/** Factor de Cholesky (con la diagonal acotada para matrices casi singulares) */
function cholesky(A) {
  const m = A.length,
    Lc = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let q = 0; q < j; q++) s -= Lc[i][q] * Lc[j][q];
      Lc[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / Lc[j][j];
    }
  return Lc;
}

/** Pillai, Wilks, Hotelling-Lawley y Roy con las aproximaciones F de R (summary.manova); eig: autovalores de E⁻¹H */
function pruebasMultivariadas(eig, p, q, dfE) {
  const s = Math.min(p, q),
    m = 0.5 * (Math.abs(p - q) - 1),
    nn = 0.5 * (dfE - p - 1);
  const V = sum(eig.map(l => l / (1 + l))),
    W = eig.reduce((a, l) => a / (1 + l), 1),
    HL = sum(eig),
    Roy = maxOf(eig);
  const pil = {
    stat: V,
    F: (((2 * nn + s + 1) / (2 * m + s + 1)) * V) / (s - V),
    df1: s * (2 * m + s + 1),
    df2: s * (2 * nn + s + 1),
  };
  const t1 = dfE - 0.5 * (p - q + 1),
    t2 = (p * q - 2) / 4,
    t3r = p * p + q * q - 5,
    t3 = t3r > 0 ? Math.sqrt(((p * q) ** 2 - 4) / t3r) : 1;
  const wil = {
    stat: W,
    F: ((Math.pow(W, -1 / t3) - 1) * (t1 * t3 - 2 * t2)) / p / q,
    df1: p * q,
    df2: t1 * t3 - 2 * t2,
  };
  const hlt = {
    stat: HL,
    F: (2 * (s * nn + 1) * HL) / s / s / (2 * m + s + 1),
    df1: s * (2 * m + s + 1),
    df2: 2 * (s * nn + 1),
  };
  const ro1 = Math.max(p, q),
    roy = { stat: Roy, F: ((dfE - ro1 + q) * Roy) / ro1, df1: ro1, df2: dfE - ro1 + q };
  [pil, wil, hlt, roy].forEach(o => {
    o.p = pF(o.F, o.df1, o.df2);
  });
  return {
    tests: { pillai: pil, wilks: wil, hotelling: hlt, roy },
    eta2: { pillai: V / s, wilks: 1 - Math.pow(W, 1 / s) },
  };
}

// Ys: p arrays de variables dependientes; F, L, C como en glmFactorial. Para cada término: H = SSCP residual del modelo sin el término
// menos el del completo; estadísticos de Pillai, Wilks, Hotelling-Lawley y Roy con las aproximaciones F de R (summary.manova)
function manova(Ys, F, L, C = []) {
  const n = Ys[0].length,
    p = Ys.length,
    { X, terms } = disenoFactorial(F, L, C);
  const E = scpcResidual(X, Ys);
  if (!E) return null;
  const dfE = n - X[0].length,
    Ei = inv(E);
  // autovalores de E⁻¹H a partir de la forma simétrica L⁻¹ H L⁻ᵀ (Cholesky de E)
  const Li = inv(cholesky(E));
  terms.forEach(t => {
    const Er = scpcResidual(sinTermino(X, t), Ys);
    const H = Er.map((r, a) => r.map((v, b) => v - E[a][b])),
      M = matMul(matMul(Li, H), tr(Li)),
      Ms = M.map((r, a) => r.map((v, b) => (v + M[b][a]) / 2));
    const eig = eigSym(Ms).values.map(v => Math.max(0, v));
    Object.assign(t, pruebasMultivariadas(eig, p, t.df, dfE), { H });
  });
  return { terms, E, dfE, n, p, Ei };
}
// prueba M de Box de igualdad de matrices de covarianzas (aproximación χ²), como heplots::boxM
function boxM(groups) {
  // groups: g arrays de casos, cada caso un array de p valores
  const g = groups.length,
    p = groups[0][0].length,
    ns = groups.map(G => G.length),
    N = sum(ns);
  const cov = G => {
    const m = Array.from({ length: p }, (_, d) => mean(G.map(r => r[d])));
    return Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) => sum(G.map(r => (r[a] - m[a]) * (r[b] - m[b]))) / (G.length - 1))
    );
  };
  const Ss = groups.map(cov),
    Sp = Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) => sum(Ss.map((S, q) => (ns[q] - 1) * S[a][b])) / (N - g))
    );
  const ld = A => Math.log(Math.max(1e-300, det(A))),
    M = (N - g) * ld(Sp) - sum(Ss.map((S, q) => (ns[q] - 1) * ld(S)));
  const c1 = ((sum(ns.map(x => 1 / (x - 1))) - 1 / (N - g)) * (2 * p * p + 3 * p - 1)) / (6 * (p + 1) * (g - 1)),
    chi = M * (1 - c1),
    df = (p * (p + 1) * (g - 1)) / 2;
  return { M, chi, df, p: pChi(chi, df) };
}
function anova2(y, a, b, la, lb) {
  // a, b: índices de nivel por caso
  const effA = (i, j) => (a[i] === j ? 1 : a[i] === la - 1 ? -1 : 0),
    effB = (i, j) => (b[i] === j ? 1 : b[i] === lb - 1 ? -1 : 0);
  const n = y.length,
    colsA = [],
    colsB = [],
    colsAB = [];
  for (let j = 0; j < la - 1; j++) colsA.push(y.map((_, i) => effA(i, j)));
  for (let j = 0; j < lb - 1; j++) colsB.push(y.map((_, i) => effB(i, j)));
  colsA.forEach(ca => colsB.forEach(cb => colsAB.push(ca.map((v, i) => v * cb[i]))));
  const build = sets => y.map((_, i) => [1].concat(...sets.map(s => s.map(c => c[i]))));
  const full = olsCore(build([colsA, colsB, colsAB]), y);
  if (!full) return null;
  const dfE = n - full.p,
    mse = full.sse / dfE,
    out = {};
  /** @type {Array<[string, number[][], number]>} */ ([
    ['A', [colsB, colsAB], la - 1],
    ['B', [colsA, colsAB], lb - 1],
    ['AB', [colsA, colsB], (la - 1) * (lb - 1)],
  ]).forEach(([k, sets, df]) => {
    const red = olsCore(build(sets), y),
      ss = red.sse - full.sse,
      F = ss / df / mse;
    out[k] = { ss, df, ms: ss / df, F, p: pF(F, df, dfE), peta2: ss / (ss + full.sse) };
  });
  return Object.assign(out, { sse: full.sse, dfE, mse, resid: full.e, r2: full.r2 });
}
function ancova(y, g, L, C) {
  // g: índice de nivel por caso; C: n × q covariables
  const n = y.length,
    q = C[0].length;
  const eff = (i, j) => (g[i] === j ? 1 : g[i] === L - 1 ? -1 : 0);
  const G = Array.from({ length: L - 1 }, (_, j) => y.map((_, i) => eff(i, j)));
  const cov = Array.from({ length: q }, (_, c) => C.map(r => r[c]));
  const build = sets => y.map((_, i) => [1].concat(...sets.map(s => s.map(col => col[i]))));
  const full = olsCore(build([G, cov]), y);
  if (!full) return null;
  const dfE = n - full.p,
    mse = full.sse / dfE;
  const term = (sets, df) => {
    const red = olsCore(build(sets), y);
    if (!red) return null;
    const ss = red.sse - full.sse,
      F = ss / df / mse;
    return { ss, df, ms: ss / df, F, p: pF(F, df, dfE), peta2: ss / (ss + full.sse) };
  };
  const factor = term([cov], L - 1);
  const covs = cov.map((_, c) => term([G, cov.filter((__, k) => k !== c)], 1));
  // homogeneidad de pendientes: añadir las interacciones factor × covariable
  const inter = [];
  G.forEach(gc => cov.forEach(cc => inter.push(gc.map((v, i) => v * cc[i]))));
  const fi = olsCore(build([G, cov, inter]), y);
  let slopes = null;
  if (fi) {
    const dfi = inter.length,
      dfr = n - fi.p,
      F = (full.sse - fi.sse) / dfi / (fi.sse / dfr);
    slopes = { F, df1: dfi, df2: dfr, p: pF(F, dfi, dfr) };
  }
  // medias ajustadas (en la media de las covariables) y comparaciones por pares
  const cm = cov.map(mean),
    V = full.Ai.map(r => r.map(v => v * mse));
  const lvec = j =>
    [1].concat(
      Array.from({ length: L - 1 }, (_, k) => (j === k ? 1 : j === L - 1 ? -1 : 0)),
      cm
    );
  const est = l => sum(l.map((v, k) => v * full.b[k])),
    se = l => Math.sqrt(sum(l.map((a, r) => sum(l.map((b, c) => a * V[r][c] * b)))));
  const tc = tcrit(dfE),
    adj = Array.from({ length: L }, (_, j) => {
      const l = lvec(j),
        m = est(l),
        s = se(l);
      return { mean: m, se: s, ci: [m - tc * s, m + tc * s] };
    });
  const pairs = [];
  for (let a = 0; a < L; a++)
    for (let b = a + 1; b < L; b++) {
      const l = lvec(a).map((v, k) => v - lvec(b)[k]),
        d = est(l),
        s = se(l),
        t = d / s;
      pairs.push({ i: a, j: b, diff: d, se: s, t, p: pT(t, dfE) });
    }
  holm(pairs.map(o => o.p)).forEach((p, k) => (pairs[k].padj = p));
  return { factor, covs, slopes, adj, pairs, dfE, mse, sse: full.sse, resid: full.e, b: full.b, r2: full.r2 };
}

export { glmFactorial, manova, boxM, anova2, ancova };
