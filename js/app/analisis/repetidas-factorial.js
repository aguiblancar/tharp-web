/* Tharp · aplicación · Análisis: ANOVA de medidas repetidas factorial */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { catOf, numOf, ordOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { dfF, f, list, nz, pt, pv, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

// Medidas repetidas con dos factores intrasujeto (y un factor entre sujetos opcional)
function runRm2(cols, wNames, kw, gName) {
  const [A, B] = wNames,
    K = kw[0] * kw[1];
  const sec = nuevaSeccion(`${A} × ${B} (medidas repetidas${gName ? ` × ${gName}` : ''})`, {
    test: `ANOVA de medidas repetidas de dos factores${gName ? ' con un factor entre sujetos' : ''}`,
  });
  if (cols.length !== K) {
    sec.error = `Has marcado ${cols.length} columnas, pero ${A} (${kw[0]} niveles) × ${B} (${kw[1]} niveles) requiere ${K}.`;
    return sec;
  }
  const X = cols.map(nm => numOf(vByName(nm))),
    gc = gName ? catOf(vByName(gName)) : null;
  const idx = ST.rows.map((_, i) => i).filter(i => X.every(c => c[i] !== null) && (!gc || gc[i] !== null));
  const lv = gName
      ? ordOf(
          vByName(gName),
          idx.map(i => gc[i])
        )
      : [''],
    G = lv.length,
    g = gName ? idx.map(i => lv.indexOf(gc[i])) : null;
  const Y = idx.map(i => X.map(c => c[i])),
    n = Y.length;
  if (n - G < K) {
    sec.error = `Hay pocos casos completos (${n}) para ${K} medidas.`;
    return sec;
  }
  if (gName && lv.some((_, j) => g.filter(x => x === j).length < 2)) {
    sec.error = 'Cada grupo necesita al menos 2 personas con todas las medidas.';
    return sec;
  }
  const r = S.rmFactorial(Y, kw, g, G),
    lab = (a, b) => `${A} ${a + 1} · ${B} ${b + 1}`;
  sec.why.push(
    `Diseño intrasujeto ${kw[0]}×${kw[1]}: ${esc(A)} (${kw[0]} niveles) × ${esc(B)} (${kw[1]} niveles), con ${K} medidas de las mismas ${n} personas${gName ? ` y ${esc(gName)} como factor entre sujetos (${list(lv.map(esc))})` : ''}.`
  );
  sec.why.push(
    'Cada efecto intrasujeto (los dos principales y su interacción) se contrasta con su propio término de error, y su esfericidad se comprueba por separado (como SPSS, JASP y afex).'
  );
  sec.decision = `Se ajustó una ANOVA de medidas repetidas ${kw[0]}×${kw[1]}${gName ? ` con ${esc(gName)} como factor entre sujetos` : ''} con ${n} personas.`;
  sec.tables.push(
    apaTable(
      'Correspondencia de las columnas con las condiciones',
      ['Columna', esc(A), esc(B)],
      cols.map((c, q) => [esc(c), Math.floor(q / kw[1]) + 1, (q % kw[1]) + 1]),
      `Comprueba que el orden es el correcto: el segundo factor (${esc(B)}) cambia más rápido.`
    )
  );
  const { eName, corr } = rm2DescriptivesAndSphericity({ lv, sec, gName, r, cols, Y, lab, kw, g, wNames });
  rm2Tables({ r, gName, sec, corr, eName, wNames });
  rm2ChartTextCode({ sec, A, B, kw, gName, corr, r, cols, K, Y, eName });
  return sec;
}
/** Descriptivos por celda y esfericidad de cada efecto */
function rm2DescriptivesAndSphericity({ lv, sec, gName, r, cols, Y, lab, kw, g, wNames }) {
  const dRows = [];
  lv.forEach((l, j) =>
    cols.forEach((c, q) => {
      const x = Y.filter((_, i) => !g || g[i] === j).map(rw => rw[q]),
        d = S.describe(x);
      dRows.push([
        gName && q === 0 ? esc(l) : '',
        esc(c),
        lab(Math.floor(q / kw[1]), q % kw[1]),
        d.n,
        f(d.mean),
        f(d.sd),
      ]);
    })
  );
  sec.tables.push(
    apaTable(
      'Estadísticos descriptivos',
      (gName ? [esc(gName)] : ['']).concat(['Columna', 'Condición', '<i>n</i>', '<i>M</i>', '<i>DT</i>']),
      dRows
    )
  );
  const eName = e => e.factors.map(f => esc(wNames[f])).join(' × '),
    corr = [];
  const sphRows = r.effects
    .filter(e => e.mauchly)
    .map(e => {
      const ok = e.mauchly.p >= 0.05;
      if (!ok) corr.push(eName(e));
      return [
        eName(e),
        nz(e.mauchly.W.toFixed(3)),
        f(e.mauchly.chi),
        e.mauchly.df,
        pv(e.mauchly.p),
        nz(e.gg.toFixed(3)),
        nz(e.hf.toFixed(3)),
      ];
    });
  if (sphRows.length) {
    sec.tables.push(
      apaTable(
        'Esfericidad (Mauchly) y épsilon de corrección',
        ['Efecto', '<i>W</i>', 'χ²', '<i>gl</i>', '<i>p</i>', 'ε Greenhouse-Geisser', 'ε Huynh-Feldt'],
        sphRows,
        'Los efectos con 2 niveles cumplen la esfericidad por definición. Si Mauchly es significativo, se aplica Greenhouse-Geisser a ese efecto.'
      )
    );
    sec.checks.push(
      chk(
        corr.length ? 'no' : 'ok',
        corr.length
          ? `No se cumple la esfericidad en ${list(corr)}: se corrigen sus grados de libertad con Greenhouse-Geisser.`
          : 'Se cumple la esfericidad en todos los efectos intrasujeto con más de dos niveles.'
      )
    );
  }
  return { eName, corr };
}
/** Tabla de la ANOVA (con o sin factor entre sujetos) y comparaciones por pares de cada factor */
function rm2Tables({ r, gName, sec, corr, eName, wNames }) {
  const rowE = (nm, t, e) => {
    const useGG = e.mauchly && e.mauchly.p < 0.05,
      eps = useGG ? e.gg : 1;
    return [
      nm,
      f(t.ss),
      dfF(t.df * eps),
      f(t.ss / (t.df * eps)),
      f(t.F),
      pv(useGG ? t.pGG : t.p),
      nz(t.peta2.toFixed(3)),
      nz(t.ges.toFixed(3)),
    ];
  };
  const rows = [];
  if (r.B)
    rows.push(
      ['<i>Entre sujetos</i>', '', '', '', '', '', '', ''],
      [
        esc(gName),
        f(r.B.ss),
        r.B.df,
        f(r.B.ss / r.B.df),
        f(r.B.F),
        pv(r.B.p),
        nz(r.B.peta2.toFixed(3)),
        nz(r.B.ges.toFixed(3)),
      ],
      ['Error', f(r.ssSe), r.dfS, f(r.ssSe / r.dfS), '', '', '', '']
    );
  rows.push(['<i>Intrasujeto</i>', '', '', '', '', '', '', '']);
  r.effects.forEach(e => {
    const useGG = e.mauchly && e.mauchly.p < 0.05,
      eps = useGG ? e.gg : 1;
    rows.push(rowE(eName(e), e.T, e));
    if (e.TG) rows.push(rowE(`${eName(e)} × ${esc(gName)}`, e.TG, e));
    rows.push([`Error (${eName(e)})`, f(e.ssE), dfF(e.dfE * eps), f(e.ssE / (e.dfE * eps)), '', '', '', '']);
  });
  sec.tables.push(
    apaTable(
      'Resultado de la ANOVA de medidas repetidas',
      ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>', 'η²<sub>G</sub>'],
      rows,
      `${corr.length ? 'Grados de libertad corregidos con Greenhouse-Geisser en los efectos sin esfericidad. ' : ''}Cada efecto intrasujeto tiene su propio término de error. η²<sub>G</sub> = eta cuadrado generalizado (comparable entre diseños).`
    )
  );
  const phRows = [];
  [0, 1].forEach(fi => {
    const w = r.within(fi);
    w.pairs.forEach((o, q) =>
      phRows.push([q === 0 ? esc(wNames[fi]) : '', `${o.a + 1} − ${o.b + 1}`, f(o.est), f(o.se), f(o.t), pv(o.padj)])
    );
  });
  sec.tables.push(
    apaTable(
      'Comparaciones por pares de los efectos principales intrasujeto',
      ['Factor', 'Niveles', 'Diferencia', '<i>EE</i>', `<i>t</i>(${r.dfS})`, '<i>p</i> (Holm)'],
      phRows,
      `Medias marginales promediando el otro factor${gName ? ' y los grupos sin ponderar' : ''}; error propio de cada diferencia (como emmeans y JASP).`
    )
  );
}
/** Gráfico de medias, redacción APA y código R de la ANOVA de medidas repetidas de dos factores */
function rm2ChartTextCode({ sec, A, B, kw, gName, corr, r, cols, K, Y, eName }) {
  const cellM = (a, b) => S.mean(Y.map(rw => rw[a * kw[1] + b])),
    ciM = (a, b) => S.meanCI(Y.map(rw => rw[a * kw[1] + b]));
  sec.charts.push(
    fig(
      `Interacción ${A} × ${B}: medias e IC 95 %`,
      CH.interaction(
        Array.from({ length: kw[0] }, (_, a) => `${A} ${a + 1}`),
        Array.from({ length: kw[1] }, (_, b) => ({
          name: `${B} ${b + 1}`,
          means: Array.from({ length: kw[0] }, (_, a) => cellM(a, b)),
          ci: Array.from({ length: kw[0] }, (_, a) => ciM(a, b)),
        })),
        'Puntuación'
      ),
      CH.legend(Array.from({ length: kw[1] }, (_, b) => `${B} ${b + 1}`))
    )
  );
  const stt = (t, e) => {
    const useGG = e.mauchly && e.mauchly.p < 0.05,
      eps = useGG ? e.gg : 1;
    return `<i>F</i>(${dfF(t.df * eps)}, ${dfF(e.dfE * eps)}) = ${f(t.F)}, ${pt(useGG ? t.pGG : t.p)}, η²<sub>p</sub> = ${nz(t.peta2.toFixed(3))}`;
  };
  let txt = `Se realizó una ANOVA de medidas repetidas ${kw[0]}×${kw[1]} con ${esc(A)} y ${esc(B)} como factores intrasujeto${gName ? ` y ${esc(gName)} como factor entre sujetos` : ''}${corr.length ? ' (corrección de Greenhouse-Geisser donde no se cumplía la esfericidad)' : ''}. `;
  txt += r.effects
    .map(
      e =>
        `${e.factors.length > 1 ? `La interacción ${eName(e)}` : `El efecto principal de ${eName(e)}`} ${(e.mauchly && e.mauchly.p < 0.05 ? e.T.pGG : e.T.p) < 0.05 ? 'fue' : 'no fue'} estadísticamente significativ${e.factors.length > 1 ? 'a' : 'o'}, ${stt(e.T, e)}.` +
        (e.TG
          ? ` La interacción con ${esc(gName)} ${(e.mauchly && e.mauchly.p < 0.05 ? e.TG.pGG : e.TG.p) < 0.05 ? 'fue' : 'no fue'} significativa, ${stt(e.TG, e)}.`
          : '')
    )
    .join(' ');
  if (r.B)
    txt += ` El efecto principal de ${esc(gName)} ${r.B.p < 0.05 ? 'fue' : 'no fue'} estadísticamente significativo, <i>F</i>(${r.B.df}, ${r.dfS}) = ${f(r.B.F)}, ${pt(r.B.p)}, η²<sub>p</sub> = ${nz(r.B.peta2.toFixed(3))}.`;
  sec.text.push(txt);
  sec.code =
    `# ANOVA de medidas repetidas ${A} × ${B}${gName ? ` × ${gName}` : ''}\nmedidas <- c(${cols.map(rq).join(', ')})\nd <- datos[complete.cases(datos[, c(medidas${gName ? ', ' + rq(gName) : ''})]), ]\nd$id <- factor(seq_len(nrow(d)))\n` +
    `largo <- data.frame(id = rep(d$id, ${K}), ${gName ? `grupo = factor(rep(d[[${rq(gName)}]], ${K})), ` : ''}A = factor(rep((seq_len(${K}) - 1) %/% ${kw[1]} + 1, each = nrow(d))), B = factor(rep((seq_len(${K}) - 1) %% ${kw[1]} + 1, each = nrow(d))), valor = unlist(d[, medidas], use.names = FALSE))\n` +
    `modelo <- afex::aov_ez("id", "valor", largo, within = c("A", "B")${gName ? ', between = "grupo"' : ''}, anova_table = list(correction = "${corr.length ? 'GG' : 'none'}", es = c("pes", "ges")))\nmodelo\nsummary(modelo)  # Mauchly y épsilon\nu <- summary(modelo)$univariate.tests; print(cbind(u, MC = u[, "Sum Sq"] / u[, "num Df"], MC_error = u[, "Error SS"] / u[, "den Df"]), digits = 7)  # SC y MC con todas las cifras\naggregate(valor ~ ${gName ? 'grupo + ' : ''}A + B, data = largo, FUN = function(x) c(n = length(x), M = mean(x), DT = sd(x)))  # descriptivos\n# Mauchly con su aproximación χ² para cada efecto intrasujeto (gl del error entre sujetos = n − grupos)\nsp <- summary(modelo)$sphericity.tests; nu <- nrow(d) - ${gName ? `length(unique(d[[${rq(gName)}]]))` : 1}\nfor (ef in rownames(sp)) { W <- sp[ef, "Test statistic"]; p <- prod(c(A = nlevels(largo$A) - 1, B = nlevels(largo$B) - 1)[intersect(strsplit(ef, ":")[[1]], c("A", "B"))])\n  rho <- 1 - (2 * p^2 + p + 2) / (6 * p * nu); chi2 <- -nu * rho * log(W); gl <- p * (p + 1) / 2 - 1; w2 <- (p + 2) * (p - 1) * (p - 2) * (2 * p^3 + 6 * p^2 + 3 * p + 2) / (288 * (nu * p * rho)^2)\n  print(c(efecto = ef, W = signif(W, 7), chi2 = signif(chi2, 7), gl = gl, p = signif(pchisq(chi2, gl, lower.tail = FALSE) + w2 * (pchisq(chi2, gl + 4, lower.tail = FALSE) - pchisq(chi2, gl, lower.tail = FALSE)), 7))) }\npairs(emmeans::emmeans(modelo, ~ A), adjust = "holm")\npairs(emmeans::emmeans(modelo, ~ B), adjust = "holm")`;
}

export { runRm2 };
