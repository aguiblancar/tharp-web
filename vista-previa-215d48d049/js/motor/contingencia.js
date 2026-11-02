/* Tharp · motor estadístico · Tablas de contingencia y pruebas para proporciones */
import { J, minOf, sum } from './base.js';
import { pChi, pZ } from './distribuciones.js';

function fisher2x2(a, b, c, d) {
  const r1 = a + b,
    r2 = c + d,
    c1 = a + c,
    n = r1 + r2,
    lf = [];
  let s = 0;
  lf[0] = 0;
  for (let i = 1; i <= n; i++) {
    s += Math.log(i);
    lf[i] = s;
  }
  const pr = x =>
    Math.exp(lf[r1] + lf[r2] + lf[c1] + lf[n - c1] - lf[n] - lf[x] - lf[r1 - x] - lf[c1 - x] - lf[r2 - c1 + x]);
  const po = pr(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const q = pr(x);
    if (q <= po * (1 + 1e-7)) p += q;
  }
  return { p: Math.min(1, p) };
}
function chiSquare(tab) {
  // tab: filas × columnas (recuentos)
  const R = tab.length,
    C = tab[0].length,
    rs = tab.map(sum),
    cs = tab[0].map((_, j) => sum(tab.map(r => r[j]))),
    N = sum(rs);
  let chi = 0,
    small = 0,
    minE = Infinity;
  const E = /** @type {number[][]} */ ([]),
    adj = [];
  for (let i = 0; i < R; i++) {
    E[i] = [];
    adj[i] = [];
    for (let j = 0; j < C; j++) {
      const e = (rs[i] * cs[j]) / N;
      E[i][j] = e;
      chi += (tab[i][j] - e) ** 2 / e;
      if (e < 5) small++;
      minE = Math.min(minE, e);
      adj[i][j] = (tab[i][j] - e) / Math.sqrt(e * (1 - rs[i] / N) * (1 - cs[j] / N));
    }
  }
  const df = (R - 1) * (C - 1);
  // razón de verosimilitudes (G²), corrección de Yates (solo 2×2, como chisq.test de R), φ y coeficiente de contingencia
  let G2 = 0;
  for (let i = 0; i < R; i++)
    for (let j = 0; j < C; j++) if (tab[i][j] > 0) G2 += 2 * tab[i][j] * Math.log(tab[i][j] / E[i][j]);
  let yates = null,
    phi = null;
  if (R === 2 && C === 2) {
    let y = 0;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const dd = Math.abs(tab[i][j] - E[i][j]),
          c = Math.min(0.5, dd);
        y += (dd - c) ** 2 / E[i][j];
      }
    yates = { chi: y, p: pChi(y, 1) };
    phi = (tab[0][0] * tab[1][1] - tab[0][1] * tab[1][0]) / Math.sqrt(rs[0] * rs[1] * cs[0] * cs[1]);
  }
  return {
    chi,
    df,
    p: pChi(chi, df),
    N,
    V: Math.sqrt(chi / (N * (Math.min(R, C) - 1))),
    E,
    adj,
    rs,
    cs,
    pctSmall: small / (R * C),
    minE,
    G2,
    pG2: pChi(G2, df),
    yates,
    phi,
    Ccont: Math.sqrt(chi / (chi + N)),
  };
}
// medidas de asociación ordinal de una tabla con filas y columnas ordenadas (gamma, tau-b, tau-c, d de Somers)
// con sus errores típicos asintóticos ASE1 (para el IC) y ASE0 (para el contraste), con las fórmulas de SPSS/Agresti
function ordinalAssoc(t) {
  const R = t.length,
    C = t[0].length,
    n = sum(t.map(sum)),
    rs = t.map(sum),
    cs = t[0].map((_, j) => sum(t.map(r => r[j])));
  const A = t.map((r, i) =>
    r.map((_, j) => {
      let s = 0;
      for (let k = 0; k < R; k++) for (let l = 0; l < C; l++) if ((k > i && l > j) || (k < i && l < j)) s += t[k][l];
      return s;
    })
  );
  const D = t.map((r, i) =>
    r.map((_, j) => {
      let s = 0;
      for (let k = 0; k < R; k++) for (let l = 0; l < C; l++) if ((k > i && l < j) || (k < i && l > j)) s += t[k][l];
      return s;
    })
  );
  let P = 0,
    Q = 0;
  t.forEach((r, i) =>
    r.forEach((v, j) => {
      P += v * A[i][j];
      Q += v * D[i][j];
    })
  );
  const wr = n * n - sum(rs.map(v => v * v)),
    wc = n * n - sum(cs.map(v => v * v)),
    m = Math.min(R, C);
  const S = fn => sum(t.map((r, i) => sum(r.map((v, j) => v * fn(i, j)))));
  const AD = S((i, j) => (A[i][j] - D[i][j]) ** 2),
    base0 = Math.sqrt(Math.max(0, AD - (P - Q) ** 2 / n));
  const gamma = (P - Q) / (P + Q),
    gASE1 = (4 / (P + Q) ** 2) * Math.sqrt(S((i, j) => (Q * A[i][j] - P * D[i][j]) ** 2)),
    gASE0 = (2 / (P + Q)) * base0;
  const taub = (P - Q) / Math.sqrt(wr * wc),
    v_ = (i, j) => rs[i] * wc + cs[j] * wr;
  const tbASE1 =
      (1 / (wr * wc)) *
      Math.sqrt(
        Math.max(
          0,
          S((i, j) => (2 * Math.sqrt(wr * wc) * (A[i][j] - D[i][j]) + taub * v_(i, j)) ** 2) -
            n ** 3 * taub ** 2 * (wr + wc) ** 2
        )
      ),
    tbASE0 = (2 / Math.sqrt(wr * wc)) * base0;
  const tauc = (m * (P - Q)) / (n * n * (m - 1)),
    tcASE = ((2 * m) / ((m - 1) * n * n)) * base0;
  const dCR = (P - Q) / wr,
    dCRASE1 = (2 / wr ** 2) * Math.sqrt(S((i, j) => (wr * (A[i][j] - D[i][j]) - (P - Q) * (n - rs[i])) ** 2)),
    dCRASE0 = (2 / wr) * base0;
  const dRC = (P - Q) / wc,
    dRCASE1 = (2 / wc ** 2) * Math.sqrt(S((i, j) => (wc * (A[i][j] - D[i][j]) - (P - Q) * (n - cs[j])) ** 2)),
    dRCASE0 = (2 / wc) * base0;
  const mk = (est, a1, a0) => ({
    est,
    ase: a1,
    z: est / a0,
    p: pZ(est / a0),
    ci: [Math.max(-1, est - 1.959963984540054 * a1), Math.min(1, est + 1.959963984540054 * a1)],
  });
  return {
    gamma: mk(gamma, gASE1, gASE0),
    taub: mk(taub, tbASE1, tbASE0),
    tauc: mk(tauc, tcASE, tcASE),
    somersCR: mk(dCR, dCRASE1, dCRASE0),
    somersRC: mk(dRC, dRCASE1, dRCASE0),
  };
}
// prueba exacta de Fisher-Freeman-Halton para tablas R×C (enumeración de todas las tablas con los mismos márgenes, como fisher.test);
// devuelve null si hay demasiadas tablas para enumerarlas
function fisherRxC(t, maxTables = 3e6) {
  const R = t.length,
    C = t[0].length,
    rs = t.map(sum),
    cs = t[0].map((_, j) => sum(t.map(r => r[j]))),
    n = sum(rs);
  const lf = [0];
  for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  const konst = sum(rs.map(r => lf[r])) + sum(cs.map(c => lf[c])) - lf[n];
  const lpObs = konst - sum(t.flat().map(v => lf[v]));
  let pval = 0,
    count = 0,
    over = false;
  const colRem = cs.slice();
  const rec = (i, lpAcc) => {
    if (over) return;
    if (i === R - 1) {
      let lp = lpAcc;
      for (let j = 0; j < C; j++) lp -= lf[colRem[j]];
      count++;
      if (count > maxTables) {
        over = true;
        return;
      }
      if (lp <= lpObs + 1e-7 * Math.abs(lpObs)) pval += Math.exp(lp);
      return;
    }
    const fill = (j, left, lp) => {
      if (over) return;
      if (j === C - 1) {
        if (left > colRem[j]) return;
        colRem[j] -= left;
        rec(i + 1, lp - lf[left]);
        colRem[j] += left;
        return;
      }
      let restCap = 0;
      for (let q = j + 1; q < C; q++) restCap += colRem[q];
      for (let v = Math.max(0, left - restCap); v <= Math.min(left, colRem[j]); v++) {
        colRem[j] -= v;
        fill(j + 1, left - v, lp - lf[v]);
        colRem[j] += v;
      }
    };
    fill(0, rs[i], lpAcc);
  };
  rec(0, konst);
  return over ? null : { p: Math.min(1, pval), tables: count };
}
// Mantel-Haenszel para tablas 2×2 estratificadas (como mantelhaen.test con corrección de continuidad) y Breslow-Day (homogeneidad de las OR)
function mantelHaenszel(tabs) {
  // tabs: K tablas [[a, b], [c, d]]
  let num = 0,
    den = 0,
    sA = 0,
    sE = 0,
    sV = 0,
    P_R = 0,
    PS_QR = 0,
    Q_S = 0,
    R_ = 0,
    S_ = 0;
  tabs.forEach(([[a, b], [c, d]]) => {
    const n = a + b + c + d;
    if (n < 2) return;
    const r1 = a + b,
      c1 = a + c,
      r2 = c + d,
      c2 = b + d;
    num += (a * d) / n;
    den += (b * c) / n;
    sA += a;
    sE += (r1 * c1) / n;
    sV += (r1 * r2 * c1 * c2) / (n * n * (n - 1));
    const Pk = (a + d) / n,
      Qk = (b + c) / n,
      Rk = (a * d) / n,
      Sk = (b * c) / n;
    P_R += Pk * Rk;
    PS_QR += Pk * Sk + Qk * Rk;
    Q_S += Qk * Sk;
    R_ += Rk;
    S_ += Sk;
  });
  // corrección por continuidad solo si |ΣA − ΣE| ≥ 0.5 (como mantelhaen.test: con diferencias menores sobrecorregiría)
  const dlt = Math.abs(sA - sE),
    or = num / den,
    chi = (dlt >= 0.5 ? dlt - 0.5 : dlt) ** 2 / sV;
  const varLog = P_R / (2 * R_ * R_) + PS_QR / (2 * R_ * S_) + Q_S / (2 * S_ * S_),
    z = 1.959963984540054; // Robins, Breslow y Greenland
  // Breslow-Day: para cada estrato, la a esperada bajo la OR común (raíz de la cuadrática), con la corrección de Tarone
  let bd = 0,
    sumA = 0,
    sumEa = 0,
    sumVa = 0;
  tabs.forEach(([[a, b], [c, d]]) => {
    const r1 = a + b,
      c1 = a + c,
      n = a + b + c + d,
      r2 = n - r1;
    const qa = 1 - or,
      qb = r2 - c1 + or * (r1 + c1),
      qc = -or * r1 * c1;
    let ea;
    if (Math.abs(qa) < 1e-12) ea = -qc / qb;
    else {
      const disc = Math.sqrt(qb * qb - 4 * qa * qc),
        x1 = (-qb + disc) / (2 * qa),
        x2 = (-qb - disc) / (2 * qa),
        lo = Math.max(0, c1 - r2),
        hi = Math.min(r1, c1);
      ea = x1 >= lo - 1e-9 && x1 <= hi + 1e-9 ? x1 : x2;
    }
    const eb = r1 - ea,
      ec = c1 - ea,
      ed = r2 - c1 + ea,
      va = 1 / (1 / ea + 1 / eb + 1 / ec + 1 / ed);
    bd += (a - ea) ** 2 / va;
    sumA += a;
    sumEa += ea;
    sumVa += va;
  });
  const K = tabs.length,
    tarone = bd - (sumA - sumEa) ** 2 / sumVa;
  return {
    or,
    ci: [Math.exp(Math.log(or) - z * Math.sqrt(varLog)), Math.exp(Math.log(or) + z * Math.sqrt(varLog))],
    chi,
    p: pChi(chi, 1),
    bd: { chi: tarone, df: K - 1, p: pChi(tarone, K - 1), uncorrected: bd },
  };
}
// tabla 2×2 [[a, b], [c, d]]: odds ratio (Woolf) y riesgos relativos (Katz) con IC 95 % por el método logarítmico, como SPSS y JASP;
// con alguna casilla a 0 se suma 0.5 a todas (corrección de Haldane-Anscombe)
function risk2x2(t) {
  let [[a, b], [c, d]] = t;
  const hal = [a, b, c, d].some(x => x === 0);
  if (hal) {
    a += 0.5;
    b += 0.5;
    c += 0.5;
    d += 0.5;
  }
  const z = 1.959963984540054,
    ci = (est, se) => [Math.exp(Math.log(est) - z * se), Math.exp(Math.log(est) + z * se)];
  const or = (a * d) / (b * c),
    seOR = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  const rr1 = a / (a + b) / (c / (c + d)),
    se1 = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
  const rr2 = b / (a + b) / (d / (c + d)),
    se2 = Math.sqrt(1 / b - 1 / (a + b) + 1 / d - 1 / (c + d));
  return { or, orCI: ci(or, seOR), rr1, rr1CI: ci(rr1, se1), rr2, rr2CI: ci(rr2, se2), haldane: hal };
}
// prueba binomial exacta frente a p0 (como binom.test de R) con IC de Clopper-Pearson
function binomTest(x, n, p0 = 0.5, alt = 'two') {
  const lf = [0];
  for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  const pr = k =>
    p0 === 0
      ? k === 0
        ? 1
        : 0
      : p0 === 1
        ? k === n
          ? 1
          : 0
        : Math.exp(lf[n] - lf[k] - lf[n - k] + k * Math.log(p0) + (n - k) * Math.log(1 - p0));
  let p = 0;
  if (alt === 'greater') for (let k = x; k <= n; k++) p += pr(k);
  else if (alt === 'less') for (let k = 0; k <= x; k++) p += pr(k);
  else {
    const d = pr(x);
    for (let k = 0; k <= n; k++) {
      const v = pr(k);
      if (v <= d * (1 + 1e-7)) p += v;
    }
  }
  const a = alt === 'two' ? 0.025 : 0.05;
  const lo = alt === 'less' || x === 0 ? 0 : J.beta.inv(a, x, n - x + 1),
    hi = alt === 'greater' || x === n ? 1 : J.beta.inv(1 - a, x + 1, n - x);
  return { x, n, prop: x / n, p0, p: Math.min(1, p), ci: [lo, hi], alt };
}
// χ² de bondad de ajuste a unas proporciones esperadas (por defecto iguales), como chisq.test(x, p =) de R
function chiGOF(counts, probs) {
  const k = counts.length,
    N = sum(counts),
    pr = probs && probs.length === k ? probs.map(v => v / sum(probs)) : counts.map(() => 1 / k);
  const E = pr.map(q => q * N),
    chi = sum(counts.map((o, i) => (o - E[i]) ** 2 / E[i])),
    df = k - 1;
  return {
    chi,
    df,
    p: pChi(chi, df),
    E,
    N,
    probs: pr,
    resid: counts.map((o, i) => (o - E[i]) / Math.sqrt(E[i])),
    minE: minOf(E),
    w: Math.sqrt(chi / N),
  };
}

export { fisher2x2, chiSquare, ordinalAssoc, fisherRxC, mantelHaenszel, risk2x2, binomTest, chiGOF };
