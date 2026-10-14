/* Tharp — motor estadístico (se ejecuta en el navegador; requiere jStat) */
(function (root) {
  'use strict';
  const J = root.jStat;

  // ---------- básicos ----------
  const sum = a => { let s = 0; for (const v of a) s += v; return s; };
  const mean = a => sum(a) / a.length;
  function variance(a) { const m = mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return s / (a.length - 1); }
  const sd = a => Math.sqrt(variance(a));
  const sorted = a => a.slice().sort((x, y) => x - y);
  function quantile(s, p) { const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.min(lo + 1, s.length - 1); return s[lo] + (h - lo) * (s[hi] - s[lo]); }
  const median = a => quantile(sorted(a), 0.5);
  function skewness(a) { // G1 (SPSS)
    const n = a.length; if (n < 3) return NaN; const m = mean(a), s = sd(a); if (!s) return NaN;
    let t = 0; for (const v of a) t += ((v - m) / s) ** 3; return n / ((n - 1) * (n - 2)) * t;
  }
  function kurtosis(a) { // G2 (SPSS), exceso
    const n = a.length; if (n < 4) return NaN; const m = mean(a), s = sd(a); if (!s) return NaN;
    let t = 0; for (const v of a) t += ((v - m) / s) ** 4;
    return n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * t - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3));
  }
  function ranks(a) { // rangos promedio + corrección de empates
    const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(a.length); let ties = 0;
    for (let i = 0; i < idx.length;) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1, t = j - i + 1; if (t > 1) ties += t ** 3 - t;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1;
    }
    return { r, ties };
  }
  const pT = (t, df) => 2 * (1 - J.studentt.cdf(Math.abs(t), df));
  const pF = (F, d1, d2) => 1 - J.centralF.cdf(F, d1, d2);
  const pChi = (x, df) => 1 - J.chisquare.cdf(x, df);
  const pZ = z => 2 * (1 - J.normal.cdf(Math.abs(z), 0, 1));
  const tcrit = df => J.studentt.inv(0.975, df);
  function meanCI(a) { const n = a.length, m = mean(a); if (n < 2) return [m, m]; const h = tcrit(n - 1) * sd(a) / Math.sqrt(n); return [m - h, m + h]; }
  function describe(a) {
    const s = sorted(a), n = a.length;
    return { n, mean: mean(a), sd: n > 1 ? sd(a) : NaN, median: quantile(s, .5), q1: quantile(s, .25), q3: quantile(s, .75),
      min: s[0], max: s[n - 1], skew: skewness(a), kurt: kurtosis(a), ci: meanCI(a) };
  }
  function holm(ps) {
    const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), m = ps.length, out = new Array(m); let prev = 0;
    o.forEach(([p, i], k) => { prev = Math.max(prev, Math.min(1, (m - k) * p)); out[i] = prev; });
    return out;
  }

  // ---------- Shapiro-Wilk (Royston 1995, algoritmo AS R94) ----------
  const poly = (c, x) => { let r = 0; for (let i = c.length - 1; i >= 0; i--) r = r * x + c[i]; return r; };
  const C1 = [0, .221157, -.147981, -2.07119, 4.434685, -2.706056], C2 = [0, .042981, -.293762, -1.752461, 5.682633, -3.582633];
  const C3 = [.544, -.39978, .025054, -6.714e-4], C4 = [1.3822, -.77857, .062767, -.0020322];
  const C5 = [-1.5861, -.31082, -.083751, .0038915], C6 = [-.4803, -.082676, .0030302];
  function shapiro(xIn) {
    const x = sorted(xIn), n = x.length;
    if (n < 3 || n > 5000 || x[n - 1] - x[0] < 1e-12) return null;
    const nn2 = Math.floor(n / 2), a = new Array(nn2 + 1);
    if (n === 3) a[1] = Math.SQRT1_2;
    else {
      const an25 = n + .25, m = new Array(nn2 + 1); let summ2 = 0;
      for (let i = 1; i <= nn2; i++) { m[i] = J.normal.inv((i - .375) / an25, 0, 1); summ2 += m[i] * m[i]; }
      summ2 *= 2; const ssumm2 = Math.sqrt(summ2), rsn = 1 / Math.sqrt(n);
      const a1 = poly(C1, rsn) - m[1] / ssumm2; let i1, fac;
      if (n > 5) {
        i1 = 3; const a2 = -m[2] / ssumm2 + poly(C2, rsn);
        fac = Math.sqrt((summ2 - 2 * m[1] ** 2 - 2 * m[2] ** 2) / (1 - 2 * a1 ** 2 - 2 * a2 ** 2)); a[2] = a2;
      } else { i1 = 2; fac = Math.sqrt((summ2 - 2 * m[1] ** 2) / (1 - 2 * a1 ** 2)); }
      a[1] = a1; for (let i = i1; i <= nn2; i++) a[i] = -m[i] / fac;
    }
    const mu = mean(x); let ss = 0; for (const v of x) ss += (v - mu) ** 2;
    let num = 0; for (let i = 1; i <= nn2; i++) num += a[i] * (x[n - i] - x[i - 1]);
    let W = Math.min(1, num * num / ss), p;
    if (n === 3) p = Math.max(0, 1.90985931710274 * (Math.asin(Math.sqrt(W)) - 1.04719755119660));
    else {
      let y = Math.log(1 - W); const xx = Math.log(n);
      if (n <= 11) {
        const gamma = poly([-2.273, .459], n);
        if (y >= gamma) p = 1e-19;
        else { y = -Math.log(gamma - y); p = 1 - J.normal.cdf(y, poly(C3, n), Math.exp(poly(C4, n))); }
      } else p = 1 - J.normal.cdf(y, poly(C5, xx), Math.exp(poly(C6, xx)));
    }
    return { W, p };
  }

  // ---------- comparación de grupos ----------
  function anova(groups) { // groups: [[...], ...]
    const all = groups.flat(), N = all.length, k = groups.length, gm = mean(all);
    let ssb = 0, ssw = 0;
    groups.forEach(g => { const m = mean(g); ssb += g.length * (m - gm) ** 2; for (const v of g) ssw += (v - m) ** 2; });
    const df1 = k - 1, df2 = N - k, msw = ssw / df2, F = (ssb / df1) / msw;
    return { F, df1, df2, p: pF(F, df1, df2), ssb, ssw, msw, eta2: ssb / (ssb + ssw),
      omega2: Math.max(0, (ssb - df1 * msw) / (ssb + ssw + msw)) };
  }
  function levene(groups) { // centrado en la media (como SPSS)
    const z = groups.map(g => { const m = mean(g); return g.map(v => Math.abs(v - m)); });
    const r = anova(z); return { F: r.F, df1: r.df1, df2: r.df2, p: isFinite(r.F) ? r.p : 1 };
  }
  function welchAnova(groups) {
    const k = groups.length, n = groups.map(g => g.length), m = groups.map(mean), v = groups.map(variance);
    const w = n.map((ni, i) => ni / v[i]), W = sum(w), xw = sum(w.map((wi, i) => wi * m[i])) / W;
    const A = sum(w.map((wi, i) => wi * (m[i] - xw) ** 2)) / (k - 1);
    const tmp = sum(w.map((wi, i) => (1 - wi / W) ** 2 / (n[i] - 1)));
    const B = 1 + 2 * (k - 2) / (k * k - 1) * tmp, F = A / B, df1 = k - 1, df2 = (k * k - 1) / (3 * tmp);
    return { F, df1, df2, p: pF(F, df1, df2) };
  }
  function tTestInd(a, b, equalVar) {
    const n1 = a.length, n2 = b.length, m1 = mean(a), m2 = mean(b), v1 = variance(a), v2 = variance(b);
    const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2), d = (m1 - m2) / Math.sqrt(sp2);
    let se, df;
    if (equalVar) { se = Math.sqrt(sp2 * (1 / n1 + 1 / n2)); df = n1 + n2 - 2; }
    else { se = Math.sqrt(v1 / n1 + v2 / n2); df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)); }
    const t = (m1 - m2) / se, h = tcrit(df) * se;
    return { t, df, p: pT(t, df), diff: m1 - m2, ci: [m1 - m2 - h, m1 - m2 + h], d };
  }
  function mannWhitney(a, b) {
    const n1 = a.length, n2 = b.length, N = n1 + n2, { r, ties } = ranks(a.concat(b));
    const R1 = sum(r.slice(0, n1)), U = R1 - n1 * (n1 + 1) / 2, mu = n1 * n2 / 2;
    const sig = Math.sqrt(n1 * n2 / 12 * ((N + 1) - ties / (N * (N - 1))));
    const dlt = U - mu, z = (Math.abs(dlt) - .5) * Math.sign(dlt) / sig;
    return { U, z, p: pZ(z), r: Math.abs(z) / Math.sqrt(N) };
  }
  function kruskal(groups) {
    const all = groups.flat(), N = all.length, k = groups.length, { r, ties } = ranks(all);
    let off = 0, H = 0; const meanRanks = [];
    groups.forEach(g => { const R = sum(r.slice(off, off + g.length)); meanRanks.push(R / g.length); H += R * R / g.length; off += g.length; });
    H = (12 / (N * (N + 1)) * H - 3 * (N + 1)) / (1 - ties / (N ** 3 - N));
    return { H, df: k - 1, p: pChi(H, k - 1), eps2: H / (N - 1), meanRanks, ties, N };
  }
  function dunn(groups, kw) {
    const N = kw.N, out = [], ps = [];
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const se = Math.sqrt((N * (N + 1) / 12 - kw.ties / (12 * (N - 1))) * (1 / groups[i].length + 1 / groups[j].length));
      const z = (kw.meanRanks[i] - kw.meanRanks[j]) / se, p = pZ(z); out.push({ i, j, z, p }); ps.push(p);
    }
    holm(ps).forEach((p, k) => out[k].padj = p); return out;
  }
  const hasTukey = !!(J.tukey && J.tukey.cdf);
  function tukeyHSD(groups, msw, dfw) {
    const k = groups.length, out = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      const a = groups[i], b = groups[j], diff = mean(a) - mean(b), se = Math.sqrt(msw / 2 * (1 / a.length + 1 / b.length));
      out.push({ i, j, diff, padj: Math.min(1, 1 - J.tukey.cdf(Math.abs(diff) / se, k, dfw)) });
    }
    return out;
  }
  function gamesHowell(groups) {
    const k = groups.length, out = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      const a = groups[i], b = groups[j], va = variance(a) / a.length, vb = variance(b) / b.length, diff = mean(a) - mean(b);
      const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
      out.push({ i, j, diff, padj: Math.min(1, 1 - J.tukey.cdf(Math.abs(diff) / Math.sqrt((va + vb) / 2), k, df)) });
    }
    return out;
  }
  function pairwiseHolm(groups, equalVar) {
    const out = [];
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const r = tTestInd(groups[i], groups[j], equalVar); out.push({ i, j, diff: r.diff, p: r.p });
    }
    holm(out.map(o => o.p)).forEach((p, k) => out[k].padj = p); return out;
  }

  // ---------- medidas relacionadas ----------
  function tTestPaired(a, b) { // a = momento 1, b = momento 2; diferencia b - a
    const d = b.map((v, i) => v - a[i]), n = d.length, md = mean(d), sdd = sd(d), se = sdd / Math.sqrt(n), df = n - 1, t = md / se, h = tcrit(df) * se;
    return { t, df, p: pT(t, df), diff: md, ci: [md - h, md + h], dz: md / sdd };
  }
  function wilcoxonSigned(a, b) {
    const d = b.map((v, i) => v - a[i]).filter(v => v !== 0), n = d.length;
    const { r, ties } = ranks(d.map(Math.abs));
    const Wp = sum(r.filter((_, i) => d[i] > 0)), mu = n * (n + 1) / 4;
    const sig = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - ties / 48), dlt = Wp - mu;
    const z = (Math.abs(dlt) - .5) * Math.sign(dlt) / sig;
    return { V: Wp, z, p: pZ(z), r: Math.abs(z) / Math.sqrt(n), n };
  }

  // ---------- medidas repetidas (3 o más momentos) ----------
  function det(A) { // determinante por eliminación gaussiana con pivote parcial
    const n = A.length, M = A.map(r => r.slice()); let d = 1;
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (M[piv][c] === 0) return 0;
      if (piv !== c) { [M[c], M[piv]] = [M[piv], M[c]]; d = -d; }
      d *= M[c][c];
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let j = c; j < n; j++) M[r][j] -= f * M[c][j]; }
    }
    return d;
  }
  function rmAnova(Y) { // Y: n casos × k momentos (casos completos)
    const n = Y.length, k = Y[0].length, all = Y.flat(), gm = mean(all);
    const cm = Array.from({ length: k }, (_, j) => mean(Y.map(r => r[j]))), sm = Y.map(mean);
    const ssCond = n * sum(cm.map(m => (m - gm) ** 2)), ssSubj = k * sum(sm.map(m => (m - gm) ** 2));
    const ssTot = sum(all.map(v => (v - gm) ** 2)), ssErr = ssTot - ssCond - ssSubj;
    const df1 = k - 1, df2 = (k - 1) * (n - 1), F = (ssCond / df1) / (ssErr / df2);
    // esfericidad: contrastes ortonormales de Helmert sobre la matriz de covarianzas
    const p = k - 1, C = [];
    for (let j = 0; j < p; j++) { const v = new Array(k).fill(0), m = j + 1; for (let i = 0; i < m; i++) v[i] = 1; v[m] = -m; const nr = Math.sqrt(m * (m + 1)); C.push(v.map(x => x / nr)); }
    const S = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => {
      let s = 0; for (let i = 0; i < n; i++) s += (Y[i][a] - cm[a]) * (Y[i][b] - cm[b]); return s / (n - 1); }));
    const M = C.map(ca => C.map(cb => { let s = 0; for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) s += ca[a] * S[a][b] * cb[b]; return s; }));
    const tr = sum(M.map((r, i) => r[i])), tr2 = sum(M.map((r, i) => sum(r.map((v, j) => v * M[j][i]))));
    const gg = Math.min(1, tr * tr / (p * tr2));
    let mauchly = null;
    if (k > 2) {
      // como mauchly.test de R: aproximación chi-cuadrado con el término de corrección de segundo orden
      const W = det(M) / (tr / p) ** p, dfm = p * (p + 1) / 2 - 1, nu = n - 1, rho = 1 - (2 * p * p + p + 2) / (6 * p * nu);
      const chi = -nu * rho * Math.log(W), w2 = (p + 2) * (p - 1) * (p - 2) * (2 * p ** 3 + 6 * p * p + 3 * p + 2) / (288 * (nu * p * rho) ** 2);
      mauchly = { W, chi, df: dfm, p: pChi(chi, dfm) + w2 * (pChi(chi, dfm + 4) - pChi(chi, dfm)) };
    }
    return { F, df1, df2, p: pF(F, df1, df2), ssCond, ssSubj, ssErr, n, k, means: cm,
      peta2: ssCond / (ssCond + ssErr), ges: ssCond / (ssCond + ssSubj + ssErr), gg, mauchly,
      pGG: pF(F, df1 * gg, df2 * gg) };
  }
  function friedman(Y) {
    const n = Y.length, k = Y[0].length, R = new Array(k).fill(0); let ties = 0;
    Y.forEach(row => { const r = ranks(row); r.r.forEach((v, j) => R[j] += v); ties += r.ties; });
    const Q0 = 12 / (n * k * (k + 1)) * sum(R.map(v => v * v)) - 3 * n * (k + 1), Q = Q0 / (1 - ties / (n * k * (k * k - 1)));
    return { Q, df: k - 1, p: pChi(Q, k - 1), W: Q / (n * (k - 1)), meanRanks: R.map(v => v / n), n, k };
  }

  // ---------- asociación ----------
  function pearson(x, y) {
    const n = x.length, mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    const r = sxy / Math.sqrt(sxx * syy), t = r * Math.sqrt((n - 2) / (1 - r * r));
    return { r, n, df: n - 2, p: Math.abs(r) >= 1 ? 0 : pT(t, n - 2) };
  }
  const spearman = (x, y) => pearson(ranks(x).r, ranks(y).r);
  function lfact(n) { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; }
  function fisher2x2(a, b, c, d) {
    const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2, lf = []; let s = 0; lf[0] = 0;
    for (let i = 1; i <= n; i++) { s += Math.log(i); lf[i] = s; }
    const pr = x => Math.exp(lf[r1] + lf[r2] + lf[c1] + lf[n - c1] - lf[n] - lf[x] - lf[r1 - x] - lf[c1 - x] - lf[r2 - c1 + x]);
    const po = pr(a); let p = 0;
    for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) { const q = pr(x); if (q <= po * (1 + 1e-7)) p += q; }
    return { p: Math.min(1, p) };
  }
  function chiSquare(tab) { // tab: filas × columnas (recuentos)
    const R = tab.length, C = tab[0].length, rs = tab.map(sum), cs = tab[0].map((_, j) => sum(tab.map(r => r[j]))), N = sum(rs);
    let chi = 0, small = 0, minE = Infinity; const E = [], adj = [];
    for (let i = 0; i < R; i++) { E[i] = []; adj[i] = [];
      for (let j = 0; j < C; j++) {
        const e = rs[i] * cs[j] / N; E[i][j] = e; chi += (tab[i][j] - e) ** 2 / e; if (e < 5) small++; minE = Math.min(minE, e);
        adj[i][j] = (tab[i][j] - e) / Math.sqrt(e * (1 - rs[i] / N) * (1 - cs[j] / N));
      } }
    const df = (R - 1) * (C - 1);
    return { chi, df, p: pChi(chi, df), N, V: Math.sqrt(chi / (N * (Math.min(R, C) - 1))), E, adj, rs, cs,
      pctSmall: small / (R * C), minE };
  }

  // ---------- regresión lineal (MCO) ----------
  function inv(A) {
    const n = A.length, M = A.map((r, i) => r.concat(A.map((_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c];
      for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c && M[r][c] !== 0) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map(r => r.slice(n));
  }
  function olsCore(X, y) {
    const n = X.length, p = X[0].length, XtX = [], Xty = new Array(p).fill(0);
    for (let a = 0; a < p; a++) { XtX[a] = new Array(p).fill(0); }
    for (let i = 0; i < n; i++) { const xi = X[i]; for (let a = 0; a < p; a++) { Xty[a] += xi[a] * y[i]; for (let b = a; b < p; b++) XtX[a][b] += xi[a] * xi[b]; } }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    const Ai = inv(XtX); if (!Ai) return null;
    const b = Ai.map(r => sum(r.map((v, k) => v * Xty[k])));
    const fit = X.map(xi => sum(xi.map((v, k) => v * b[k]))), e = y.map((v, i) => v - fit[i]);
    const my = mean(y), sse = sum(e.map(v => v * v)), sst = sum(y.map(v => (v - my) ** 2));
    return { b, Ai, fit, e, sse, sst, r2: 1 - sse / sst, n, p };
  }
  function ols(X, y) {
    const m = olsCore(X, y); if (!m) return null;
    const { n, p, Ai, e } = m, dfr = n - p, s2 = m.sse / dfr;
    const se = Ai.map((r, k) => Math.sqrt(s2 * r[k])), t = m.b.map((v, k) => v / se[k]), pv = t.map(v => pT(v, dfr));
    const tc = tcrit(dfr), ci = m.b.map((v, k) => [v - tc * se[k], v + tc * se[k]]);
    const h = X.map(xi => { let s = 0; for (let a = 0; a < p; a++) { let q = 0; for (let c = 0; c < p; c++) q += Ai[a][c] * xi[c]; s += xi[a] * q; } return s; });
    const cook = e.map((v, i) => v * v / (p * s2) * h[i] / (1 - h[i]) ** 2);
    // HC3
    const meat = Array.from({ length: p }, () => new Array(p).fill(0));
    X.forEach((xi, i) => { const w = e[i] ** 2 / (1 - h[i]) ** 2; for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) meat[a][c] += w * xi[a] * xi[c]; });
    const AM = Ai.map(r => meat[0].map((_, c) => sum(r.map((v, k) => v * meat[k][c]))));
    const V3 = AM.map(r => Ai[0].map((_, c) => sum(r.map((v, k) => v * Ai[k][c]))));
    const se3 = V3.map((r, k) => Math.sqrt(r[k])), p3 = m.b.map((v, k) => pT(v / se3[k], dfr));
    const df1 = p - 1, F = ((m.sst - m.sse) / df1) / s2;
    // Breusch-Pagan (Koenker, studentizado)
    const aux = olsCore(X, e.map(v => v * v)), bpLM = n * aux.r2;
    let dw = 0; for (let i = 1; i < n; i++) dw += (e[i] - e[i - 1]) ** 2; dw /= m.sse;
    const vif = []; for (let j = 1; j < p; j++) {
      const Xo = X.map(r => r.filter((_, k) => k !== j)), yj = X.map(r => r[j]), a = olsCore(Xo, yj); vif[j] = a ? 1 / (1 - a.r2) : Infinity;
    }
    return Object.assign(m, { s2, se, t, pv, ci, h, cook, se3, p3, dfr, df1, F, pF: pF(F, df1, dfr),
      adjr2: 1 - (1 - m.r2) * (n - 1) / dfr, bp: { LM: bpLM, df: df1, p: pChi(bpLM, df1) }, dw, vif });
  }

  // ---------- fiabilidad: alfa de Cronbach ----------
  function cronbach(items) { // items: k arrays de igual longitud (casos completos)
    const k = items.length, n = items[0].length, total = items[0].map((_, i) => sum(items.map(it => it[i])));
    const alphaOf = its => { const kk = its.length, tot = its[0].map((_, i) => sum(its.map(it => it[i])));
      return kk / (kk - 1) * (1 - sum(its.map(variance)) / variance(tot)); };
    const alpha = alphaOf(items);
    let rs = 0, cnt = 0; for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) { rs += pearson(items[a], items[b]).r; cnt++; }
    const rbar = rs / cnt, alphaStd = k * rbar / (1 + (k - 1) * rbar);
    const stats = items.map((it, j) => {
      const rest = total.map((t, i) => t - it[i]);
      return { mean: mean(it), sd: sd(it), rit: pearson(it, rest).r, alphaDel: k > 2 ? alphaOf(items.filter((_, q) => q !== j)) : NaN };
    });
    return { alpha, alphaStd, rbar, k, n, stats, totalMean: mean(total), totalSd: sd(total) };
  }

  // ---------- regresión logística binaria (IRLS) ----------
  function logistic(X, y) {
    const n = X.length, p = X[0].length; let b = new Array(p).fill(0), it = 0, conv = false, Ai = null, dev = 0;
    const ybar = mean(y); b[0] = Math.log(ybar / (1 - ybar));
    for (; it < 100; it++) {
      const eta = X.map(r => sum(r.map((v, k) => v * b[k]))), pr = eta.map(e => 1 / (1 + Math.exp(-e)));
      const XtWX = Array.from({ length: p }, () => new Array(p).fill(0)), XtR = new Array(p).fill(0);
      for (let i = 0; i < n; i++) { const w = Math.max(pr[i] * (1 - pr[i]), 1e-12), xi = X[i];
        for (let a = 0; a < p; a++) { XtR[a] += xi[a] * (y[i] - pr[i]); for (let c = 0; c < p; c++) XtWX[a][c] += w * xi[a] * xi[c]; } }
      Ai = inv(XtWX); if (!Ai) return null;
      const step = Ai.map(r => sum(r.map((v, k) => v * XtR[k])));
      b = b.map((v, k) => v + step[k]);
      if (Math.max(...step.map(Math.abs)) < 1e-10) { conv = true; break; }
    }
    const pr = X.map(r => 1 / (1 + Math.exp(-sum(r.map((v, k) => v * b[k])))));
    // matriz de información final
    const XtWX = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) { const w = pr[i] * (1 - pr[i]); for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) XtWX[a][c] += w * X[i][a] * X[i][c]; }
    Ai = inv(XtWX) || Ai;
    const ll = y.reduce((s, v, i) => s + (v ? Math.log(Math.max(pr[i], 1e-300)) : Math.log(Math.max(1 - pr[i], 1e-300))), 0);
    const ll0 = y.reduce((s, v) => s + (v ? Math.log(ybar) : Math.log(1 - ybar)), 0);
    dev = -2 * ll; const dev0 = -2 * ll0, se = Ai.map((r, k) => Math.sqrt(r[k])), z = b.map((v, k) => v / se[k]);
    const LR = dev0 - dev, df = p - 1, cs = 1 - Math.exp((dev - dev0) / n), nag = cs / (1 - Math.exp(-dev0 / n));
    // Hosmer-Lemeshow (deciles de riesgo)
    const ord = pr.map((v, i) => [v, y[i]]).sort((a, c) => a[0] - c[0]), g = Math.min(10, Math.floor(n / 5)); let hl = 0, gUsed = 0;
    for (let q = 0; q < g; q++) { const part = ord.slice(Math.floor(q * n / g), Math.floor((q + 1) * n / g)); if (!part.length) continue;
      const o1 = sum(part.map(r => r[1])), e1 = sum(part.map(r => r[0])), m = part.length; gUsed++;
      if (e1 > 0) hl += (o1 - e1) ** 2 / e1; if (m - e1 > 0) hl += ((m - o1) - (m - e1)) ** 2 / (m - e1); }
    const tab = [[0, 0], [0, 0]]; pr.forEach((v, i) => tab[y[i]][v >= .5 ? 1 : 0]++);
    const separation = !conv || b.some(v => Math.abs(v) > 15) || se.some(v => !isFinite(v) || v > 1e3);
    return { b, se, z, p: z.map(pZ), or: b.map(Math.exp), ci: b.map((v, k) => [Math.exp(v - 1.959964 * se[k]), Math.exp(v + 1.959964 * se[k])]),
      dev, dev0, LR, df, pLR: pChi(LR, df), cs, nag, hl: { chi: hl, df: gUsed - 2, p: pChi(hl, Math.max(1, gUsed - 2)) }, tab,
      acc: (tab[0][0] + tab[1][1]) / n, n, events: sum(y), iter: it + 1, conv, separation, prob: pr };
  }

  // ---------- ANOVA factorial de dos factores (SC tipo III, codificación de efectos) ----------
  function anova2(y, a, b, la, lb) { // a, b: índices de nivel por caso
    const effA = (i, j) => (a[i] === j ? 1 : a[i] === la - 1 ? -1 : 0), effB = (i, j) => (b[i] === j ? 1 : b[i] === lb - 1 ? -1 : 0);
    const n = y.length, colsA = [], colsB = [], colsAB = [];
    for (let j = 0; j < la - 1; j++) colsA.push(y.map((_, i) => effA(i, j)));
    for (let j = 0; j < lb - 1; j++) colsB.push(y.map((_, i) => effB(i, j)));
    colsA.forEach(ca => colsB.forEach(cb => colsAB.push(ca.map((v, i) => v * cb[i]))));
    const build = sets => y.map((_, i) => [1].concat(...sets.map(s => s.map(c => c[i]))));
    const full = olsCore(build([colsA, colsB, colsAB]), y); if (!full) return null;
    const dfE = n - full.p, mse = full.sse / dfE, out = {};
    [['A', [colsB, colsAB], la - 1], ['B', [colsA, colsAB], lb - 1], ['AB', [colsA, colsB], (la - 1) * (lb - 1)]].forEach(([k, sets, df]) => {
      const red = olsCore(build(sets), y), ss = red.sse - full.sse, F = (ss / df) / mse;
      out[k] = { ss, df, ms: ss / df, F, p: pF(F, df, dfE), peta2: ss / (ss + full.sse) };
    });
    return Object.assign(out, { sse: full.sse, dfE, mse, resid: full.e, r2: full.r2 });
  }

  root.TharpStats = { cronbach, logistic, anova2, sum, mean, variance, sd, median, quantile, sorted, skewness, kurtosis, ranks, describe, meanCI, holm,
    shapiro, anova, levene, welchAnova, tTestInd, mannWhitney, kruskal, dunn, tukeyHSD, gamesHowell, pairwiseHolm, hasTukey,
    tTestPaired, wilcoxonSigned, rmAnova, friedman, pearson, spearman, fisher2x2, chiSquare, ols, tcrit, pT };
})(typeof window !== 'undefined' ? window : this);
