/* Tharp · motor estadístico · Análisis factorial confirmatorio e invarianza de medida */
import { maxOf, mean, sum } from './base.js';
import { ncChisqCdf, pChi, pZ } from './distribuciones.js';
import { det, ident, inv, matMul, tr } from './algebra.js';

// ---- Piezas comunes a la estimación por máxima verosimilitud ----

/** Medias y matriz de covarianzas con denominador N (como lavaan, likelihood = "normal") */
function momentos(X) {
  const p = X[0].length,
    mu = Array.from({ length: p }, (_, j) => mean(X.map(r => r[j])));
  return {
    mu,
    S: Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) => sum(X.map(r => (r[a] - mu[a]) * (r[b] - mu[b]))) / X.length)
    ),
  };
}

/** log|A| por Cholesky: null si A no es definida positiva (det > 0 no basta: dos autovalores negativos también lo dan) */
function logdetPD(A) {
  const n = A.length,
    Lc = Array.from({ length: n }, () => new Array(n).fill(0));
  let ld = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= Lc[i][k] * Lc[j][k];
      if (i === j) {
        if (!(s > 1e-12)) return null;
        Lc[i][i] = Math.sqrt(s);
        ld += 2 * Math.log(Lc[i][i]);
      } else Lc[i][j] = s / Lc[j][j];
    }
  return ld;
}

/** Σ = Λ Φ Λ' + Ψ */
function sigmaModelo(L, Phi, Psi) {
  return matMul(matMul(L, Phi), tr(L)).map((r, a) => r.map((v, b) => v + (a === b ? Psi[a] : 0)));
}

/**
 * BFGS con búsqueda lineal por retroceso (Armijo). Nunca acepta un paso que empeore el ajuste: si no hay mejora,
 * reinicia la dirección al gradiente, o termina si ya lo era.
 * @param {(th: number[]) => number} F función objetivo
 * @param {(th: number[]) => number[]} grad gradiente
 * @param {number[]} th0 valores iniciales
 * @param {{maxIt: number, tolG: number, tolF: number, tolG2: number}} tol convergencia: |g| < tolG, o |Δf| < tolF y |g| < tolG2
 */
function bfgs(F, grad, th0, { maxIt, tolG, tolF, tolG2 }) {
  const n = th0.length;
  let th = th0.slice(),
    f0 = F(th),
    g = grad(th),
    Hn = ident(n),
    conv = false,
    it = 0,
    fresh = true;
  for (; it < maxIt; it++) {
    const d = Hn.map(r => -sum(r.map((v, k) => v * g[k])));
    let a = 1,
      th1,
      f1;
    const slope = sum(d.map((v, k) => v * g[k]));
    if (slope >= 0) {
      Hn = ident(n);
      continue;
    }
    let ok = false;
    for (let k = 0; k < 60; k++) {
      th1 = th.map((v, i) => v + a * d[i]);
      f1 = F(th1);
      if (f1 <= f0 + 1e-4 * a * slope) {
        ok = true;
        break;
      }
      a /= 2;
    }
    if (!ok) {
      if (fresh) {
        conv = maxOf(g.map(Math.abs)) < 1e-6;
        break;
      }
      Hn = ident(n);
      fresh = true;
      continue;
    }
    fresh = false;
    const g1 = grad(th1),
      s = th1.map((v, i) => v - th[i]),
      yv = g1.map((v, i) => v - g[i]),
      sy = sum(s.map((v, i) => v * yv[i]));
    if (sy > 1e-12) {
      const Hy = Hn.map(r => sum(r.map((v, k) => v * yv[k]))),
        yHy = sum(yv.map((v, i) => v * Hy[i]));
      Hn = Hn.map((r, i) =>
        r.map((v, j) => v + ((sy + yHy) * s[i] * s[j]) / (sy * sy) - (Hy[i] * s[j] + s[i] * Hy[j]) / sy)
      );
    }
    const df_ = Math.abs(f0 - f1);
    th = th1;
    f0 = f1;
    g = g1;
    if (maxOf(g.map(Math.abs)) < tolG || (df_ < tolF && maxOf(g.map(Math.abs)) < tolG2)) {
      conv = true;
      break;
    }
  }
  return { th, f: f0, conv, it };
}

/** Parámetro de no centralidad λ tal que P(χ²(df, λ) ≤ chi) = target (límites del IC del RMSEA) */
function ncpLimite(chi, df, target) {
  if (ncChisqCdf(chi, df, 0) < target) return 0;
  let lo = 0,
    hi = Math.max(10, chi * 4);
  while (ncChisqCdf(chi, df, hi) > target) hi *= 2;
  for (let k = 0; k < 200; k++) {
    const md = (lo + hi) / 2;
    if (ncChisqCdf(chi, df, md) > target) lo = md;
    else hi = md;
  }
  return (lo + hi) / 2;
}

/** χ² con su p, CFI, TLI y RMSEA con IC del 90 % (con G grupos, el RMSEA multigrupo de lavaan: × √G) */
function indicesAjuste(chi, df, chiB, dfB, N, G) {
  const rm = l => Math.sqrt(Math.max(0, l / (N * df))) * Math.sqrt(G);
  return {
    pval: df > 0 ? pChi(chi, df) : NaN,
    cfi: 1 - Math.max(chi - df, 0) / Math.max(chiB - dfB, chi - df, 1e-12),
    tli: df > 0 ? (chiB / dfB - chi / df) / (chiB / dfB - 1) : NaN,
    rmsea: df > 0 ? rm(chi - df) : NaN,
    rmseaCI: df > 0 ? [rm(ncpLimite(chi, df, 0.95)), rm(ncpLimite(chi, df, 0.05))] : [NaN, NaN],
  };
}

/** SRMR de Bentler; con medias (observadas y del modelo), incluye también sus residuos tipificados */
function srmrDe(S, Sig, mu, muM) {
  const p = S.length;
  let s2 = 0,
    k = 0;
  for (let a = 0; a < p; a++) {
    for (let b = 0; b <= a; b++) {
      s2 += ((S[a][b] - Sig[a][b]) / Math.sqrt(S[a][a] * S[b][b])) ** 2;
      k++;
    }
    if (mu) {
      s2 += ((mu[a] - muM[a]) / Math.sqrt(S[a][a])) ** 2;
      k++;
    }
  }
  return Math.sqrt(s2 / k);
}

/** Derivada numérica central de una función de los parámetros en la coordenada i */
function derivadaCentral(th, i, f) {
  const h = 1e-6 * Math.max(1, Math.abs(th[i])),
    a = th.slice(),
    b = th.slice();
  a[i] += h;
  b[i] -= h;
  return { A: f(a), B: f(b), h };
}

/** Errores típicos a partir de la matriz de información (NaN si no es invertible) */
function erroresTipicos(I) {
  const Ii = inv(I);
  return Ii ? Ii.map((r, i) => Math.sqrt(r[i])) : I.map(() => NaN);
}

// ---- AFC de un grupo ----

/** Parámetros (cargas libres, varianzas y covarianzas de los factores, varianzas residuales) y matrices del modelo */
function modeloCFA(factores, p) {
  const m = factores.length,
    P = [];
  factores.forEach((it, k) => it.slice(1).forEach(j => P.push({ t: 'l', j, k })));
  for (let k = 0; k < m; k++) for (let l = 0; l <= k; l++) P.push({ t: 'f', k, l });
  for (let j = 0; j < p; j++) P.push({ t: 'u', j });
  const build = th => {
    const L = Array.from({ length: p }, () => new Array(m).fill(0)),
      Phi = Array.from({ length: m }, () => new Array(m).fill(0)),
      Psi = new Array(p).fill(0);
    factores.forEach((it, k) => (L[it[0]][k] = 1));
    P.forEach((q, i) => {
      if (q.t === 'l') L[q.j][q.k] = th[i];
      else if (q.t === 'f') Phi[q.k][q.l] = Phi[q.l][q.k] = th[i];
      else Psi[q.j] = th[i];
    });
    return { L, Phi, Psi, Sig: sigmaModelo(L, Phi, Psi) };
  };
  return { P, build };
}

/** Función de discrepancia ML y su gradiente analítico */
function objetivoCFA(S, P, build) {
  const p = S.length,
    ldS = Math.log(det(S));
  const F = th => {
    const { Sig } = build(th),
      ld = logdetPD(Sig);
    if (ld === null) return 1e10;
    const Si = inv(Sig);
    if (!Si) return 1e10;
    return ld + sum(S.map((r, a) => sum(r.map((v, b) => v * Si[b][a])))) - ldS - p;
  };
  const grad = th => {
    const { L, Phi, Sig } = build(th),
      Si = inv(Sig),
      D = Sig.map((r, a) => r.map((v, b) => v - S[a][b]));
    const Om = matMul(matMul(Si, D), Si),
      OL = matMul(Om, L),
      LOL = matMul(tr(L), OL),
      OLP = matMul(OL, Phi);
    return P.map(q =>
      q.t === 'l' ? 2 * OLP[q.j][q.k] : q.t === 'f' ? (q.k === q.l ? LOL[q.k][q.k] : 2 * LOL[q.k][q.l]) : Om[q.j][q.j]
    );
  };
  return { F, grad, ldS };
}

/** Valores iniciales: cargas y varianzas a partir de las covarianzas con el ítem marcador */
function inicialesCFA(S, P, factores) {
  return P.map(q => {
    if (q.t === 'u') return S[q.j][q.j] / 2;
    const mk = factores[q.k][0];
    if (q.t === 'l') return S[q.j][mk] / Math.max(S[mk][mk] / 2, 1e-6);
    if (q.k === q.l) return S[mk][mk] / 2;
    return 0;
  });
}

/** Errores típicos con la información esperada: I_ab = ½ tr(Σ⁻¹ ∂Σ/∂a Σ⁻¹ ∂Σ/∂b) · N */
function erroresCFA(P, build, th, Si, N) {
  const SdS = P.map((_, i) => {
    const { A, B, h } = derivadaCentral(th, i, t => build(t).Sig);
    return matMul(
      Si,
      A.map((r, x) => r.map((v, y) => (v - B[x][y]) / (2 * h)))
    );
  });
  const I = P.map((_, a) =>
    P.map((__, b) => 0.5 * sum(SdS[a].map((r, x) => sum(r.map((v, y) => v * SdS[b][y][x])))) * N)
  );
  return erroresTipicos(I);
}

/** Cargas estandarizadas, correlaciones entre factores, ω (con |λ|: los ítems inversos cuentan como recodificados) y AVE */
function solucionEstandarizada(B, factores, p) {
  const fac = new Array(p).fill(-1);
  factores.forEach((it, k) => it.forEach(j => (fac[j] = k)));
  const std = Array.from(
    { length: p },
    (_, j) => (B.L[j][fac[j]] * Math.sqrt(B.Phi[fac[j]][fac[j]])) / Math.sqrt(B.Sig[j][j])
  );
  const facCor = B.Phi.map((r, k) => r.map((v, l) => v / Math.sqrt(B.Phi[k][k] * B.Phi[l][l])));
  const rel = factores.map((it, k) => {
    const sl = sum(it.map(j => Math.abs(B.L[j][k]))) ** 2 * B.Phi[k][k],
      su = sum(it.map(j => B.Psi[j]));
    return { omega: sl / (sl + su), ave: mean(it.map(j => std[j] ** 2)) };
  });
  return { std, facCor, rel };
}

/**
 * AFC por máxima verosimilitud (como lavaan::cfa, información esperada).
 * @param {number[][]} X casos completos (filas) × ítems
 * @param {number[][]} factores índices de los ítems de cada factor; el primero es el marcador (carga 1)
 */
function cfa(X, factores) {
  const N = X.length,
    p = X[0].length,
    m = factores.length,
    { S } = momentos(X);
  const { P, build } = modeloCFA(factores, p);
  const { F, grad, ldS } = objetivoCFA(S, P, build);
  const { th, f, conv, it } = bfgs(F, grad, inicialesCFA(S, P, factores), {
    maxIt: 2000,
    tolG: 1e-9,
    tolF: 1e-14,
    tolG2: 1e-6,
  });
  const B = build(th),
    se = erroresCFA(P, build, th, inv(B.Sig), N);
  const chi = N * f,
    df = (p * (p + 1)) / 2 - P.length,
    chiB = N * (sum(S.map((r, i) => Math.log(r[i]))) - ldS),
    dfB = (p * (p - 1)) / 2,
    ajuste = indicesAjuste(chi, df, chiB, dfB, N, 1);
  const est = P.map((q, i) => ({ ...q, est: th[i], se: se[i], z: th[i] / se[i], p: pZ(th[i] / se[i]) }));
  return {
    N,
    p,
    m,
    est,
    L: B.L,
    Phi: B.Phi,
    Psi: B.Psi,
    ...solucionEstandarizada(B, factores, p),
    chi,
    df,
    ...ajuste,
    srmr: srmrDe(S, B.Sig),
    chiB,
    dfB,
    conv,
    iter: it,
    heywood: B.Psi.map((v, j) => (v < 0 ? j : -1)).filter(j => j >= 0),
  };
}

// ---- AFC multigrupo con estructura de medias (invarianza de medida) ----

const NIVELES = ['configural', 'metric', 'scalar', 'strict'];

/**
 * Parámetros de cada grupo según el nivel de invarianza: los que se igualan entre grupos comparten clave.
 * Nivel ≥ 1 cargas, ≥ 2 interceptos (y medias latentes libres desde el 2.º grupo), ≥ 3 varianzas residuales.
 */
function especificacionMG(G, factores, p, nivel) {
  const m = factores.length,
    key = new Map(),
    P = [],
    idx = k => {
      if (!key.has(k)) {
        key.set(k, P.length);
        P.push(k);
      }
      return key.get(k);
    };
  const spec = Array.from({ length: G }, (_, g) => {
    const lam = [],
      phi = [],
      psi = [],
      nu = [],
      al = [];
    factores.forEach((it, k) =>
      it.slice(1).forEach(j => lam.push({ j, k, i: idx(nivel >= 1 ? `l:${j}:${k}` : `l:${j}:${k}:${g}`) }))
    );
    for (let k = 0; k < m; k++) for (let l = 0; l <= k; l++) phi.push({ k, l, i: idx(`f:${k}:${l}:${g}`) });
    for (let j = 0; j < p; j++) psi.push({ j, i: idx(nivel >= 3 ? `u:${j}` : `u:${j}:${g}`) });
    for (let j = 0; j < p; j++) nu.push({ j, i: idx(nivel >= 2 ? `n:${j}` : `n:${j}:${g}`) });
    if (nivel >= 2 && g > 0) for (let k = 0; k < m; k++) al.push({ k, i: idx(`a:${k}:${g}`) });
    return { lam, phi, psi, nu, al };
  });
  return { P, spec };
}

/** Matrices del modelo del grupo g: Λ, Φ, Ψ, interceptos ν, medias latentes α, Σ y μ = ν + Λα */
function construirMG(spec, factores, p, th, g) {
  const m = factores.length,
    s = spec[g],
    L = Array.from({ length: p }, () => new Array(m).fill(0)),
    Phi = Array.from({ length: m }, () => new Array(m).fill(0)),
    Psi = new Array(p).fill(0),
    nu = new Array(p).fill(0),
    al = new Array(m).fill(0);
  factores.forEach((it, k) => {
    L[it[0]][k] = 1;
  });
  s.lam.forEach(q => {
    L[q.j][q.k] = th[q.i];
  });
  s.phi.forEach(q => {
    Phi[q.k][q.l] = Phi[q.l][q.k] = th[q.i];
  });
  s.psi.forEach(q => {
    Psi[q.j] = th[q.i];
  });
  s.nu.forEach(q => {
    nu[q.j] = th[q.i];
  });
  s.al.forEach(q => {
    al[q.k] = th[q.i];
  });
  const Sig = sigmaModelo(L, Phi, Psi),
    mu = nu.map((v, j) => v + sum(L[j].map((x, k) => x * al[k])));
  return { L, Phi, Psi, nu, al, Sig, mu };
}

/** Discrepancia ML multigrupo (suma ponderada por n_g/N, con medias) y su gradiente analítico */
function objetivoMG(mom, ldS, ng, N, nP, spec, build) {
  const G = mom.length,
    p = mom[0].mu.length;
  const Fg = (B, g) => {
    const ld = logdetPD(B.Sig);
    if (ld === null) return null;
    const Si = inv(B.Sig);
    if (!Si) return null;
    const { S, mu } = mom[g],
      e = mu.map((v, j) => v - B.mu[j]);
    return (
      ld +
      sum(S.map((r, a) => sum(r.map((v, b) => v * Si[b][a])))) +
      sum(e.map((x, a) => x * sum(e.map((y, b) => Si[a][b] * y)))) -
      ldS[g] -
      p
    );
  };
  const F = th => {
    let t = 0;
    for (let g = 0; g < G; g++) {
      const v = Fg(build(th, g), g);
      if (v === null) return 1e10;
      t += (ng[g] / N) * v;
    }
    return t;
  };
  const grad = th => {
    const gr = new Array(nP).fill(0);
    for (let g = 0; g < G; g++) gradienteGrupo(gr, build(th, g), mom[g], spec[g], ng[g] / N);
    return gr;
  };
  return { F, grad };
}

/** Suma al gradiente la contribución de un grupo con peso w */
function gradienteGrupo(gr, B, { S, mu }, s, w) {
  const Si = inv(B.Sig),
    e = mu.map((v, j) => v - B.mu[j]);
  const Se = S.map((r, a) => r.map((v, b) => v + e[a] * e[b])),
    Om = matMul(
      matMul(
        Si,
        Se.map((r, a) => r.map((v, b) => B.Sig[a][b] - v))
      ),
      Si
    ); // Σ⁻¹ (Σ − S − ee') Σ⁻¹
  const gm = Si.map(r => -2 * sum(r.map((v, b) => v * e[b]))),
    OL = matMul(Om, B.L),
    LOL = matMul(tr(B.L), OL),
    OLP = matMul(OL, B.Phi);
  s.lam.forEach(q => {
    gr[q.i] += w * (2 * OLP[q.j][q.k] + gm[q.j] * B.al[q.k]);
  });
  s.phi.forEach(q => {
    gr[q.i] += w * (q.k === q.l ? LOL[q.k][q.k] : 2 * LOL[q.k][q.l]);
  });
  s.psi.forEach(q => {
    gr[q.i] += w * Om[q.j][q.j];
  });
  s.nu.forEach(q => {
    gr[q.i] += w * gm[q.j];
  });
  s.al.forEach(q => {
    gr[q.i] += w * sum(B.L.map((r, j) => r[q.k] * gm[j]));
  });
}

/** Valores iniciales: promedio entre grupos de los parámetros comunes */
function inicialesMG(nP, spec, mom, factores) {
  const acc = Array.from({ length: nP }, () => [0, 0]),
    put = (i, v) => {
      acc[i][0] += v;
      acc[i][1]++;
    };
  spec.forEach((s, g) => {
    const { S, mu } = mom[g];
    s.lam.forEach(q => {
      const mk = factores[q.k][0];
      put(q.i, S[q.j][mk] / Math.max(S[mk][mk] / 2, 1e-6));
    });
    s.phi.forEach(q => {
      const mk = factores[q.k][0];
      put(q.i, q.k === q.l ? S[mk][mk] / 2 : 0);
    });
    s.psi.forEach(q => put(q.i, S[q.j][q.j] / 2));
    s.nu.forEach(q => put(q.i, mu[q.j]));
    s.al.forEach(q => put(q.i, 0));
  });
  return acc.map(([a, n]) => a / n);
}

/** Errores típicos con la información esperada: Σ_g n_g [½ tr(Σ⁻¹ ∂Σ_a Σ⁻¹ ∂Σ_b) + ∂μ_a' Σ⁻¹ ∂μ_b] */
function erroresMG(nP, build, th, Bs, ng) {
  const G = ng.length,
    Sis = Bs.map(B => inv(B.Sig));
  const der = Array.from({ length: nP }, (_, i) => {
    const { A, B, h } = derivadaCentral(th, i, t => Bs.map((__, gg) => build(t, gg)));
    return A.map((Ag, gg) => ({
      dS: Ag.Sig.map((r, x) => r.map((v, y) => (v - B[gg].Sig[x][y]) / (2 * h))),
      dm: Ag.mu.map((v, x) => (v - B[gg].mu[x]) / (2 * h)),
    }));
  });
  const I = Array.from({ length: nP }, () => new Array(nP).fill(0));
  for (let gg = 0; gg < G; gg++) {
    const Si = Sis[gg],
      SdS = der.map(D => matMul(Si, D[gg].dS)),
      Sdm = der.map(D => Si.map(r => sum(r.map((v, y) => v * D[gg].dm[y]))));
    for (let a = 0; a < nP; a++)
      for (let b = a; b < nP; b++) {
        const v =
          ng[gg] *
          (0.5 * sum(SdS[a].map((r, x) => sum(r.map((q, y) => q * SdS[b][y][x])))) +
            sum(der[a][gg].dm.map((q, x) => q * Sdm[b][x])));
        I[a][b] += v;
        if (b !== a) I[b][a] += v;
      }
  }
  return erroresTipicos(I);
}

/**
 * AFC multigrupo con estructura de medias (como lavaan::cfa(group =, group.equal =), ML con la información esperada).
 * @param {number[][][]} Xg casos completos de cada grupo
 * @param {number[][]} factores índices de los ítems de cada factor (el primero, marcador con carga 1)
 * @param {string} level 'configural' | 'metric' (cargas iguales) | 'scalar' (+ interceptos; medias latentes libres
 *   desde el 2.º grupo) | 'strict' (+ varianzas residuales)
 */
function cfaMG(Xg, factores, level = 'configural') {
  const G = Xg.length,
    p = Xg[0][0].length,
    ng = Xg.map(X => X.length),
    N = sum(ng),
    mom = Xg.map(momentos),
    ldS = mom.map(o => Math.log(det(o.S)));
  const { P, spec } = especificacionMG(G, factores, p, NIVELES.indexOf(level));
  const build = (th, g) => construirMG(spec, factores, p, th, g);
  const { F, grad } = objetivoMG(mom, ldS, ng, N, P.length, spec, build);
  const { th, f, conv, it } = bfgs(F, grad, inicialesMG(P.length, spec, mom, factores), {
    maxIt: 5000,
    tolG: 1e-10,
    tolF: 1e-15,
    tolG2: 1e-7,
  });
  const Bs = Xg.map((_, gg) => build(th, gg)),
    se = erroresMG(P.length, build, th, Bs, ng);
  const chi = N * f,
    df = G * ((p * (p + 1)) / 2 + p) - P.length,
    chiB = sum(mom.map((o, gg) => ng[gg] * (sum(o.S.map((r, i) => Math.log(r[i]))) - ldS[gg]))),
    dfB = (G * p * (p - 1)) / 2;
  const { pval, ...ajuste } = indicesAjuste(chi, df, chiB, dfB, N, G);
  // SRMR (Bentler, con las medias) en cada grupo, combinado con los pesos n_g/N
  const srmrG = mom.map((o, gg) => srmrDe(o.S, Bs[gg].Sig, o.mu, Bs[gg].mu));
  return {
    level,
    chi,
    df,
    p: pval,
    ...ajuste,
    srmr: sum(srmrG.map((v, gg) => (v * ng[gg]) / N)),
    srmrG,
    npar: P.length,
    N,
    ng,
    converged: conv,
    iterations: it,
    params: P.map((k, i) => ({ key: k, est: th[i], se: se[i] })),
    groups: Bs,
  };
}

export { cfaMG, cfa };
