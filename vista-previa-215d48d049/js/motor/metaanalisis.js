/* Tharp · motor estadístico · Metaanálisis */
import { J, sum } from './base.js';
import { pChi, pZ } from './distribuciones.js';
import { inv } from './algebra.js';

// tamaños del efecto por estudio: SMD (g de Hedges con la corrección exacta), MD, OR (log; +0.5 en las cuatro casillas si alguna es 0), COR (z de Fisher)
function effectSize(type, d) {
  if (type === 'SMD') {
    const m = d.n1 + d.n2 - 2,
      sp = Math.sqrt(((d.n1 - 1) * d.sd1 ** 2 + (d.n2 - 1) * d.sd2 ** 2) / m),
      J_ = Math.exp(J.gammaln(m / 2) - Math.log(Math.sqrt(m / 2)) - J.gammaln((m - 1) / 2)),
      g = (J_ * (d.m1 - d.m2)) / sp;
    return { yi: g, vi: 1 / d.n1 + 1 / d.n2 + (g * g) / (2 * (d.n1 + d.n2)) };
  }
  if (type === 'MD') return { yi: d.m1 - d.m2, vi: d.sd1 ** 2 / d.n1 + d.sd2 ** 2 / d.n2 };
  if (type === 'OR') {
    let { a, b, c, d: dd } = d;
    if ([a, b, c, dd].some(x => x === 0)) {
      a += 0.5;
      b += 0.5;
      c += 0.5;
      dd += 0.5;
    }
    return { yi: Math.log((a * dd) / (b * c)), vi: 1 / a + 1 / b + 1 / c + 1 / dd };
  }
  if (type === 'COR') return { yi: Math.atanh(d.r), vi: 1 / (d.n - 3) };
  return null;
}
// modelo de efectos fijos ('FE'), DerSimonian-Laird ('DL') o REML (Fisher scoring, como metafor); X: moderadores con constante (por defecto, solo la constante)
function rmaFit(y, v, method = 'REML', X = null) {
  const k = y.length,
    Xm = X || y.map(() => [1]),
    p = Xm[0].length;
  const wls = t2 => {
    const w = v.map(x => 1 / (x + t2)),
      M = Array.from({ length: p }, (_, a) =>
        Array.from({ length: p }, (_, c) => sum(Xm.map((r, i) => w[i] * r[a] * r[c])))
      ),
      Mi = inv(M);
    if (!Mi) return null;
    const Xy = Array.from({ length: p }, (_, a) => sum(Xm.map((r, i) => w[i] * r[a] * y[i]))),
      b = Mi.map(r => sum(r.map((q, a) => q * Xy[a]))),
      e = y.map((yy, i) => yy - sum(Xm[i].map((q, a) => q * b[a])));
    return { w, Mi, b, e };
  };
  // P = W − W X (X'WX)⁻¹ X'W
  const Pmat = (w, Mi) =>
    y.map((_, i) =>
      y.map(
        (__, j) =>
          (i === j ? w[i] : 0) - w[i] * w[j] * sum(Xm[i].map((xa, a) => xa * sum(Xm[j].map((xc, c) => Mi[a][c] * xc))))
      )
    );
  const fe = wls(0);
  if (!fe) return null;
  const QE = sum(fe.e.map((e, i) => fe.w[i] * e * e));
  let t2 = 0;
  if (method === 'DL') {
    const W = fe.w,
      P = Pmat(W, fe.Mi),
      trP = sum(P.map((r, i) => r[i]));
    t2 = Math.max(0, (QE - (k - p)) / trP);
  } else if (method === 'REML') {
    const Wfe = fe.w,
      P0 = Pmat(Wfe, fe.Mi);
    t2 = Math.max(0, (QE - (k - p)) / sum(P0.map((r, i) => r[i]))); // arranque con el estimador de DL
    for (let it = 0; it < 1000; it++) {
      const f_ = wls(t2),
        P = Pmat(f_.w, f_.Mi),
        Py = P.map(r => sum(r.map((q, j) => q * y[j])));
      const U = -0.5 * sum(P.map((r, i) => r[i])) + 0.5 * sum(Py.map(q => q * q)),
        I = 0.5 * sum(P.map((r, i) => sum(r.map((q, j) => q * P[j][i]))));
      let tn = t2 + U / I;
      if (tn < 0) tn = 0;
      const done = Math.abs(tn - t2) < 1e-14 * Math.max(1, t2);
      t2 = tn;
      if (done) break;
    }
  }
  const f_ = wls(t2),
    se = f_.Mi.map((r, a) => Math.sqrt(r[a])),
    z = f_.b.map((b, a) => b / se[a]),
    zq = 1.959963984540054;
  const P = Pmat(f_.w, f_.Mi),
    seT2 = method === 'REML' ? Math.sqrt(2 / sum(P.map((r, i) => sum(r.map((q, j) => q * P[j][i]))))) : NaN;
  const wf = v.map(x => 1 / x),
    s2 = ((k - 1) * sum(wf)) / (sum(wf) ** 2 - sum(wf.map(x => x * x))); // varianza típica dentro de los estudios (Higgins y Thompson)
  return {
    k,
    p,
    b: f_.b,
    se,
    z,
    pval: z.map(pZ),
    ci: f_.b.map((b, a) => [b - zq * se[a], b + zq * se[a]]),
    tau2: t2,
    seTau2: seT2,
    QE,
    dfQ: k - p,
    pQ: pChi(QE, k - p),
    I2: (100 * t2) / (t2 + s2),
    H2: (t2 + s2) / s2,
    s2,
    w: f_.w,
    method,
  };
}
// IC del 95 % de τ² por el perfil de Q (Viechtbauer, 2007; como confint.rma.uni), y los de I² y H² que se derivan
function tau2CI(y, v, level = 0.95) {
  const k = y.length,
    Qg = t2 => {
      const w = v.map(x => 1 / (x + t2)),
        mu = sum(w.map((wi, i) => wi * y[i])) / sum(w);
      return sum(w.map((wi, i) => wi * (y[i] - mu) ** 2));
    };
  const root = target => {
    if (Qg(0) < target) return 0;
    let lo = 0,
      hi = 1;
    while (Qg(hi) > target) hi *= 2;
    for (let it = 0; it < 200; it++) {
      const md = (lo + hi) / 2;
      if (Qg(md) > target) lo = md;
      else hi = md;
    }
    return (lo + hi) / 2;
  };
  const a = (1 - level) / 2,
    lb = root(J.chisquare.inv(1 - a, k - 1)),
    ub = root(J.chisquare.inv(a, k - 1));
  const wf = v.map(x => 1 / x),
    s2 = ((k - 1) * sum(wf)) / (sum(wf) ** 2 - sum(wf.map(x => x * x)));
  return { tau2: [lb, ub], I2: [(100 * lb) / (lb + s2), (100 * ub) / (ub + s2)], H2: [(lb + s2) / s2, (ub + s2) / s2] };
}
// metaanálisis completo: modelo, intervalo de predicción e IC de τ²; Egger: metarregresión con el EE como moderador (como regtest)
function meta(y, v, method = 'REML') {
  const r = rmaFit(y, v, method);
  if (!r) return null;
  const zq = 1.959963984540054,
    se = r.se[0],
    piH = zq * Math.sqrt(se * se + r.tau2);
  const ci = method === 'FE' ? null : tau2CI(y, v),
    eg =
      y.length >= 3
        ? rmaFit(
            y,
            v,
            method,
            v.map(x => [1, Math.sqrt(x)])
          )
        : null;
  if (method === 'FE') {
    r.I2 = r.QE > 0 ? Math.max(0, (100 * (r.QE - r.dfQ)) / r.QE) : 0;
    r.H2 = r.QE / r.dfQ;
  } // en efectos fijos, a partir de Q (como metafor)
  return Object.assign(r, {
    est: r.b[0],
    pi: method === 'FE' ? [NaN, NaN] : [r.b[0] - piH, r.b[0] + piH],
    tau2CI: ci,
    egger: eg ? { z: eg.z[1], p: eg.pval[1], b: eg.b[0], ci: eg.ci[0] } : null,
    weights: r.w.map(w => (100 * w) / sum(r.w)),
  });
}

export { effectSize, rmaFit, tau2CI, meta };
