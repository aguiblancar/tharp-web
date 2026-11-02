/* Tharp · motor estadístico · Modelos lineales mixtos */
import { mean, sum, variance } from './base.js';
import { pT, pZ, tcrit } from './distribuciones.js';
import { det, ident, inv, nelderMead } from './algebra.js';

/** Filas de cada grupo con su diseño de efectos fijos (X) y aleatorios (Z: intercepto y, si la hay, pendiente) */
function gruposLMM(y, X, g, zcol, q) {
  const ids = [...new Set(g)];
  const G = ids.map(id => {
    const rows = [];
    g.forEach((v, i) => {
      if (v === id) rows.push(i);
    });
    return {
      rows,
      X: rows.map(i => X[i]),
      y: rows.map(i => y[i]),
      Z: rows.map(i => (q === 2 ? [1, X[i][zcol]] : [1])),
    };
  });
  return { ids, G };
}

/** Factor de Cholesky relativo Λ de la covarianza de los efectos aleatorios (Σ_b = σ² Λ Λ') */
function lambdaLMM(th, q) {
  return q === 1
    ? [[Math.abs(th[0])]]
    : [
        [Math.abs(th[0]), 0],
        [th[1], Math.abs(th[2])],
      ];
}

/** A = Z Λ y K = I + A'A de un grupo (identidad de Woodbury, dimensión q) */
function woodbury(Z, L, q) {
  const A = Z.map(z => L[0].map((_, c) => sum(z.map((zv, k) => zv * L[k][c])))),
    K = ident(q);
  A.forEach(a => {
    for (let r = 0; r < q; r++) for (let c = 0; c < q; c++) K[r][c] += a[r] * a[c];
  });
  return { A, K };
}

/** Piezas de la desviación REML para θ: β de MCG, (X'W⁻¹X)⁻¹, log|K|, log|X'W⁻¹X| y r'W⁻¹r; null si es singular */
function piezasREML(G, th, p, q) {
  const L = lambdaLMM(th, q),
    XtWX = Array.from({ length: p }, () => new Array(p).fill(0)),
    XtWy = new Array(p).fill(0);
  let logdet = 0;
  const cache = [];
  for (const gr of G) {
    const { A, K } = woodbury(gr.Z, L, q),
      Ki = inv(K);
    logdet += Math.log(Math.abs(det(K)));
    // W⁻¹ v con W = I + A A'
    const Winv = v => {
      const At = L[0].map((_, c) => sum(A.map((a, i) => a[c] * v[i]))),
        u = Ki.map(r => sum(r.map((x, k) => x * At[k])));
      return v.map((x, i) => x - sum(A[i].map((a, k) => a * u[k])));
    };
    const Wy = Winv(gr.y),
      WX = Array.from({ length: p }, (_, c) => Winv(gr.X.map(r => r[c])));
    for (let a = 0; a < p; a++) {
      XtWy[a] += sum(gr.X.map((r, i) => r[a] * Wy[i]));
      for (let b = 0; b < p; b++) XtWX[a][b] += sum(gr.X.map((r, i) => r[a] * WX[b][i]));
    }
    cache.push({ Winv });
  }
  const XtWXi = inv(XtWX);
  if (!XtWXi) return null;
  const beta = XtWXi.map(r => sum(r.map((v, k) => v * XtWy[k])));
  let rq = 0;
  G.forEach((gr, k) => {
    const r = gr.y.map((v, i) => v - sum(gr.X[i].map((x, j) => x * beta[j]))),
      Wr = cache[k].Winv(r);
    rq += sum(r.map((v, i) => v * Wr[i]));
  });
  return { beta, XtWXi, logdet, logdetX: Math.log(det(XtWX)), rq };
}

/** θ de REML (desviación perfilada en σ²), con varios puntos de partida de Nelder-Mead */
function ajusteREML(G, N, p, q) {
  const dev = th => {
    const P = piezasREML(G, th, p, q);
    if (!P) return 1e300;
    const s2 = P.rq / (N - p);
    return (N - p) * (1 + Math.log(2 * Math.PI * s2)) + P.logdet + P.logdetX;
  };
  let best = null;
  for (const start of q === 1
    ? [[1], [0.3], [3]]
    : [
        [1, 0, 1],
        [0.5, 0, 0.2],
        [2, 0, 0.5],
      ]) {
    const r = nelderMead(dev, start);
    if (!best || r.f < best.f) best = r;
  }
  return best;
}

/**
 * Grados de libertad de Satterthwaite para cada efecto fijo (como lmerTest): desviación REML sin perfilar en
 * φ = (θ, σ²); Cov(φ) ≈ 2 H⁻¹ y gl = 2 Var(β_j)² / (∇Var(β_j)' Cov(φ) ∇Var(β_j)).
 */
function satterthwaite(G, th, s2, N, p, q) {
  const D = ph => {
    const Q = piezasREML(G, ph.slice(0, -1), p, q);
    if (!Q) return 1e300;
    const sg = ph[ph.length - 1];
    return (N - p) * Math.log(sg) + Q.logdet + Q.logdetX + Q.rq / sg;
  };
  const phi = th
      .map(Math.abs)
      .map((v, k) => (q === 2 && k === 1 ? th[1] : v))
      .concat([s2]),
    np = phi.length,
    hs = phi.map(v => 1e-4 * Math.max(Math.abs(v), 1e-2));
  const H = Array.from({ length: np }, () => new Array(np).fill(0));
  for (let a = 0; a < np; a++)
    for (let b = a; b < np; b++) {
      const e = (da, db) => {
        const v = phi.slice();
        v[a] += da;
        v[b] += db;
        return D(v);
      };
      H[a][b] = H[b][a] =
        a === b
          ? (e(hs[a], 0) - 2 * D(phi) + e(-hs[a], 0)) / (hs[a] * hs[a])
          : (e(hs[a], hs[b]) - e(hs[a], -hs[b]) - e(-hs[a], hs[b]) + e(-hs[a], -hs[b])) / (4 * hs[a] * hs[b]);
    }
  const Hi = inv(H),
    Acov = Hi ? Hi.map(r => r.map(v => 2 * v)) : null;
  const varB = (ph, j) => {
    const Q = piezasREML(G, ph.slice(0, -1), p, q);
    return Q ? ph[ph.length - 1] * Q.XtWXi[j][j] : NaN;
  };
  return Array.from({ length: p }, (_, j) => {
    if (!Acov) return NaN;
    const f0 = varB(phi, j),
      gr = phi.map((_, k) => {
        const a = phi.slice(),
          b = phi.slice();
        a[k] += hs[k];
        b[k] -= hs[k];
        return (varB(a, j) - varB(b, j)) / (2 * hs[k]);
      });
    const den = sum(gr.map((x, a) => sum(gr.map((z, b) => x * Acov[a][b] * z))));
    return (2 * f0 * f0) / den;
  });
}

/** Varianza explicada por los efectos aleatorios para el R² de Nakagawa (con pendiente: promedio de z'Τz) */
function varianzaAleatoria(X, Tau, q, zcol) {
  if (q === 1) return Tau[0][0];
  return mean(
    X.map(r => {
      const z = [1, r[zcol]];
      return sum(z.map((a, i) => sum(z.map((b, j) => a * Tau[i][j] * b))));
    })
  );
}

/** Residuos condicionales: y − Xβ − Zb, con b = Λ (I + A'A)⁻¹ A' r (predicción BLUP de cada grupo) */
function residuosCondicionales(G, L, q, y, fit) {
  const resid = new Array(y.length);
  G.forEach(gr => {
    const { A, K } = woodbury(gr.Z, L, q);
    const r = gr.rows.map(i => y[i] - fit[i]),
      At = L[0].map((_, c) => sum(A.map((a, i) => a[c] * r[i]))),
      u = inv(K).map(row => sum(row.map((x, k) => x * At[k])));
    const bvec = L.map(row => sum(row.map((x, k) => x * u[k])));
    gr.rows.forEach((i, k) => {
      resid[i] = r[k] - sum(gr.Z[k].map((z, j) => z * bvec[j]));
    });
  });
  return resid;
}

/**
 * Modelo lineal mixto por REML con intercepto aleatorio y, opcionalmente, pendiente aleatoria correlacionada
 * (como lme4::lmer con gl de Satterthwaite de lmerTest y R² de Nakagawa de performance).
 * @param {number[]} y variable dependiente
 * @param {number[][]} X n × p (con constante)
 * @param {Array<string|number>} g grupo de cada fila
 * @param {number} zcol columna de X con pendiente aleatoria (−1 = solo intercepto)
 */
function lmm(y, X, g, zcol = -1) {
  const N = y.length,
    p = X[0].length,
    q = zcol >= 0 ? 2 : 1,
    { ids, G } = gruposLMM(y, X, g, zcol, q);
  const best = ajusteREML(G, N, p, q),
    th = best.x,
    P = piezasREML(G, th, p, q),
    s2 = P.rq / (N - p),
    L = lambdaLMM(th, q);
  const Tau = L.map(r => L.map(c => s2 * sum(r.map((v, k) => v * c[k])))),
    cov = P.XtWXi.map(r => r.map(v => v * s2));
  const se = cov.map((r, j) => Math.sqrt(r[j])),
    df = satterthwaite(G, th, s2, N, p, q);
  const t = P.beta.map((b, j) => b / se[j]),
    pv = t.map((v, j) => (isFinite(df[j]) && df[j] > 0 ? pT(v, df[j]) : pZ(v)));
  const ci = P.beta.map((b, j) => {
    const tc = isFinite(df[j]) && df[j] > 0 ? tcrit(df[j]) : 1.959964;
    return [b - tc * se[j], b + tc * se[j]];
  });
  // R² de Nakagawa (varianza de los efectos fijos, de los aleatorios y residual)
  const fit = X.map(r => sum(r.map((v, k) => v * P.beta[k]))),
    vf = variance(fit),
    vr = varianzaAleatoria(X, Tau, q, zcol);
  return {
    beta: P.beta,
    se,
    df,
    t,
    p: pv,
    ci,
    s2,
    Tau,
    ngroups: ids.length,
    N,
    reml: best.f,
    singular: Math.abs(th[0]) < 1e-4 || (q === 2 && Math.abs(th[2]) < 1e-4),
    r2m: vf / (vf + vr + s2),
    r2c: (vf + vr) / (vf + vr + s2),
    corRE: q === 2 ? Tau[0][1] / Math.sqrt(Tau[0][0] * Tau[1][1]) : null,
    icc: q === 1 ? Tau[0][0] / (Tau[0][0] + s2) : null,
    resid: residuosCondicionales(G, L, q, y, fit),
  };
}

export { lmm };
