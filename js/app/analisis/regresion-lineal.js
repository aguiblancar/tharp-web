/* Tharp · aplicación · Análisis: Regresión lineal (simple, múltiple, jerárquica y por pasos) */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { f, list, nz, pt, pv, r2s, rn, rq } from '../formato.js';
import { apaTable, chk, design, fig, nuevaSeccion, stepSelect } from '../resultados/piezas.js';
import { maxOf } from '../utilidades.js';

function runRegression(yName, xNames, method = 'enter', blocks = null) {
  const stepwise = ['stepwise', 'forward', 'backward'].includes(method),
    hier = method === 'blocks',
    mName = { stepwise: 'por pasos', forward: 'hacia delante', backward: 'hacia atrás' }[method];
  const sec = nuevaSeccion(`Regresión lineal${stepwise ? ` ${mName}` : hier ? ' jerárquica' : ''}: ${yName}`, {
    test: '',
  });
  if (hier) {
    blocks = blocks.map(b => b.filter(n => n !== yName)).filter(b => b.length);
    if (blocks.length < 2) {
      sec.error =
        'La regresión jerárquica necesita al menos dos bloques con predictores distintos: marca los del bloque 1 y los que se añaden en el bloque 2.';
      return sec;
    }
  }
  xNames = xNames.filter(n => n !== yName);
  if (!xNames.length) {
    sec.error = 'Selecciona al menos un predictor distinto de la variable dependiente.';
    return sec;
  }
  const yv = numOf(vByName(yName)),
    candidates = xNames.slice();
  let { idx, cols, X } = design(xNames, i => yv[i] !== null);
  const n = idx.length;
  if (n < cols.length + 2) {
    sec.error = `Hay pocos casos completos (${n}) para estimar ${cols.length} coeficientes (las variables categóricas cuentan una vez por cada categoría distinta de la de referencia).`;
    return sec;
  }
  const y = idx.map(i => yv[i]);
  if (S.sd(y) === 0) {
    sec.error = `${yName} tiene el mismo valor en todos los casos: no se puede ajustar una regresión.`;
    return sec;
  }
  let sel = null;
  if (stepwise) {
    if (!S.olsCore(X, y)) {
      sec.error =
        'Hay colinealidad perfecta entre los predictores (por ejemplo, una variable es combinación exacta de otras). Elimina alguno.';
      return sec;
    }
    sel = stepSelect(X, y, cols, candidates, method);
    if (!sel.selected.length) {
      sec.error = `Ningún predictor cumplió el criterio de entrada (p < .05): el método ${mName} no seleccionó ninguna variable para predecir ${yName}.`;
      return sec;
    }
    // orden de entrada en la tabla de coeficientes, como SPSS y JASP
    const entered = sel.steps.filter(s => s.accion === 'entra').map(s => s.t);
    xNames = (method === 'backward' ? candidates : entered.filter((t, i) => entered.indexOf(t) === i)).filter(t =>
      sel.selected.includes(t)
    );
    const ordered = [0].concat(
      ...xNames.map(t => cols.map((c, j) => (j > 0 && c.v.name === t ? j : -1)).filter(j => j >= 0))
    );
    X = X.map(r => ordered.map(j => r[j]));
    cols = ordered.map(j => cols[j]);
  }
  const p = cols.length;
  const m = S.ols(X, y);
  if (!m) {
    sec.error =
      'Hay colinealidad perfecta entre los predictores (por ejemplo, una variable es combinación exacta de otras). Elimina alguno.';
    return sec;
  }
  if (m.r2 > 1 - 1e-10) {
    sec.error =
      'La variable dependiente es una combinación exacta de los predictores (R² = 1): no hay error que estimar, así que el modelo no tiene sentido. Revisa si una variable se calculó a partir de otra.';
    return sec;
  }
  const multi = cols.length > 2,
    het = m.bp.p < 0.05,
    sdY = S.sd(y);
  sec.test = `Regresión lineal ${multi ? 'múltiple' : 'simple'} (MCO${stepwise ? `, ${mName}` : ''})${het ? ' con errores robustos HC3' : ''}`;
  regressionWhy({ sec, yName, stepwise, xNames, mName, n, candidates, multi, het, method });
  regressionChecks({ het, sec, m, n, multi, p });
  sec.alt =
    'Si hay heterocedasticidad, errores robustos (HC3); si la relación no es lineal, transformar variables o añadir términos cuadráticos.';
  if (stepwise) {
    stepwiseTable({ sel, sec, mName, method });
  }
  let hm = null;
  if (hier) {
    // un modelo por bloque, acumulando predictores; todos con los mismos casos completos (como SPSS y JASP)
    ({ hm } = hierarchicalModels({ hm, blocks, cols, X, y, sdY }));
    if (hm.some(o => !o.m)) {
      sec.error = 'Hay colinealidad perfecta entre los predictores de algún bloque. Elimina alguno.';
      return sec;
    }
    hierarchicalTables({ hm, sec, blocks, n, cols });
  }
  const { beta } = regressionTables({ sec, stepwise, sel, hier, hm, m, n, het, multi, cols, yName, X, sdY, y });
  regressionText({ het, m, cols, stepwise, candidates, hier, hm, yName, mName, method, sel, xNames, multi, sec, beta });
  regressionCharts({ multi, cols, sec, yName, X, y, m });
  regressionRCode({ yName, xNames, stepwise, mName, candidates, method, hier, blocks, sec, het });
  return sec;
}
/** Un modelo por bloque, acumulando predictores, con los mismos casos completos (como SPSS y JASP) */
function hierarchicalModels({ hm, blocks, cols, X, y, sdY }) {
  hm = blocks.map((_, b) => {
    const set = blocks.slice(0, b + 1).flat(),
      js = cols.map((c, j) => (j === 0 || set.includes(c.v.name) ? j : -1)).filter(j => j >= 0);
    const Xb = X.map(r => js.map(j => r[j])),
      mb = S.ols(Xb, y);
    return {
      js,
      m: mb,
      added: blocks[b],
      beta: js.map((j, q) => (q === 0 || !mb ? null : (mb.b[q] * S.sd(X.map(r => r[j]))) / sdY)),
    };
  });
  return { hm };
}
/** Tabla de los pasos de la selección de predictores (entradas y salidas con su p) */
function stepwiseTable({ sel, sec, mName, method }) {
  const stepRows = sel.steps.map((st, k) => [
    k + 1,
    `${st.accion === 'entra' ? 'Entra' : 'Sale'}: ${esc(st.t)}`,
    nz(st.r2.toFixed(3)),
    (st.dr2 < 0 ? '−' : '') + nz(Math.abs(st.dr2).toFixed(3)),
    `${f(st.F)} (${st.df[0]}, ${st.df[1]})`,
    pv(st.p),
  ]);
  sec.tables.push(
    apaTable(
      `Pasos de la regresión ${mName}`,
      ['Paso', 'Cambio', '<i>R</i>²', 'Δ<i>R</i>²', '<i>F</i> de cambio (<i>gl</i>)', '<i>p</i>'],
      stepRows,
      `Criterio de entrada: <i>p</i> < .05${method !== 'forward' ? '; criterio de salida: <i>p</i> > .10' : ''}. ${method === 'backward' ? 'Se parte del modelo con todos los predictores; cada paso elimina uno.' : 'Cada paso añade o elimina un predictor respecto al anterior.'}`
    )
  );
}
/** Regresión jerárquica: cambio de R² y de F entre bloques y tabla de modelos por bloque */
function hierarchicalTables({ hm, sec, blocks, n, cols }) {
  hm.forEach((o, b) => {
    const prev = b ? hm[b - 1] : null,
      r2p = prev ? prev.m.r2 : 0,
      df1 = o.js.length - (prev ? prev.js.length : 1),
      df2 = n - o.js.length;
    o.dr2 = o.m.r2 - r2p;
    o.Fc = o.dr2 / df1 / ((1 - o.m.r2) / df2);
    o.dfc = [df1, df2];
    o.pc = S.pF(o.Fc, df1, df2);
  });
  sec.why.push(
    `Regresión jerárquica en ${blocks.length} bloques: ${blocks.map((b, i) => `bloque ${i + 1}: ${list(b.map(esc))}`).join('; ')}. Cada modelo añade un bloque al anterior y Δ<i>R</i>² indica cuánta varianza explican los predictores nuevos por encima de los anteriores.`
  );
  sec.tables.push(
    apaTable(
      'Resumen de los modelos de la regresión jerárquica',
      [
        'Modelo',
        'Predictores añadidos',
        '<i>R</i>²',
        '<i>R</i>² ajustado',
        '<i>F</i> (<i>gl</i>)',
        '<i>p</i>',
        'Δ<i>R</i>²',
        '<i>F</i> de cambio (<i>gl</i>)',
        '<i>p</i> del cambio',
      ],
      hm.map((o, b) => [
        b + 1,
        list(o.added.map(esc)),
        nz(o.m.r2.toFixed(3)),
        nz(o.m.adjr2.toFixed(3)),
        `${f(o.m.F)} (${o.m.df1}, ${o.m.dfr})`,
        pv(o.m.pF),
        nz(o.dr2.toFixed(3)),
        `${f(o.Fc)} (${o.dfc[0]}, ${o.dfc[1]})`,
        pv(o.pc),
      ]),
      `Todos los modelos usan los mismos ${n} casos completos. Δ<i>R</i>² y <i>F</i> de cambio comparan cada modelo con el anterior (el modelo 1, con el modelo nulo).`
    )
  );
  const prevRows = hm
    .slice(0, -1)
    .flatMap((o, b) =>
      o.js.map((j, q) => [
        q === 0 ? `Modelo ${b + 1}` : '',
        esc(cols[j].name),
        f(o.m.b[q], 3),
        f(o.m.se[q], 3),
        q ? r2s(o.beta[q]) : '',
        f(o.m.t[q]),
        pv(o.m.pv[q]),
      ])
    );
  sec.tables.push(
    apaTable(
      'Coeficientes de los modelos anteriores',
      ['Modelo', 'Predictor', '<i>B</i>', '<i>EE</i>', 'β', '<i>t</i>', '<i>p</i>'],
      prevRows,
      `Los coeficientes del modelo final (modelo ${hm.length}) aparecen en la tabla siguiente, con sus intervalos de confianza y el diagnóstico.`
    )
  );
}
/** Motivos de la elección del modelo y decisión para el registro */
function regressionWhy({ sec, yName, stepwise, xNames, mName, n, candidates, multi, het, method }) {
  sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa.`);
  if (stepwise) {
    sec.why.push(
      `${candidates.length} predictores candidatos: ${list(candidates.map(esc))}. Las variables categóricas se codifican como variables ficticias frente a una categoría de referencia y entran o salen del modelo como un bloque.`
    );
    sec.why.push(
      `Has elegido el método ${mName}: ${method === 'stepwise' ? 'en cada paso entra el predictor con menor valor <i>p</i> si es < .05, y sale cualquier predictor del modelo cuyo <i>p</i> supere .10 (criterios por defecto de SPSS y JASP)' : method === 'forward' ? 'en cada paso entra el predictor con menor valor <i>p</i> si es < .05, y los que entran no vuelven a salir' : 'se parte de todos los predictores y en cada paso sale el de mayor valor <i>p</i> si supera .10'}. Todos los pasos usan los mismos ${n} casos completos.`
    );
  } else
    sec.why.push(
      `${xNames.length} predictor${xNames.length > 1 ? 'es' : ''}: ${list(xNames.map(esc))}. Las variables categóricas se codifican como variables ficticias frente a una categoría de referencia.`
    );
  sec.why.push(
    'La regresión estima cuánto cambia la variable dependiente por cada unidad de cada predictor, manteniendo constantes los demás.'
  );
  sec.decision =
    (stepwise
      ? `Se ajustó una regresión lineal ${mName} con ${n} casos completos y ${candidates.length} predictores candidatos; el modelo final incluye ${xNames.length}: ${list(xNames.map(esc))}.`
      : `Se ajustó una regresión lineal ${multi ? 'múltiple' : 'simple'} con ${n} casos completos.`) +
    (het
      ? ' Como no se cumple la homocedasticidad, los contrastes de los coeficientes usan errores típicos robustos (HC3).'
      : '');
  if (stepwise)
    sec.checks.push(
      chk(
        'info',
        'Selección automática de predictores: los métodos por pasos se ajustan a las particularidades de la muestra, por lo que tienden a sobrestimar el <i>R</i>², y los <i>p</i>-valores del modelo final no tienen en cuenta la selección. Justifica los candidatos con la teoría y, si puedes, compara con el modelo con todos los predictores (método «Introducir»).'
      )
    );
}
/** Supuestos: normalidad y homocedasticidad de los residuos, independencia, colinealidad, casos influyentes y tamaño muestral */
function regressionChecks({ het, sec, m, n, multi, p }) {
  if (het)
    sec.why.push(
      'La prueba de Breusch-Pagan indica heterocedasticidad: los errores típicos clásicos no son fiables, así que se usan errores robustos HC3 para los contrastes.'
    );
  const swr = S.shapiro(m.e);
  if (swr && swr.p >= 0.05)
    sec.checks.push(
      chk('ok', `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(swr.W.toFixed(3))}, ${pt(swr.p)}.`)
    );
  else
    sec.checks.push(
      chk(
        n >= 100 ? 'info' : 'no',
        `Normalidad de los residuos (Shapiro-Wilk): ${swr ? `<i>W</i> = ${nz(swr.W.toFixed(3))}, ${pt(swr.p)}` : 'no calculable'}.${n >= 100 ? ' Con muestras grandes la regresión es robusta a desviaciones moderadas.' : ' No se cumple: interpreta los p-valores con cautela.'}`
      )
    );
  sec.checks.push(
    chk(
      het ? 'no' : 'ok',
      `Homocedasticidad (Breusch-Pagan): χ²(${m.bp.df}) = ${f(m.bp.LM)}, ${pt(m.bp.p)}. ${het ? 'No se cumple: se usan errores robustos HC3.' : 'Se cumple.'}`
    )
  );
  sec.checks.push(
    chk(
      m.dw >= 1.5 && m.dw <= 2.5 ? 'ok' : 'no',
      `Independencia de los residuos (Durbin-Watson) = ${f(m.dw)} (aceptable entre 1.5 y 2.5). Solo es relevante si el orden de las filas tiene sentido, por ejemplo temporal.`
    )
  );
  if (multi) {
    const maxV = maxOf(m.vif.slice(1));
    sec.checks.push(
      chk(
        maxV < 5 ? 'ok' : 'no',
        `Multicolinealidad: VIF máximo = ${f(maxV)}. ${maxV < 5 ? 'Sin problemas (VIF < 5).' : maxV < 10 ? 'Moderada (VIF entre 5 y 10): revisa los predictores correlacionados.' : 'Grave (VIF ≥ 10): elimina o combina predictores.'}`
      )
    );
  }
  const infl = m.cook.filter(c => c > 4 / n).length,
    big = m.cook.filter(c => c > 1).length;
  sec.checks.push(
    chk(
      big ? 'no' : 'info',
      `Casos influyentes (distancia de Cook): ${infl} casos superan 4/<i>n</i>${big ? ` y ${big} superan 1, lo que indica una influencia excesiva: revísalos` : '; ninguno supera 1'}.`
    )
  );
  if (n < 10 * (p - 1))
    sec.checks.push(
      chk(
        'no',
        `Tamaño muestral: ${n} casos para ${p - 1} coeficientes. Se recomiendan al menos 10–15 casos por predictor.`
      )
    );
}
/** Tablas del resumen del modelo, de los coeficientes y de las correlaciones parcial y semiparcial */
function regressionTables({ sec, stepwise, sel, hier, hm, m, n, het, multi, cols, yName, X, sdY, y }) {
  sec.tables.push(
    apaTable(
      stepwise
        ? `Resumen del modelo final${sel.steps.length ? ` (paso ${sel.steps.length})` : ''}`
        : hier
          ? `Resumen del modelo final (modelo ${hm.length})`
          : 'Resumen del modelo de regresión',
      ['<i>R</i>²', '<i>R</i>² ajustado', '<i>F</i>', '<i>gl</i>', '<i>p</i>', '<i>n</i>'],
      [[nz(m.r2.toFixed(3)), nz(m.adjr2.toFixed(3)), f(m.F), `${m.df1}, ${m.dfr}`, pv(m.pF), n]]
    )
  );
  const head = ['Predictor', '<i>B</i>', '<i>EE</i>', 'IC 95 % (<i>B</i>)', 'β', '<i>t</i>', '<i>p</i>']
    .concat(het ? ['<i>EE</i> (HC3)', '<i>p</i> (HC3)'] : [])
    .concat(multi ? ['VIF'] : []);
  const beta = cols.map((c, j) => (j === 0 ? null : (m.b[j] * S.sd(X.map(r => r[j]))) / sdY));
  const rows = cols.map((c, j) =>
    [
      esc(c.name),
      f(m.b[j], 3),
      f(m.se[j], 3),
      `[${f(m.ci[j][0], 3)}, ${f(m.ci[j][1], 3)}]`,
      j ? r2s(beta[j]) : '',
      f(m.t[j]),
      pv(m.pv[j]),
    ]
      .concat(het ? [f(m.se3[j], 3), pv(m.p3[j])] : [])
      .concat(multi ? [j ? f(m.vif[j]) : ''] : [])
  );
  sec.tables.push(
    apaTable(
      `Coeficientes del modelo de regresión para ${yName}`,
      head,
      rows,
      '<i>B</i> = coeficiente no estandarizado; β = coeficiente estandarizado.' +
        (het ? ' HC3 = errores típicos robustos a la heterocedasticidad.' : '')
    )
  );
  if (multi) {
    // correlaciones de orden cero, parcial y semiparcial de cada predictor y tolerancia (como SPSS)
    const corrRows = cols.slice(1).map((c, q) => {
      const j = q + 1,
        xj = X.map(r => r[j]),
        r0 = S.pearson(xj, y).r,
        tj = m.t[j],
        df = m.dfr;
      const part = tj * Math.sqrt((1 - m.r2) / df),
        partial = tj / Math.sqrt(tj * tj + df);
      return [
        esc(c.name),
        r2s(r0),
        r2s(partial),
        r2s(part),
        nz((part * part).toFixed(3)),
        nz((1 / m.vif[j]).toFixed(3)),
      ];
    });
    sec.tables.push(
      apaTable(
        'Correlaciones y colinealidad de los predictores',
        ['Predictor', '<i>r</i> de orden cero', '<i>r</i> parcial', '<i>r</i> semiparcial', '<i>sr</i>²', 'Tolerancia'],
        corrRows,
        '<i>sr</i>² = semiparcial al cuadrado: proporción de varianza de la variable dependiente que explica cada predictor por sí solo, por encima de los demás. Tolerancia = 1 / VIF (valores < .10 indican colinealidad grave).'
      )
    );
  }
  return { beta };
}
/** Redacción APA del modelo: R², F y coeficientes significativos */
function regressionText({
  het,
  m,
  cols,
  stepwise,
  candidates,
  hier,
  hm,
  yName,
  mName,
  method,
  sel,
  xNames,
  multi,
  sec,
  beta,
}) {
  const pUse = het ? m.p3 : m.pv,
    sigP = cols.map((c, j) => ({ c, j })).filter(o => o.j > 0 && pUse[o.j] < 0.05);
  const out = stepwise ? candidates.filter(c => !xNames.includes(c)) : [];
  const hierTxt = !hier
    ? ''
    : `Se realizó una regresión lineal jerárquica en ${hm.length} pasos para predecir ${esc(yName)}. ` +
      hm
        .map((o, b) =>
          b === 0
            ? `En el modelo 1, ${list(o.added.map(esc))} explic${o.added.length > 1 ? 'aron' : 'ó'} el ${f(o.m.r2 * 100, 1)} % de la varianza, <i>F</i>(${o.m.df1}, ${o.m.dfr}) = ${f(o.m.F)}, ${pt(o.m.pF)}.`
            : `Al añadir ${list(o.added.map(esc))} en el modelo ${b + 1}, la varianza explicada ${o.pc < 0.05 ? 'aumentó significativamente' : 'no aumentó significativamente'}, Δ<i>R</i>² = ${nz(o.dr2.toFixed(3))}, <i>F</i>(${o.dfc[0]}, ${o.dfc[1]}) = ${f(o.Fc)}, ${pt(o.pc)}.`
        )
        .join(' ') +
      ' ';
  let t =
    (hier
      ? hierTxt + `El modelo final (modelo ${hm.length})`
      : stepwise
        ? `Se realizó un análisis de regresión lineal múltiple ${mName} (criterio de entrada <i>p</i> < .05${method !== 'forward' ? ' y de salida <i>p</i> > .10' : ''}) para predecir ${esc(yName)} a partir de ${candidates.length} predictores candidatos. ${sel.steps.length ? `El procedimiento terminó en el paso ${sel.steps.length} con` : 'El modelo final incluyó'} ${xNames.length} predictor${xNames.length > 1 ? 'es' : ''}. El modelo final`
        : `Se realizó un análisis de regresión lineal ${multi ? 'múltiple' : 'simple'} para predecir ${esc(yName)} a partir de ${list(xNames.map(esc))}. El modelo`) +
    ` ${m.pF < 0.05 ? '' : 'no '}fue estadísticamente significativo, <i>F</i>(${m.df1}, ${m.dfr}) = ${f(m.F)}, ${pt(m.pF)}, y explicó el ${f(m.r2 * 100, 1)} % de la varianza (<i>R</i>² ajustado = ${nz(m.adjr2.toFixed(2))}). `;
  if (m.pF < 0.05) {
    if (sigP.length)
      t +=
        list(
          sigP.map(
            o =>
              `${esc(o.c.name)} ${m.b[o.j] > 0 ? 'se asoció positivamente' : 'se asoció negativamente'} con ${esc(yName)} (<i>B</i> = ${f(m.b[o.j], 2)}, β = ${r2s(beta[o.j])}, ${pt(pUse[o.j])})`
          )
        ) + '. ';
    const ns = cols.filter((c, j) => j > 0 && pUse[j] >= 0.05).map(c => esc(c.name));
    if (ns.length)
      t += `${list(ns)} no ${ns.length > 1 ? 'fueron predictores significativos' : 'fue un predictor significativo'}.`;
  }
  if (out.length) t += ` ${list(out.map(esc))} no ${out.length > 1 ? 'entraron' : 'entró'} en el modelo.`;
  if (het) t += ' Los contrastes de los coeficientes se basan en errores típicos robustos (HC3).';
  sec.text.push(t);
}
/** Figuras: dispersión con recta (regresión simple) y residuos frente a valores ajustados */
function regressionCharts({ multi, cols, sec, yName, X, y, m }) {
  if (!multi && cols[1].level === undefined)
    sec.charts.push(
      fig(
        `${yName} según ${cols[1].name}`,
        CH.scatter(
          X.map(r => r[1]),
          y,
          cols[1].name,
          yName,
          { line: [m.b[0], m.b[1]] }
        )
      )
    );
  sec.charts.push(
    fig('Residuos frente a valores predichos', CH.scatter(m.fit, m.e, 'Valor predicho', 'Residuo', { zero: true }))
  );
}
/** Código R del modelo (y de la selección por pasos o de los bloques jerárquicos) que reproduce cada número */
function regressionRCode({ yName, xNames, stepwise, mName, candidates, method, hier, blocks, sec, het }) {
  const fml = `${rn(yName)} ~ ${xNames.map(rn).join(' + ')}`;
  const stepCode = !stepwise
    ? ''
    : `# Selección ${mName} con contrastes F parciales (entrada p < .05, salida p > .10), como SPSS y JASP.\n` +
      `# Las variables categóricas entran o salen como un bloque; todos los pasos usan los mismos casos completos.\n` +
      `candidatos <- c(${candidates.map(rq).join(', ')})\n` +
      `datos_c <- na.omit(datos[, c(${rq(yName)}, candidatos)])\n` +
      `ff <- function(v) reformulate(if (length(v)) sprintf("\`%s\`", v) else "1", response = sprintf("\`%s\`", ${rq(yName)}))\n` +
      `pvals <- function(tab) setNames(tab[-1, "Pr(>F)"], gsub("\`", "", rownames(tab)[-1]))\n` +
      `# cada paso imprime R², ΔR² y la F de cambio (gl, p), como la tabla de pasos de Tharp\npaso <- function(antes, despues) { m0 <- lm(ff(antes), data = datos_c); m1 <- lm(ff(despues), data = datos_c); entra <- length(despues) > length(antes)\n  a <- if (entra) anova(m0, m1) else anova(m1, m0); print(c(R2 = summary(m1)$r.squared, dR2 = summary(m1)$r.squared - summary(m0)$r.squared, F = a$F[2], gl1 = a$Df[2], gl2 = a$Res.Df[2], p = a[["Pr(>F)"]][2]), digits = 7) }\n` +
      `dentro <- ${method === 'backward' ? 'candidatos' : 'character(0)'}\n` +
      `repeat {\n  cambio <- FALSE\n` +
      (method !== 'backward'
        ? `  fuera <- setdiff(candidatos, dentro)\n  if (length(fuera)) {\n    pa <- pvals(add1(lm(ff(dentro), data = datos_c), scope = ff(candidatos), test = "F"))\n    if (min(pa) < .05) { nuevo <- c(dentro, names(which.min(pa))); paso(dentro, nuevo); dentro <- nuevo; cambio <- TRUE }\n  }\n`
        : '') +
      (method !== 'forward'
        ? `  if (length(dentro)) {\n    pd <- pvals(drop1(lm(ff(dentro), data = datos_c), test = "F"))\n    if (max(pd) > .10) { nuevo <- setdiff(dentro, names(which.max(pd))); paso(dentro, nuevo); dentro <- nuevo; cambio <- TRUE }\n  }\n`
        : '') +
      `  if (!cambio) break\n}\ndentro  # predictores seleccionados\n`;
  const hierCode = !hier
    ? ''
    : `# Regresión jerárquica: los mismos casos completos en todos los modelos\ndatos_c <- na.omit(datos[, c(${[yName].concat(blocks.flat()).map(rq).join(', ')})])\n` +
      blocks
        .map(
          (b, i) =>
            `m${i + 1} <- ${i === 0 ? `lm(${rn(yName)} ~ ${b.map(rn).join(' + ')}, data = datos_c)` : `update(m${i}, . ~ . + ${b.map(rn).join(' + ')})`}\n`
        )
        .join('') +
      blocks
        .slice(1)
        .map((_, i) => `anova(m${i + 1}, m${i + 2})  # F de cambio del modelo ${i + 2} (como SPSS y JASP)\n`)
        .join('') +
      `sapply(list(${blocks.map((_, i) => 'm' + (i + 1)).join(', ')}), function(m) summary(m)$r.squared)  # R² de cada modelo\n` +
      blocks
        .slice(0, -1)
        .map(
          (_, i) =>
            `print(summary(m${i + 1}), digits = 7); parameters::standardize_parameters(m${i + 1}, method = "basic")  # modelo ${i + 1}\n`
        )
        .join('') +
      `modelo <- m${blocks.length}\n`;
  sec.code =
    `# Regresión lineal${stepwise ? ` ${mName}` : hier ? ' jerárquica' : ''}: ${yName}\n` +
    (stepwise
      ? `${stepCode}modelo <- lm(ff(dentro), data = datos_c)\n`
      : hier
        ? hierCode
        : `modelo <- lm(${fml}, data = datos)\n`) +
    `summary(modelo)\ns <- summary(modelo)$fstatistic; c(F = unname(s[1]), gl1 = unname(s[2]), gl2 = unname(s[3]), p = unname(pf(s[1], s[2], s[3], lower.tail = FALSE)))  # sin redondear\nconfint(modelo)\nparameters::standardize_parameters(modelo, method = "basic")  # β como en SPSS\nshapiro.test(residuals(modelo))\nlmtest::bptest(modelo)\nlmtest::dwtest(modelo)\n` +
    'X <- model.matrix(modelo)[, -1, drop = FALSE]; yv <- model.frame(modelo)[[1]]\nif (ncol(X) > 1) print(t(sapply(setNames(seq_len(ncol(X)), colnames(X)), function(j) { rx <- resid(lm(X[, j] ~ X[, -j])); ry <- resid(lm(yv ~ X[, -j])); sr <- cor(yv, rx)\n  c(r_orden_cero = cor(yv, X[, j]), r_parcial = cor(ry, rx), r_semiparcial = sr, sr2 = sr^2) })), digits = 7)  # como la tabla de colinealidad de Tharp\n' +
    'if (length(attr(terms(modelo), "term.labels")) > 1) print(car::vif(modelo))  # VIF generalizado por variable\nif (ncol(X) > 1) { v <- sapply(setNames(seq_len(ncol(X)), colnames(X)), function(j) 1 / (1 - summary(lm(X[, j] ~ X[, -j]))$r.squared)); print(cbind(VIF = v, Tolerancia = 1 / v), digits = 7) }  # de cada columna, como Tharp\n' +
    `sum(cooks.distance(modelo) > 4 / nobs(modelo))` +
    (het ? '\nlmtest::coeftest(modelo, vcov = sandwich::vcovHC(modelo, type = "HC3"))' : '');
}

export { runRegression };
