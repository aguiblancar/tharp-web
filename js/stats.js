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
  // p según la hipótesis alternativa: 'two' (bilateral), 'greater' (estadístico mayor que lo esperado), 'less'
  const pTalt = (t, df, alt) => (alt === 'greater' ? 1 - J.studentt.cdf(t, df) : alt === 'less' ? J.studentt.cdf(t, df) : pT(t, df));
  const pZalt = (z, alt) => (alt === 'greater' ? 1 - J.normal.cdf(z, 0, 1) : alt === 'less' ? J.normal.cdf(z, 0, 1) : pZ(z));
  // función de distribución de la t no central (algoritmo AS 243 de Lenth, como pt(ncp =) de R)
  function pnct(t, df, ncp) {
    let tt = t, del = ncp, neg = false;
    if (t < 0) { neg = true; tt = -t; del = -ncp; }
    if (df > 4e5 || del * del > 2 * Math.LN2 * 1021) { // como R: aproximación de Abramowitz y Stegun 26.7.10 cuando la serie desborda
      const s = 1 / (4 * df), pr = J.normal.cdf(tt * (1 - s), del, Math.sqrt(1 + tt * tt * 2 * s)); return neg ? 1 - pr : pr; }
    const x = tt * tt / (tt * tt + df); let tnc = 0;
    if (x > 0) {
      const lambda = del * del; let p = .5 * Math.exp(-.5 * lambda), q = Math.sqrt(2 / Math.PI) * p * del, s = .5 - p;
      if (s < 1e-7) s = -.5 * Math.expm1(-.5 * lambda);
      let a = .5; const b = .5 * df, rxb = Math.pow(1 - x, b), albeta = .5 * Math.log(Math.PI) + J.gammaln(b) - J.gammaln(.5 + b);
      let xodd = J.ibeta(x, a, b), godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta), xeven = b * x < 2.2e-16 ? b * x : 1 - rxb, geven = b * x * rxb;
      tnc = p * xodd + q * xeven;
      for (let it = 1; it <= 2000; it++) {
        a += 1; xodd -= godd; xeven -= geven; godd *= x * (a + b - 1) / a; geven *= x * (a + b - .5) / (a + .5);
        p *= lambda / (2 * it); q *= lambda / (2 * it + 1); tnc += p * xodd + q * xeven; s -= p;
        if (s < -1e-10 || (s <= 0 && it > 1)) break;
        if (Math.abs(2 * s * (xodd - godd)) < 1e-12) break;
      }
    }
    tnc += J.normal.cdf(-del, 0, 1); tnc = Math.min(tnc, 1);
    return neg ? 1 - tnc : tnc;
  }
  // límites del parámetro de no centralidad para un t observado (como MBESS::conf.limits.nct, que usa JASP)
  function ncpCI(t, df, level = .95, alt = 'two') {
    const aL = alt === 'two' ? (1 - level) / 2 : 1 - level;
    const solve = target => { let lo = t - 10 - Math.abs(t), hi = t + 10 + Math.abs(t);
      while (pnct(t, df, lo) < target) lo -= 10; while (pnct(t, df, hi) > target) hi += 10;
      for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (pnct(t, df, mid) > target) lo = mid; else hi = mid; if (hi - lo < 1e-10) break; } return (lo + hi) / 2; };
    return [alt === 'less' ? -Infinity : solve(1 - aL), alt === 'greater' ? Infinity : solve(aL)];
  }
  // distribuciones exactas (como pwilcox y psignrank de R) para muestras pequeñas sin empates
  function wilcoxCounts(n1, n2) { // número de formas de obtener cada U (0..n1·n2)
    const N = n1 + n2, maxS = n1 * (2 * N - n1 + 1) / 2; let dp = Array.from({ length: n1 + 1 }, () => new Float64Array(maxS + 1)); dp[0][0] = 1;
    for (let r = 1; r <= N; r++) for (let j = Math.min(r, n1); j >= 1; j--) { const row = dp[j], prev = dp[j - 1]; for (let s = maxS; s >= r; s--) row[s] += prev[s - r]; }
    const base = n1 * (n1 + 1) / 2, out = new Float64Array(n1 * n2 + 1); for (let u = 0; u <= n1 * n2; u++) out[u] = dp[n1][u + base]; return out;
  }
  function signrankCounts(n) { const max = n * (n + 1) / 2, c = new Float64Array(max + 1); c[0] = 1;
    for (let r = 1; r <= n; r++) for (let s = max; s >= r; s--) c[s] += c[s - r]; return c; }
  const cdfCounts = (c, x) => { let tot = 0, acc = 0; for (let i = 0; i < c.length; i++) { tot += c[i]; if (i <= x) acc += c[i]; } return acc / tot; };
  const exactP = (c, stat, mid, alt) => { const lower = cdfCounts(c, stat), upper = 1 - cdfCounts(c, stat - 1);
    if (alt === 'greater') return upper; if (alt === 'less') return lower;
    return Math.min(1, 2 * (stat > mid ? 1 - cdfCounts(c, stat - 1) : cdfCounts(c, stat))); };
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
  // intervalo de la diferencia de medias según la alternativa
  const ciAlt = (est, se, df, alt) => { if (alt === 'two') { const h = tcrit(df) * se; return [est - h, est + h]; }
    const h = J.studentt.inv(0.95, df) * se; return alt === 'greater' ? [est - h, Infinity] : [-Infinity, est + h]; };
  // d de Cohen como JASP: varianza combinada (Student) o media de las dos varianzas (Welch); IC por la t no central (MBESS)
  function tTestInd(a, b, equalVar, alt = 'two') {
    const n1 = a.length, n2 = b.length, m1 = mean(a), m2 = mean(b), v1 = variance(a), v2 = variance(b);
    const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2), d = (m1 - m2) / Math.sqrt(equalVar ? sp2 : (v1 + v2) / 2);
    let se, df;
    if (equalVar) { se = Math.sqrt(sp2 * (1 / n1 + 1 / n2)); df = n1 + n2 - 2; }
    else { se = Math.sqrt(v1 / n1 + v2 / n2); df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)); }
    const t = (m1 - m2) / se, k = Math.sqrt(n1 * n2 / (n1 + n2)), nc = ncpCI(d * k, df, .95, alt);
    const dfg = n1 + n2 - 2, J_ = Math.exp(J.gammaln(dfg / 2) - Math.log(Math.sqrt(dfg / 2)) - J.gammaln((dfg - 1) / 2));
    return { t, df, p: pTalt(t, df, alt), alt, diff: m1 - m2, ci: ciAlt(m1 - m2, se, df, alt), d, dCI: nc.map(v => v / k), g: d * J_, se };
  }
  // U de Mann-Whitney (W de R, del primer grupo); p exacta sin empates y n < 50 en ambos grupos (como wilcox.test);
  // correlación biserial por rangos con IC (Kerby, 2014; como JASP)
  function mannWhitney(a, b, alt = 'two') {
    const n1 = a.length, n2 = b.length, N = n1 + n2, { r, ties } = ranks(a.concat(b));
    const R1 = sum(r.slice(0, n1)), U = R1 - n1 * (n1 + 1) / 2, mu = n1 * n2 / 2;
    const sig = Math.sqrt(n1 * n2 / 12 * ((N + 1) - ties / (N * (N - 1))));
    const dlt = U - mu, z = (Math.abs(dlt) - .5) * Math.sign(dlt) / sig;
    const zA = (dlt - (alt === 'two' ? Math.sign(dlt) * .5 : alt === 'greater' ? .5 : -.5)) / sig;
    const exact = n1 < 50 && n2 < 50 && ties === 0, p = exact ? exactP(wilcoxCounts(n1, n2), U, mu, alt) : pZalt(zA, alt);
    const rb = 2 * U / (n1 * n2) - 1, seRb = Math.sqrt(4 / (n1 * n2) ** 2 * (n1 * n2 * (N + 1) / 12));
    return { U, z, p, exact, alt, r: Math.abs(z) / Math.sqrt(N), rb, rbCI: rbCI(rb, seRb, alt) };
  }
  function rbCI(rb, se, alt) { const z = Math.atanh(Math.max(-0.9999999, Math.min(0.9999999, rb)));
    if (alt === 'two') return [Math.tanh(z - 1.959963984540054 * se), Math.tanh(z + 1.959963984540054 * se)];
    return alt === 'greater' ? [Math.tanh(z - 1.6448536269514722 * se), 1] : [-1, Math.tanh(z + 1.6448536269514722 * se)]; }
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
  // t para una muestra frente a un valor de referencia mu; d = (M − mu) / DT, IC por la t no central (como JASP)
  function tTestOne(x, mu = 0, alt = 'two') {
    const n = x.length, m = mean(x), s = sd(x), se = s / Math.sqrt(n), df = n - 1, t = (m - mu) / se, d = (m - mu) / s;
    const nc = ncpCI(d * Math.sqrt(n), df, .95, alt);
    return { t, df, p: pTalt(t, df, alt), alt, diff: m - mu, ci: ciAlt(m - mu, se, df, alt), d, dCI: nc.map(v => v / Math.sqrt(n)), mean: m, sd: s, n };
  }
  function tTestPaired(a, b, alt = 'two') { // a = momento 1, b = momento 2; diferencia b - a
    const d = b.map((v, i) => v - a[i]), r = tTestOne(d, 0, alt);
    return { t: r.t, df: r.df, p: r.p, alt, diff: r.diff, ci: r.ci, dz: r.d, dzCI: r.dCI };
  }
  // Wilcoxon de rangos con signo para una muestra (x − mu); p exacta sin empates ni ceros y n < 50 (como wilcox.test);
  // biserial por rangos de pares emparejados con IC (como JASP)
  function wilcoxonOne(x, mu = 0, alt = 'two') {
    const dAll = x.map(v => v - mu), zeros = dAll.filter(v => v === 0).length, d = dAll.filter(v => v !== 0), n = d.length;
    if (!n) return { V: 0, z: 0, p: 1, r: 0, n, rb: 0, rbCI: [NaN, NaN], exact: false, alt };
    const { r, ties } = ranks(d.map(Math.abs));
    const Wp = sum(r.filter((_, i) => d[i] > 0)), mu0 = n * (n + 1) / 4;
    const sig = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - ties / 48), dlt = Wp - mu0;
    const z = (Math.abs(dlt) - .5) * Math.sign(dlt) / sig, zA = (dlt - (alt === 'two' ? Math.sign(dlt) * .5 : alt === 'greater' ? .5 : -.5)) / sig;
    const exact = n < 50 && ties === 0 && zeros === 0, p = exact ? exactP(signrankCounts(n), Wp, mu0, alt) : pZalt(zA, alt);
    const maxw = n * (n + 1) / 2, rb = Wp / maxw * 2 - 1, seRb = Math.sqrt((Math.sqrt(n * (n + 1) * (2 * n + 1) / 6) / 2) ** 2 * 4 / maxw ** 2);
    return { V: Wp, z, p, exact, alt, r: Math.abs(z) / Math.sqrt(n), n, rb, rbCI: rbCI(rb, seRb, alt) };
  }
  function wilcoxonSigned(a, b, alt = 'two') { return wilcoxonOne(b.map((v, i) => v - a[i]), 0, alt); }

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
  // ---------- ANOVA mixta: un factor intrasujeto (k medidas) × un factor entre sujetos (G grupos) ----------
  // SC de tipo III también con grupos desiguales (como afex/SPSS/JASP): estrato entre sujetos = ANOVA de las medias
  // de cada persona; estrato intra = contrastes ortonormales de las medidas, con el intercepto no ponderado (momento)
  // y el efecto de grupo (interacción). Esfericidad sobre la covarianza intragrupo combinada de los contrastes.
  function mixedAnova(Y, g, G) {
    const n = Y.length, k = Y[0].length, p = k - 1, ng = new Array(G).fill(0); g.forEach(x => ng[x]++);
    const sm = Y.map(mean), gmS = new Array(G).fill(0); sm.forEach((v, i) => { gmS[g[i]] += v; }); for (let j = 0; j < G; j++) gmS[j] /= ng[j];
    const grand = mean(sm), ssB = k * sum(ng.map((c, j) => c * (gmS[j] - grand) ** 2)), ssSe = k * sum(sm.map((v, i) => (v - gmS[g[i]]) ** 2));
    const dfB = G - 1, dfSe = n - G, FB = (ssB / dfB) / (ssSe / dfSe);
    const C = []; for (let j = 0; j < p; j++) { const v = new Array(k).fill(0), m = j + 1; for (let i = 0; i < m; i++) v[i] = 1; v[m] = -m; const nr = Math.sqrt(m * (m + 1)); C.push(v.map(x => x / nr)); }
    const Z = Y.map(r => C.map(c => sum(c.map((w, a) => w * r[a]))));
    let ssT = 0, ssTG = 0, ssE = 0; const E = Array.from({ length: p }, () => new Array(p).fill(0));
    const gmZ = Array.from({ length: G }, (_, j) => C.map((_, c) => mean(Z.filter((_, i) => g[i] === j).map(z => z[c]))));
    for (let c = 0; c < p; c++) {
      const u = mean(gmZ.map(m => m[c])), zbar = mean(Z.map(z => z[c]));
      ssT += u * u / (sum(ng.map(x => 1 / x)) / (G * G));
      ssTG += sum(ng.map((x, j) => x * (gmZ[j][c] - zbar) ** 2));
    }
    Z.forEach((z, i) => { for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) E[a][b] += (z[a] - gmZ[g[i]][a]) * (z[b] - gmZ[g[i]][b]); });
    for (let c = 0; c < p; c++) ssE += E[c][c];
    const dfT = p, dfTG = (G - 1) * p, dfE = dfSe * p, FT = (ssT / dfT) / (ssE / dfE), FTG = (ssTG / dfTG) / (ssE / dfE);
    const Sg = E.map(r => r.map(v => v / dfSe)), tr = sum(Sg.map((r, i) => r[i])), tr2 = sum(Sg.map((r, i) => sum(r.map((v, j) => v * Sg[j][i]))));
    const gg = Math.min(1, tr * tr / (p * tr2)), hf = Math.min(1, ((n - G + 1) * p * gg - 2) / (p * (n - G - p * gg)));
    let mauchly = null;
    if (k > 2) {
      const W = det(Sg) / (tr / p) ** p, dfm = p * (p + 1) / 2 - 1, nu = dfSe, rho = 1 - (2 * p * p + p + 2) / (6 * p * nu);
      const chi = -nu * rho * Math.log(W), w2 = (p + 2) * (p - 1) * (p - 2) * (2 * p ** 3 + 6 * p * p + 3 * p + 2) / (288 * (nu * p * rho) ** 2);
      mauchly = { W, chi, df: dfm, p: pChi(chi, dfm) + w2 * (pChi(chi, dfm + 4) - pChi(chi, dfm)) };
    }
    const errAll = ssSe + ssE, eff = (ss, df1, df2, F, errSS) => ({ ss, df1, df2, F, p: pF(F, df1, df2), peta2: ss / (ss + errSS), ges: ss / (ss + errAll),
      pGG: pF(F, df1 * gg, df2 * gg), pHF: pF(F, df1 * hf, df2 * hf) });
    // comparaciones por pares de los momentos (promediando los grupos sin ponderar; error propio de cada diferencia, como emmeans «multivariate»)
    const within = [];
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
      const dI = Y.map(r => r[a] - r[b]), gmd = Array.from({ length: G }, (_, j) => mean(dI.filter((_, i) => g[i] === j)));
      const est = mean(gmd), s2 = sum(dI.map((v, i) => (v - gmd[g[i]]) ** 2)) / dfSe, se = Math.sqrt(s2 * sum(ng.map(x => 1 / x))) / G, t = est / se;
      within.push({ a, b, est, se, t, df: dfSe, p: pT(t, dfSe) });
    }
    const adj = holm(within.map(o => o.p)); within.forEach((o, i) => { o.padj = adj[i]; });
    const cellMeans = Array.from({ length: G }, (_, j) => Array.from({ length: k }, (_, a) => mean(Y.filter((_, i) => g[i] === j).map(r => r[a]))));
    return { n, k, G, ng, gg, hf, mauchly, within, cellMeans, subjMeans: sm,
      B: eff(ssB, dfB, dfSe, FB, ssSe), T: eff(ssT, dfT, dfE, FT, ssE), TG: eff(ssTG, dfTG, dfE, FTG, ssE), ssSe, dfSe, ssE, dfE };
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

  // ---------- ANCOVA de un factor (SC tipo III, codificación de efectos) ----------
  function ancova(y, g, L, C) { // g: índice de nivel por caso; C: n × q covariables
    const n = y.length, q = C[0].length;
    const eff = (i, j) => (g[i] === j ? 1 : g[i] === L - 1 ? -1 : 0);
    const G = Array.from({ length: L - 1 }, (_, j) => y.map((_, i) => eff(i, j)));
    const cov = Array.from({ length: q }, (_, c) => C.map(r => r[c]));
    const build = sets => y.map((_, i) => [1].concat(...sets.map(s => s.map(col => col[i]))));
    const full = olsCore(build([G, cov]), y); if (!full) return null;
    const dfE = n - full.p, mse = full.sse / dfE;
    const term = (sets, df) => { const red = olsCore(build(sets), y); if (!red) return null; const ss = red.sse - full.sse, F = (ss / df) / mse;
      return { ss, df, ms: ss / df, F, p: pF(F, df, dfE), peta2: ss / (ss + full.sse) }; };
    const factor = term([cov], L - 1);
    const covs = cov.map((_, c) => term([G, cov.filter((__, k) => k !== c)], 1));
    // homogeneidad de pendientes: añadir las interacciones factor × covariable
    const inter = []; G.forEach(gc => cov.forEach(cc => inter.push(gc.map((v, i) => v * cc[i]))));
    const fi = olsCore(build([G, cov, inter]), y); let slopes = null;
    if (fi) { const dfi = inter.length, dfr = n - fi.p, F = ((full.sse - fi.sse) / dfi) / (fi.sse / dfr); slopes = { F, df1: dfi, df2: dfr, p: pF(F, dfi, dfr) }; }
    // medias ajustadas (en la media de las covariables) y comparaciones por pares
    const cm = cov.map(mean), V = full.Ai.map(r => r.map(v => v * mse));
    const lvec = j => [1].concat(Array.from({ length: L - 1 }, (_, k) => (j === k ? 1 : j === L - 1 ? -1 : 0)), cm);
    const est = l => sum(l.map((v, k) => v * full.b[k])), se = l => Math.sqrt(sum(l.map((a, r) => sum(l.map((b, c) => a * V[r][c] * b)))));
    const tc = tcrit(dfE), adj = Array.from({ length: L }, (_, j) => { const l = lvec(j), m = est(l), s = se(l); return { mean: m, se: s, ci: [m - tc * s, m + tc * s] }; });
    const pairs = [];
    for (let a = 0; a < L; a++) for (let b = a + 1; b < L; b++) {
      const l = lvec(a).map((v, k) => v - lvec(b)[k]), d = est(l), s = se(l), t = d / s;
      pairs.push({ i: a, j: b, diff: d, se: s, t, p: pT(t, dfE) });
    }
    holm(pairs.map(o => o.p)).forEach((p, k) => pairs[k].padj = p);
    return { factor, covs, slopes, adj, pairs, dfE, mse, sse: full.sse, resid: full.e, b: full.b, r2: full.r2 };
  }

  // ---------- variables dicotómicas relacionadas: McNemar y Q de Cochran ----------
  function binomTwoSided(x, n) { // binomial exacta con p = 0.5 (como binom.test de R)
    const lf = [0]; for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
    const pr = k => Math.exp(lf[n] - lf[k] - lf[n - k] - n * Math.LN2), d = pr(x); let p = 0;
    for (let k = 0; k <= n; k++) { const v = pr(k); if (v <= d * (1 + 1e-7)) p += v; }
    return Math.min(1, p);
  }
  function mcnemar(b, c) { // b: 0→1, c: 1→0 (casos discordantes)
    const nd = b + c, chi = nd ? (Math.abs(b - c) - 1) ** 2 / nd : 0;
    return { b, c, chi, df: 1, p: nd ? pChi(chi, 1) : 1, pExact: nd ? binomTwoSided(Math.min(b, c), nd) : 1 };
  }
  function cochranQ(M) { // M: n × k con 0/1
    const k = M[0].length, Cj = Array.from({ length: k }, (_, j) => sum(M.map(r => r[j]))), Ri = M.map(sum), N = sum(Ri);
    const den = k * N - sum(Ri.map(r => r * r)), Q = den ? (k - 1) * (k * sum(Cj.map(c => c * c)) - N * N) / den : 0;
    return { Q, df: k - 1, p: den ? pChi(Q, k - 1) : 1, props: Cj.map(c => c / M.length), n: M.length };
  }

  // ---------- álgebra para el análisis factorial ----------
  const matMul = (A, B) => A.map(r => B[0].map((_, j) => { let s = 0; for (let k = 0; k < r.length; k++) s += r[k] * B[k][j]; return s; }));
  const tr = A => A[0].map((_, j) => A.map(r => r[j]));
  const ident = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  function eigSym(A0) { // Jacobi para matrices simétricas: valores propios en orden decreciente y vectores en columnas
    const n = A0.length, A = A0.map(r => r.slice()), V = ident(n);
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
    const ord = A.map((r, i) => i).sort((a, b) => A[b][b] - A[a][a]);
    return { values: ord.map(i => A[i][i]), vectors: V.map(r => ord.map(i => r[i])) };
  }
  function corMatrix(X) { // X: n × p
    const p = X[0].length, cols = Array.from({ length: p }, (_, j) => X.map(r => r[j]));
    return cols.map((a, i) => cols.map((b, j) => (i === j ? 1 : pearson(a, b).r)));
  }
  function kmoBartlett(R, n) {
    const p = R.length, Ri = inv(R); if (!Ri) return null;
    const A = R.map((r, i) => r.map((_, j) => -Ri[i][j] / Math.sqrt(Ri[i][i] * Ri[j][j])));
    let r2 = 0, a2 = 0; const msa = [];
    for (let i = 0; i < p; i++) { let ri = 0, ai = 0; for (let j = 0; j < p; j++) if (i !== j) { ri += R[i][j] ** 2; ai += A[i][j] ** 2; } msa.push(ri / (ri + ai)); r2 += ri; a2 += ai; }
    const ld = eigSym(R).values.reduce((s, v) => s + Math.log(v), 0), chi = -((n - 1) - (2 * p + 5) / 6) * ld, df = p * (p - 1) / 2;
    return { kmo: r2 / (r2 + a2), msa, bartlett: { chi, df, p: pChi(chi, df) } };
  }
  function paFactor(R, m, minErr = 0.001, maxIter = 50) { // ejes principales, con el mismo criterio de parada que psych::fa(fm = "pa")
    const p = R.length, Ri = inv(R), M = R.map(r => r.slice());
    for (let i = 0; i < p; i++) M[i][i] = Ri ? 1 - 1 / Ri[i][i] : 1;           // comunalidades iniciales: correlación múltiple al cuadrado
    let comm = M.reduce((s, r, i) => s + r[i], 0), err = comm, L = null, it = 0;
    while (err > minErr && it < maxIter) {
      const e = eigSym(M); L = M.map((_, i) => Array.from({ length: m }, (_, j) => e.vectors[i][j] * Math.sqrt(Math.max(e.values[j], 0))));
      const nw = L.map(r => sum(r.map(v => v * v))), c1 = sum(nw);
      nw.forEach((v, i) => M[i][i] = v); err = Math.abs(comm - c1); comm = c1; it++;
    }
    return { L, iter: it, converged: err <= minErr };
  }
  function svdSmall(B) { // B cuadrada pequeña: B = U diag(d) V'
    const e = eigSym(matMul(tr(B), B)), V = e.vectors, d = e.values.map(v => Math.sqrt(Math.max(v, 0)));
    const BV = matMul(B, V), U = BV.map(r => r.map((v, j) => (d[j] > 1e-15 ? v / d[j] : 0)));
    return { U, d, V };
  }
  function varimax(L0, eps = 1e-5) { // como stats::varimax de R (normalización de Kaiser)
    const p = L0.length, m = L0[0].length; if (m < 2) return { L: L0, T: ident(m) };
    const sc = L0.map(r => Math.sqrt(sum(r.map(v => v * v)))), x = L0.map((r, i) => r.map(v => v / sc[i]));
    let TT = ident(m), d = 0;
    for (let it = 0; it < 1000; it++) {
      const z = matMul(x, TT), cs = Array.from({ length: m }, (_, j) => sum(z.map(r => r[j] ** 2)) / p);
      const B = matMul(tr(x), z.map(r => r.map((v, j) => v ** 3 - v * cs[j]))), s = svdSmall(B);
      TT = matMul(s.U, tr(s.V)); const dp = d; d = sum(s.d); if (d < dp * (1 + eps)) break;
    }
    return { L: matMul(x, TT).map((r, i) => r.map(v => v * sc[i])), T: TT };
  }
  function oblimin(A, eps = 1e-5, maxit = 1000) { // GPArotation::GPFoblq con criterio oblimin (gamma = 0, sin normalizar)
    const m = A[0].length; if (m < 2) return { L: A, Phi: [[1]] };
    const vgQ = L => { const L2 = L.map(r => r.map(v => v * v)), X = L2.map(r => r.map((_, j) => sum(r) - r[j]));
      return { Gq: L.map((r, i) => r.map((v, j) => v * X[i][j])), f: sum(L2.map((r, i) => sum(r.map((v, j) => v * X[i][j])))) / 4 }; };
    let T = ident(m), Ti = inv(T), L = matMul(A, tr(Ti)), V = vgQ(L);
    let G = tr(matMul(matMul(tr(L), V.Gq), Ti)).map(r => r.map(v => -v)), f = V.f, al = 1;
    for (let it = 0; it <= maxit; it++) {
      const cs = Array.from({ length: m }, (_, j) => sum(T.map((r, i) => r[j] * G[i][j])));
      const Gp = G.map((r, i) => r.map((v, j) => v - T[i][j] * cs[j])), s = Math.sqrt(sum(Gp.map(r => sum(r.map(v => v * v)))));
      if (s < eps) break;
      al *= 2; let Tt, Lt, Vt;
      for (let i = 0; i <= 10; i++) {
        const X = T.map((r, a) => r.map((v, b) => v - al * Gp[a][b])), v = Array.from({ length: m }, (_, j) => 1 / Math.sqrt(sum(X.map(r => r[j] ** 2))));
        Tt = X.map(r => r.map((x, j) => x * v[j])); Lt = matMul(A, tr(inv(Tt))); Vt = vgQ(Lt);
        if (f - Vt.f > .5 * s * s * al) break; al /= 2;
      }
      T = Tt; f = Vt.f; L = Lt; G = tr(matMul(matMul(tr(Lt), Vt.Gq), inv(Tt))).map(r => r.map(v => -v));
    }
    return { L, Phi: matMul(tr(T), T) };
  }
  function efa(X, m, rotation = 'oblimin') { // X: n × p casos completos
    const n = X.length, R = corMatrix(X), adec = kmoBartlett(R, n), eig = eigSym(R).values;
    const ext = paFactor(R, m); let L = ext.L, Phi = ident(m);
    if (m > 1) { if (rotation === 'varimax') L = varimax(L).L; else if (rotation === 'oblimin') { const o = oblimin(L); L = o.L; Phi = o.Phi; } }
    // como psych: factores ordenados por varianza explicada y con signo positivo de la suma de cargas
    const ev = Array.from({ length: m }, (_, j) => { const LtL = matMul(tr(L), L), PL = matMul(Phi, LtL); return PL[j][j]; });
    const ord = ev.map((v, j) => j).sort((a, b) => ev[b] - ev[a]);
    L = L.map(r => ord.map(j => r[j])); Phi = ord.map(a => ord.map(b => Phi[a][b]));
    const sg = Array.from({ length: m }, (_, j) => (sum(L.map(r => r[j])) < 0 ? -1 : 1));
    L = L.map(r => r.map((v, j) => v * sg[j])); Phi = Phi.map((r, a) => r.map((v, b) => v * sg[a] * sg[b]));
    const LPL = matMul(matMul(L, Phi), tr(L)), h2 = LPL.map((r, i) => r[i]), p = R.length;
    const ss = Array.from({ length: m }, (_, j) => matMul(Phi, matMul(tr(L), L))[j][j]);
    let rms = 0; for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) if (i !== j) rms += (R[i][j] - LPL[i][j]) ** 2;
    return { L, Phi, h2, u2: h2.map(v => 1 - v), ss, prop: ss.map(v => v / p), adec, eig, n, p, m, rotation, rmsr: Math.sqrt(rms / (p * (p - 1))), converged: ext.converged };
  }
  function parallelAnalysis(n, p, eigObs, reps = 100, seed = 20261015) { // Horn con autovalores de componentes y percentil 95
    let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const nr = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const sims = Array.from({ length: p }, () => []);
    for (let r = 0; r < reps; r++) { const X = Array.from({ length: n }, () => Array.from({ length: p }, nr)); eigSym(corMatrix(X)).values.forEach((v, j) => sims[j].push(v)); }
    const p95 = sims.map(a => quantile(sorted(a), .95)); let k = 0; while (k < p && eigObs[k] > p95[k]) k++;
    return { p95, nfactors: k };
  }
  function omegaTotal(X) { // ω de McDonald a partir de un modelo de un factor (ejes principales)
    const R = corMatrix(X), l = paFactor(R, 1).L.map(r => r[0]), sl = sum(l) * (sum(l) < 0 ? -1 : 1), u = sum(l.map(v => 1 - v * v));
    return { omega: sl * sl / (sl * sl + u), loadings: l.map(v => v * (sum(l) < 0 ? -1 : 1)) };
  }

  // ---------- moderación (modelo 1 de PROCESS) ----------
  function moderation(y, x, w, C, centerX, centerW) { // C: n × q covariables (opcional)
    const mx = centerX ? mean(x) : 0, mw = centerW ? mean(w) : 0, xc = x.map(v => v - mx), wc = w.map(v => v - mw);
    const row = i => [1, xc[i], wc[i], xc[i] * wc[i]].concat(C ? C[i] : []);
    const X = y.map((_, i) => row(i)), full = ols(X, y); if (!full) return null;
    const red = olsCore(X.map(r => r.filter((_, k) => k !== 3)), y);
    const dR2 = full.r2 - red.r2, Fch = dR2 / ((1 - full.r2) / full.dfr);
    const V = full.Ai.map(r => r.map(v => v * full.s2)), tc = tcrit(full.dfr), b1 = full.b[1], b3 = full.b[3];
    const slope = wRaw => { const wv = wRaw - mw, b = b1 + b3 * wv, se = Math.sqrt(V[1][1] + wv * wv * V[3][3] + 2 * wv * V[1][3]), t = b / se;
      return { w: wRaw, b, se, t, p: pT(t, full.dfr), ci: [b - tc * se, b + tc * se] }; };
    // Johnson-Neyman: valores del moderador donde el efecto de X pasa a ser (o deja de ser) significativo
    const A = b3 * b3 - tc * tc * V[3][3], B = 2 * (b1 * b3 - tc * tc * V[1][3]), Cq = b1 * b1 - tc * tc * V[1][1], disc = B * B - 4 * A * Cq;
    const jn = disc >= 0 && A !== 0 ? [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)].map(v => v + mw).sort((a, b) => a - b) : [];
    return { b: full.b, se: full.se, t: full.t, p: full.pv, ci: full.ci, r2: full.r2, F: full.F, df1: full.df1, dfr: full.dfr, pF: full.pF,
      dR2, Fch, pch: pF(Fch, 1, full.dfr), slope, jn, mx, mw, resid: full.e, bp: full.bp, n: y.length };
  }

  // ---------- mediación simple (modelo 4 de PROCESS) con bootstrap ----------
  function mediation(y, x, m, B = 5000, seed = 20261015) {
    const n = y.length, c1 = x.map(v => [1, v]), c2 = x.map((v, i) => [1, v, m[i]]);
    const fa = ols(c1, m), fb = ols(c2, y), fc = ols(c1, y); if (!fa || !fb || !fc) return null;
    const a = fa.b[1], b = fb.b[2], cp = fb.b[1], c = fc.b[1], ab = a * b;
    const sobelSe = Math.sqrt(b * b * fa.se[1] ** 2 + a * a * fb.se[2] ** 2), sobelZ = ab / sobelSe;
    let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const boot = [];
    for (let r = 0; r < B; r++) {
      const idx = Array.from({ length: n }, () => Math.floor(rnd() * n));
      const ra = olsCore(idx.map(i => c1[i]), idx.map(i => m[i])), rb = olsCore(idx.map(i => c2[i]), idx.map(i => y[i]));
      if (ra && rb) boot.push(ra.b[1] * rb.b[2]);
    }
    const bs = sorted(boot), ci = [quantile(bs, .025), quantile(bs, .975)], sdy = sd(y), sdx = sd(x);
    return { a, b, c, cp, ab, se: { a: fa.se[1], b: fb.se[2], c: fc.se[1], cp: fb.se[1] }, p: { a: fa.pv[1], b: fb.pv[2], c: fc.pv[1], cp: fb.pv[1] },
      t: { a: fa.t[1], b: fb.t[2], c: fc.t[1], cp: fb.t[1] }, dfa: fa.dfr, dfb: fb.dfr, dfc: fc.dfr, ci, bootSe: sd(boot), B: boot.length,
      sobel: { z: sobelZ, p: pZ(sobelZ) }, abStd: ab * sdx / sdy, r2m: fa.r2, r2y: fb.r2, n };
  }

  // ---------- optimización sin derivadas (Nelder-Mead) ----------
  function nelderMead(fn, x0, step = 0.5, tol = 1e-10, maxit = 4000) {
    const n = x0.length; let pts = [x0.slice()].concat(x0.map((_, i) => { const p = x0.slice(); p[i] += step * (Math.abs(p[i]) || 1); return p; }));
    let vals = pts.map(fn);
    for (let it = 0; it < maxit; it++) {
      const ord = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]); pts = ord.map(i => pts[i]); vals = ord.map(i => vals[i]);
      if (Math.abs(vals[n] - vals[0]) <= tol * (Math.abs(vals[0]) + tol)) break;
      const c = Array.from({ length: n }, (_, j) => sum(pts.slice(0, n).map(p => p[j])) / n), mv = (a, b, t) => a.map((v, j) => v + t * (b[j] - v));
      const xr = mv(c, pts[n], -1), fr = fn(xr);
      if (fr < vals[0]) { const xe = mv(c, pts[n], -2), fe = fn(xe); if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; } }
      else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
      else { const xc = mv(c, pts[n], fr < vals[n] ? -.5 : .5), fc = fn(xc);
        if (fc < Math.min(fr, vals[n])) { pts[n] = xc; vals[n] = fc; }
        else for (let i = 1; i <= n; i++) { pts[i] = mv(pts[0], pts[i], .5); vals[i] = fn(pts[i]); } }
    }
    return { x: pts[0], f: vals[0] };
  }

  // ---------- modelo lineal mixto (REML), como lme4 + lmerTest ----------
  // X: n × p (con constante); g: grupo de cada fila; zcol: columna de X con pendiente aleatoria (−1 = solo intercepto)
  function lmm(y, X, g, zcol = -1) {
    const N = y.length, p = X[0].length, q = zcol >= 0 ? 2 : 1, ids = [...new Set(g)];
    const G = ids.map(id => { const rows = []; g.forEach((v, i) => { if (v === id) rows.push(i); }); return { X: rows.map(i => X[i]), y: rows.map(i => y[i]), Z: rows.map(i => (q === 2 ? [1, X[i][zcol]] : [1])) }; });
    const Lam = th => (q === 1 ? [[Math.abs(th[0])]] : [[Math.abs(th[0]), 0], [th[1], Math.abs(th[2])]]);
    function parts(th) { // por grupo, con la identidad de Woodbury: M = I + A A', A = Z Λ (dimensión q)
      const L = Lam(th), XtWX = Array.from({ length: p }, () => new Array(p).fill(0)), XtWy = new Array(p).fill(0); let logdet = 0; const cache = [];
      for (const gr of G) {
        const A = gr.Z.map(z => L[0].map((_, c) => sum(z.map((zv, k) => zv * L[k][c])))), K = ident(q);
        A.forEach(a => { for (let r = 0; r < q; r++) for (let c = 0; c < q; c++) K[r][c] += a[r] * a[c]; });
        const Ki = inv(K); logdet += Math.log(Math.abs(det(K)));
        const Winv = v => { const At = L[0].map((_, c) => sum(A.map((a, i) => a[c] * v[i]))), u = Ki.map(r => sum(r.map((x, k) => x * At[k]))); return v.map((x, i) => x - sum(A[i].map((a, k) => a * u[k]))); };
        const Wy = Winv(gr.y), WX = Array.from({ length: p }, (_, c) => Winv(gr.X.map(r => r[c])));
        for (let a = 0; a < p; a++) { XtWy[a] += sum(gr.X.map((r, i) => r[a] * Wy[i])); for (let b = 0; b < p; b++) XtWX[a][b] += sum(gr.X.map((r, i) => r[a] * WX[b][i])); }
        cache.push({ Winv });
      }
      const XtWXi = inv(XtWX); if (!XtWXi) return null;
      const beta = XtWXi.map(r => sum(r.map((v, k) => v * XtWy[k])));
      let rq = 0; G.forEach((gr, k) => { const r = gr.y.map((v, i) => v - sum(gr.X[i].map((x, j) => x * beta[j]))), Wr = cache[k].Winv(r); rq += sum(r.map((v, i) => v * Wr[i])); });
      return { beta, XtWXi, logdet, logdetX: Math.log(det(XtWX)), rq };
    }
    const dev = th => { const P = parts(th); if (!P) return 1e300; const s2 = P.rq / (N - p); return (N - p) * (1 + Math.log(2 * Math.PI * s2)) + P.logdet + P.logdetX; };
    let best = null;
    for (const start of (q === 1 ? [[1], [0.3], [3]] : [[1, 0, 1], [0.5, 0, 0.2], [2, 0, 0.5]])) { const r = nelderMead(dev, start); if (!best || r.f < best.f) best = r; }
    const th = best.x, P = parts(th), s2 = P.rq / (N - p), L = Lam(th);
    const Tau = L.map(r => L.map(c => s2 * sum(r.map((v, k) => v * c[k])))), cov = P.XtWXi.map(r => r.map(v => v * s2));
    // Satterthwaite: desviación REML sin perfilar en φ = (θ, σ²); Cov(φ) ≈ 2 H⁻¹
    const D = ph => { const Q = parts(ph.slice(0, -1)); if (!Q) return 1e300; const sg = ph[ph.length - 1]; return (N - p) * Math.log(sg) + Q.logdet + Q.logdetX + Q.rq / sg; };
    const phi = th.map(Math.abs).map((v, k) => (q === 2 && k === 1 ? th[1] : v)).concat([s2]), np = phi.length, hs = phi.map(v => 1e-4 * Math.max(Math.abs(v), 1e-2));
    const H = Array.from({ length: np }, () => new Array(np).fill(0));
    for (let a = 0; a < np; a++) for (let b = a; b < np; b++) {
      const e = (da, db) => { const v = phi.slice(); v[a] += da; v[b] += db; return D(v); };
      H[a][b] = H[b][a] = a === b ? (e(hs[a], 0) - 2 * D(phi) + e(-hs[a], 0)) / (hs[a] * hs[a]) : (e(hs[a], hs[b]) - e(hs[a], -hs[b]) - e(-hs[a], hs[b]) + e(-hs[a], -hs[b])) / (4 * hs[a] * hs[b]);
    }
    const Hi = inv(H), Acov = Hi ? Hi.map(r => r.map(v => 2 * v)) : null;
    const varB = (ph, j) => { const Q = parts(ph.slice(0, -1)); return Q ? ph[ph.length - 1] * Q.XtWXi[j][j] : NaN; };
    const se = cov.map((r, j) => Math.sqrt(r[j])), df = se.map((_, j) => {
      if (!Acov) return NaN; const f0 = varB(phi, j), gr = phi.map((_, k) => { const a = phi.slice(), b = phi.slice(); a[k] += hs[k]; b[k] -= hs[k]; return (varB(a, j) - varB(b, j)) / (2 * hs[k]); });
      const den = sum(gr.map((x, a) => sum(gr.map((z, b) => x * Acov[a][b] * z)))); return 2 * f0 * f0 / den; });
    const t = P.beta.map((b, j) => b / se[j]), pv = t.map((v, j) => (isFinite(df[j]) && df[j] > 0 ? pT(v, df[j]) : pZ(v)));
    const ci = P.beta.map((b, j) => { const tc = isFinite(df[j]) && df[j] > 0 ? tcrit(df[j]) : 1.959964; return [b - tc * se[j], b + tc * se[j]]; });
    // R² de Nakagawa (varianza de los efectos fijos, de los aleatorios y residual)
    const fit = X.map(r => sum(r.map((v, k) => v * P.beta[k]))), vf = variance(fit);
    const vr = q === 1 ? Tau[0][0] : mean(X.map(r => { const z = [1, r[zcol]]; return sum(z.map((a, i) => sum(z.map((b, j) => a * Tau[i][j] * b)))); }));
    // residuos condicionales: y − Xβ − Zb, con b = Λ (I + A'A)⁻¹ A' r (predicción BLUP de cada grupo)
    const resid = new Array(N); let gi = 0;
    ids.forEach(id => { const rows = []; g.forEach((v, i) => { if (v === id) rows.push(i); }); const gr = G[gi++];
      const A = gr.Z.map(z => L[0].map((_, c) => sum(z.map((zv, k) => zv * L[k][c])))), K = ident(q);
      A.forEach(a => { for (let r = 0; r < q; r++) for (let c = 0; c < q; c++) K[r][c] += a[r] * a[c]; });
      const r = rows.map(i => y[i] - fit[i]), At = L[0].map((_, c) => sum(A.map((a, i) => a[c] * r[i]))), u = inv(K).map(row => sum(row.map((x, k) => x * At[k])));
      const bvec = L.map(row => sum(row.map((x, k) => x * u[k])));
      rows.forEach((i, k) => { resid[i] = r[k] - sum(gr.Z[k].map((z, j) => z * bvec[j])); }); });
    return { beta: P.beta, se, df, t, p: pv, ci, s2, Tau, ngroups: ids.length, N, reml: best.f, singular: Math.abs(th[0]) < 1e-4 || (q === 2 && Math.abs(th[2]) < 1e-4),
      r2m: vf / (vf + vr + s2), r2c: (vf + vr) / (vf + vr + s2), corRE: q === 2 ? Tau[0][1] / Math.sqrt(Tau[0][0] * Tau[1][1]) : null,
      icc: q === 1 ? Tau[0][0] / (Tau[0][0] + s2) : null, resid };
  }

  // ---------- análisis factorial confirmatorio (ML), como lavaan::cfa ----------
  // X: n × p (casos completos); factores: lista de listas de índices de columna (cada ítem en un solo factor; el primero, marcador = 1)
  function ncChisqCdf(x, df, ncp) { // ji-cuadrado no central (mezcla de Poisson)
    if (ncp <= 0) return J.chisquare.cdf(x, df);
    const h = ncp / 2, j0 = Math.floor(h); let s = 0;
    const term = j => Math.exp(-h + j * Math.log(h) - lfact(j)) * J.chisquare.cdf(x, df + 2 * j);
    for (let j = j0; j < j0 + 2000; j++) { const t = term(j); s += t; if (t < 1e-14 && j > j0 + 10) break; }
    for (let j = j0 - 1; j >= 0; j--) { const t = term(j); s += t; if (t < 1e-14) break; }
    return s;
  }
  function cfa(X, factores) {
    const N = X.length, p = X[0].length, m = factores.length, cm = Array.from({ length: p }, (_, j) => mean(X.map(r => r[j])));
    const S = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => sum(X.map(r => (r[a] - cm[a]) * (r[b] - cm[b]))) / N)); // como lavaan (likelihood = "normal")
    const fac = new Array(p).fill(-1); factores.forEach((it, k) => it.forEach(j => fac[j] = k));
    // parámetros: cargas libres, varianzas y covarianzas de los factores, varianzas residuales
    const P = [];
    factores.forEach((it, k) => it.slice(1).forEach(j => P.push({ t: 'l', j, k })));
    for (let k = 0; k < m; k++) for (let l = 0; l <= k; l++) P.push({ t: 'f', k, l });
    for (let j = 0; j < p; j++) P.push({ t: 'u', j });
    const build = th => {
      const L = Array.from({ length: p }, () => new Array(m).fill(0)), Phi = Array.from({ length: m }, () => new Array(m).fill(0)), Psi = new Array(p).fill(0);
      factores.forEach((it, k) => L[it[0]][k] = 1);
      P.forEach((q, i) => { if (q.t === 'l') L[q.j][q.k] = th[i]; else if (q.t === 'f') Phi[q.k][q.l] = Phi[q.l][q.k] = th[i]; else Psi[q.j] = th[i]; });
      const Sig = matMul(matMul(L, Phi), tr(L)).map((r, a) => r.map((v, b) => v + (a === b ? Psi[a] : 0)));
      return { L, Phi, Psi, Sig };
    };
    const ldS = Math.log(det(S));
    const F = th => { const { Sig } = build(th), d = det(Sig); if (!(d > 0)) return 1e10; const Si = inv(Sig); if (!Si) return 1e10;
      return Math.log(d) + sum(S.map((r, a) => sum(r.map((v, b) => v * Si[b][a])))) - ldS - p; };
    const grad = th => { const { L, Phi, Sig } = build(th), Si = inv(Sig), D = Sig.map((r, a) => r.map((v, b) => v - S[a][b]));
      const Om = matMul(matMul(Si, D), Si), OL = matMul(Om, L), LOL = matMul(tr(L), OL), OLP = matMul(OL, Phi);
      return P.map(q => (q.t === 'l' ? 2 * OLP[q.j][q.k] : q.t === 'f' ? (q.k === q.l ? LOL[q.k][q.k] : 2 * LOL[q.k][q.l]) : Om[q.j][q.j])); };
    // valores iniciales
    const th0 = P.map(q => { if (q.t === 'u') return S[q.j][q.j] / 2;
      const it = factores[q.t === 'l' ? q.k : q.k], mk = it[0];
      if (q.t === 'l') return S[q.j][mk] / Math.max(S[mk][mk] / 2, 1e-6);
      if (q.k === q.l) return S[mk][mk] / 2; return 0; });
    // BFGS con búsqueda lineal por retroceso
    let th = th0.slice(), f0 = F(th), g = grad(th), Hn = ident(P.length), conv = false, it = 0;
    for (; it < 2000; it++) {
      const d = Hn.map(r => -sum(r.map((v, k) => v * g[k]))); let a = 1, th1, f1;
      const slope = sum(d.map((v, k) => v * g[k])); if (slope >= 0) { Hn = ident(P.length); continue; }
      for (let k = 0; k < 60; k++) { th1 = th.map((v, i) => v + a * d[i]); f1 = F(th1); if (f1 <= f0 + 1e-4 * a * slope) break; a /= 2; }
      const g1 = grad(th1), s = th1.map((v, i) => v - th[i]), yv = g1.map((v, i) => v - g[i]), sy = sum(s.map((v, i) => v * yv[i]));
      if (sy > 1e-12) { const Hy = Hn.map(r => sum(r.map((v, k) => v * yv[k]))), yHy = sum(yv.map((v, i) => v * Hy[i]));
        Hn = Hn.map((r, i) => r.map((v, j) => v + (sy + yHy) * s[i] * s[j] / (sy * sy) - (Hy[i] * s[j] + s[i] * Hy[j]) / sy)); }
      const df_ = Math.abs(f0 - f1); th = th1; f0 = f1; g = g1;
      if (Math.max(...g.map(Math.abs)) < 1e-9 || (df_ < 1e-14 && Math.max(...g.map(Math.abs)) < 1e-6)) { conv = true; break; }
    }
    const B = build(th), Si = inv(B.Sig);
    // errores típicos con la información esperada: I_ab = ½ tr(Σ⁻¹ ∂Σ/∂a Σ⁻¹ ∂Σ/∂b)
    const dS = P.map((_, i) => { const h = 1e-6 * Math.max(1, Math.abs(th[i])), a = th.slice(), b = th.slice(); a[i] += h; b[i] -= h; const A = build(a).Sig, Bm = build(b).Sig; return A.map((r, x) => r.map((v, y) => (v - Bm[x][y]) / (2 * h))); });
    const SdS = dS.map(D => matMul(Si, D));
    const I = P.map((_, a) => P.map((__, b) => .5 * sum(SdS[a].map((r, x) => sum(r.map((v, y) => v * SdS[b][y][x])))) * N));
    const Ii = inv(I), se = Ii ? Ii.map((r, i) => Math.sqrt(r[i])) : P.map(() => NaN);
    const chi = N * f0, df = p * (p + 1) / 2 - P.length, pval = df > 0 ? pChi(chi, df) : NaN;
    const chiB = N * (sum(S.map((r, i) => Math.log(r[i]))) - ldS), dfB = p * (p - 1) / 2;
    const cfi = 1 - Math.max(chi - df, 0) / Math.max(chiB - dfB, chi - df, 1e-12), tli = df > 0 ? ((chiB / dfB) - (chi / df)) / ((chiB / dfB) - 1) : NaN;
    const rmsea = df > 0 ? Math.sqrt(Math.max(0, (chi - df) / (N * df))) : NaN;
    const ncpAt = target => { if (ncChisqCdf(chi, df, 0) < target) return 0; let lo = 0, hi = Math.max(10, chi * 4); while (ncChisqCdf(chi, df, hi) > target) hi *= 2;
      for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (ncChisqCdf(chi, df, mid) > target) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    const rmseaCI = df > 0 ? [Math.sqrt(ncpAt(.95) / (N * df)), Math.sqrt(ncpAt(.05) / (N * df))] : [NaN, NaN];
    let srs = 0, cnt = 0; for (let a = 0; a < p; a++) for (let b = 0; b <= a; b++) { srs += ((S[a][b] - B.Sig[a][b]) / Math.sqrt(S[a][a] * S[b][b])) ** 2; cnt++; }
    const srmr = Math.sqrt(srs / cnt);
    const est = P.map((q, i) => ({ ...q, est: th[i], se: se[i], z: th[i] / se[i], p: pZ(th[i] / se[i]) }));
    const std = Array.from({ length: p }, (_, j) => B.L[j][fac[j]] * Math.sqrt(B.Phi[fac[j]][fac[j]]) / Math.sqrt(B.Sig[j][j]));
    const facCor = B.Phi.map((r, k) => r.map((v, l) => v / Math.sqrt(B.Phi[k][k] * B.Phi[l][l])));
    const rel = factores.map((it, k) => { const sl = sum(it.map(j => Math.abs(B.L[j][k]))) ** 2 * B.Phi[k][k], su = sum(it.map(j => B.Psi[j])); // |λ|: los ítems inversos cuentan como recodificados
      return { omega: sl / (sl + su), ave: mean(it.map(j => std[j] ** 2)) }; });
    return { N, p, m, est, L: B.L, Phi: B.Phi, Psi: B.Psi, std, facCor, rel, chi, df, pval, cfi, tli, rmsea, rmseaCI, srmr, chiB, dfB, conv, iter: it,
      heywood: B.Psi.map((v, j) => v < 0 ? j : -1).filter(j => j >= 0) };
  }

  root.TharpStats = { cronbach, logistic, anova2, sum, mean, variance, sd, median, quantile, sorted, skewness, kurtosis, ranks, describe, meanCI, holm,
    shapiro, anova, levene, welchAnova, tTestInd, mannWhitney, kruskal, dunn, tukeyHSD, gamesHowell, pairwiseHolm, hasTukey,
    tTestPaired, tTestOne, wilcoxonOne, wilcoxonSigned, rmAnova, mixedAnova, friedman, ancova, mcnemar, cochranQ, binomTwoSided, efa, parallelAnalysis, omegaTotal, kmoBartlett, corMatrix, eigSym, moderation, mediation, lmm, nelderMead, cfa, ncChisqCdf, pearson, spearman, fisher2x2, chiSquare, ols, olsCore, tcrit, pT, pF, pnct, ncpCI };
})(typeof window !== 'undefined' ? window : this);
