/* Tharp · aplicación · Análisis: Análisis de supervivencia (Kaplan-Meier, log-rank y Cox) */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { catOf, levelsOf, numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, fmtNum, list, nz, pt, pv, rn, rq } from '../formato.js';
import { apaTable, chk, design, fig, nuevaSeccion } from '../resultados/piezas.js';

// Supervivencia: Kaplan-Meier (con IC de la mediana), log-rank entre grupos y regresión de Cox (empates de Efron)
function runSurv(tN, eN, gN, xNames) {
  const sec = nuevaSeccion(`Supervivencia: ${tN || ''}${gN ? ` según ${gN}` : ''}`, {
    test: 'Análisis de supervivencia',
  });
  const eLvSel = eN && eN.includes('\u0001') ? eN.split('\u0001')[1] : null;
  if (eLvSel !== null) eN = eN.split('\u0001')[0];
  if (!tN || !eN || !vByName(tN) || !vByName(eN)) {
    sec.error = 'Elige la variable de tiempo y la del evento.';
    return sec;
  }
  if (tN === eN) {
    sec.error = 'El tiempo y el evento deben ser variables distintas.';
    return sec;
  }
  const tv = numOf(vByName(tN)),
    ev = vByName(eN),
    eAll = ev.type === 'cat' ? levelsOf(ev) : null;
  // con una variable categórica, la persona elige qué categoría es el evento (eLv[1]); la otra es la censura (eLv[0])
  const eLv = eAll ? (eLvSel !== null && eAll.includes(eLvSel) ? [eAll.find(l => l !== eLvSel), eLvSel] : eAll) : null;
  const evOf = i => {
    const x = ev.raw[i];
    if (x === null) return null;
    if (eLv) return String(x) === eLv[1] ? 1 : String(x) === eLv[0] ? 0 : null;
    const n_ = numOf(ev)[i];
    return n_ === 1 ? 1 : n_ === 0 ? 0 : null;
  };
  const gv = gN ? catOf(vByName(gN)) : null,
    gl = gN ? levelsOf(vByName(gN)) : null;
  xNames = xNames.filter(n => ![tN, eN].includes(n));
  const ok = i => tv[i] !== null && tv[i] >= 0 && evOf(i) !== null && (!gv || (gv[i] !== null && gl.includes(gv[i])));
  const idx = ST.rows.map((_, i) => i).filter(ok),
    t = idx.map(i => tv[i]),
    e = idx.map(evOf),
    n = idx.length,
    ne = S.sum(e);
  if (n < 5 || ne < 2) {
    sec.error = 'Se necesitan al menos 5 casos y 2 eventos.';
    return sec;
  }
  const evTxt = eLv ? `«${esc(eLv[1])}»` : '1';
  sec.decision = `Análisis de supervivencia de ${esc(tN)} con ${n} casos: ${ne} eventos (${esc(eN)} = ${evTxt}) y ${n - ne} censurados${eLv ? ` (${esc(eN)} = «${esc(eLv[0])}»)` : ''}.`;
  sec.why.push(
    'El análisis de supervivencia estudia el tiempo hasta un evento teniendo en cuenta a quienes todavía no lo han tenido al final del seguimiento (casos censurados): no se pueden excluir ni tratar como si el evento no fuera a ocurrir.'
  );
  sec.why.push(
    'La curva de Kaplan-Meier estima la proporción que sigue sin el evento en cada momento; la mediana es el tiempo en que esa proporción baja al 50 %.'
  );
  const { km, lr } = survKaplanMeier({ gv, gl, idx, sec, gN, tN, n, ne, t, e });
  survCoxAndCode({ xNames, tN, eLv, eN, sec, gN, km, lr, evOf, ok, tv });
  return sec;
}
/** Kaplan-Meier por grupo: medianas, tabla de vida, curvas, redacción y log-rank */
function survKaplanMeier({ gv, gl, idx, sec, gN, tN, n, ne, t, e }) {
  const grp = gv
    ? gl.map(l => ({ name: l, ii: idx.map((i, q) => q).filter(q => gv[idx[q]] === l) })).filter(o => o.ii.length)
    : [{ name: 'Todos', ii: idx.map((_, q) => q) }];
  const km = grp.map(o => ({
    name: o.name,
    r: S.kaplanMeier(
      o.ii.map(q => t[q]),
      o.ii.map(q => e[q])
    ),
    times: o.ii.map(q => t[q]),
    cens: o.ii.filter(q => e[q] === 0).map(q => t[q]),
  }));
  const md = v => (isFinite(v) ? f(v) : 'no alcanzada');
  sec.tables.push(
    apaTable(
      'Supervivencia mediana (Kaplan-Meier)',
      [gN ? esc(gN) : '', '<i>n</i>', 'Eventos', 'Censurados', 'Mediana', 'IC 95 %'],
      km.map(o => [
        esc(o.name),
        o.r.n,
        o.r.events,
        o.r.n - o.r.events,
        md(o.r.median),
        `[${md(o.r.medianCI[0])}, ${md(o.r.medianCI[1])}]`,
      ]),
      'IC de la mediana a partir del IC de la curva (escala logarítmica, como survival::survfit). «No alcanzada»: la supervivencia no bajó del 50 % (o el límite del IC no llega a cruzarlo).'
    )
  );
  const lt = km[0].r.rows.length <= 30 ? km : null;
  if (lt)
    sec.tables.push(
      apaTable(
        'Tabla de supervivencia',
        (gN ? [esc(gN)] : []).concat(['Tiempo', 'En riesgo', 'Eventos', 'S(t)', '<i>EE</i>', 'IC 95 %']),
        km.flatMap(o =>
          o.r.rows.map((r, k) =>
            (gN ? [k === 0 ? esc(o.name) : ''] : []).concat([
              fmtNum(r.t),
              r.nrisk,
              r.nevent,
              nz(r.surv.toFixed(3)),
              isFinite(r.se) ? nz(r.se.toFixed(3)) : '—',
              isFinite(r.lower) ? `[${nz(r.lower.toFixed(3))}, ${nz(r.upper.toFixed(3))}]` : '—',
            ])
          )
        ),
        'EE de Greenwood. Solo se muestran los tiempos con algún evento.'
      )
    );
  sec.charts.push(
    fig(
      `Curvas de supervivencia de Kaplan-Meier${gN ? ` por ${gN}` : ''}`,
      CH.kmCurve(
        km.map(o => ({ name: o.name, rows: o.r.rows, times: o.times, cens: o.cens })),
        tN
      ),
      gN ? CH.legend(km.map(o => o.name)) : ''
    )
  );
  let txt =
    `Se estimaron las curvas de supervivencia de Kaplan-Meier para ${esc(tN)} (${n} casos, ${ne} eventos). ` +
    km
      .map(
        o =>
          `${gN ? `En ${esc(o.name)}, l` : 'L'}a mediana fue ${isFinite(o.r.median) ? `${f(o.r.median)}, IC 95 % [${md(o.r.medianCI[0])}, ${md(o.r.medianCI[1])}]` : 'no alcanzada (más del 50 % no tuvo el evento)'}`
      )
      .join('; ') +
    '.';
  let lr = null;
  if (gN && km.length >= 2) {
    const gi = idx.map(i => km.findIndex(o => o.name === gv[i]));
    lr = S.logrank(t, e, gi, km.length);
    sec.tables.push(
      apaTable(
        'Prueba de log-rank',
        [esc(gN), 'Observados', 'Esperados'],
        km.map((o, j) => [esc(o.name), lr.O[j], f(lr.E[j])]),
        `χ²(${lr.df}) = ${f(lr.chi)}, ${pt(lr.p)}. Compara las curvas de supervivencia (mismo peso a todos los momentos).`
      )
    );
    txt += ` La prueba de log-rank ${lr.p < 0.05 ? 'mostró diferencias significativas' : 'no mostró diferencias significativas'} entre las curvas, χ²(${lr.df}) = ${f(lr.chi)}, ${pt(lr.p)}.`;
  }
  sec.text.push(txt);
  return { km, lr };
}
/** Regresión de Cox con covariables y código R del análisis de supervivencia */
function survCoxAndCode({ xNames, tN, eLv, eN, sec, gN, km, lr, evOf, ok, tv }) {
  let cx = null,
    cols;
  if (xNames.length) {
    const d_ = design(xNames, i => ok(i));
    cols = d_.cols.slice(1);
    const tt = d_.idx.map(i => tv[i]),
      ee = d_.idx.map(evOf),
      X = d_.X.map(r => r.slice(1)),
      EPV = S.sum(ee) / cols.length;
    cx = S.cox(X, tt, ee);
    if (!cx || cx.b.some(v => !isFinite(v) || Math.abs(v) > 15))
      sec.checks.push(
        chk(
          'no',
          'La regresión de Cox no converge con estos datos (posible separación: algún predictor anticipa el evento casi perfectamente, o hay muy pocos eventos). Reduce el número de predictores.'
        )
      );
    else {
      sec.checks.push(
        chk(
          EPV >= 10 ? 'ok' : 'no',
          `Eventos por predictor: ${f(EPV, 1)}${EPV >= 10 ? '.' : ' (se recomiendan al menos 10): los coeficientes pueden ser inestables.'}`
        )
      );
      sec.checks.push(
        chk(
          'info',
          'Riesgos proporcionales: la regresión de Cox supone que el efecto de cada predictor es constante en el tiempo. Compruébalo en R con cox.zph (está en el script) o mirando si las curvas de Kaplan-Meier se cruzan.'
        )
      );
      sec.tables.push(
        apaTable(
          'Regresión de Cox',
          ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'HR', 'IC 95 % (HR)'],
          cols.map((c, j) => [
            esc(c.name),
            f(cx.b[j], 3),
            f(cx.se[j], 3),
            f(cx.z[j]),
            pv(cx.p[j]),
            f(cx.hr[j]),
            `[${f(cx.ci[j][0])}, ${f(cx.ci[j][1])}]`,
          ]),
          `HR = hazard ratio (exp(B)); empates de Efron. Modelo global: razón de verosimilitudes χ²(${cx.lr.df}) = ${f(cx.lr.chi)}, ${pt(cx.lr.p)}; Wald χ²(${cx.wald.df}) = ${f(cx.wald.chi)}, ${pt(cx.wald.p)}; puntuación (log-rank) χ²(${cx.score.df}) = ${f(cx.score.chi)}, ${pt(cx.score.p)}. ${cx.n} casos, ${cx.events} eventos.`
        )
      );
      const sig = cols.map((c, j) => ({ c, j })).filter(o => cx.p[o.j] < 0.05);
      sec.text.push(
        `Se ajustó una regresión de riesgos proporcionales de Cox con ${list(xNames.map(esc))} (${cx.n} casos, ${cx.events} eventos). El modelo ${cx.lr.p < 0.05 ? 'fue' : 'no fue'} estadísticamente significativo, χ²(${cx.lr.df}) = ${f(cx.lr.chi)}, ${pt(cx.lr.p)}. ` +
          (sig.length
            ? sig
                .map(
                  o =>
                    `${esc(o.c.name)} se asoció con un riesgo ${cx.b[o.j] > 0 ? 'mayor' : 'menor'} del evento (HR = ${f(cx.hr[o.j])}, IC 95 % [${f(cx.ci[o.j][0])}, ${f(cx.ci[o.j][1])}], ${pt(cx.p[o.j])})`
                )
                .join('; ') + '.'
            : 'Ningún predictor se asoció significativamente con el riesgo del evento.')
      );
    }
  }
  const Tq = rq(tN),
    Eexpr = eLv ? `as.integer(datos[[${rq(eN)}]] == ${rq(eLv[1])})` : `datos[[${rq(eN)}]]`;
  sec.code =
    `# Supervivencia: ${tN}${gN ? ` según ${gN}` : ''}\nlibrary(survival)\nd <- data.frame(tiempo = datos[[${Tq}]], evento = ${Eexpr}${gN ? `, grupo = droplevels(datos[[${rq(gN)}]])` : ''})\nd <- d[complete.cases(d) & d$tiempo >= 0, ]  # casos para Kaplan-Meier y log-rank\n` +
    `km <- survfit(Surv(tiempo, evento) ~ ${gN ? 'grupo' : '1'}, data = d)\nkm  # n, eventos, mediana e IC\nprint(summary(km), digits = 7)  # tabla de supervivencia (EE de Greenwood, IC en escala log)\nprint(quantile(km, .5), digits = 7)  # mediana con IC\nplot(km, mark.time = TRUE${gN ? `, col = 1:${km.length}` : ''})\n` +
    (lr
      ? `lr <- survdiff(Surv(tiempo, evento) ~ grupo, data = d); lr\nprint(cbind(observados = lr$obs, esperados = lr$exp), digits = 7)\nc(chi2 = lr$chisq, gl = length(lr$n) - 1, p = pchisq(lr$chisq, length(lr$n) - 1, lower.tail = FALSE))\n`
      : '') +
    (cx
      ? `dc <- data.frame(tiempo = datos[[${Tq}]], evento = ${Eexpr}${gN ? `, grupo = datos[[${rq(gN)}]]` : ''}, ${xNames.map(x => `${rn(x)} = datos[[${rq(x)}]]`).join(', ')}, check.names = FALSE)\ndc <- dc[complete.cases(dc) & dc$tiempo >= 0, ]  # casos para Cox (también con los predictores)\ncox <- coxph(Surv(tiempo, evento) ~ ${xNames.map(rn).join(' + ')}, data = dc, ties = "efron")\nprint(summary(cox), digits = 7)\nc(LR = 2 * diff(cox$loglik), Wald = unname(cox$wald.test), puntuacion = unname(cox$score))  # pruebas globales sin redondear\ncox.zph(cox)  # riesgos proporcionales (p < .05 indica que no se cumplen)`
      : '');
}

export { runSurv };
