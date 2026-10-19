/* Tharp · aplicación · Análisis: tablas de contingencia, proporciones y variables binarias relacionadas */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { toNum } from '../datos/lectura.js';
import { catOf, levelsOf, ordOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, fmtNum, list, nz, pt, pv, rn, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

function runChi(aName, bName, sName = '') {
  const sec = nuevaSeccion(`Asociación entre ${aName} y ${bName}`);
  if (aName === bName) {
    sec.error = 'Elige dos variables distintas.';
    return sec;
  }
  const ca = catOf(vByName(aName)),
    cb = catOf(vByName(bName)),
    keep = ca.map((v, i) => v !== null && cb[i] !== null);
  const la = ordOf(
      vByName(aName),
      ca.filter((v, i) => keep[i])
    ),
    lb = ordOf(
      vByName(bName),
      cb.filter((v, i) => keep[i])
    );
  if (la.length < 2 || lb.length < 2) {
    sec.error = 'Cada variable necesita al menos 2 categorías con datos.';
    return sec;
  }
  const tab = la.map(() => lb.map(() => 0));
  ca.forEach((v, i) => {
    if (keep[i]) tab[la.indexOf(v)][lb.indexOf(cb[i])]++;
  });
  const r = S.chiSquare(tab),
    is2x2 = la.length === 2 && lb.length === 2,
    A = rn(aName),
    B = rn(bName);
  const useFisher = is2x2 && r.minE < 5,
    fisher = is2x2 ? S.fisher2x2(tab[0][0], tab[0][1], tab[1][0], tab[1][1]) : null;
  sec.test = useFisher ? 'Prueba exacta de Fisher' : 'Chi-cuadrado de independencia';
  const { ffh } = chiWhyAndChecks({ sec, aName, la, bName, lb, r, useFisher, is2x2, tab });
  const { rk } = chiTables({ la, lb, r, sec, aName, bName, is2x2, ffh, useFisher, tab, fisher });
  const P = useFisher ? fisher.p : ffh ? ffh.p : r.p;
  const st = useFisher
    ? `prueba exacta de Fisher, ${pt(fisher.p)}, <i>V</i> = ${nz(r.V.toFixed(2))}`
    : ffh
      ? `prueba exacta de Fisher-Freeman-Halton, ${pt(ffh.p)}, <i>V</i> = ${nz(r.V.toFixed(2))}`
      : `χ²(${r.df}, <i>N</i> = ${r.N}) = ${f(r.chi)}, ${pt(r.p)}, <i>V</i> = ${nz(r.V.toFixed(2))}`;
  const { oa } = ordinalAssociation({ aName, bName, is2x2, tab, sec });
  const { mh } = mantelHaenszel({ sName, aName, bName, is2x2, sec, keep, ca, la, lb, cb });
  chiReport({ P, aName, bName, st, rk, lb, la, oa, mh, sName, sec, tab, A, B, is2x2, ffh, r });
  return sec;
}

/** Motivos de la prueba elegida (χ² o Fisher) y supuestos de frecuencias esperadas e independencia */
function chiWhyAndChecks({ sec, aName, la, bName, lb, r, useFisher, is2x2, tab }) {
  sec.why.push(
    `Las dos variables son categóricas: ${esc(aName)} (${la.length} categorías) y ${esc(bName)} (${lb.length} categorías).`
  );
  sec.why.push(
    'Se quiere saber si la distribución de una variable depende de la otra (asociación), comparando frecuencias observadas y esperadas.'
  );
  sec.why.push('El tamaño de la asociación se expresa con la V de Cramér (0 = ninguna, 1 = perfecta).');
  const pct = (r.pctSmall * 100).toFixed(0);
  if (r.pctSmall <= 0.2 && r.minE >= 1)
    sec.checks.push(
      chk(
        'ok',
        `Frecuencias esperadas: ${pct} % de las casillas con valor esperado < 5 (mínimo ${f(r.minE)}). Se cumple el criterio (≤ 20 % y ninguna < 1).`
      )
    );
  else
    sec.checks.push(
      chk(
        'no',
        `Frecuencias esperadas: ${pct} % de las casillas con valor esperado < 5 (mínimo ${f(r.minE)}). No se cumple el criterio (≤ 20 % y ninguna < 1).`
      )
    );
  sec.checks.push(chk('info', 'Independencia: cada participante debe aparecer en una sola casilla de la tabla.'));
  if (useFisher) {
    sec.why.push(
      'En una tabla 2×2 con alguna frecuencia esperada < 5, la aproximación chi-cuadrado no es fiable: se usa la prueba exacta de Fisher.'
    );
    sec.decision =
      'Se eligió la prueba exacta de Fisher porque la tabla es 2×2 y hay frecuencias esperadas menores que 5.';
  } else
    sec.decision =
      'Se eligió la prueba chi-cuadrado de independencia porque ambas variables son categóricas' +
      (r.pctSmall <= 0.2
        ? ' y las frecuencias esperadas son suficientes.'
        : ', aunque hay frecuencias esperadas bajas (ver aviso).');
  const lowE = !is2x2 && (r.pctSmall > 0.2 || r.minE < 1),
    ffh = lowE ? S.fisherRxC(tab) : null;
  if (lowE && !ffh)
    sec.warn =
      'Hay demasiadas casillas con frecuencias esperadas bajas y la tabla es demasiado grande para la prueba exacta: el chi-cuadrado puede no ser fiable. Agrupa categorías con pocos casos (en «Preparar los datos»).';
  if (ffh) {
    sec.why.push(
      `Hay frecuencias esperadas bajas, así que se usa la prueba exacta de Fisher-Freeman-Halton (extensión de Fisher a tablas ${la.length}×${lb.length}), calculada sobre las ${ffh.tables.toLocaleString('es-ES')} tablas posibles con los mismos totales.`
    );
    sec.test = 'Prueba exacta de Fisher-Freeman-Halton';
    sec.decision =
      'Se eligió la prueba exacta de Fisher-Freeman-Halton porque la tabla tiene frecuencias esperadas bajas.';
  }
  sec.alt = is2x2
    ? 'Prueba exacta de Fisher cuando hay frecuencias esperadas bajas.'
    : 'Agrupar categorías poco frecuentes si las frecuencias esperadas son bajas.';
  return { ffh };
}

/** Tablas de contingencia, de pruebas (χ², G², Yates, Fisher) y de riesgos y odds ratio en tablas 2×2 */
function chiTables({ la, lb, r, sec, aName, bName, is2x2, ffh, useFisher, tab, fisher }) {
  const rows = la.map((l, i) =>
    [esc(l)]
      .concat(
        lb.map((_, j) => {
          const a = r.adj[i][j];
          const mark = a > 1.96 ? ' ▲' : a < -1.96 ? ' ▼' : '';
          return `${tab[i][j]} (${f((tab[i][j] / r.rs[i]) * 100, 1)} %)${mark}`;
        })
      )
      .concat([String(r.rs[i])])
  );
  rows.push(['Total'].concat(lb.map((_, j) => `${r.cs[j]} (${f((r.cs[j] / r.N) * 100, 1)} %)`)).concat([String(r.N)]));
  sec.tables.push(
    apaTable(
      `Tabla de contingencia de ${aName} y ${bName}`,
      [esc(aName)].concat(lb.map(esc)).concat(['Total']),
      rows,
      'Recuentos y porcentaje dentro de cada fila. ▲/▼: residuo tipificado corregido > 1.96 / < −1.96 (más / menos casos de los esperados).'
    )
  );
  sec.tables.push(
    apaTable(
      `Frecuencias esperadas y residuos tipificados corregidos`,
      [esc(aName)].concat(lb.map(esc)),
      la.map((l, i) => [esc(l)].concat(lb.map((_, j) => `${f(r.E[i][j], 1)} · ${f(r.adj[i][j])}`))),
      'En cada casilla: frecuencia esperada si no hubiera asociación · residuo tipificado corregido (|valor| > 1.96 indica una diferencia significativa en esa casilla).'
    )
  );
  const tr = [
    ['χ² de Pearson', f(r.chi), r.df, pv(r.p)],
    ['Razón de verosimilitudes (<i>G</i>²)', f(r.G2), r.df, pv(r.pG2)],
  ];
  if (is2x2) {
    tr.push(['χ² con corrección de Yates', f(r.yates.chi), 1, pv(r.yates.p)]);
    tr.push(['Prueba exacta de Fisher', '', '', pv(fisher.p)]);
  }
  if (ffh) tr.push(['Prueba exacta de Fisher-Freeman-Halton', '', '', pv(ffh.p)]);
  sec.tables.push(
    apaTable(
      'Resultado de las pruebas de independencia',
      ['Prueba', 'Valor', '<i>gl</i>', '<i>p</i>'],
      tr,
      `<i>N</i> = ${r.N}. Tamaño de la asociación: <i>V</i> de Cramér = ${nz(r.V.toFixed(3))}${is2x2 ? `, φ = ${nz(r.phi.toFixed(3))}` : ''}, coeficiente de contingencia = ${nz(r.Ccont.toFixed(3))}. ${useFisher ? 'Se interpreta la prueba exacta de Fisher (frecuencias esperadas bajas).' : 'Se interpreta el χ² de Pearson.'}`
    )
  );
  let rk = null;
  if (is2x2) {
    rk = S.risk2x2(tab);
    const ci = c => `[${f(c[0])}, ${f(c[1])}]`;
    sec.tables.push(
      apaTable(
        'Estimación del riesgo (tabla 2×2)',
        ['Medida', 'Valor', 'IC 95 %'],
        [
          [`Odds ratio (${esc(la[0])} / ${esc(la[1])})`, f(rk.or), ci(rk.orCI)],
          [`Riesgo relativo de «${esc(lb[0])}» (${esc(la[0])} frente a ${esc(la[1])})`, f(rk.rr1), ci(rk.rr1CI)],
          [`Riesgo relativo de «${esc(lb[1])}» (${esc(la[0])} frente a ${esc(la[1])})`, f(rk.rr2), ci(rk.rr2CI)],
        ],
        `Odds ratio = (a·d)/(b·c), con la primera fila y la primera columna como referencia de la tabla; IC por el método logarítmico (Woolf y Katz), como SPSS y JASP.${rk.haldane ? ' Como alguna casilla vale 0, se sumó 0.5 a todas (corrección de Haldane-Anscombe).' : ''} Un IC que no incluye el 1 indica asociación significativa.`
      )
    );
    sec.why.push(
      'En una tabla 2×2 se calculan además la odds ratio y el riesgo relativo, que expresan la magnitud de la asociación de forma interpretable (cuántas veces más probable).'
    );
  }
  return { rk };
}

/** Asociación ordinal (gamma, tau-b, tau-c, d de Somers) cuando ambas variables son ordinales */
function ordinalAssociation({ aName, bName, is2x2, tab, sec }) {
  const va = vByName(aName),
    vb = vByName(bName),
    isOrd = v => !!v.order || levelsOf(v).every(l => toNum(l) !== null);
  let oa = null;
  if (isOrd(va) && isOrd(vb) && !is2x2) {
    oa = S.ordinalAssoc(tab);
    const or_ = (k, lab) => [
      lab,
      f(oa[k].est, 3),
      f(oa[k].ase, 3),
      `[${f(oa[k].ci[0], 3)}, ${f(oa[k].ci[1], 3)}]`,
      f(oa[k].z),
      pv(oa[k].p),
    ];
    sec.tables.push(
      apaTable(
        'Medidas de asociación ordinal',
        ['Medida', 'Valor', '<i>EE</i> asint.', 'IC 95 %', '<i>z</i>', '<i>p</i>'],
        [
          or_('gamma', 'Gamma de Goodman y Kruskal'),
          or_('taub', 'Tau-b de Kendall'),
          or_('tauc', 'Tau-c de Stuart'),
          or_('somersCR', `d de Somers (${esc(bName)} dependiente)`),
          or_('somersRC', `d de Somers (${esc(aName)} dependiente)`),
        ],
        `Las dos variables son ordinales (orden: ${esc(aName)} = ${levelsOf(va).map(esc).join(' < ')}; ${esc(bName)} = ${levelsOf(vb).map(esc).join(' < ')}). Valores positivos: a más ${esc(aName)}, más ${esc(bName)}. Errores típicos asintóticos y contrastes como en SPSS.`
      )
    );
    sec.why.push(
      'Como las dos variables tienen un orden, se añaden medidas de asociación ordinal (gamma, tau-b, tau-c y d de Somers), que indican la dirección de la relación, algo que la V de Cramér no recoge.'
    );
  }
  return { oa };
}

/** Análisis estratificado de Mantel-Haenszel (tablas 2×2 por estrato): tabla y supuesto de homogeneidad */
function mantelHaenszel({ sName, aName, bName, is2x2, sec, keep, ca, la, lb, cb }) {
  let mh = null;
  if (sName && sName !== aName && sName !== bName && is2x2) {
    const cs_ = catOf(vByName(sName)),
      ls = ordOf(
        vByName(sName),
        cs_.filter((v, i) => keep[i] && v !== null)
      );
    const strata = ls
      .map(sv => {
        const t2 = [
          [0, 0],
          [0, 0],
        ];
        ca.forEach((v, i) => {
          if (keep[i] && cs_[i] === sv) t2[la.indexOf(v)][lb.indexOf(cb[i])]++;
        });
        return { sv, t2 };
      })
      .filter(o => o.t2.flat().reduce((x, y) => x + y, 0) > 1);
    if (strata.length >= 2) {
      mh = S.mantelHaenszel(strata.map(o => o.t2));
      sec.tables.push(
        apaTable(
          `Análisis estratificado por ${sName} (Mantel-Haenszel)`,
          ['Estrato', '<i>n</i>', 'Odds ratio'],
          strata
            .map(o => {
              const [[a_, b_], [c_, d_]] = o.t2,
                rk_ = S.risk2x2(o.t2);
              return [esc(o.sv), a_ + b_ + c_ + d_, f(rk_.or)];
            })
            .concat([['<b>Común (Mantel-Haenszel)</b>', '', `${f(mh.or)} [${f(mh.ci[0])}, ${f(mh.ci[1])}]`]]),
          `χ² de Mantel-Haenszel (con corrección de continuidad) = ${f(mh.chi)}, <i>gl</i> = 1, ${pt(mh.p)}: contrasta la asociación controlando ${esc(sName)}. Homogeneidad de las odds ratio entre estratos (Breslow-Day con corrección de Tarone): χ²(${mh.bd.df}) = ${f(mh.bd.chi)}, ${pt(mh.bd.p)}. IC de la OR común de Robins, Breslow y Greenland.`
        )
      );
      sec.checks.push(
        chk(
          mh.bd.p >= 0.05 ? 'ok' : 'no',
          `Homogeneidad de las odds ratio entre los estratos de ${esc(sName)} (Breslow-Day): ${pt(mh.bd.p)}.${mh.bd.p >= 0.05 ? ' Se cumple: la OR común resume bien la asociación.' : ' No se cumple: la asociación cambia según el estrato; interpreta cada estrato por separado.'}`
        )
      );
    } else
      sec.checks.push(
        chk('info', `No hay al menos dos estratos de ${esc(sName)} con datos: no se realiza el análisis estratificado.`)
      );
  } else if (sName && !is2x2)
    sec.checks.push(chk('info', 'El análisis estratificado de Mantel-Haenszel solo está disponible para tablas 2×2.'));
  return { mh };
}

/** Redacción APA, figura de barras y código R de la asociación entre variables categóricas */
function chiReport({ P, aName, bName, st, rk, lb, la, oa, mh, sName, sec, tab, A, B, is2x2, ffh, r }) {
  let t =
    P < 0.05
      ? `Se encontró una asociación estadísticamente significativa entre ${esc(aName)} y ${esc(bName)}, ${st}.`
      : `No se encontró una asociación estadísticamente significativa entre ${esc(aName)} y ${esc(bName)}, ${st}.`;
  if (P < 0.05) {
    const hi = [];
    la.forEach((l, i) =>
      lb.forEach((m, j) => {
        if (r.adj[i][j] > 1.96) hi.push(`${esc(m)} en el grupo ${esc(l)} (${f((tab[i][j] / r.rs[i]) * 100, 1)} %)`);
      })
    );
    if (hi.length) t += ` En concreto, hubo más casos de los esperados de ${list(hi.slice(0, 4))}.`;
  }
  if (rk)
    t += ` La odds ratio fue ${f(rk.or)}, IC 95 % [${f(rk.orCI[0])}, ${f(rk.orCI[1])}]: la odds de «${esc(lb[0])}» en ${esc(la[0])} fue ${f(rk.or)} veces la de ${esc(la[1])}.`;
  if (oa)
    t += ` La asociación ordinal fue ${oa.taub.est > 0 ? 'positiva' : 'negativa'}, τ<sub>b</sub> = ${nz(oa.taub.est.toFixed(2))}, ${pt(oa.taub.p)}.`;
  if (mh)
    t += ` Controlando ${esc(sName)}, la odds ratio común de Mantel-Haenszel fue ${f(mh.or)}, IC 95 % [${f(mh.ci[0])}, ${f(mh.ci[1])}], χ²<sub>MH</sub>(1) = ${f(mh.chi)}, ${pt(mh.p)}.`;
  sec.text.push(t);
  if (lb.length <= 8)
    sec.charts.push(
      fig(
        `${bName} dentro de cada grupo de ${aName}`,
        CH.groupedBars(
          la,
          lb,
          tab.map((row, i) => row.map(c => (c / r.rs[i]) * 100))
        ),
        CH.legend(lb)
      )
    );
  sec.code =
    `# Asociación entre ${aName} y ${bName}\ntabla <- table(datos$${A}, datos$${B})\nprop.table(tabla, 1) * 100\nchisq.test(tabla, correct = FALSE)\nchisq.test(tabla, correct = FALSE)$expected\nchisq.test(tabla, correct = FALSE)$stdres\nDescTools::GTest(tabla)  # razón de verosimilitudes\nDescTools::CramerV(tabla); DescTools::ContCoef(tabla)` +
    (is2x2
      ? '\nchisq.test(tabla, correct = TRUE)  # Yates\nfisher.test(tabla)\nDescTools::Phi(tabla)\n# Odds ratio y riesgos relativos con IC de Woolf (logarítmico), como Tharp y SPSS; con alguna casilla a 0 se suma 0.5 (Haldane)\nn4 <- as.numeric(t(tabla)); if (any(n4 == 0)) n4 <- n4 + .5; a1 <- n4[1]; b1 <- n4[2]; c1 <- n4[3]; d1 <- n4[4]; zq <- qnorm(.975)\nrbind(OR = (a1 * d1 / (b1 * c1)) * exp(c(0, -zq, zq) * sqrt(1 / a1 + 1 / b1 + 1 / c1 + 1 / d1)),\n  RR_columna1 = (a1 / (a1 + b1)) / (c1 / (c1 + d1)) * exp(c(0, -zq, zq) * sqrt(1 / a1 - 1 / (a1 + b1) + 1 / c1 - 1 / (c1 + d1))),\n  RR_columna2 = (b1 / (a1 + b1)) / (d1 / (c1 + d1)) * exp(c(0, -zq, zq) * sqrt(1 / b1 - 1 / (a1 + b1) + 1 / d1 - 1 / (c1 + d1))))  # valor, IC inferior, IC superior'
      : '');
  if (ffh) sec.code += '\nfisher.test(tabla)  # Fisher-Freeman-Halton (exacta R×C)';
  if (oa)
    sec.code +=
      '\n# Medidas de asociación ordinal con los errores típicos asintóticos de SPSS (ASE1 para el IC, ASE0 para z), como Tharp\nasoc_ordinal <- function(t) {\n  t <- unclass(as.matrix(t)); R <- nrow(t); C <- ncol(t); n <- sum(t); rs <- rowSums(t); cs <- colSums(t)\n  A <- D <- matrix(0, R, C)\n  for (i in 1:R) for (j in 1:C) { A[i, j] <- sum(t[row(t) > i & col(t) > j]) + sum(t[row(t) < i & col(t) < j]); D[i, j] <- sum(t[row(t) > i & col(t) < j]) + sum(t[row(t) < i & col(t) > j]) }\n  P <- sum(t * A); Q <- sum(t * D); wr <- n^2 - sum(rs^2); wc <- n^2 - sum(cs^2); m <- min(R, C)\n  base0 <- sqrt(max(0, sum(t * (A - D)^2) - (P - Q)^2 / n)); ri <- matrix(rs, R, C); cj <- matrix(cs, R, C, byrow = TRUE)\n  g <- (P - Q) / (P + Q); tb <- (P - Q) / sqrt(wr * wc); tc <- m * (P - Q) / (n^2 * (m - 1)); dcr <- (P - Q) / wr; drc <- (P - Q) / wc\n  ase1 <- c(4 / (P + Q)^2 * sqrt(sum(t * (Q * A - P * D)^2)),\n    1 / (wr * wc) * sqrt(max(0, sum(t * (2 * sqrt(wr * wc) * (A - D) + tb * (ri * wc + cj * wr))^2) - n^3 * tb^2 * (wr + wc)^2)),\n    2 * m / ((m - 1) * n^2) * base0, 2 / wr^2 * sqrt(sum(t * (wr * (A - D) - (P - Q) * (n - ri))^2)), 2 / wc^2 * sqrt(sum(t * (wc * (A - D) - (P - Q) * (n - cj))^2)))\n  ase0 <- c(2 / (P + Q) * base0, 2 / sqrt(wr * wc) * base0, 2 * m / ((m - 1) * n^2) * base0, 2 / wr * base0, 2 / wc * base0)\n  est <- c(gamma = g, tau_b = tb, tau_c = tc, somers_columna_dep = dcr, somers_fila_dep = drc); z <- est / ase0\n  cbind(valor = est, EE = ase1, IC_inf = pmax(-1, est - qnorm(.975) * ase1), IC_sup = pmin(1, est + qnorm(.975) * ase1), z = z, p = 2 * pnorm(-abs(z)))\n}\nprint(asoc_ordinal(tabla), digits = 7)\n# Referencia: DescTools (su error típico de la tau-b y de la d de Somers difiere del de SPSS en la 3.ª-4.ª cifra)\nDescTools::GoodmanKruskalGamma(tabla, conf.level = .95)\nDescTools::KendallTauB(tabla, conf.level = .95)\nDescTools::StuartTauC(tabla, conf.level = .95)';
  if (mh)
    sec.code += `\n# Mantel-Haenszel estratificado por ${sName}\nt3 <- table(datos$${rn(aName)}, datos$${rn(bName)}, datos$${rn(sName)})\nmantelhaen.test(t3)\nDescTools::BreslowDayTest(t3, correct = TRUE)`;
}
// Proporciones: binomial exacta (2 categorías) o χ² de bondad de ajuste (3 o más)
function runProp(name, p0, alt, probsTxt) {
  const v = vByName(name),
    x = catOf(v).filter(q => q !== null),
    lv = levelsOf(v),
    counts = lv.map(l => x.filter(q => q === l).length),
    N = x.length;
  const sec = nuevaSeccion(`Proporciones de ${name}`),
    X = rn(name);
  if (lv.length < 2 || N < 1) {
    sec.error = 'La variable necesita al menos 2 categorías con datos.';
    return sec;
  }
  if (lv.length === 2) {
    if (!(p0 > 0 && p0 < 1)) {
      sec.error = 'La proporción esperada debe estar entre 0 y 1 (por ejemplo, 0.5).';
      return sec;
    }
    binomialCase({ counts, N, p0, alt, sec, name, lv, X });
    return sec;
  }
  let probs = null;
  if (probsTxt) {
    probs = (/[;\s]/.test(probsTxt) ? probsTxt.split(/[;\s]+/) : probsTxt.split(','))
      .map(q => parseFloat(q.replace(',', '.')))
      .filter(q => isFinite(q));
    if (probs.length !== lv.length || probs.some(q => q <= 0)) {
      sec.error = `Escribe ${lv.length} proporciones positivas separadas por comas o espacios, en el orden de las categorías (${list(lv.map(esc))}).`;
      return sec;
    }
  }
  goodnessOfFit({ counts, probs, sec, name, lv, N, X });
  return sec;
}

/** Dos categorías: prueba binomial exacta frente a la proporción esperada, tabla, redacción y código R */
function binomialCase({ counts, N, p0, alt, sec, name, lv, X }) {
  const r = S.binomTest(counts[1], N, p0, alt),
    one = alt !== 'two',
    rAlt = { two: 'two.sided', greater: 'greater', less: 'less' }[alt];
  sec.test = 'Prueba binomial exacta' + (one ? ' (unilateral)' : '');
  sec.why.push(
    `${esc(name)} tiene 2 categorías: se contrasta si la proporción de «${esc(lv[1])}» difiere de la esperada (${fmtNum(p0)}) con la prueba binomial exacta, válida con cualquier tamaño de muestra.`
  );
  sec.decision = `Se eligió la prueba binomial exacta para comparar la proporción observada de «${esc(lv[1])}» con ${fmtNum(p0)}.`;
  sec.alt = 'Con muestras grandes, la aproximación normal da prácticamente el mismo resultado.';
  sec.tables.push(
    apaTable(
      `Prueba binomial de ${name}`,
      [
        'Categoría',
        '<i>n</i>',
        'Total',
        'Proporción',
        'Esperada',
        '<i>p</i>' + (one ? ' (unilateral)' : ''),
        'IC 95 % (proporción)',
      ],
      [
        [
          esc(lv[1]),
          counts[1],
          N,
          nz(r.prop.toFixed(3)),
          fmtNum(p0),
          pv(r.p),
          `[${nz(r.ci[0].toFixed(3))}, ${nz(r.ci[1].toFixed(3))}]`,
        ],
      ],
      'IC exacto de Clopper-Pearson.'
    )
  );
  sec.text.push(
    `Se aplicó una prueba binomial exacta${one ? ' unilateral' : ''} para comparar la proporción de «${esc(lv[1])}» en ${esc(name)} (${counts[1]} de ${N}, ${f(r.prop * 100, 1)} %, IC 95 % [${f(r.ci[0] * 100, 1)}, ${f(r.ci[1] * 100, 1)}] %) con el valor esperado de ${f(p0 * 100, 1)} %. ` +
      (r.p < 0.05
        ? `La proporción observada fue significativamente ${r.prop > p0 ? 'mayor' : 'menor'} que la esperada, ${pt(r.p)}.`
        : `No difirió significativamente de la esperada, ${pt(r.p)}.`)
  );
  sec.code = `# Proporción de «${lv[1]}» en ${name}\nbinom.test(sum(datos$${X} == ${rq(lv[1])}, na.rm = TRUE), sum(!is.na(datos$${X})), p = ${p0}${one ? `, alternative = "${rAlt}"` : ''})`;
}

/** Más de dos categorías: χ² de bondad de ajuste con proporciones iguales o indicadas, tablas, redacción y código R */
function goodnessOfFit({ counts, probs, sec, name, lv, N, X }) {
  const r = S.chiGOF(counts, probs);
  sec.test = 'χ² de bondad de ajuste';
  sec.why.push(
    `${esc(name)} tiene ${lv.length} categorías: se contrasta si las frecuencias observadas se ajustan a ${probs ? 'las proporciones indicadas' : 'una distribución uniforme (todas las categorías igual de frecuentes)'}.`
  );
  sec.decision = `Se eligió la χ² de bondad de ajuste para comparar las frecuencias de ${esc(name)} con ${probs ? 'las proporciones esperadas indicadas' : 'proporciones iguales'}.`;
  sec.checks.push(
    chk(
      r.minE >= 5 ? 'ok' : 'no',
      `Frecuencias esperadas: mínimo ${f(r.minE, 1)}. ${r.minE >= 5 ? 'Todas ≥ 5: se cumple el criterio.' : 'Alguna < 5: la aproximación χ² puede no ser fiable; valora agrupar categorías.'}`
    )
  );
  sec.tables.push(
    apaTable(
      `Frecuencias observadas y esperadas de ${name}`,
      ['Categoría', 'Observadas', '%', 'Proporción esperada', 'Esperadas', 'Residuo tipificado'],
      lv
        .map((l, i) => [
          esc(l),
          counts[i],
          f((counts[i] / N) * 100, 1),
          nz(r.probs[i].toFixed(3)),
          f(r.E[i], 1),
          f(r.resid[i]),
        ])
        .concat([['Total', N, '100.0', '', '', '']])
    )
  );
  sec.tables.push(
    apaTable(
      'Resultado de la χ² de bondad de ajuste',
      ['χ²', '<i>gl</i>', '<i>p</i>', '<i>w</i> de Cohen', '<i>N</i>'],
      [[f(r.chi), r.df, pv(r.p), nz(r.w.toFixed(3)), N]],
      '<i>w</i> = √(χ²/<i>N</i>): 0.10 pequeño, 0.30 mediano, 0.50 grande.'
    )
  );
  sec.text.push(
    `Se aplicó una prueba χ² de bondad de ajuste para comparar las frecuencias de ${esc(name)} con ${probs ? 'las proporciones esperadas' : 'una distribución uniforme'}. ` +
      (r.p < 0.05
        ? `Las frecuencias observadas difirieron significativamente de las esperadas, χ²(${r.df}, <i>N</i> = ${N}) = ${f(r.chi)}, ${pt(r.p)}, <i>w</i> = ${nz(r.w.toFixed(2))}.`
        : `Las frecuencias observadas no difirieron significativamente de las esperadas, χ²(${r.df}, <i>N</i> = ${N}) = ${f(r.chi)}, ${pt(r.p)}.`)
  );
  sec.code = `# Bondad de ajuste de ${name}\nobs <- table(factor(datos$${X}, levels = c(${lv.map(rq).join(', ')})))\nprueba <- chisq.test(obs${probs ? `, p = c(${r.probs.map(q => +q.toFixed(6)).join(', ')})` : ''}); prueba\nc(w_de_Cohen = sqrt(unname(prueba$statistic) / sum(obs)))`;
}
function runBinRel(names) {
  const k = names.length,
    sec = nuevaSeccion(
      `${names.length ? names.join(', ') + ': ' : ''}cambio en una variable sí/no (McNemar o Q de Cochran)`
    );
  if (k < 2) {
    sec.error = 'Selecciona al menos dos variables (momentos).';
    return sec;
  }
  const cs = names.map(n => catOf(vByName(n))),
    lv = ordOf(names.map(vByName).find(v => v.order) || vByName(names[0]), cs.flat());
  if (lv.length !== 2) {
    sec.error = `Las variables deben tener las mismas dos categorías (se han encontrado ${lv.length}: ${list(lv.slice(0, 6).map(esc))}).`;
    return sec;
  }
  const idx = ST.rows.map((_, i) => i).filter(i => cs.every(c => c[i] !== null)),
    n = idx.length,
    ev = lv[1];
  if (n < 5) {
    sec.error = 'Hay muy pocos casos con todas las respuestas.';
    return sec;
  }
  const M = idx.map(i => cs.map(c => (c[i] === ev ? 1 : 0))),
    props = names.map((_, j) => S.mean(M.map(r => r[j])));
  sec.why.push(
    `Las mismas ${n} personas responden «${esc(lv[0])}» o «${esc(ev)}» en ${k} momentos: ${list(names.map(esc))}.`
  );
  sec.why.push(
    'Con respuestas dicotómicas relacionadas no sirve el chi-cuadrado de independencia: hay que comparar los cambios dentro de cada persona.'
  );
  sec.checks.push(chk('info', 'Independencia entre personas: cada fila debe ser un participante distinto.'));
  sec.tables.push(
    apaTable(
      `Porcentaje de «${ev}» en cada momento`,
      ['Momento', '<i>n</i>', `«${esc(ev)}»`, '%'],
      names.map((nm, j) => [esc(nm), n, S.sum(M.map(r => r[j])), f(props[j] * 100, 1)])
    )
  );
  sec.charts.push(
    fig(
      `Porcentaje de «${ev}» en cada momento`,
      CH.barsCat(
        names,
        props.map(p => +(p * 100).toFixed(1)),
        '%'
      )
    )
  );
  const Q = names.map(rq).join(', ');
  if (k === 2) {
    mcnemarCase({ M, sec, names, lv, ev, n, props });
  } else {
    cochranCase({ M, sec, k, names, n, ev, Q, props });
  }
  return sec;
}

/** Dos momentos: prueba de McNemar (exacta si hay pocas discordancias), tablas, redacción y código R */
function mcnemarCase({ M, sec, names, lv, ev, n, props }) {
  const b = M.filter(r => r[0] === 0 && r[1] === 1).length,
    c = M.filter(r => r[0] === 1 && r[1] === 0).length,
    r = S.mcnemar(b, c),
    exact = b + c < 25,
    P = exact ? r.pExact : r.p;
  sec.test = 'Prueba de McNemar' + (exact ? ' (exacta)' : '');
  sec.decision = `Se eligió la prueba de McNemar porque son dos respuestas dicotómicas de las mismas personas${exact ? '; como hay pocos casos que cambian (menos de 25), se usa su versión exacta (binomial)' : ''}.`;
  sec.alt = 'Q de Cochran si hubiera tres o más momentos.';
  const a = M.filter(x => x[0] === 0 && x[1] === 0).length,
    d = M.filter(x => x[0] === 1 && x[1] === 1).length;
  sec.tables.push(
    apaTable(
      `Tabla de cambios entre ${names[0]} y ${names[1]}`,
      [`${esc(names[0])} \\ ${esc(names[1])}`, esc(lv[0]), esc(ev)],
      [
        [esc(lv[0]), a, b],
        [esc(ev), c, d],
      ],
      `Casos que cambian: ${b} de «${esc(lv[0])}» a «${esc(ev)}» y ${c} de «${esc(ev)}» a «${esc(lv[0])}».`
    )
  );
  sec.tables.push(
    apaTable(
      'Resultado de la prueba de McNemar',
      ['', 'χ²', '<i>gl</i>', '<i>p</i>', '<i>p</i> exacta', '<i>n</i>'],
      [[`${esc(names[0])} → ${esc(names[1])}`, f(r.chi), 1, pv(r.p), pv(r.pExact), n]],
      'χ² con corrección por continuidad. <i>p</i> exacta: prueba binomial sobre los casos discordantes.'
    )
  );
  const st = exact ? `prueba de McNemar exacta, ${pt(P)}` : `χ²(1, <i>N</i> = ${n}) = ${f(r.chi)}, ${pt(P)}`;
  sec.text.push(
    `Se aplicó la prueba de McNemar para comparar la proporción de «${esc(ev)}» entre ${esc(names[0])} (${f(props[0] * 100, 1)} %) y ${esc(names[1])} (${f(props[1] * 100, 1)} %). ` +
      (P < 0.05
        ? `El cambio fue estadísticamente significativo, ${st}: ${b} personas pasaron a «${esc(ev)}» y ${c} dejaron de estarlo.`
        : `El cambio no fue estadísticamente significativo, ${st}.`)
  );
  sec.code = `# McNemar: ${names[0]} → ${names[1]}\ntabla <- table(datos[[${rq(names[0])}]], datos[[${rq(names[1])}]])\ntabla\nmcnemar.test(tabla, correct = TRUE)\nbinom.test(tabla[1, 2], tabla[1, 2] + tabla[2, 1])  # versión exacta`;
}

/** Tres o más momentos: Q de Cochran con comparaciones por pares (McNemar, Holm), tablas, redacción y código R */
function cochranCase({ M, sec, k, names, n, ev, Q, props }) {
  const r = S.cochranQ(M);
  sec.test = 'Q de Cochran';
  sec.decision = `Se eligió la Q de Cochran porque son ${k} respuestas dicotómicas de las mismas personas.`;
  sec.alt = 'McNemar para comparar solo dos momentos.';
  sec.tables.push(
    apaTable(
      'Resultado de la Q de Cochran',
      ['', '<i>Q</i>', '<i>gl</i>', '<i>p</i>', '<i>n</i>'],
      [[list(names.map(esc)), f(r.Q), r.df, pv(r.p), n]]
    )
  );
  let t = `Se aplicó la Q de Cochran para comparar la proporción de «${esc(ev)}» en ${list(names.map((nm, j) => `${esc(nm)} (${f(props[j] * 100, 1)} %)`))}. `;
  if (r.p < 0.05) {
    const pairs = [];
    for (let a = 0; a < k; a++)
      for (let b2 = a + 1; b2 < k; b2++) {
        const b = M.filter(x => x[a] === 0 && x[b2] === 1).length,
          c = M.filter(x => x[a] === 1 && x[b2] === 0).length;
        pairs.push({ a, b: b2, r: S.mcnemar(b, c) });
      }
    S.holm(pairs.map(o => o.r.p)).forEach((p, i) => (pairs[i].padj = p));
    const sig = pairs.filter(o => o.padj < 0.05);
    t +=
      `Las diferencias fueron estadísticamente significativas, <i>Q</i>(${r.df}) = ${f(r.Q)}, ${pt(r.p)}.` +
      (sig.length
        ? ` Las comparaciones por pares (McNemar con corrección de Holm) mostraron diferencias entre ${list(sig.map(o => `${esc(names[o.a])} y ${esc(names[o.b])} (${pt(o.padj)})`))}.`
        : ' Las comparaciones por pares (McNemar con corrección de Holm) no detectaron diferencias entre pares concretos.');
    sec.tables.push(
      apaTable(
        'Comparaciones por pares (McNemar, corrección de Holm)',
        ['Comparación', 'χ²', '<i>p</i> ajustada'],
        pairs.map(o => [`${esc(names[o.a])} − ${esc(names[o.b])}`, f(o.r.chi), pv(o.padj)])
      )
    );
  } else t += `Las diferencias no fueron estadísticamente significativas, <i>Q</i>(${r.df}) = ${f(r.Q)}, ${pt(r.p)}.`;
  sec.text.push(t);
  sec.code = `# Q de Cochran: ${names.join(', ')}\nmedidas <- c(${Q})\nd <- datos[complete.cases(datos[, medidas]), medidas]\nd01 <- as.data.frame(lapply(d, function(x) as.integer(x == ${rq(ev)})))\nd01$id <- factor(seq_len(nrow(d01)))\nlargo <- data.frame(id = rep(d01$id, ${k}), momento = factor(rep(medidas, each = nrow(d01)), levels = medidas), valor = unlist(d01[, medidas], use.names = FALSE))\nas.data.frame(rstatix::cochran_qtest(largo, valor ~ momento | id))  # Q de Cochran\nas.data.frame(rstatix::pairwise_mcnemar_test(largo, valor ~ momento | id, p.adjust.method = "holm"))`;
}

export { runChi, runProp, runBinRel };
