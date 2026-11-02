/* Tharp · motor estadístico · Moderación y mediación (modelos de PROCESS) */
import { aleatorioConSemilla, mean, minOf, quantile, remuestra, sd, sorted } from './base.js';
import { pF, pT, pZ, tcrit } from './distribuciones.js';
import { ols, olsBetaIdx, olsCore } from './regresion.js';

function moderation(y, x, w, C, centerX, centerW) {
  // C: n × q covariables (opcional)
  const mx = centerX ? mean(x) : 0,
    mw = centerW ? mean(w) : 0,
    xc = x.map(v => v - mx),
    wc = w.map(v => v - mw);
  const row = i => [1, xc[i], wc[i], xc[i] * wc[i]].concat(C ? C[i] : []);
  const X = y.map((_, i) => row(i)),
    full = ols(X, y);
  if (!full) return null;
  const red = olsCore(
    X.map(r => r.filter((_, k) => k !== 3)),
    y
  );
  const dR2 = full.r2 - red.r2,
    Fch = dR2 / ((1 - full.r2) / full.dfr);
  const V = full.Ai.map(r => r.map(v => v * full.s2)),
    tc = tcrit(full.dfr),
    b1 = full.b[1],
    b3 = full.b[3];
  const slope = wRaw => {
    const wv = wRaw - mw,
      b = b1 + b3 * wv,
      se = Math.sqrt(V[1][1] + wv * wv * V[3][3] + 2 * wv * V[1][3]),
      t = b / se;
    return { w: wRaw, b, se, t, p: pT(t, full.dfr), ci: [b - tc * se, b + tc * se] };
  };
  // Johnson-Neyman: valores del moderador donde el efecto de X pasa a ser (o deja de ser) significativo
  const A = b3 * b3 - tc * tc * V[3][3],
    B = 2 * (b1 * b3 - tc * tc * V[1][3]),
    Cq = b1 * b1 - tc * tc * V[1][1],
    disc = B * B - 4 * A * Cq;
  const jn =
    disc >= 0 && A !== 0
      ? [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)].map(v => v + mw).sort((a, b) => a - b)
      : [];
  return {
    b: full.b,
    se: full.se,
    t: full.t,
    p: full.pv,
    ci: full.ci,
    r2: full.r2,
    F: full.F,
    df1: full.df1,
    dfr: full.dfr,
    pF: full.pF,
    dR2,
    Fch,
    pch: pF(Fch, 1, full.dfr),
    slope,
    jn,
    mx,
    mw,
    resid: full.e,
    bp: full.bp,
    n: y.length,
  };
}
function mediation(y, x, m, B = 5000, seed = 20261015) {
  const n = y.length,
    c1 = x.map(v => [1, v]),
    c2 = x.map((v, i) => [1, v, m[i]]);
  const fa = ols(c1, m),
    fb = ols(c2, y),
    fc = ols(c1, y);
  if (!fa || !fb || !fc) return null;
  const a = fa.b[1],
    b = fb.b[2],
    cp = fb.b[1],
    c = fc.b[1],
    ab = a * b;
  const sobelSe = Math.sqrt(b * b * fa.se[1] ** 2 + a * a * fb.se[2] ** 2),
    sobelZ = ab / sobelSe;
  const rnd = aleatorioConSemilla(seed);
  const boot = [];
  for (let r = 0; r < B; r++) {
    const idx = remuestra(n, rnd);
    const ra = olsBetaIdx(c1, m, idx),
      rb = olsBetaIdx(c2, y, idx);
    if (ra && rb) boot.push(ra[1] * rb[2]);
  }
  const bs = sorted(boot),
    ci = [quantile(bs, 0.025), quantile(bs, 0.975)],
    sdy = sd(y),
    sdx = sd(x);
  return {
    a,
    b,
    c,
    cp,
    ab,
    se: { a: fa.se[1], b: fb.se[2], c: fc.se[1], cp: fb.se[1] },
    p: { a: fa.pv[1], b: fb.pv[2], c: fc.pv[1], cp: fb.pv[1] },
    t: { a: fa.t[1], b: fb.t[2], c: fc.t[1], cp: fb.t[1] },
    dfa: fa.dfr,
    dfb: fb.dfr,
    dfc: fc.dfr,
    ci,
    bootSe: sd(boot),
    B: boot.length,
    sobel: { z: sobelZ, p: pZ(sobelZ) },
    abStd: (ab * sdx) / sdy,
    r2m: fa.r2,
    r2y: fb.r2,
    n,
  };
}
/**
 * Ecuaciones de cada modelo de PROCESS: variable dependiente, bloques de predictores (funciones del caso i) y nombres.
 * Modelos 4 (mediación en paralelo), 6 (en serie), 7 (moderación de la ruta a) y 14 (moderación de la ruta b).
 */
function ecuacionesProcess(model, x, Ms, W, C) {
  const k = Ms.length,
    X_ = i => [x[i]],
    Mj = j => i => [Ms[j][i]],
    Cv = i => C.map(c => c[i]),
    Wv = i => [W[i]],
    XW = i => [x[i] * W[i]],
    MW = j => i => [Ms[j][i] * W[i]],
    nC = C.map((_, q) => 'C' + q),
    nM = Ms.map((_, j) => 'M' + j),
    eqY = { dv: 'Y', parts: [X_].concat(Ms.map((_, j) => Mj(j))).concat([Cv]), names: ['X'].concat(nM, nC) };
  if (model === 4)
    return Array.from({ length: k }, (_, j) => ({ dv: 'M' + j, parts: [X_, Cv], names: ['X'].concat(nC) })).concat([
      eqY,
    ]);
  if (model === 6)
    return Array.from({ length: k }, (_, j) => ({
      dv: 'M' + j,
      parts: [X_].concat(Ms.slice(0, j).map((_, q) => Mj(q))).concat([Cv]),
      names: ['X'].concat(nM.slice(0, j), nC),
    })).concat([eqY]);
  if (model === 7)
    return [
      { dv: 'M0', parts: [X_, Wv, XW, Cv], names: ['X', 'W', 'X×W'].concat(nC) },
      { dv: 'Y', parts: [X_, Mj(0), Cv], names: ['X', 'M0'].concat(nC) },
    ];
  if (model === 14)
    return [
      { dv: 'M0', parts: [X_, Cv], names: ['X'].concat(nC) },
      { dv: 'Y', parts: [X_, Mj(0), Wv, MW(0), Cv], names: ['X', 'M0', 'W', 'M0×W'].concat(nC) },
    ];
  return [];
}

/** Valores del moderador: percentiles 16, 50 y 84 (PROCESS v4) o los dos valores si es dicotómico */
function valoresModerador(W, wVals) {
  if (!W) return [];
  if (wVals) return wVals;
  const u = [...new Set(W)].sort((a, b) => a - b);
  if (u.length === 2) return u;
  const s = sorted(W);
  return [quantile(s, 0.16), quantile(s, 0.5), quantile(s, 0.84)];
}

/** Rutas del modelo 6: cada subconjunto ordenado de mediadores */
function rutasEnSerie(k) {
  const paths = [];
  const rec = (last, chain) => {
    for (let j = last + 1; j < k; j++) {
      const ch = chain.concat([j]);
      paths.push(ch);
      rec(j, ch);
    }
  };
  rec(-1, []);
  return paths;
}

/** Efectos indirectos (y condicionados, con el índice de mediación moderada) a partir de los coeficientes c(vd, predictor) */
function efectosProcess(model, k, wv, c) {
  const out = {};
  if (model === 4) {
    let tot = 0;
    for (let j = 0; j < k; j++) {
      const v = c('M' + j, 'X') * c('Y', 'M' + j);
      out['ind' + j] = v;
      tot += v;
    }
    out.indTot = tot;
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) out[`con${a}_${b}`] = out['ind' + a] - out['ind' + b];
  }
  if (model === 6) {
    let tot = 0;
    rutasEnSerie(k).forEach(ch => {
      let v = c('M' + ch[0], 'X');
      for (let q = 1; q < ch.length; q++) v *= c('M' + ch[q], 'M' + ch[q - 1]);
      v *= c('Y', 'M' + ch[ch.length - 1]);
      out['path' + ch.join('_')] = v;
      tot += v;
    });
    out.indTot = tot;
  }
  if (model === 7) {
    const a1 = c('M0', 'X'),
      a3 = c('M0', 'X×W'),
      b = c('Y', 'M0');
    wv.forEach((w, q) => {
      out['cond' + q] = (a1 + a3 * w) * b;
    });
    out.imm = a3 * b;
  }
  if (model === 14) {
    const a = c('M0', 'X'),
      b1 = c('Y', 'M0'),
      b3 = c('Y', 'M0×W');
    wv.forEach((w, q) => {
      out['cond' + q] = a * (b1 + b3 * w);
    });
    out.imm = a * b3;
  }
  return out;
}

/** Bootstrap percentil de cada efecto: estimación, EE bootstrap e IC del 95 %; B efectivas = mínimo de remuestras válidas */
function bootstrapEfectos(est, efectosDe, n, B, seed) {
  const rnd = aleatorioConSemilla(seed),
    boot = Object.fromEntries(Object.keys(est).map(key => [key, []]));
  for (let r = 0; r < B; r++) {
    const e = efectosDe(remuestra(n, rnd));
    if (!e) continue;
    Object.keys(e).forEach(key => boot[key].push(e[key]));
  }
  const ci = Object.fromEntries(
    Object.keys(est).map(key => {
      const bs = sorted(boot[key]);
      return [key, { est: est[key], se: sd(boot[key]), ci: [quantile(bs, 0.025), quantile(bs, 0.975)] }];
    })
  );
  return { ci, B: minOf(Object.values(boot).map(v => v.length)) };
}

/** Inferencia completa (MCO) de cada ecuación */
function inferenciaEcuaciones(eqs, design) {
  return eqs.map((e, q) => {
    const m = ols(design[q].X, design[q].y);
    return {
      dv: e.dv,
      names: ['(Constante)'].concat(e.names),
      b: m.b,
      se: m.se,
      t: m.t,
      p: m.pv,
      ci: m.ci,
      r2: m.r2,
      F: m.F,
      df1: m.df1,
      dfr: m.dfr,
      pF: m.pF,
    };
  });
}

/**
 * Modelos 4, 6, 7 y 14 de PROCESS (Hayes, 2022). Sin centrar, como PROCESS por defecto. Devuelve las ecuaciones
 * (coeficientes con EE, t y p) y los efectos indirectos con IC bootstrap percentil (B remuestras, semilla fija).
 * @param {number} model número de modelo
 * @param {number[]} y variable dependiente
 * @param {number[]} x predictor
 * @param {number[][]} Ms mediadores
 * @param {number[]|null} W moderador (modelos 7 y 14)
 * @param {number[][]} C covariables
 * @param {{B?: number, seed?: number, wVals?: number[]|null}} [opciones] remuestras bootstrap, semilla y valores del moderador
 */
function processModel(model, y, x, Ms, W = null, C = [], { B = 5000, seed = 20261015, wVals = null } = {}) {
  const n = y.length,
    k = Ms.length,
    eqs = ecuacionesProcess(model, x, Ms, W, C),
    dvOf = (dv, i) => (dv === 'Y' ? y[i] : Ms[+dv.slice(1)][i]);
  // matrices de diseño de cada ecuación una sola vez; el bootstrap solo recalcula los coeficientes sobre los índices remuestreados
  const design = eqs.map(e => ({
    X: Array.from({ length: n }, (_, i) => [1].concat(...e.parts.map(pt => pt(i)))),
    y: Array.from({ length: n }, (_, i) => dvOf(e.dv, i)),
  }));
  const wv = valoresModerador(W, wVals);
  const efectosDe = idx => {
    const bs = design.map(d => olsBetaIdx(d.X, d.y, idx));
    if (bs.some(b => !b)) return null;
    return efectosProcess(model, k, wv, (dv, nm) => {
      const q = eqs.findIndex(e => e.dv === dv);
      return bs[q][eqs[q].names.indexOf(nm) + 1];
    });
  };
  const est = efectosDe(Array.from({ length: n }, (_, i) => i));
  if (!est) return null;
  const { ci, B: Bv } = bootstrapEfectos(est, efectosDe, n, B, seed);
  const eqOut = inferenciaEcuaciones(eqs, design);
  // efectos total y directo de X sobre Y
  const tot = ols(
      y.map((_, i) => [1, x[i]].concat(C.map(c => c[i]))),
      y
    ),
    dirEq = eqOut.find(e => e.dv === 'Y'),
    jx = dirEq.names.indexOf('X');
  return {
    model,
    n,
    eqs: eqOut,
    effects: ci,
    B: Bv,
    wv,
    total: { b: tot.b[1], se: tot.se[1], t: tot.t[1], p: tot.pv[1], ci: tot.ci[1] },
    direct: { b: dirEq.b[jx], se: dirEq.se[jx], t: dirEq.t[jx], p: dirEq.p[jx], ci: dirEq.ci[jx] },
  };
}

export { moderation, mediation, processModel };
