/* Tharp · motor estadístico · Regresión lineal por mínimos cuadrados (HC3, VIF, Cook, Breusch-Pagan, Durbin-Watson) */
import { mean, sum } from './base.js';
import { pChi, pF, pT, tcrit } from './distribuciones.js';
import { inv } from './algebra.js';

function olsCore(X, y) {
  const n = X.length,
    p = X[0].length,
    XtX = [],
    Xty = new Array(p).fill(0);
  for (let a = 0; a < p; a++) {
    XtX[a] = new Array(p).fill(0);
  }
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += xi[a] * y[i];
      for (let b = a; b < p; b++) XtX[a][b] += xi[a] * xi[b];
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
  const Ai = inv(XtX);
  if (!Ai) return null;
  const b = Ai.map(r => sum(r.map((v, k) => v * Xty[k])));
  const fit = X.map(xi => sum(xi.map((v, k) => v * b[k]))),
    e = y.map((v, i) => v - fit[i]);
  const my = mean(y),
    sse = sum(e.map(v => v * v)),
    sst = sum(y.map(v => (v - my) ** 2));
  return { b, Ai, fit, e, sse, sst, r2: 1 - sse / sst, n, p };
}
// solo los coeficientes de MCO sobre las filas idx de X (con repetición): para el bootstrap, sin crear copias de los datos.
// Mismas operaciones y en el mismo orden que olsCore, así que da exactamente los mismos coeficientes
function olsBetaIdx(X, y, idx) {
  const p = X[0].length,
    F = new Float64Array(p * p),
    Fy = new Float64Array(p);
  for (let t = 0; t < idx.length; t++) {
    const i = idx[t],
      xi = X[i],
      yi = y[i];
    for (let a = 0; a < p; a++) {
      const xa = xi[a];
      Fy[a] += xa * yi;
      for (let b = a; b < p; b++) F[a * p + b] += xa * xi[b];
    }
  }
  const XtX = Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) => (b >= a ? F[a * p + b] : F[b * p + a]))
    ),
    Xty = Array.from(Fy);
  const Ai = inv(XtX);
  if (!Ai) return null;
  return Ai.map(r => sum(r.map((v, k) => v * Xty[k])));
}
function ols(X, y) {
  const m = olsCore(X, y);
  if (!m) return null;
  const { n, p, Ai, e } = m,
    dfr = n - p,
    s2 = m.sse / dfr;
  const se = Ai.map((r, k) => Math.sqrt(s2 * r[k])),
    t = m.b.map((v, k) => v / se[k]),
    pv = t.map(v => pT(v, dfr));
  const tc = tcrit(dfr),
    ci = m.b.map((v, k) => [v - tc * se[k], v + tc * se[k]]);
  const h = X.map(xi => {
    let s = 0;
    for (let a = 0; a < p; a++) {
      let q = 0;
      for (let c = 0; c < p; c++) q += Ai[a][c] * xi[c];
      s += xi[a] * q;
    }
    return s;
  });
  const cook = e.map((v, i) => (((v * v) / (p * s2)) * h[i]) / (1 - h[i]) ** 2);
  // HC3
  const meat = Array.from({ length: p }, () => new Array(p).fill(0));
  X.forEach((xi, i) => {
    const w = e[i] ** 2 / (1 - h[i]) ** 2;
    for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) meat[a][c] += w * xi[a] * xi[c];
  });
  const AM = Ai.map(r => meat[0].map((_, c) => sum(r.map((v, k) => v * meat[k][c]))));
  const V3 = AM.map(r => Ai[0].map((_, c) => sum(r.map((v, k) => v * Ai[k][c]))));
  const se3 = V3.map((r, k) => Math.sqrt(r[k])),
    p3 = m.b.map((v, k) => pT(v / se3[k], dfr));
  const df1 = p - 1,
    F = (m.sst - m.sse) / df1 / s2;
  // Breusch-Pagan (Koenker, studentizado)
  const aux = olsCore(
      X,
      e.map(v => v * v)
    ),
    bpLM = n * aux.r2;
  let dw = 0;
  for (let i = 1; i < n; i++) dw += (e[i] - e[i - 1]) ** 2;
  dw /= m.sse;
  const vif = [];
  for (let j = 1; j < p; j++) {
    const Xo = X.map(r => r.filter((_, k) => k !== j)),
      yj = X.map(r => r[j]),
      a = olsCore(Xo, yj);
    vif[j] = a ? 1 / (1 - a.r2) : Infinity;
  }
  return Object.assign(m, {
    s2,
    se,
    t,
    pv,
    ci,
    h,
    cook,
    se3,
    p3,
    dfr,
    df1,
    F,
    pF: pF(F, df1, dfr),
    adjr2: 1 - ((1 - m.r2) * (n - 1)) / dfr,
    bp: { LM: bpLM, df: df1, p: pChi(bpLM, df1) },
    dw,
    vif,
  });
}

export { olsCore, olsBetaIdx, ols };
