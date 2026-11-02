/* Tharp · motor estadístico · Valores perdidos: algoritmo EM y prueba MCAR de Little */
import { mean, sum } from './base.js';
import { pChi } from './distribuciones.js';
import { eigSym, inv } from './algebra.js';

/**
 * Paso E del algoritmo EM para un patrón de valores perdidos: suma a T1 y T2 los valores esperados de los perdidos
 * dados los observados (Σmo Σoo⁻¹) y su covarianza condicional. Devuelve false si Σoo es singular.
 */
function pasoEPatron(g, mu, S, T1, T2) {
  const p = mu.length;
  const { o, m: mi } = g;
  let B = null,
    C = null;
  if (mi.length && o.length) {
    const Soo = inv(o.map(a => o.map(b => S[a][b])));
    if (!Soo) return false;
    B = mi.map(a => o.map((_, q) => sum(o.map((b, r) => S[a][b] * Soo[r][q])))); // Σmo Σoo⁻¹
    C = mi.map((a, u) => mi.map(c => S[a][c] - sum(o.map((b, q) => B[u][q] * S[b][c]))));
  } // Σmm − Σmo Σoo⁻¹ Σom
  else if (mi.length) C = mi.map(a => mi.map(c => S[a][c]));
  for (const r of g.rows) {
    const x = r.slice();
    mi.forEach((a, u) => {
      x[a] = mu[a] + (B ? sum(o.map((b, q) => B[u][q] * (r[b] - mu[b]))) : 0);
    });
    for (let a = 0; a < p; a++) {
      T1[a] += x[a];
      for (let b = a; b < p; b++) T2[a][b] += x[a] * x[b];
    }
    if (C)
      mi.forEach((a, u) =>
        mi.forEach((c, w) => {
          if (c >= a) T2[a][c] += C[u][w];
        })
      );
  }
  return true;
}
// X: filas con null en los perdidos. El EM trabaja con las variables tipificadas (como norm) y devuelve μ y Σ de máxima verosimilitud en la escala original
function emNorm(X, maxit = 20000, tol = 1e-13) {
  const n = X.length,
    p = X[0].length,
    m0 = [],
    s0 = [];
  for (let j = 0; j < p; j++) {
    const o = X.map(r => r[j]).filter(v => v !== null);
    if (o.length < 2) return null;
    const mm = mean(o);
    m0.push(mm);
    s0.push(Math.sqrt(sum(o.map(v => (v - mm) ** 2)) / o.length) || 1);
  }
  const Z = X.map(r => r.map((v, j) => (v === null ? null : (v - m0[j]) / s0[j])));
  const pats = new Map();
  Z.forEach(r => {
    const k = r.map(v => (v === null ? 1 : 0)).join('');
    if (!pats.has(k)) pats.set(k, []);
    pats.get(k).push(r);
  });
  const groups = [...pats.entries()].map(([k, rows]) => {
    const o = [],
      mi = [];
    [...k].forEach((c, j) => (c === '0' ? o : mi).push(j));
    return { key: k, o, m: mi, rows };
  });
  let mu = new Array(p).fill(0),
    S = /** @type {number[][]} */ (
      Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => (a === b ? 1 : 0)))
    ),
    it = 0,
    conv = false;
  for (; it < maxit; it++) {
    const T1 = new Array(p).fill(0),
      T2 = Array.from({ length: p }, () => new Array(p).fill(0));
    for (const g of groups) if (!pasoEPatron(g, mu, S, T1, T2)) return null;
    const mu1 = T1.map(t => t / n),
      S1 = Array.from({ length: p }, (_, a) =>
        Array.from({ length: p }, (_, b) => {
          const [i, j] = a <= b ? [a, b] : [b, a];
          return T2[i][j] / n - mu1[a] * mu1[b];
        })
      );
    let d = 0;
    for (let a = 0; a < p; a++) {
      d = Math.max(d, Math.abs(mu1[a] - mu[a]));
      for (let b = 0; b < p; b++) d = Math.max(d, Math.abs(S1[a][b] - S[a][b]));
    }
    mu = mu1;
    S = S1;
    if (d < tol) {
      conv = true;
      it++;
      break;
    }
  }
  return {
    mu: mu.map((v, j) => m0[j] + s0[j] * v),
    sigma: S.map((r, a) => r.map((v, b) => v * s0[a] * s0[b])),
    muZ: mu,
    sigmaZ: S,
    groups,
    iterations: it,
    converged: conv,
  };
}
// Little (1988): d² = Σ_j n_j (ȳ_j − μ_j)' Σ_j⁻¹ (ȳ_j − μ_j) sobre las variables observadas de cada patrón; gl = Σ k_j − p
function littleMCAR(X) {
  const em = emNorm(X);
  if (!em) return null;
  const p = X[0].length;
  // con muy pocos datos por patrón la verosimilitud no tiene máximo: Σ tiende a una matriz singular y la prueba no es válida
  const Rz = em.sigmaZ.map((r, a) => r.map((v, b) => v / Math.sqrt(em.sigmaZ[a][a] * em.sigmaZ[b][b]))),
    minEig = Math.min(...eigSym(Rz).values);
  const base = {
    patterns: em.groups.length,
    mu: em.mu,
    sigma: em.sigma,
    iterations: em.iterations,
    converged: em.converged,
    minEig,
    groups: em.groups.map(g => ({ key: g.key, n: g.rows.length, missing: g.m })),
  };
  if (!(minEig > 1e-6) || !em.converged) return Object.assign(base, { singular: true, chi: NaN, df: NaN, p: NaN });
  let d2 = 0,
    kSum = 0;
  for (const g of em.groups) {
    if (!g.o.length) continue;
    kSum += g.o.length;
    const ybar = g.o.map(j => mean(g.rows.map(r => r[j]))),
      dv = g.o.map((j, q) => ybar[q] - em.muZ[j]),
      Si = inv(g.o.map(a => g.o.map(b => em.sigmaZ[a][b])));
    if (!Si) return Object.assign(base, { singular: true, chi: NaN, df: NaN, p: NaN });
    d2 += g.rows.length * sum(dv.map((x, a) => x * sum(dv.map((y, b) => Si[a][b] * y))));
  }
  const df = kSum - p;
  return Object.assign(base, { singular: false, chi: d2, df, p: df > 0 ? pChi(d2, df) : NaN });
}

export { emNorm, littleMCAR };
