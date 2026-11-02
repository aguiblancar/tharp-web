/* Tharp · motor estadístico · Curvas ROC */
import { mean, variance } from './base.js';
import { pZ } from './distribuciones.js';

// pos: puntuaciones de los casos positivos; neg: de los negativos. Se asume que puntuaciones más altas indican positivo.
function roc(pos, neg) {
  const m = pos.length,
    n = neg.length,
    psi = (x, y) => (x > y ? 1 : x === y ? 0.5 : 0);
  const V10 = pos.map(x => mean(neg.map(y => psi(x, y)))),
    V01 = neg.map(y => mean(pos.map(x => psi(x, y)))),
    auc = mean(V10);
  const se = Math.sqrt(variance(V10) / m + variance(V01) / n),
    z = (auc - 0.5) / se;
  const ci = [Math.max(0, auc - 1.959963984540054 * se), Math.min(1, auc + 1.959963984540054 * se)];
  // umbrales: puntos medios entre valores distintos consecutivos (como pROC y SPSS); positivo si puntuación ≥ umbral
  const u = [...new Set(pos.concat(neg))].sort((a, b) => a - b),
    th = [-Infinity].concat(u.slice(1).map((v, i) => (v + u[i]) / 2)).concat([Infinity]);
  const pts = th.map(t => {
    const tp = pos.filter(x => x >= t).length,
      tn = neg.filter(y => y < t).length;
    return { t, se: tp / m, sp: tn / n, tp, fp: n - tn, fn: m - tp, tn };
  });
  let best = pts.slice(1, -1).reduce((b, q) => (q.se + q.sp > b.se + b.sp ? q : b), pts[1] || pts[0]);
  if (best.se + best.sp - 1 < 0) best = pts[0]; // ningún corte finito mejora el azar: el óptimo es no clasificar (Youden = 0), como pROC
  const ppv = best.tp / (best.tp + best.fp),
    npv = best.tn / (best.tn + best.fn);
  return {
    auc,
    se,
    ci,
    z,
    p: pZ(z),
    m,
    n,
    pts,
    best: Object.assign({}, best, {
      youden: best.se + best.sp - 1,
      ppv,
      npv,
      lrp: best.se / (1 - best.sp),
      lrn: (1 - best.se) / best.sp,
    }),
  };
}

export { roc };
