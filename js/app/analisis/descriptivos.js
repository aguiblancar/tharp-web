/* Tharp · aplicación · Análisis: Estadísticos descriptivos */
import CH, { esc } from '../graficos.js';
import S from '../../motor/index.js';
import { ST } from '../estado.js';
import { catOf, levelsOf, numOf, vByName } from '../datos/variables.js';
import { J_inv, f, list, nz, pv, rn, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

function runDescriptives(names, gName = '', plot = 'box') {
  const BX = (groups, label) => (plot === 'box' ? CH.boxplot(groups, label) : CH.raincloud(groups, label, plot));
  const vars = names
      .map(vByName)
      .filter(Boolean)
      .filter(v => v.name !== gName),
    nums = vars.filter(v => v.type === 'num'),
    cats = vars.filter(v => v.type === 'cat');
  const sec = nuevaSeccion('Estadísticos descriptivos', { test: 'Descriptivos' });
  const G = gName ? vByName(gName) : null,
    gl = G ? levelsOf(G) : [],
    gc = G ? catOf(G) : null;
  sec.decision = `Se describen ${vars.length} variables${G ? `, también por grupos de ${esc(gName)}` : ''}. Para las cuantitativas se informa media y desviación típica junto a mediana, rango intercuartílico, asimetría y curtosis; para las categóricas, frecuencias y porcentajes.`;
  sec.why.push(
    'El análisis descriptivo resume la muestra antes de cualquier contraste de hipótesis y es obligatorio en el apartado de resultados.'
  );
  sec.why.push(
    'Se informa la mediana y el rango intercuartílico además de la media porque, si la distribución es asimétrica, representan mejor el valor típico y la dispersión.'
  );
  sec.why.push(
    'La normalidad se valora con Shapiro-Wilk (la prueba más potente) y Kolmogorov-Smirnov con la corrección de Lilliefors (la que muestra SPSS en «Explorar»), junto con los gráficos Q-Q.'
  );
  const textParts = [`La muestra estuvo compuesta por ${ST.rows.length} participantes.`];
  const q = (sx, pr) => S.quantile(sx, pr);
  if (nums.length) {
    const rows = [],
      skewed = [],
      normRows = [],
      outl = [];
    nums.forEach(v => {
      const x = numOf(v).filter(a => a !== null);
      if (x.length < 2) return;
      const d = S.describe(x),
        n = x.length,
        sx = x.slice().sort((a, b) => a - b);
      const q1 = q(sx, 0.25),
        q3 = q(sx, 0.75),
        iqr = q3 - q1;
      if (Math.abs(d.skew) > 1) skewed.push(v.name);
      rows.push([
        esc(v.name),
        n,
        ST.rows.length - n,
        f(d.mean),
        f(d.sd),
        f(d.median),
        `${f(q1)}–${f(q3)}`,
        +d.min.toFixed(3),
        +d.max.toFixed(3),
        n > 2 ? `${f(d.skew)} (${f(S.seSkew(n))})` : f(d.skew),
        n > 3 ? `${f(d.kurt)} (${f(S.seKurt(n))})` : f(d.kurt),
      ]);
      const sw = n >= 3 && n <= 5000 ? S.shapiro(x) : null,
        ks = S.lilliefors(x);
      normRows.push([
        esc(v.name),
        sw ? nz(sw.W.toFixed(3)) : '—',
        sw ? pv(sw.p) : '—',
        ks ? nz(ks.D.toFixed(3)) : '—',
        ks ? pv(ks.p) : '—',
      ]);
      const tk = x.filter(a => a < q1 - 1.5 * iqr || a > q3 + 1.5 * iqr).length,
        z3 = x.filter(a => Math.abs((a - d.mean) / d.sd) > 3).length;
      if (tk || z3)
        outl.push(`${esc(v.name)} (${tk} según el criterio de 1.5·RIC${z3 ? `; ${z3} con |<i>z</i>| > 3` : ''})`);
      if (sec.charts.length < 18) {
        sec.charts.push(fig(v.name, CH.histogram(x, v.name)));
        sec.charts.push(
          fig(
            `${v.name}: gráfico Q-Q normal`,
            CH.qqplot(x, v.name, pr => J_inv(pr))
          )
        );
      }
    });
    numericSummaryTables({ sec, rows, normRows, skewed, outl, nums, plot, BX });
    const nt = nums
      .slice(0, 6)
      .map(v => {
        const x = numOf(v).filter(a => a !== null);
        if (x.length < 2) return '';
        const d = S.describe(x);
        return `${esc(v.name)} (<i>M</i> = ${f(d.mean)}, <i>DT</i> = ${f(d.sd)}; rango ${+d.min.toFixed(2)}–${+d.max.toFixed(2)})`;
      })
      .filter(Boolean);
    if (nt.length)
      textParts.push(`En cuanto a las variables cuantitativas, se obtuvieron los siguientes valores: ${list(nt)}.`);
    if (G) {
      describeByGroup({ nums, sec, gName, gl, BX, gc });
    }
  }
  if (cats.length) {
    describeCategorical({ cats, sec, textParts });
  }
  sec.text.push(textParts.join(' '));
  descriptivesRCode({ nums, sec, G, gName, cats });
  return sec;
}
/** Código R de los descriptivos, las frecuencias y la normalidad */
function descriptivesRCode({ nums, sec, G, gName, cats }) {
  const NN = nums.map(v => rq(v.name)).join(', ');
  sec.code =
    `# Descriptivos\n${
      nums.length
        ? `psych::describe(datos[, c(${NN}), drop = FALSE], type = 2, quant = c(.25, .75))  # asimetría y curtosis como SPSS\n` +
          `t(sapply(datos[, c(${NN}), drop = FALSE], function(x) { x <- x[!is.na(x)]; s <- if (length(x) >= 3 && length(x) <= 5000 && diff(range(x)) > 0) shapiro.test(x) else list(statistic = NA, p.value = NA); l <- if (length(x) >= 5 && diff(range(x)) > 0) nortest::lillie.test(x) else list(statistic = NA, p.value = NA)
c(W = unname(s$statistic), p_SW = s$p.value, D = unname(l$statistic), p_Lilliefors = l$p.value) }))  # normalidad (cada prueba, si hay casos suficientes)\n` +
          `t(sapply(datos[, c(${NN}), drop = FALSE], function(x) { n <- sum(!is.na(x)); es <- sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3))); c(EE_asimetria = es, EE_curtosis = 2 * es * sqrt((n^2 - 1) / ((n - 3) * (n + 5)))) }))  # EE como SPSS\n` +
          `boxplot(datos[, c(${NN}), drop = FALSE])\n` +
          (G ? `psych::describeBy(datos[, c(${NN}), drop = FALSE], group = datos[[${rq(gName)}]], mat = TRUE)\n` : '')
        : ''
    }` +
    cats
      .map(
        v =>
          `t <- table(datos$${rn(v.name)}); cbind(n = t, pct = round(prop.table(t) * 100, 1), acum = round(cumsum(prop.table(t)) * 100, 1))`
      )
      .join('\n');
}
/** Tablas de descriptivos y de forma de la distribución, supuestos (asimetría, atípicos) y gráfico de cajas o de nube de lluvia */
function numericSummaryTables({ sec, rows, normRows, skewed, outl, nums, plot, BX }) {
  sec.tables.push(
    apaTable(
      'Estadísticos descriptivos de las variables cuantitativas',
      [
        'Variable',
        '<i>n</i>',
        'Perdidos',
        '<i>M</i>',
        '<i>DT</i>',
        '<i>Mdn</i>',
        'RIC (P25–P75)',
        'Mín.',
        'Máx.',
        'Asimetría (<i>EE</i>)',
        'Curtosis (<i>EE</i>)',
      ],
      rows,
      'Curtosis expresada como exceso respecto a la distribución normal (0 = normal). Errores típicos de asimetría y curtosis como en SPSS; percentiles con el método por defecto de R (tipo 7).'
    )
  );
  sec.tables.push(
    apaTable(
      'Pruebas de normalidad',
      ['Variable', '<i>W</i> de Shapiro-Wilk', '<i>p</i>', '<i>D</i> de Kolmogorov-Smirnov', '<i>p</i> (Lilliefors)'],
      normRows,
      'Con muestras grandes, desviaciones pequeñas e irrelevantes ya resultan significativas: interpreta las pruebas junto con los gráficos Q-Q, la asimetría y la curtosis.'
    )
  );
  sec.checks.push(
    skewed.length
      ? chk(
          'no',
          `Asimetría marcada (|asimetría| > 1) en ${list(skewed.map(esc))}: para estas variables conviene informar mediana y rango intercuartílico.`
        )
      : chk('ok', 'Ninguna variable cuantitativa presenta una asimetría marcada (|asimetría| ≤ 1).')
  );
  sec.checks.push(
    outl.length
      ? chk(
          'info',
          `Posibles valores atípicos: ${list(outl)}. Revisa que no sean errores de introducción de datos antes de decidir si se mantienen.`
        )
      : chk('ok', 'No hay valores atípicos según el criterio de 1.5·RIC ni |z| > 3.')
  );
  if (nums.length <= 8)
    sec.charts.push(
      fig(
        { box: 'Diagramas de caja', violin: 'Gráficos de violín', rain: 'Nubes de lluvia (densidad, caja y datos)' }[
          plot
        ],
        BX(
          nums.map(v => ({ name: v.name, x: numOf(v).filter(a => a !== null) })).filter(g => g.x.length > 1),
          'Variables'
        )
      )
    );
}
/** Descriptivos de las variables cuantitativas por grupos: tabla y gráficos por grupo */
function describeByGroup({ nums, sec, gName, gl, BX, gc }) {
  const gr = [];
  nums.forEach(v => {
    const x = numOf(v);
    gl.forEach((l, j) => {
      const xs = x.filter((a, i) => a !== null && gc[i] === l);
      if (xs.length < 1) return;
      const d = S.describe(xs);
      gr.push([
        j === 0 ? esc(v.name) : '',
        esc(l),
        d.n,
        f(d.mean),
        xs.length > 1 ? f(d.sd) : '—',
        f(d.median),
        +d.min.toFixed(3),
        +d.max.toFixed(3),
      ]);
    });
    if (sec.charts.length < 24 && gl.length <= 10)
      sec.charts.push(
        fig(
          `${v.name} por ${gName}`,
          BX(
            gl.map(l => ({ name: l, x: x.filter((a, i) => a !== null && gc[i] === l) })).filter(g => g.x.length > 1),
            v.name
          )
        )
      );
  });
  sec.tables.push(
    apaTable(
      `Estadísticos descriptivos por ${gName}`,
      ['Variable', esc(gName), '<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'Mín.', 'Máx.'],
      gr
    )
  );
}
/** Variables categóricas: tabla de frecuencias y porcentajes, gráficos de barras y redacción */
function describeCategorical({ cats, sec, textParts }) {
  const rows = [];
  cats.forEach(v => {
    const c = catOf(v),
      lv = levelsOf(v),
      nv = c.filter(x => x !== null).length;
    let acc = 0;
    rows.push([`<b>${esc(v.name)}</b>`, '', '', '', '']);
    lv.forEach(l => {
      const k = c.filter(x => x === l).length;
      acc += k;
      rows.push([
        '&nbsp;&nbsp;&nbsp;' + esc(l),
        k,
        f((k / ST.rows.length) * 100, 1),
        f((k / nv) * 100, 1),
        f((acc / nv) * 100, 1),
      ]);
    });
    if (nv < ST.rows.length)
      rows.push([
        '&nbsp;&nbsp;&nbsp;<span class="muted">Perdidos</span>',
        ST.rows.length - nv,
        f(((ST.rows.length - nv) / ST.rows.length) * 100, 1),
        '',
        '',
      ]);
    if (sec.charts.length < 24 && lv.length <= 15)
      sec.charts.push(
        fig(
          v.name,
          CH.barsCat(
            lv,
            lv.map(l => c.filter(x => x === l).length),
            v.name
          )
        )
      );
  });
  sec.tables.push(
    apaTable(
      'Frecuencias de las variables categóricas',
      ['Variable / categoría', '<i>n</i>', '%', '% válido', '% acumulado'],
      rows,
      'El porcentaje acumulado sigue el orden de las categorías (relevante en variables ordinales).'
    )
  );
  cats.slice(0, 4).forEach(v => {
    const c = catOf(v),
      lv = levelsOf(v),
      nv = c.filter(x => x !== null).length;
    const parts = lv.slice(0, 5).map(l => {
      const k = c.filter(x => x === l).length;
      return `${esc(l)} el ${f((k / nv) * 100, 1)} % (<i>n</i> = ${k})`;
    });
    textParts.push(`Respecto a ${esc(v.name)}, ${list(parts)}${lv.length > 5 ? ', entre otras categorías' : ''}.`);
  });
}

export { runDescriptives };
