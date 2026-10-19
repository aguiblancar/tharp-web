/* Tharp · motor estadístico · Potencia y tamaño muestral */
import { J } from './base.js';
import { ncChisqCdf, pncf, pnct } from './distribuciones.js';

const powerFns = {
  // d de Cohen; n por grupo (n2 = ratio·n1 en independientes); type: 'ind' | 'paired' | 'one'
  t: ({ d, n, alpha = 0.05, alt = 'two', type = 'ind', ratio = 1 }) => {
    const n1 = n,
      n2 = type === 'ind' ? Math.max(2, Math.round(n * ratio)) : 0;
    const df = type === 'ind' ? n1 + n2 - 2 : n - 1,
      ncp = type === 'ind' ? d * Math.sqrt((n1 * n2) / (n1 + n2)) : d * Math.sqrt(n);
    if (alt === 'two') {
      const tc = J.studentt.inv(1 - alpha / 2, df);
      return 1 - pnct(tc, df, ncp) + pnct(-tc, df, ncp);
    }
    const tc = J.studentt.inv(1 - alpha, df);
    return alt === 'less' ? pnct(-tc, df, ncp) : 1 - pnct(tc, df, ncp);
  },
  // ANOVA de un factor: k grupos, n por grupo, f de Cohen
  anova: ({ f, n, k, alpha = 0.05 }) => {
    const d1 = k - 1,
      d2 = k * (n - 1),
      lam = k * n * f * f,
      Fc = J.centralF.inv(1 - alpha, d1, d2);
    return 1 - pncf(Fc, d1, d2, lam);
  },
  // regresión: u predictores contrastados, N total, f² de Cohen (pwr.f2.test: λ = f²·(u + v + 1))
  reg: ({ f2, n, u, alpha = 0.05 }) => {
    const v = n - u - 1;
    if (v < 1) return NaN;
    const Fc = J.centralF.inv(1 - alpha, u, v);
    return 1 - pncf(Fc, u, v, f2 * (u + v + 1));
  },
  // χ²: w de Cohen, N total, gl
  chi: ({ w, n, df, alpha = 0.05 }) => {
    const cc = J.chisquare.inv(1 - alpha, df);
    return 1 - ncChisqCdf(cc, df, n * w * w);
  },
  // correlación: aproximación de Fisher con la corrección de pwr.r.test
  r: ({ r, n, alpha = 0.05, alt = 'two' }) => {
    const tside = alt === 'two' ? 2 : 1,
      tt = J.studentt.inv(1 - alpha / tside, n - 2),
      rc = Math.sqrt((tt * tt) / (tt * tt + n - 2));
    const zr = Math.atanh(r) + r / (2 * (n - 1)),
      zrc = Math.atanh(rc),
      sq = Math.sqrt(n - 3);
    if (alt === 'two') return J.normal.cdf((zr - zrc) * sq, 0, 1) + J.normal.cdf((-zr - zrc) * sq, 0, 1);
    return alt === 'less' ? J.normal.cdf((-zr - zrc) * sq, 0, 1) : J.normal.cdf((zr - zrc) * sq, 0, 1);
  },
  // dos proporciones (h de Cohen, arcoseno), n por grupo
  p2: ({ h, n, alpha = 0.05, alt = 'two' }) => {
    const z = h * Math.sqrt(n / 2);
    if (alt === 'two') {
      const zc = J.normal.inv(1 - alpha / 2, 0, 1);
      return J.normal.cdf(z - zc, 0, 1) + J.normal.cdf(-z - zc, 0, 1);
    }
    const zc = J.normal.inv(1 - alpha, 0, 1);
    return alt === 'less' ? J.normal.cdf(-z - zc, 0, 1) : J.normal.cdf(z - zc, 0, 1);
  },
};
// potencia para un n dado, o el n mínimo para una potencia objetivo (búsqueda entera, como pwr redondeando hacia arriba)
function power(test, args) {
  return powerFns[test](args);
}
function sampleSize(test, args, target = 0.8, nmin = 2, nmax = 1e6) {
  let lo = nmin,
    hi = nmin;
  while (hi < nmax && !(power(test, Object.assign({}, args, { n: hi })) >= target)) {
    lo = hi;
    hi = Math.ceil(hi * 1.6) + 1;
  }
  if (hi >= nmax) return null;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (power(test, Object.assign({}, args, { n: mid })) >= target) hi = mid;
    else lo = mid;
  }
  return power(test, Object.assign({}, args, { n: lo })) >= target ? lo : hi;
}

export { powerFns, power, sampleSize };
