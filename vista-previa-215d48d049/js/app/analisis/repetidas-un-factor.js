/* Tharp · aplicación · Análisis: ANOVA de medidas repetidas y Friedman */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { dfF, f, list, nz, pt, pv, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

function runRepeated(names, opts = {}) {
  const k = names.length,
    cols = names.map(n => numOf(vByName(n)));
  const sec = nuevaSeccion(`${names.join(', ')} (medidas repetidas)`);
  const idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)),
    n = idx.length;
  if (n < 3) {
    sec.error = 'Se necesitan al menos 3 casos con todas las medidas.';
    return sec;
  }
  const Y = idx.map(i => cols.map(c => c[i])),
    ds = names.map((_, j) => S.describe(Y.map(r => r[j])));
  if (Y.every(r => r.every(v => v === r[0]))) {
    sec.error = 'Todas las personas tienen el mismo valor en todos los momentos: no hay variación que analizar.';
    return sec;
  }
  const lv = list(names.map(esc));
  // normalidad de los residuos del modelo de medidas repetidas (valor − media del sujeto − media del momento + media global)
  const { normOK } = repeatedChecksAndDescriptives({ Y, opts, n, sec, k, lv, names, ds });
  const pairs = [];
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) pairs.push([a, b]);
  const posthoc = (kind, test) => {
    const r = pairs.map(([a, b]) => ({
        a,
        b,
        r: test(
          Y.map(x => x[a]),
          Y.map(x => x[b])
        ),
      })),
      adj = S.holm(r.map(o => o.r.p));
    r.forEach((o, i) => (o.padj = adj[i]));
    return r;
  };
  const phText = (ph, kind, med) => {
    const sig = ph.filter(o => o.padj < 0.05);
    if (!sig.length)
      return ` Las comparaciones por pares (${kind}) no detectaron diferencias significativas entre momentos concretos.`;
    return (
      ` Las comparaciones por pares (${kind}) mostraron diferencias significativas entre ` +
      list(
        sig.map(o => {
          const da = ds[o.a],
            db = ds[o.b],
            up = med ? db.median > da.median : db.mean > da.mean;
          return `${esc(names[o.a])} y ${esc(names[o.b])} (${pt(o.padj)}; puntuaciones más ${up ? 'altas' : 'bajas'} en ${esc(names[o.b])})`;
        })
      ) +
      (sig.length < ph.length ? '. El resto de comparaciones no fueron significativas.' : '.')
    );
  };
  const Q = names.map(rq).join(', ');
  let code =
    `# ${names.join(', ')} (medidas repetidas)\nmedidas <- c(${Q})\ndatos_mr <- datos[complete.cases(datos[, medidas]), medidas]\ndatos_mr$id <- factor(seq_len(nrow(datos_mr)))\n` +
    `largo <- data.frame(id = rep(datos_mr$id, ${k}), momento = factor(rep(medidas, each = nrow(datos_mr)), levels = medidas), valor = unlist(datos_mr[, medidas], use.names = FALSE))\n` +
    `# Normalidad de los residuos (valor − media de la persona − media de la medida + media global), como Tharp\nYm <- as.matrix(datos_mr[, medidas])\nres <- Ym - rowMeans(Ym) - matrix(colMeans(Ym), nrow(Ym), ncol(Ym), byrow = TRUE) + mean(Ym)\nshapiro.test(as.vector(res))\nt(sapply(datos_mr[, medidas], descr))  # descriptivos\n`;
  if (normOK) {
    ({ code } = rmAnovaReport({ Y, sec, k, lv, names, code, ds, posthoc, phText }));
  } else {
    ({ code } = friedmanReport({ Y, sec, opts, k, lv, n, names, code, ds, posthoc, phText }));
  }
  sec.code = code;
  return sec;
}
/** Normalidad de los residuos, motivos, descriptivos por momento y gráfico */
function repeatedChecksAndDescriptives({ Y, opts, n, sec, k, lv, names, ds }) {
  const gm = S.mean(Y.flat()),
    sm = Y.map(S.mean),
    resid = Y.flatMap((r, i) => r.map((v, j) => v - sm[i] - ds[j].mean + gm));
  const sw = S.shapiro(resid),
    normOK = !opts.force && (n >= 30 || (sw && sw.p >= 0.05));
  if (opts.force)
    sec.why.push('Has pedido usar siempre la prueba no paramétrica (Friedman), sin depender de la normalidad.');
  sec.why.push(`Se comparan ${k} medidas de las mismas personas: ${lv}.`);
  sec.why.push(
    'Al ser medidas relacionadas, el análisis separa la variabilidad entre personas de la debida a los momentos, lo que da más potencia que comparar grupos independientes.'
  );
  const swT = sw
    ? `Shapiro-Wilk de los residuos: <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}`
    : 'Shapiro-Wilk no calculable';
  sec.checks.push(
    sw && sw.p >= 0.05
      ? chk('ok', swT + '. Se cumple la normalidad.')
      : n >= 30
        ? chk('info', swT + `. No es normal, pero con <i>n</i> = ${n} ≥ 30 el ANOVA es robusto.`)
        : chk('no', swT + '. No se cumple y la muestra es pequeña.')
  );
  sec.tables.push(
    apaTable(
      'Estadísticos descriptivos de las medidas repetidas',
      ['Medida', '<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'IC 95 % (<i>M</i>)'],
      names.map((nm, j) => [
        esc(nm),
        n,
        f(ds[j].mean),
        f(ds[j].sd),
        f(ds[j].median),
        `[${f(ds[j].ci[0])}, ${f(ds[j].ci[1])}]`,
      ]),
      ST.rows.length - n ? `Se excluyeron ${ST.rows.length - n} casos sin todas las medidas.` : ''
    )
  );
  sec.charts.push(
    fig(
      `${names.join(', ')}: medias e IC 95 %`,
      CH.meansCI(
        names.map((nm, j) => ({ name: nm, x: Y.map(r => r[j]), mean: ds[j].mean, ci: ds[j].ci })),
        'Puntuación',
        { connect: true }
      )
    )
  );
  return { normOK };
}
/** ANOVA de medidas repetidas: esfericidad, tabla, comparaciones por pares, redacción y código R */
function rmAnovaReport({ Y, sec, k, lv, names, code, ds, posthoc, phText }) {
  const r = S.rmAnova(Y),
    sph = r.mauchly,
    sphOK = !sph || sph.p >= 0.05,
    eps = sphOK ? 1 : r.gg,
    P = sphOK ? r.p : r.pGG;
  const d1 = r.df1 * eps,
    d2 = r.df2 * eps;
  sec.test = 'ANOVA de medidas repetidas' + (sphOK ? '' : ' (corrección de Greenhouse-Geisser)');
  sec.why.push('La normalidad es aceptable (o n ≥ 30): se usa el ANOVA de medidas repetidas.');
  if (sph)
    sec.checks.push(
      chk(
        sphOK ? 'ok' : 'no',
        `Esfericidad (Mauchly): <i>W</i> = ${nz(sph.W.toFixed(3))}, χ²(${sph.df}) = ${f(sph.chi)}, ${pt(sph.p)}. ${sphOK ? 'Se cumple.' : `No se cumple: se aplica la corrección de Greenhouse-Geisser (ε = ${nz(r.gg.toFixed(3))}) a los grados de libertad.`}`
      )
    );
  sec.decision = `Se eligió el ANOVA de medidas repetidas porque se comparan ${k} medidas de las mismas personas y la normalidad es aceptable${sph ? (sphOK ? ', con esfericidad' : '; como no se cumple la esfericidad, se corrigen los grados de libertad con Greenhouse-Geisser') : ''}.`;
  sec.alt = 'Prueba de Friedman si no se cumpliera la normalidad con muestras pequeñas.';
  sec.tables.push(
    apaTable(
      'Resultado del ANOVA de medidas repetidas',
      ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>', 'η²<sub>G</sub>'],
      [
        [
          'Momento',
          f(r.ssCond),
          dfF(d1),
          f(r.ssCond / d1),
          f(r.F),
          pv(P),
          nz(r.peta2.toFixed(3)),
          nz(r.ges.toFixed(3)),
        ],
        ['Error', f(r.ssErr), dfF(d2), f(r.ssErr / d2), '', '', '', ''],
      ],
      (sphOK ? '' : 'Grados de libertad corregidos con Greenhouse-Geisser. ') +
        'η²<sub>p</sub> = eta cuadrado parcial; η²<sub>G</sub> = eta cuadrado generalizado.'
    )
  );
  const fr = S.friedman(Y);
  sec.sens = `Análisis de sensibilidad: la prueba de Friedman da ${pt(fr.p)}, ${fr.p < 0.05 === P < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
  const st = `<i>F</i>(${dfF(d1)}, ${dfF(d2)}) = ${f(r.F)}, ${pt(P)}, η²<sub>p</sub> = ${nz(r.peta2.toFixed(3))}`;
  let t = `Se aplicó un ANOVA de medidas repetidas para comparar ${lv} (${names.map((nm, j) => `${esc(nm)}: <i>M</i> = ${f(ds[j].mean)}, <i>DT</i> = ${f(ds[j].sd)}`).join('; ')})${sphOK ? '' : ', con la corrección de Greenhouse-Geisser por no cumplirse la esfericidad'}. `;
  if (P < 0.05) {
    const ph = posthoc('t relacionadas', S.tTestPaired);
    t +=
      `Se encontraron diferencias estadísticamente significativas entre los momentos, ${st}.` +
      phText(ph, '<i>t</i> relacionadas con corrección de Holm', false);
    sec.tables.push(
      apaTable(
        'Comparaciones por pares (t relacionadas, corrección de Holm)',
        ['Comparación', 'Diferencia de medias', '<i>t</i>', '<i>gl</i>', '<i>p</i> ajustada'],
        ph.map(o => [`${esc(names[o.b])} − ${esc(names[o.a])}`, f(o.r.diff), f(o.r.t), o.r.df, pv(o.padj)])
      )
    );
  } else t += `No se encontraron diferencias estadísticamente significativas entre los momentos, ${st}.`;
  sec.text.push(t);
  if (k > 2)
    code += `# Mauchly con su aproximación χ² (y la p con el término de 2.º orden de Anderson; mauchly.test usa 3 * k en lugar de 3 * (k − 1))\nW <- unname(mauchly.test(lm(Ym ~ 1), X = ~1)$statistic); p <- ncol(Ym) - 1; nu <- nrow(Ym) - 1\nrho <- 1 - (2 * p^2 + p + 2) / (6 * p * nu); chi2 <- -nu * rho * log(W); gl <- p * (p + 1) / 2 - 1; w2 <- (p + 2) * (p - 1) * (p - 2) * (2 * p^3 + 6 * p^2 + 3 * p + 2) / (288 * (nu * p * rho)^2)\nc(W = W, chi2 = chi2, gl = gl, p = pchisq(chi2, gl, lower.tail = FALSE) + w2 * (pchisq(chi2, gl + 4, lower.tail = FALSE) - pchisq(chi2, gl, lower.tail = FALSE)))\n`;
  code +=
    `# Tabla del ANOVA (SC, gl ${sphOK ? 'sin corregir' : 'corregidos con Greenhouse-Geisser'} y MC), como en Tharp\nkk <- ncol(Ym); nn <- nrow(Ym); gm <- mean(Ym); SCm <- nn * sum((colMeans(Ym) - gm)^2); SCe <- sum((Ym - gm)^2) - SCm - kk * sum((rowMeans(Ym) - gm)^2)\n` +
    (sphOK
      ? 'eps <- 1\n'
      : 'Ch <- contr.helmert(kk); Ch <- sweep(Ch, 2, sqrt(colSums(Ch^2)), "/"); M <- t(Ch) %*% cov(Ym) %*% Ch; eps <- min(1, sum(diag(M))^2 / ((kk - 1) * sum(M * t(M))))\n') +
    `data.frame(fuente = c("Momento", "Error"), SC = c(SCm, SCe), gl = c(kk - 1, (kk - 1) * (nn - 1)) * eps, MC = c(SCm, SCe) / (c(kk - 1, (kk - 1) * (nn - 1)) * eps))\n`;
  code += `friedman.test(as.matrix(datos_mr[, medidas]))  # análisis de sensibilidad\nrstatix::anova_test(largo, dv = valor, wid = id, within = momento, effect.size = "pes")  # incluye Mauchly y Greenhouse-Geisser\ncmb <- combn(medidas, 2); setNames(apply(cmb, 2, function(v) mean(datos_mr[[v[2]]] - datos_mr[[v[1]]])), apply(cmb, 2, function(v) paste(v[2], "-", v[1])))  # diferencias de medias\nrstatix::pairwise_t_test(largo, valor ~ momento, paired = TRUE, p.adjust.method = "holm")`;
  return { code };
}
/** Prueba de Friedman: tabla, comparaciones por pares (Wilcoxon o Durbin-Conover), redacción y código R */
function friedmanReport({ Y, sec, opts, k, lv, n, names, code, ds, posthoc, phText }) {
  const r = S.friedman(Y);
  sec.test = 'Prueba de Friedman';
  if (!opts.force)
    sec.why.push(
      'La normalidad no se cumple y la muestra es pequeña: se usa la prueba de Friedman, que trabaja con rangos dentro de cada persona.'
    );
  sec.decision = `Se eligió la prueba de Friedman porque se comparan ${k} medidas de las mismas personas y ${opts.force ? 'se pidió una prueba no paramétrica' : 'no se cumple la normalidad'}.`;
  sec.alt = 'ANOVA de medidas repetidas si los datos fueran aproximadamente normales.';
  sec.tables.push(
    apaTable(
      'Resultado de la prueba de Friedman',
      ['', 'χ²', '<i>gl</i>', '<i>p</i>', '<i>W</i> de Kendall', '<i>n</i>'],
      [[lv, f(r.Q), r.df, pv(r.p), nz(r.W.toFixed(3)), n]],
      'Rangos promedio: ' +
        names.map((nm, j) => `${esc(nm)} = ${f(r.meanRanks[j])}`).join('; ') +
        '. <i>W</i> de Kendall como tamaño del efecto.'
    )
  );
  const a = S.rmAnova(Y),
    aP = a.mauchly && a.mauchly.p < 0.05 ? a.pGG : a.p;
  sec.sens = `Análisis de sensibilidad: el ANOVA de medidas repetidas da ${pt(aP)}, ${aP < 0.05 === r.p < 0.05 ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
  const st = `χ²(${r.df}) = ${f(r.Q)}, ${pt(r.p)}, <i>W</i> = ${nz(r.W.toFixed(2))}`;
  let t = `${opts.force ? 'Se' : 'Dado que no se cumplía el supuesto de normalidad, se'} aplicó la prueba de Friedman para comparar ${lv} (${names.map((nm, j) => `${esc(nm)}: <i>Mdn</i> = ${f(ds[j].median)}`).join('; ')}). `;
  if (r.p < 0.05) {
    const fm = opts.ph || 'wilcoxon';
    if (fm === 'wilcoxon') {
      const ph = posthoc('Wilcoxon', S.wilcoxonSigned);
      t +=
        `Se encontraron diferencias estadísticamente significativas, ${st}.` +
        phText(ph, 'Wilcoxon con corrección de Holm', true);
      sec.tables.push(
        apaTable(
          'Comparaciones por pares (Wilcoxon, corrección de Holm)',
          ['Comparación', '<i>z</i>', '<i>p</i> ajustada'],
          ph.map(o => [`${esc(names[o.b])} − ${esc(names[o.a])}`, f(o.r.z), pv(o.padj)])
        )
      );
    } else {
      const ph = S.friedmanPosthoc(Y, fm, fm === 'siegel' ? 'bonferroni' : 'holm'),
        FN = {
          conover: 'Conover con corrección de Holm',
          siegel: 'Dunn-Bonferroni sobre los rangos medios',
          nemenyi: 'Nemenyi',
        }[fm];
      t += `Se encontraron diferencias estadísticamente significativas, ${st}.` + phText(ph, FN, true);
      sec.tables.push(
        apaTable(
          `Comparaciones por pares (${FN})`,
          [
            'Comparación',
            fm === 'conover' ? '<i>t</i>' : fm === 'nemenyi' ? '<i>q</i>' : '<i>z</i>',
            '<i>p</i> ajustada',
          ],
          ph.map(o => [`${esc(names[o.b])} − ${esc(names[o.a])}`, f(fm === 'nemenyi' ? o.q : o.stat), pv(o.padj)]),
          fm === 'conover'
            ? `Diferencias de sumas de rangos; <i>t</i> con ${ph[0].df} gl (Conover, 1999).`
            : fm === 'nemenyi'
              ? 'Rango studentizado con gl infinitos sobre los rangos medios.'
              : '<i>z</i> = diferencia de rangos medios / √(<i>k</i>(<i>k</i> + 1) / 6<i>n</i>), con corrección de Bonferroni.'
        )
      );
      code += `\nm <- as.matrix(datos_mr[, medidas])\n${{ conover: 'PMCMRplus::frdAllPairsConoverTest(m, p.adjust.method = "holm")', siegel: 'PMCMRplus::frdAllPairsSiegelTest(m, p.adjust.method = "bonferroni")', nemenyi: 'PMCMRplus::frdAllPairsNemenyiTest(m)' }[fm].replace(/^/, 'ph <- ')}\nph; ph$statistic; ph$p.value  # estadístico y p ajustada de cada par\n`;
    }
  } else t += `No se encontraron diferencias estadísticamente significativas, ${st}.`;
  sec.text.push(t);
  code += `rstatix::anova_test(largo, dv = valor, wid = id, within = momento)  # análisis de sensibilidad (p de Greenhouse-Geisser si no hay esfericidad)\nfriedman.test(as.matrix(datos_mr[, medidas]))\nrstatix::friedman_effsize(largo, valor ~ momento | id)\nrstatix::pairwise_wilcox_test(largo, valor ~ momento, paired = TRUE, p.adjust.method = "holm")  # p exacta sin empates ni ceros y n < 50, como Tharp`;
  return { code };
}

export { runRepeated };
