/* Tharp · aplicación · Análisis: Comparación de grupos independientes (t, ANOVA y sus alternativas no paramétricas) */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { catOf, levelsOf, numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { ciTxt, dfF, f, lbl, list, nz, pt, pv, rn, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';
import { compareSeveralAnova, compareSeveralKruskal } from './varios-grupos.js';

function runCompare(yName, gName, alt = 'two', opts = {}) {
  const yv = vByName(yName),
    gv = vByName(gName),
    y = numOf(yv),
    g = catOf(gv),
    lv = levelsOf(gv);
  const sec = nuevaSeccion(`${yName} según ${gName}`);
  let groups = lv.map(l => ({ name: l, x: [] }));
  y.forEach((v, i) => {
    if (v !== null && g[i] !== null) groups[lv.indexOf(g[i])].x.push(v);
  });
  const dropped = groups.filter(q => q.x.length < 3);
  groups = groups.filter(q => q.x.length >= 3);
  if (groups.length < 2) {
    sec.error = 'Se necesitan al menos dos grupos con 3 o más casos.';
    return sec;
  }
  if (groups.some(q => S.sd(q.x) === 0)) {
    sec.error = 'Algún grupo tiene todos los valores iguales (varianza 0): no se puede realizar la prueba.';
    return sec;
  }
  const k = groups.length,
    xs = groups.map(q => q.x),
    N = S.sum(xs.map(a => a.length));
  groups.forEach(q => {
    q.d = S.describe(q.x);
    q.sw = S.shapiro(q.x);
    q.normOK = q.x.length >= 30 || (q.sw && q.sw.p >= 0.05);
  });
  const normOK = groups.every(q => q.normOK),
    lev = S.levene(xs),
    eqVar = lev.p >= 0.05,
    Y = rn(yName),
    G = rn(gName);
  const nameList = list(groups.map(q => esc(q.name)));
  sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa.`);
  sec.why.push(`Variable de agrupación: ${esc(gName)} → ${k} grupos (${nameList}).`);
  sec.why.push('Grupos independientes: se asume que cada participante pertenece a un solo grupo.');
  compareAssumptionChecks({ groups, sec, eqVar, lev, dropped });
  compareDescriptives({ N, sec, yName, gName, groups });
  const MD = q => `<i>M</i> = ${f(q.d.mean)}, <i>DT</i> = ${f(q.d.sd)}`,
    MdnD = q => `<i>Mdn</i> = ${f(q.d.median)}`;
  let code = `# ${yName} según ${gName}\nt(sapply(split(datos[[${rq(yName)}]], datos[[${rq(gName)}]]), descr))  # descriptivos por grupo\ntapply(datos$${Y}, datos$${G}, shapiro.test)   # normalidad por grupo\ncar::leveneTest(${Y} ~ ${G}, data = datos, center = mean)\n`;
  const normWhy = normOK
    ? 'La normalidad se cumple en todos los grupos (o n ≥ 30), por lo que se usa una prueba paramétrica.'
    : 'La normalidad no se cumple en algún grupo con muestra pequeña, por lo que se usa una prueba no paramétrica, que no requiere normalidad.';
  sec.why.push(normWhy);
  if (k === 2) {
    const [A, B] = groups;
    const one = alt !== 'two',
      hyp = one ? ` (hipótesis unilateral: ${esc(A.name)} ${alt === 'greater' ? '>' : '<'} ${esc(B.name)})` : '';
    const rAlt = { two: 'two.sided', greater: 'greater', less: 'less' }[alt];
    if (one)
      sec.why.push(
        `Has elegido una hipótesis unilateral: se contrasta si ${esc(A.name)} puntúa ${alt === 'greater' ? 'más' : 'menos'} que ${esc(B.name)}. Debe decidirse antes de ver los datos; si no, usa la bilateral.`
      );
    if (normOK) {
      ({ code } = compareTwoT({ A, B, eqVar, alt, sec, one, hyp, yName, MD, code, Y, G, rAlt }));
    } else {
      ({ code } = compareTwoMannWhitney({ A, B, alt, sec, one, hyp, MdnD, yName, code, Y, G, rAlt }));
    }
  } else {
    const names = groups.map(q => q.name),
      posthocText = (ph, kind, useMedian) => {
        const sig = ph.filter(c => c.padj < 0.05);
        if (!sig.length)
          return ` Las comparaciones post hoc (${kind}) no detectaron diferencias significativas entre pares concretos.`;
        return (
          ` Las comparaciones post hoc (${kind}) mostraron diferencias significativas entre ` +
          list(
            sig.map(c => {
              const a = groups[c.i],
                b = groups[c.j],
                hi = (useMedian ? a.d.median >= b.d.median : a.d.mean >= b.d.mean) ? [a, b] : [b, a];
              return `${esc(hi[0].name)} y ${esc(hi[1].name)} (${pt(c.padj)}${c.d !== undefined ? `, <i>d</i> = ${f(Math.abs(c.d))}, efecto ${lbl.d(c.d)}` : ''}; puntuaciones más altas en ${esc(hi[0].name)})`;
            })
          ) +
          (sig.length < ph.length ? '. El resto de comparaciones no fueron significativas.' : '.')
        );
      };
    if (normOK) {
      ({ code } = compareSeveralAnova({ xs, code, yName, gName, eqVar, opts, sec, k, names, groups, MD, posthocText }));
    } else {
      ({ code } = compareSeveralKruskal({ xs, sec, k, gName, yName, groups, code, Y, G, MdnD, posthocText, names }));
    }
  }
  ({ code } = compareSensitivityCode({ dropped, code, G, alt, k, Y }));
  sec.code = code;
  return sec;
}

/** Código R del análisis de sensibilidad (la prueba alternativa) y, si se excluyeron grupos, del subconjunto sin ellos */
function compareSensitivityCode({ dropped, code, G, alt, k, Y }) {
  {
    const rA = { two: 'two.sided', greater: 'greater', less: 'less' }[alt],
      A_ = alt !== 'two' ? `, alternative = "${rA}"` : '';
    code +=
      k === 2
        ? `\n# Análisis de sensibilidad (la prueba alternativa que cita Tharp)\nt.test(${Y} ~ ${G}, data = datos, var.equal = FALSE${A_})\nwilcox.test(${Y} ~ ${G}, data = datos${A_})`
        : `\n# Análisis de sensibilidad (la prueba alternativa que cita Tharp)\nkruskal.test(${Y} ~ ${G}, data = datos)\noneway.test(${Y} ~ ${G}, data = datos, var.equal = FALSE)`;
  }
  if (dropped.length)
    code =
      `# Tharp excluyó los grupos con menos de 3 casos: ${dropped.map(q => q.name).join(', ')}\nd <- droplevels(subset(datos, !(${G} %in% c(${dropped.map(q => rq(q.name)).join(', ')}))))\n` +
      code.replace(/(?<![$\w`])datos(?![\w`])/g, 'd');
  return { code };
}
/** Supuestos: normalidad en cada grupo, homogeneidad de varianzas, independencia y grupos excluidos */
function compareAssumptionChecks({ groups, sec, eqVar, lev, dropped }) {
  groups.forEach(q => {
    const sw = q.sw ? `Shapiro-Wilk: <i>W</i> = ${nz(q.sw.W.toFixed(3))}, ${pt(q.sw.p)}` : 'Shapiro-Wilk no calculable';
    if (q.sw && q.sw.p >= 0.05)
      sec.checks.push(chk('ok', `Normalidad en ${esc(q.name)} (<i>n</i> = ${q.x.length}): ${sw}.`));
    else if (q.x.length >= 30)
      sec.checks.push(
        chk(
          'info',
          `Normalidad en ${esc(q.name)} (<i>n</i> = ${q.x.length}): ${sw}. No es normal, pero con <i>n</i> ≥ 30 la prueba paramétrica es robusta (teorema central del límite).`
        )
      );
    else
      sec.checks.push(
        chk(
          'no',
          `Normalidad en ${esc(q.name)} (<i>n</i> = ${q.x.length}): ${sw}. No se cumple y la muestra es pequeña.`
        )
      );
  });
  sec.checks.push(
    chk(
      eqVar ? 'ok' : 'no',
      `Homogeneidad de varianzas (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}. ${eqVar ? 'Se cumple.' : 'No se cumple.'}`
    )
  );
  sec.checks.push(
    chk(
      'info',
      'Independencia: depende del diseño. Si son las mismas personas medidas varias veces, usa «Comparación de medidas relacionadas».'
    )
  );
  if (dropped.length)
    sec.checks.push(chk('no', `Se han excluido grupos con menos de 3 casos: ${list(dropped.map(q => esc(q.name)))}.`));
}
/** Tabla de descriptivos por grupo y figura de medias con IC 95 % */
function compareDescriptives({ N, sec, yName, gName, groups }) {
  const missN = ST.rows.length - N;
  sec.tables.push(
    apaTable(
      `Estadísticos descriptivos de ${yName} por ${gName}`,
      [esc(gName), '<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'IC 95 % (<i>M</i>)'],
      groups.map(q => [
        esc(q.name),
        q.x.length,
        f(q.d.mean),
        f(q.d.sd),
        f(q.d.median),
        `[${f(q.d.ci[0])}, ${f(q.d.ci[1])}]`,
      ]),
      missN ? `Se excluyeron ${missN} casos con valores perdidos.` : ''
    )
  );
  sec.charts.push(
    fig(
      `${yName} por ${gName}: medias e IC 95 %`,
      CH.meansCI(
        groups.map(q => ({ name: q.name, x: q.x, mean: q.d.mean, ci: q.d.ci })),
        yName
      )
    )
  );
}
/** Dos grupos con normalidad: t de Student o de Welch con d de Cohen, tabla, redacción y código R */
function compareTwoT({ A, B, eqVar, alt, sec, one, hyp, yName, MD, code, Y, G, rAlt }) {
  const r = S.tTestInd(A.x, B.x, eqVar, alt),
    name = eqVar
      ? 'prueba t de Student para muestras independientes'
      : 'prueba t de Welch para muestras independientes';
  sec.test = (eqVar ? 'Prueba t de Student' : 'Prueba t de Welch') + (one ? ' (unilateral)' : '');
  sec.why.push(
    eqVar
      ? 'Las varianzas son homogéneas (Levene p ≥ .05): se usa la prueba t clásica.'
      : 'Las varianzas no son homogéneas (Levene p < .05): se usa la corrección de Welch, que no asume varianzas iguales.'
  );
  sec.decision = `Se eligió la ${name}${hyp} porque se comparan 2 grupos independientes en una variable cuantitativa, la normalidad es aceptable y las varianzas ${eqVar ? 'son homogéneas' : 'difieren (corrección de Welch)'}.`;
  sec.alt = 'U de Mann-Whitney si no se cumpliera la normalidad con muestras pequeñas.';
  sec.tables.push(
    apaTable(
      `Resultado de la ${name}`,
      [
        '',
        '<i>t</i>',
        '<i>gl</i>',
        '<i>p</i>' + (one ? ' (unilateral)' : ''),
        'Diferencia de medias',
        `IC ${one ? '95 % unilateral' : '95 %'}`,
        '<i>d</i> de Cohen',
        'IC 95 % (<i>d</i>)',
        '<i>g</i> de Hedges',
      ],
      [
        [
          `${esc(A.name)} − ${esc(B.name)}`,
          f(r.t),
          dfF(r.df),
          pv(r.p),
          f(r.diff),
          ciTxt(r.ci),
          f(r.d),
          ciTxt(r.dCI),
          f(r.g),
        ],
      ],
      (eqVar
        ? '<i>d</i> = diferencia de medias / desviación típica combinada.'
        : '<i>d</i> = diferencia de medias / raíz de la media de las dos varianzas (como JASP con Welch).') +
        ' IC de <i>d</i> por la distribución <i>t</i> no central. <i>g</i> = <i>d</i> con la corrección de Hedges para muestras pequeñas.'
    )
  );
  const mw = S.mannWhitney(A.x, B.x, alt);
  sec.sens = `Análisis de sensibilidad: la U de Mann-Whitney da ${pt(mw.p)}, ${mw.p < 0.05 === r.p < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión de la prueba t.`;
  const st = `<i>t</i>(${dfF(r.df)}) = ${f(r.t)}, ${pt(r.p)}${one ? ' (unilateral)' : ''}, <i>d</i> = ${f(r.d)}, IC 95 % [${ciTxt(r.dCI).slice(1, -1)}]`;
  sec.text.push(
    `Se aplicó una ${name}${hyp} para comparar ${esc(yName)} entre ${esc(A.name)} y ${esc(B.name)}. ` +
      (r.p < 0.05
        ? `${esc(A.name)} (${MD(A)}) obtuvo puntuaciones significativamente ${r.diff > 0 ? 'más altas' : 'más bajas'} que ${esc(B.name)} (${MD(B)}), ${st}. El tamaño del efecto fue ${lbl.d(r.d)}.`
        : `No se encontraron diferencias estadísticamente significativas entre ${esc(A.name)} (${MD(A)}) y ${esc(B.name)} (${MD(B)}), ${st}.`)
  );
  code +=
    `with(datos, mean(${Y}[${G} == ${rq(A.name)}], na.rm = TRUE) - mean(${Y}[${G} == ${rq(B.name)}], na.rm = TRUE))  # diferencia de medias (${A.name} − ${B.name})\nt.test(${Y} ~ ${G}, data = datos, var.equal = ${eqVar ? 'TRUE' : 'FALSE'}${one ? `, alternative = "${rAlt}"` : ''})\n` +
    (eqVar
      ? `effectsize::cohens_d(${Y} ~ ${G}, data = datos${one ? `, alternative = "${rAlt}"` : ''})  # d con IC (t no central)\neffectsize::hedges_g(${Y} ~ ${G}, data = datos)`
      : `# d de Welch como JASP: diferencia / sqrt((s1^2 + s2^2) / 2); IC por la t no central con los gl de Welch y g de Hedges, como Tharp\n` +
        `with(datos, { a <- ${Y}[${G} == ${rq(A.name)} & !is.na(${Y})]; b <- ${Y}[${G} == ${rq(B.name)} & !is.na(${Y})]; n1 <- length(a); n2 <- length(b)\n` +
        `  d <- (mean(a) - mean(b)) / sqrt((var(a) + var(b)) / 2); gl <- (var(a) / n1 + var(b) / n2)^2 / ((var(a) / n1)^2 / (n1 - 1) + (var(b) / n2)^2 / (n2 - 1)); k <- sqrt(n1 * n2 / (n1 + n2))\n` +
        `  ncp <- function(q) suppressWarnings(uniroot(function(m) pt(d * k, gl, m) - q, d * k + c(-1, 1) * (10 + abs(d * k)), extendInt = "yes", tol = 1e-12))$root  # pt avisa de precisión en las colas lejanas que explora la búsqueda\n` +
        `  print(c(d = d, ic_inf = ${alt === 'less' ? '-Inf' : `ncp(${alt === 'two' ? '.975' : '.95'}) / k`}, ic_sup = ${alt === 'greater' ? 'Inf' : `ncp(${alt === 'two' ? '.025' : '.05'}) / k`}, g = d * exp(lgamma((n1 + n2 - 2) / 2) - log(sqrt((n1 + n2 - 2) / 2)) - lgamma((n1 + n2 - 3) / 2))), digits = 7) })`);
  return { code };
}
/** Dos grupos sin normalidad: U de Mann-Whitney con correlación biserial por rangos, tabla, redacción y código R */
function compareTwoMannWhitney({ A, B, alt, sec, one, hyp, MdnD, yName, code, Y, G, rAlt }) {
  const r = S.mannWhitney(A.x, B.x, alt);
  sec.test = 'U de Mann-Whitney' + (one ? ' (unilateral)' : '');
  sec.decision = `Se eligió la U de Mann-Whitney${hyp} porque se comparan 2 grupos independientes y la normalidad no se cumple en algún grupo con muestra pequeña.`;
  sec.alt = 'Prueba t para muestras independientes si los datos fueran aproximadamente normales.';
  sec.tables.push(
    apaTable(
      'Resultado de la prueba U de Mann-Whitney',
      [
        '',
        '<i>U</i>',
        '<i>z</i>',
        '<i>p</i>' + (one ? ' (unilateral)' : ''),
        '<i>r</i><sub>rb</sub>',
        'IC 95 % (<i>r</i><sub>rb</sub>)',
      ],
      [[`${esc(A.name)} vs. ${esc(B.name)}`, f(r.U, 1), f(r.z), pv(r.p), f(r.rb), ciTxt(r.rbCI)]],
      `<i>U</i> del grupo ${esc(A.name)}. ${r.exact ? '<i>p</i> exacta (sin empates y menos de 50 casos por grupo, como R y JASP).' : '<i>p</i> por la aproximación normal con corrección por continuidad y por empates.'} <i>r</i><sub>rb</sub> = correlación biserial por rangos (positiva si ${esc(A.name)} tiende a puntuar más), como JASP.`
    )
  );
  const w = S.tTestInd(A.x, B.x, false, alt);
  sec.sens = `Análisis de sensibilidad: la prueba t de Welch da ${pt(w.p)}, ${w.p < 0.05 === r.p < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
  const st = `<i>U</i> = ${f(r.U, 1)}, ${pt(r.p)}${one ? ' (unilateral)' : ''}, <i>r</i><sub>rb</sub> = ${f(r.rb)}, IC 95 % [${ciTxt(r.rbCI).slice(1, -1)}]`;
  sec.text.push(
    `Dado que no se cumplía el supuesto de normalidad, se aplicó la prueba U de Mann-Whitney${hyp}. ` +
      (r.p < 0.05
        ? `${esc(A.name)} (${MdnD(A)}) obtuvo puntuaciones significativamente ${r.rb >= 0 ? 'más altas' : 'más bajas'} en ${esc(yName)} que ${esc(B.name)} (${MdnD(B)}), ${st}, con un tamaño del efecto ${lbl.r(Math.abs(r.rb))}.`
        : `No se encontraron diferencias estadísticamente significativas en ${esc(yName)} entre ${esc(A.name)} (${MdnD(A)}) y ${esc(B.name)} (${MdnD(B)}), ${st}.`)
  );
  code += `wilcox.test(${Y} ~ ${G}, data = datos${one ? `, alternative = "${rAlt}"` : ''})  # exacta si no hay empates y n < 50, como Tharp\neffectsize::rank_biserial(${Y} ~ ${G}, data = datos)`;
  return { code };
}
// pruebas no paramétricas adicionales para grupos independientes, elegidas por la persona
function addNPGroups(sec, yName, gName, tests) {
  if (sec.error || !tests.length) return sec;
  const gv = vByName(gName),
    y = numOf(vByName(yName)),
    g = catOf(gv),
    lv = levelsOf(gv),
    groups = lv.map(l => ({ name: l, x: [] }));
  y.forEach((v, i) => {
    if (v !== null && g[i] !== null) groups[lv.indexOf(g[i])].x.push(v);
  });
  const gs = groups.filter(q => q.x.length >= 3),
    xs = gs.map(q => q.x),
    nm = gs.map(q => esc(q.name)),
    txt = [];
  let code = `\n# Pruebas no paramétricas adicionales\ndn <- subset(datos, !is.na(${rn(yName)}) & ${rn(gName)} %in% c(${gs.map(q => rq(q.name)).join(', ')}))\ndn$g <- factor(dn[[${rq(gName)}]], levels = c(${gs.map(q => rq(q.name)).join(', ')})); dn$y <- dn[[${rq(yName)}]]\n`;
  if (tests.includes('median')) {
    const r = S.medianTest(xs);
    if (isFinite(r.chi)) {
      const pUse = r.minE < 5 && r.pFisher != null ? r.pFisher : r.p;
      sec.tables.push(
        apaTable(
          `Prueba de la mediana: ${yName} según ${gName}`,
          [''].concat(nm),
          [[`Por encima de ${f(r.med)} (mediana conjunta)`].concat(r.tab[0]), [`Igual o por debajo`].concat(r.tab[1])],
          `χ²(${r.df}) = ${f(r.chi)}, ${pt(r.p)}${r.pFisher != null ? `; prueba exacta de Fisher: ${pt(r.pFisher)}` : ''}.${r.minE < 5 ? ' Hay frecuencias esperadas menores que 5: conviene usar la <i>p</i> exacta de Fisher.' : ''}`
        )
      );
      txt.push(
        `La prueba de la mediana ${pUse < 0.05 ? 'mostró' : 'no mostró'} diferencias entre los grupos en la proporción de casos por encima de la mediana conjunta (${f(r.med)}), χ²(${r.df}) = ${f(r.chi)}, ${pt(r.p)}${r.pFisher != null ? ` (prueba exacta de Fisher: ${pt(r.pFisher)})` : ''}.`
      );
    } else
      txt.push(
        'La prueba de la mediana no se pudo calcular: todos los casos quedan al mismo lado de la mediana conjunta.'
      );
    code += `tab <- table(dn$y > median(dn$y), dn$g)  # prueba de la mediana\nchisq.test(tab, correct = FALSE)\nfisher.test(tab, workspace = 2e7)\n`;
  }
  if (tests.includes('ks')) {
    if (gs.length !== 2)
      sec.checks.push(
        chk(
          'info',
          `La prueba de Kolmogorov-Smirnov para dos muestras solo se aplica con 2 grupos (hay ${gs.length}): no se calculó.`
        )
      );
    else {
      const r = S.ks2(xs[0], xs[1]);
      sec.tables.push(
        apaTable(
          `Kolmogorov-Smirnov para dos muestras: ${yName} según ${gName}`,
          ['<i>D</i>', '<i>p</i>', '<i>n</i>'],
          [[nz(r.D.toFixed(3)), pv(r.p), `${r.m} y ${r.n}`]],
          `Compara las distribuciones completas (posición, dispersión y forma). <i>p</i> ${r.exact ? 'exacta' : 'asintótica'}, como ks.test de R.`
        )
      );
      txt.push(
        `La prueba de Kolmogorov-Smirnov ${r.p < 0.05 ? 'indicó' : 'no indicó'} que las distribuciones de ${esc(yName)} en ${nm[0]} y ${nm[1]} difieren, <i>D</i> = ${nz(r.D.toFixed(2))}, ${pt(r.p)}.`
      );
      code += `ks.test(dn$y[dn$g == ${rq(gs[0].name)}], dn$y[dn$g == ${rq(gs[1].name)}])\n`;
    }
  }
  if (tests.includes('jt')) {
    const r = S.jonckheere(xs);
    sec.tables.push(
      apaTable(
        `Jonckheere-Terpstra: ${yName} según ${gName} (orden ${gs.map(q => q.name).join(' < ')})`,
        ['<i>J</i>', '<i>z</i>', '<i>p</i>', '<i>N</i>'],
        [[f(r.JT, 1), f(r.z), pv(r.p), r.N]],
        `Contrasta una tendencia monótona en el orden de los grupos (${list(nm)}). <i>p</i> bilateral ${r.exact ? 'exacta' : `por aproximación normal${r.ties ? ' con corrección por empates' : ''}`}. Para cambiar el orden, usa el botón «Orden» en Variables.`
      )
    );
    txt.push(
      `La prueba de Jonckheere-Terpstra ${r.p < 0.05 ? `mostró una tendencia ${r.z > 0 ? 'creciente' : 'decreciente'}` : 'no mostró una tendencia significativa'} de ${esc(yName)} en el orden ${list(nm)}, <i>J</i> = ${f(r.JT, 1)}, <i>z</i> = ${f(r.z)}, ${pt(r.p)}.`
    );
    code += r.exact
      ? `clinfun::jonckheere.test(dn$y, as.numeric(dn$g))  # p exacta\n`
      : `PMCMRplus::jonckheereTest(dn$y, dn$g)  # aproximación normal con corrección por empates\n`;
  }
  if (txt.length) sec.text.push(txt.join(' '));
  sec.why.push(
    'Pruebas no paramétricas adicionales elegidas por ti: complementan el análisis principal sin sustituirlo.'
  );
  sec.code = (sec.code || '') + code;
  return sec;
}

export { runCompare, addNPGroups };
