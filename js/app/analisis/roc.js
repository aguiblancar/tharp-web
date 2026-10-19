/* Tharp · aplicación · Análisis: Curva ROC */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { catOf, levelsOf, numOf, vByName } from '../datos/variables.js';
import { f, list, nz, pt, pv, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

// Curva ROC: una o varias puntuaciones frente a un estado real dicotómico
function runRoc(xNames, yName, posLab) {
  const sec = nuevaSeccion(`Curva ROC: ${yName}`, { test: 'Análisis de la curva ROC' });
  if (!xNames.length) {
    sec.error = 'Selecciona al menos una puntuación.';
    return sec;
  }
  const yv = vByName(yName),
    y = catOf(yv),
    lv = levelsOf(yv);
  if (lv.length !== 2) {
    sec.error = 'El estado real debe tener exactamente 2 categorías.';
    return sec;
  }
  const pos = posLab && lv.includes(posLab) ? posLab : lv[1],
    neg = lv.find(l => l !== pos),
    res = [];
  xNames.forEach(nm => {
    const x = numOf(vByName(nm)),
      P = [],
      N = [];
    x.forEach((v, i) => {
      if (v === null || y[i] === null) return;
      (y[i] === pos ? P : N).push(v);
    });
    if (P.length < 2 || N.length < 2) return;
    let r = S.roc(P, N),
      flip = false;
    if (S.median(P) < S.median(N)) {
      r = S.roc(
        P.map(v => -v),
        N.map(v => -v)
      );
      flip = true;
    } // como pROC: dirección según las medianas
    res.push({ nm, r, flip, nP: P.length, nN: N.length });
  });
  if (!res.length) {
    sec.error = 'Hacen falta al menos 2 casos en cada categoría con puntuación.';
    return sec;
  }
  const lev = a =>
    a >= 0.9 ? 'excelente' : a >= 0.8 ? 'buena' : a >= 0.7 ? 'aceptable' : a >= 0.6 ? 'pobre' : 'insuficiente';
  const { n0 } = rocWhyAndChecks({ sec, res, pos, neg, yName });
  const { ct } = rocTables({ sec, res, pos, n0 });
  rocReport({ sec, res, lev, pos, neg, ct, yName });
  return sec;
}
/** Motivos del análisis ROC y avisos (puntuaciones invertidas, pocos casos) */
function rocWhyAndChecks({ sec, res, pos, neg, yName }) {
  sec.why.push(
    `Se evalúa si ${list(res.map(o => esc(o.nm)))} ${res.length > 1 ? 'distinguen' : 'distingue'} entre «${esc(pos)}» (positivos) y «${esc(neg)}» (negativos) en ${esc(yName)}.`
  );
  sec.why.push(
    'El área bajo la curva (AUC) es la probabilidad de que un caso positivo elegido al azar puntúe más que uno negativo: 0.5 = azar, 1 = discriminación perfecta. Intervalo y error típico de DeLong (como pROC, SPSS y jamovi).'
  );
  sec.why.push(
    'El punto de corte óptimo maximiza el índice de Youden (sensibilidad + especificidad − 1). Si los errores no cuestan lo mismo (por ejemplo, en cribado conviene no dejar escapar casos), puede preferirse otro corte de la tabla.'
  );
  sec.decision = `Se analizó la curva ROC de ${list(res.map(o => esc(o.nm)))} para distinguir «${esc(pos)}» de «${esc(neg)}».`;
  res.forEach(o => {
    if (o.flip)
      sec.checks.push(
        chk(
          'info',
          `En ${esc(o.nm)}, las puntuaciones más bajas corresponden a «${esc(pos)}»: el punto de corte se interpreta como «positivo si la puntuación es ≤ el corte».`
        )
      );
  });
  const n0 = res[0];
  if (Math.min(n0.nP, n0.nN) < 20)
    sec.checks.push(
      chk(
        'info',
        `Pocos casos en alguna categoría (${n0.nP} positivos, ${n0.nN} negativos): el AUC y el punto de corte serán imprecisos (ver el intervalo).`
      )
    );
  return { n0 };
}
/** Tablas de área bajo la curva, punto de corte óptimo (Youden) y comparación de curvas (DeLong) */
function rocTables({ sec, res, pos, n0 }) {
  sec.tables.push(
    apaTable(
      'Área bajo la curva ROC',
      ['Puntuación', 'AUC', '<i>EE</i>', 'IC 95 %', '<i>z</i>', '<i>p</i>', 'Positivos', 'Negativos'],
      res.map(o => [
        esc(o.nm),
        nz(o.r.auc.toFixed(3)),
        nz(o.r.se.toFixed(3)),
        `[${nz(o.r.ci[0].toFixed(3))}, ${nz(o.r.ci[1].toFixed(3))}]`,
        f(o.r.z),
        pv(o.r.p),
        o.nP,
        o.nN,
      ]),
      '<i>z</i> y <i>p</i> contrastan AUC = .5 (discriminación al azar). Orientativo (Hosmer y Lemeshow): .7–.8 aceptable, .8–.9 buena, ≥ .9 excelente.'
    )
  );
  const ct = v => (Math.abs(v) === Infinity ? '—' : +v.toFixed(4));
  sec.tables.push(
    apaTable(
      'Punto de corte óptimo (índice de Youden)',
      ['Puntuación', 'Corte', 'Sensibilidad', 'Especificidad', 'Youden', 'VPP', 'VPN', 'RV+', 'RV−'],
      res.map(o => {
        const b = o.r.best;
        return [
          esc(o.nm),
          `${o.flip ? '≤' : '≥'} ${ct(o.flip ? -b.t : b.t)}`,
          nz(b.se.toFixed(3)),
          nz(b.sp.toFixed(3)),
          nz(b.youden.toFixed(3)),
          nz(b.ppv.toFixed(3)),
          nz(b.npv.toFixed(3)),
          isFinite(b.lrp) ? f(b.lrp) : '∞',
          f(b.lrn),
        ];
      }),
      `Corte = punto medio entre dos puntuaciones observadas (como pROC y SPSS); se clasifica como «${esc(pos)}» quien cumple la condición. VPP y VPN dependen de la prevalencia de la muestra (${f((n0.nP / (n0.nP + n0.nN)) * 100, 1)} %). RV = razón de verosimilitudes.`
    )
  );
  const o0 = res[0],
    cut = o0.r.pts.filter(q => isFinite(q.t)),
    stepK = Math.max(1, Math.ceil(cut.length / 25));
  sec.tables.push(
    apaTable(
      `Coordenadas de la curva de ${o0.nm}`,
      ['Corte', 'Sensibilidad', 'Especificidad', 'Youden'],
      cut
        .filter((_, q) => q % stepK === 0)
        .map(q => [
          `${o0.flip ? '≤' : '≥'} ${ct(o0.flip ? -q.t : q.t)}`,
          nz(q.se.toFixed(3)),
          nz(q.sp.toFixed(3)),
          nz((q.se + q.sp - 1).toFixed(3)),
        ]),
      cut.length > 25 ? `Se muestra uno de cada ${stepK} cortes posibles.` : ''
    )
  );
  return { ct };
}
/** Figura de las curvas ROC, redacción APA y código R (pROC) */
function rocReport({ sec, res, lev, pos, neg, ct, yName }) {
  sec.charts.push(
    fig(
      `Curva ROC${res.length > 1 ? '' : ` de ${res[0].nm}`}`,
      CH.rocCurve(
        res.map(o => ({ name: o.nm, auc: o.r.auc, pts: o.r.pts })),
        res.length === 1 ? res[0].r.best : null
      ),
      res.length > 1 ? CH.legend(res.map(o => o.nm)) : ''
    )
  );
  sec.text.push(
    res
      .map(o => {
        const b = o.r.best;
        return `El área bajo la curva ROC de ${esc(o.nm)} fue ${nz(o.r.auc.toFixed(2))}, IC 95 % [${nz(o.r.ci[0].toFixed(2))}, ${nz(o.r.ci[1].toFixed(2))}], ${pt(o.r.p)}, lo que indica una capacidad de discriminación ${lev(o.r.auc)} entre «${esc(pos)}» y «${esc(neg)}». ${isFinite(b.t) ? `El punto de corte óptimo según el índice de Youden (${o.flip ? '≤' : '≥'} ${ct(o.flip ? -b.t : b.t)}) ofreció una sensibilidad de ${f(b.se * 100, 1)} % y una especificidad de ${f(b.sp * 100, 1)} %.` : 'Ningún punto de corte clasificó mejor que el azar (índice de Youden ≤ 0).'}`;
      })
      .join(' ')
  );
  sec.code =
    `# Curva ROC\nlibrary(pROC)\n` +
    res
      .map(
        o =>
          `r <- roc(datos[[${rq(yName)}]], datos[[${rq(o.nm)}]], levels = c(${rq(neg)}, ${rq(pos)}), direction = "${o.flip ? '>' : '<'}")\nauc(r); ci.auc(r, method = "delong")\nee <- sqrt(var(r)); z <- (as.numeric(auc(r)) - .5) / ee; c(AUC = as.numeric(auc(r)), EE = ee, z = z, p = 2 * pnorm(-abs(z)))  # EE de DeLong\n` +
          `b <- coords(r, "best", best.method = "youden", ret = c("threshold", "sensitivity", "specificity", "ppv", "npv"), transpose = FALSE)\nb$youden <- b$sensitivity + b$specificity - 1; b$RV_pos <- b$sensitivity / (1 - b$specificity); b$RV_neg <- (1 - b$sensitivity) / b$specificity; print(b, digits = 7)\n` +
          `cc <- coords(r, "all", ret = c("threshold", "sensitivity", "specificity"), transpose = FALSE); cc$youden <- cc$sensitivity + cc$specificity - 1; print(cc, digits = 7)  # coordenadas\nplot(r)`
      )
      .join('\n');
}

export { runRoc };
