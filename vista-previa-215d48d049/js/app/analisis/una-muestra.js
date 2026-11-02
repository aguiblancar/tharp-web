/* Tharp · aplicación · Análisis: Pruebas para una muestra */
import S from '../../motor/index.js';
import { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { ciTxt, f, fmtNum, lbl, nz, pt, pv, rn, rq } from '../formato.js';
import { apaTable, chk, nuevaSeccion } from '../resultados/piezas.js';

function runOneSample(name, mu, alt = 'two') {
  const sec = nuevaSeccion(`${name} frente a ${fmtNum(mu)} (una muestra)`);
  const x = numOf(vByName(name)).filter(v => v !== null),
    n = x.length;
  if (!isFinite(mu)) {
    sec.error = 'Escribe un valor de referencia numérico.';
    return sec;
  }
  if (n < 3) {
    sec.error = 'Se necesitan al menos 3 casos.';
    return sec;
  }
  if (S.sd(x) === 0) {
    sec.error = `${name} tiene el mismo valor en todos los casos: no se puede realizar la prueba.`;
    return sec;
  }
  const one = alt !== 'two',
    rAlt = { two: 'two.sided', greater: 'greater', less: 'less' }[alt],
    ALT = one ? `, alternative = "${rAlt}"` : '',
    X = rn(name);
  const hyp = one ? ` (hipótesis unilateral: media ${alt === 'greater' ? '>' : '<'} ${fmtNum(mu)})` : '';
  const ds = S.describe(x),
    sw = S.shapiro(x),
    normOK = n >= 30 || (sw && sw.p >= 0.05);
  sec.why.push(
    `Se compara la media de ${esc(name)} con un valor de referencia fijo (${fmtNum(mu)}), por ejemplo el punto medio de una escala o una norma publicada.`
  );
  if (one)
    sec.why.push(
      `Has elegido una hipótesis unilateral: se contrasta si la media es ${alt === 'greater' ? 'mayor' : 'menor'} que ${fmtNum(mu)}. Debe decidirse antes de ver los datos.`
    );
  const swT = sw ? `Shapiro-Wilk: <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}` : 'Shapiro-Wilk no calculable';
  sec.checks.push(
    sw && sw.p >= 0.05
      ? chk('ok', swT + '. Se cumple la normalidad.')
      : n >= 30
        ? chk('info', swT + `. No es normal, pero con <i>n</i> = ${n} ≥ 30 la prueba t es robusta.`)
        : chk('no', swT + '. No se cumple y la muestra es pequeña.')
  );
  sec.tables.push(
    apaTable(
      `Estadísticos descriptivos de ${name}`,
      ['<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'IC 95 % (<i>M</i>)'],
      [[n, f(ds.mean), f(ds.sd), f(ds.median), `[${f(ds.ci[0])}, ${f(ds.ci[1])}]`]],
      ST.rows.length - n ? `Se excluyeron ${ST.rows.length - n} casos sin dato.` : ''
    )
  );
  if (normOK) {
    oneSampleT({ x, mu, alt, sec, one, hyp, name, ds, X, ALT });
  } else {
    oneSampleWilcoxon({ x, mu, alt, sec, one, hyp, name, n, ds, X, ALT });
  }
  return sec;
}
/** Una muestra con normalidad: t para una muestra con d de Cohen, tabla, redacción y código R */
function oneSampleT({ x, mu, alt, sec, one, hyp, name, ds, X, ALT }) {
  const r = S.tTestOne(x, mu, alt);
  sec.test = 'Prueba t para una muestra' + (one ? ' (unilateral)' : '');
  sec.decision = `Se eligió la prueba t para una muestra${hyp} porque se compara una media con un valor de referencia y la normalidad es aceptable (o <i>n</i> ≥ 30).`;
  sec.alt = 'Prueba de rangos con signo de Wilcoxon para una muestra si los datos no fueran normales.';
  sec.tables.push(
    apaTable(
      'Resultado de la prueba t para una muestra',
      [
        '',
        '<i>t</i>',
        '<i>gl</i>',
        '<i>p</i>' + (one ? ' (unilateral)' : ''),
        'Diferencia',
        'IC 95 % (diferencia)',
        '<i>d</i> de Cohen',
        'IC 95 % (<i>d</i>)',
      ],
      [[`${esc(name)} − ${fmtNum(mu)}`, f(r.t), r.df, pv(r.p), f(r.diff), ciTxt(r.ci), f(r.d), ciTxt(r.dCI)]],
      '<i>d</i> = (media − valor de referencia) / desviación típica (como JASP); IC por la distribución <i>t</i> no central.'
    )
  );
  const w = S.wilcoxonOne(x, mu, alt);
  sec.sens = `Análisis de sensibilidad: la prueba de Wilcoxon da ${pt(w.p)}, ${w.p < 0.05 === r.p < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
  sec.text.push(
    `Se aplicó una prueba t para una muestra${hyp} para comparar la media de ${esc(name)} (<i>M</i> = ${f(ds.mean)}, <i>DT</i> = ${f(ds.sd)}) con el valor ${fmtNum(mu)}. ` +
      (r.p < 0.05
        ? `La media fue significativamente ${r.diff > 0 ? 'superior' : 'inferior'}, <i>t</i>(${r.df}) = ${f(r.t)}, ${pt(r.p)}, <i>d</i> = ${f(r.d)}, IC 95 % [${ciTxt(r.dCI).slice(1, -1)}], con un tamaño del efecto ${lbl.d(r.d)}.`
        : `No se encontraron diferencias estadísticamente significativas, <i>t</i>(${r.df}) = ${f(r.t)}, ${pt(r.p)}, <i>d</i> = ${f(r.d)}.`)
  );
  sec.code = `# ${name} frente a ${mu}\ndescr(datos$${X})\nshapiro.test(datos$${X})\nt.test(datos$${X}, mu = ${mu}${ALT})\nwilcox.test(datos$${X}, mu = ${mu}${ALT})  # análisis de sensibilidad\neffectsize::cohens_d(datos$${X}, mu = ${mu}${ALT})  # d con IC`;
}
/** Una muestra sin normalidad: Wilcoxon de una muestra con correlación biserial por rangos, tabla, redacción y código R */
function oneSampleWilcoxon({ x, mu, alt, sec, one, hyp, name, n, ds, X, ALT }) {
  const r = S.wilcoxonOne(x, mu, alt);
  sec.test = 'Prueba de rangos con signo de Wilcoxon para una muestra' + (one ? ' (unilateral)' : '');
  sec.decision = `Se eligió la prueba de Wilcoxon para una muestra${hyp} porque los datos no siguen una distribución normal y la muestra es pequeña.`;
  sec.alt = 'Prueba t para una muestra si los datos fueran normales.';
  sec.tables.push(
    apaTable(
      'Resultado de la prueba de Wilcoxon para una muestra',
      [
        '',
        '<i>V</i>',
        '<i>z</i>',
        '<i>p</i>' + (one ? ' (unilateral)' : ''),
        '<i>r</i><sub>rb</sub>',
        'IC 95 % (<i>r</i><sub>rb</sub>)',
      ],
      [[`${esc(name)} − ${fmtNum(mu)}`, f(r.V, 1), f(r.z), pv(r.p), f(r.rb), ciTxt(r.rbCI)]],
      `Se excluyeron ${n - r.n} valores iguales a ${fmtNum(mu)}. ${r.exact ? '<i>p</i> exacta (como R y JASP).' : '<i>p</i> por la aproximación normal con corrección por continuidad.'} <i>r</i><sub>rb</sub> = correlación biserial por rangos (como JASP).`
    )
  );
  const t = S.tTestOne(x, mu, alt);
  sec.sens = `Análisis de sensibilidad: la prueba t para una muestra da ${pt(t.p)}, ${t.p < 0.05 === r.p < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
  sec.text.push(
    `Dado que los datos no seguían una distribución normal, se aplicó la prueba de rangos con signo de Wilcoxon${hyp} para comparar ${esc(name)} (<i>Mdn</i> = ${f(ds.median)}) con el valor ${fmtNum(mu)}. ` +
      (r.p < 0.05
        ? `Se encontraron diferencias estadísticamente significativas, <i>V</i> = ${f(r.V, 1)}, ${pt(r.p)}, <i>r</i><sub>rb</sub> = ${f(r.rb)}, con un tamaño del efecto ${lbl.r(Math.abs(r.rb))}.`
        : `No se encontraron diferencias estadísticamente significativas, <i>V</i> = ${f(r.V, 1)}, ${pt(r.p)}, <i>r</i><sub>rb</sub> = ${f(r.rb)}.`)
  );
  sec.code = `# ${name} frente a ${mu}\ndescr(datos$${X})\nshapiro.test(datos$${X})\nt.test(datos$${X}, mu = ${mu}${ALT})  # análisis de sensibilidad\nwilcox.test(datos$${X}, mu = ${mu}${ALT})  # exacta si no hay empates ni ceros y n < 50\neffectsize::rank_biserial(datos$${X}, mu = ${mu})`;
}
// una muestra: prueba de los signos y prueba de rachas
function addNPOne(sec, name, mu, alt, tests) {
  if (sec.error || !tests.length) return sec;
  const x = numOf(vByName(name)).filter(v => v !== null),
    RA = { two: 'two.sided', greater: 'greater', less: 'less' }[alt];
  let code = '\n# Pruebas adicionales\nx <- na.omit(datos[[' + rq(name) + ']])\n';
  if (tests.includes('sign')) {
    const r = S.signTest(
      x.map(v => v - mu),
      alt
    );
    sec.tables.push(
      apaTable(
        `Prueba de los signos: ${name} frente a ${fmtNum(mu)}`,
        ['Por encima', 'Por debajo', 'Iguales', '<i>Mdn</i>', '<i>p</i>'],
        [[r.pos, r.neg, r.ties, f(S.quantile(S.sorted(x), 0.5)), pv(r.p)]],
        `Binomial exacta${alt !== 'two' ? ' unilateral' : ''}: contrasta si la mediana difiere de ${fmtNum(mu)} sin suponer simetría.`
      )
    );
    sec.text.push(
      `La prueba de los signos ${r.p < 0.05 ? 'indicó' : 'no indicó'} que la mediana de ${esc(name)} difiere de ${fmtNum(mu)} (${r.pos} valores por encima y ${r.neg} por debajo), ${pt(r.p)}.`
    );
    code += `binom.test(sum(x > ${mu}), sum(x != ${mu})${alt !== 'two' ? `, alternative = "${RA}"` : ''})  # prueba de los signos\n`;
  }
  if (tests.includes('runs')) {
    const r = S.runsTest(x);
    if (r) {
      sec.tables.push(
        apaTable(
          `Prueba de rachas: ${name}`,
          ['Rachas', 'Esperadas', '<i>n</i> (≤ / > mediana)', '<i>z</i>', '<i>p</i>'],
          [[r.runs, f(r.E), `${r.m} / ${r.n}`, r.exact ? '—' : f(r.z), pv(r.p)]],
          `Valores por encima de la mediana (${r.med === null ? '—' : f(r.med)}) frente al resto, en el orden de las filas del archivo. <i>p</i> ${r.exact ? 'exacta (n ≤ 30)' : 'normal con corrección por continuidad'}, como DescTools::RunsTest.`
        )
      );
      sec.text.push(
        `La prueba de rachas ${r.p < 0.05 ? `indicó que la secuencia no es aleatoria (${r.runs < r.E ? 'menos' : 'más'} rachas de las esperadas)` : 'no indicó desviaciones de la aleatoriedad en el orden de los casos'}: ${r.runs} rachas frente a ${f(r.E)} esperadas, ${pt(r.p)}.`
      );
    }
    code +=
      'DescTools::RunsTest(x)  # prueba de rachas respecto a la mediana\nn1 <- sum(x > median(x)); n2 <- sum(x <= median(x)); c(rachas_esperadas = 1 + 2 * n1 * n2 / (n1 + n2))\n';
  }
  sec.code = (sec.code || '') + code;
  return sec;
}

export { runOneSample, addNPOne };
