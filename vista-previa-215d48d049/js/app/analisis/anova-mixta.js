/* Tharp · aplicación · Análisis: ANOVA mixta (intra × entre sujetos) */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { catOf, numOf, ordOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { dfF, f, list, nz, pt, pv, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';
import { maxOf, minOf } from '../utilidades.js';

// ANOVA mixta: k medidas de las mismas personas (intrasujeto) × un factor entre sujetos
function runMixed(names, gName) {
  const k = names.length,
    cols = names.map(n => numOf(vByName(n))),
    cg = catOf(vByName(gName));
  const sec = nuevaSeccion(`${names.join(', ')} × ${gName} (ANOVA mixta)`, { test: 'ANOVA mixta (SC tipo III)' });
  if (names.includes(gName)) {
    sec.error = 'El factor entre sujetos no puede ser una de las medidas.';
    return sec;
  }
  const idx = ST.rows.map((_, i) => i).filter(i => cg[i] !== null && cols.every(c => c[i] !== null));
  const lv = ordOf(
      vByName(gName),
      idx.map(i => cg[i])
    ),
    G = lv.length;
  if (G < 2) {
    sec.error = `${gName} necesita al menos 2 grupos con datos completos.`;
    return sec;
  }
  const Y = idx.map(i => cols.map(c => c[i])),
    g = idx.map(i => lv.indexOf(cg[i])),
    n = Y.length,
    ng = lv.map((_, j) => g.filter(x => x === j).length);
  if (ng.some(c => c < 2)) {
    sec.error = 'Cada grupo necesita al menos 2 personas con todas las medidas.';
    return sec;
  }
  if (n - G < k) {
    sec.error = `Hay pocos casos (${n}) para ${k} medidas y ${G} grupos.`;
    return sec;
  }
  const r = S.mixedAnova(Y, g, G);
  const L = list(names.map(esc));
  // supuestos
  const { sphOK, eps } = mixedChecks({ r, Y, sec, n, names, ng, lv, L, k, gName, G, g });
  // descriptivos
  const { P, d1, d2 } = mixedTables({ lv, sec, gName, n, r, eps, sphOK, names, Y, g });
  // comparaciones por pares entre medidas (promediando los grupos), con d_av
  mixedPairwise({ r, P, k, sec, G, lv, Y, g, names, gName });
  // efectos simples si hay interacción
  mixedSimpleEffects({ P, r, names, lv, sec, gName, Y, g });
  sec.charts.push(
    fig(
      `Interacción medida × ${gName}: medias e IC 95 %`,
      CH.interaction(
        names,
        lv.map((l, j) => ({
          name: l,
          means: names.map((_, a) => r.cellMeans[j][a]),
          ci: names.map((_, a) => S.meanCI(Y.filter((_, i) => g[i] === j).map(row => row[a]))),
        })),
        'Puntuación'
      ),
      CH.legend(lv)
    )
  );
  // redacción
  mixedTextAndCode({ G, k, gName, L, sphOK, P, r, sec, names, d1, d2 });
  return sec;
}
/** Supuestos (normalidad, Levene por medida, esfericidad, M de Box) y motivos de la elección */
function mixedChecks({ r, Y, sec, n, names, ng, lv, L, k, gName, G, g }) {
  const gm = S.mean(r.subjMeans),
    resid = Y.flatMap((row, i) =>
      row.map((v, a) => v - r.cellMeans[g[i]][a] - r.subjMeans[i] + S.mean(r.cellMeans[g[i]]))
    );
  void gm;
  const sw = S.shapiro(resid);
  sec.checks.push(
    sw && sw.p >= 0.05
      ? chk(
          'ok',
          `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}. Se cumple.`
        )
      : chk(
          n >= 30 ? 'info' : 'no',
          `Normalidad de los residuos (Shapiro-Wilk): ${sw ? `<i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}` : 'no calculable'}.${n >= 30 ? ' Con muestras de este tamaño el ANOVA es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña: interpreta con cautela.'}`
        )
  );
  names.forEach((nm, a) => {
    const lev = S.levene(lv.map((_, j) => Y.filter((_, i) => g[i] === j).map(row => row[a])));
    sec.checks.push(
      chk(
        lev.p >= 0.05 ? 'ok' : 'no',
        `Homogeneidad de varianzas entre grupos en ${esc(nm)} (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.${lev.p >= 0.05 ? ' Se cumple.' : ' No se cumple: interpreta con cautela, sobre todo si los grupos tienen tamaños distintos.'}`
      )
    );
  });
  const sph = r.mauchly,
    sphOK = !sph || sph.p >= 0.05,
    eps = sphOK ? 1 : r.gg;
  if (sph)
    sec.checks.push(
      chk(
        sphOK ? 'ok' : 'no',
        `Esfericidad (Mauchly): <i>W</i> = ${nz(sph.W.toFixed(3))}, χ²(${sph.df}) = ${f(sph.chi)}, ${pt(sph.p)}. ${sphOK ? 'Se cumple.' : `No se cumple: se aplica la corrección de Greenhouse-Geisser (ε = ${nz(r.gg.toFixed(3))}; Huynh-Feldt ε = ${nz(r.hf.toFixed(3))}) a los efectos intrasujeto.`}`
      )
    );
  sec.checks.push(
    chk(
      maxOf(ng) === minOf(ng) ? 'ok' : 'info',
      `Tamaño de los grupos: ${lv.map((l, j) => `${esc(l)} = ${ng[j]}`).join(', ')}${maxOf(ng) === minOf(ng) ? ' (equilibrado).' : ' (no equilibrado; se usan sumas de cuadrados de tipo III).'}`
    )
  );
  sec.why.push(`Factor intrasujeto (medidas repetidas): ${L} → ${k} medidas de las mismas personas.`);
  sec.why.push(`Factor entre sujetos: ${esc(gName)} → ${G} grupos independientes (${list(lv.map(esc))}).`);
  sec.why.push(
    `La ANOVA mixta contrasta tres cosas: si las puntuaciones cambian entre medidas, si los grupos difieren en general y, sobre todo, si el cambio es distinto según el grupo (interacción). En un diseño pre/post con grupo control, la interacción es la prueba de que la intervención funciona.`
  );
  sec.decision = `Se ajustó una ANOVA mixta ${G}×${k} (${esc(gName)} × medida) con ${n} personas y sumas de cuadrados de tipo III${sphOK ? '' : '; como no se cumple la esfericidad, los efectos intrasujeto se corrigen con Greenhouse-Geisser'}.`;
  sec.alt =
    'Si no se cumplen los supuestos con muestras pequeñas, un modelo lineal mixto o pruebas no paramétricas por separado (Friedman en cada grupo y Kruskal-Wallis en cada medida).';
  return { sphOK, eps };
}
/** Descriptivos por grupo y medida y tabla de la ANOVA mixta */
function mixedTables({ lv, sec, gName, n, r, eps, sphOK, names, Y, g }) {
  const desc = [];
  lv.forEach((l, j) =>
    names.forEach((nm, a) => {
      const d = S.describe(Y.filter((_, i) => g[i] === j).map(row => row[a]));
      desc.push([a === 0 ? esc(l) : '', esc(nm), d.n, f(d.mean), f(d.sd)]);
    })
  );
  sec.tables.push(
    apaTable(
      `Estadísticos descriptivos por ${gName} y medida`,
      [esc(gName), 'Medida', '<i>n</i>', '<i>M</i>', '<i>DT</i>'],
      desc,
      ST.rows.length - n ? `Se excluyeron ${ST.rows.length - n} casos sin todas las medidas o sin grupo.` : ''
    )
  );
  // tabla del ANOVA
  const P = e => (sphOK ? e.p : e.pGG),
    d1 = e => e.df1 * (sphOK ? 1 : r.gg),
    d2 = e => e.df2 * (sphOK ? 1 : r.gg);
  const row = (nm, e, within) => [
    nm,
    f(e.ss),
    dfF(within ? d1(e) : e.df1),
    f(e.ss / (within ? d1(e) : e.df1)),
    f(e.F),
    pv(within ? P(e) : e.p),
    nz(e.peta2.toFixed(3)),
    nz(e.ges.toFixed(3)),
  ];
  sec.tables.push(
    apaTable(
      'Resultado de la ANOVA mixta',
      ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>', 'η²<sub>G</sub>'],
      [
        ['<i>Entre sujetos</i>', '', '', '', '', '', '', ''],
        row(esc(gName), r.B, false),
        ['Error', f(r.ssSe), r.dfSe, f(r.ssSe / r.dfSe), '', '', '', ''],
        ['<i>Intrasujeto</i>', '', '', '', '', '', '', ''],
        row('Medida', r.T, true),
        row(`Medida × ${esc(gName)}`, r.TG, true),
        ['Error', f(r.ssE), dfF(r.dfE * eps), f(r.ssE / (r.dfE * eps)), '', '', '', ''],
      ],
      `SC de tipo III. ${sphOK ? '' : 'Grados de libertad intrasujeto corregidos con Greenhouse-Geisser. '}η²<sub>p</sub> = eta cuadrado parcial; η²<sub>G</sub> = eta cuadrado generalizado.`
    )
  );
  return { P, d1, d2 };
}
/** Comparaciones por pares entre medidas (con d_av) y entre grupos */
function mixedPairwise({ r, P, k, sec, G, lv, Y, g, names, gName }) {
  const pooledVar = a => {
    let ss = 0;
    lv.forEach((_, j) => {
      const x = Y.filter((_, i) => g[i] === j).map(row => row[a]),
        m = S.mean(x);
      ss += S.sum(x.map(v => (v - m) ** 2));
    });
    return ss / r.dfSe;
  };
  r.within.forEach(o => {
    o.d = o.est / Math.sqrt((pooledVar(o.a) + pooledVar(o.b)) / 2);
  });
  if (P(r.T) < 0.05 && k > 2)
    sec.tables.push(
      apaTable(
        'Comparaciones por pares entre medidas (promediando los grupos)',
        ['Comparación', 'Diferencia', '<i>EE</i>', `<i>t</i>(${r.dfSe})`, '<i>p</i> (Holm)', '<i>d</i>'],
        r.within.map(o => [`${esc(names[o.a])} − ${esc(names[o.b])}`, f(o.est), f(o.se), f(o.t), pv(o.padj), f(o.d)]),
        'Medias marginales sin ponderar por el tamaño de los grupos y error propio de cada diferencia (como emmeans y JASP). <i>d</i> = diferencia / raíz de la media de las dos varianzas intragrupo.'
      )
    );
  let phB;
  if (r.B.p < 0.05 && G > 2) {
    const xs = lv.map((_, j) => r.subjMeans.filter((_, i) => g[i] === j)),
      msw = r.ssSe / k / r.dfSe;
    phB = S.hasTukey ? S.tukeyHSD(xs, msw, r.dfSe) : S.pairwiseHolm(xs, true);
    phB.forEach(c => {
      c.d = c.diff / Math.sqrt(msw);
    });
    sec.tables.push(
      apaTable(
        `Comparaciones entre grupos de ${gName} (${S.hasTukey ? 'Tukey' : 'Holm'}, media de las medidas)`,
        ['Comparación', 'Diferencia', '<i>p</i> ajustada', '<i>d</i>'],
        phB.map(c => [`${esc(lv[c.i])} − ${esc(lv[c.j])}`, f(c.diff), pv(c.padj), f(c.d)])
      )
    );
  }
}
/** Efectos simples cuando hay interacción: grupos en cada medida y medidas en cada grupo */
function mixedSimpleEffects({ P, r, names, lv, sec, gName, Y, g }) {
  let simple;
  if (P(r.TG) < 0.05) {
    const atT = names.map((nm, a) => {
      const o = S.anova(lv.map((_, j) => Y.filter((_, i) => g[i] === j).map(row => row[a])));
      return [
        `${esc(gName)} en ${esc(nm)}`,
        `<i>F</i>(${o.df1}, ${o.df2}) = ${f(o.F)}`,
        pv(o.p),
        nz(o.eta2.toFixed(3)),
      ];
    });
    const inG = lv.map((l, j) => {
      const Yj = Y.filter((_, i) => g[i] === j);
      if (Yj.length < 3) return [`Medida en ${esc(l)}`, 'pocos casos', '', ''];
      const o = S.rmAnova(Yj),
        cor = o.mauchly && o.mauchly.p < 0.05,
        pp = cor ? o.pGG : o.p,
        e2 = cor ? o.gg : 1;
      return [
        `Medida en ${esc(l)}`,
        `<i>F</i>(${dfF(o.df1 * e2)}, ${dfF(o.df2 * e2)}) = ${f(o.F)}${cor ? ' (G-G)' : ''}`,
        pv(pp),
        nz(o.peta2.toFixed(3)),
      ];
    });
    simple = atT.concat(inG);
    sec.tables.push(
      apaTable(
        'Efectos simples',
        ['Efecto', 'Estadístico', '<i>p</i>', 'η²<sub>p</sub>'],
        simple,
        'Comparación de los grupos en cada medida (ANOVA de un factor) y cambio entre medidas dentro de cada grupo (ANOVA de medidas repetidas). Con varias pruebas, valora corregir el nivel de significación (por ejemplo, Bonferroni).'
      )
    );
    sec.checks.push(
      chk(
        'info',
        'La interacción es significativa: interpreta los efectos simples (tabla y gráfico) antes que los efectos principales.'
      )
    );
  }
}
/** Redacción APA y código R de la ANOVA mixta */
function mixedTextAndCode({ G, k, gName, L, sphOK, P, r, sec, names, d1, d2 }) {
  const st = (e, w) =>
    `<i>F</i>(${dfF(w ? d1(e) : e.df1)}, ${dfF(w ? d2(e) : e.df2)}) = ${f(e.F)}, ${pt(w ? P(e) : e.p)}, η²<sub>p</sub> = ${nz(e.peta2.toFixed(3))}`;
  let t = `Se realizó una ANOVA mixta ${G}×${k} con ${esc(gName)} como factor entre sujetos y la medida (${L}) como factor intrasujeto${sphOK ? '' : ', con la corrección de Greenhouse-Geisser por no cumplirse la esfericidad'}. `;
  t += `La interacción medida × ${esc(gName)} ${P(r.TG) < 0.05 ? 'fue' : 'no fue'} estadísticamente significativa, ${st(r.TG, true)}${P(r.TG) < 0.05 ? ', lo que indica que el cambio entre medidas fue distinto según el grupo (véanse los efectos simples y la figura)' : ''}. `;
  t += `El efecto principal de la medida ${P(r.T) < 0.05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st(r.T, true)}. `;
  t += `El efecto principal de ${esc(gName)} ${r.B.p < 0.05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st(r.B, false)}.`;
  if (P(r.T) < 0.05 && k > 2) {
    const sig = r.within.filter(o => o.padj < 0.05);
    t += sig.length
      ? ` Las comparaciones por pares (corrección de Holm) mostraron diferencias entre ${list(sig.map(o => `${esc(names[o.a])} y ${esc(names[o.b])} (${pt(o.padj)}, <i>d</i> = ${f(Math.abs(o.d))})`))}.`
      : ' Las comparaciones por pares (corrección de Holm) no detectaron diferencias entre medidas concretas.';
  }
  sec.text.push(t);
  const Q = names.map(rq).join(', ');
  sec.code =
    `# ANOVA mixta: ${names.join(', ')} × ${gName}\nmedidas <- c(${Q})\nd <- datos[complete.cases(datos[, c(medidas, ${rq(gName)})]), c(medidas, ${rq(gName)})]\nd$id <- factor(seq_len(nrow(d)))\n` +
    `largo <- data.frame(id = rep(d$id, ${k}), grupo = factor(rep(d[[${rq(gName)}]], ${k})), medida = factor(rep(medidas, each = nrow(d)), levels = medidas), valor = unlist(d[, medidas], use.names = FALSE))\n` +
    `modelo <- afex::aov_ez("id", "valor", largo, between = "grupo", within = "medida", type = 3, anova_table = list(correction = "${sphOK ? 'none' : 'GG'}", es = c("pes", "ges")))\nmodelo\nsummary(modelo)  # Mauchly, Greenhouse-Geisser y Huynh-Feldt\nu <- summary(modelo)$univariate.tests; print(cbind(u, MC = u[, "Sum Sq"] / u[, "num Df"], MC_error = u[, "Error SS"] / u[, "den Df"]), digits = 7)  # SC y MC con todas las cifras\naggregate(valor ~ grupo + medida, data = largo, FUN = function(x) c(n = length(x), M = mean(x), DT = sd(x)))  # descriptivos\nfor (m in medidas) print(car::leveneTest(valor ~ grupo, data = subset(largo, medida == m), center = mean))  # Levene en cada medida\n` +
    `# Normalidad de los residuos (valor − media de la casilla − media de la persona + media de su grupo), como Tharp\nYm <- as.matrix(d[, medidas]); gr <- as.character(d[[${rq(gName)}]]); cm <- apply(Ym, 2, function(x) tapply(x, gr, mean))\nres <- Ym - cm[gr, , drop = FALSE] - rowMeans(Ym) + rowMeans(cm)[gr]\nshapiro.test(as.vector(res))\n` +
    (k > 2
      ? `# Mauchly con su aproximación χ² (gl del error entre sujetos = n − grupos)\nW <- summary(modelo)$sphericity.tests[1, "Test statistic"]; p <- ${k - 1}; nu <- nrow(d) - length(unique(gr))\nrho <- 1 - (2 * p^2 + p + 2) / (6 * p * nu); chi2 <- -nu * rho * log(W); gl <- p * (p + 1) / 2 - 1; w2 <- (p + 2) * (p - 1) * (p - 2) * (2 * p^3 + 6 * p^2 + 3 * p + 2) / (288 * (nu * p * rho)^2)\nc(W = W, chi2 = chi2, gl = gl, p = pchisq(chi2, gl, lower.tail = FALSE) + w2 * (pchisq(chi2, gl + 4, lower.tail = FALSE) - pchisq(chi2, gl, lower.tail = FALSE)))\n`
      : '') +
    `pairs(emmeans::emmeans(modelo, ~ medida), adjust = "holm")\n` +
    (G > 2 ? `pairs(emmeans::emmeans(modelo, ~ grupo), adjust = "tukey")\n` : '') +
    `# Efectos simples\nemmeans::joint_tests(modelo, by = "medida")\nemmeans::joint_tests(modelo, by = "grupo")`;
}

export { runMixed };
