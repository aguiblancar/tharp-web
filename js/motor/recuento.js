/* Tharp · motor estadístico · Regresión de Poisson y binomial negativa */
import { J, digamma, mean, sum, trigamma } from './base.js';
import { pZ } from './distribuciones.js';
import { inv } from './algebra.js';
import { xtwx } from './mlg.js';

// ---- Regresión de Poisson y binomial negativa ----
// θ = ∞ es Poisson. y: recuentos (enteros ≥ 0); mu: medias ajustadas.

const ylogy = (v, m) => (v > 0 ? v * Math.log(v / m) : 0);
/** Devianza de Poisson (θ = ∞) o binomial negativa */
function devianzaRecuento(y, mu, t) {
  return (
    2 *
    sum(
      y.map((v, i) =>
        isFinite(t) ? ylogy(v, mu[i]) - (v + t) * Math.log((v + t) / (mu[i] + t)) : ylogy(v, mu[i]) - (v - mu[i])
      )
    )
  );
}
/** lgamma(y + θ) − lgamma(θ), estable con θ muy grande: Σ log(θ + j), j < y (exacto para recuentos enteros) */
function lgammaRatio(v, t) {
  if (v !== Math.round(v) || v > 1e5) return J.gammaln(v + t) - J.gammaln(t);
  let s_ = 0;
  for (let j = 0; j < v; j++) s_ += Math.log(t + j);
  return s_;
}
/** Log-verosimilitud de Poisson o binomial negativa */
function llRecuento(y, mu, t) {
  return sum(
    y.map((v, i) =>
      isFinite(t)
        ? lgammaRatio(v, t) - J.gammaln(v + 1) - t * Math.log1p(mu[i] / t) + v * Math.log(mu[i] / (t + mu[i]))
        : v * Math.log(mu[i]) - mu[i] - J.gammaln(v + 1)
    )
  );
}
/** Pesos del IRLS con enlace logarítmico: μ (Poisson) o μ / (1 + μ/θ) */
const pesosRecuento = (mu, t) => mu.map(m => (isFinite(t) ? m / (1 + m / t) : m));
/** IRLS con θ fijo; b0: valores iniciales opcionales. Devuelve { b, mu, Ai } o null si X'WX es singular */
function irlsRecuento(X, y, o, t, b0) {
  const n = X.length,
    p = X[0].length,
    muOf = b => X.map((r, i) => Math.exp(o[i] + sum(r.map((v, k) => v * b[k]))));
  let b = b0 ? b0.slice() : new Array(p).fill(0),
    dev0 = Infinity;
  if (!b0) b[0] = Math.log(Math.max(mean(y), 1e-8)) - mean(o);
  for (let it = 0; it < 200; it++) {
    const mu = muOf(b),
      w = pesosRecuento(mu, t),
      Ai = inv(xtwx(X, w));
    if (!Ai) return null;
    const zw = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const z = Math.log(mu[i]) - o[i] + (y[i] - mu[i]) / mu[i];
      for (let a = 0; a < p; a++) zw[a] += w[i] * X[i][a] * z;
    }
    b = Ai.map(r => sum(r.map((v, k) => v * zw[k])));
    const dv = devianzaRecuento(y, muOf(b), t);
    if (Math.abs(dv - dev0) / (Math.abs(dv) + 0.1) < 1e-14) break;
    dev0 = dv;
  }
  const mu = muOf(b),
    Ai = inv(xtwx(X, pesosRecuento(mu, t)));
  return Ai ? { b, mu, Ai } : null;
}
/** Información de θ (−d²ll/dθ²) dados los μ */
function infoTheta(y, mu, t) {
  return sum(y.map((v, i) => -trigamma(t + v) + trigamma(t) - 1 / t + 2 / (mu[i] + t) - (v + t) / (mu[i] + t) ** 2));
}
/** θ de máxima verosimilitud dados los μ (Newton, como MASS::theta.ml); Infinity si no hay sobredispersión */
function thetaML(y, mu, t0) {
  const n = y.length;
  let t = t0 || n / sum(y.map((v, i) => (v / mu[i] - 1) ** 2));
  if (!(t > 0) || !isFinite(t)) t = 1;
  for (let it = 0; it < 200; it++) {
    const sc = sum(
      y.map((v, i) => digamma(t + v) - digamma(t) + Math.log(t) + 1 - Math.log(t + mu[i]) - (v + t) / (mu[i] + t))
    );
    let tn = t + sc / infoTheta(y, mu, t);
    if (!(tn > 0)) tn = t / 2;
    if (tn > 1e8) return Infinity; // sin sobredispersión: el límite es Poisson
    const ok = Math.abs(tn - t) < 1e-12 * Math.max(1, t);
    t = tn;
    if (ok) break;
  }
  return t;
}
/** Binomial negativa: alterna IRLS con θ fijo y θ de máxima verosimilitud hasta la convergencia, como glm.nb */
function ajusteBinomialNegativa(X, y, o, fit0) {
  let fit = fit0,
    theta = thetaML(y, fit.mu),
    l0 = -Infinity;
  for (let it = 0; it < 500 && isFinite(theta); it++) {
    fit = irlsRecuento(X, y, o, theta, fit.b);
    if (!fit) return null;
    const t2 = thetaML(y, fit.mu, theta);
    if (!isFinite(t2)) return { fit: irlsRecuento(X, y, o, Infinity, fit.b), theta: Infinity };
    const l1 = llRecuento(y, fit.mu, t2);
    const done = Math.abs(t2 - theta) < 1e-11 * theta && Math.abs(l1 - l0) < 1e-11;
    theta = t2;
    l0 = l1;
    if (done) break;
  }
  if (isFinite(theta)) fit = irlsRecuento(X, y, o, theta, fit.b);
  return fit ? { fit, theta } : null;
}
// X: n × p con constante; y: recuentos (enteros ≥ 0); family: 'poisson' | 'negbin'; off: desplazamiento opcional (log de la exposición).
function countReg(X, y, family = 'poisson', off = null) {
  const n = X.length,
    p = X[0].length,
    o = off || new Array(n).fill(0),
    NB = family === 'negbin';
  let fit = irlsRecuento(X, y, o, Infinity),
    theta = Infinity;
  if (!fit) return null;
  if (NB) {
    const r = ajusteBinomialNegativa(X, y, o, fit);
    if (!r || !r.fit) return null;
    ({ fit, theta } = r);
  }
  const se = fit.Ai.map((r, k) => Math.sqrt(r[k])),
    z = fit.b.map((v, k) => v / se[k]),
    L = llRecuento(y, fit.mu, theta),
    dfr = n - p;
  const pear = sum(
    y.map((v, i) => (v - fit.mu[i]) ** 2 / (NB && isFinite(theta) ? fit.mu[i] + fit.mu[i] ** 2 / theta : fit.mu[i]))
  );
  return {
    family,
    b: fit.b,
    se,
    z,
    p: z.map(pZ),
    irr: fit.b.map(Math.exp),
    ci: fit.b.map((v, k) => [Math.exp(v - 1.959963984540054 * se[k]), Math.exp(v + 1.959963984540054 * se[k])]),
    ll: L,
    dev: devianzaRecuento(y, fit.mu, theta),
    dfr,
    aic: -2 * L + 2 * (p + (NB ? 1 : 0)),
    pearson: pear,
    dispersion: pear / dfr,
    theta,
    thetaSE: NB && isFinite(theta) ? 1 / Math.sqrt(infoTheta(y, fit.mu, theta)) : NaN,
    mu: fit.mu,
    n,
    poissonLimit: NB && !isFinite(theta),
  };
}

export { countReg };
