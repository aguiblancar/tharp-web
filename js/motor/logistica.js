/* Tharp · motor estadístico · Regresión logística binaria, multinomial y ordinal; prueba de Brant */
import { maxOf, mean, sorted, sum } from './base.js';
import { pChi, pZ } from './distribuciones.js';
import { inv, matMul } from './algebra.js';
import { xtwx } from './mlg.js';

/**
 * Newton-Raphson que maximiza una log-verosimilitud, reduciendo el paso a la mitad mientras empeore.
 * @param {number[]} par0 valores iniciales
 * @param {(par: number[]) => number} ll log-verosimilitud
 * @param {(par: number[]) => (number[] | null)} paso dirección de Newton (H⁻¹g), o null si la hessiana es singular
 * @param {{maxit: number, mitades: number, tol: number}} opt iteraciones, reducciones del paso y tolerancia en Δll
 */
function newtonLL(par0, ll, paso, { maxit, mitades, tol }) {
  let par = par0,
    L = ll(par),
    it = 0;
  for (; it < maxit; it++) {
    const step = paso(par);
    if (!step) return { par, L, it, singular: true };
    let t = 1,
      np,
      nl;
    for (let h = 0; h < mitades; h++) {
      np = par.map((v, j) => v + t * step[j]);
      nl = ll(np);
      if (nl >= L - 1e-12) break;
      t /= 2;
    }
    const dl = nl - L;
    par = np;
    L = nl;
    if (Math.abs(dl) < tol) {
      it++;
      break;
    }
  }
  return { par, L, it, singular: false };
}
/** Hessiana por diferencias centrales del gradiente, simetrizada */
function hessianaNumerica(grad, pp) {
  const H = pp.map((_, a) => {
    const hgt = 1e-5 * Math.max(1, Math.abs(pp[a])),
      pp1 = pp.slice(),
      pp2 = pp.slice();
    pp1[a] += hgt;
    pp2[a] -= hgt;
    const g1 = grad(pp1),
      g2 = grad(pp2);
    return g1.map((v, j) => (v - g2[j]) / (2 * hgt));
  });
  return H.map((r, a) => r.map((v, b) => (v + H[b][a]) / 2));
}
// ---- Regresión logística binaria ----

/** IRLS de la logística: coeficientes, convergencia, iteraciones y (X'WX)⁻¹ de la última iteración; null si es singular */
function irlsLogistica(X, y) {
  const n = X.length,
    p = X[0].length;
  let b = new Array(p).fill(0),
    it = 0,
    conv = false,
    Ai = null;
  const ybar = mean(y);
  b[0] = Math.log(ybar / (1 - ybar));
  for (; it < 100; it++) {
    const pr = X.map(r => 1 / (1 + Math.exp(-sum(r.map((v, k) => v * b[k])))));
    const XtR = new Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) XtR[a] += X[i][a] * (y[i] - pr[i]);
    Ai = inv(
      xtwx(
        X,
        pr.map(v => Math.max(v * (1 - v), 1e-12))
      )
    );
    if (!Ai) return null;
    const step = Ai.map(r => sum(r.map((v, k) => v * XtR[k])));
    b = b.map((v, k) => v + step[k]);
    if (maxOf(step.map(Math.abs)) < 1e-10) {
      conv = true;
      break;
    }
  }
  return { b, it, conv, Ai };
}
/** Cuantil tipo 7 de R con las mismas operaciones que quantile(), para que los empates caigan en el mismo grupo */
function cuantilTipo7(s, pr) {
  const idx = 1 + (s.length - 1) * pr,
    lo = Math.floor(idx),
    hi = Math.ceil(idx),
    qs = s[lo - 1];
  if (idx > lo && s[hi - 1] !== qs) {
    const h = idx - lo;
    return (1 - h) * qs + h * s[hi - 1];
  }
  return qs;
}
/**
 * Hosmer-Lemeshow con grupos por los deciles de la probabilidad predicha, como ResourceSelection::hoslem.test,
 * performance_hosmer y Stata: cortes en los cuantiles (tipo 7) y grupos (corte anterior, corte] (el primero incluye
 * el mínimo); los empates quedan en el mismo grupo.
 */
function hosmerLemeshow(pr, y) {
  const n = pr.length,
    g = Math.min(10, Math.floor(n / 5)),
    ps = sorted(pr),
    cuts = [...new Set(Array.from({ length: g + 1 }, (_, k) => cuantilTipo7(ps, k / g)))];
  const G = cuts.length - 1,
    O1 = new Array(G).fill(0),
    E1 = new Array(G).fill(0),
    M = new Array(G).fill(0);
  pr.forEach((v, i) => {
    let j = 0;
    while (j < G - 1 && v > cuts[j + 1]) j++;
    O1[j] += y[i];
    E1[j] += v;
    M[j]++;
  });
  let hl = 0,
    gUsed = 0;
  for (let j = 0; j < G; j++) {
    if (!M[j]) continue;
    gUsed++;
    const o1 = O1[j],
      e1 = E1[j],
      m = M[j];
    if (e1 > 0) hl += (o1 - e1) ** 2 / e1;
    if (m - e1 > 0) hl += (m - o1 - (m - e1)) ** 2 / (m - e1);
  }
  return { chi: hl, df: gUsed - 2, p: gUsed > 2 ? pChi(hl, gUsed - 2) : NaN, groups: gUsed };
}
/** Regresión logística binaria (como glm(family = binomial)). X: n × p con la constante; y: 0/1 */
function logistic(X, y) {
  const n = X.length,
    p = X[0].length,
    fit = irlsLogistica(X, y);
  if (!fit) return null;
  const { b, it, conv } = fit;
  const pr = X.map(r => 1 / (1 + Math.exp(-sum(r.map((v, k) => v * b[k])))));
  // matriz de información final
  const Ai =
    inv(
      xtwx(
        X,
        pr.map(v => v * (1 - v))
      )
    ) || fit.Ai;
  const ybar = mean(y),
    ll = y.reduce((s, v, i) => s + (v ? Math.log(Math.max(pr[i], 1e-300)) : Math.log(Math.max(1 - pr[i], 1e-300))), 0),
    ll0 = y.reduce((s, v) => s + (v ? Math.log(ybar) : Math.log(1 - ybar)), 0);
  const dev = -2 * ll,
    dev0 = -2 * ll0,
    se = Ai.map((r, k) => Math.sqrt(r[k])),
    z = b.map((v, k) => v / se[k]);
  const LR = dev0 - dev,
    df = p - 1,
    cs = 1 - Math.exp((dev - dev0) / n),
    nag = cs / (1 - Math.exp(-dev0 / n));
  const tab = [
    [0, 0],
    [0, 0],
  ];
  pr.forEach((v, i) => tab[y[i]][v >= 0.5 ? 1 : 0]++);
  const separation = !conv || b.some(v => Math.abs(v) > 15) || se.some(v => !isFinite(v) || v > 1e3);
  return {
    b,
    se,
    z,
    p: z.map(pZ),
    or: b.map(Math.exp),
    ci: b.map((v, k) => [Math.exp(v - 1.959964 * se[k]), Math.exp(v + 1.959964 * se[k])]),
    dev,
    dev0,
    LR,
    df,
    pLR: pChi(LR, df),
    cs,
    nag,
    hl: hosmerLemeshow(pr, y),
    tab,
    acc: (tab[0][0] + tab[1][1]) / n,
    n,
    events: sum(y),
    iter: it + 1,
    conv,
    separation,
    prob: pr,
  };
}
// ---- Regresión logística multinomial ----

/** Probabilidades de cada categoría (0 = referencia) para los coeficientes bb apilados por categoría */
function probsMultinomial(X, bb, K) {
  const p = X[0].length;
  return X.map(x => {
    const e = [1];
    for (let k = 1; k < K; k++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += x[j] * bb[(k - 1) * p + j];
      e.push(Math.exp(Math.min(700, s)));
    }
    const t = sum(e);
    return e.map(v => v / t);
  });
}
/** Información observada (−hessiana) de la multinomial; con y, también el gradiente */
function infoMultinomial(X, P, K, y) {
  const p = X[0].length,
    q = (K - 1) * p,
    g = new Array(q).fill(0),
    H = Array.from({ length: q }, () => new Array(q).fill(0));
  X.forEach((x, i) => {
    if (y)
      for (let k = 1; k < K; k++) {
        const r = (y[i] === k ? 1 : 0) - P[i][k];
        for (let j = 0; j < p; j++) g[(k - 1) * p + j] += r * x[j];
      }
    for (let k = 1; k < K; k++)
      for (let l = 1; l < K; l++) {
        const w = P[i][k] * ((k === l ? 1 : 0) - P[i][l]);
        for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) H[(k - 1) * p + a][(l - 1) * p + c] += w * x[a] * x[c];
      }
  });
  return { g, H };
}
// X: n × p con la constante en la primera columna; y: índice de categoría 0..K-1 (0 = referencia)
function multinomial(X, y, K, maxit = 100) {
  const n = X.length,
    p = X[0].length,
    q = (K - 1) * p;
  const logLik = bb => sum(probsMultinomial(X, bb, K).map((pr, i) => Math.log(Math.max(1e-300, pr[y[i]]))));
  const paso = bb => {
    const { g, H } = infoMultinomial(X, probsMultinomial(X, bb, K), K, y),
      Hi = inv(H);
    return Hi ? Hi.map(r => sum(r.map((v, j) => v * g[j]))) : null;
  };
  const fit = newtonLL(new Array(q).fill(0), logLik, paso, { maxit, mitades: 30, tol: 1e-10 });
  if (fit.singular) return null;
  const b = fit.par,
    Pf = probsMultinomial(X, b, K),
    V = inv(infoMultinomial(X, Pf, K).H),
    se = V ? V.map((r, j) => Math.sqrt(r[j])) : b.map(() => NaN);
  const cnt = Array.from({ length: K }, (_, k) => y.filter(v => v === k).length),
    ll0 = sum(cnt.map(c => (c ? c * Math.log(c / n) : 0)));
  return {
    B: Array.from({ length: K - 1 }, (_, k) => b.slice(k * p, (k + 1) * p)),
    SE: Array.from({ length: K - 1 }, (_, k) => se.slice(k * p, (k + 1) * p)),
    ll: fit.L,
    ll0,
    n,
    p,
    K,
    iter: fit.it,
    pred: Pf.map(pr => pr.indexOf(maxOf(pr))),
    probs: Pf,
  };
}
// ---- Regresión logística ordinal (odds proporcionales) ----

const logit_ = z => 1 / (1 + Math.exp(-z));
const dlogit = z => {
  const e = logit_(z);
  return e * (1 - e);
};
/** Log-verosimilitud y gradiente del modelo de odds proporcionales; pp = [θ1..θK-1, β1..βp] */
function modeloOrdinal(X, y, K) {
  const p = X[0] ? X[0].length : 0;
  const eta = (pp, x) => {
    let s = 0;
    for (let j = 0; j < p; j++) s += x[j] * pp[K - 1 + j];
    return s;
  };
  const ll = pp => {
    for (let j = 1; j < K - 1; j++) if (pp[j] <= pp[j - 1]) return -Infinity;
    let s = 0;
    X.forEach((x, i) => {
      const e = eta(pp, x),
        k = y[i],
        up = k === K - 1 ? 1 : logit_(pp[k] - e),
        lo = k === 0 ? 0 : logit_(pp[k - 1] - e);
      s += Math.log(Math.max(1e-300, up - lo));
    });
    return s;
  };
  const grad = pp => {
    const g = new Array(K - 1 + p).fill(0);
    X.forEach((x, i) => {
      const e = eta(pp, x),
        k = y[i],
        up = k === K - 1 ? 1 : logit_(pp[k] - e),
        lo = k === 0 ? 0 : logit_(pp[k - 1] - e),
        pr = Math.max(1e-300, up - lo);
      const du = k === K - 1 ? 0 : dlogit(pp[k] - e),
        dl = k === 0 ? 0 : dlogit(pp[k - 1] - e);
      if (k < K - 1) g[k] += du / pr;
      if (k > 0) g[k - 1] -= dl / pr;
      for (let j = 0; j < p; j++) g[K - 1 + j] += (-(du - dl) / pr) * x[j];
    });
    return g;
  };
  return { eta, ll, grad };
}
// logit P(Y ≤ j) = θj − x·β (como MASS::polr); X: n × p SIN constante; y: 0..K-1 ordenada
function ordinalLogit(X, y, K, maxit = 200) {
  const n = X.length,
    p = X[0] ? X[0].length : 0,
    { eta, ll, grad } = modeloOrdinal(X, y, K);
  const cnt = Array.from({ length: K }, (_, k) => y.filter(v => v === k).length);
  let acc = 0;
  const th = cnt.slice(0, K - 1).map(c => {
    acc += c;
    const pr = Math.min(0.999, Math.max(0.001, acc / n));
    return Math.log(pr / (1 - pr));
  });
  const infoObs = pp => hessianaNumerica(grad, pp).map(r => r.map(v => -v));
  const paso = pp => {
    const g = grad(pp),
      Hi = inv(infoObs(pp));
    return Hi ? Hi.map(r => sum(r.map((v, j) => v * g[j]))) : null;
  };
  const { par, L, it } = newtonLL(th.concat(new Array(p).fill(0)), ll, paso, { maxit, mitades: 40, tol: 1e-11 });
  const Vc = inv(infoObs(par)),
    se = Vc ? Vc.map((r, j) => Math.sqrt(r[j])) : par.map(() => NaN);
  const ll0 = sum(cnt.map(c => (c ? c * Math.log(c / n) : 0)));
  const pred = X.map(x => {
    const e = eta(par, x),
      pr = Array.from(
        { length: K },
        (_, k) => (k === K - 1 ? 1 : logit_(par[k] - e)) - (k === 0 ? 0 : logit_(par[k - 1] - e))
      );
    return pr.indexOf(maxOf(pr));
  });
  return {
    theta: par.slice(0, K - 1),
    beta: par.slice(K - 1),
    seTheta: se.slice(0, K - 1),
    seBeta: se.slice(K - 1),
    ll: L,
    ll0,
    n,
    p,
    K,
    iter: it,
    pred,
  };
}
// prueba de Brant (1990) de odds proporcionales: una logística binaria por corte (Y > j) y covarianza conjunta de sus coeficientes
// X: n × p SIN constante; y: 0..K-1; groups: columnas de cada predictor (las ficticias de un factor van juntas). Devuelve la prueba
// global y una por predictor. Nota: el paquete brant de R copia los bloques de covarianza entre cortes sin trasponerlos, por lo que
// con varios predictores su χ² difiere ligeramente; aquí se usa la matriz simétrica correcta (comprobado en R: 2026-10-15).
function brantTest(X, y, K, groups = null) {
  const p = X[0].length,
    Xc = X.map(r => [1].concat(r)),
    fits = [];
  for (let j = 0; j < K - 1; j++) {
    const yy = y.map(v => (v > j ? 1 : 0)),
      m = logistic(Xc, yy);
    if (!m) return null;
    fits.push({ b: m.b, pi: Xc.map(x => 1 / (1 + Math.exp(-sum(x.map((v, a) => v * m.b[a]))))) });
  }
  const q = p + 1,
    XtWX = w => xtwx(Xc, w);
  const Inv = fits.map(fi => inv(XtWX(fi.pi.map(v => v * (1 - v)))));
  const J_ = K - 1,
    V = Array.from({ length: J_ * p }, () => new Array(J_ * p).fill(0));
  for (let a = 0; a < J_; a++)
    for (let c = a; c < J_; c++) {
      const w = fits[a].pi.map((_, i) =>
        a === c ? fits[a].pi[i] * (1 - fits[a].pi[i]) : fits[c].pi[i] - fits[a].pi[i] * fits[c].pi[i]
      );
      const blk = matMul(matMul(Inv[a], XtWX(w)), Inv[c]);
      for (let u = 1; u < q; u++)
        for (let v = 1; v < q; v++) {
          V[a * p + u - 1][c * p + v - 1] = blk[u][v];
          V[c * p + v - 1][a * p + u - 1] = blk[u][v];
        }
    }
  const beta = [].concat(...fits.map(fi => fi.b.slice(1)));
  const test = vars => {
    // vars: índices de predictores incluidos en la prueba
    const rows = [];
    for (let j = 1; j < J_; j++)
      vars.forEach(v => {
        const r = new Array(J_ * p).fill(0);
        r[v] = 1;
        r[j * p + v] = -1;
        rows.push(r);
      });
    const Db = rows.map(r => sum(r.map((x, k) => x * beta[k]))),
      DVD = rows.map(r => rows.map(s2 => sum(r.map((x, k) => x * sum(s2.map((y_, l) => y_ * V[k][l])))))),
      Mi = inv(DVD);
    if (!Mi) return { chi: NaN, df: rows.length, p: NaN };
    const chi = sum(Db.map((d, a) => d * sum(Db.map((e, c) => Mi[a][c] * e))));
    return { chi, df: rows.length, p: pChi(chi, rows.length) };
  };
  return { omnibus: test([...Array(p).keys()]), byVar: (groups || [...Array(p).keys()].map(v => [v])).map(test) };
}
// pseudo-R² a partir de las log-verosimilitudes (McFadden, Cox y Snell, Nagelkerke)
function pseudoR2(ll, ll0, n) {
  const cs = 1 - Math.exp((2 * (ll0 - ll)) / n),
    mx = 1 - Math.exp((2 * ll0) / n);
  return { mcfadden: 1 - ll / ll0, coxsnell: cs, nagelkerke: cs / mx };
}

export { logistic, multinomial, ordinalLogit, brantTest, pseudoR2 };
