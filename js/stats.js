/* Tharp — motor estadístico (se ejecuta en el navegador; requiere jStat) */
(function (root) {
  'use strict';
  // mínimo y máximo sin «Math.min(...a)», que desborda la pila con decenas de miles de valores; mismo resultado (NaN si hay NaN; ±Infinity si está vacío)
  const minOf = a => { let m = Infinity; for (const v of a) { if (v !== v) return NaN; if (v < m) m = v; } return m; };
  const maxOf = a => { let m = -Infinity; for (const v of a) { if (v !== v) return NaN; if (v > m) m = v; } return m; };
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
  // Kolmogorov-Smirnov con la corrección de Lilliefors (p de Dallal y Wilkinson, 1986, y Stephens, como nortest::lillie.test)
  function lilliefors(xIn) {
    const x = xIn.slice().sort((a, b) => a - b), n = x.length; if (n < 5) return null;
    const m = mean(x), s = sd(x); if (!(s > 0)) return null;
    let K = 0; x.forEach((v, i) => { const p = J.normal.cdf((v - m) / s, 0, 1); K = Math.max(K, (i + 1) / n - p, p - i / n); });
    let Kd = K, nd = n; if (n > 100) { Kd = K * Math.pow(n / 100, .49); nd = 100; }
    let pv = Math.exp(-7.01256 * Kd * Kd * (nd + 2.78019) + 2.99587 * Kd * Math.sqrt(nd + 2.78019) - .122119 + .974598 / Math.sqrt(nd) + 1.67997 / nd);
    if (pv > .1) { const KK = (Math.sqrt(n) - .01 + .85 / Math.sqrt(n)) * K;
      pv = KK <= .302 ? 1 : KK <= .5 ? 2.76773 - 19.828315 * KK + 80.709644 * KK ** 2 - 138.55152 * KK ** 3 + 81.218052 * KK ** 4
        : KK <= .9 ? -4.901232 + 40.662806 * KK - 97.490286 * KK ** 2 + 94.029866 * KK ** 3 - 32.355711 * KK ** 4
        : KK <= 1.31 ? 6.198765 - 19.558097 * KK + 23.186922 * KK ** 2 - 10.611969 * KK ** 3 + 1.484217 * KK ** 4 : 0; }
    return { D: K, p: Math.max(0, Math.min(1, pv)) };
  }
  // errores típicos de la asimetría y la curtosis (como SPSS)
  const seSkew = n => Math.sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)));
  const seKurt = n => 2 * seSkew(n) * Math.sqrt((n * n - 1) / ((n - 3) * (n + 5)));
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
  // ---------- comparaciones múltiples a elegir (como SPSS/JASP/jamovi) ----------
  // métodos con el error combinado del ANOVA (MCE): lsd, bonferroni, holm, sidak, scheffe; Tamhane T2 (Welch + Šidák)
  function posthocMethod(groups, msw, dfw, method) {
    const k = groups.length, m = k * (k - 1) / 2, out = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      const a = groups[i], b = groups[j], diff = mean(a) - mean(b);
      if (method === 'tamhane') { const r = tTestInd(a, b, false); out.push({ i, j, diff, t: r.t, df: r.df, p: r.p, se: r.se }); continue; }
      const se = Math.sqrt(msw * (1 / a.length + 1 / b.length)), t = diff / se;
      out.push({ i, j, diff, t, df: dfw, se, p: pT(t, dfw), F: t * t / (k - 1) });
    }
    if (method === 'bonferroni') out.forEach(c => { c.padj = Math.min(1, c.p * m); });
    else if (method === 'holm') { const a = holm(out.map(c => c.p)); out.forEach((c, q) => { c.padj = a[q]; }); }
    else if (method === 'sidak' || method === 'tamhane') out.forEach(c => { c.padj = 1 - Math.pow(1 - c.p, m); });
    else if (method === 'scheffe') out.forEach(c => { c.padj = pF(c.F, k - 1, dfw); });
    // GT2 de Hochberg y Gabriel: módulo máximo estudentizado con m comparaciones (Gabriel cambia el error típico para tamaños distintos)
    else if (method === 'gt2' || method === 'gabriel') out.forEach(c => { const a = groups[c.i].length, b = groups[c.j].length;
      c.stat = method === 'gt2' ? Math.abs(c.t) : Math.abs(c.diff) / (Math.sqrt(msw) * (1 / Math.sqrt(2 * a) + 1 / Math.sqrt(2 * b)));
      c.padj = Math.min(1, Math.max(0, 1 - smmCdf(c.stat, m, dfw))); });
    else out.forEach(c => { c.padj = c.p; }); // lsd: sin corrección
    return out;
  }
  // módulo máximo estudentizado: P(max |Ti| ≤ c) para m t independientes con gl comunes (Dunnett con correlaciones nulas)
  const smmCdf = (c, m, nu) => dunnettProb(c, new Array(m).fill(0), nu);
  // pruebas de rango por pasos (como PMCMRplus::snkTest y duncanTest; REGWQ con los niveles de Ryan-Einot-Gabriel-Welsch):
  // q de rango estudentizado con r = medias abarcadas; SNK con el error de Tukey-Kramer y Duncan y REGWQ con la media armónica de los n (como SPSS)
  function stepwisePH(groups, msw, dfw, method, alpha = .05) {
    const k = groups.length, n = groups.map(g => g.length), m = groups.map(mean), nh = k / sum(n.map(x => 1 / x));
    const ord = m.map((_, i) => i).sort((a, b) => m[b] - m[a] || a - b), pos = []; ord.forEach((g, q) => { pos[g] = q; });
    const out = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      const r = Math.abs(pos[i] - pos[j]) + 1, diff = m[i] - m[j], se = method === 'snk' ? Math.sqrt(msw / 2 * (1 / n[i] + 1 / n[j])) : Math.sqrt(msw / nh);
      const q = Math.abs(diff) / se, raw = Math.min(1, Math.max(0, 1 - J.tukey.cdf(q, r, dfw)));
      const p = method === 'duncan' ? Math.min(1, 1 - Math.pow(1 - raw, 1 / (r - 1))) : method === 'regwq' && r < k - 1 ? Math.min(1, 1 - Math.pow(1 - raw, k / r)) : raw;
      out.push({ i, j, diff, q, r, p, df: dfw });
    }
    const pOf = (a, b) => out.find(c => (c.i === a && c.j === b) || (c.i === b && c.j === a));
    // regla paso a paso: un par solo difiere si difieren todos los rangos que lo contienen, así que su p es la mayor de esas p
    out.forEach(c => { const lo = Math.min(pos[c.i], pos[c.j]), hi = Math.max(pos[c.i], pos[c.j]); let mx = c.p;
      for (let a = 0; a <= lo; a++) for (let b = hi; b < k; b++) mx = Math.max(mx, pOf(ord[a], ord[b]).p); c.padj = mx; });
    // subconjuntos homogéneos (como SPSS): rachas máximas de medias consecutivas, en orden creciente, cuyo rango no es significativo
    const asc = ord.slice().reverse(), subsets = []; let last = -1;
    for (let a = 0; a < k; a++) { let b = a; while (b + 1 < k && pOf(asc[a], asc[b + 1]).padj >= alpha) b++;
      if (b > last) { subsets.push({ members: asc.slice(a, b + 1), p: b > a ? pOf(asc[a], asc[b]).p : 1 }); last = b; } }
    return { pairs: out, subsets, order: asc, nh };
  }
  // Dunnett: cada grupo frente a un grupo control, con la t multivariante exacta (correlaciones λi·λj)
  function dunnettProb(c, lam, nu) { // P(max |Tj| < c)
    const zN = 241, zs = [], zw = []; for (let q = 0; q < zN; q++) { const z = -8 + 16 * q / (zN - 1); zs.push(z); zw.push((q === 0 || q === zN - 1 ? 1 : q % 2 ? 4 : 2) * (16 / (zN - 1)) / 3 * J.normal.pdf(z, 0, 1)); }
    const inner = s => { let acc = 0; for (let q = 0; q < zN; q++) { let pr = 1; for (const l of lam) { const r = Math.sqrt(1 - l * l); pr *= J.normal.cdf((c * s + l * zs[q]) / r, 0, 1) - J.normal.cdf((-c * s + l * zs[q]) / r, 0, 1); } acc += zw[q] * pr; } return acc; };
    if (!isFinite(nu) || nu > 1e5) return inner(1);
    // densidad de S = sqrt(χ²ν/ν) integrada con Simpson en una ventana amplia alrededor de 1
    const lo = Math.max(1e-6, 1 - 9 / Math.sqrt(nu + 1)), hi = 1 + 9 / Math.sqrt(nu + 1), sN = 241, h = (hi - lo) / (sN - 1);
    const logC = (nu / 2) * Math.log(nu) - (nu / 2 - 1) * Math.LN2 - J.gammaln(nu / 2);
    let tot = 0; for (let q = 0; q < sN; q++) { const s = lo + q * h, w = (q === 0 || q === sN - 1 ? 1 : q % 2 ? 4 : 2) * h / 3;
      tot += w * Math.exp(logC + (nu - 1) * Math.log(s) - nu * s * s / 2) * inner(s); }
    return tot;
  }
  function dunnett(groups, ctrl, msw, dfw, alt = 'two') {
    const n0 = groups[ctrl].length, m0 = mean(groups[ctrl]), idx = groups.map((_, i) => i).filter(i => i !== ctrl);
    const lam = idx.map(i => Math.sqrt(groups[i].length / (groups[i].length + n0)));
    return idx.map(i => { const diff = mean(groups[i]) - m0, se = Math.sqrt(msw * (1 / groups[i].length + 1 / n0)), t = diff / se;
      const padj = Math.min(1, Math.max(0, 1 - dunnettProb(Math.abs(t), lam, dfw)));
      return { i, j: ctrl, diff, se, t, df: dfw, p: pT(t, dfw), padj }; });
  }
  // contrastes planificados sobre las medias de grupo con el MCE del ANOVA (como SPSS «Contrastes» y emmeans::contrast)
  function contrastWeights(k, type) {
    const W = [];
    if (type === 'polynomial') { // polinomios ortogonales con niveles equiespaciados (como contr.poly de R, sin normalizar)
      const x = Array.from({ length: k }, (_, i) => i + 1); let basis = [x.map(() => 1)];
      for (let d = 1; d < Math.min(k, 4); d++) { let v = x.map(xx => xx ** d);
        basis.forEach(bv => { const pr = sum(v.map((q, i) => q * bv[i])) / sum(bv.map(q => q * q)); v = v.map((q, i) => q - pr * bv[i]); });
        basis.push(v);
        // pesos enteros clásicos (−1, 0, 1; 1, −2, 1; −3, −1, 1, 3…), como emmeans y los manuales: no cambian t ni p
        const mn = minOf(v.map(Math.abs).filter(q => q > 1e-9)), wi = v.map(q => Math.round(q / mn * 1e6) / 1e6);
        W.push({ name: ['Lineal', 'Cuadrático', 'Cúbico'][d - 1], w: wi }); }
    } else for (let i = 0; i < k - 1; i++) {
      const w = new Array(k).fill(0);
      if (type === 'helmert') { w[i] = 1; for (let j = i + 1; j < k; j++) w[j] = -1 / (k - i - 1); }
      else if (type === 'difference') { for (let j = 0; j <= i; j++) w[j] = -1 / (i + 1); w[i + 1] = 1; } // reverse Helmert
      else if (type === 'repeated') { w[i] = 1; w[i + 1] = -1; }
      else if (type === 'simple') { w[i + 1] = 1; w[0] = -1; }
      else if (type === 'deviation') { w.fill(-1 / k); w[i + 1] = 1 - 1 / k; }
      W.push({ i, w });
    }
    return W;
  }
  function contrasts(groups, msw, dfw, type) {
    return contrastWeights(groups.length, type).map(c => {
      const est = sum(c.w.map((w, i) => w * mean(groups[i]))), se = Math.sqrt(msw * sum(c.w.map((w, i) => w * w / groups[i].length))), t = est / se;
      return Object.assign(c, { est, se, t, df: dfw, p: pT(t, dfw) }); });
  }
  // ANOVA de Brown-Forsythe para medias (F*), robusta a varianzas distintas
  function brownForsythe(groups) {
    const k = groups.length, n = groups.map(g => g.length), N = sum(n), m = groups.map(mean), v = groups.map(variance), gm = sum(groups.map(g => sum(g))) / N;
    const num = sum(n.map((ni, i) => ni * (m[i] - gm) ** 2)), den = sum(n.map((ni, i) => (1 - ni / N) * v[i]));
    const c = n.map((ni, i) => (1 - ni / N) * v[i] / den), df2 = 1 / sum(c.map((ci, i) => ci * ci / (n[i] - 1))), F = num / den;
    return { F, df1: k - 1, df2, p: pF(F, k - 1, df2) };
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
  // ---------- medidas repetidas con varios factores intrasujeto (y un factor entre sujetos opcional) ----------
  // Y: n × (k1·k2·…) con las casillas ordenadas como en SPSS (el último factor cambia más rápido); kw: niveles de cada factor
  // intrasujeto; g/G: grupo de cada persona (opcional). Cada efecto intrasujeto se contrasta con su propio término de error
  // (contrastes ortonormales de Helmert combinados por producto de Kronecker), como afex/SPSS/JASP.
  function rmFactorial(Y, kw, g = null, G = 1) {
    const n = Y.length, K = Y[0].length, ng = new Array(G).fill(0), gi = g || new Array(n).fill(0); gi.forEach(x => ng[x]++);
    const helm = k => { const C = []; for (let j = 0; j < k - 1; j++) { const v = new Array(k).fill(0), m = j + 1; for (let i = 0; i < m; i++) v[i] = 1; v[m] = -m; const nr = Math.sqrt(m * (m + 1)); C.push(v.map(x => x / nr)); } return C; };
    const kron = (A, B) => { const out = []; A.forEach(a => B.forEach(b => { const r = []; a.forEach(x => b.forEach(z => r.push(x * z))); out.push(r); })); return out; };
    const nf = kw.length, subsets = []; for (let mask = 1; mask < (1 << nf); mask++) subsets.push([...Array(nf).keys()].filter(f => mask & (1 << f)));
    subsets.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
    const dfS = n - G, sm = Y.map(mean), gmS = Array.from({ length: G }, (_, j) => mean(sm.filter((_, i) => gi[i] === j))), grand = mean(sm);
    const ssB = K * sum(ng.map((c, j) => c * (gmS[j] - grand) ** 2)), ssSe = K * sum(sm.map((v, i) => (v - gmS[gi[i]]) ** 2));
    const effects = subsets.map(sub => {
      let M = [[1]]; kw.forEach((k, f) => { M = kron(M, sub.includes(f) ? helm(k) : [new Array(k).fill(1 / Math.sqrt(k))]); });
      const p = M.length, Z = Y.map(r => M.map(c => sum(c.map((w, a) => w * r[a]))));
      const gm = Array.from({ length: G }, (_, j) => M.map((_, c) => mean(Z.filter((_, i) => gi[i] === j).map(z => z[c]))));
      let ssT = 0, ssTG = 0; const E = Array.from({ length: p }, () => new Array(p).fill(0));
      for (let c = 0; c < p; c++) { const u = mean(gm.map(m => m[c])), zbar = mean(Z.map(z => z[c])); ssT += u * u / (sum(ng.map(x => 1 / x)) / (G * G)); ssTG += sum(ng.map((x, j) => x * (gm[j][c] - zbar) ** 2)); }
      Z.forEach((z, i) => { for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) E[a][b] += (z[a] - gm[gi[i]][a]) * (z[b] - gm[gi[i]][b]); });
      const ssE = sum(E.map((r, i) => r[i])), Sg = E.map(r => r.map(v => v / dfS)), tr_ = sum(Sg.map((r, i) => r[i])), tr2 = sum(Sg.map((r, i) => sum(r.map((v, j) => v * Sg[j][i]))));
      const gg = p > 1 ? Math.min(1, tr_ * tr_ / (p * tr2)) : 1, hf = p > 1 ? Math.min(1, ((n - G + 1) * p * gg - 2) / (p * (n - G - p * gg))) : 1;
      let mauchly = null;
      if (p > 1) { const W = det(Sg) / (tr_ / p) ** p, dfm = p * (p + 1) / 2 - 1, nu = dfS, rho = 1 - (2 * p * p + p + 2) / (6 * p * nu);
        const chi = -nu * rho * Math.log(W), w2 = (p + 2) * (p - 1) * (p - 2) * (2 * p ** 3 + 6 * p * p + 3 * p + 2) / (288 * (nu * p * rho) ** 2);
        mauchly = { W, chi, df: dfm, p: pChi(chi, dfm) + w2 * (pChi(chi, dfm + 4) - pChi(chi, dfm)) }; }
      const dfE = p * dfS, mk = (ss, df) => { const F = (ss / df) / (ssE / dfE); return { ss, df, F, p: pF(F, df, dfE), pGG: pF(F, df * gg, dfE * gg), pHF: pF(F, df * hf, dfE * hf), peta2: ss / (ss + ssE) }; };
      return { factors: sub, p, M, ssE, dfE, gg, hf, mauchly, T: mk(ssT, p), TG: G > 1 ? mk(ssTG, (G - 1) * p) : null };
    });
    const errAll = ssSe + sum(effects.map(e => e.ssE));
    effects.forEach(e => { e.T.ges = e.T.ss / (e.T.ss + errAll); if (e.TG) e.TG.ges = e.TG.ss / (e.TG.ss + errAll); });
    const B = G > 1 ? (() => { const F = (ssB / (G - 1)) / (ssSe / dfS); return { ss: ssB, df: G - 1, F, p: pF(F, G - 1, dfS), peta2: ssB / (ssB + ssSe), ges: ssB / (ssB + errAll) }; })() : null;
    // medias marginales de cada factor intrasujeto (promediando grupos sin ponderar) y comparaciones por pares (error propio, Holm)
    const cellIdx = lv => lv.reduce((acc, l, f) => acc * kw[f] + l, 0);
    const marg = f => { const out = []; for (let l = 0; l < kw[f]; l++) { const cols = []; const rec = (f2, lv) => { if (f2 === nf) { if (lv[f] === l) cols.push(cellIdx(lv)); return; } for (let q = 0; q < kw[f2]; q++) rec(f2 + 1, lv.concat([q])); }; rec(0, []);
      out.push(Y.map(r => mean(cols.map(c => r[c])))); } return out; };
    const within = f => { const S_ = marg(f), res = [];
      for (let a = 0; a < kw[f]; a++) for (let b = a + 1; b < kw[f]; b++) { const dI = S_[a].map((v, i) => v - S_[b][i]), gmd = Array.from({ length: G }, (_, j) => mean(dI.filter((_, i) => gi[i] === j)));
        const est = mean(gmd), s2 = sum(dI.map((v, i) => (v - gmd[gi[i]]) ** 2)) / dfS, se = Math.sqrt(s2 * sum(ng.map(x => 1 / x))) / G, t = est / se; res.push({ a, b, est, se, t, df: dfS, p: pT(t, dfS) }); }
      const adj = holm(res.map(o => o.p)); res.forEach((o, q) => { o.padj = adj[q]; }); return { means: S_.map(s => mean(s)), pairs: res }; };
    return { n, G, ng, effects, B, ssSe, dfS, within, cellIdx };
  }
  function friedman(Y) {
    const n = Y.length, k = Y[0].length, R = new Array(k).fill(0); let ties = 0;
    Y.forEach(row => { const r = ranks(row); r.r.forEach((v, j) => R[j] += v); ties += r.ties; });
    const Q0 = 12 / (n * k * (k + 1)) * sum(R.map(v => v * v)) - 3 * n * (k + 1), Q = Q0 / (1 - ties / (n * k * (k * k - 1)));
    return { Q, df: k - 1, p: pChi(Q, k - 1), W: Q / (n * (k - 1)), meanRanks: R.map(v => v / n), n, k };
  }

  // comparaciones por pares tras Friedman (como PMCMRplus): Conover (t, gl = (n−1)(k−1)), Siegel-Castellan/Dunn (z) y Nemenyi (rango studentizado, gl = ∞)
  function friedmanPosthoc(Y, method = 'conover', adjust = 'holm') {
    const n = Y.length, k = Y[0].length, Rk = Y.map(row => ranks(row).r), Rs = new Array(k).fill(0); let s2 = 0;
    Rk.forEach(r => r.forEach((v, j) => { Rs[j] += v; s2 += v * v; }));
    const S2 = 1 / (k - 1) * (s2 - k * n * (k + 1) ** 2 / 4), T2 = sum(Rs.map(v => (v - n * (k + 1) / 2) ** 2)) / S2;
    const A = S2 * 2 * n * (k - 1) / (n * k - k - n + 1), B = 1 - T2 / (n * (k - 1)), df = n * k - k - n + 1, seZ = Math.sqrt(k * (k + 1) / (6 * n));
    const out = [];
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
      if (method === 'conover') { const t = (Rs[b] - Rs[a]) / Math.sqrt(A * B); out.push({ a, b, stat: t, p: pT(t, df), df }); }
      else if (method === 'nemenyi') { const q = Math.abs(Rs[b] - Rs[a]) / n / seZ * Math.SQRT2; out.push({ a, b, stat: q / Math.SQRT2 * Math.sign(Rs[b] - Rs[a]), q, p: Math.min(1, 1 - J.tukey.cdf(q, k, 1e7)) }); }
      else { const z = (Rs[b] - Rs[a]) / n / seZ; out.push({ a, b, stat: z, p: 2 * (1 - J.normal.cdf(Math.abs(z), 0, 1)) }); }
    }
    if (method !== 'nemenyi') { const m = out.length, adj = adjust === 'bonferroni' ? out.map(o => Math.min(1, o.p * m)) : adjust === 'none' ? out.map(o => o.p) : holm(out.map(o => o.p)); out.forEach((o, i) => o.padj = adj[i]); }
    else out.forEach(o => o.padj = o.p);
    return out;
  }
  // prueba de los signos: binomial exacta sobre las diferencias distintas de 0 (como binom.test / DescTools::SignTest)
  function signTest(d, alt = 'two') {
    const nz = d.filter(v => v !== 0), pos = nz.filter(v => v > 0).length, r = binomTest(pos, nz.length, .5, alt);
    return { pos, neg: nz.length - pos, ties: d.length - nz.length, n: nz.length, p: r.p, median: quantile(sorted(d), .5) };
  }
  // prueba de la mediana (Mood): por encima de la mediana conjunta frente a igual o por debajo; χ² de Pearson y p exacta de Fisher
  function medianTest(xs) {
    const all = xs.flat(), med = quantile(sorted(all), .5), tab = [xs.map(x => x.filter(v => v > med).length), xs.map(x => x.filter(v => v <= med).length)];
    if (tab.some(r => r.every(v => v === 0))) return { med, tab, chi: NaN, df: xs.length - 1, p: NaN, pFisher: NaN };
    const c = chiSquare(tab), fx = fisherRxC(tab);
    return { med, tab, chi: c.chi, df: c.df, p: c.p, pFisher: fx ? fx.p : null, minE: minOf(c.E.flat()) };
  }
  // Kolmogorov-Smirnov para dos muestras (como ks.test de R ≥ 4.3): p exacta si m·n < 10000 (también con empates), si no, asintótica
  function ks2(x, y) {
    const m = x.length, n = y.length, xs = sorted(x), ys = sorted(y), all = sorted(x.concat(y));
    let D = 0, Dp = 0, Dm = 0, i = 0, j = 0;
    const vals = [...new Set(all)];
    vals.forEach(v => { while (i < m && xs[i] <= v) i++; while (j < n && ys[j] <= v) j++; const d = i / m - j / n; D = Math.max(D, Math.abs(d)); Dp = Math.max(Dp, d); Dm = Math.max(Dm, -d); });
    let p, exact = m * n < 10000;
    if (exact) {
      const tie = all.map((v, q) => q === all.length - 1 || all[q + 1] !== v), lim = Math.round(D * m * n) - 1e-7;
      const ok = (a, b) => !tie[a + b - 1] || Math.abs(a * n - b * m) < lim;
      let u = new Float64Array(n + 1); u[0] = 1;
      for (let b = 1; b <= n; b++) u[b] = ok(0, b) ? u[b - 1] : 0;
      for (let a = 1; a <= m; a++) { const w = a / (a + n); u[0] = ok(a, 0) ? w * u[0] : 0;
        for (let b = 1; b <= n; b++) u[b] = ok(a, b) ? w * u[b] + u[b - 1] : 0; }
      p = Math.min(1, Math.max(0, 1 - u[n]));
    } else {
      const z = Math.sqrt(m * n / (m + n)) * D; let s = 0; for (let k = 1; k < 100; k++) s += (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * z * z); p = Math.min(1, Math.max(0, 2 * s));
    }
    return { D, Dplus: Dp, Dminus: Dm, p, exact, m, n };
  }
  // Jonckheere-Terpstra (grupos en orden creciente): exacta sin empates y N ≤ 100 (como clinfun), si no, normal con corrección por empates (como PMCMRplus)
  function jonckheere(xs) {
    const ni = xs.map(x => x.length), N = sum(ni), all = xs.flat(); let JT = 0;
    for (let a = 0; a < xs.length; a++) for (let b = a + 1; b < xs.length; b++) xs[a].forEach(u => xs[b].forEach(v => { JT += v > u ? 1 : v === u ? .5 : 0; }));
    const mu = (N * N - sum(ni.map(v => v * v))) / 4, cnt = {}; all.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
    const nt = Object.values(cnt), ties = nt.some(v => v > 1);
    const vr = !ties ? (N * N * (2 * N + 3) - sum(ni.map(v => v * v * (2 * v + 3)))) / 72
      : (N * (N - 1) * (2 * N + 5) - sum(ni.map(v => v * (v - 1) * (2 * v + 5))) - sum(nt.map(v => v * (v - 1) * (2 * v + 5)))) / 72
        + sum(ni.map(v => v * (v - 1) * (v - 2))) * sum(nt.map(v => v * (v - 1) * (v - 2))) / (36 * N * (N - 1) * (N - 2)) + sum(ni.map(v => v * (v - 1))) * sum(nt.map(v => v * (v - 1))) / (8 * N * (N - 1));
    const z = (JT - mu) / Math.sqrt(vr); let p, exact = !ties && N <= 100;
    if (exact) { let dist = new Float64Array([1]), rest = N;
      ni.slice(0, -1).forEach(na => { rest -= na; const c = wilcoxCounts(na, rest), tot = c.reduce((s_, v) => s_ + v, 0), nd = new Float64Array(dist.length + c.length - 1);
        for (let a = 0; a < dist.length; a++) if (dist[a]) for (let b = 0; b < c.length; b++) nd[a + b] += dist[a] * c[b] / tot; dist = nd; });
      const J0 = Math.round(JT); let lo = 0, hi = 0; dist.forEach((v, q) => { if (q <= J0) lo += v; if (q >= J0) hi += v; }); p = Math.min(1, 2 * Math.min(lo, hi, .5)); }
    else p = 2 * Math.min(1 - J.normal.cdf(Math.abs(z), 0, 1), .5);
    return { JT, mu, sd: Math.sqrt(vr), z, p, exact, ties, N };
  }
  // prueba de rachas (aleatoriedad) respecto a la mediana, como DescTools::RunsTest: exacta con n ≤ 30, si no, normal con corrección por continuidad
  function runsTest(xIn) {
    let x = xIn, med = null; if (new Set(xIn).size > 2) { med = quantile(sorted(xIn), .5); x = xIn.map(v => (v > med ? 1 : 0)); }
    else { const lv = [...new Set(xIn)].sort((a, b) => (a < b ? -1 : 1)); x = xIn.map(v => (v === lv[0] ? 0 : 1)); }
    const runs = 1 + x.slice(1).filter((v, i) => v !== x[i]).length, m = x.filter(v => v === 0).length, n = x.length - m, N = m + n;
    if (!m || !n) return null;
    const E = 1 + 2 * n * m / N, s2 = 2 * n * m * (2 * n * m - n - m) / (N * N * (N - 1)), dd = runs - E;
    const z = dd < -.5 ? (dd + .5) / Math.sqrt(s2) : dd > .5 ? (dd - .5) / Math.sqrt(s2) : 0, exact = N <= 30;
    let p;
    if (exact) { const lc = [0]; for (let i = 1; i <= N; i++) lc[i] = lc[i - 1] + Math.log(i); const ch = (a, b) => (b < 0 || b > a ? 0 : Math.exp(lc[a] - lc[b] - lc[a - b]));
      const pp = r => { if (r % 2 === 0) { const k = r / 2; return 2 * ch(m - 1, k - 1) * ch(n - 1, k - 1); } const k = (r - 1) / 2; return ch(m - 1, k - 1) * ch(n - 1, k) + ch(m - 1, k) * ch(n - 1, k - 1); };
      const rmax = m === n ? 2 * m : 2 * Math.min(m, n) + 1, den = ch(N, m); p = 0; for (let r = 2; r <= rmax; r++) if (Math.abs(r - E) >= Math.abs(runs - E) - 1e-9) p += pp(r) / den; p = Math.min(1, p); }
    else p = 2 * Math.min(J.normal.cdf(z, 0, 1), 1 - J.normal.cdf(z, 0, 1));
    return { runs, m, n, E, z, p, exact, med };
  }

  // ---------- asociación ----------
  function pearson(x, y) {
    const n = x.length, mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    const r = sxy / Math.sqrt(sxx * syy), t = r * Math.sqrt((n - 2) / (1 - r * r));
    return { r, n, df: n - 2, p: Math.abs(r) >= 1 ? 0 : pT(t, n - 2) };
  }
  // Spearman: con empates o n ≥ 1290, aproximación t; sin empates, distribución exacta de S = Σd² (n ≤ 9) o serie de Edgeworth
  // (Best y Roberts, 1975, algoritmo AS 89), como cor.test de R y JASP
  function spearmanUpper(is, n) { // P(S ≥ is)
    if (is <= 0) return 1; const n3 = n * (n * n - 1) / 3; if (is > n3) return 0;
    if (n <= 9) { if (!spearmanUpper.cache) spearmanUpper.cache = {};
      let dist = spearmanUpper.cache[n];
      if (!dist) { dist = new Map(); const perm = Array.from({ length: n }, (_, i) => i), used = new Array(n).fill(false);
        const rec = (pos, s) => { if (pos === n) { dist.set(s, (dist.get(s) || 0) + 1); return; } for (let v = 0; v < n; v++) if (!used[v]) { used[v] = true; rec(pos + 1, s + (v - pos) ** 2); used[v] = false; } };
        rec(0, 0); spearmanUpper.cache[n] = dist; void perm; }
      let tot = 0, up = 0; dist.forEach((c, s) => { tot += c; if (s >= is) up += c; }); return up / tot; }
    const c = [.2274, .2531, .1745, .0758, .1033, .3932, .0879, .0151, .0072, .0831, .0131, 4.6e-4];
    const b = 1 / n, x = (6 * (is - 1) * b / (n * n - 1) - 1) * Math.sqrt(1 / b - 1); let y = x * x;
    const u = x * b * (c[0] + b * (c[1] + c[2] * b) + y * (-c[3] + b * (c[4] + c[5] * b) - y * b * (c[6] + c[7] * b - y * (c[8] - c[9] * b + y * b * (c[10] - c[11] * y)))));
    y = u / Math.exp(y / 2); return Math.max(0, Math.min(1, y + (1 - J.normal.cdf(x, 0, 1))));
  }
  function spearman(x, y) {
    const rx = ranks(x), ry = ranks(y), r0 = pearson(rx.r, ry.r), n = x.length;
    if (rx.ties || ry.ties || n >= 1290 || n < 3 || Math.abs(r0.r) >= 1) return Object.assign(r0, { exact: false });
    const q = (n ** 3 - n) * (1 - r0.r) / 6, half = (n ** 3 - n) / 6;
    const p = q > half ? spearmanUpper(Math.round(q - 1), n) : 1 - spearmanUpper(Math.round(q) + 2, n);
    return Object.assign(r0, { p: Math.min(1, 2 * p), exact: true, S: q });
  }
  // tau-b de Kendall: p exacta sin empates y n < 50 (distribución del número de pares concordantes), si no, aproximación normal
  // con la varianza corregida por empates, como cor.test(method = "kendall") de R
  function kendall(x, y) {
    const n = x.length; let S = 0, tx = 0, ty = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const a = Math.sign(x[i] - x[j]), b = Math.sign(y[i] - y[j]); S += a * b; if (a === 0) tx++; if (b === 0) ty++; }
    const n0 = n * (n - 1) / 2, tau = S / Math.sqrt((n0 - tx) * (n0 - ty));
    if (!tx && !ty && n < 50) {
      // número de permutaciones con k inversiones (números mahonianos); T = pares concordantes = n0 − inversiones
      let c = [1]; for (let m = 2; m <= n; m++) { const nc = new Array(c.length + m - 1).fill(0); c.forEach((v, k) => { for (let j = 0; j < m; j++) nc[k + j] += v; }); c = nc; }
      const tot = c.reduce((a, b) => a + b, 0), T = (S + n0) / 2, cdf = t => { let s = 0; for (let k = 0; k <= Math.min(t, c.length - 1); k++) s += c[k]; return s / tot; };
      const p = T > n0 / 2 ? 1 - cdf(Math.round(T) - 1) : cdf(Math.round(T));
      return { r: tau, tau, n, df: n - 2, p: Math.min(1, 2 * p), exact: true, z: null };
    }
    const tc = v => { const m = new Map(); v.forEach(q => m.set(q, (m.get(q) || 0) + 1)); return [...m.values()].filter(t => t > 1); };
    const xt = tc(x), yt = tc(y), v0 = n * (n - 1) * (2 * n + 5), vt = sum(xt.map(t => t * (t - 1) * (2 * t + 5))), vu = sum(yt.map(t => t * (t - 1) * (2 * t + 5)));
    const v1 = sum(xt.map(t => t * (t - 1))) * sum(yt.map(t => t * (t - 1))), v2 = sum(xt.map(t => t * (t - 1) * (t - 2))) * sum(yt.map(t => t * (t - 1) * (t - 2)));
    const varS = (v0 - vt - vu) / 18 + v1 / (2 * n * (n - 1)) + v2 / (9 * n * (n - 1) * (n - 2)), z = S / Math.sqrt(varS);
    return { r: tau, tau, n, df: n - 2, p: pZ(z), exact: false, z };
  }
  // IC 95 % de una correlación por la transformación z de Fisher; EE de Bonett y Wright (2000) para Spearman y de Fieller et al. (1957) para Kendall
  function corrCI(r, n, method = 'pearson', level = .95) {
    const se = method === 'kendall' ? Math.sqrt(.437 / (n - 4)) : method === 'spearman' ? Math.sqrt((1 + r * r / 2) / (n - 3)) : 1 / Math.sqrt(n - 3);
    const z = Math.atanh(Math.max(-.9999999, Math.min(.9999999, r))), q = J.normal.inv(1 - (1 - level) / 2, 0, 1);
    return [Math.tanh(z - q * se), Math.tanh(z + q * se)];
  }
  // correlación parcial: correlación entre los residuos de x e y tras regresarlas sobre las covariables (gl = n − 2 − q);
  // con method = 'spearman', sobre los rangos (como ppcor)
  function partialCorr(x, y, Z, method = 'pearson') {
    const rk = v => ranks(v).r, X = method === 'spearman' ? rk(x) : x, Yv = method === 'spearman' ? rk(y) : y;
    const Zm = method === 'spearman' ? Z.map(rk) : Z, n = x.length, q = Z.length;
    const D = Array.from({ length: n }, (_, i) => [1].concat(Zm.map(z => z[i])));
    const ex = olsCore(D, X), ey = olsCore(D, Yv); if (!ex || !ey) return null;
    const r = pearson(ex.e, ey.e).r, df = n - 2 - q, t = r * Math.sqrt(df / (1 - r * r));
    return { r, n, df, q, p: Math.abs(r) >= 1 ? 0 : pT(t, df), t };
  }
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
    // razón de verosimilitudes (G²), corrección de Yates (solo 2×2, como chisq.test de R), φ y coeficiente de contingencia
    let G2 = 0; for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) if (tab[i][j] > 0) G2 += 2 * tab[i][j] * Math.log(tab[i][j] / E[i][j]);
    let yates = null, phi = null;
    if (R === 2 && C === 2) { let y = 0; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const dd = Math.abs(tab[i][j] - E[i][j]), c = Math.min(.5, dd); y += (dd - c) ** 2 / E[i][j]; }
      yates = { chi: y, p: pChi(y, 1) }; phi = (tab[0][0] * tab[1][1] - tab[0][1] * tab[1][0]) / Math.sqrt(rs[0] * rs[1] * cs[0] * cs[1]); }
    return { chi, df, p: pChi(chi, df), N, V: Math.sqrt(chi / (N * (Math.min(R, C) - 1))), E, adj, rs, cs,
      pctSmall: small / (R * C), minE, G2, pG2: pChi(G2, df), yates, phi, Ccont: Math.sqrt(chi / (chi + N)) };
  }
  // medidas de asociación ordinal de una tabla con filas y columnas ordenadas (gamma, tau-b, tau-c, d de Somers)
  // con sus errores típicos asintóticos ASE1 (para el IC) y ASE0 (para el contraste), con las fórmulas de SPSS/Agresti
  function ordinalAssoc(t) {
    const R = t.length, C = t[0].length, n = sum(t.map(sum)), rs = t.map(sum), cs = t[0].map((_, j) => sum(t.map(r => r[j])));
    const A = t.map((r, i) => r.map((_, j) => { let s = 0; for (let k = 0; k < R; k++) for (let l = 0; l < C; l++) if ((k > i && l > j) || (k < i && l < j)) s += t[k][l]; return s; }));
    const D = t.map((r, i) => r.map((_, j) => { let s = 0; for (let k = 0; k < R; k++) for (let l = 0; l < C; l++) if ((k > i && l < j) || (k < i && l > j)) s += t[k][l]; return s; }));
    let P = 0, Q = 0; t.forEach((r, i) => r.forEach((v, j) => { P += v * A[i][j]; Q += v * D[i][j]; }));
    const wr = n * n - sum(rs.map(v => v * v)), wc = n * n - sum(cs.map(v => v * v)), m = Math.min(R, C);
    const S = fn => sum(t.map((r, i) => sum(r.map((v, j) => v * fn(i, j)))));
    const AD = S((i, j) => (A[i][j] - D[i][j]) ** 2), base0 = Math.sqrt(Math.max(0, AD - (P - Q) ** 2 / n));
    const gamma = (P - Q) / (P + Q), gASE1 = 4 / (P + Q) ** 2 * Math.sqrt(S((i, j) => (Q * A[i][j] - P * D[i][j]) ** 2)), gASE0 = 2 / (P + Q) * base0;
    const taub = (P - Q) / Math.sqrt(wr * wc), v_ = (i, j) => rs[i] * wc + cs[j] * wr;
    const tbASE1 = 1 / (wr * wc) * Math.sqrt(Math.max(0, S((i, j) => (2 * Math.sqrt(wr * wc) * (A[i][j] - D[i][j]) + taub * v_(i, j)) ** 2) - n ** 3 * taub ** 2 * (wr + wc) ** 2)), tbASE0 = 2 / Math.sqrt(wr * wc) * base0;
    const tauc = m * (P - Q) / (n * n * (m - 1)), tcASE = 2 * m / ((m - 1) * n * n) * base0;
    const dCR = (P - Q) / wr, dCRASE1 = 2 / wr ** 2 * Math.sqrt(S((i, j) => (wr * (A[i][j] - D[i][j]) - (P - Q) * (n - rs[i])) ** 2)), dCRASE0 = 2 / wr * base0;
    const dRC = (P - Q) / wc, dRCASE1 = 2 / wc ** 2 * Math.sqrt(S((i, j) => (wc * (A[i][j] - D[i][j]) - (P - Q) * (n - cs[j])) ** 2)), dRCASE0 = 2 / wc * base0;
    const mk = (est, a1, a0) => ({ est, ase: a1, z: est / a0, p: pZ(est / a0), ci: [Math.max(-1, est - 1.959963984540054 * a1), Math.min(1, est + 1.959963984540054 * a1)] });
    return { gamma: mk(gamma, gASE1, gASE0), taub: mk(taub, tbASE1, tbASE0), tauc: mk(tauc, tcASE, tcASE), somersCR: mk(dCR, dCRASE1, dCRASE0), somersRC: mk(dRC, dRCASE1, dRCASE0) };
  }
  // prueba exacta de Fisher-Freeman-Halton para tablas R×C (enumeración de todas las tablas con los mismos márgenes, como fisher.test);
  // devuelve null si hay demasiadas tablas para enumerarlas
  function fisherRxC(t, maxTables = 3e6) {
    const R = t.length, C = t[0].length, rs = t.map(sum), cs = t[0].map((_, j) => sum(t.map(r => r[j]))), n = sum(rs);
    const lf = [0]; for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
    const konst = sum(rs.map(r => lf[r])) + sum(cs.map(c => lf[c])) - lf[n];
    const lpObs = konst - sum(t.flat().map(v => lf[v])); let pval = 0, count = 0, over = false;
    const colRem = cs.slice();
    const rec = (i, lpAcc) => { if (over) return;
      if (i === R - 1) { let lp = lpAcc; for (let j = 0; j < C; j++) lp -= lf[colRem[j]]; count++; if (count > maxTables) { over = true; return; } if (lp <= lpObs + 1e-7 * Math.abs(lpObs)) pval += Math.exp(lp); return; }
      const fill = (j, left, lp) => { if (over) return;
        if (j === C - 1) { if (left > colRem[j]) return; colRem[j] -= left; rec(i + 1, lp - lf[left]); colRem[j] += left; return; }
        let restCap = 0; for (let q = j + 1; q < C; q++) restCap += colRem[q];
        for (let v = Math.max(0, left - restCap); v <= Math.min(left, colRem[j]); v++) { colRem[j] -= v; fill(j + 1, left - v, lp - lf[v]); colRem[j] += v; } };
      fill(0, rs[i], lpAcc); };
    rec(0, konst);
    return over ? null : { p: Math.min(1, pval), tables: count };
  }
  // Mantel-Haenszel para tablas 2×2 estratificadas (como mantelhaen.test con corrección de continuidad) y Breslow-Day (homogeneidad de las OR)
  function mantelHaenszel(tabs) { // tabs: K tablas [[a, b], [c, d]]
    let num = 0, den = 0, sA = 0, sE = 0, sV = 0, P_R = 0, PS_QR = 0, Q_S = 0, R_ = 0, S_ = 0;
    tabs.forEach(([[a, b], [c, d]]) => { const n = a + b + c + d; if (n < 2) return; const r1 = a + b, c1 = a + c, r2 = c + d, c2 = b + d;
      num += a * d / n; den += b * c / n; sA += a; sE += r1 * c1 / n; sV += r1 * r2 * c1 * c2 / (n * n * (n - 1));
      const Pk = (a + d) / n, Qk = (b + c) / n, Rk = a * d / n, Sk = b * c / n; P_R += Pk * Rk; PS_QR += Pk * Sk + Qk * Rk; Q_S += Qk * Sk; R_ += Rk; S_ += Sk; });
    // corrección por continuidad solo si |ΣA − ΣE| ≥ 0.5 (como mantelhaen.test: con diferencias menores sobrecorregiría)
    const dlt = Math.abs(sA - sE), or = num / den, chi = (dlt >= .5 ? dlt - .5 : dlt) ** 2 / sV;
    const varLog = P_R / (2 * R_ * R_) + PS_QR / (2 * R_ * S_) + Q_S / (2 * S_ * S_), z = 1.959963984540054; // Robins, Breslow y Greenland
    // Breslow-Day: para cada estrato, la a esperada bajo la OR común (raíz de la cuadrática), con la corrección de Tarone
    let bd = 0, sumA = 0, sumEa = 0, sumVa = 0;
    tabs.forEach(([[a, b], [c, d]]) => { const r1 = a + b, c1 = a + c, n = a + b + c + d, r2 = n - r1;
      const qa = 1 - or, qb = r2 - c1 + or * (r1 + c1), qc = -or * r1 * c1; let ea;
      if (Math.abs(qa) < 1e-12) ea = -qc / qb; else { const disc = Math.sqrt(qb * qb - 4 * qa * qc), x1 = (-qb + disc) / (2 * qa), x2 = (-qb - disc) / (2 * qa), lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1); ea = x1 >= lo - 1e-9 && x1 <= hi + 1e-9 ? x1 : x2; }
      const eb = r1 - ea, ec = c1 - ea, ed = r2 - c1 + ea, va = 1 / (1 / ea + 1 / eb + 1 / ec + 1 / ed);
      bd += (a - ea) ** 2 / va; sumA += a; sumEa += ea; sumVa += va; });
    const K = tabs.length, tarone = bd - (sumA - sumEa) ** 2 / sumVa;
    return { or, ci: [Math.exp(Math.log(or) - z * Math.sqrt(varLog)), Math.exp(Math.log(or) + z * Math.sqrt(varLog))], chi, p: pChi(chi, 1), bd: { chi: tarone, df: K - 1, p: pChi(tarone, K - 1), uncorrected: bd } };
  }
  // tabla 2×2 [[a, b], [c, d]]: odds ratio (Woolf) y riesgos relativos (Katz) con IC 95 % por el método logarítmico, como SPSS y JASP;
  // con alguna casilla a 0 se suma 0.5 a todas (corrección de Haldane-Anscombe)
  function risk2x2(t) {
    let [[a, b], [c, d]] = t; const hal = [a, b, c, d].some(x => x === 0); if (hal) { a += .5; b += .5; c += .5; d += .5; }
    const z = 1.959963984540054, ci = (est, se) => [Math.exp(Math.log(est) - z * se), Math.exp(Math.log(est) + z * se)];
    const or = a * d / (b * c), seOR = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
    const rr1 = (a / (a + b)) / (c / (c + d)), se1 = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
    const rr2 = (b / (a + b)) / (d / (c + d)), se2 = Math.sqrt(1 / b - 1 / (a + b) + 1 / d - 1 / (c + d));
    return { or, orCI: ci(or, seOR), rr1, rr1CI: ci(rr1, se1), rr2, rr2CI: ci(rr2, se2), haldane: hal };
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
  // solo los coeficientes de MCO sobre las filas idx de X (con repetición): para el bootstrap, sin crear copias de los datos.
  // Mismas operaciones y en el mismo orden que olsCore, así que da exactamente los mismos coeficientes
  function olsBetaIdx(X, y, idx) {
    const p = X[0].length, F = new Float64Array(p * p), Fy = new Float64Array(p);
    for (let t = 0; t < idx.length; t++) { const i = idx[t], xi = X[i], yi = y[i]; for (let a = 0; a < p; a++) { const xa = xi[a]; Fy[a] += xa * yi; for (let b = a; b < p; b++) F[a * p + b] += xa * xi[b]; } }
    const XtX = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => (b >= a ? F[a * p + b] : F[b * p + a]))), Xty = Array.from(Fy);
    const Ai = inv(XtX); if (!Ai) return null;
    return Ai.map(r => sum(r.map((v, k) => v * Xty[k])));
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
    // IC 95 % de Feldt (como psych::alpha.ci)
    const d1 = n - 1, d2 = (n - 1) * (k - 1), ci = [1 - (1 - alpha) * J.centralF.inv(.975, d1, d2), 1 - (1 - alpha) * J.centralF.inv(.025, d1, d2)];
    // dos mitades como SPSS: primera mitad de los ítems (una más si k es impar) frente a la segunda
    let split = null;
    if (k >= 4) { const k1 = Math.ceil(k / 2), k2 = k - k1, h1 = items.slice(0, k1), h2 = items.slice(k1), s1 = h1[0].map((_, i) => sum(h1.map(it => it[i]))), s2 = h2[0].map((_, i) => sum(h2.map(it => it[i])));
      const r = pearson(s1, s2).r, sbEq = 2 * r / (1 + r), q = k1 * k2 / (k * k), sbUneq = (Math.sqrt(r ** 4 + 4 * r * r * (1 - r * r) * q) - r * r) / (2 * (1 - r * r) * q);
      split = { k1, k2, r, sbEq, sbUneq, guttman: 2 * (1 - (variance(s1) + variance(s2)) / variance(total)), alpha1: k1 > 1 ? alphaOf(h1) : NaN, alpha2: k2 > 1 ? alphaOf(h2) : NaN }; }
    return { alpha, alphaStd, rbar, k, n, stats, totalMean: mean(total), totalSd: sd(total), ci, split };
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
      if (maxOf(step.map(Math.abs)) < 1e-10) { conv = true; break; }
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
    // Hosmer-Lemeshow con grupos por los deciles de la probabilidad predicha, como ResourceSelection::hoslem.test, performance_hosmer y Stata:
    // cortes en los cuantiles (tipo 7) y grupos (corte anterior, corte] (el primero incluye el mínimo); los empates quedan en el mismo grupo
    // cortes con las mismas operaciones que quantile(prob, (0:G)/G) de R (tipo 7), para que los casos empatados en un corte caigan en el mismo grupo
    const q7 = (s, pr_) => { const idx = 1 + (s.length - 1) * pr_, lo = Math.floor(idx), hi = Math.ceil(idx), qs = s[lo - 1];
      if (idx > lo && s[hi - 1] !== qs) { const h = idx - lo; return (1 - h) * qs + h * s[hi - 1]; } return qs; };
    const g = Math.min(10, Math.floor(n / 5)), ps = sorted(pr), cuts = [...new Set(Array.from({ length: g + 1 }, (_, k) => q7(ps, k / g)))];
    const G = cuts.length - 1, O1 = new Array(G).fill(0), E1 = new Array(G).fill(0), M = new Array(G).fill(0);
    pr.forEach((v, i) => { let j = 0; while (j < G - 1 && v > cuts[j + 1]) j++; O1[j] += y[i]; E1[j] += v; M[j]++; });
    let hl = 0, gUsed = 0;
    for (let j = 0; j < G; j++) { if (!M[j]) continue; gUsed++; const o1 = O1[j], e1 = E1[j], m = M[j];
      if (e1 > 0) hl += (o1 - e1) ** 2 / e1; if (m - e1 > 0) hl += ((m - o1) - (m - e1)) ** 2 / (m - e1); }
    const tab = [[0, 0], [0, 0]]; pr.forEach((v, i) => tab[y[i]][v >= .5 ? 1 : 0]++);
    const separation = !conv || b.some(v => Math.abs(v) > 15) || se.some(v => !isFinite(v) || v > 1e3);
    return { b, se, z, p: z.map(pZ), or: b.map(Math.exp), ci: b.map((v, k) => [Math.exp(v - 1.959964 * se[k]), Math.exp(v + 1.959964 * se[k])]),
      dev, dev0, LR, df, pLR: pChi(LR, df), cs, nag, hl: { chi: hl, df: gUsed - 2, p: gUsed > 2 ? pChi(hl, gUsed - 2) : NaN, groups: gUsed }, tab,
      acc: (tab[0][0] + tab[1][1]) / n, n, events: sum(y), iter: it + 1, conv, separation, prob: pr };
  }

  // ---------- ANOVA factorial de dos factores (SC tipo III, codificación de efectos) ----------
  // ---------- modelo lineal general con factores entre sujetos (todas sus interacciones) y covariables ----------
  // SC de tipo III con codificación de efectos (como car::Anova(type = 3) con contr.sum), medias marginales estimadas
  // promediando sin ponderar la rejilla de niveles con las covariables en su media (como emmeans)
  function glmFactorial(y, F, L, C = []) { // F: n × k índices de nivel; L: niveles por factor; C: q arrays de covariables
    const n = y.length, k = L.length, q = C.length;
    const codes = (f, lvl) => Array.from({ length: L[f] - 1 }, (_, j) => (lvl === j ? 1 : lvl === L[f] - 1 ? -1 : 0));
    const subsets = []; for (let mask = 1; mask < (1 << k); mask++) subsets.push([...Array(k).keys()].filter(f => mask & (1 << f)));
    subsets.sort((a, b) => a.length - b.length || a.join() .localeCompare(b.join()));
    const termCols = lv => subsets.map(sub => sub.reduce((acc, f) => { const c = codes(f, lv[f]), out = []; acc.forEach(a => c.forEach(b => out.push(a * b))); return out; }, [1]));
    const rowOf = (lv, cov) => [1].concat(...termCols(lv)).concat(cov);
    const X = y.map((_, i) => rowOf(F[i], C.map(c => c[i])));
    const sizes = subsets.map(sub => sub.reduce((a, f) => a * (L[f] - 1), 1));
    const terms = subsets.map((sub, t) => ({ factors: sub, df: sizes[t] })).concat(C.map((_, j) => ({ cov: j, df: 1 })));
    let off = 1; terms.forEach(t => { t.cols = Array.from({ length: t.df }, (_, j) => off + j); off += t.df; });
    const full = olsCore(X, y); if (!full) return null;
    const dfE = n - X[0].length, mse = full.sse / dfE;
    terms.forEach(t => { const keep = X[0].map((_, j) => j).filter(j => !t.cols.includes(j)), red = olsCore(X.map(r => keep.map(j => r[j])), y);
      t.ss = red.sse - full.sse; t.ms = t.ss / t.df; t.F = t.ms / mse; t.p = pF(t.F, t.df, dfE); t.peta2 = t.ss / (t.ss + full.sse);
      t.pomega2 = Math.max(0, t.df * (t.F - 1) / (t.df * (t.F - 1) + n)); });
    const covMean = C.map(c => mean(c)), V = full.Ai.map(r => r.map(v => v * mse));
    // medias marginales de un factor (o de una combinación de factores) promediando la rejilla del resto
    const emm = fs => { const others = [...Array(k).keys()].filter(f => !fs.includes(f)), combos = [[]];
      others.forEach(f => { const nx = []; combos.forEach(c => { for (let l = 0; l < L[f]; l++) nx.push(c.concat([[f, l]])); }); combos.splice(0, combos.length, ...nx); });
      const targets = [[]]; fs.forEach(f => { const nx = []; targets.forEach(c => { for (let l = 0; l < L[f]; l++) nx.push(c.concat([[f, l]])); }); targets.splice(0, targets.length, ...nx); });
      return targets.map(tg => { const rows = combos.map(cb => { const lv = new Array(k).fill(0); tg.concat(cb).forEach(([f, l]) => { lv[f] = l; }); return rowOf(lv, covMean); });
        const c = rows[0].map((_, j) => mean(rows.map(r => r[j]))), em = sum(c.map((v, j) => v * full.b[j])), se = Math.sqrt(sum(c.map((v, a) => sum(c.map((w, b) => v * V[a][b] * w)))));
        return { levels: tg.map(([, l]) => l), c, em, se }; }); };
    const pairs = f => { const e = emm([f]), out = [], K = e.length;
      for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) { const c = e[i].c.map((v, a) => v - e[j].c[a]), est = e[i].em - e[j].em, se = Math.sqrt(sum(c.map((v, a) => sum(c.map((w, b) => v * V[a][b] * w))))), t = est / se;
        out.push({ i, j, est, se, t, p: K === 2 ? pT(t, dfE) : Math.min(1, 1 - J.tukey.cdf(Math.abs(t) * Math.SQRT2, K, dfE)), d: est / Math.sqrt(mse) }); }
      return { emm: e, pairs: out }; };
    return { terms, sse: full.sse, dfE, mse, resid: full.e, b: full.b, emm, pairs, covMean, n };
  }
  // ---------- MANOVA / MANCOVA (tipo III con codificación de efectos, como car::Anova sobre un lm multivariado) ----------
  // Ys: p arrays de variables dependientes; F, L, C como en glmFactorial. Para cada término: H = SSCP residual del modelo sin el término
  // menos el del completo; estadísticos de Pillai, Wilks, Hotelling-Lawley y Roy con las aproximaciones F de R (summary.manova)
  function manova(Ys, F, L, C = []) {
    const n = Ys[0].length, p = Ys.length, k = L.length;
    const codes = (f, lvl) => Array.from({ length: L[f] - 1 }, (_, j) => (lvl === j ? 1 : lvl === L[f] - 1 ? -1 : 0));
    const subsets = []; for (let mask = 1; mask < (1 << k); mask++) subsets.push([...Array(k).keys()].filter(f => mask & (1 << f)));
    subsets.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
    const X = F.map((lv, i) => [1].concat(...subsets.map(sub => sub.reduce((acc, f) => { const c = codes(f, lv[f]), out = []; acc.forEach(a => c.forEach(b => out.push(a * b))); return out; }, [1]))).concat(C.map(c => c[i])));
    const terms = subsets.map(sub => ({ factors: sub, df: sub.reduce((a, f) => a * (L[f] - 1), 1) })).concat(C.map((_, j) => ({ cov: j, df: 1 })));
    let off = 1; terms.forEach(t => { t.cols = Array.from({ length: t.df }, (_, j) => off + j); off += t.df; });
    const resid = Xm => { const Ai = inv(matMul(tr(Xm), Xm)); if (!Ai) return null; const P = matMul(Xm, matMul(Ai, tr(Xm)));
      const Y = Array.from({ length: n }, (_, i) => Ys.map(y => y[i])), R = Y.map((r, i) => r.map((v, d) => v - sum(P[i].map((w, j) => w * Y[j][d]))));
      return matMul(tr(R), R); };
    const E = resid(X); if (!E) return null;
    const dfE = n - X[0].length, Ei = inv(E);
    // autovalores de E⁻¹H a partir de la forma simétrica L⁻¹ H L⁻ᵀ (Cholesky de E)
    const chol = A => { const m = A.length, Lc = Array.from({ length: m }, () => new Array(m).fill(0));
      for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let q = 0; q < j; q++) s -= Lc[i][q] * Lc[j][q]; Lc[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / Lc[j][j]; } return Lc; };
    const Lc = chol(E), Li = inv(Lc);
    terms.forEach(t => {
      const keep = X[0].map((_, j) => j).filter(j => !t.cols.includes(j)), Er = resid(X.map(r => keep.map(j => r[j])));
      const H = Er.map((r, a) => r.map((v, b) => v - E[a][b])), M = matMul(matMul(Li, H), tr(Li)), Ms = M.map((r, a) => r.map((v, b) => (v + M[b][a]) / 2));
      const eig = eigSym(Ms).values.map(v => Math.max(0, v)), q = t.df, s = Math.min(p, q), m = .5 * (Math.abs(p - q) - 1), nn = .5 * (dfE - p - 1);
      const V = sum(eig.map(l => l / (1 + l))), W = eig.reduce((a, l) => a / (1 + l), 1), HL = sum(eig), Roy = maxOf(eig);
      const pil = { stat: V, F: ((2 * nn + s + 1) / (2 * m + s + 1) * V) / (s - V), df1: s * (2 * m + s + 1), df2: s * (2 * nn + s + 1) };
      const t1 = dfE - .5 * (p - q + 1), t2 = (p * q - 2) / 4, t3r = p * p + q * q - 5, t3 = t3r > 0 ? Math.sqrt(((p * q) ** 2 - 4) / t3r) : 1;
      const wil = { stat: W, F: ((Math.pow(W, -1 / t3) - 1) * (t1 * t3 - 2 * t2)) / p / q, df1: p * q, df2: t1 * t3 - 2 * t2 };
      const hlt = { stat: HL, F: (2 * (s * nn + 1) * HL) / s / s / (2 * m + s + 1), df1: s * (2 * m + s + 1), df2: 2 * (s * nn + 1) };
      const ro1 = Math.max(p, q), roy = { stat: Roy, F: ((dfE - ro1 + q) * Roy) / ro1, df1: ro1, df2: dfE - ro1 + q };
      [pil, wil, hlt, roy].forEach(o => { o.p = pF(o.F, o.df1, o.df2); });
      t.tests = { pillai: pil, wilks: wil, hotelling: hlt, roy }; t.eta2 = { pillai: V / s, wilks: 1 - Math.pow(W, 1 / s) }; t.H = H;
    });
    return { terms, E, dfE, n, p, Ei };
  }
  // prueba M de Box de igualdad de matrices de covarianzas (aproximación χ²), como heplots::boxM
  function boxM(groups) { // groups: g arrays de casos, cada caso un array de p valores
    const g = groups.length, p = groups[0][0].length, ns = groups.map(G => G.length), N = sum(ns);
    const cov = G => { const m = Array.from({ length: p }, (_, d) => mean(G.map(r => r[d]))); return Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => sum(G.map(r => (r[a] - m[a]) * (r[b] - m[b]))) / (G.length - 1))); };
    const Ss = groups.map(cov), Sp = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => sum(Ss.map((S, q) => (ns[q] - 1) * S[a][b])) / (N - g)));
    const ld = A => Math.log(Math.max(1e-300, det(A))), M = (N - g) * ld(Sp) - sum(Ss.map((S, q) => (ns[q] - 1) * ld(S)));
    const c1 = (sum(ns.map(x => 1 / (x - 1))) - 1 / (N - g)) * (2 * p * p + 3 * p - 1) / (6 * (p + 1) * (g - 1)), chi = M * (1 - c1), df = p * (p + 1) * (g - 1) / 2;
    return { M, chi, df, p: pChi(chi, df) };
  }
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
  // prueba binomial exacta frente a p0 (como binom.test de R) con IC de Clopper-Pearson
  function binomTest(x, n, p0 = .5, alt = 'two') {
    const lf = [0]; for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
    const pr = k => (p0 === 0 ? (k === 0 ? 1 : 0) : p0 === 1 ? (k === n ? 1 : 0) : Math.exp(lf[n] - lf[k] - lf[n - k] + k * Math.log(p0) + (n - k) * Math.log(1 - p0)));
    let p = 0;
    if (alt === 'greater') for (let k = x; k <= n; k++) p += pr(k);
    else if (alt === 'less') for (let k = 0; k <= x; k++) p += pr(k);
    else { const d = pr(x); for (let k = 0; k <= n; k++) { const v = pr(k); if (v <= d * (1 + 1e-7)) p += v; } }
    const a = alt === 'two' ? .025 : .05;
    const lo = alt === 'less' || x === 0 ? 0 : J.beta.inv(a, x, n - x + 1), hi = alt === 'greater' || x === n ? 1 : J.beta.inv(1 - a, x + 1, n - x);
    return { x, n, prop: x / n, p0, p: Math.min(1, p), ci: [lo, hi], alt };
  }
  // χ² de bondad de ajuste a unas proporciones esperadas (por defecto iguales), como chisq.test(x, p =) de R
  function chiGOF(counts, probs) {
    const k = counts.length, N = sum(counts), pr = probs && probs.length === k ? probs.map(v => v / sum(probs)) : counts.map(() => 1 / k);
    const E = pr.map(q => q * N), chi = sum(counts.map((o, i) => (o - E[i]) ** 2 / E[i])), df = k - 1;
    return { chi, df, p: pChi(chi, df), E, N, probs: pr, resid: counts.map((o, i) => (o - E[i]) / Math.sqrt(E[i])), minE: minOf(E), w: Math.sqrt(chi / N) };
  }
  // ---------- acuerdo entre jueces ----------
  // CCI de Shrout y Fleiss / McGraw y Wong: Y n sujetos × k jueces (casos completos); las 6 formas con F, p e IC 95 %
  function icc(Y, level = .95) {
    const n = Y.length, k = Y[0].length, gm = mean(Y.flat()), rm = Y.map(mean), cm = Y[0].map((_, j) => mean(Y.map(r => r[j])));
    const ssR = k * sum(rm.map(m => (m - gm) ** 2)), ssC = n * sum(cm.map(m => (m - gm) ** 2)), ssT = sum(Y.flat().map(v => (v - gm) ** 2)), ssE = ssT - ssR - ssC;
    const MSR = ssR / (n - 1), MSC = ssC / (k - 1), MSE = ssE / ((n - 1) * (k - 1)), MSW = (ssC + ssE) / (n * (k - 1));
    const a2 = (1 - level) / 2, qf = (p, d1, d2) => J.centralF.inv(p, d1, d2);
    const out = [];
    { // un factor, efectos aleatorios
      const F = MSR / MSW, d1 = n - 1, d2 = n * (k - 1), FL = F / qf(1 - a2, d1, d2), FU = F * qf(1 - a2, d2, d1);
      out.push({ type: 'ICC1', model: 'oneway', unit: 'single', icc: (MSR - MSW) / (MSR + (k - 1) * MSW), F, df1: d1, df2: d2, p: pF(F, d1, d2), ci: [(FL - 1) / (FL + k - 1), (FU - 1) / (FU + k - 1)] });
      out.push({ type: 'ICC1k', model: 'oneway', unit: 'average', icc: (MSR - MSW) / MSR, F, df1: d1, df2: d2, p: pF(F, d1, d2), ci: [1 - 1 / FL, 1 - 1 / FU] });
    }
    { // dos factores, acuerdo absoluto
      const F = MSR / MSE, d1 = n - 1, d2 = (n - 1) * (k - 1), r1 = (MSR - MSE) / (MSR + (k - 1) * MSE + k * (MSC - MSE) / n);
      const a = k * r1 / (n * (1 - r1)), b = 1 + k * r1 * (n - 1) / (n * (1 - r1)), v = (a * MSC + b * MSE) ** 2 / ((a * MSC) ** 2 / (k - 1) + (b * MSE) ** 2 / ((n - 1) * (k - 1)));
      const FL = qf(1 - a2, n - 1, v), FU = qf(1 - a2, v, n - 1);
      const lo = n * (MSR - FL * MSE) / (FL * (k * MSC + (k * n - k - n) * MSE) + n * MSR), hi = n * (FU * MSR - MSE) / (k * MSC + (k * n - k - n) * MSE + n * FU * MSR);
      out.push({ type: 'ICC2', model: 'twoway', agreement: 'absolute', unit: 'single', icc: r1, F, df1: d1, df2: d2, p: pF(F, d1, d2), ci: [lo, hi] });
      // medida promedio: IC de McGraw y Wong (1996), con gl de Satterthwaite calculados con el CCI promedio (como SPSS e irr)
      const rk = (MSR - MSE) / (MSR + (MSC - MSE) / n), ak = k * rk / (n * (1 - rk)), bk = 1 + k * rk * (n - 1) / (n * (1 - rk));
      const vk = (ak * MSC + bk * MSE) ** 2 / ((ak * MSC) ** 2 / (k - 1) + (bk * MSE) ** 2 / ((n - 1) * (k - 1))), FLk = qf(1 - a2, n - 1, vk), FUk = qf(1 - a2, vk, n - 1);
      out.push({ type: 'ICC2k', model: 'twoway', agreement: 'absolute', unit: 'average', icc: rk, F, df1: d1, df2: d2, p: pF(F, d1, d2),
        ci: [n * (MSR - FLk * MSE) / (FLk * (MSC - MSE) + n * MSR), n * (FUk * MSR - MSE) / (MSC - MSE + n * FUk * MSR)] });
    }
    { // dos factores, consistencia
      const F = MSR / MSE, d1 = n - 1, d2 = (n - 1) * (k - 1), FL = F / qf(1 - a2, d1, d2), FU = F * qf(1 - a2, d2, d1);
      out.push({ type: 'ICC3', model: 'twoway', agreement: 'consistency', unit: 'single', icc: (MSR - MSE) / (MSR + (k - 1) * MSE), F, df1: d1, df2: d2, p: pF(F, d1, d2), ci: [(FL - 1) / (FL + k - 1), (FU - 1) / (FU + k - 1)] });
      out.push({ type: 'ICC3k', model: 'twoway', agreement: 'consistency', unit: 'average', icc: (MSR - MSE) / MSR, F, df1: d1, df2: d2, p: pF(F, d1, d2), ci: [1 - 1 / FL, 1 - 1 / FU] });
    }
    return { n, k, MSR, MSC, MSE, MSW, forms: out };
  }
  // W de Kendall: concordancia de m jueces que puntúan n sujetos (con corrección por empates, como irr::kendall(correct = TRUE))
  function kendallW(Y) { // Y: n sujetos × m jueces
    const n = Y.length, m = Y[0].length, R = new Array(n).fill(0); let T = 0;
    for (let j = 0; j < m; j++) { const rk = ranks(Y.map(r => r[j])); rk.r.forEach((v, i) => { R[i] += v; });
      const cnt = new Map(); Y.forEach(r => cnt.set(r[j], (cnt.get(r[j]) || 0) + 1)); cnt.forEach(t => { if (t > 1) T += t ** 3 - t; }); }
    const mR = mean(R), Sq = sum(R.map(v => (v - mR) ** 2)), W = 12 * Sq / (m * m * (n ** 3 - n) - m * T), chi = m * (n - 1) * W;
    return { W, chi, df: n - 1, p: pChi(chi, n - 1), n, m };
  }
  // alfa de Krippendorff con matriz de coincidencias (admite valores perdidos); nivel 'nominal' | 'ordinal' | 'interval' | 'ratio'
  function krippAlpha(units, level = 'nominal', order = null) { // units: n sujetos × m jueces con null = sin valoración
    const vals = order || [...new Set(units.flat().filter(v => v !== null))].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
    const ix = new Map(vals.map((v, i) => [String(v), i])), V = vals.length, o = Array.from({ length: V }, () => new Array(V).fill(0));
    units.forEach(u => { const r = u.filter(v => v !== null).map(v => ix.get(String(v))), mu = r.length; if (mu < 2) return;
      for (let a = 0; a < mu; a++) for (let b = 0; b < mu; b++) if (a !== b) o[r[a]][r[b]] += 1 / (mu - 1); });
    const nc = o.map(row => sum(row)), N = sum(nc);
    const d2 = (c, k) => { if (level === 'nominal') return c === k ? 0 : 1;
      if (level === 'ordinal') { const lo = Math.min(c, k), hi = Math.max(c, k); let s = 0; for (let g = lo; g <= hi; g++) s += nc[g]; return (s - (nc[c] + nc[k]) / 2) ** 2; }
      const x = +vals[c], y = +vals[k]; return level === 'ratio' ? ((x - y) / (x + y)) ** 2 : (x - y) ** 2; };
    let Do = 0, De = 0; for (let c = 0; c < V; c++) for (let k = 0; k < V; k++) { const dd = d2(c, k); Do += o[c][k] * dd; De += nc[c] * nc[k] * dd; }
    Do /= N; De /= N * (N - 1);
    return { alpha: 1 - Do / De, level, nPairable: N, values: V };
  }
  // Bland-Altman: sesgo, límites de acuerdo al 95 % con sus IC (Bland y Altman, 1999) y sesgo proporcional
  function blandAltman(a, b) {
    const d = a.map((v, i) => v - b[i]), mm = a.map((v, i) => (v + b[i]) / 2), n = d.length, bias = mean(d), s = sd(d), t = J.studentt.inv(.975, n - 1);
    const lo = bias - 1.959963984540054 * s, hi = bias + 1.959963984540054 * s, seB = s / Math.sqrt(n), seL = Math.sqrt(3 * s * s / n);
    const reg = ols(mm.map(v => [1, v]), d);
    return { n, bias, sd: s, biasCI: [bias - t * seB, bias + t * seB], lo, hi, loCI: [lo - t * seL, lo + t * seL], hiCI: [hi - t * seL, hi + t * seL], diff: d, mean: mm,
      prop: { b: reg.b[1], se: reg.se[1], t: reg.t[1], p: reg.pv[1] }, pBias: pT(bias / seB, n - 1) };
  }
  // kappa de Cohen (2 jueces), opcionalmente ponderada ('linear' | 'quadratic') para categorías ordenadas;
  // z y p con la varianza bajo H0 (Fleiss, Cohen y Everitt, 1969), IC con la varianza asintótica, como irr::kappa2 y psych::cohen.kappa
  function cohenKappa(a, b, levels, weight = 'none') {
    const k = levels.length, n = a.length, idx = v => levels.indexOf(v), P = Array.from({ length: k }, () => new Array(k).fill(0));
    a.forEach((v, t) => { P[idx(v)][idx(b[t])] += 1 / n; });
    const W = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (weight === 'linear' ? 1 - Math.abs(i - j) / (k - 1) : weight === 'quadratic' ? 1 - ((i - j) / (k - 1)) ** 2 : i === j ? 1 : 0)));
    const pr = P.map(r => sum(r)), pc = P[0].map((_, j) => sum(P.map(r => r[j])));
    let po = 0, pe = 0; for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { po += W[i][j] * P[i][j]; pe += W[i][j] * pr[i] * pc[j]; }
    const kap = (po - pe) / (1 - pe);
    const wr = pr.map((_, i) => sum(pc.map((c, j) => W[i][j] * c))), wc = pc.map((_, j) => sum(pr.map((r, i) => W[i][j] * r)));
    let v0 = 0, v1 = 0;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      v0 += pr[i] * pc[j] * (W[i][j] - (wr[i] + wc[j])) ** 2;
      v1 += P[i][j] * (W[i][j] - (wr[i] + wc[j]) * (1 - kap)) ** 2;
    }
    const var0 = (v0 - pe * pe) / (n * (1 - pe) ** 2), var1 = (v1 - (kap - pe * (1 - kap)) ** 2) / (n * (1 - pe) ** 2);
    const z = kap / Math.sqrt(var0), se = Math.sqrt(Math.max(0, var1));
    return { kappa: kap, po, pe, n, z, p: pZ(z), se, ci: [kap - 1.959963984540054 * se, kap + 1.959963984540054 * se], weight };
  }
  // kappa de Fleiss (3 o más jueces, categorías nominales), con z y p como irr::kappam.fleiss
  function fleissKappa(R, levels) { // R: n sujetos × m jueces
    const n = R.length, m = R[0].length, k = levels.length, cnt = R.map(r => levels.map(l => r.filter(v => v === l).length));
    const pj = levels.map((_, j) => sum(cnt.map(c => c[j])) / (n * m)), Pi = cnt.map(c => (sum(c.map(x => x * x)) - m) / (m * (m - 1)));
    const Pbar = mean(Pi), Pe = sum(pj.map(p => p * p)), kap = (Pbar - Pe) / (1 - Pe);
    const se0 = Math.sqrt(2) / (sum(pj.map(p => p * (1 - p))) * Math.sqrt(n * m * (m - 1))) * Math.sqrt(sum(pj.map(p => p * (1 - p))) ** 2 - sum(pj.map(p => p * (1 - p) * (1 - 2 * p))));
    const z = kap / se0;
    return { kappa: kap, n, m, z, p: pZ(z), byCat: levels.map((l, j) => { const q = pj[j]; const kj = 1 - sum(cnt.map(c => c[j] * (m - c[j]))) / (n * m * (m - 1) * q * (1 - q)); return { level: l, kappa: kj }; }) };
  }
  // ---------- regresión logística multinomial (como nnet::multinom) ----------
  // X: n × p con la constante en la primera columna; y: índice de categoría 0..K-1 (0 = referencia)
  function multinomial(X, y, K, maxit = 100) {
    const n = X.length, p = X[0].length, q = (K - 1) * p; let b = new Array(q).fill(0), ll = -Infinity;
    const probs = bb => X.map(x => { const e = [1]; for (let k = 1; k < K; k++) { let s = 0; for (let j = 0; j < p; j++) s += x[j] * bb[(k - 1) * p + j]; e.push(Math.exp(Math.min(700, s))); } const t = sum(e); return e.map(v => v / t); });
    const logLik = bb => sum(probs(bb).map((pr, i) => Math.log(Math.max(1e-300, pr[y[i]]))));
    ll = logLik(b); let H = null, it = 0;
    for (; it < maxit; it++) {
      const P = probs(b), g = new Array(q).fill(0); H = Array.from({ length: q }, () => new Array(q).fill(0));
      X.forEach((x, i) => { for (let k = 1; k < K; k++) { const r = (y[i] === k ? 1 : 0) - P[i][k]; for (let j = 0; j < p; j++) g[(k - 1) * p + j] += r * x[j]; }
        for (let k = 1; k < K; k++) for (let l = 1; l < K; l++) { const w = P[i][k] * ((k === l ? 1 : 0) - P[i][l]); for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) H[(k - 1) * p + a][(l - 1) * p + c] += w * x[a] * x[c]; } });
      const Hi = inv(H); if (!Hi) return null;
      const step = Hi.map(r => sum(r.map((v, j) => v * g[j]))); let t = 1, nb, nl;
      for (let h = 0; h < 30; h++) { nb = b.map((v, j) => v + t * step[j]); nl = logLik(nb); if (nl >= ll - 1e-12) break; t /= 2; }
      const dl = nl - ll; b = nb; ll = nl; if (Math.abs(dl) < 1e-10) { it++; break; }
    }
    const Pf = probs(b); H = Array.from({ length: q }, () => new Array(q).fill(0));
    X.forEach((x, i) => { for (let k = 1; k < K; k++) for (let l = 1; l < K; l++) { const w = Pf[i][k] * ((k === l ? 1 : 0) - Pf[i][l]); for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) H[(k - 1) * p + a][(l - 1) * p + c] += w * x[a] * x[c]; } });
    const V = inv(H), se = V ? V.map((r, j) => Math.sqrt(r[j])) : b.map(() => NaN);
    const cnt = Array.from({ length: K }, (_, k) => y.filter(v => v === k).length), ll0 = sum(cnt.map(c => (c ? c * Math.log(c / n) : 0)));
    const pred = Pf.map(pr => pr.indexOf(maxOf(pr)));
    return { B: Array.from({ length: K - 1 }, (_, k) => b.slice(k * p, (k + 1) * p)), SE: Array.from({ length: K - 1 }, (_, k) => se.slice(k * p, (k + 1) * p)), ll, ll0, n, p, K, iter: it, pred, probs: Pf };
  }
  // ---------- regresión logística ordinal de odds proporcionales (como MASS::polr) ----------
  // logit P(Y ≤ j) = θj − x·β; X: n × p SIN constante; y: 0..K-1 ordenada
  function ordinalLogit(X, y, K, maxit = 200) {
    const n = X.length, p = X[0] ? X[0].length : 0, F = z => 1 / (1 + Math.exp(-z)), f_ = z => { const e = F(z); return e * (1 - e); };
    const cnt = Array.from({ length: K }, (_, k) => y.filter(v => v === k).length); let acc = 0;
    let th = cnt.slice(0, K - 1).map(c => { acc += c; const pr = Math.min(.999, Math.max(.001, acc / n)); return Math.log(pr / (1 - pr)); });
    let par = th.concat(new Array(p).fill(0));
    const eta = (pp, x) => { let s = 0; for (let j = 0; j < p; j++) s += x[j] * pp[K - 1 + j]; return s; };
    const ll = pp => { for (let j = 1; j < K - 1; j++) if (pp[j] <= pp[j - 1]) return -Infinity;
      let s = 0; X.forEach((x, i) => { const e = eta(pp, x), k = y[i], up = k === K - 1 ? 1 : F(pp[k] - e), lo = k === 0 ? 0 : F(pp[k - 1] - e); s += Math.log(Math.max(1e-300, up - lo)); }); return s; };
    const grad = pp => { const g = new Array(K - 1 + p).fill(0);
      X.forEach((x, i) => { const e = eta(pp, x), k = y[i], up = k === K - 1 ? 1 : F(pp[k] - e), lo = k === 0 ? 0 : F(pp[k - 1] - e), pr = Math.max(1e-300, up - lo);
        const du = k === K - 1 ? 0 : f_(pp[k] - e), dl = k === 0 ? 0 : f_(pp[k - 1] - e);
        if (k < K - 1) g[k] += du / pr; if (k > 0) g[k - 1] -= dl / pr;
        for (let j = 0; j < p; j++) g[K - 1 + j] += -(du - dl) / pr * x[j]; }); return g; };
    const hess = pp => { const m = pp.length, H = []; for (let a = 0; a < m; a++) { const hgt = 1e-5 * Math.max(1, Math.abs(pp[a])), pp1 = pp.slice(), pp2 = pp.slice(); pp1[a] += hgt; pp2[a] -= hgt;
        const g1 = grad(pp1), g2 = grad(pp2); H.push(g1.map((v, j) => (v - g2[j]) / (2 * hgt))); } return H.map((r, a) => r.map((v, b) => (v + H[b][a]) / 2)); };
    let L = ll(par), it = 0;
    for (; it < maxit; it++) {
      const g = grad(par), Hn = hess(par).map(r => r.map(v => -v)), Hi = inv(Hn); if (!Hi) break;
      const step = Hi.map(r => sum(r.map((v, j) => v * g[j]))); let t = 1, np, nl;
      for (let h = 0; h < 40; h++) { np = par.map((v, j) => v + t * step[j]); nl = ll(np); if (nl >= L - 1e-12) break; t /= 2; }
      const dl = nl - L; par = np; L = nl; if (Math.abs(dl) < 1e-11) { it++; break; }
    }
    const Vc = inv(hess(par).map(r => r.map(v => -v))), se = Vc ? Vc.map((r, j) => Math.sqrt(r[j])) : par.map(() => NaN);
    const ll0 = sum(cnt.map(c => (c ? c * Math.log(c / n) : 0)));
    const pred = X.map(x => { const e = eta(par, x), pr = Array.from({ length: K }, (_, k) => (k === K - 1 ? 1 : F(par[k] - e)) - (k === 0 ? 0 : F(par[k - 1] - e))); return pr.indexOf(maxOf(pr)); });
    return { theta: par.slice(0, K - 1), beta: par.slice(K - 1), seTheta: se.slice(0, K - 1), seBeta: se.slice(K - 1), ll: L, ll0, n, p, K, iter: it, pred };
  }
  // prueba de Brant (1990) de odds proporcionales: una logística binaria por corte (Y > j) y covarianza conjunta de sus coeficientes
  // X: n × p SIN constante; y: 0..K-1; groups: columnas de cada predictor (las ficticias de un factor van juntas). Devuelve la prueba
  // global y una por predictor. Nota: el paquete brant de R copia los bloques de covarianza entre cortes sin trasponerlos, por lo que
  // con varios predictores su χ² difiere ligeramente; aquí se usa la matriz simétrica correcta (comprobado en R: 2026-10-15).
  function brantTest(X, y, K, groups = null) {
    const n = X.length, p = X[0].length, Xc = X.map(r => [1].concat(r)), fits = [];
    for (let j = 0; j < K - 1; j++) { const yy = y.map(v => (v > j ? 1 : 0)), m = logistic(Xc, yy); if (!m) return null; fits.push({ b: m.b, pi: Xc.map(x => 1 / (1 + Math.exp(-sum(x.map((v, a) => v * m.b[a]))))) }); }
    const q = p + 1, XtWX = (w) => { const M = Array.from({ length: q }, () => new Array(q).fill(0)); Xc.forEach((x, i) => { for (let a = 0; a < q; a++) for (let c = 0; c < q; c++) M[a][c] += w[i] * x[a] * x[c]; }); return M; };
    const Inv = fits.map(fi => inv(XtWX(fi.pi.map(v => v * (1 - v)))));
    const J_ = K - 1, V = Array.from({ length: J_ * p }, () => new Array(J_ * p).fill(0));
    for (let a = 0; a < J_; a++) for (let c = a; c < J_; c++) {
      const w = fits[a].pi.map((_, i) => (a === c ? fits[a].pi[i] * (1 - fits[a].pi[i]) : fits[c].pi[i] - fits[a].pi[i] * fits[c].pi[i]));
      const blk = matMul(matMul(Inv[a], XtWX(w)), Inv[c]);
      for (let u = 1; u < q; u++) for (let v = 1; v < q; v++) { V[a * p + u - 1][c * p + v - 1] = blk[u][v]; V[c * p + v - 1][a * p + u - 1] = blk[u][v]; }
    }
    const beta = [].concat(...fits.map(fi => fi.b.slice(1)));
    const test = vars => { // vars: índices de predictores incluidos en la prueba
      const rows = []; for (let j = 1; j < J_; j++) vars.forEach(v => { const r = new Array(J_ * p).fill(0); r[v] = 1; r[j * p + v] = -1; rows.push(r); });
      const Db = rows.map(r => sum(r.map((x, k) => x * beta[k]))), DVD = rows.map(r => rows.map(s2 => sum(r.map((x, k) => x * sum(s2.map((y_, l) => y_ * V[k][l])))))), Mi = inv(DVD);
      if (!Mi) return { chi: NaN, df: rows.length, p: NaN };
      const chi = sum(Db.map((d, a) => d * sum(Db.map((e, c) => Mi[a][c] * e)))); return { chi, df: rows.length, p: pChi(chi, rows.length) }; };
    return { omnibus: test([...Array(p).keys()]), byVar: (groups || [...Array(p).keys()].map(v => [v])).map(test) };
  }
  // pseudo-R² a partir de las log-verosimilitudes (McFadden, Cox y Snell, Nagelkerke)
  function pseudoR2(ll, ll0, n) { const cs = 1 - Math.exp(2 * (ll0 - ll) / n), mx = 1 - Math.exp(2 * ll0 / n); return { mcfadden: 1 - ll / ll0, coxsnell: cs, nagelkerke: cs / mx }; }
  // ---------- curva ROC (como pROC): AUC, IC y EE de DeLong, punto de corte de Youden ----------
  // pos: puntuaciones de los casos positivos; neg: de los negativos. Se asume que puntuaciones más altas indican positivo.
  function roc(pos, neg) {
    const m = pos.length, n = neg.length, psi = (x, y) => (x > y ? 1 : x === y ? .5 : 0);
    const V10 = pos.map(x => mean(neg.map(y => psi(x, y)))), V01 = neg.map(y => mean(pos.map(x => psi(x, y)))), auc = mean(V10);
    const se = Math.sqrt(variance(V10) / m + variance(V01) / n), z = (auc - .5) / se;
    const ci = [Math.max(0, auc - 1.959963984540054 * se), Math.min(1, auc + 1.959963984540054 * se)];
    // umbrales: puntos medios entre valores distintos consecutivos (como pROC y SPSS); positivo si puntuación ≥ umbral
    const u = [...new Set(pos.concat(neg))].sort((a, b) => a - b), th = [-Infinity].concat(u.slice(1).map((v, i) => (v + u[i]) / 2)).concat([Infinity]);
    const pts = th.map(t => { const tp = pos.filter(x => x >= t).length, tn = neg.filter(y => y < t).length; return { t, se: tp / m, sp: tn / n, tp, fp: n - tn, fn: m - tp, tn }; });
    let best = pts.slice(1, -1).reduce((b, q) => (q.se + q.sp > b.se + b.sp ? q : b), pts[1] || pts[0]);
    if (best.se + best.sp - 1 < 0) best = pts[0];   // ningún corte finito mejora el azar: el óptimo es no clasificar (Youden = 0), como pROC
    const ppv = best.tp / (best.tp + best.fp), npv = best.tn / (best.tn + best.fn);
    return { auc, se, ci, z, p: pZ(z), m, n, pts, best: Object.assign({}, best, { youden: best.se + best.sp - 1, ppv, npv, lrp: best.se / (1 - best.sp), lrn: (1 - best.se) / best.sp }) };
  }
  // ---------- potencia y tamaño muestral (como el paquete pwr de R y G*Power) ----------
  // F no central: mezcla de Poisson de betas incompletas
  function pncf(x, d1, d2, lambda) {
    if (x <= 0) return 0; if (lambda <= 0) return J.centralF.cdf(x, d1, d2);
    const y = d1 * x / (d1 * x + d2), h = lambda / 2, j0 = Math.floor(h); let s = 0;
    const term = j => Math.exp(-h + j * Math.log(h) - J.gammaln(j + 1)) * J.ibeta(y, d1 / 2 + j, d2 / 2);
    for (let j = j0; j < j0 + 5000; j++) { const t = term(j); s += t; if (t < 1e-14 && j > j0 + 10) break; }
    for (let j = j0 - 1; j >= 0; j--) { const t = term(j); s += t; if (t < 1e-14) break; }
    return Math.min(1, s);
  }
  const powerFns = {
    // d de Cohen; n por grupo (n2 = ratio·n1 en independientes); type: 'ind' | 'paired' | 'one'
    t: ({ d, n, alpha = .05, alt = 'two', type = 'ind', ratio = 1 }) => {
      const n1 = n, n2 = type === 'ind' ? Math.max(2, Math.round(n * ratio)) : 0;
      const df = type === 'ind' ? n1 + n2 - 2 : n - 1, ncp = type === 'ind' ? d * Math.sqrt(n1 * n2 / (n1 + n2)) : d * Math.sqrt(n);
      if (alt === 'two') { const tc = J.studentt.inv(1 - alpha / 2, df); return 1 - pnct(tc, df, ncp) + pnct(-tc, df, ncp); }
      const tc = J.studentt.inv(1 - alpha, df); return alt === 'less' ? pnct(-tc, df, ncp) : 1 - pnct(tc, df, ncp);
    },
    // ANOVA de un factor: k grupos, n por grupo, f de Cohen
    anova: ({ f, n, k, alpha = .05 }) => { const d1 = k - 1, d2 = k * (n - 1), lam = k * n * f * f, Fc = J.centralF.inv(1 - alpha, d1, d2); return 1 - pncf(Fc, d1, d2, lam); },
    // regresión: u predictores contrastados, N total, f² de Cohen (pwr.f2.test: λ = f²·(u + v + 1))
    reg: ({ f2, n, u, alpha = .05 }) => { const v = n - u - 1; if (v < 1) return NaN; const Fc = J.centralF.inv(1 - alpha, u, v); return 1 - pncf(Fc, u, v, f2 * (u + v + 1)); },
    // χ²: w de Cohen, N total, gl
    chi: ({ w, n, df, alpha = .05 }) => { const cc = J.chisquare.inv(1 - alpha, df); return 1 - ncChisqCdf(cc, df, n * w * w); },
    // correlación: aproximación de Fisher con la corrección de pwr.r.test
    r: ({ r, n, alpha = .05, alt = 'two' }) => {
      const tside = alt === 'two' ? 2 : 1, tt = J.studentt.inv(1 - alpha / tside, n - 2), rc = Math.sqrt(tt * tt / (tt * tt + n - 2));
      const zr = Math.atanh(r) + r / (2 * (n - 1)), zrc = Math.atanh(rc), sq = Math.sqrt(n - 3);
      if (alt === 'two') return J.normal.cdf((zr - zrc) * sq, 0, 1) + J.normal.cdf((-zr - zrc) * sq, 0, 1);
      return alt === 'less' ? J.normal.cdf((-zr - zrc) * sq, 0, 1) : J.normal.cdf((zr - zrc) * sq, 0, 1);
    },
    // dos proporciones (h de Cohen, arcoseno), n por grupo
    p2: ({ h, n, alpha = .05, alt = 'two' }) => { const z = h * Math.sqrt(n / 2);
      if (alt === 'two') { const zc = J.normal.inv(1 - alpha / 2, 0, 1); return J.normal.cdf(z - zc, 0, 1) + J.normal.cdf(-z - zc, 0, 1); }
      const zc = J.normal.inv(1 - alpha, 0, 1); return alt === 'less' ? J.normal.cdf(-z - zc, 0, 1) : J.normal.cdf(z - zc, 0, 1); },
  };
  // potencia para un n dado, o el n mínimo para una potencia objetivo (búsqueda entera, como pwr redondeando hacia arriba)
  function power(test, args) { return powerFns[test](args); }
  function sampleSize(test, args, target = .8, nmin = 2, nmax = 1e6) {
    let lo = nmin, hi = nmin; while (hi < nmax && !(power(test, Object.assign({}, args, { n: hi })) >= target)) { lo = hi; hi = Math.ceil(hi * 1.6) + 1; }
    if (hi >= nmax) return null;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (power(test, Object.assign({}, args, { n: mid })) >= target) hi = mid; else lo = mid; }
    return power(test, Object.assign({}, args, { n: lo })) >= target ? lo : hi;
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
  function varimax(L0, eps = 1e-5, normalize = true) { // como stats::varimax de R (normalización de Kaiser opcional)
    const p = L0.length, m = L0[0].length; if (m < 2) return { L: L0, T: ident(m) };
    const sc = L0.map(r => (normalize ? Math.sqrt(sum(r.map(v => v * v))) : 1)), x = L0.map((r, i) => r.map(v => v / sc[i]));
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
  // extracción por mínimos residuos (MinRes/ULS) o máxima verosimilitud: se optimizan las unicidades ψ (entre .005 y 1)
  // con gradiente proyectado; las cargas salen de los autovalores, como factanal y psych::fa
  function fitUniq(R, m, method) {
    const p = R.length, Ri = inv(R);
    let psi = method === 'ml' ? R.map((_, i) => Math.min(1, Math.max(.005, (1 - .5 * m / p) / (Ri ? Ri[i][i] : 1)))) : R.map((_, i) => Math.min(1, Math.max(.005, Ri ? 1 / Ri[i][i] : .5)));
    const load = ps => { if (method === 'ml') { const sc = ps.map(v => 1 / Math.sqrt(v)), Sst = R.map((r, i) => r.map((v, j) => v * sc[i] * sc[j])), e = eigSym(Sst);
        const L = R.map((_, i) => Array.from({ length: m }, (_, j) => Math.sqrt(ps[i]) * e.vectors[i][j] * Math.sqrt(Math.max(e.values[j] - 1, 0)))); return { L, e }; }
      const Sst = R.map((r, i) => r.map((v, j) => (i === j ? v - ps[i] : v))), e = eigSym(Sst);
      return { L: R.map((_, i) => Array.from({ length: m }, (_, j) => e.vectors[i][j] * Math.sqrt(Math.max(e.values[j], 0)))), e }; };
    const obj = ps => { const { L, e } = load(ps);
      if (method === 'ml') { const rest = e.values.slice(m); return -(sum(rest.map(v => Math.log(v) - v)) - m + p); }
      let s = 0; for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) if (i !== j) { let mm = 0; for (let k = 0; k < m; k++) mm += L[i][k] * L[j][k]; s += (R[i][j] - mm) ** 2; } return s; };
    const grad = ps => { const { L } = load(ps); return ps.map((v, i) => { let mm = 0; for (let k = 0; k < m; k++) mm += L[i][k] ** 2; const g = mm + v - R[i][i]; return method === 'ml' ? g / (v * v) : g; }); };
    const clamp = ps => ps.map(v => Math.min(1, Math.max(.005, v)));
    let f = obj(psi), g = grad(psi), step = .1, it = 0;
    for (; it < 5000; it++) {
      let ok = false;
      for (let t = 0; t < 40; t++) { const np = clamp(psi.map((v, i) => v - step * g[i])), nf = obj(np);
        if (nf <= f - 1e-4 * sum(np.map((v, i) => g[i] * (psi[i] - v)))) { const ng = grad(np), s = np.map((v, i) => v - psi[i]), y = ng.map((v, i) => v - g[i]);
          const sy = sum(s.map((v, i) => v * y[i])); step = sy > 1e-20 ? Math.min(10, Math.max(1e-6, sum(s.map(v => v * v)) / sy)) : step * 2;
          const dfv = f - nf; psi = np; f = nf; g = ng; ok = true; if (dfv < 1e-14) it = 1e9; break; }
        step /= 2; }
      if (!ok) break;
      const pg = Math.sqrt(sum(psi.map((v, i) => (Math.min(1, Math.max(.005, v - g[i])) - v) ** 2))); if (pg < 1e-9) break;
    }
    return { L: load(psi).L, psi, f, converged: true };
  }
  // rotación ortogonal por gradiente (GPArotation::GPForth): quartimax y equamax (Crawford-Ferguson con κ = m / 2p)
  function gpOrth(A, crit, eps = 1e-5, maxit = 1000) {
    const p = A.length, m = A[0].length; if (m < 2) return { L: A, T: ident(m) };
    const vgQ = L => { if (crit === 'quartimax') return { Gq: L.map(r => r.map(v => -(v ** 3))), f: -sum(L.map(r => sum(r.map(v => v ** 4)))) / 4 };
      const k = m / (2 * p), L2 = L.map(r => r.map(v => v * v)), rs = L2.map(r => sum(r)), cs = Array.from({ length: m }, (_, j) => sum(L2.map(r => r[j])));
      const X1 = L2.map(r => r.map((_, j) => 0)), N = L2.map((r, i) => r.map((v, j) => rs[i] - v)), M = L2.map((r, i) => r.map((v, j) => cs[j] - v));
      void X1; const f1 = (1 - k) * sum(L2.map((r, i) => sum(r.map((v, j) => v * N[i][j])))) / 4, f2 = k * sum(L2.map((r, i) => sum(r.map((v, j) => v * M[i][j])))) / 4;
      return { Gq: L.map((r, i) => r.map((v, j) => (1 - k) * v * N[i][j] + k * v * M[i][j])), f: f1 + f2 }; };
    let T = ident(m), L = matMul(A, T), V = vgQ(L), G = matMul(tr(A), V.Gq), f = V.f, al = 1;
    for (let it = 0; it <= maxit; it++) {
      const Mx = matMul(tr(T), G), S = Mx.map((r, a) => r.map((v, b) => (v + Mx[b][a]) / 2)), Gp = G.map((r, a) => r.map((v, b) => v - sum(T[a].map((t, c) => t * S[c][b]))));
      const s = Math.sqrt(sum(Gp.map(r => sum(r.map(v => v * v))))); if (s < eps) break;
      al *= 2; let Tt, Lt, Vt;
      for (let i = 0; i <= 10; i++) { const X = T.map((r, a) => r.map((v, b) => v - al * Gp[a][b])), sv = svdSmall(X); Tt = matMul(sv.U, tr(sv.V)); Lt = matMul(A, Tt); Vt = vgQ(Lt);
        if (f - Vt.f > .5 * s * s * al) break; al /= 2; }
      T = Tt; L = Lt; f = Vt.f; G = matMul(tr(A), Vt.Gq);
    }
    return { L, T };
  }
  // promax (como psych::Promax): varimax normalizada y luego objetivo |L|^4 con el signo de L
  function promax(L0, pw = 4) {
    const m = L0[0].length; if (m < 2) return { L: L0, Phi: [[1]] };
    // normalización de Kaiser de todo el procedimiento (filas divididas por √h²), como psych::fa(rotate = "promax")
    const h = L0.map(r => Math.sqrt(sum(r.map(v => v * v)))), Ln = L0.map((r, i) => r.map(v => v / h[i]));
    const vx = varimax(Ln, 1e-8, false), x = vx.L, Q = x.map(r => r.map(v => v * Math.abs(v) ** (pw - 1)));
    const XtX = matMul(tr(x), x), U0 = matMul(inv(XtX), matMul(tr(x), Q)), d = inv(matMul(tr(U0), U0)).map((r, i) => r[i]);
    const U = U0.map(r => r.map((v, j) => v * Math.sqrt(d[j]))), z = matMul(x, U), Uf = matMul(vx.T, U), ui = inv(Uf);
    return { L: z.map((r, i) => r.map(v => v * h[i])), Phi: matMul(ui, tr(ui)) };
  }
  // geomin oblicua (GPArotation::geominQ, δ = .01) con el mismo algoritmo GPFoblq que oblimin
  function geomin(A, delta = .01, eps = 1e-5, maxit = 1000) {
    const m = A[0].length; if (m < 2) return { L: A, Phi: [[1]] };
    const vgQ = L => { const L2 = L.map(r => r.map(v => v * v + delta)), pro = L2.map(r => Math.exp(sum(r.map(Math.log)) / m));
      return { Gq: L.map((r, i) => r.map((v, j) => (2 / m) * v / L2[i][j] * pro[i])), f: sum(pro) }; };
    let T = ident(m), L = matMul(A, tr(inv(T))), V = vgQ(L), G = tr(matMul(matMul(tr(L), V.Gq), inv(T))).map(r => r.map(v => -v)), f = V.f, al = 1;
    for (let it = 0; it <= maxit; it++) {
      const cs = Array.from({ length: m }, (_, j) => sum(T.map((r, i) => r[j] * G[i][j]))), Gp = G.map((r, i) => r.map((v, j) => v - T[i][j] * cs[j]));
      const s = Math.sqrt(sum(Gp.map(r => sum(r.map(v => v * v))))); if (s < eps) break;
      al *= 2; let Tt, Lt, Vt;
      for (let i = 0; i <= 10; i++) { const X = T.map((r, a) => r.map((v, b) => v - al * Gp[a][b])), vv = Array.from({ length: m }, (_, j) => 1 / Math.sqrt(sum(X.map(r => r[j] ** 2))));
        Tt = X.map(r => r.map((x, j) => x * vv[j])); Lt = matMul(A, tr(inv(Tt))); Vt = vgQ(Lt); if (f - Vt.f > .5 * s * s * al) break; al /= 2; }
      T = Tt; f = Vt.f; L = Lt; G = tr(matMul(matMul(tr(Lt), Vt.Gq), inv(Tt))).map(r => r.map(v => -v));
    }
    return { L, Phi: matMul(tr(T), T) };
  }
  function efa(X, m, rotation = 'oblimin', extraction = 'pa') { // X: n × p casos completos
    const n = X.length, R = corMatrix(X), adec = kmoBartlett(R, n), eig = eigSym(R).values;
    let ext;
    if (extraction === 'pca') { const e = eigSym(R); ext = { L: R.map((_, i) => Array.from({ length: m }, (_, j) => e.vectors[i][j] * Math.sqrt(Math.max(e.values[j], 0)))), converged: true }; }
    else if (extraction === 'ml' || extraction === 'minres') ext = fitUniq(R, m, extraction);
    else ext = paFactor(R, m);
    let L = ext.L, Phi = ident(m);
    if (m > 1) {
      if (rotation === 'varimax') L = varimax(L).L;
      else if (rotation === 'quartimax' || rotation === 'equamax') L = gpOrth(L, rotation).L;
      else if (rotation === 'oblimin') { const o = oblimin(L); L = o.L; Phi = o.Phi; }
      else if (rotation === 'promax') { const o = promax(L); L = o.L; Phi = o.Phi; }
      else if (rotation === 'geomin') { const o = geomin(L); L = o.L; Phi = o.Phi; }
    }
    // como psych: factores ordenados por varianza explicada y con signo positivo de la suma de cargas
    const ev = Array.from({ length: m }, (_, j) => { const LtL = matMul(tr(L), L), PL = matMul(Phi, LtL); return PL[j][j]; });
    const ord = ev.map((v, j) => j).sort((a, b) => ev[b] - ev[a]);
    L = L.map(r => ord.map(j => r[j])); Phi = ord.map(a => ord.map(b => Phi[a][b]));
    const sg = Array.from({ length: m }, (_, j) => (sum(L.map(r => r[j])) < 0 ? -1 : 1));
    L = L.map(r => r.map((v, j) => v * sg[j])); Phi = Phi.map((r, a) => r.map((v, b) => v * sg[a] * sg[b]));
    const LPL = matMul(matMul(L, Phi), tr(L)), h2 = LPL.map((r, i) => r[i]), p = R.length;
    const ss = Array.from({ length: m }, (_, j) => matMul(Phi, matMul(tr(L), L))[j][j]);
    let rms = 0; for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) if (i !== j) rms += (R[i][j] - LPL[i][j]) ** 2;
    let fit = null;
    if (extraction === 'ml') { // prueba de ajuste con la corrección de Bartlett, RMSEA y TLI (como factanal y psych::fa)
      const df = ((p - m) ** 2 - p - m) / 2, chi = (n - 1 - (2 * p + 5) / 6 - 2 * m / 3) * ext.f;
      // RMSEA y TLI con las fórmulas de psych::fa (las que muestran JASP y jamovi)
      const F0 = -Math.log(Math.max(1e-300, det(R))), df0 = p * (p - 1) / 2, nm = n - 1 - (2 * p + 5) / 6 - 2 * m / 3;
      fit = df > 0 ? { chi, df, p: pChi(chi, df), rmsea: Math.sqrt(Math.max(0, chi / (df * n) - 1 / (n - 1))), tli: (F0 / df0 - ext.f / df) / (F0 / df0 - 1 / nm) } : { chi, df, p: NaN };
    }
    return { L, Phi, h2, u2: h2.map(v => 1 - v), ss, prop: ss.map(v => v / p), adec, eig, n, p, m, rotation, extraction, fit, rmsr: Math.sqrt(rms / (p * (p - 1))), converged: ext.converged };
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
      const idx = new Int32Array(n); for (let t = 0; t < n; t++) idx[t] = Math.floor(rnd() * n);
      const ra = olsBetaIdx(c1, m, idx), rb = olsBetaIdx(c2, y, idx);
      if (ra && rb) boot.push(ra[1] * rb[2]);
    }
    const bs = sorted(boot), ci = [quantile(bs, .025), quantile(bs, .975)], sdy = sd(y), sdx = sd(x);
    return { a, b, c, cp, ab, se: { a: fa.se[1], b: fb.se[2], c: fc.se[1], cp: fb.se[1] }, p: { a: fa.pv[1], b: fb.pv[2], c: fc.pv[1], cp: fb.pv[1] },
      t: { a: fa.t[1], b: fb.t[2], c: fc.t[1], cp: fb.t[1] }, dfa: fa.dfr, dfb: fb.dfr, dfc: fc.dfr, ci, bootSe: sd(boot), B: boot.length,
      sobel: { z: sobelZ, p: pZ(sobelZ) }, abStd: ab * sdx / sdy, r2m: fa.r2, r2y: fb.r2, n };
  }

  // ---------- modelos de PROCESS (Hayes): 4 con mediadores en paralelo, 6 en serie, 7 y 14 de mediación moderada ----------
  // y, x: arrays; Ms: mediadores; W: moderador (modelos 7 y 14); C: covariables. Sin centrar, como PROCESS por defecto.
  // Devuelve las ecuaciones (coeficientes con EE, t y p) y los efectos indirectos con IC bootstrap percentil (B remuestras, semilla fija).
  function processModel(model, y, x, Ms, W = null, C = [], B = 5000, seed = 20261015, wVals = null) {
    const n = y.length, k = Ms.length;
    const row = (i, parts) => [1].concat(...parts.map(pt => pt(i)));
    const X_ = i => [x[i]], Mj = j => i => [Ms[j][i]], Cv = i => C.map(c => c[i]), Wv = i => [W[i]], XW = i => [x[i] * W[i]], MW = j => i => [Ms[j][i] * W[i]];
    // diseño de cada ecuación: lista de bloques; names para mostrar
    const eqs = [];
    if (model === 4) { for (let j = 0; j < k; j++) eqs.push({ dv: 'M' + j, parts: [X_, Cv], names: ['X'].concat(C.map((_, q) => 'C' + q)) });
      eqs.push({ dv: 'Y', parts: [X_].concat(Ms.map((_, j) => Mj(j))).concat([Cv]), names: ['X'].concat(Ms.map((_, j) => 'M' + j), C.map((_, q) => 'C' + q)) }); }
    if (model === 6) { for (let j = 0; j < k; j++) eqs.push({ dv: 'M' + j, parts: [X_].concat(Ms.slice(0, j).map((_, q) => Mj(q))).concat([Cv]), names: ['X'].concat(Ms.slice(0, j).map((_, q) => 'M' + q), C.map((_, q) => 'C' + q)) });
      eqs.push({ dv: 'Y', parts: [X_].concat(Ms.map((_, j) => Mj(j))).concat([Cv]), names: ['X'].concat(Ms.map((_, j) => 'M' + j), C.map((_, q) => 'C' + q)) }); }
    if (model === 7) { eqs.push({ dv: 'M0', parts: [X_, Wv, XW, Cv], names: ['X', 'W', 'X×W'].concat(C.map((_, q) => 'C' + q)) });
      eqs.push({ dv: 'Y', parts: [X_, Mj(0), Cv], names: ['X', 'M0'].concat(C.map((_, q) => 'C' + q)) }); }
    if (model === 14) { eqs.push({ dv: 'M0', parts: [X_, Cv], names: ['X'].concat(C.map((_, q) => 'C' + q)) });
      eqs.push({ dv: 'Y', parts: [X_, Mj(0), Wv, MW(0), Cv], names: ['X', 'M0', 'W', 'M0×W'].concat(C.map((_, q) => 'C' + q)) }); }
    const dvOf = (dv, i) => (dv === 'Y' ? y[i] : Ms[+dv.slice(1)][i]);
    // matrices de diseño de cada ecuación una sola vez; el bootstrap solo recalcula los coeficientes sobre los índices remuestreados
    const design = eqs.map(e => ({ X: Array.from({ length: n }, (_, i) => row(i, e.parts)), y: Array.from({ length: n }, (_, i) => dvOf(e.dv, i)) }));
    const fitAll = idx => design.map(d => { const b = olsBetaIdx(d.X, d.y, idx); return b ? { b } : null; });
    const coef = (fits, dv, nm) => { const q = eqs.findIndex(e => e.dv === dv), j = eqs[q].names.indexOf(nm); return fits[q].b[j + 1]; };
    // valores del moderador: percentiles 16, 50 y 84 (PROCESS v4) o los dos valores si es dicotómico
    const wv = W ? (wVals || (() => { const u = [...new Set(W)].sort((a, b) => a - b); if (u.length === 2) return u; const s = sorted(W); return [quantile(s, .16), quantile(s, .5), quantile(s, .84)]; })()) : [];
    const effects = fits => { const out = {}, c = (dv, nm) => coef(fits, dv, nm);
      if (model === 4) { let tot = 0; for (let j = 0; j < k; j++) { const v = c('M' + j, 'X') * c('Y', 'M' + j); out['ind' + j] = v; tot += v; } out.indTot = tot;
        for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) out[`con${a}_${b}`] = out['ind' + a] - out['ind' + b]; }
      if (model === 6) { // rutas: cada subconjunto ordenado de mediadores
        let tot = 0; const paths = []; const rec = (last, chain) => { for (let j = last + 1; j < k; j++) { const ch = chain.concat([j]); paths.push(ch); rec(j, ch); } }; rec(-1, []);
        paths.forEach(ch => { let v = c('M' + ch[0], 'X'); for (let q = 1; q < ch.length; q++) v *= c('M' + ch[q], 'M' + ch[q - 1]); v *= c('Y', 'M' + ch[ch.length - 1]); out['path' + ch.join('_')] = v; tot += v; }); out.indTot = tot; }
      if (model === 7) { const a1 = c('M0', 'X'), a3 = c('M0', 'X×W'), b = c('Y', 'M0'); wv.forEach((w, q) => { out['cond' + q] = (a1 + a3 * w) * b; }); out.imm = a3 * b; }
      if (model === 14) { const a = c('M0', 'X'), b1 = c('Y', 'M0'), b3 = c('Y', 'M0×W'); wv.forEach((w, q) => { out['cond' + q] = a * (b1 + b3 * w); }); out.imm = a * b3; }
      return out; };
    const all = Array.from({ length: n }, (_, i) => i), fits = fitAll(all); if (fits.some(f_ => !f_)) return null;
    const est = effects(fits);
    let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const boot = Object.fromEntries(Object.keys(est).map(key => [key, []]));
    for (let r = 0; r < B; r++) { const idx = new Int32Array(n); for (let t = 0; t < n; t++) idx[t] = Math.floor(rnd() * n); const bf = fitAll(idx); if (bf.some(f_ => !f_)) continue; const e = effects(bf); Object.keys(e).forEach(key => boot[key].push(e[key])); }
    const ci = Object.fromEntries(Object.keys(est).map(key => { const bs = sorted(boot[key]); return [key, { est: est[key], se: sd(boot[key]), ci: [quantile(bs, .025), quantile(bs, .975)] }]; }));
    // ecuaciones con inferencia completa
    const eqOut = eqs.map(e => { const Xd = all.map(i => row(i, e.parts)), m = ols(Xd, all.map(i => dvOf(e.dv, i))); return { dv: e.dv, names: ['(Constante)'].concat(e.names), b: m.b, se: m.se, t: m.t, p: m.pv, ci: m.ci, r2: m.r2, F: m.F, df1: m.df1, dfr: m.dfr, pF: m.pF }; });
    // efectos total y directo de X sobre Y
    const tot = ols(all.map(i => [1, x[i]].concat(C.map(c => c[i]))), y), dirEq = eqOut.find(e => e.dv === 'Y'), jx = dirEq.names.indexOf('X');
    return { model, n, eqs: eqOut, effects: ci, B: minOf(Object.values(boot).map(v => v.length)), wv,
      total: { b: tot.b[1], se: tot.se[1], t: tot.t[1], p: tot.pv[1], ci: tot.ci[1] }, direct: { b: dirEq.b[jx], se: dirEq.se[jx], t: dirEq.t[jx], p: dirEq.p[jx], ci: dirEq.ci[jx] } };
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

  // densidad suavizada con núcleo gaussiano y ancho de banda de Silverman (como bw.nrd0 de R), evaluada entre el mínimo y el máximo (como un violín recortado)
  function kde(x, npts = 96) {
    const s = x.slice().sort((a, b) => a - b), n = s.length, q = p => { const h = (n - 1) * p, lo = Math.floor(h), hi = Math.min(lo + 1, n - 1); return s[lo] + (h - lo) * (s[hi] - s[lo]); };
    const m = s.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)), iqr = q(.75) - q(.25);
    let lo = Math.min(sd, iqr / 1.34); if (!(lo > 0)) lo = sd || Math.abs(x[0]) || 1;   // como bw.nrd0: x[1] en el orden original
    const bw = .9 * lo * Math.pow(n, -.2), a = s[0], b = s[n - 1], c = 1 / (n * bw * Math.sqrt(2 * Math.PI));
    const pts = Array.from({ length: npts }, (_, i) => { const y = b > a ? a + (b - a) * i / (npts - 1) : a; let d = 0; for (const v of s) { const z = (y - v) / bw; if (z > -8 && z < 8) d += Math.exp(-.5 * z * z); } return [y, d * c]; });
    return { bw, pts, q1: q(.25), md: q(.5), q3: q(.75), n };
  }

  // ---------- valores perdidos: medias y covarianzas por EM (como norm::em.norm) y prueba MCAR de Little (como naniar::mcar_test) ----------
  // X: filas con null en los perdidos. El EM trabaja con las variables tipificadas (como norm) y devuelve μ y Σ de máxima verosimilitud en la escala original
  function emNorm(X, maxit = 20000, tol = 1e-13) {
    const n = X.length, p = X[0].length, m0 = [], s0 = [];
    for (let j = 0; j < p; j++) { const o = X.map(r => r[j]).filter(v => v !== null); if (o.length < 2) return null; const mm = mean(o); m0.push(mm); s0.push(Math.sqrt(sum(o.map(v => (v - mm) ** 2)) / o.length) || 1); }
    const Z = X.map(r => r.map((v, j) => (v === null ? null : (v - m0[j]) / s0[j])));
    const pats = new Map(); Z.forEach(r => { const k = r.map(v => (v === null ? 1 : 0)).join(''); if (!pats.has(k)) pats.set(k, []); pats.get(k).push(r); });
    const groups = [...pats.entries()].map(([k, rows]) => { const o = [], mi = []; [...k].forEach((c, j) => (c === '0' ? o : mi).push(j)); return { key: k, o, m: mi, rows }; });
    let mu = new Array(p).fill(0), S = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => (a === b ? 1 : 0))), it = 0, conv = false;
    for (; it < maxit; it++) {
      const T1 = new Array(p).fill(0), T2 = Array.from({ length: p }, () => new Array(p).fill(0));
      for (const g of groups) {
        const { o, m: mi } = g; let B = null, C = null;
        if (mi.length && o.length) { const Soo = inv(o.map(a => o.map(b => S[a][b]))); if (!Soo) return null;
          B = mi.map(a => o.map((_, q) => sum(o.map((b, r) => S[a][b] * Soo[r][q]))));                  // Σmo Σoo⁻¹
          C = mi.map((a, u) => mi.map(c => S[a][c] - sum(o.map((b, q) => B[u][q] * S[b][c])))); }        // Σmm − Σmo Σoo⁻¹ Σom
        else if (mi.length) C = mi.map(a => mi.map(c => S[a][c]));
        for (const r of g.rows) {
          const x = r.slice(); mi.forEach((a, u) => { x[a] = mu[a] + (B ? sum(o.map((b, q) => B[u][q] * (r[b] - mu[b]))) : 0); });
          for (let a = 0; a < p; a++) { T1[a] += x[a]; for (let b = a; b < p; b++) T2[a][b] += x[a] * x[b]; }
          if (C) mi.forEach((a, u) => mi.forEach((c, w) => { if (c >= a) T2[a][c] += C[u][w]; }));
        }
      }
      const mu1 = T1.map(t => t / n), S1 = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => { const [i, j] = a <= b ? [a, b] : [b, a]; return T2[i][j] / n - mu1[a] * mu1[b]; }));
      let d = 0; for (let a = 0; a < p; a++) { d = Math.max(d, Math.abs(mu1[a] - mu[a])); for (let b = 0; b < p; b++) d = Math.max(d, Math.abs(S1[a][b] - S[a][b])); }
      mu = mu1; S = S1; if (d < tol) { conv = true; it++; break; }
    }
    return { mu: mu.map((v, j) => m0[j] + s0[j] * v), sigma: S.map((r, a) => r.map((v, b) => v * s0[a] * s0[b])), muZ: mu, sigmaZ: S, groups, iterations: it, converged: conv };
  }
  // Little (1988): d² = Σ_j n_j (ȳ_j − μ_j)' Σ_j⁻¹ (ȳ_j − μ_j) sobre las variables observadas de cada patrón; gl = Σ k_j − p
  function littleMCAR(X) {
    const em = emNorm(X); if (!em) return null; const p = X[0].length;
    // con muy pocos datos por patrón la verosimilitud no tiene máximo: Σ tiende a una matriz singular y la prueba no es válida
    const Rz = em.sigmaZ.map((r, a) => r.map((v, b) => v / Math.sqrt(em.sigmaZ[a][a] * em.sigmaZ[b][b]))), minEig = Math.min(...eigSym(Rz).values);
    const base = { patterns: em.groups.length, mu: em.mu, sigma: em.sigma, iterations: em.iterations, converged: em.converged, minEig, groups: em.groups.map(g => ({ key: g.key, n: g.rows.length, missing: g.m })) };
    if (!(minEig > 1e-6) || !em.converged) return Object.assign(base, { singular: true, chi: NaN, df: NaN, p: NaN });
    let d2 = 0, kSum = 0;
    for (const g of em.groups) { if (!g.o.length) continue; kSum += g.o.length;
      const ybar = g.o.map(j => mean(g.rows.map(r => r[j]))), dv = g.o.map((j, q) => ybar[q] - em.muZ[j]), Si = inv(g.o.map(a => g.o.map(b => em.sigmaZ[a][b]))); if (!Si) return Object.assign(base, { singular: true, chi: NaN, df: NaN, p: NaN });
      d2 += g.rows.length * sum(dv.map((x, a) => x * sum(dv.map((y, b) => Si[a][b] * y)))); }
    const df = kSum - p;
    return Object.assign(base, { singular: false, chi: d2, df, p: df > 0 ? pChi(d2, df) : NaN });
  }

  // ---------- metaanálisis (como metafor::escalc, rma, predict, confint y regtest) ----------
  // tamaños del efecto por estudio: SMD (g de Hedges con la corrección exacta), MD, OR (log; +0.5 en las cuatro casillas si alguna es 0), COR (z de Fisher)
  function effectSize(type, d) {
    if (type === 'SMD') { const m = d.n1 + d.n2 - 2, sp = Math.sqrt(((d.n1 - 1) * d.sd1 ** 2 + (d.n2 - 1) * d.sd2 ** 2) / m), J_ = Math.exp(J.gammaln(m / 2) - Math.log(Math.sqrt(m / 2)) - J.gammaln((m - 1) / 2)), g = J_ * (d.m1 - d.m2) / sp;
      return { yi: g, vi: 1 / d.n1 + 1 / d.n2 + g * g / (2 * (d.n1 + d.n2)) }; }
    if (type === 'MD') return { yi: d.m1 - d.m2, vi: d.sd1 ** 2 / d.n1 + d.sd2 ** 2 / d.n2 };
    if (type === 'OR') { let { a, b, c, d: dd } = d; if ([a, b, c, dd].some(x => x === 0)) { a += .5; b += .5; c += .5; dd += .5; } return { yi: Math.log(a * dd / (b * c)), vi: 1 / a + 1 / b + 1 / c + 1 / dd }; }
    if (type === 'COR') return { yi: Math.atanh(d.r), vi: 1 / (d.n - 3) };
    return null;
  }
  // modelo de efectos fijos ('FE'), DerSimonian-Laird ('DL') o REML (Fisher scoring, como metafor); X: moderadores con constante (por defecto, solo la constante)
  function rmaFit(y, v, method = 'REML', X = null) {
    const k = y.length, Xm = X || y.map(() => [1]), p = Xm[0].length;
    const wls = t2 => { const w = v.map(x => 1 / (x + t2)), M = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, c) => sum(Xm.map((r, i) => w[i] * r[a] * r[c])))), Mi = inv(M); if (!Mi) return null;
      const Xy = Array.from({ length: p }, (_, a) => sum(Xm.map((r, i) => w[i] * r[a] * y[i]))), b = Mi.map(r => sum(r.map((q, a) => q * Xy[a]))), e = y.map((yy, i) => yy - sum(Xm[i].map((q, a) => q * b[a])));
      return { w, Mi, b, e }; };
    // P = W − W X (X'WX)⁻¹ X'W
    const Pmat = (w, Mi) => y.map((_, i) => y.map((__, j) => (i === j ? w[i] : 0) - w[i] * w[j] * sum(Xm[i].map((xa, a) => xa * sum(Xm[j].map((xc, c) => Mi[a][c] * xc))))));
    const fe = wls(0); if (!fe) return null; const QE = sum(fe.e.map((e, i) => fe.w[i] * e * e));
    let t2 = 0;
    if (method === 'DL') { const W = fe.w, P = Pmat(W, fe.Mi), trP = sum(P.map((r, i) => r[i])); t2 = Math.max(0, (QE - (k - p)) / trP); }
    else if (method === 'REML') { const Wfe = fe.w, P0 = Pmat(Wfe, fe.Mi); t2 = Math.max(0, (QE - (k - p)) / sum(P0.map((r, i) => r[i])));   // arranque con el estimador de DL
      for (let it = 0; it < 1000; it++) { const f_ = wls(t2), P = Pmat(f_.w, f_.Mi), Py = P.map(r => sum(r.map((q, j) => q * y[j])));
        const U = -.5 * sum(P.map((r, i) => r[i])) + .5 * sum(Py.map(q => q * q)), I = .5 * sum(P.map((r, i) => sum(r.map((q, j) => q * P[j][i]))));
        let tn = t2 + U / I; if (tn < 0) tn = 0; const done = Math.abs(tn - t2) < 1e-14 * Math.max(1, t2); t2 = tn; if (done) break; } }
    const f_ = wls(t2), se = f_.Mi.map((r, a) => Math.sqrt(r[a])), z = f_.b.map((b, a) => b / se[a]), zq = 1.959963984540054;
    const P = Pmat(f_.w, f_.Mi), seT2 = method === 'REML' ? Math.sqrt(2 / sum(P.map((r, i) => sum(r.map((q, j) => q * P[j][i]))))) : NaN;
    const wf = v.map(x => 1 / x), s2 = (k - 1) * sum(wf) / (sum(wf) ** 2 - sum(wf.map(x => x * x)));   // varianza típica dentro de los estudios (Higgins y Thompson)
    return { k, p, b: f_.b, se, z, pval: z.map(pZ), ci: f_.b.map((b, a) => [b - zq * se[a], b + zq * se[a]]), tau2: t2, seTau2: seT2, QE, dfQ: k - p, pQ: pChi(QE, k - p),
      I2: 100 * t2 / (t2 + s2), H2: (t2 + s2) / s2, s2, w: f_.w, method };
  }
  // IC del 95 % de τ² por el perfil de Q (Viechtbauer, 2007; como confint.rma.uni), y los de I² y H² que se derivan
  function tau2CI(y, v, level = .95) {
    const k = y.length, Qg = t2 => { const w = v.map(x => 1 / (x + t2)), mu = sum(w.map((wi, i) => wi * y[i])) / sum(w); return sum(w.map((wi, i) => wi * (y[i] - mu) ** 2)); };
    const root = target => { if (Qg(0) < target) return 0; let lo = 0, hi = 1; while (Qg(hi) > target) hi *= 2; for (let it = 0; it < 200; it++) { const md = (lo + hi) / 2; if (Qg(md) > target) lo = md; else hi = md; } return (lo + hi) / 2; };
    const a = (1 - level) / 2, lb = root(J.chisquare.inv(1 - a, k - 1)), ub = root(J.chisquare.inv(a, k - 1));
    const wf = v.map(x => 1 / x), s2 = (k - 1) * sum(wf) / (sum(wf) ** 2 - sum(wf.map(x => x * x)));
    return { tau2: [lb, ub], I2: [100 * lb / (lb + s2), 100 * ub / (ub + s2)], H2: [(lb + s2) / s2, (ub + s2) / s2] };
  }
  // metaanálisis completo: modelo, intervalo de predicción e IC de τ²; Egger: metarregresión con el EE como moderador (como regtest)
  function meta(y, v, method = 'REML') {
    const r = rmaFit(y, v, method); if (!r) return null; const zq = 1.959963984540054, se = r.se[0], piH = zq * Math.sqrt(se * se + r.tau2);
    const ci = method === 'FE' ? null : tau2CI(y, v), eg = y.length >= 3 ? rmaFit(y, v, method, v.map(x => [1, Math.sqrt(x)])) : null;
    if (method === 'FE') { r.I2 = r.QE > 0 ? Math.max(0, 100 * (r.QE - r.dfQ) / r.QE) : 0; r.H2 = r.QE / r.dfQ; }   // en efectos fijos, a partir de Q (como metafor)
    return Object.assign(r, { est: r.b[0], pi: method === 'FE' ? [NaN, NaN] : [r.b[0] - piH, r.b[0] + piH], tau2CI: ci,
      egger: eg ? { z: eg.z[1], p: eg.pval[1], b: eg.b[0], ci: eg.ci[0] } : null, weights: r.w.map(w => 100 * w / sum(r.w)) });
  }

  // ---------- supervivencia: Kaplan-Meier, log-rank y regresión de Cox (empates de Efron), como survival::survfit, survdiff y coxph ----------
  // time: tiempos; event: 1 = evento, 0 = censura. IC de S(t) en escala logarítmica (conf.type = "log", por defecto en survfit)
  function kaplanMeier(time, event, level = .95) {
    const z = J.normal.inv(1 - (1 - level) / 2, 0, 1), ts = [...new Set(time.filter((_, i) => event[i] === 1))].sort((a, b) => a - b), rows = [];
    let S = 1, gw = 0;
    ts.forEach(t => { const nr = time.filter(v => v >= t).length, d = time.filter((v, i) => v === t && event[i] === 1).length;
      S *= 1 - d / nr; gw += nr > d ? d / (nr * (nr - d)) : Infinity; const se = S * Math.sqrt(gw), lse = Math.sqrt(gw);
      rows.push({ t, nrisk: nr, nevent: d, surv: S, se: isFinite(se) ? se : NaN, lower: S > 0 && isFinite(lse) ? Math.exp(Math.log(S) - z * lse) : NaN, upper: S > 0 && isFinite(lse) ? Math.min(1, Math.exp(Math.log(S) + z * lse)) : NaN }); });
    // mediana (y sus IC) como quantile.survfit: primer tiempo con S ≤ 0.5; si S vale exactamente 0.5 en un tramo, punto medio con el siguiente tiempo
    const q = key => { const tol = Math.sqrt(2.220446049250313e-16);
      for (let k = 0; k < rows.length; k++) { const v = rows[k][key]; if (!isFinite(v)) continue;
        if (Math.abs(v - .5) < tol) return k + 1 < rows.length ? (rows[k].t + rows[k + 1].t) / 2 : rows[k].t;
        if (v < .5) return rows[k].t; } return NaN; };
    return { rows, n: time.length, events: event.filter(e => e === 1).length, median: q('surv'), medianCI: [q('lower'), q('upper')] };
  }
  // log-rank (survdiff, rho = 0): g = índice de grupo 0..k−1
  function logrank(time, event, g, k) {
    const ts = [...new Set(time.filter((_, i) => event[i] === 1))].sort((a, b) => a - b), O = new Array(k).fill(0), E = new Array(k).fill(0), V = Array.from({ length: k }, () => new Array(k).fill(0));
    ts.forEach(t => { const nr = new Array(k).fill(0), d = new Array(k).fill(0);
      time.forEach((v, i) => { if (v >= t) nr[g[i]]++; if (v === t && event[i] === 1) d[g[i]]++; });
      const N = sum(nr), D = sum(d); for (let a = 0; a < k; a++) { O[a] += d[a]; E[a] += D * nr[a] / N; }
      if (N > 1) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) V[a][b] += D * (N - D) / (N - 1) * nr[a] / N * ((a === b ? 1 : 0) - nr[b] / N); });
    const m = k - 1, Vi = inv(V.slice(0, m).map(r => r.slice(0, m))), u = O.slice(0, m).map((o, a) => o - E[a]);
    const chi = Vi ? sum(u.map((x, a) => x * sum(u.map((y_, b) => Vi[a][b] * y_)))) : NaN;
    return { chi, df: m, p: pChi(chi, m), O, E, V };
  }
  // Cox de riesgos proporcionales con empates de Efron (Newton-Raphson desde 0): X sin constante (n × p)
  function cox(X, time, event) {
    const n = X.length, p = X[0].length, ord = time.map((t, i) => i).sort((a, b) => time[b] - time[a]);   // de mayor a menor tiempo (conjuntos de riesgo acumulados)
    const ts = [...new Set(time.filter((_, i) => event[i] === 1))].sort((a, b) => b - a);
    const step = b => { const eta = X.map(r => sum(r.map((v, k) => v * b[k]))), w = eta.map(Math.exp);
      let ll = 0; const U = new Array(p).fill(0), I = Array.from({ length: p }, () => new Array(p).fill(0));
      let S0 = 0; const S1 = new Array(p).fill(0), S2 = Array.from({ length: p }, () => new Array(p).fill(0)); let q = 0;
      ts.forEach(t => { // añadir al conjunto de riesgo todos los tiempos ≥ t
        while (q < n && time[ord[q]] >= t) { const i = ord[q++]; S0 += w[i]; for (let a = 0; a < p; a++) { S1[a] += w[i] * X[i][a]; for (let c = 0; c < p; c++) S2[a][c] += w[i] * X[i][a] * X[i][c]; } }
        const Dset = []; for (let i = 0; i < n; i++) if (time[i] === t && event[i] === 1) Dset.push(i); const d = Dset.length;
        let D0 = 0; const D1 = new Array(p).fill(0), D2 = Array.from({ length: p }, () => new Array(p).fill(0));
        Dset.forEach(i => { ll += eta[i]; D0 += w[i]; for (let a = 0; a < p; a++) { U[a] += X[i][a]; D1[a] += w[i] * X[i][a]; for (let c = 0; c < p; c++) D2[a][c] += w[i] * X[i][a] * X[i][c]; } });
        for (let l = 0; l < d; l++) { const f_ = l / d, s0 = S0 - f_ * D0, s1 = S1.map((v, a) => v - f_ * D1[a]);
          ll -= Math.log(s0); for (let a = 0; a < p; a++) { U[a] -= s1[a] / s0; for (let c = 0; c < p; c++) I[a][c] += (S2[a][c] - f_ * D2[a][c]) / s0 - s1[a] * s1[c] / (s0 * s0); } } });
      return { ll, U, I }; };
    let b = new Array(p).fill(0), st = step(b); const ll0 = st.ll, U0 = st.U, I0i = inv(st.I);
    for (let it = 0; it < 100; it++) { const Ii = inv(st.I); if (!Ii) return null; const db = Ii.map(r => sum(r.map((v, k) => v * st.U[k])));
      let bn = b.map((v, k) => v + db[k]), sn = step(bn), h = 0; while (sn.ll < st.ll - 1e-12 && h++ < 30) { bn = b.map((v, k) => v + db[k] / 2 ** h); sn = step(bn); }   // paso reducido si empeora
      const done = Math.abs(sn.ll - st.ll) < 1e-13 * (1 + Math.abs(st.ll)); b = bn; st = sn; if (done) break; }
    const Vb = inv(st.I); if (!Vb) return null; const se = Vb.map((r, k) => Math.sqrt(r[k])), z = b.map((v, k) => v / se[k]), zq = 1.959963984540054;
    const lr = 2 * (st.ll - ll0), wald = sum(b.map((v, a) => v * sum(b.map((u, c) => st.I[a][c] * u)))), score = I0i ? sum(U0.map((v, a) => v * sum(U0.map((u, c) => I0i[a][c] * u)))) : NaN;
    return { b, se, z, p: z.map(pZ), hr: b.map(Math.exp), ci: b.map((v, k) => [Math.exp(v - zq * se[k]), Math.exp(v + zq * se[k])]), ll: st.ll, ll0,
      lr: { chi: lr, df: p, p: pChi(lr, p) }, wald: { chi: wald, df: p, p: pChi(wald, p) }, score: { chi: score, df: p, p: pChi(score, p) }, n, events: event.filter(e => e === 1).length };
  }

  // ---------- regresión de Poisson y binomial negativa (enlace log), como glm(family = poisson) y MASS::glm.nb ----------
  // digamma y trigamma: recurrencia hasta x ≥ 6 y serie asintótica (error < 1e-13)
  function digamma(x) { let r = 0; while (x < 6) { r -= 1 / x; x += 1; } const f = 1 / (x * x);
    return r + Math.log(x) - .5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132)))); }
  function trigamma(x) { let r = 0; while (x < 6) { r += 1 / (x * x); x += 1; } const f = 1 / (x * x);
    return r + 1 / x + f / 2 + f / x * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f / 30))); }
  // X: n × p con constante; y: recuentos (enteros ≥ 0); family: 'poisson' | 'negbin'; off: desplazamiento opcional (log de la exposición).
  // θ = ∞ es Poisson. La binomial negativa alterna IRLS con θ fijo y θ de máxima verosimilitud (Newton) hasta la convergencia, como glm.nb
  function countReg(X, y, family = 'poisson', off = null) {
    const n = X.length, p = X[0].length, o = off || new Array(n).fill(0), NB = family === 'negbin';
    const muOf = b => X.map((r, i) => Math.exp(o[i] + sum(r.map((v, k) => v * b[k]))));
    const yl = (v, m) => (v > 0 ? v * Math.log(v / m) : 0);
    const devOf = (mu, t) => 2 * sum(y.map((v, i) => (isFinite(t) ? yl(v, mu[i]) - (v + t) * Math.log((v + t) / (mu[i] + t)) : yl(v, mu[i]) - (v - mu[i]))));
    // log-verosimilitud estable también con θ muy grande: lgamma(y + θ) − lgamma(θ) = Σ log(θ + j), j < y (exacto para recuentos enteros)
    const lgr = (v, t) => { if (v !== Math.round(v) || v > 1e5) return J.gammaln(v + t) - J.gammaln(t); let s_ = 0; for (let j = 0; j < v; j++) s_ += Math.log(t + j); return s_; };
    const llOf = (mu, t) => sum(y.map((v, i) => (isFinite(t) ? lgr(v, t) - J.gammaln(v + 1) - t * Math.log1p(mu[i] / t) + v * Math.log(mu[i] / (t + mu[i]))
      : v * Math.log(mu[i]) - mu[i] - J.gammaln(v + 1))));
    const info = (mu, b0, t) => { const w = mu.map(m => (isFinite(t) ? m / (1 + m / t) : m)), M = Array.from({ length: p }, () => new Array(p).fill(0));
      for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) M[a][c] += w[i] * X[i][a] * X[i][c]; return { M, w }; };
    const irls = (t, b0) => {
      let b = b0 ? b0.slice() : new Array(p).fill(0), dev0 = Infinity;
      if (!b0) b[0] = Math.log(Math.max(mean(y), 1e-8)) - mean(o);
      for (let it = 0; it < 200; it++) {
        const mu = muOf(b), { M, w } = info(mu, b, t), Ai = inv(M); if (!Ai) return null;
        const zw = new Array(p).fill(0); for (let i = 0; i < n; i++) { const z = Math.log(mu[i]) - o[i] + (y[i] - mu[i]) / mu[i]; for (let a = 0; a < p; a++) zw[a] += w[i] * X[i][a] * z; }
        b = Ai.map(r => sum(r.map((v, k) => v * zw[k]))); const dv = devOf(muOf(b), t);
        if (Math.abs(dv - dev0) / (Math.abs(dv) + .1) < 1e-14) break; dev0 = dv;
      }
      const mu = muOf(b), Ai = inv(info(mu, b, t).M); return Ai ? { b, mu, Ai } : null;
    };
    const tInfo = (mu, t) => sum(y.map((v, i) => -trigamma(t + v) + trigamma(t) - 1 / t + 2 / (mu[i] + t) - (v + t) / (mu[i] + t) ** 2));
    const thetaML = (mu, t0) => { // θ de máxima verosimilitud dados los μ (Newton, como MASS::theta.ml)
      let t = t0 || n / sum(y.map((v, i) => (v / mu[i] - 1) ** 2)); if (!(t > 0) || !isFinite(t)) t = 1;
      for (let it = 0; it < 200; it++) { const sc = sum(y.map((v, i) => digamma(t + v) - digamma(t) + Math.log(t) + 1 - Math.log(t + mu[i]) - (v + t) / (mu[i] + t)));
        let tn = t + sc / tInfo(mu, t); if (!(tn > 0)) tn = t / 2; if (tn > 1e8) return Infinity;   // sin sobredispersión: el límite es Poisson
        const ok = Math.abs(tn - t) < 1e-12 * Math.max(1, t); t = tn; if (ok) break; }
      return t; };
    let fit = irls(Infinity), theta = Infinity; if (!fit) return null;
    if (NB) { theta = thetaML(fit.mu); let l0 = -Infinity;
      for (let it = 0; it < 500 && isFinite(theta); it++) { fit = irls(theta, fit.b); if (!fit) return null; const t2 = thetaML(fit.mu, theta); if (!isFinite(t2)) { theta = Infinity; fit = irls(Infinity, fit.b); break; } const l1 = llOf(fit.mu, t2);
        const done = Math.abs(t2 - theta) < 1e-11 * theta && Math.abs(l1 - l0) < 1e-11; theta = t2; l0 = l1; if (done) break; }
      if (isFinite(theta)) { fit = irls(theta, fit.b); if (!fit) return null; } }
    const se = fit.Ai.map((r, k) => Math.sqrt(r[k])), z = fit.b.map((v, k) => v / se[k]), L = llOf(fit.mu, theta), dev = devOf(fit.mu, theta), dfr = n - p;
    const pear = sum(y.map((v, i) => (v - fit.mu[i]) ** 2 / (NB && isFinite(theta) ? fit.mu[i] + fit.mu[i] ** 2 / theta : fit.mu[i])));
    return { family, b: fit.b, se, z, p: z.map(pZ), irr: fit.b.map(Math.exp), ci: fit.b.map((v, k) => [Math.exp(v - 1.959963984540054 * se[k]), Math.exp(v + 1.959963984540054 * se[k])]),
      ll: L, dev, dfr, aic: -2 * L + 2 * (p + (NB ? 1 : 0)), pearson: pear, dispersion: pear / dfr, theta, thetaSE: NB && isFinite(theta) ? 1 / Math.sqrt(tInfo(fit.mu, theta)) : NaN, mu: fit.mu, n,
      poissonLimit: NB && !isFinite(theta) };
  }

  // ---------- equivalencia: dos pruebas t unilaterales (TOST; Schuirmann, 1987; Lakens, 2017), como TOSTER::t_TOST ----------
  // type: 'ind' (a, b; equalVar), 'paired' (diferencia b − a) o 'one' (a frente a mu). Límites [low, high] en unidades brutas de la
  // diferencia o, con bound = 'd', en d de Cohen (se pasan a brutas con la DT combinada, la media de las varianzas, la DT de las diferencias o la de la muestra)
  function tost(a, b, { type = 'ind', mu = 0, low, high, bound = 'raw', equalVar = true, alpha = .05 } = {}) {
    let est, se, df, sdS;
    if (type === 'ind') {
      const n1 = a.length, n2 = b.length, v1 = variance(a), v2 = variance(b); est = mean(a) - mean(b);
      if (equalVar) { const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2); se = Math.sqrt(sp2 * (1 / n1 + 1 / n2)); df = n1 + n2 - 2; sdS = Math.sqrt(sp2); }
      else { se = Math.sqrt(v1 / n1 + v2 / n2); df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)); sdS = Math.sqrt((v1 + v2) / 2); }
    } else { const x = type === 'paired' ? b.map((v, i) => v - a[i]) : a, n = x.length; est = mean(x) - (type === 'one' ? mu : 0); sdS = sd(x); se = sdS / Math.sqrt(n); df = n - 1; }
    const lo = bound === 'd' ? low * sdS : low, hi = bound === 'd' ? high * sdS : high;
    const t0 = est / se, tLo = (est - lo) / se, tHi = (est - hi) / se;
    const pLo = 1 - J.studentt.cdf(tLo, df), pHi = J.studentt.cdf(tHi, df), p = Math.max(pLo, pHi), tq = J.studentt.inv(1 - alpha, df);
    return { type, est, se, df, low: lo, high: hi, sd: sdS, t0, p0: pT(t0, df), tLo, pLo, tHi, pHi, p, alpha, equivalent: p < alpha,
      ci: [est - tq * se, est + tq * se], dEst: est / sdS };
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
  // AFC multigrupo con estructura de medias (como lavaan::cfa(group =, group.equal =), ML con la información esperada).
  // Xg: casos completos de cada grupo; factores: índices de los ítems de cada factor (el primero, marcador con carga 1).
  // level: 'configural' | 'metric' (cargas iguales) | 'scalar' (+ interceptos; medias latentes libres desde el 2.º grupo) | 'strict' (+ varianzas residuales)
  function cfaMG(Xg, factores, level = 'configural') {
    const G = Xg.length, p = Xg[0][0].length, m = factores.length, ng = Xg.map(X => X.length), N = sum(ng), L_ = ['configural', 'metric', 'scalar', 'strict'].indexOf(level);
    const mom = Xg.map(X => { const mu = Array.from({ length: p }, (_, j) => mean(X.map(r => r[j])));
      return { mu, S: Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => sum(X.map(r => (r[a] - mu[a]) * (r[b] - mu[b]))) / X.length)) }; });
    const key = new Map(), P = [], idx = k => { if (!key.has(k)) { key.set(k, P.length); P.push(k); } return key.get(k); };
    const spec = Xg.map((_, g) => {
      const lam = [], phi = [], psi = [], nu = [], al = [];
      factores.forEach((it, k) => it.slice(1).forEach(j => lam.push({ j, k, i: idx(L_ >= 1 ? `l:${j}:${k}` : `l:${j}:${k}:${g}`) })));
      for (let k = 0; k < m; k++) for (let l = 0; l <= k; l++) phi.push({ k, l, i: idx(`f:${k}:${l}:${g}`) });
      for (let j = 0; j < p; j++) psi.push({ j, i: idx(L_ >= 3 ? `u:${j}` : `u:${j}:${g}`) });
      for (let j = 0; j < p; j++) nu.push({ j, i: idx(L_ >= 2 ? `n:${j}` : `n:${j}:${g}`) });
      if (L_ >= 2 && g > 0) for (let k = 0; k < m; k++) al.push({ k, i: idx(`a:${k}:${g}`) });
      return { lam, phi, psi, nu, al }; });
    const build = (th, g) => { const s = spec[g], L = Array.from({ length: p }, () => new Array(m).fill(0)), Phi = Array.from({ length: m }, () => new Array(m).fill(0)), Psi = new Array(p).fill(0), nu = new Array(p).fill(0), al = new Array(m).fill(0);
      factores.forEach((it, k) => { L[it[0]][k] = 1; });
      s.lam.forEach(q => { L[q.j][q.k] = th[q.i]; }); s.phi.forEach(q => { Phi[q.k][q.l] = Phi[q.l][q.k] = th[q.i]; }); s.psi.forEach(q => { Psi[q.j] = th[q.i]; }); s.nu.forEach(q => { nu[q.j] = th[q.i]; }); s.al.forEach(q => { al[q.k] = th[q.i]; });
      const Sig = matMul(matMul(L, Phi), tr(L)).map((r, a) => r.map((v, b) => v + (a === b ? Psi[a] : 0))), mu = nu.map((v, j) => v + sum(L[j].map((x, k) => x * al[k])));
      return { L, Phi, Psi, nu, al, Sig, mu }; };
    const logdetPD = A => { const n = A.length, Lc = Array.from({ length: n }, () => new Array(n).fill(0)); let ld = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= Lc[i][k] * Lc[j][k];
        if (i === j) { if (!(s > 1e-12)) return null; Lc[i][i] = Math.sqrt(s); ld += 2 * Math.log(Lc[i][i]); } else Lc[i][j] = s / Lc[j][j]; }
      return ld; };
    const ldS = mom.map(o => Math.log(det(o.S)));
    const Fg = (B, g) => { const ld = logdetPD(B.Sig); if (ld === null) return null; const Si = inv(B.Sig); if (!Si) return null; const { S, mu } = mom[g], e = mu.map((v, j) => v - B.mu[j]);
      return ld + sum(S.map((r, a) => sum(r.map((v, b) => v * Si[b][a])))) + sum(e.map((x, a) => x * sum(e.map((y, b) => Si[a][b] * y)))) - ldS[g] - p; };
    const F = th => { let t = 0; for (let g = 0; g < G; g++) { const v = Fg(build(th, g), g); if (v === null) return 1e10; t += ng[g] / N * v; } return t; };
    const grad = th => { const gr = new Array(P.length).fill(0);
      for (let g = 0; g < G; g++) { const B = build(th, g), Si = inv(B.Sig), { S, mu } = mom[g], e = mu.map((v, j) => v - B.mu[j]), w = ng[g] / N;
        const Se = S.map((r, a) => r.map((v, b) => v + e[a] * e[b])), Om = matMul(matMul(Si, Se.map((r, a) => r.map((v, b) => B.Sig[a][b] - v))), Si);   // Σ⁻¹ (Σ − S − ee') Σ⁻¹
        const gm = Si.map(r => -2 * sum(r.map((v, b) => v * e[b]))), OL = matMul(Om, B.L), LOL = matMul(tr(B.L), OL), OLP = matMul(OL, B.Phi), s = spec[g];
        s.lam.forEach(q => { gr[q.i] += w * (2 * OLP[q.j][q.k] + gm[q.j] * B.al[q.k]); });
        s.phi.forEach(q => { gr[q.i] += w * (q.k === q.l ? LOL[q.k][q.k] : 2 * LOL[q.k][q.l]); });
        s.psi.forEach(q => { gr[q.i] += w * Om[q.j][q.j]; }); s.nu.forEach(q => { gr[q.i] += w * gm[q.j]; });
        s.al.forEach(q => { gr[q.i] += w * sum(B.L.map((r, j) => r[q.k] * gm[j])); }); }
      return gr; };
    // valores iniciales (promedio entre grupos de los parámetros comunes)
    const acc = P.map(() => [0, 0]), put = (i, v) => { acc[i][0] += v; acc[i][1]++; };
    spec.forEach((s, g) => { const { S, mu } = mom[g];
      s.lam.forEach(q => { const mk = factores[q.k][0]; put(q.i, S[q.j][mk] / Math.max(S[mk][mk] / 2, 1e-6)); });
      s.phi.forEach(q => { const mk = factores[q.k][0]; put(q.i, q.k === q.l ? S[mk][mk] / 2 : 0); });
      s.psi.forEach(q => put(q.i, S[q.j][q.j] / 2)); s.nu.forEach(q => put(q.i, mu[q.j])); s.al.forEach(q => put(q.i, 0)); });
    let th = acc.map(([a, n]) => a / n), f0 = F(th), g = grad(th), Hn = ident(P.length), conv = false, it = 0, fresh = true;
    for (; it < 5000; it++) {
      const d = Hn.map(r => -sum(r.map((v, k) => v * g[k]))); let a = 1, th1, f1;
      const slope = sum(d.map((v, k) => v * g[k])); if (slope >= 0) { Hn = ident(P.length); continue; }
      let ok = false;
      for (let k = 0; k < 60; k++) { th1 = th.map((v, i) => v + a * d[i]); f1 = F(th1); if (f1 <= f0 + 1e-4 * a * slope) { ok = true; break; } a /= 2; }
      if (!ok) { if (fresh) { conv = maxOf(g.map(Math.abs)) < 1e-6; break; } Hn = ident(P.length); fresh = true; continue; }
      fresh = false;
      const g1 = grad(th1), s = th1.map((v, i) => v - th[i]), yv = g1.map((v, i) => v - g[i]), sy = sum(s.map((v, i) => v * yv[i]));
      if (sy > 1e-12) { const Hy = Hn.map(r => sum(r.map((v, k) => v * yv[k]))), yHy = sum(yv.map((v, i) => v * Hy[i]));
        Hn = Hn.map((r, i) => r.map((v, j) => v + (sy + yHy) * s[i] * s[j] / (sy * sy) - (Hy[i] * s[j] + s[i] * Hy[j]) / sy)); }
      const df_ = Math.abs(f0 - f1); th = th1; f0 = f1; g = g1;
      if (maxOf(g.map(Math.abs)) < 1e-10 || (df_ < 1e-15 && maxOf(g.map(Math.abs)) < 1e-7)) { conv = true; break; }
    }
    // errores típicos con la información esperada: Σ_g n_g [½ tr(Σ⁻¹ ∂Σ_a Σ⁻¹ ∂Σ_b) + ∂μ_a' Σ⁻¹ ∂μ_b]
    const Bs = Xg.map((_, gg) => build(th, gg)), Sis = Bs.map(B => inv(B.Sig));
    const der = P.map((_, i) => { const h = 1e-6 * Math.max(1, Math.abs(th[i])), a = th.slice(), b = th.slice(); a[i] += h; b[i] -= h;
      return Xg.map((__, gg) => { const A = build(a, gg), Bm = build(b, gg); return { dS: A.Sig.map((r, x) => r.map((v, y) => (v - Bm.Sig[x][y]) / (2 * h))), dm: A.mu.map((v, x) => (v - Bm.mu[x]) / (2 * h)) }; }); });
    const I = P.map(() => new Array(P.length).fill(0));
    for (let gg = 0; gg < G; gg++) { const Si = Sis[gg], SdS = der.map(D => matMul(Si, D[gg].dS)), Sdm = der.map(D => Si.map(r => sum(r.map((v, y) => v * D[gg].dm[y]))));
      for (let a = 0; a < P.length; a++) for (let b = a; b < P.length; b++) { const v = ng[gg] * (.5 * sum(SdS[a].map((r, x) => sum(r.map((q, y) => q * SdS[b][y][x])))) + sum(der[a][gg].dm.map((q, x) => q * Sdm[b][x]))); I[a][b] += v; if (b !== a) I[b][a] += v; } }
    const Ii = inv(I), se = Ii ? Ii.map((r, i) => Math.sqrt(r[i])) : P.map(() => NaN);
    const chi = N * f0, df = G * (p * (p + 1) / 2 + p) - P.length, pval = df > 0 ? pChi(chi, df) : NaN;
    const chiB = sum(mom.map((o, gg) => ng[gg] * (sum(o.S.map((r, i) => Math.log(r[i]))) - ldS[gg]))), dfB = G * p * (p - 1) / 2;
    const cfi = 1 - Math.max(chi - df, 0) / Math.max(chiB - dfB, chi - df, 1e-12), tli = df > 0 ? ((chiB / dfB) - (chi / df)) / ((chiB / dfB) - 1) : NaN;
    const rm = l => Math.sqrt(Math.max(0, l / (N * df))) * Math.sqrt(G), rmsea = df > 0 ? rm(chi - df) : NaN;
    const ncpAt = target => { if (ncChisqCdf(chi, df, 0) < target) return 0; let lo = 0, hi = Math.max(10, chi * 4); while (ncChisqCdf(chi, df, hi) > target) hi *= 2;
      for (let k = 0; k < 200; k++) { const md = (lo + hi) / 2; if (ncChisqCdf(chi, df, md) > target) lo = md; else hi = md; } return (lo + hi) / 2; };
    const rmseaCI = df > 0 ? [rm(ncpAt(.95)), rm(ncpAt(.05))] : [NaN, NaN];
    // SRMR (Bentler, con las medias) en cada grupo, combinado con los pesos n_g/N
    const srmrG = mom.map((o, gg) => { const B = Bs[gg]; let s2 = 0, k = 0;
      for (let a = 0; a < p; a++) { for (let b = 0; b <= a; b++) { s2 += ((o.S[a][b] - B.Sig[a][b]) / Math.sqrt(o.S[a][a] * o.S[b][b])) ** 2; k++; } s2 += ((o.mu[a] - B.mu[a]) / Math.sqrt(o.S[a][a])) ** 2; k++; }
      return Math.sqrt(s2 / k); });
    const srmr = sum(srmrG.map((v, gg) => v * ng[gg] / N));
    return { level, chi, df, p: pval, cfi, tli, rmsea, rmseaCI, srmr, srmrG, npar: P.length, N, ng, converged: conv, iterations: it, params: P.map((k, i) => ({ key: k, est: th[i], se: se[i] })), groups: Bs };
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
    // log|Σ| por Cholesky: null si Σ no es definida positiva (det > 0 no basta: dos autovalores negativos también lo dan)
    const logdetPD = A => { const n = A.length, Lc = Array.from({ length: n }, () => new Array(n).fill(0)); let ld = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= Lc[i][k] * Lc[j][k];
        if (i === j) { if (!(s > 1e-12)) return null; Lc[i][i] = Math.sqrt(s); ld += 2 * Math.log(Lc[i][i]); } else Lc[i][j] = s / Lc[j][j]; }
      return ld; };
    const F = th => { const { Sig } = build(th), ld = logdetPD(Sig); if (ld === null) return 1e10; const Si = inv(Sig); if (!Si) return 1e10;
      return ld + sum(S.map((r, a) => sum(r.map((v, b) => v * Si[b][a])))) - ldS - p; };
    const grad = th => { const { L, Phi, Sig } = build(th), Si = inv(Sig), D = Sig.map((r, a) => r.map((v, b) => v - S[a][b]));
      const Om = matMul(matMul(Si, D), Si), OL = matMul(Om, L), LOL = matMul(tr(L), OL), OLP = matMul(OL, Phi);
      return P.map(q => (q.t === 'l' ? 2 * OLP[q.j][q.k] : q.t === 'f' ? (q.k === q.l ? LOL[q.k][q.k] : 2 * LOL[q.k][q.l]) : Om[q.j][q.j])); };
    // valores iniciales
    const th0 = P.map(q => { if (q.t === 'u') return S[q.j][q.j] / 2;
      const it = factores[q.t === 'l' ? q.k : q.k], mk = it[0];
      if (q.t === 'l') return S[q.j][mk] / Math.max(S[mk][mk] / 2, 1e-6);
      if (q.k === q.l) return S[mk][mk] / 2; return 0; });
    // BFGS con búsqueda lineal por retroceso
    let th = th0.slice(), f0 = F(th), g = grad(th), Hn = ident(P.length), conv = false, it = 0, fresh = true;
    for (; it < 2000; it++) {
      const d = Hn.map(r => -sum(r.map((v, k) => v * g[k]))); let a = 1, th1, f1;
      const slope = sum(d.map((v, k) => v * g[k])); if (slope >= 0) { Hn = ident(P.length); continue; }
      let ok = false;
      for (let k = 0; k < 60; k++) { th1 = th.map((v, i) => v + a * d[i]); f1 = F(th1); if (f1 <= f0 + 1e-4 * a * slope) { ok = true; break; } a /= 2; }
      // sin mejora: nunca se acepta un paso que empeore el ajuste; se reinicia la dirección (gradiente) o se termina si ya lo era
      if (!ok) { if (fresh) { conv = maxOf(g.map(Math.abs)) < 1e-6; break; } Hn = ident(P.length); fresh = true; continue; }
      fresh = false;
      const g1 = grad(th1), s = th1.map((v, i) => v - th[i]), yv = g1.map((v, i) => v - g[i]), sy = sum(s.map((v, i) => v * yv[i]));
      if (sy > 1e-12) { const Hy = Hn.map(r => sum(r.map((v, k) => v * yv[k]))), yHy = sum(yv.map((v, i) => v * Hy[i]));
        Hn = Hn.map((r, i) => r.map((v, j) => v + (sy + yHy) * s[i] * s[j] / (sy * sy) - (Hy[i] * s[j] + s[i] * Hy[j]) / sy)); }
      const df_ = Math.abs(f0 - f1); th = th1; f0 = f1; g = g1;
      if (maxOf(g.map(Math.abs)) < 1e-9 || (df_ < 1e-14 && maxOf(g.map(Math.abs)) < 1e-6)) { conv = true; break; }
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

  root.TharpStats = { cfaMG, stepwisePH, smmCdf, kde, emNorm, littleMCAR, effectSize, rmaFit, tau2CI, meta, kaplanMeier, logrank, cox, countReg, digamma, trigamma, tost, manova, boxM, brantTest, glmFactorial, multinomial, ordinalLogit, pseudoR2, roc, lilliefors, seSkew, seKurt, cronbach, logistic, anova2, sum, mean, variance, sd, median, quantile, sorted, skewness, kurtosis, ranks, describe, meanCI, holm,
    shapiro, anova, levene, welchAnova, tTestInd, mannWhitney, kruskal, dunn, tukeyHSD, gamesHowell, pairwiseHolm, hasTukey, posthocMethod, dunnett, dunnettProb, contrasts, contrastWeights, brownForsythe,
    tTestPaired, tTestOne, wilcoxonOne, wilcoxonSigned, rmAnova, mixedAnova, rmFactorial, friedman, friedmanPosthoc, signTest, medianTest, ks2, jonckheere, runsTest, ancova, mcnemar, cochranQ, binomTwoSided, binomTest, chiGOF, pncf, power, sampleSize, icc, cohenKappa, fleissKappa, kendallW, krippAlpha, blandAltman, efa, fitUniq, promax, geomin, gpOrth, parallelAnalysis, omegaTotal, kmoBartlett, corMatrix, eigSym, moderation, mediation, processModel, lmm, nelderMead, cfa, ncChisqCdf, pearson, spearman, kendall, corrCI, partialCorr, fisher2x2, chiSquare, risk2x2, ordinalAssoc, fisherRxC, mantelHaenszel, ols, olsCore, tcrit, pT, pF, pnct, ncpCI };
})(typeof window !== 'undefined' ? window : this);
