/* Tharp · aplicación · Análisis: Comparación de dos medidas relacionadas */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { ciTxt, f, lbl, nz, pt, pv, rn, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

function runPaired(aName, bName, alt = 'two', forceNP = false) {
  const sec = nuevaSeccion(`${aName} frente a ${bName} (medidas relacionadas)`);
  if (aName === bName) {
    sec.error = 'Elige dos variables distintas.';
    return sec;
  }
  const xa = numOf(vByName(aName)),
    xb = numOf(vByName(bName)),
    a = [],
    b = [];
  xa.forEach((v, i) => {
    if (v !== null && xb[i] !== null) {
      a.push(v);
      b.push(xb[i]);
    }
  });
  if (a.length < 3) {
    sec.error = 'Se necesitan al menos 3 casos con ambas medidas.';
    return sec;
  }
  const d = b.map((v, i) => v - a[i]);
  if (S.sd(d) === 0) {
    sec.error = 'Las diferencias son todas iguales: no se puede realizar la prueba.';
    return sec;
  }
  const n = a.length,
    sw = S.shapiro(d),
    normOK = !forceNP && (n >= 30 || (sw && sw.p >= 0.05)),
    da = S.describe(a),
    db = S.describe(b),
    A = rn(aName),
    B = rn(bName);
  sec.why.push(`Se comparan dos medidas de las mismas personas: ${esc(aName)} y ${esc(bName)}.`);
  sec.why.push(
    'Al ser medidas relacionadas, se analiza la diferencia dentro de cada persona, lo que elimina la variabilidad entre sujetos.'
  );
  if (forceNP)
    sec.why.push('Has pedido usar siempre la prueba no paramétrica (Wilcoxon), sin depender de la normalidad.');
  pairedChecksAndDescriptives({ sw, sec, n, aName, da, bName, db, a, b });
  const one = alt !== 'two',
    rAlt = { two: 'two.sided', greater: 'greater', less: 'less' }[alt],
    ALT = one ? `, alternative = "${rAlt}"` : '';
  const hyp = one ? ` (hipótesis unilateral: ${esc(bName)} ${alt === 'greater' ? '>' : '<'} ${esc(aName)})` : '';
  if (one)
    sec.why.push(
      `Has elegido una hipótesis unilateral: se contrasta si ${esc(bName)} es ${alt === 'greater' ? 'mayor' : 'menor'} que ${esc(aName)}. Debe decidirse antes de ver los datos.`
    );
  if (normOK) {
    pairedT({ a, b, alt, sec, one, hyp, bName, aName, da, db, B, A, ALT });
  } else {
    pairedWilcoxon({ a, b, alt, sec, one, forceNP, hyp, bName, aName, n, da, db, B, A, ALT });
  }
  return sec;
}
/** Normalidad de las diferencias, tabla de descriptivos y figura de medias con IC 95 % */
function pairedChecksAndDescriptives({ sw, sec, n, aName, da, bName, db, a, b }) {
  const swT = sw
    ? `Shapiro-Wilk de las diferencias: <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}`
    : 'Shapiro-Wilk no calculable';
  sec.checks.push(
    sw && sw.p >= 0.05
      ? chk('ok', swT + '. Se cumple la normalidad.')
      : n >= 30
        ? chk('info', swT + `. No es normal, pero con <i>n</i> = ${n} ≥ 30 la prueba t es robusta.`)
        : chk('no', swT + '. No se cumple y la muestra es pequeña.')
  );
  sec.tables.push(
    apaTable(
      'Estadísticos descriptivos de las medidas relacionadas',
      ['Medida', '<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>'],
      [
        [esc(aName), n, f(da.mean), f(da.sd), f(da.median)],
        [esc(bName), n, f(db.mean), f(db.sd), f(db.median)],
      ],
      ST.rows.length - n ? `Se excluyeron ${ST.rows.length - n} casos sin ambas medidas.` : ''
    )
  );
  sec.charts.push(
    fig(
      `${aName} y ${bName}: medias e IC 95 %`,
      CH.meansCI(
        [
          { name: aName, x: a, mean: da.mean, ci: da.ci },
          { name: bName, x: b, mean: db.mean, ci: db.ci },
        ],
        'Puntuación',
        { connect: true }
      )
    )
  );
}
/** Medidas relacionadas con diferencias normales: t relacionada con d_z, tabla, redacción y código R */
function pairedT({ a, b, alt, sec, one, hyp, bName, aName, da, db, B, A, ALT }) {
  const r = S.tTestPaired(a, b, alt);
  sec.test = 'Prueba t para muestras relacionadas' + (one ? ' (unilateral)' : '');
  sec.why.push(
    'Las diferencias son aproximadamente normales (o n ≥ 30): se usa la prueba t para muestras relacionadas.'
  );
  sec.decision = `Se eligió la prueba t para muestras relacionadas${hyp} porque son dos medidas de las mismas personas y la normalidad de las diferencias es aceptable.`;
  sec.alt = 'Prueba de rangos con signo de Wilcoxon si las diferencias no fueran normales.';
  sec.tables.push(
    apaTable(
      'Resultado de la prueba t para muestras relacionadas',
      [
        '',
        '<i>t</i>',
        '<i>gl</i>',
        '<i>p</i>' + (one ? ' (unilateral)' : ''),
        'Diferencia de medias',
        'IC 95 %',
        '<i>d</i><sub>z</sub>',
        'IC 95 % (<i>d</i><sub>z</sub>)',
      ],
      [[`${esc(bName)} − ${esc(aName)}`, f(r.t), r.df, pv(r.p), f(r.diff), ciTxt(r.ci), f(r.dz), ciTxt(r.dzCI)]],
      '<i>d</i><sub>z</sub> = media de las diferencias / desviación típica de las diferencias (como JASP); IC por la distribución <i>t</i> no central.'
    )
  );
  const w = S.wilcoxonSigned(a, b, alt);
  sec.sens = `Análisis de sensibilidad: la prueba de Wilcoxon da ${pt(w.p)}, ${w.p < 0.05 === r.p < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
  const st = `<i>t</i>(${r.df}) = ${f(r.t)}, ${pt(r.p)}${one ? ' (unilateral)' : ''}, <i>d</i><sub>z</sub> = ${f(r.dz)}, IC 95 % [${ciTxt(r.dzCI).slice(1, -1)}]`;
  sec.text.push(
    `Se aplicó una prueba t para muestras relacionadas${hyp} para comparar ${esc(aName)} (<i>M</i> = ${f(da.mean)}, <i>DT</i> = ${f(da.sd)}) y ${esc(bName)} (<i>M</i> = ${f(db.mean)}, <i>DT</i> = ${f(db.sd)}). ` +
      (r.p < 0.05
        ? `Las puntuaciones ${r.diff > 0 ? 'aumentaron' : 'disminuyeron'} de forma estadísticamente significativa, ${st}, con un tamaño del efecto ${lbl.d(r.dz)}.`
        : `No se encontraron diferencias estadísticamente significativas, ${st}.`)
  );
  sec.code = `# ${aName} frente a ${bName}\nt(sapply(na.omit(datos[, c(${rq(aName)}, ${rq(bName)})]), descr))  # descriptivos (casos con ambas medidas)\nshapiro.test(datos$${B} - datos$${A})\nt.test(datos$${B}, datos$${A}, paired = TRUE${ALT})\nwilcox.test(datos$${B}, datos$${A}, paired = TRUE${ALT})  # análisis de sensibilidad\neffectsize::cohens_d(datos$${B}, datos$${A}, paired = TRUE${ALT})  # d_z con IC`;
}
/** Medidas relacionadas sin normalidad de las diferencias: Wilcoxon de rangos con signo, tabla, redacción y código R */
function pairedWilcoxon({ a, b, alt, sec, one, forceNP, hyp, bName, aName, n, da, db, B, A, ALT }) {
  const r = S.wilcoxonSigned(a, b, alt);
  sec.test = 'Prueba de rangos con signo de Wilcoxon' + (one ? ' (unilateral)' : '');
  if (!forceNP)
    sec.why.push(
      'Las diferencias no son normales y la muestra es pequeña: se usa la prueba de Wilcoxon, que no requiere normalidad.'
    );
  sec.decision = `Se eligió la prueba de Wilcoxon${hyp} porque son dos medidas de las mismas personas y ${forceNP ? 'se pidió una prueba no paramétrica' : 'las diferencias no siguen una distribución normal'}.`;
  sec.alt = 'Prueba t para muestras relacionadas si las diferencias fueran normales.';
  sec.tables.push(
    apaTable(
      'Resultado de la prueba de rangos con signo de Wilcoxon',
      [
        '',
        '<i>V</i>',
        '<i>z</i>',
        '<i>p</i>' + (one ? ' (unilateral)' : ''),
        '<i>r</i><sub>rb</sub>',
        'IC 95 % (<i>r</i><sub>rb</sub>)',
      ],
      [[`${esc(bName)} − ${esc(aName)}`, f(r.V, 1), f(r.z), pv(r.p), f(r.rb), ciTxt(r.rbCI)]],
      `<i>V</i> = suma de rangos de las diferencias positivas. Se excluyeron ${n - r.n} diferencias nulas. ${r.exact ? '<i>p</i> exacta (sin empates ni ceros y menos de 50 pares, como R y JASP).' : '<i>p</i> por la aproximación normal con corrección por continuidad.'} <i>r</i><sub>rb</sub> = correlación biserial por rangos de pares emparejados (como JASP).`
    )
  );
  const t = S.tTestPaired(a, b, alt);
  sec.sens = `Análisis de sensibilidad: la prueba t relacionada da ${pt(t.p)}, ${t.p < 0.05 === r.p < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
  const st = `<i>V</i> = ${f(r.V, 1)}, ${pt(r.p)}${one ? ' (unilateral)' : ''}, <i>r</i><sub>rb</sub> = ${f(r.rb)}, IC 95 % [${ciTxt(r.rbCI).slice(1, -1)}]`;
  sec.text.push(
    `${forceNP ? 'Se' : 'Dado que las diferencias no seguían una distribución normal, se'} aplicó la prueba de rangos con signo de Wilcoxon${hyp} para comparar ${esc(aName)} (<i>Mdn</i> = ${f(da.median)}) y ${esc(bName)} (<i>Mdn</i> = ${f(db.median)}). ` +
      (r.p < 0.05
        ? `Se encontraron diferencias estadísticamente significativas, ${st}, con un tamaño del efecto ${lbl.r(Math.abs(r.rb))}.`
        : `No se encontraron diferencias estadísticamente significativas, ${st}.`)
  );
  sec.code = `# ${aName} frente a ${bName}\nt(sapply(na.omit(datos[, c(${rq(aName)}, ${rq(bName)})]), descr))  # descriptivos (casos con ambas medidas)\nshapiro.test(datos$${B} - datos$${A})\nt.test(datos$${B}, datos$${A}, paired = TRUE${ALT})  # análisis de sensibilidad\nwilcox.test(datos$${B}, datos$${A}, paired = TRUE${ALT})  # exacta si no hay empates ni ceros y n < 50\neffectsize::rank_biserial(datos$${B}, datos$${A}, paired = TRUE)`;
}
// prueba de los signos para dos medidas relacionadas
function addSign(sec, aName, bName, alt, on) {
  if (!on || sec.error) return sec;
  const xa = numOf(vByName(aName)),
    xb = numOf(vByName(bName)),
    d = [];
  xa.forEach((v, i) => {
    if (v !== null && xb[i] !== null) d.push(xb[i] - v);
  });
  const r = S.signTest(d, alt),
    RA = { two: 'two.sided', greater: 'greater', less: 'less' }[alt];
  sec.tables.push(
    apaTable(
      `Prueba de los signos: ${bName} − ${aName}`,
      ['Diferencias positivas', 'Negativas', 'Empates', '<i>p</i>'],
      [[r.pos, r.neg, r.ties, pv(r.p)]],
      `Binomial exacta sobre las diferencias distintas de 0${alt !== 'two' ? ' (unilateral)' : ''}. Solo usa el signo de cada diferencia: menos potente que Wilcoxon, pero no supone simetría.`
    )
  );
  sec.text.push(
    `La prueba de los signos (${r.pos} diferencias positivas, ${r.neg} negativas y ${r.ties} empates) ${r.p < 0.05 ? 'fue' : 'no fue'} significativa, ${pt(r.p)}.`
  );
  sec.code =
    (sec.code || '') +
    `\n# Prueba de los signos\nd <- datos[[${rq(bName)}]] - datos[[${rq(aName)}]]; d <- d[!is.na(d)]\nbinom.test(sum(d > 0), sum(d != 0)${alt !== 'two' ? `, alternative = "${RA}"` : ''})`;
  return sec;
}

export { runPaired, addSign };
