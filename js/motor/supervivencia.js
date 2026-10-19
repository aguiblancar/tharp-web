/* Tharp · motor estadístico · Análisis de supervivencia */
import { J, sum } from './base.js';
import { pChi, pZ } from './distribuciones.js';
import { inv } from './algebra.js';

// time: tiempos; event: 1 = evento, 0 = censura. IC de S(t) en escala logarítmica (conf.type = "log", por defecto en survfit)
function kaplanMeier(time, event, level = 0.95) {
  const z = J.normal.inv(1 - (1 - level) / 2, 0, 1),
    ts = [...new Set(time.filter((_, i) => event[i] === 1))].sort((a, b) => a - b),
    rows = [];
  let S = 1,
    gw = 0;
  ts.forEach(t => {
    const nr = time.filter(v => v >= t).length,
      d = time.filter((v, i) => v === t && event[i] === 1).length;
    S *= 1 - d / nr;
    gw += nr > d ? d / (nr * (nr - d)) : Infinity;
    const se = S * Math.sqrt(gw),
      lse = Math.sqrt(gw);
    rows.push({
      t,
      nrisk: nr,
      nevent: d,
      surv: S,
      se: isFinite(se) ? se : NaN,
      lower: S > 0 && isFinite(lse) ? Math.exp(Math.log(S) - z * lse) : NaN,
      upper: S > 0 && isFinite(lse) ? Math.min(1, Math.exp(Math.log(S) + z * lse)) : NaN,
    });
  });
  // mediana (y sus IC) como quantile.survfit: primer tiempo con S ≤ 0.5; si S vale exactamente 0.5 en un tramo, punto medio con el siguiente tiempo
  const q = key => {
    const tol = Math.sqrt(2.220446049250313e-16);
    for (let k = 0; k < rows.length; k++) {
      const v = rows[k][key];
      if (!isFinite(v)) continue;
      if (Math.abs(v - 0.5) < tol) return k + 1 < rows.length ? (rows[k].t + rows[k + 1].t) / 2 : rows[k].t;
      if (v < 0.5) return rows[k].t;
    }
    return NaN;
  };
  return {
    rows,
    n: time.length,
    events: event.filter(e => e === 1).length,
    median: q('surv'),
    medianCI: [q('lower'), q('upper')],
  };
}
// log-rank (survdiff, rho = 0): g = índice de grupo 0..k−1
function logrank(time, event, g, k) {
  const ts = [...new Set(time.filter((_, i) => event[i] === 1))].sort((a, b) => a - b),
    O = new Array(k).fill(0),
    E = new Array(k).fill(0),
    V = Array.from({ length: k }, () => new Array(k).fill(0));
  ts.forEach(t => {
    const nr = new Array(k).fill(0),
      d = new Array(k).fill(0);
    time.forEach((v, i) => {
      if (v >= t) nr[g[i]]++;
      if (v === t && event[i] === 1) d[g[i]]++;
    });
    const N = sum(nr),
      D = sum(d);
    for (let a = 0; a < k; a++) {
      O[a] += d[a];
      E[a] += (D * nr[a]) / N;
    }
    if (N > 1)
      for (let a = 0; a < k; a++)
        for (let b = 0; b < k; b++)
          V[a][b] += ((((D * (N - D)) / (N - 1)) * nr[a]) / N) * ((a === b ? 1 : 0) - nr[b] / N);
  });
  const m = k - 1,
    Vi = inv(V.slice(0, m).map(r => r.slice(0, m))),
    u = O.slice(0, m).map((o, a) => o - E[a]);
  const chi = Vi ? sum(u.map((x, a) => x * sum(u.map((y_, b) => Vi[a][b] * y_)))) : NaN;
  return { chi, df: m, p: pChi(chi, m), O, E, V };
}
// Cox de riesgos proporcionales con empates de Efron (Newton-Raphson desde 0): X sin constante (n × p)
function cox(X, time, event) {
  const n = X.length,
    p = X[0].length,
    ord = time.map((t, i) => i).sort((a, b) => time[b] - time[a]); // de mayor a menor tiempo (conjuntos de riesgo acumulados)
  const ts = [...new Set(time.filter((_, i) => event[i] === 1))].sort((a, b) => b - a);
  const step = b => {
    const eta = X.map(r => sum(r.map((v, k) => v * b[k]))),
      w = eta.map(Math.exp);
    let ll = 0;
    const U = new Array(p).fill(0),
      I = Array.from({ length: p }, () => new Array(p).fill(0));
    let S0 = 0;
    const S1 = new Array(p).fill(0),
      S2 = Array.from({ length: p }, () => new Array(p).fill(0));
    let q = 0;
    ts.forEach(t => {
      // añadir al conjunto de riesgo todos los tiempos ≥ t
      while (q < n && time[ord[q]] >= t) {
        const i = ord[q++];
        S0 += w[i];
        for (let a = 0; a < p; a++) {
          S1[a] += w[i] * X[i][a];
          for (let c = 0; c < p; c++) S2[a][c] += w[i] * X[i][a] * X[i][c];
        }
      }
      const Dset = [];
      for (let i = 0; i < n; i++) if (time[i] === t && event[i] === 1) Dset.push(i);
      const d = Dset.length;
      let D0 = 0;
      const D1 = new Array(p).fill(0),
        D2 = Array.from({ length: p }, () => new Array(p).fill(0));
      Dset.forEach(i => {
        ll += eta[i];
        D0 += w[i];
        for (let a = 0; a < p; a++) {
          U[a] += X[i][a];
          D1[a] += w[i] * X[i][a];
          for (let c = 0; c < p; c++) D2[a][c] += w[i] * X[i][a] * X[i][c];
        }
      });
      for (let l = 0; l < d; l++) {
        const f_ = l / d,
          s0 = S0 - f_ * D0,
          s1 = S1.map((v, a) => v - f_ * D1[a]);
        ll -= Math.log(s0);
        for (let a = 0; a < p; a++) {
          U[a] -= s1[a] / s0;
          for (let c = 0; c < p; c++) I[a][c] += (S2[a][c] - f_ * D2[a][c]) / s0 - (s1[a] * s1[c]) / (s0 * s0);
        }
      }
    });
    return { ll, U, I };
  };
  let b = new Array(p).fill(0),
    st = step(b);
  const ll0 = st.ll,
    U0 = st.U,
    I0i = inv(st.I);
  for (let it = 0; it < 100; it++) {
    const Ii = inv(st.I);
    if (!Ii) return null;
    const db = Ii.map(r => sum(r.map((v, k) => v * st.U[k])));
    let bn = b.map((v, k) => v + db[k]),
      sn = step(bn),
      h = 0;
    while (sn.ll < st.ll - 1e-12 && h++ < 30) {
      bn = b.map((v, k) => v + db[k] / 2 ** h);
      sn = step(bn);
    } // paso reducido si empeora
    const done = Math.abs(sn.ll - st.ll) < 1e-13 * (1 + Math.abs(st.ll));
    b = bn;
    st = sn;
    if (done) break;
  }
  const Vb = inv(st.I);
  if (!Vb) return null;
  const se = Vb.map((r, k) => Math.sqrt(r[k])),
    z = b.map((v, k) => v / se[k]),
    zq = 1.959963984540054;
  const lr = 2 * (st.ll - ll0),
    wald = sum(b.map((v, a) => v * sum(b.map((u, c) => st.I[a][c] * u)))),
    score = I0i ? sum(U0.map((v, a) => v * sum(U0.map((u, c) => I0i[a][c] * u)))) : NaN;
  return {
    b,
    se,
    z,
    p: z.map(pZ),
    hr: b.map(Math.exp),
    ci: b.map((v, k) => [Math.exp(v - zq * se[k]), Math.exp(v + zq * se[k])]),
    ll: st.ll,
    ll0,
    lr: { chi: lr, df: p, p: pChi(lr, p) },
    wald: { chi: wald, df: p, p: pChi(wald, p) },
    score: { chi: score, df: p, p: pChi(score, p) },
    n,
    events: event.filter(e => e === 1).length,
  };
}

export { kaplanMeier, logrank, cox };
