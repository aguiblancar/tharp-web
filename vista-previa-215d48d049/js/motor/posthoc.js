/* Tharp · motor estadístico · Comparaciones post hoc y contrastes */
import { J, holm, mean, minOf, sum, variance } from './base.js';
import { pF, pT, pZ } from './distribuciones.js';
import { tTestInd } from './grupos.js';
/** @typedef {import('./base.js').Registro} Registro */

function dunn(groups, kw) {
  const N = kw.N,
    out = /** @type {Registro[]} */ ([]),
    ps = [];
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      const se = Math.sqrt(
        ((N * (N + 1)) / 12 - kw.ties / (12 * (N - 1))) * (1 / groups[i].length + 1 / groups[j].length)
      );
      const z = (kw.meanRanks[i] - kw.meanRanks[j]) / se,
        p = pZ(z);
      out.push({ i, j, z, p });
      ps.push(p);
    }
  holm(ps).forEach((p, k) => (out[k].padj = p));
  return out;
}
const hasTukey = !!(J.tukey && J.tukey.cdf);
function tukeyHSD(groups, msw, dfw) {
  const k = groups.length,
    out = /** @type {Registro[]} */ ([]);
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const a = groups[i],
        b = groups[j],
        diff = mean(a) - mean(b),
        se = Math.sqrt((msw / 2) * (1 / a.length + 1 / b.length));
      out.push({ i, j, diff, padj: Math.min(1, 1 - J.tukey.cdf(Math.abs(diff) / se, k, dfw)) });
    }
  return out;
}
// métodos con el error combinado del ANOVA (MCE): lsd, bonferroni, holm, sidak, scheffe; Tamhane T2 (Welch + Šidák)
function posthocMethod(groups, msw, dfw, method) {
  const k = groups.length,
    m = (k * (k - 1)) / 2,
    out = /** @type {Registro[]} */ ([]);
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const a = groups[i],
        b = groups[j],
        diff = mean(a) - mean(b);
      if (method === 'tamhane') {
        const r = tTestInd(a, b, false);
        out.push({ i, j, diff, t: r.t, df: r.df, p: r.p, se: r.se });
        continue;
      }
      const se = Math.sqrt(msw * (1 / a.length + 1 / b.length)),
        t = diff / se;
      out.push({ i, j, diff, t, df: dfw, se, p: pT(t, dfw), F: (t * t) / (k - 1) });
    }
  if (method === 'bonferroni')
    out.forEach(c => {
      c.padj = Math.min(1, c.p * m);
    });
  else if (method === 'holm') {
    const a = holm(out.map(c => c.p));
    out.forEach((c, q) => {
      c.padj = a[q];
    });
  } else if (method === 'sidak' || method === 'tamhane')
    out.forEach(c => {
      c.padj = 1 - Math.pow(1 - c.p, m);
    });
  else if (method === 'scheffe')
    out.forEach(c => {
      c.padj = pF(c.F, k - 1, dfw);
    });
  // GT2 de Hochberg y Gabriel: módulo máximo estudentizado con m comparaciones (Gabriel cambia el error típico para tamaños distintos)
  else if (method === 'gt2' || method === 'gabriel')
    out.forEach(c => {
      const a = groups[c.i].length,
        b = groups[c.j].length;
      c.stat =
        method === 'gt2'
          ? Math.abs(c.t)
          : Math.abs(c.diff) / (Math.sqrt(msw) * (1 / Math.sqrt(2 * a) + 1 / Math.sqrt(2 * b)));
      c.padj = Math.min(1, Math.max(0, 1 - smmCdf(c.stat, m, dfw)));
    });
  else
    out.forEach(c => {
      c.padj = c.p;
    }); // lsd: sin corrección
  return out;
}
// módulo máximo estudentizado: P(max |Ti| ≤ c) para m t independientes con gl comunes (Dunnett con correlaciones nulas)
const smmCdf = (c, m, nu) => dunnettProb(c, new Array(m).fill(0), nu);
// pruebas de rango por pasos (como PMCMRplus::snkTest y duncanTest; REGWQ con los niveles de Ryan-Einot-Gabriel-Welsch):
// q de rango estudentizado con r = medias abarcadas; SNK con el error de Tukey-Kramer y Duncan y REGWQ con la media armónica de los n (como SPSS)
function stepwisePH(groups, msw, dfw, method, alpha = 0.05) {
  const k = groups.length,
    n = groups.map(g => g.length),
    m = groups.map(mean),
    nh = k / sum(n.map(x => 1 / x));
  const ord = m.map((_, i) => i).sort((a, b) => m[b] - m[a] || a - b),
    pos = [];
  ord.forEach((g, q) => {
    pos[g] = q;
  });
  const out = /** @type {Registro[]} */ ([]);
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const r = Math.abs(pos[i] - pos[j]) + 1,
        diff = m[i] - m[j],
        se = method === 'snk' ? Math.sqrt((msw / 2) * (1 / n[i] + 1 / n[j])) : Math.sqrt(msw / nh);
      const q = Math.abs(diff) / se,
        raw = Math.min(1, Math.max(0, 1 - J.tukey.cdf(q, r, dfw)));
      const p =
        method === 'duncan'
          ? Math.min(1, 1 - Math.pow(1 - raw, 1 / (r - 1)))
          : method === 'regwq' && r < k - 1
            ? Math.min(1, 1 - Math.pow(1 - raw, k / r))
            : raw;
      out.push({ i, j, diff, q, r, p, df: dfw });
    }
  const pOf = (a, b) => out.find(c => (c.i === a && c.j === b) || (c.i === b && c.j === a));
  // regla paso a paso: un par solo difiere si difieren todos los rangos que lo contienen, así que su p es la mayor de esas p
  out.forEach(c => {
    const lo = Math.min(pos[c.i], pos[c.j]),
      hi = Math.max(pos[c.i], pos[c.j]);
    let mx = c.p;
    for (let a = 0; a <= lo; a++) for (let b = hi; b < k; b++) mx = Math.max(mx, pOf(ord[a], ord[b]).p);
    c.padj = mx;
  });
  // subconjuntos homogéneos (como SPSS): rachas máximas de medias consecutivas, en orden creciente, cuyo rango no es significativo
  const asc = ord.slice().reverse(),
    subsets = [];
  let last = -1;
  for (let a = 0; a < k; a++) {
    let b = a;
    while (b + 1 < k && pOf(asc[a], asc[b + 1]).padj >= alpha) b++;
    if (b > last) {
      subsets.push({ members: asc.slice(a, b + 1), p: b > a ? pOf(asc[a], asc[b]).p : 1 });
      last = b;
    }
  }
  return { pairs: out, subsets, order: asc, nh };
}
// Dunnett: cada grupo frente a un grupo control, con la t multivariante exacta (correlaciones λi·λj)
function dunnettProb(c, lam, nu) {
  // P(max |Tj| < c)
  const zN = 241,
    zs = [],
    zw = [];
  for (let q = 0; q < zN; q++) {
    const z = -8 + (16 * q) / (zN - 1);
    zs.push(z);
    zw.push((((q === 0 || q === zN - 1 ? 1 : q % 2 ? 4 : 2) * (16 / (zN - 1))) / 3) * J.normal.pdf(z, 0, 1));
  }
  const inner = s => {
    let acc = 0;
    for (let q = 0; q < zN; q++) {
      let pr = 1;
      for (const l of lam) {
        const r = Math.sqrt(1 - l * l);
        pr *= J.normal.cdf((c * s + l * zs[q]) / r, 0, 1) - J.normal.cdf((-c * s + l * zs[q]) / r, 0, 1);
      }
      acc += zw[q] * pr;
    }
    return acc;
  };
  if (!isFinite(nu) || nu > 1e5) return inner(1);
  // densidad de S = sqrt(χ²ν/ν) integrada con Simpson en una ventana amplia alrededor de 1
  const lo = Math.max(1e-6, 1 - 9 / Math.sqrt(nu + 1)),
    hi = 1 + 9 / Math.sqrt(nu + 1),
    sN = 241,
    h = (hi - lo) / (sN - 1);
  const logC = (nu / 2) * Math.log(nu) - (nu / 2 - 1) * Math.LN2 - J.gammaln(nu / 2);
  let tot = 0;
  for (let q = 0; q < sN; q++) {
    const s = lo + q * h,
      w = ((q === 0 || q === sN - 1 ? 1 : q % 2 ? 4 : 2) * h) / 3;
    tot += w * Math.exp(logC + (nu - 1) * Math.log(s) - (nu * s * s) / 2) * inner(s);
  }
  return tot;
}
function dunnett(groups, ctrl, msw, dfw, _alt = 'two') {
  const n0 = groups[ctrl].length,
    m0 = mean(groups[ctrl]),
    idx = groups.map((_, i) => i).filter(i => i !== ctrl);
  const lam = idx.map(i => Math.sqrt(groups[i].length / (groups[i].length + n0)));
  return idx.map(i => {
    const diff = mean(groups[i]) - m0,
      se = Math.sqrt(msw * (1 / groups[i].length + 1 / n0)),
      t = diff / se;
    const padj = Math.min(1, Math.max(0, 1 - dunnettProb(Math.abs(t), lam, dfw)));
    return { i, j: ctrl, diff, se, t, df: dfw, p: pT(t, dfw), padj };
  });
}
// contrastes planificados sobre las medias de grupo con el MCE del ANOVA (como SPSS «Contrastes» y emmeans::contrast)
function contrastWeights(k, type) {
  const W = [];
  if (type === 'polynomial') {
    // polinomios ortogonales con niveles equiespaciados (como contr.poly de R, sin normalizar)
    const x = Array.from({ length: k }, (_, i) => i + 1);
    const basis = [x.map(() => 1)];
    for (let d = 1; d < Math.min(k, 4); d++) {
      let v = x.map(xx => xx ** d);
      basis.forEach(bv => {
        const pr = sum(v.map((q, i) => q * bv[i])) / sum(bv.map(q => q * q));
        v = v.map((q, i) => q - pr * bv[i]);
      });
      basis.push(v);
      // pesos enteros clásicos (−1, 0, 1; 1, −2, 1; −3, −1, 1, 3…), como emmeans y los manuales: no cambian t ni p
      const mn = minOf(v.map(Math.abs).filter(q => q > 1e-9)),
        wi = v.map(q => Math.round((q / mn) * 1e6) / 1e6);
      W.push({ name: ['Lineal', 'Cuadrático', 'Cúbico'][d - 1], w: wi });
    }
  } else
    for (let i = 0; i < k - 1; i++) {
      const w = new Array(k).fill(0);
      if (type === 'helmert') {
        w[i] = 1;
        for (let j = i + 1; j < k; j++) w[j] = -1 / (k - i - 1);
      } else if (type === 'difference') {
        for (let j = 0; j <= i; j++) w[j] = -1 / (i + 1);
        w[i + 1] = 1;
      } // reverse Helmert
      else if (type === 'repeated') {
        w[i] = 1;
        w[i + 1] = -1;
      } else if (type === 'simple') {
        w[i + 1] = 1;
        w[0] = -1;
      } else if (type === 'deviation') {
        w.fill(-1 / k);
        w[i + 1] = 1 - 1 / k;
      }
      W.push({ i, w });
    }
  return W;
}
function contrasts(groups, msw, dfw, type) {
  return contrastWeights(groups.length, type).map(c => {
    const est = sum(c.w.map((w, i) => w * mean(groups[i]))),
      se = Math.sqrt(msw * sum(c.w.map((w, i) => (w * w) / groups[i].length))),
      t = est / se;
    return Object.assign(c, { est, se, t, df: dfw, p: pT(t, dfw) });
  });
}
function gamesHowell(groups) {
  const k = groups.length,
    out = /** @type {Registro[]} */ ([]);
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const a = groups[i],
        b = groups[j],
        va = variance(a) / a.length,
        vb = variance(b) / b.length,
        diff = mean(a) - mean(b);
      const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
      out.push({ i, j, diff, padj: Math.min(1, 1 - J.tukey.cdf(Math.abs(diff) / Math.sqrt((va + vb) / 2), k, df)) });
    }
  return out;
}
function pairwiseHolm(groups, equalVar) {
  const out = /** @type {Registro[]} */ ([]);
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      const r = tTestInd(groups[i], groups[j], equalVar);
      out.push({ i, j, diff: r.diff, p: r.p });
    }
  holm(out.map(o => o.p)).forEach((p, k) => (out[k].padj = p));
  return out;
}

export {
  dunn,
  hasTukey,
  tukeyHSD,
  posthocMethod,
  smmCdf,
  stepwisePH,
  dunnettProb,
  dunnett,
  contrastWeights,
  contrasts,
  gamesHowell,
  pairwiseHolm,
};
