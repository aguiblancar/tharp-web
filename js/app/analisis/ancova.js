/* Tharp · aplicación · Análisis: ANCOVA */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { catOf, numOf, ordOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, list, nz, pt, pv, rn, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

function runAncova(yName, gName, covNames) {
  const sec = nuevaSeccion(
    covNames.length ? `${yName} según ${gName}, controlando ${covNames.join(', ')}` : `ANCOVA: ${yName} según ${gName}`,
    { test: 'ANCOVA (SC tipo III)' }
  );
  covNames = covNames.filter(n => n !== yName);
  if (!covNames.length) {
    sec.error = 'Selecciona al menos una covariable distinta de la variable dependiente.';
    return sec;
  }
  const yv = numOf(vByName(yName)),
    gc = catOf(vByName(gName)),
    cv = covNames.map(n => numOf(vByName(n)));
  const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && gc[i] !== null && cv.every(c => c[i] !== null));
  const lv = ordOf(
      vByName(gName),
      idx.map(i => gc[i])
    ),
    L = lv.length,
    n = idx.length;
  if (L < 2) {
    sec.error = 'El factor necesita al menos 2 grupos con datos.';
    return sec;
  }
  if (lv.some(l => idx.filter(i => gc[i] === l).length < 3)) {
    sec.error =
      'Algún grupo tiene menos de 3 casos completos: no se puede estimar la ANCOVA. Agrupa categorías o elige otro factor.';
    return sec;
  }
  if (n < L + covNames.length + 3) {
    sec.error = `Hay pocos casos completos (${n}) para este modelo.`;
    return sec;
  }
  const y = idx.map(i => yv[i]),
    g = idx.map(i => lv.indexOf(gc[i])),
    C = idx.map(i => cv.map(c => c[i]));
  const r = S.ancova(y, g, L, C);
  if (!r || !r.factor) {
    sec.error = 'No se pudo estimar el modelo: probablemente una covariable es constante o redundante.';
    return sec;
  }
  const lev = S.levene(lv.map((_, j) => r.resid.filter((_, i) => g[i] === j))),
    sw = S.shapiro(r.resid),
    cl = list(covNames.map(esc));
  sec.decision = `Se ajustó una ANCOVA para comparar ${esc(yName)} entre los ${L} grupos de ${esc(gName)} controlando ${cl}, con ${n} casos completos y sumas de cuadrados de tipo III.`;
  sec.why.push(
    `Variable dependiente: ${esc(yName)} → cuantitativa. Factor: ${esc(gName)} (${L} grupos). Covariable${covNames.length > 1 ? 's' : ''}: ${cl}.`
  );
  sec.why.push(
    'La ANCOVA compara los grupos como si todos tuvieran el mismo valor en las covariables: elimina su influencia y suele aumentar la potencia (por ejemplo, al ajustar por la puntuación previa en un diseño pre/post).'
  );
  sec.why.push(
    'Se informan las medias ajustadas (estimadas en la media de las covariables), que son las que compara el contraste.'
  );
  if (r.slopes)
    sec.checks.push(
      chk(
        r.slopes.p >= 0.05 ? 'ok' : 'no',
        `Homogeneidad de las pendientes de regresión (interacción factor × covariable): <i>F</i>(${r.slopes.df1}, ${r.slopes.df2}) = ${f(r.slopes.F)}, ${pt(r.slopes.p)}. ${r.slopes.p >= 0.05 ? 'Se cumple: la relación de la covariable con la variable dependiente es similar en todos los grupos.' : 'No se cumple: la relación con la covariable difiere entre grupos y la ANCOVA no es adecuada. Considera un modelo con interacción (moderación).'}`
      )
    );
  if (r.slopes && r.slopes.p < 0.05)
    sec.warn =
      'No se cumple la homogeneidad de las pendientes: las medias ajustadas pueden ser engañosas. Interpreta con cautela o consulta a un estadístico.';
  sec.checks.push(
    chk(
      lev.p >= 0.05 ? 'ok' : 'no',
      `Homogeneidad de varianzas de los residuos (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.${lev.p >= 0.05 ? ' Se cumple.' : ' No se cumple: interpreta con cautela si los grupos tienen tamaños distintos.'}`
    )
  );
  if (sw)
    sec.checks.push(
      chk(
        sw.p >= 0.05 ? 'ok' : n >= 100 ? 'info' : 'no',
        `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}.${sw.p >= 0.05 ? '' : n >= 100 ? ' Con muestras grandes el modelo es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña.'}`
      )
    );
  sec.checks.push(
    chk(
      'info',
      'Linealidad: se asume una relación lineal entre cada covariable y la variable dependiente dentro de cada grupo.'
    )
  );
  sec.alt =
    'Si no se cumple la homogeneidad de pendientes, un modelo de regresión con la interacción grupo × covariable.';
  ancovaTables({ lv, sec, yName, gName, cl, covNames, r, y, g, C });
  ancovaTextAndCode({ r, yName, gName, cl, covNames, lv, L, sec });
  return sec;
}
/** Medias observadas y ajustadas, tabla de la ANCOVA, comparaciones y gráfico */
function ancovaTables({ lv, sec, yName, gName, cl, covNames, r, y, g, C }) {
  const raw = lv.map((_, j) => S.describe(y.filter((_, i) => g[i] === j)));
  sec.tables.push(
    apaTable(
      `Medias observadas y ajustadas de ${yName} por ${gName}`,
      [
        esc(gName),
        '<i>n</i>',
        '<i>M</i>',
        '<i>DT</i>',
        '<i>M</i> ajustada',
        '<i>EE</i>',
        'IC 95 % (<i>M</i> ajustada)',
      ],
      lv.map((l, j) => [
        esc(l),
        raw[j].n,
        f(raw[j].mean),
        f(raw[j].sd),
        f(r.adj[j].mean),
        f(r.adj[j].se),
        `[${f(r.adj[j].ci[0])}, ${f(r.adj[j].ci[1])}]`,
      ]),
      `Medias ajustadas en la media de ${cl} (${covNames.map((nm, c) => `${esc(nm)} = ${f(S.mean(C.map(x => x[c])))}`).join('; ')}).`
    )
  );
  sec.tables.push(
    apaTable(
      'Resultado de la ANCOVA',
      ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>'],
      covNames
        .map((nm, c) => [
          esc(nm),
          f(r.covs[c].ss),
          1,
          f(r.covs[c].ms),
          f(r.covs[c].F),
          pv(r.covs[c].p),
          nz(r.covs[c].peta2.toFixed(3)),
        ])
        .concat([
          [
            esc(gName),
            f(r.factor.ss),
            r.factor.df,
            f(r.factor.ms),
            f(r.factor.F),
            pv(r.factor.p),
            nz(r.factor.peta2.toFixed(3)),
          ],
          ['Error', f(r.sse), r.dfE, f(r.mse), '', '', ''],
        ]),
      'SC de tipo III. η²<sub>p</sub> = eta cuadrado parcial.'
    )
  );
  sec.charts.push(
    fig(
      `${yName} por ${gName}: medias ajustadas e IC 95 %`,
      CH.meansCI(
        lv.map((l, j) => ({ name: l, x: y.filter((_, i) => g[i] === j), mean: r.adj[j].mean, ci: r.adj[j].ci })),
        yName + ' (ajustada)',
        { points: false }
      )
    )
  );
}
/** Redacción APA y código R de la ANCOVA */
function ancovaTextAndCode({ r, yName, gName, cl, covNames, lv, L, sec }) {
  const st = `<i>F</i>(${r.factor.df}, ${r.dfE}) = ${f(r.factor.F)}, ${pt(r.factor.p)}, η²<sub>p</sub> = ${nz(r.factor.peta2.toFixed(3))}`;
  let t = `Se realizó un análisis de covarianza (ANCOVA) para comparar ${esc(yName)} según ${esc(gName)}, controlando ${cl}. `;
  t +=
    list(
      covNames.map(
        (nm, c) =>
          `${esc(nm)} ${r.covs[c].p < 0.05 ? 'se relacionó significativamente' : 'no se relacionó significativamente'} con ${esc(yName)}, <i>F</i>(1, ${r.dfE}) = ${f(r.covs[c].F)}, ${pt(r.covs[c].p)}`
      )
    ) + '. ';
  t +=
    r.factor.p < 0.05
      ? `Tras ajustar por ${covNames.length > 1 ? 'las covariables' : 'la covariable'}, se encontraron diferencias estadísticamente significativas entre los grupos, ${st} (medias ajustadas: ${lv.map((l, j) => `${esc(l)} = ${f(r.adj[j].mean)}`).join('; ')}).`
      : `Tras ajustar por ${covNames.length > 1 ? 'las covariables' : 'la covariable'}, no se encontraron diferencias estadísticamente significativas entre los grupos, ${st}.`;
  if (r.factor.p < 0.05 && L > 2) {
    const sig = r.pairs.filter(o => o.padj < 0.05);
    t += sig.length
      ? ` Las comparaciones por pares de las medias ajustadas (corrección de Holm) mostraron diferencias entre ${list(sig.map(o => `${esc(lv[o.i])} y ${esc(lv[o.j])} (${pt(o.padj)})`))}.`
      : ' Las comparaciones por pares de las medias ajustadas (corrección de Holm) no detectaron diferencias entre pares concretos.';
  }
  if (r.factor.p < 0.05)
    sec.tables.push(
      apaTable(
        'Comparaciones por pares de las medias ajustadas (corrección de Holm)',
        ['Comparación', 'Diferencia', '<i>EE</i>', '<i>t</i>', '<i>gl</i>', '<i>p</i> ajustada'],
        r.pairs.map(o => [`${esc(lv[o.i])} − ${esc(lv[o.j])}`, f(o.diff), f(o.se), f(o.t), r.dfE, pv(o.padj)])
      )
    );
  sec.text.push(t);
  const Y = rn(yName),
    G = rn(gName),
    Cs = covNames.map(rn);
  sec.code =
    `# ANCOVA: ${yName} ~ ${gName} + ${covNames.join(' + ')}\noptions(contrasts = c("contr.sum", "contr.poly"))\nmodelo <- lm(${Y} ~ ${G} + ${Cs.join(' + ')}, data = datos)\ncar::Anova(modelo, type = 3)\naggregate(modelo$model[[1]], by = list(nivel = modelo$model[[${rq(gName)}]]), FUN = function(x) c(n = length(x), M = mean(x), DT = sd(x)))  # medias observadas (casos del modelo)\neffectsize::eta_squared(car::Anova(modelo, type = 3), partial = TRUE)\n` +
    `anova(modelo, lm(${Y} ~ ${G} * (${Cs.join(' + ')}), data = datos))  # homogeneidad de pendientes\ncar::leveneTest(residuals(modelo) ~ modelo$model[[${rq(gName)}]], center = mean)\nshapiro.test(residuals(modelo))\nemmeans::emmeans(modelo, pairwise ~ ${G}, adjust = "holm")`;
}

export { runAncova };
