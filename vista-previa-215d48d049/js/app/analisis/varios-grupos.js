/* Tharp · aplicación · Análisis: comparación de tres o más grupos (ANOVA, Welch, contrastes y Kruskal-Wallis) */
import S from '../../motor/index.js';
import { esc } from '../graficos.js';
import { dfF, f, fmtNum, lbl, list, nz, pt, pv, rq } from '../formato.js';
import { apaTable, gtCode } from '../resultados/piezas.js';

/** Tres o más grupos con normalidad: ANOVA (o Welch), post hoc elegido o automático, contrastes, redacción y código R */
function compareSeveralAnova({ xs, code, yName, gName, eqVar, opts, sec, k, names, groups, MD, posthocText }) {
  const cl = S.anova(xs);
  code += `dd <- data.frame(y = datos[[${rq(yName)}]], g = factor(datos[[${rq(gName)}]]))  # nombres simples para aov y TukeyHSD\ndd <- dd[complete.cases(dd), ]\nc(SC_total = sum((dd$y - mean(dd$y))^2), gl_total = nrow(dd) - 1)\n`;
  let om, ph, phName;
  if (eqVar) {
    om = cl;
    sec.test = 'ANOVA de un factor';
    phName = 'Tukey HSD';
    ph = S.hasTukey ? S.tukeyHSD(xs, cl.msw, cl.df2) : S.pairwiseHolm(xs, true);
    if (!S.hasTukey) phName = 't por pares con corrección de Holm';
  } else {
    om = S.welchAnova(xs);
    sec.test = 'ANOVA de Welch';
    phName = 'Games-Howell';
    ph = S.hasTukey ? S.gamesHowell(xs) : S.pairwiseHolm(xs, false);
    if (!S.hasTukey) phName = 't de Welch por pares con corrección de Holm';
  }
  // prueba post hoc elegida por la persona (si no, la automática según la homogeneidad de varianzas)
  const PHN = {
    tukey: 'Tukey HSD',
    gh: 'Games-Howell',
    bonferroni: 'Bonferroni',
    holm: 'Holm',
    sidak: 'Šidák',
    scheffe: 'Scheffé',
    lsd: 'DMS de Fisher, sin corrección',
    tamhane: 'T2 de Tamhane',
    dunnett: 'Dunnett',
    snk: 'Student-Newman-Keuls',
    duncan: 'Duncan',
    regwq: 'REGWQ',
    gt2: 'GT2 de Hochberg',
    gabriel: 'Gabriel',
  };
  const STEP = ['snk', 'duncan', 'regwq'];
  let sw = null;
  const userPH = opts.ph && opts.ph !== 'auto' ? opts.ph : null,
    robustPH = m => m === 'gh' || m === 'tamhane';
  if (userPH) {
    phName = PHN[userPH];
    if (userPH === 'tukey') ph = S.tukeyHSD(xs, cl.msw, cl.df2);
    else if (userPH === 'gh') ph = S.gamesHowell(xs);
    else if (userPH === 'dunnett') {
      const ci = Math.max(0, names.indexOf(opts.ctrl));
      ph = S.dunnett(xs, ci, cl.msw, cl.df2);
      phName = `Dunnett, frente a ${esc(names[ci])}`;
    } else if (STEP.includes(userPH)) {
      sw = S.stepwisePH(xs, cl.msw, cl.df2, userPH);
      ph = sw.pairs;
    } else ph = S.posthocMethod(xs, cl.msw, cl.df2, userPH);
    sec.why.push(
      `Comparaciones post hoc elegidas por ti: ${phName}.${robustPH(userPH) !== !eqVar ? ` Ten en cuenta que ${eqVar ? 'las varianzas son homogéneas, así que Tukey sería suficiente' : 'las varianzas no son homogéneas: es preferible una prueba que no las asuma iguales (Games-Howell o T2 de Tamhane)'}.` : ''}`
    );
  }
  // d de Cohen por pares: con varianzas homogéneas, sobre la DT del error del modelo (√MCE), como JASP y emmeans::eff_size;
  // con varianzas distintas, sobre la media de las dos varianzas (d_av)
  const useAv = userPH ? robustPH(userPH) : !eqVar;
  ph.forEach(c => {
    c.d = c.diff / Math.sqrt(!useAv ? cl.msw : (S.variance(xs[c.i]) + S.variance(xs[c.j])) / 2);
  });
  sec.why.push(
    eqVar
      ? 'Las varianzas son homogéneas: ANOVA clásico con post hoc de Tukey.'
      : 'Las varianzas no son homogéneas: ANOVA de Welch con post hoc de Games-Howell, que no asumen varianzas iguales.'
  );
  sec.decision = `Se eligió el ${sec.test} porque se comparan ${k} grupos independientes en una variable cuantitativa con normalidad aceptable${eqVar ? ' y varianzas homogéneas' : ' y varianzas distintas'}.`;
  sec.alt = 'Prueba de Kruskal-Wallis si no se cumpliera la normalidad con muestras pequeñas.';
  anovaTable({ eqVar, sec, gName, cl, xs, om });
  ({ code } = plannedContrasts({ opts, xs, cl, names, sec, code }));
  anovaReport({ xs, sec, om, cl, yName, gName, groups, useAv, userPH, sw, k, ph, MD, names, phName, posthocText });
  ({ code } = anovaRCode({ code, eqVar, userPH, opts, names }));
  return { code };
}
/** Tabla del ANOVA (o de Welch y Brown-Forsythe si las varianzas no son homogéneas) */
function anovaTable({ eqVar, sec, gName, cl, xs, om }) {
  if (eqVar)
    sec.tables.push(
      apaTable(
        'Resultado del ANOVA de un factor',
        ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²', 'ω²'],
        [
          [
            esc(gName),
            f(cl.ssb),
            cl.df1,
            f(cl.ssb / cl.df1),
            f(cl.F),
            pv(cl.p),
            nz(cl.eta2.toFixed(3)),
            nz(cl.omega2.toFixed(3)),
          ],
          ['Error', f(cl.ssw), cl.df2, f(cl.msw), '', '', '', ''],
          ['Total', f(cl.ssb + cl.ssw), cl.df1 + cl.df2, '', '', '', '', ''],
        ],
        'ω² = omega cuadrado, estimación menos sesgada del tamaño del efecto en la población.'
      )
    );
  else {
    const bf = S.brownForsythe(xs);
    sec.tables.push(
      apaTable(
        'Resultado del ANOVA robusto (varianzas distintas)',
        ['Prueba', '<i>F</i>', '<i>gl</i><sub>1</sub>', '<i>gl</i><sub>2</sub>', '<i>p</i>', 'η²', 'ω²'],
        [
          ['Welch', f(om.F), om.df1, f(om.df2), pv(om.p), nz(cl.eta2.toFixed(3)), nz(cl.omega2.toFixed(3))],
          ['Brown-Forsythe', f(bf.F), bf.df1, f(bf.df2), pv(bf.p), '', ''],
        ],
        'Se interpreta la prueba de Welch; Brown-Forsythe se muestra como comprobación. η² y ω² se calculan a partir del ANOVA clásico, como medidas descriptivas del tamaño del efecto.'
      )
    );
  }
}
/** Contrastes planificados (sin corrección): tabla, redacción y código R */
function plannedContrasts({ opts, xs, cl, names, sec, code }) {
  if (opts.con) {
    const cs = S.contrasts(xs, cl.msw, cl.df2, opts.con),
      CN = {
        polynomial: 'polinómicos (tendencia)',
        helmert: 'de Helmert (cada grupo frente a la media de los siguientes)',
        difference: 'de diferencia (cada grupo frente a la media de los anteriores)',
        repeated: 'repetidos (cada grupo frente al siguiente)',
        simple: `simples (cada grupo frente a ${esc(names[0])})`,
        deviation: 'de desviación (cada grupo frente a la media global)',
      };
    const lab = c =>
      c.name ||
      {
        helmert: `${esc(names[c.i])} vs. media de ${list(names.slice(c.i + 1).map(esc))}`,
        difference: `${esc(names[c.i + 1])} vs. media de ${list(names.slice(0, c.i + 1).map(esc))}`,
        repeated: `${esc(names[c.i])} − ${esc(names[c.i + 1])}`,
        simple: `${esc(names[c.i + 1])} − ${esc(names[0])}`,
        deviation: `${esc(names[c.i + 1])} − media global`,
      }[opts.con];
    sec.tables.push(
      apaTable(
        `Contrastes planificados ${CN[opts.con]}`,
        ['Contraste', 'Pesos', 'Estimación', '<i>EE</i>', `<i>t</i>(${cl.df2})`, '<i>p</i>'],
        cs.map(c => [
          lab(c),
          c.w.map(w => fmtNum(Math.round(w * 1000) / 1000)).join(', '),
          f(c.est),
          f(c.se),
          f(c.t),
          pv(c.p),
        ]),
        `Pesos en el orden de los grupos (${list(names.map(esc))}). Contrastes planificados con el error del ANOVA y sin corrección por comparaciones múltiples, como en SPSS: deben decidirse antes de ver los datos.${opts.con === 'polynomial' ? ' Los contrastes de tendencia solo tienen sentido si los grupos siguen un orden (por ejemplo, dosis o niveles crecientes).' : ''}`
      )
    );
    sec.why.push(`Contrastes planificados ${CN[opts.con]}, elegidos por ti.`);
    code += `# Contrastes planificados (sin corrección)\nem <- emmeans::emmeans(aov(y ~ g, data = dd), ~ g)\nemmeans::contrast(em, list(${cs.map((c, q) => `${rq('c' + (q + 1))} = c(${c.w.map(w => +w.toFixed(6)).join(', ')})`).join(', ')}), adjust = "none")\n`;
  }
  return { code };
}
/** Redacción APA del ANOVA y tabla de comparaciones post hoc */
function anovaReport({
  xs,
  sec,
  om,
  cl,
  yName,
  gName,
  groups,
  useAv,
  userPH,
  sw,
  k,
  ph,
  MD,
  names,
  phName,
  posthocText,
}) {
  const kw = S.kruskal(xs);
  sec.sens = `Análisis de sensibilidad: la prueba de Kruskal-Wallis da ${pt(kw.p)}, ${kw.p < 0.05 === om.p < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
  const st = `<i>F</i>(${om.df1}, ${dfF(om.df2)}) = ${f(om.F)}, ${pt(om.p)}, η² = ${nz(cl.eta2.toFixed(3))}`;
  let t = `Se aplicó un ${sec.test} para comparar ${esc(yName)} según ${esc(gName)} (${groups.map(q => `${esc(q.name)}: ${MD(q)}`).join('; ')}). `;
  const phNote =
    (useAv
      ? '<i>d</i> = diferencia de medias / raíz de la media de las dos varianzas, adecuada cuando las varianzas difieren.'
      : '<i>d</i> = diferencia de medias / √<i>MC</i><sub>error</sub> (como JASP).') +
    ' Tamaño del efecto: 0.20 pequeño, 0.50 mediano, 0.80 grande (Cohen, 1988).' +
    (userPH === 'lsd'
      ? ' <b>Sin corrección por comparaciones múltiples</b>: el riesgo de falsos positivos aumenta con el número de comparaciones.'
      : '') +
    (sw
      ? ` Prueba de rango por pasos: cada par se compara con el rango estudentizado de las medias que abarca${userPH === 'snk' ? '' : userPH === 'duncan' ? ', con el nivel de Duncan' : ', con los niveles de Ryan-Einot-Gabriel-Welsch'}; un par solo difiere si también difieren todos los rangos que lo contienen, por eso su <i>p</i> es la mayor de esas comparaciones.`
      : '') +
    (userPH === 'duncan'
      ? ' Duncan no controla el error de tipo I del conjunto de comparaciones: es más liberal que Tukey.'
      : '') +
    (userPH === 'gt2' || userPH === 'gabriel'
      ? ` Distribución del módulo máximo estudentizado con ${(k * (k - 1)) / 2} comparaciones${userPH === 'gabriel' ? '; Gabriel ajusta el error típico cuando los tamaños de los grupos difieren' : ''}.`
      : '');
  const phRows = ph.map(c => [`${esc(names[c.i])} − ${esc(names[c.j])}`, f(c.diff), pv(c.padj), f(c.d)]);
  const phTable = () => {
    sec.tables.push(
      apaTable(
        `Comparaciones post hoc (${phName})`,
        ['Comparación', 'Diferencia de medias', '<i>p</i> ajustada', '<i>d</i> de Cohen'],
        phRows,
        phNote
      )
    );
    if (sw) {
      const S_ = sw.subsets;
      sec.tables.push(
        apaTable(
          `Subconjuntos homogéneos (${phName})`,
          [esc(gName), '<i>n</i>'].concat(S_.map((_, q) => `Subconjunto ${q + 1}`)),
          sw.order
            .map(gi =>
              [esc(names[gi]), xs[gi].length].concat(S_.map(s => (s.members.includes(gi) ? f(S.mean(xs[gi])) : '')))
            )
            .concat([['<i>p</i>', ''].concat(S_.map(s => (s.members.length > 1 ? pv(s.p) : '—')))]),
          `Medias de los grupos que no difieren entre sí (α = .05), ordenadas de menor a mayor, como en SPSS. <i>p</i>: prueba del rango del subconjunto.`
        )
      );
    }
  };
  if (om.p < 0.05) {
    t +=
      `Se encontraron diferencias estadísticamente significativas, ${st}, con un tamaño del efecto ${lbl.eta(cl.eta2)}.` +
      posthocText(ph, phName, false);
    phTable();
  } else {
    t += `No se encontraron diferencias estadísticamente significativas, ${st}.`;
    if (userPH) {
      phTable();
      t += ` Las comparaciones ${phName} se muestran porque las pediste, pero con una prueba global no significativa deben interpretarse con mucha cautela.`;
    }
  }
  sec.text.push(t);
}
/** Código R del ANOVA (o Welch), de su post hoc y de los d de Cohen por pares */
function anovaRCode({ code, eqVar, userPH, opts, names }) {
  code += eqVar
    ? `modelo <- aov(y ~ g, data = dd)\nsummary(modelo)\neffectsize::eta_squared(modelo)\neffectsize::omega_squared(modelo)\nTukeyHSD(modelo)\n# d de Cohen por pares (como JASP): diferencia de medias / √MCE\nemmeans::eff_size(emmeans::emmeans(modelo, ~ g), sigma = sigma(modelo), edf = df.residual(modelo))`
    : `oneway.test(y ~ g, data = dd, var.equal = FALSE)\nonewaytests::bf.test(y ~ g, data = dd)  # Brown-Forsythe\nrstatix::games_howell_test(dd, y ~ g)`;
  if (userPH)
    code +=
      '\n# Comparaciones post hoc elegidas\n' +
      {
        bonferroni: 'pairwise.t.test(dd$y, dd$g, p.adjust.method = "bonferroni", pool.sd = TRUE)',
        holm: 'pairwise.t.test(dd$y, dd$g, p.adjust.method = "holm", pool.sd = TRUE)',
        lsd: 'pairwise.t.test(dd$y, dd$g, p.adjust.method = "none", pool.sd = TRUE)',
        sidak:
          'p <- pairwise.t.test(dd$y, dd$g, p.adjust.method = "none", pool.sd = TRUE)$p.value; m <- sum(!is.na(p)); 1 - (1 - p)^m  # Šidák',
        scheffe: 'DescTools::ScheffeTest(aov(y ~ g, data = dd))',
        tamhane: 'PMCMRplus::tamhaneT2Test(y ~ g, data = dd)',
        tukey: 'TukeyHSD(aov(y ~ g, data = dd))',
        gh: 'rstatix::games_howell_test(dd, y ~ g)',
        dunnett: `dd$g <- relevel(dd$g, ref = ${rq(opts.ctrl || names[0])})\nsummary(multcomp::glht(aov(y ~ g, data = dd), linfct = multcomp::mcp(g = "Dunnett")))`,
        snk: 'print(tapply(dd$y, dd$g, mean), digits = 7)  # medias de los grupos\nsnk <- PMCMRplus::snkTest(y ~ g, data = dd); print(snk$p.value, digits = 7)  # p de cada par (Tharp aplica además la regla paso a paso)',
        duncan:
          'print(tapply(dd$y, dd$g, mean), digits = 7)  # medias de los grupos\ndun <- PMCMRplus::duncanTest(y ~ g, data = dd); print(dun$p.value, digits = 7)  # p de cada par (Tharp aplica además la regla paso a paso)',
        regwq: `print(tapply(dd$y, dd$g, mean), digits = 7)  # medias de los grupos\n# REGWQ: rango estudentizado con la media armónica de los n y los niveles de Ryan-Einot-Gabriel-Welsch, p de cada par\nlocal({ m <- tapply(dd$y, dd$g, mean); n <- tapply(dd$y, dd$g, length); k <- length(m); gl <- nrow(dd) - k; mce <- sum(tapply(dd$y, dd$g, function(v) sum((v - mean(v))^2))) / gl\n  pos <- match(seq_len(k), order(m, decreasing = TRUE)); res <- NULL\n  for (a in 1:(k - 1)) for (b in (a + 1):k) { r <- abs(pos[a] - pos[b]) + 1; q <- abs(m[a] - m[b]) / sqrt(mce / (k / sum(1 / n))); p <- ptukey(q, r, gl, lower.tail = FALSE)\n    res <- rbind(res, data.frame(par = paste(names(m)[a], "-", names(m)[b]), pasos = r, q = q, p = if (r < k - 1) min(1, 1 - (1 - p)^(k / r)) else p)) }\n  print(res, digits = 7) })`,
        gt2: gtCode('gt2'),
        gabriel: gtCode('gabriel'),
      }[userPH];
  return { code };
}
/** Tres o más grupos sin normalidad: Kruskal-Wallis con Dunn (Holm), tabla, redacción y código R */
function compareSeveralKruskal({ xs, sec, k, gName, yName, groups, code, Y, G, MdnD, posthocText, names }) {
  const kw = S.kruskal(xs),
    ph = S.dunn(xs, kw);
  sec.test = 'Prueba de Kruskal-Wallis';
  sec.decision = `Se eligió la prueba de Kruskal-Wallis porque se comparan ${k} grupos independientes y la normalidad no se cumple en algún grupo con muestra pequeña.`;
  sec.alt = 'ANOVA de un factor si los datos fueran aproximadamente normales.';
  sec.tables.push(
    apaTable(
      'Resultado de la prueba de Kruskal-Wallis',
      ['', '<i>H</i>', '<i>gl</i>', '<i>p</i>', 'ε²'],
      [[esc(gName), f(kw.H), kw.df, pv(kw.p), nz(kw.eps2.toFixed(3))]]
    )
  );
  const w = S.welchAnova(xs);
  sec.sens = `Análisis de sensibilidad: el ANOVA de Welch da ${pt(w.p)}, ${w.p < 0.05 === kw.p < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
  const st = `<i>H</i>(${kw.df}) = ${f(kw.H)}, ${pt(kw.p)}, ε² = ${nz(kw.eps2.toFixed(3))}`;
  let t = `Dado que no se cumplía el supuesto de normalidad, se aplicó la prueba de Kruskal-Wallis para comparar ${esc(yName)} según ${esc(gName)} (${groups.map(q => `${esc(q.name)}: ${MdnD(q)}`).join('; ')}). `;
  if (kw.p < 0.05) {
    t +=
      `Se encontraron diferencias estadísticamente significativas, ${st}.` +
      posthocText(ph, 'Dunn con corrección de Holm', true);
    sec.tables.push(
      apaTable(
        'Comparaciones post hoc (Dunn, corrección de Holm)',
        ['Comparación', '<i>z</i>', '<i>p</i> ajustada'],
        ph.map(c => [`${esc(names[c.i])} − ${esc(names[c.j])}`, f(c.z), pv(c.padj)])
      )
    );
  } else t += `No se encontraron diferencias estadísticamente significativas, ${st}.`;
  sec.text.push(t);
  code += `kruskal.test(${Y} ~ ${G}, data = datos)\nFSA::dunnTest(${Y} ~ ${G}, data = datos, method = "holm")`;
  return { code };
}

export { compareSeveralAnova, compareSeveralKruskal };
