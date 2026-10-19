/* Tharp · motor estadístico · Análisis factorial exploratorio */
import { aleatorioConSemilla, quantile, sorted, sum } from './base.js';
import { pChi } from './distribuciones.js';
import { det, eigSym, ident, inv, matMul, svdSmall, tr } from './algebra.js';
import { corMatrix } from './correlacion.js';
/** @typedef {import('./base.js').Registro} Registro */

function kmoBartlett(R, n) {
  const p = R.length,
    Ri = inv(R);
  if (!Ri) return null;
  const A = R.map((r, i) => r.map((_, j) => -Ri[i][j] / Math.sqrt(Ri[i][i] * Ri[j][j])));
  let r2 = 0,
    a2 = 0;
  const msa = [];
  for (let i = 0; i < p; i++) {
    let ri = 0,
      ai = 0;
    for (let j = 0; j < p; j++)
      if (i !== j) {
        ri += R[i][j] ** 2;
        ai += A[i][j] ** 2;
      }
    msa.push(ri / (ri + ai));
    r2 += ri;
    a2 += ai;
  }
  const ld = eigSym(R).values.reduce((s, v) => s + Math.log(v), 0),
    chi = -(n - 1 - (2 * p + 5) / 6) * ld,
    df = (p * (p - 1)) / 2;
  return { kmo: r2 / (r2 + a2), msa, bartlett: { chi, df, p: pChi(chi, df) } };
}
function paFactor(R, m, minErr = 0.001, maxIter = 50) {
  // ejes principales, con el mismo criterio de parada que psych::fa(fm = "pa")
  const p = R.length,
    Ri = inv(R),
    M = R.map(r => r.slice());
  for (let i = 0; i < p; i++) M[i][i] = Ri ? 1 - 1 / Ri[i][i] : 1; // comunalidades iniciales: correlación múltiple al cuadrado
  let comm = M.reduce((s, r, i) => s + r[i], 0),
    err = comm,
    L = null,
    it = 0;
  while (err > minErr && it < maxIter) {
    const e = eigSym(M);
    L = M.map((_, i) => Array.from({ length: m }, (_, j) => e.vectors[i][j] * Math.sqrt(Math.max(e.values[j], 0))));
    const nw = L.map(r => sum(r.map(v => v * v))),
      c1 = sum(nw);
    nw.forEach((v, i) => (M[i][i] = v));
    err = Math.abs(comm - c1);
    comm = c1;
    it++;
  }
  return { L, iter: it, converged: err <= minErr };
}
function varimax(L0, eps = 1e-5, normalize = true) {
  // como stats::varimax de R (normalización de Kaiser opcional)
  const p = L0.length,
    m = L0[0].length;
  if (m < 2) return { L: L0, T: ident(m) };
  const sc = L0.map(r => (normalize ? Math.sqrt(sum(r.map(v => v * v))) : 1)),
    x = L0.map((r, i) => r.map(v => v / sc[i]));
  let TT = ident(m),
    d = 0;
  for (let it = 0; it < 1000; it++) {
    const z = matMul(x, TT),
      cs = Array.from({ length: m }, (_, j) => sum(z.map(r => r[j] ** 2)) / p);
    const B = matMul(
        tr(x),
        z.map(r => r.map((v, j) => v ** 3 - v * cs[j]))
      ),
      s = svdSmall(B);
    TT = matMul(s.U, tr(s.V));
    const dp = d;
    d = sum(s.d);
    if (d < dp * (1 + eps)) break;
  }
  return { L: matMul(x, TT).map((r, i) => r.map(v => v * sc[i])), T: TT };
}
function oblimin(A, eps = 1e-5, maxit = 1000) {
  // GPArotation::GPFoblq con criterio oblimin (gamma = 0, sin normalizar)
  const m = A[0].length;
  if (m < 2) return { L: A, Phi: [[1]] };
  const vgQ = L => {
    const L2 = L.map(r => r.map(v => v * v)),
      X = L2.map(r => r.map((_, j) => sum(r) - r[j]));
    return {
      Gq: L.map((r, i) => r.map((v, j) => v * X[i][j])),
      f: sum(L2.map((r, i) => sum(r.map((v, j) => v * X[i][j])))) / 4,
    };
  };
  let T = ident(m);
  const Ti = inv(T);
  let L = matMul(A, tr(Ti));
  const V = vgQ(L);
  let G = tr(matMul(matMul(tr(L), V.Gq), Ti)).map(r => r.map(v => -v)),
    f = V.f,
    al = 1;
  for (let it = 0; it <= maxit; it++) {
    const cs = Array.from({ length: m }, (_, j) => sum(T.map((r, i) => r[j] * G[i][j])));
    const Gp = G.map((r, i) => r.map((v, j) => v - T[i][j] * cs[j])),
      s = Math.sqrt(sum(Gp.map(r => sum(r.map(v => v * v)))));
    if (s < eps) break;
    al *= 2;
    let Tt, Lt, Vt;
    for (let i = 0; i <= 10; i++) {
      const X = T.map((r, a) => r.map((v, b) => v - al * Gp[a][b])),
        v = Array.from({ length: m }, (_, j) => 1 / Math.sqrt(sum(X.map(r => r[j] ** 2))));
      Tt = X.map(r => r.map((x, j) => x * v[j]));
      Lt = matMul(A, tr(inv(Tt)));
      Vt = vgQ(Lt);
      if (f - Vt.f > 0.5 * s * s * al) break;
      al /= 2;
    }
    T = Tt;
    f = Vt.f;
    L = Lt;
    G = tr(matMul(matMul(tr(Lt), Vt.Gq), inv(Tt))).map(r => r.map(v => -v));
  }
  return { L, Phi: matMul(tr(T), T) };
}
// extracción por mínimos residuos (MinRes/ULS) o máxima verosimilitud: se optimizan las unicidades ψ (entre .005 y 1)
// con gradiente proyectado; las cargas salen de los autovalores, como factanal y psych::fa
function fitUniq(R, m, method) {
  const p = R.length,
    Ri = inv(R);
  let psi =
    method === 'ml'
      ? R.map((_, i) => Math.min(1, Math.max(0.005, (1 - (0.5 * m) / p) / (Ri ? Ri[i][i] : 1))))
      : R.map((_, i) => Math.min(1, Math.max(0.005, Ri ? 1 / Ri[i][i] : 0.5)));
  const load = ps => {
    if (method === 'ml') {
      const sc = ps.map(v => 1 / Math.sqrt(v)),
        Sst = R.map((r, i) => r.map((v, j) => v * sc[i] * sc[j])),
        e = eigSym(Sst);
      const L = R.map((_, i) =>
        Array.from(
          { length: m },
          (_, j) => Math.sqrt(ps[i]) * e.vectors[i][j] * Math.sqrt(Math.max(e.values[j] - 1, 0))
        )
      );
      return { L, e };
    }
    const Sst = R.map((r, i) => r.map((v, j) => (i === j ? v - ps[i] : v))),
      e = eigSym(Sst);
    return {
      L: R.map((_, i) => Array.from({ length: m }, (_, j) => e.vectors[i][j] * Math.sqrt(Math.max(e.values[j], 0)))),
      e,
    };
  };
  const obj = ps => {
    const { L, e } = load(ps);
    if (method === 'ml') {
      const rest = e.values.slice(m);
      return -(sum(rest.map(v => Math.log(v) - v)) - m + p);
    }
    let s = 0;
    for (let i = 0; i < p; i++)
      for (let j = 0; j < p; j++)
        if (i !== j) {
          let mm = 0;
          for (let k = 0; k < m; k++) mm += L[i][k] * L[j][k];
          s += (R[i][j] - mm) ** 2;
        }
    return s;
  };
  const grad = ps => {
    const { L } = load(ps);
    return ps.map((v, i) => {
      let mm = 0;
      for (let k = 0; k < m; k++) mm += L[i][k] ** 2;
      const g = mm + v - R[i][i];
      return method === 'ml' ? g / (v * v) : g;
    });
  };
  const clamp = ps => ps.map(v => Math.min(1, Math.max(0.005, v)));
  let f = obj(psi),
    g = grad(psi),
    step = 0.1,
    it = 0;
  for (; it < 5000; it++) {
    let ok = false;
    for (let t = 0; t < 40; t++) {
      const np = clamp(psi.map((v, i) => v - step * g[i])),
        nf = obj(np);
      if (nf <= f - 1e-4 * sum(np.map((v, i) => g[i] * (psi[i] - v)))) {
        const ng = grad(np),
          s = np.map((v, i) => v - psi[i]),
          y = ng.map((v, i) => v - g[i]);
        const sy = sum(s.map((v, i) => v * y[i]));
        step = sy > 1e-20 ? Math.min(10, Math.max(1e-6, sum(s.map(v => v * v)) / sy)) : step * 2;
        const dfv = f - nf;
        psi = np;
        f = nf;
        g = ng;
        ok = true;
        if (dfv < 1e-14) it = 1e9;
        break;
      }
      step /= 2;
    }
    if (!ok) break;
    const pg = Math.sqrt(sum(psi.map((v, i) => (Math.min(1, Math.max(0.005, v - g[i])) - v) ** 2)));
    if (pg < 1e-9) break;
  }
  return { L: load(psi).L, psi, f, converged: true };
}
// rotación ortogonal por gradiente (GPArotation::GPForth): quartimax y equamax (Crawford-Ferguson con κ = m / 2p)
function gpOrth(A, crit, eps = 1e-5, maxit = 1000) {
  const p = A.length,
    m = A[0].length;
  if (m < 2) return { L: A, T: ident(m) };
  const vgQ = L => {
    if (crit === 'quartimax')
      return { Gq: L.map(r => r.map(v => -(v ** 3))), f: -sum(L.map(r => sum(r.map(v => v ** 4)))) / 4 };
    const k = m / (2 * p),
      L2 = L.map(r => r.map(v => v * v)),
      rs = L2.map(r => sum(r)),
      cs = Array.from({ length: m }, (_, j) => sum(L2.map(r => r[j])));
    const N = L2.map((r, i) => r.map(v => rs[i] - v)),
      M = L2.map(r => r.map((v, j) => cs[j] - v));
    const f1 = ((1 - k) * sum(L2.map((r, i) => sum(r.map((v, j) => v * N[i][j]))))) / 4,
      f2 = (k * sum(L2.map((r, i) => sum(r.map((v, j) => v * M[i][j]))))) / 4;
    return { Gq: L.map((r, i) => r.map((v, j) => (1 - k) * v * N[i][j] + k * v * M[i][j])), f: f1 + f2 };
  };
  let T = ident(m),
    L = matMul(A, T);
  const V = vgQ(L);
  let G = matMul(tr(A), V.Gq),
    f = V.f,
    al = 1;
  for (let it = 0; it <= maxit; it++) {
    const Mx = matMul(tr(T), G),
      S = Mx.map((r, a) => r.map((v, b) => (v + Mx[b][a]) / 2)),
      Gp = G.map((r, a) => r.map((v, b) => v - sum(T[a].map((t, c) => t * S[c][b]))));
    const s = Math.sqrt(sum(Gp.map(r => sum(r.map(v => v * v)))));
    if (s < eps) break;
    al *= 2;
    let Tt, Lt, Vt;
    for (let i = 0; i <= 10; i++) {
      const X = T.map((r, a) => r.map((v, b) => v - al * Gp[a][b])),
        sv = svdSmall(X);
      Tt = matMul(sv.U, tr(sv.V));
      Lt = matMul(A, Tt);
      Vt = vgQ(Lt);
      if (f - Vt.f > 0.5 * s * s * al) break;
      al /= 2;
    }
    T = Tt;
    L = Lt;
    f = Vt.f;
    G = matMul(tr(A), Vt.Gq);
  }
  return { L, T };
}
// promax (como psych::Promax): varimax normalizada y luego objetivo |L|^4 con el signo de L
function promax(L0, pw = 4) {
  const m = L0[0].length;
  if (m < 2) return { L: L0, Phi: [[1]] };
  // normalización de Kaiser de todo el procedimiento (filas divididas por √h²), como psych::fa(rotate = "promax")
  const h = L0.map(r => Math.sqrt(sum(r.map(v => v * v)))),
    Ln = L0.map((r, i) => r.map(v => v / h[i]));
  const vx = varimax(Ln, 1e-8, false),
    x = vx.L,
    Q = x.map(r => r.map(v => v * Math.abs(v) ** (pw - 1)));
  const XtX = matMul(tr(x), x),
    U0 = matMul(inv(XtX), matMul(tr(x), Q)),
    d = inv(matMul(tr(U0), U0)).map((r, i) => r[i]);
  const U = U0.map(r => r.map((v, j) => v * Math.sqrt(d[j]))),
    z = matMul(x, U),
    Uf = matMul(vx.T, U),
    ui = inv(Uf);
  return { L: z.map((r, i) => r.map(v => v * h[i])), Phi: matMul(ui, tr(ui)) };
}
// geomin oblicua (GPArotation::geominQ, δ = .01) con el mismo algoritmo GPFoblq que oblimin
function geomin(A, delta = 0.01, eps = 1e-5, maxit = 1000) {
  const m = A[0].length;
  if (m < 2) return { L: A, Phi: [[1]] };
  const vgQ = L => {
    const L2 = L.map(r => r.map(v => v * v + delta)),
      pro = L2.map(r => Math.exp(sum(r.map(Math.log)) / m));
    return { Gq: L.map((r, i) => r.map((v, j) => (((2 / m) * v) / L2[i][j]) * pro[i])), f: sum(pro) };
  };
  let T = ident(m),
    L = matMul(A, tr(inv(T)));
  const V = vgQ(L);
  let G = tr(matMul(matMul(tr(L), V.Gq), inv(T))).map(r => r.map(v => -v)),
    f = V.f,
    al = 1;
  for (let it = 0; it <= maxit; it++) {
    const cs = Array.from({ length: m }, (_, j) => sum(T.map((r, i) => r[j] * G[i][j]))),
      Gp = G.map((r, i) => r.map((v, j) => v - T[i][j] * cs[j]));
    const s = Math.sqrt(sum(Gp.map(r => sum(r.map(v => v * v)))));
    if (s < eps) break;
    al *= 2;
    let Tt, Lt, Vt;
    for (let i = 0; i <= 10; i++) {
      const X = T.map((r, a) => r.map((v, b) => v - al * Gp[a][b])),
        vv = Array.from({ length: m }, (_, j) => 1 / Math.sqrt(sum(X.map(r => r[j] ** 2))));
      Tt = X.map(r => r.map((x, j) => x * vv[j]));
      Lt = matMul(A, tr(inv(Tt)));
      Vt = vgQ(Lt);
      if (f - Vt.f > 0.5 * s * s * al) break;
      al /= 2;
    }
    T = Tt;
    f = Vt.f;
    L = Lt;
    G = tr(matMul(matMul(tr(Lt), Vt.Gq), inv(Tt))).map(r => r.map(v => -v));
  }
  return { L, Phi: matMul(tr(T), T) };
}
function efa(X, m, rotation = 'oblimin', extraction = 'pa') {
  // X: n × p casos completos
  const n = X.length,
    R = corMatrix(X),
    adec = kmoBartlett(R, n),
    eig = eigSym(R).values;
  /** @type {Registro} */
  let ext;
  if (extraction === 'pca') {
    const e = eigSym(R);
    ext = {
      L: R.map((_, i) => Array.from({ length: m }, (_, j) => e.vectors[i][j] * Math.sqrt(Math.max(e.values[j], 0)))),
      converged: true,
    };
  } else if (extraction === 'ml' || extraction === 'minres') ext = fitUniq(R, m, extraction);
  else ext = paFactor(R, m);
  let L = ext.L,
    Phi = ident(m);
  if (m > 1) {
    if (rotation === 'varimax') L = varimax(L).L;
    else if (rotation === 'quartimax' || rotation === 'equamax') L = gpOrth(L, rotation).L;
    else if (rotation === 'oblimin') {
      const o = oblimin(L);
      L = o.L;
      Phi = o.Phi;
    } else if (rotation === 'promax') {
      const o = promax(L);
      L = o.L;
      Phi = o.Phi;
    } else if (rotation === 'geomin') {
      const o = geomin(L);
      L = o.L;
      Phi = o.Phi;
    }
  }
  // como psych: factores ordenados por varianza explicada y con signo positivo de la suma de cargas
  const ev = Array.from({ length: m }, (_, j) => {
    const LtL = matMul(tr(L), L),
      PL = matMul(Phi, LtL);
    return PL[j][j];
  });
  const ord = ev.map((v, j) => j).sort((a, b) => ev[b] - ev[a]);
  L = L.map(r => ord.map(j => r[j]));
  Phi = ord.map(a => ord.map(b => Phi[a][b]));
  const sg = Array.from({ length: m }, (_, j) => (sum(L.map(r => r[j])) < 0 ? -1 : 1));
  L = L.map(r => r.map((v, j) => v * sg[j]));
  Phi = Phi.map((r, a) => r.map((v, b) => v * sg[a] * sg[b]));
  const LPL = matMul(matMul(L, Phi), tr(L)),
    h2 = LPL.map((r, i) => r[i]),
    p = R.length;
  const ss = Array.from({ length: m }, (_, j) => matMul(Phi, matMul(tr(L), L))[j][j]);
  let rms = 0;
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) if (i !== j) rms += (R[i][j] - LPL[i][j]) ** 2;
  let fit = null;
  if (extraction === 'ml') {
    // prueba de ajuste con la corrección de Bartlett, RMSEA y TLI (como factanal y psych::fa)
    const df = ((p - m) ** 2 - p - m) / 2,
      chi = (n - 1 - (2 * p + 5) / 6 - (2 * m) / 3) * ext.f;
    // RMSEA y TLI con las fórmulas de psych::fa (las que muestran JASP y jamovi)
    const F0 = -Math.log(Math.max(1e-300, det(R))),
      df0 = (p * (p - 1)) / 2,
      nm = n - 1 - (2 * p + 5) / 6 - (2 * m) / 3;
    fit =
      df > 0
        ? {
            chi,
            df,
            p: pChi(chi, df),
            rmsea: Math.sqrt(Math.max(0, chi / (df * n) - 1 / (n - 1))),
            tli: (F0 / df0 - ext.f / df) / (F0 / df0 - 1 / nm),
          }
        : { chi, df, p: NaN };
  }
  return {
    L,
    Phi,
    h2,
    u2: h2.map(v => 1 - v),
    ss,
    prop: ss.map(v => v / p),
    adec,
    eig,
    n,
    p,
    m,
    rotation,
    extraction,
    fit,
    rmsr: Math.sqrt(rms / (p * (p - 1))),
    converged: ext.converged,
  };
}
function parallelAnalysis(n, p, eigObs, reps = 100, seed = 20261015) {
  // Horn con autovalores de componentes y percentil 95
  const rnd = aleatorioConSemilla(seed);
  const nr = () => {
    let u = 0;
    while (!u) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const sims = Array.from({ length: p }, () => []);
  for (let r = 0; r < reps; r++) {
    const X = Array.from({ length: n }, () => Array.from({ length: p }, nr));
    eigSym(corMatrix(X)).values.forEach((v, j) => sims[j].push(v));
  }
  const p95 = sims.map(a => quantile(sorted(a), 0.95));
  let k = 0;
  while (k < p && eigObs[k] > p95[k]) k++;
  return { p95, nfactors: k };
}

export { kmoBartlett, paFactor, varimax, oblimin, fitUniq, gpOrth, promax, geomin, efa, parallelAnalysis };
