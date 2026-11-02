/* Tharp · motor estadístico · Medidas repetidas y diseños mixtos */
import { J, binomTwoSided, holm, mean, ranks, sum } from './base.js';
import { pChi, pF, pT } from './distribuciones.js';
import { det } from './algebra.js';
/** @typedef {import('./base.js').Registro} Registro */

// ---- Piezas comunes de los diseños intrasujeto ----

/** Contrastes ortonormales de Helmert para k niveles ((k − 1) × k) */
function helmert(k) {
  const C = [];
  for (let j = 0; j < k - 1; j++) {
    const v = new Array(k).fill(0),
      m = j + 1;
    for (let i = 0; i < m; i++) v[i] = 1;
    v[m] = -m;
    const nr = Math.sqrt(m * (m + 1));
    C.push(v.map(x => x / nr));
  }
  return C;
}

/** Producto de Kronecker de dos matrices */
function kron(A, B) {
  const out = /** @type {number[][]} */ ([]);
  A.forEach(a =>
    B.forEach(b => {
      const r = [];
      a.forEach(x => b.forEach(z => r.push(x * z)));
      out.push(r);
    })
  );
  return out;
}

/** Traza de S y de S² (para los ε de esfericidad) */
function trazas(S) {
  return { tr: sum(S.map((r, i) => r[i])), tr2: sum(S.map((r, i) => sum(r.map((v, j) => v * S[j][i])))) };
}

/** ε de Greenhouse-Geisser a partir de la covarianza de p contrastes ortonormales */
function epsilonGG(S, p) {
  const { tr, tr2 } = trazas(S);
  return Math.min(1, (tr * tr) / (p * tr2));
}

/** ε de Huynh-Feldt (con G grupos y n personas) */
function epsilonHF(gg, n, G, p) {
  return Math.min(1, ((n - G + 1) * p * gg - 2) / (p * (n - G - p * gg)));
}

/** Prueba de esfericidad de Mauchly como mauchly.test de R: aproximación χ² con la corrección de segundo orden */
function mauchly(S, p, nu) {
  const { tr } = trazas(S),
    W = det(S) / (tr / p) ** p,
    dfm = (p * (p + 1)) / 2 - 1,
    rho = 1 - (2 * p * p + p + 2) / (6 * p * nu);
  const chi = -nu * rho * Math.log(W),
    w2 = ((p + 2) * (p - 1) * (p - 2) * (2 * p ** 3 + 6 * p * p + 3 * p + 2)) / (288 * (nu * p * rho) ** 2);
  return { W, chi, df: dfm, p: pChi(chi, dfm) + w2 * (pChi(chi, dfm + 4) - pChi(chi, dfm)) };
}

/**
 * Estrato intrasujeto de un efecto: puntuaciones en sus contrastes M, SC del efecto (con el intercepto no ponderado),
 * SC de su interacción con el grupo y matriz SCPC de error intragrupo.
 */
function estratoIntra(Y, M, gi, G, ng) {
  const p = M.length,
    Z = Y.map(r => M.map(c => sum(c.map((w, a) => w * r[a]))));
  const gm = Array.from({ length: G }, (_, j) => M.map((_, c) => mean(Z.filter((_, i) => gi[i] === j).map(z => z[c]))));
  let ssT = 0,
    ssTG = 0;
  const E = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let c = 0; c < p; c++) {
    const u = mean(gm.map(m => m[c])),
      zbar = mean(Z.map(z => z[c]));
    ssT += (u * u) / (sum(ng.map(x => 1 / x)) / (G * G));
    ssTG += sum(ng.map((x, j) => x * (gm[j][c] - zbar) ** 2));
  }
  Z.forEach((z, i) => {
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) E[a][b] += (z[a] - gm[gi[i]][a]) * (z[b] - gm[gi[i]][b]);
  });
  return { ssT, ssTG, E, ssE: sum(E.map((r, i) => r[i])) };
}

/**
 * Comparaciones por pares entre niveles intrasujeto, promediando los grupos sin ponderar, con el error propio de cada
 * diferencia (como emmeans «multivariate») y ajuste de Holm. niveles[a][i]: valor de la persona i en el nivel a.
 */
function paresIntra(niveles, gi, G, ng, dfS) {
  const res = /** @type {Registro[]} */ ([]);
  for (let a = 0; a < niveles.length; a++)
    for (let b = a + 1; b < niveles.length; b++) {
      const dI = niveles[a].map((v, i) => v - niveles[b][i]),
        gmd = Array.from({ length: G }, (_, j) => mean(dI.filter((_, i) => gi[i] === j)));
      const est = mean(gmd),
        s2 = sum(dI.map((v, i) => (v - gmd[gi[i]]) ** 2)) / dfS,
        se = Math.sqrt(s2 * sum(ng.map(x => 1 / x))) / G,
        t = est / se;
      res.push({ a, b, est, se, t, df: dfS, p: pT(t, dfS) });
    }
  const adj = holm(res.map(o => o.p));
  res.forEach((o, q) => {
    o.padj = adj[q];
  });
  return res;
}

/** Covarianza (n − 1) de las medidas y su proyección en los contrastes C */
function covContrastes(Y, cm, C) {
  const n = Y.length,
    k = cm.length;
  const S = Array.from({ length: k }, (_, a) =>
    Array.from({ length: k }, (_, b) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += (Y[i][a] - cm[a]) * (Y[i][b] - cm[b]);
      return s / (n - 1);
    })
  );
  return C.map(ca =>
    C.map(cb => {
      let s = 0;
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) s += ca[a] * S[a][b] * cb[b];
      return s;
    })
  );
}

// ---- ANOVA de medidas repetidas de un factor ----

function rmAnova(Y) {
  // Y: n casos × k momentos (casos completos)
  const n = Y.length,
    k = Y[0].length,
    all = Y.flat(),
    gm = mean(all);
  const cm = Array.from({ length: k }, (_, j) => mean(Y.map(r => r[j]))),
    sm = Y.map(mean);
  const ssCond = n * sum(cm.map(m => (m - gm) ** 2)),
    ssSubj = k * sum(sm.map(m => (m - gm) ** 2));
  const ssTot = sum(all.map(v => (v - gm) ** 2)),
    ssErr = ssTot - ssCond - ssSubj;
  const df1 = k - 1,
    df2 = (k - 1) * (n - 1),
    F = ssCond / df1 / (ssErr / df2);
  // esfericidad: contrastes ortonormales de Helmert sobre la matriz de covarianzas
  const p = k - 1,
    M = covContrastes(Y, cm, helmert(k)),
    gg = epsilonGG(M, p);
  return {
    F,
    df1,
    df2,
    p: pF(F, df1, df2),
    ssCond,
    ssSubj,
    ssErr,
    n,
    k,
    means: cm,
    peta2: ssCond / (ssCond + ssErr),
    ges: ssCond / (ssCond + ssSubj + ssErr),
    gg,
    mauchly: k > 2 ? mauchly(M, p, n - 1) : null,
    pGG: pF(F, df1 * gg, df2 * gg),
  };
}

// ---- ANOVA mixta (un factor intra × un factor entre) ----

// SC de tipo III también con grupos desiguales (como afex/SPSS/JASP): estrato entre sujetos = ANOVA de las medias
// de cada persona; estrato intra = contrastes ortonormales de las medidas, con el intercepto no ponderado (momento)
// y el efecto de grupo (interacción). Esfericidad sobre la covarianza intragrupo combinada de los contrastes.
function mixedAnova(Y, g, G) {
  const n = Y.length,
    k = Y[0].length,
    p = k - 1,
    ng = new Array(G).fill(0);
  g.forEach(x => ng[x]++);
  const sm = Y.map(mean),
    gmS = new Array(G).fill(0);
  sm.forEach((v, i) => {
    gmS[g[i]] += v;
  });
  for (let j = 0; j < G; j++) gmS[j] /= ng[j];
  const grand = mean(sm),
    ssB = k * sum(ng.map((c, j) => c * (gmS[j] - grand) ** 2)),
    ssSe = k * sum(sm.map((v, i) => (v - gmS[g[i]]) ** 2));
  const dfB = G - 1,
    dfSe = n - G,
    FB = ssB / dfB / (ssSe / dfSe);
  const { ssT, ssTG, E, ssE } = estratoIntra(Y, helmert(k), g, G, ng);
  const dfT = p,
    dfTG = (G - 1) * p,
    dfE = dfSe * p,
    FT = ssT / dfT / (ssE / dfE),
    FTG = ssTG / dfTG / (ssE / dfE);
  const Sg = E.map(r => r.map(v => v / dfSe)),
    gg = epsilonGG(Sg, p),
    hf = epsilonHF(gg, n, G, p);
  const errAll = ssSe + ssE,
    eff = (ss, df1, df2, F, errSS) => ({
      ss,
      df1,
      df2,
      F,
      p: pF(F, df1, df2),
      peta2: ss / (ss + errSS),
      ges: ss / (ss + errAll),
      pGG: pF(F, df1 * gg, df2 * gg),
      pHF: pF(F, df1 * hf, df2 * hf),
    });
  const cellMeans = Array.from({ length: G }, (_, j) =>
    Array.from({ length: k }, (_, a) => mean(Y.filter((_, i) => g[i] === j).map(r => r[a])))
  );
  return {
    n,
    k,
    G,
    ng,
    gg,
    hf,
    mauchly: k > 2 ? mauchly(Sg, p, dfSe) : null,
    within: paresIntra(
      Array.from({ length: k }, (_, a) => Y.map(r => r[a])),
      g,
      G,
      ng,
      dfSe
    ),
    cellMeans,
    subjMeans: sm,
    B: eff(ssB, dfB, dfSe, FB, ssSe),
    T: eff(ssT, dfT, dfE, FT, ssE),
    TG: eff(ssTG, dfTG, dfE, FTG, ssE),
    ssSe,
    dfSe,
    ssE,
    dfE,
  };
}

// ---- ANOVA de medidas repetidas factorial (varios factores intra, con o sin factor entre) ----

/** Subconjuntos no vacíos de los factores intrasujeto (efectos principales e interacciones), por orden */
function efectosIntra(nf) {
  const subsets = [];
  for (let mask = 1; mask < 1 << nf; mask++) subsets.push([...Array(nf).keys()].filter(f => mask & (1 << f)));
  return subsets.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

/** Un efecto intrasujeto con su propio término de error, esfericidad y correcciones */
function efectoIntra(Y, kw, sub, gi, G, ng, dfS) {
  const n = Y.length;
  let M = [[1]];
  kw.forEach((k, f) => {
    M = kron(M, sub.includes(f) ? helmert(k) : [new Array(k).fill(1 / Math.sqrt(k))]);
  });
  const p = M.length,
    { ssT, ssTG, E, ssE } = estratoIntra(Y, M, gi, G, ng),
    Sg = E.map(r => r.map(v => v / dfS));
  const gg = p > 1 ? epsilonGG(Sg, p) : 1,
    hf = p > 1 ? epsilonHF(gg, n, G, p) : 1;
  const dfE = p * dfS,
    mk = (ss, df) => {
      const F = ss / df / (ssE / dfE);
      return {
        ss,
        df,
        F,
        p: pF(F, df, dfE),
        pGG: pF(F, df * gg, dfE * gg),
        pHF: pF(F, df * hf, dfE * hf),
        peta2: ss / (ss + ssE),
      };
    };
  return {
    factors: sub,
    p,
    M,
    ssE,
    dfE,
    gg,
    hf,
    mauchly: p > 1 ? mauchly(Sg, p, dfS) : null,
    T: mk(ssT, p),
    TG: G > 1 ? mk(ssTG, (G - 1) * p) : null,
  };
}

/** Puntuación de cada persona en cada nivel del factor f (media de las casillas de ese nivel) */
function marginalesFactor(Y, kw, f, cellIdx) {
  const nf = kw.length,
    out = /** @type {number[][]} */ ([]);
  for (let l = 0; l < kw[f]; l++) {
    const cols = [];
    const rec = (f2, lv) => {
      if (f2 === nf) {
        if (lv[f] === l) cols.push(cellIdx(lv));
        return;
      }
      for (let q = 0; q < kw[f2]; q++) rec(f2 + 1, lv.concat([q]));
    };
    rec(0, []);
    out.push(Y.map(r => mean(cols.map(c => r[c]))));
  }
  return out;
}

// Y: n × (k1·k2·…) con las casillas ordenadas como en SPSS (el último factor cambia más rápido); kw: niveles de cada factor
// intrasujeto; g/G: grupo de cada persona (opcional). Cada efecto intrasujeto se contrasta con su propio término de error
// (contrastes ortonormales de Helmert combinados por producto de Kronecker), como afex/SPSS/JASP.
function rmFactorial(Y, kw, g = null, G = 1) {
  const n = Y.length,
    K = Y[0].length,
    ng = new Array(G).fill(0),
    gi = g || new Array(n).fill(0);
  gi.forEach(x => ng[x]++);
  const dfS = n - G,
    sm = Y.map(mean),
    gmS = Array.from({ length: G }, (_, j) => mean(sm.filter((_, i) => gi[i] === j))),
    grand = mean(sm);
  const ssB = K * sum(ng.map((c, j) => c * (gmS[j] - grand) ** 2)),
    ssSe = K * sum(sm.map((v, i) => (v - gmS[gi[i]]) ** 2));
  const effects = efectosIntra(kw.length).map(sub => efectoIntra(Y, kw, sub, gi, G, ng, dfS));
  const errAll = ssSe + sum(effects.map(e => e.ssE));
  effects.forEach(e => {
    e.T.ges = e.T.ss / (e.T.ss + errAll);
    if (e.TG) e.TG.ges = e.TG.ss / (e.TG.ss + errAll);
  });
  let B = null;
  if (G > 1) {
    const F = ssB / (G - 1) / (ssSe / dfS);
    B = { ss: ssB, df: G - 1, F, p: pF(F, G - 1, dfS), peta2: ssB / (ssB + ssSe), ges: ssB / (ssB + errAll) };
  }
  // medias marginales de cada factor intrasujeto (promediando grupos sin ponderar) y comparaciones por pares (error propio, Holm)
  const cellIdx = lv => lv.reduce((acc, l, f) => acc * kw[f] + l, 0);
  const within = f => {
    const S_ = marginalesFactor(Y, kw, f, cellIdx);
    return { means: S_.map(s => mean(s)), pairs: paresIntra(S_, gi, G, ng, dfS) };
  };
  return { n, G, ng, effects, B, ssSe, dfS, within, cellIdx };
}
function friedman(Y) {
  const n = Y.length,
    k = Y[0].length,
    R = new Array(k).fill(0);
  let ties = 0;
  Y.forEach(row => {
    const r = ranks(row);
    r.r.forEach((v, j) => (R[j] += v));
    ties += r.ties;
  });
  const Q0 = (12 / (n * k * (k + 1))) * sum(R.map(v => v * v)) - 3 * n * (k + 1),
    Q = Q0 / (1 - ties / (n * k * (k * k - 1)));
  return { Q, df: k - 1, p: pChi(Q, k - 1), W: Q / (n * (k - 1)), meanRanks: R.map(v => v / n), n, k };
}
// comparaciones por pares tras Friedman (como PMCMRplus): Conover (t, gl = (n−1)(k−1)), Siegel-Castellan/Dunn (z) y Nemenyi (rango studentizado, gl = ∞)
function friedmanPosthoc(Y, method = 'conover', adjust = 'holm') {
  const n = Y.length,
    k = Y[0].length,
    Rk = Y.map(row => ranks(row).r),
    Rs = new Array(k).fill(0);
  let s2 = 0;
  Rk.forEach(r =>
    r.forEach((v, j) => {
      Rs[j] += v;
      s2 += v * v;
    })
  );
  const S2 = (1 / (k - 1)) * (s2 - (k * n * (k + 1) ** 2) / 4),
    T2 = sum(Rs.map(v => (v - (n * (k + 1)) / 2) ** 2)) / S2;
  const A = (S2 * 2 * n * (k - 1)) / (n * k - k - n + 1),
    B = 1 - T2 / (n * (k - 1)),
    df = n * k - k - n + 1,
    seZ = Math.sqrt((k * (k + 1)) / (6 * n));
  const out = /** @type {Registro[]} */ ([]);
  for (let a = 0; a < k; a++)
    for (let b = a + 1; b < k; b++) {
      if (method === 'conover') {
        const t = (Rs[b] - Rs[a]) / Math.sqrt(A * B);
        out.push({ a, b, stat: t, p: pT(t, df), df });
      } else if (method === 'nemenyi') {
        const q = (Math.abs(Rs[b] - Rs[a]) / n / seZ) * Math.SQRT2;
        out.push({
          a,
          b,
          stat: (q / Math.SQRT2) * Math.sign(Rs[b] - Rs[a]),
          q,
          p: Math.min(1, 1 - J.tukey.cdf(q, k, 1e7)),
        });
      } else {
        const z = (Rs[b] - Rs[a]) / n / seZ;
        out.push({ a, b, stat: z, p: 2 * (1 - J.normal.cdf(Math.abs(z), 0, 1)) });
      }
    }
  if (method !== 'nemenyi') {
    const m = out.length,
      adj =
        adjust === 'bonferroni'
          ? out.map(o => Math.min(1, o.p * m))
          : adjust === 'none'
            ? out.map(o => o.p)
            : holm(out.map(o => o.p));
    out.forEach((o, i) => (o.padj = adj[i]));
  } else out.forEach(o => (o.padj = o.p));
  return out;
}
function mcnemar(b, c) {
  // b: 0→1, c: 1→0 (casos discordantes)
  const nd = b + c,
    chi = nd ? (Math.abs(b - c) - 1) ** 2 / nd : 0;
  return { b, c, chi, df: 1, p: nd ? pChi(chi, 1) : 1, pExact: nd ? binomTwoSided(Math.min(b, c), nd) : 1 };
}
function cochranQ(M) {
  // M: n × k con 0/1
  const k = M[0].length,
    Cj = Array.from({ length: k }, (_, j) => sum(M.map(r => r[j]))),
    Ri = M.map(sum),
    N = sum(Ri);
  const den = k * N - sum(Ri.map(r => r * r)),
    Q = den ? ((k - 1) * (k * sum(Cj.map(c => c * c)) - N * N)) / den : 0;
  return { Q, df: k - 1, p: den ? pChi(Q, k - 1) : 1, props: Cj.map(c => c / M.length), n: M.length };
}

export { rmAnova, mixedAnova, rmFactorial, friedman, friedmanPosthoc, mcnemar, cochranQ };
