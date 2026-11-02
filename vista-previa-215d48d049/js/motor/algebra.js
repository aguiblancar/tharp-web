/* Tharp · motor estadístico · Álgebra lineal y optimización */
import { sum } from './base.js';

function det(A) {
  // determinante por eliminación gaussiana con pivote parcial
  const n = A.length,
    M = A.map(r => r.slice());
  let d = 1;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (M[piv][c] === 0) return 0;
    if (piv !== c) {
      [M[c], M[piv]] = [M[piv], M[c]];
      d = -d;
    }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j < n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return d;
}
function inv(A) {
  const n = A.length,
    M = A.map((r, i) => r.concat(A.map((_, j) => (i === j ? 1 : 0))));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++)
      if (r !== c && M[r][c] !== 0) {
        const f = M[r][c];
        for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
      }
  }
  return M.map(r => r.slice(n));
}
const matMul = (A, B) =>
  A.map(r =>
    B[0].map((_, j) => {
      let s = 0;
      for (let k = 0; k < r.length; k++) s += r[k] * B[k][j];
      return s;
    })
  );
const tr = A => A[0].map((_, j) => A.map(r => r[j]));
const ident = n =>
  /** @type {number[][]} */ (
    Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  );
function eigSym(A0) {
  // Jacobi para matrices simétricas: valores propios en orden decreciente y vectores en columnas
  const n = A0.length,
    A = A0.map(r => r.slice()),
    V = ident(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]),
          t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)),
          c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p],
            akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k],
            aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p],
            vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const ord = A.map((r, i) => i).sort((a, b) => A[b][b] - A[a][a]);
  return { values: ord.map(i => A[i][i]), vectors: V.map(r => ord.map(i => r[i])) };
}
function svdSmall(B) {
  // B cuadrada pequeña: B = U diag(d) V'
  const e = eigSym(matMul(tr(B), B)),
    V = e.vectors,
    d = e.values.map(v => Math.sqrt(Math.max(v, 0)));
  const BV = matMul(B, V),
    U = BV.map(r => r.map((v, j) => (d[j] > 1e-15 ? v / d[j] : 0)));
  return { U, d, V };
}
function nelderMead(fn, x0, step = 0.5, tol = 1e-10, maxit = 4000) {
  const n = x0.length;
  let pts = [x0.slice()].concat(
    x0.map((_, i) => {
      const p = x0.slice();
      p[i] += step * (Math.abs(p[i]) || 1);
      return p;
    })
  );
  let vals = pts.map(fn);
  for (let it = 0; it < maxit; it++) {
    const ord = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = ord.map(i => pts[i]);
    vals = ord.map(i => vals[i]);
    if (Math.abs(vals[n] - vals[0]) <= tol * (Math.abs(vals[0]) + tol)) break;
    const c = Array.from({ length: n }, (_, j) => sum(pts.slice(0, n).map(p => p[j])) / n),
      mv = (a, b, t) => a.map((v, j) => v + t * (b[j] - v));
    const xr = mv(c, pts[n], -1),
      fr = fn(xr);
    if (fr < vals[0]) {
      const xe = mv(c, pts[n], -2),
        fe = fn(xe);
      if (fe < fr) {
        pts[n] = xe;
        vals[n] = fe;
      } else {
        pts[n] = xr;
        vals[n] = fr;
      }
    } else if (fr < vals[n - 1]) {
      pts[n] = xr;
      vals[n] = fr;
    } else {
      const xc = mv(c, pts[n], fr < vals[n] ? -0.5 : 0.5),
        fc = fn(xc);
      if (fc < Math.min(fr, vals[n])) {
        pts[n] = xc;
        vals[n] = fc;
      } else
        for (let i = 1; i <= n; i++) {
          pts[i] = mv(pts[0], pts[i], 0.5);
          vals[i] = fn(pts[i]);
        }
    }
  }
  return { x: pts[0], f: vals[0] };
}

export { det, inv, matMul, tr, ident, eigSym, svdSmall, nelderMead };
