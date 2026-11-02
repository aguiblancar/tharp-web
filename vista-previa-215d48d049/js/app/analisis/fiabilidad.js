/* Tharp · aplicación · Análisis: acuerdo entre jueces y fiabilidad */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { catOf, numOf, ordOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, list, nz, pt, pv, r2s, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';
import { maxOf, minOf } from '../utilidades.js';

// Acuerdo entre jueces: CCI (cuantitativas) o kappa (categóricas)
function runAgree(names, opts) {
  const sec = nuevaSeccion('Acuerdo entre jueces'),
    vs = names.map(vByName);
  if (vs.length < 2) {
    sec.error = 'Selecciona al menos dos variables: una por juez o por aplicación.';
    return sec;
  }
  const types = [...new Set(vs.map(v => v.type))];
  if (types.length > 1) {
    sec.error = 'Las variables deben ser todas cuantitativas (CCI) o todas categóricas (kappa).';
    return sec;
  }
  const Q = `c(${names.map(rq).join(', ')})`;
  if (types[0] === 'num') {
    const cols = vs.map(numOf),
      idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)),
      Y = idx.map(i => cols.map(c => c[i]));
    if (Y.length < 3) {
      sec.error = 'Se necesitan al menos 3 casos con todas las puntuaciones.';
      return sec;
    }
    iccReport({ Y, opts, sec, vs, names, Q, cols });
    return sec;
  }
  const cols = vs.map(catOf),
    idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)),
    R = idx.map(i => cols.map(c => c[i]));
  if (R.length < 3) {
    sec.error = 'Se necesitan al menos 3 casos valorados por todos los jueces.';
    return sec;
  }
  const lv = ordOf(vs.find(v => v.order) || vs[0], R.flat());
  const ordK = vs.some(v => v.order),
    kaC = S.krippAlpha(
      ST.rows.map((_, i) => cols.map(c => c[i])).filter(u => u.filter(v => v !== null).length >= 2),
      ordK ? 'ordinal' : 'nominal',
      lv
    );
  const kaTab = () =>
    apaTable(
      'α de Krippendorff',
      ['Nivel de medida', 'α'],
      [[ordK ? 'Ordinal' : 'Nominal', nz(kaC.alpha.toFixed(3))]],
      'Admite valoraciones que faltan. Orientativo (Krippendorff): ≥ .80 fiable; .667–.80 solo para conclusiones provisionales.'
    );
  const kaCode = `\n# α de Krippendorff\nm <- t(sapply(datos[, ${Q}], function(x) match(as.character(x), c(${lv.map(rq).join(', ')}))))\n\n# α de Krippendorff con su definición (matriz de coincidencias), como Tharp; admite valoraciones que faltan (NA)\n# (irr::kripp.alpha se desvía de la definición cuando no falta ningún dato)\nkripp <- function(u, nivel, orden = NULL) {  # u: sujetos × jueces\n  vals <- if (is.null(orden)) sort(unique(na.omit(as.vector(u)))) else orden; V <- length(vals); o <- matrix(0, V, V)\n  for (i in seq_len(nrow(u))) { r <- match(u[i, !is.na(u[i, ])], vals); mu <- length(r); if (mu < 2) next\n    for (a in 1:mu) for (b in 1:mu) if (a != b) o[r[a], r[b]] <- o[r[a], r[b]] + 1 / (mu - 1) }\n  nc <- rowSums(o); N <- sum(nc)\n  d2 <- function(c, k) switch(nivel, nominal = (c != k) * 1, ordinal = (sum(nc[min(c, k):max(c, k)]) - (nc[c] + nc[k]) / 2)^2, (vals[c] - vals[k])^2)\n  D <- outer(1:V, 1:V, Vectorize(d2)); 1 - (sum(o * D) / N) / (sum(outer(nc, nc) * D) / (N * (N - 1)))\n}\nkripp(t(m), "${ordK ? 'ordinal' : 'nominal'}", 1:${lv.length})`;
  if (vs.length === 2) {
    cohenKappa({ opts, R, lv, sec, names, kaTab, ordK, kaC, Q, kaCode });
    return sec;
  }
  const r = S.fleissKappa(R, lv);
  sec.test = 'Kappa de Fleiss';
  sec.why.push(
    `${vs.length} jueces asignan categorías (${list(lv.map(esc))}) a los mismos ${R.length} casos: la kappa de Fleiss generaliza la de Cohen a más de dos jueces.`
  );
  sec.decision = `Se calculó la kappa de Fleiss entre ${vs.length} jueces con ${R.length} casos.`;
  sec.tables.push(
    apaTable(
      'Kappa de Fleiss',
      ['', 'κ', '<i>z</i>', '<i>p</i>'],
      [['Global', nz(r.kappa.toFixed(3)), f(r.z), pv(r.p)]].concat(
        r.byCat.map(c => [`Categoría ${esc(c.level)}`, nz(c.kappa.toFixed(3)), '', ''])
      ),
      `<i>z</i> y <i>p</i> contrastan κ = 0. ${R.length} casos, ${vs.length} jueces.`
    )
  );
  sec.tables.push(kaTab());
  sec.text.push(
    `Se calculó la kappa de Fleiss para evaluar el acuerdo entre ${vs.length} jueces (${list(names.map(esc))}) en ${R.length} casos: κ = ${nz(r.kappa.toFixed(2))}, <i>z</i> = ${f(r.z)}, ${pt(r.p)}; el α de Krippendorff (${ordK ? 'ordinal' : 'nominal'}) fue ${nz(kaC.alpha.toFixed(2))}.`
  );
  sec.code = `# Kappa de Fleiss\nd <- na.omit(datos[, ${Q}])\nirr::kappam.fleiss(d, detail = TRUE)` + kaCode;
  return sec;
}

/** CCI, W de Kendall y Bland-Altman con dos jueces: tablas, redacción y código R */
function iccReport({ Y, opts, sec, vs, names, Q, cols }) {
  const r = S.icc(Y),
    key = opts.model + (opts.unit === 'average' ? 'k' : ''),
    sel = r.forms.find(q => q.type === key);
  const MW = {
    ICC1: 'Un factor, aleatorios, medida única',
    ICC1k: 'Un factor, aleatorios, promedio',
    ICC2: 'Dos factores, aleatorios, acuerdo absoluto, medida única',
    ICC2k: 'Dos factores, aleatorios, acuerdo absoluto, promedio',
    ICC3: 'Dos factores, mixtos, consistencia, medida única',
    ICC3k: 'Dos factores, mixtos, consistencia, promedio',
  };
  const lvl = v => (v < 0.5 ? 'pobre' : v < 0.75 ? 'moderada' : v < 0.9 ? 'buena' : 'excelente');
  sec.test = `Coeficiente de correlación intraclase (${key})`;
  sec.why.push(
    `${vs.length} jueces o aplicaciones cuantitativas (${list(names.map(esc))}) sobre ${Y.length} sujetos: el CCI mide qué parte de la variabilidad se debe a diferencias reales entre sujetos y no a desacuerdos entre jueces.`
  );
  sec.why.push(
    `Se interpreta el ${MW[key]} (${key}; McGraw y Wong, 1996). ${opts.model === 'ICC2' ? 'Es la forma recomendada para fiabilidad entre jueces y test-retest cuando se quiere generalizar a otros jueces o momentos (Koo y Li, 2016).' : opts.model === 'ICC3' ? 'Solo valora la consistencia (que ordenen igual a los sujetos), no que den exactamente la misma puntuación.' : 'Adecuado cuando cada sujeto es evaluado por jueces distintos.'}`
  );
  sec.decision = `Se calculó el CCI ${MW[key].toLowerCase()} con ${Y.length} sujetos y ${vs.length} jueces o aplicaciones.`;
  sec.checks.push(
    chk(
      'info',
      'Interpretación (Koo y Li, 2016): < .50 pobre, .50–.75 moderada, .75–.90 buena, > .90 excelente; conviene basarla en el intervalo de confianza.'
    )
  );
  if (ST.rows.length - Y.length)
    sec.checks.push(chk('info', `Se excluyeron ${ST.rows.length - Y.length} casos sin todas las puntuaciones.`));
  sec.tables.push(
    apaTable(
      'Coeficientes de correlación intraclase',
      ['Forma', 'Modelo', 'CCI', 'IC 95 %', '<i>F</i>', '<i>gl</i><sub>1</sub>', '<i>gl</i><sub>2</sub>', '<i>p</i>'],
      r.forms.map(q => [
        (q.type === key ? '<b>' : '') + q.type + (q.type === key ? '</b>' : ''),
        MW[q.type],
        nz(q.icc.toFixed(3)),
        `[${nz(q.ci[0].toFixed(3))}, ${nz(q.ci[1].toFixed(3))}]`,
        f(q.F),
        q.df1,
        q.df2,
        pv(q.p),
      ]),
      `En negrita, la forma elegida. Nomenclatura de Shrout y Fleiss (1979); modelos e IC de McGraw y Wong (1996). <i>F</i> contrasta CCI = 0.`
    )
  );
  const kw = S.kendallW(Y),
    unitsAll = ST.rows.map((_, i) => cols.map(c => c[i])).filter(u => u.filter(v => v !== null).length >= 2),
    ka = S.krippAlpha(unitsAll, 'interval');
  sec.tables.push(
    apaTable(
      'Otras medidas de acuerdo',
      ['Medida', 'Valor', 'Contraste'],
      [
        [
          '<i>W</i> de Kendall (concordancia en el orden de los sujetos)',
          nz(kw.W.toFixed(3)),
          `χ²(${kw.df}) = ${f(kw.chi)}, ${pt(kw.p)}`,
        ],
        [
          'α de Krippendorff (intervalo)',
          nz(ka.alpha.toFixed(3)),
          `${unitsAll.length} sujetos con al menos dos valoraciones`,
        ],
      ],
      'La <i>W</i> de Kendall valora si los jueces ordenan igual a los sujetos (0 = nada, 1 = total), con corrección por empates. El α de Krippendorff admite valoraciones que faltan.'
    )
  );
  const { ba } = blandAltman({ vs, Y, sec, names });
  sec.text.push(
    `Se calculó el coeficiente de correlación intraclase (${MW[key].toLowerCase()}) para evaluar el acuerdo entre ${list(names.map(esc))} en ${Y.length} sujetos. El CCI fue ${nz(sel.icc.toFixed(2))}, IC 95 % [${nz(sel.ci[0].toFixed(2))}, ${nz(sel.ci[1].toFixed(2))}], <i>F</i>(${sel.df1}, ${sel.df2}) = ${f(sel.F)}, ${pt(sel.p)}, lo que indica una fiabilidad ${lvl(sel.icc)} según los criterios de Koo y Li (2016). La concordancia de Kendall fue <i>W</i> = ${nz(kw.W.toFixed(2))}, ${pt(kw.p)}.${ba ? ` El análisis de Bland-Altman mostró un sesgo de ${f(ba.bias)}, IC 95 % [${f(ba.biasCI[0])}, ${f(ba.biasCI[1])}], con límites de acuerdo entre ${f(ba.lo)} y ${f(ba.hi)}.` : ''}`
  );
  sec.code =
    `# Coeficiente de correlación intraclase\nd <- na.omit(datos[, ${Q}])\nic <- irr::icc(d, model = "${opts.model === 'ICC1' ? 'oneway' : 'twoway'}", type = "${opts.model === 'ICC3' ? 'consistency' : 'agreement'}", unit = "${opts.unit}"); ic\nc(CCI = ic$value, IC_inf = ic$lbound, IC_sup = ic$ubound, F = ic$Fvalue, gl1 = ic$df1, gl2 = ic$df2, p = ic$p.value)  # sin redondear\n# Las 6 formas con irr (IC de McGraw y Wong, como Tharp; psych calcula de otro modo el IC de las formas promedio)\nfor (fm in list(c("oneway", "agreement", "single"), c("oneway", "agreement", "average"), c("twoway", "agreement", "single"), c("twoway", "agreement", "average"), c("twoway", "consistency", "single"), c("twoway", "consistency", "average"))) {\n  r6 <- irr::icc(d, model = fm[1], type = fm[2], unit = fm[3]); cat(paste(fm, collapse = "/"), "\\n"); print(c(CCI = r6$value, IC_inf = r6$lbound, IC_sup = r6$ubound, F = r6$Fvalue, gl1 = r6$df1, gl2 = r6$df2, p = r6$p.value)) }\npsych::ICC(d)  # referencia\nkw <- irr::kendall(d, correct = TRUE); kw\nc(W = kw$value, chi2 = unname(kw$statistic), gl = kw$df, p = kw$p.value)  # sin redondear\n# α de Krippendorff con su definición (matriz de coincidencias), como Tharp; admite valoraciones que faltan (NA)\n# (irr::kripp.alpha se desvía de la definición cuando no falta ningún dato)\nkripp <- function(u, nivel, orden = NULL) {  # u: sujetos × jueces\n  vals <- if (is.null(orden)) sort(unique(na.omit(as.vector(u)))) else orden; V <- length(vals); o <- matrix(0, V, V)\n  for (i in seq_len(nrow(u))) { r <- match(u[i, !is.na(u[i, ])], vals); mu <- length(r); if (mu < 2) next\n    for (a in 1:mu) for (b in 1:mu) if (a != b) o[r[a], r[b]] <- o[r[a], r[b]] + 1 / (mu - 1) }\n  nc <- rowSums(o); N <- sum(nc)\n  d2 <- function(c, k) switch(nivel, nominal = (c != k) * 1, ordinal = (sum(nc[min(c, k):max(c, k)]) - (nc[c] + nc[k]) / 2)^2, (vals[c] - vals[k])^2)\n  D <- outer(1:V, 1:V, Vectorize(d2)); 1 - (sum(o * D) / N) / (sum(outer(nc, nc) * D) / (N * (N - 1)))\n}\nkripp(as.matrix(datos[, ${Q}]), "interval")  # α de Krippendorff (intervalo)` +
    (vs.length === 2
      ? `\n# Bland-Altman: sesgo y límites de acuerdo (± 1.96 DT) con IC 95 % (t; EE de los límites = √(3·DT²/n))\ndif <- d[[1]] - d[[2]]; nb <- length(dif); sb <- sd(dif); mb <- mean(dif); tq <- qt(.975, nb - 1); li <- mb - qnorm(.975) * sb; ls <- mb + qnorm(.975) * sb; eb <- sb / sqrt(nb); el <- sqrt(3 * sb^2 / nb)\nrbind(sesgo = c(mb, mb - tq * eb, mb + tq * eb), inferior = c(li, li - tq * el, li + tq * el), superior = c(ls, ls - tq * el, ls + tq * el))\nsummary(lm(dif ~ I((d[[1]] + d[[2]]) / 2)))  # sesgo proporcional`
      : '');
}

/** Bland-Altman con dos jueces: sesgo, límites de acuerdo, tabla y gráfico */
function blandAltman({ vs, Y, sec, names }) {
  let ba = null;
  if (vs.length === 2) {
    ba = S.blandAltman(
      Y.map(r => r[0]),
      Y.map(r => r[1])
    );
    const c2 = c => `[${f(c[0])}, ${f(c[1])}]`;
    sec.tables.push(
      apaTable(
        `Bland-Altman: ${names[0]} − ${names[1]}`,
        ['', 'Estimación', 'IC 95 %'],
        [
          ['Sesgo (diferencia media)', f(ba.bias), c2(ba.biasCI)],
          ['Límite inferior de acuerdo (−1.96 DT)', f(ba.lo), c2(ba.loCI)],
          ['Límite superior de acuerdo (+1.96 DT)', f(ba.hi), c2(ba.hiCI)],
        ],
        `DT de las diferencias = ${f(ba.sd)}; el sesgo ${ba.pBias < 0.05 ? 'difiere' : 'no difiere'} significativamente de 0 (${pt(ba.pBias)}). Sesgo proporcional (regresión de la diferencia sobre la media): <i>B</i> = ${f(ba.prop.b, 3)}, ${pt(ba.prop.p)}${ba.prop.p < 0.05 ? ', lo que indica que la discrepancia cambia con la magnitud de la medida' : ''}. IC de Bland y Altman (1999).`
      )
    );
    sec.charts.push(
      fig(
        `Bland-Altman: ${names[0]} frente a ${names[1]}`,
        CH.blandAltmanPlot(ba.mean, ba.diff, ba.bias, ba.lo, ba.hi, `Media de ${names[0]} y ${names[1]}`)
      )
    );
    sec.why.push(
      'Con dos medidas cuantitativas se añade el análisis de Bland-Altman: muestra cuánto difieren en promedio (sesgo) y entre qué valores cae el 95 % de las diferencias (límites de acuerdo), algo que el CCI no informa.'
    );
  }
  return { ba };
}

/** Kappa de Cohen (ponderada o no) entre dos jueces: tablas, redacción y código R */
function cohenKappa({ opts, R, lv, sec, names, kaTab, ordK, kaC, Q, kaCode }) {
  const w = opts.weight,
    r = S.cohenKappa(
      R.map(x => x[0]),
      R.map(x => x[1]),
      lv,
      w
    ),
    wn = { none: '', linear: ' ponderada lineal', quadratic: ' ponderada cuadrática' }[w];
  const lk = v =>
    v < 0
      ? 'peor que el azar'
      : v <= 0.2
        ? 'leve'
        : v <= 0.4
          ? 'aceptable'
          : v <= 0.6
            ? 'moderado'
            : v <= 0.8
              ? 'considerable'
              : 'casi perfecto';
  sec.test = `Kappa de Cohen${wn}`;
  sec.why.push(
    `Dos jueces asignan categorías (${list(lv.map(esc))}) a los mismos ${R.length} casos: la kappa de Cohen mide el acuerdo corrigiendo el que se esperaría por azar.`
  );
  if (w !== 'none')
    sec.why.push(
      `Kappa ponderada (${w === 'linear' ? 'lineal' : 'cuadrática'}): los desacuerdos entre categorías cercanas penalizan menos que entre categorías lejanas; adecuada si las categorías están ordenadas (orden usado: ${list(lv.map(esc))}).`
    );
  sec.decision = `Se calculó la kappa de Cohen${wn} entre ${esc(names[0])} y ${esc(names[1])} con ${R.length} casos.`;
  sec.checks.push(
    chk(
      'info',
      'Interpretación (Landis y Koch, 1977): ≤ .20 leve, .21–.40 aceptable, .41–.60 moderado, .61–.80 considerable, > .80 casi perfecto.'
    )
  );
  const tab = lv.map(a => lv.map(b => R.filter(x => x[0] === a && x[1] === b).length));
  sec.tables.push(
    apaTable(
      `Tabla de acuerdo entre ${names[0]} (filas) y ${names[1]} (columnas)`,
      [''].concat(lv.map(esc)),
      lv.map((a, i) => [esc(a)].concat(tab[i].map((c, j) => (i === j ? `<b>${c}</b>` : String(c))))),
      'En negrita, los acuerdos.'
    )
  );
  sec.tables.push(
    apaTable(
      `Kappa de Cohen${wn}`,
      ['κ', '<i>EE</i>', 'IC 95 %', '<i>z</i>', '<i>p</i>', 'Acuerdo observado', 'Acuerdo esperado', '<i>n</i>'],
      [
        [
          nz(r.kappa.toFixed(3)),
          nz(r.se.toFixed(3)),
          `[${nz(r.ci[0].toFixed(3))}, ${nz(r.ci[1].toFixed(3))}]`,
          f(r.z),
          pv(r.p),
          `${f(r.po * 100, 1)} %`,
          `${f(r.pe * 100, 1)} %`,
          r.n,
        ],
      ],
      '<i>z</i> y <i>p</i> contrastan κ = 0 (Fleiss, Cohen y Everitt, 1969); IC con el error típico asintótico.'
    )
  );
  sec.tables.push(kaTab());
  sec.text.push(
    `Se calculó la kappa de Cohen${wn} para evaluar el acuerdo entre ${esc(names[0])} y ${esc(names[1])} (${R.length} casos). El acuerdo observado fue del ${f(r.po * 100, 1)} % y la kappa fue ${nz(r.kappa.toFixed(2))}, IC 95 % [${nz(r.ci[0].toFixed(2))}, ${nz(r.ci[1].toFixed(2))}], <i>z</i> = ${f(r.z)}, ${pt(r.p)}, lo que indica un acuerdo ${lk(r.kappa)} (Landis y Koch, 1977). El α de Krippendorff (${ordK ? 'ordinal' : 'nominal'}) fue ${nz(kaC.alpha.toFixed(2))}.`
  );
  sec.code =
    `# Kappa de Cohen\n# códigos 1, 2, 3… en el orden de las categorías de Tharp (irr ordenaría el texto alfabéticamente y la ponderación sería errónea)\nd <- na.omit(datos[, ${Q}])\nd <- data.frame(lapply(d, function(x) match(as.character(x), c(${lv.map(rq).join(', ')}))))\nk <- irr::kappa2(d, weight = "${{ none: 'unweighted', linear: 'equal', quadratic: 'squared' }[w]}"); k\nc(kappa = k$value, z = k$statistic, p = k$p.value)  # sin redondear\n# EE asintótico e IC 95 % (Fleiss, Cohen y Everitt, 1969), como Tharp\nK <- ${lv.length}; P <- table(factor(d[[1]], 1:K), factor(d[[2]], 1:K)) / nrow(d); W <- outer(1:K, 1:K, function(i, j) ${w === 'linear' ? '1 - abs(i - j) / (K - 1)' : w === 'quadratic' ? '1 - ((i - j) / (K - 1))^2' : '(i == j) * 1'})\npr <- rowSums(P); pc <- colSums(P); pe <- sum(W * outer(pr, pc)); kap <- (sum(W * P) - pe) / (1 - pe); v1 <- sum(P * (W - outer(drop(W %*% pc), drop(t(W) %*% pr), "+") * (1 - kap))^2)\nee <- sqrt(max(0, (v1 - (kap - pe * (1 - kap))^2) / (nrow(d) * (1 - pe)^2))); c(kappa = kap, EE = ee, IC_inf = kap - qnorm(.975) * ee, IC_sup = kap + qnorm(.975) * ee)\npsych::cohen.kappa(d)  # IC de kappa y kappa ponderada` +
    kaCode;
}
function runAlpha(names, reversed) {
  const sec = nuevaSeccion('Fiabilidad: alfa de Cronbach', { test: 'Alfa de Cronbach' });
  const vars = names.map(vByName).filter(v => v && v.type === 'num');
  if (vars.length < 2) {
    sec.error = 'Selecciona al menos dos ítems cuantitativos.';
    return sec;
  }
  const cols = vars.map(numOf),
    idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null));
  if (idx.length < 3) {
    sec.error = 'Hay muy pocos casos con todos los ítems respondidos.';
    return sec;
  }
  let items = cols.map(c => idx.map(i => c[i]));
  const lo = minOf(items.flat()),
    hi = maxOf(items.flat()),
    rev = vars.map(v => reversed.includes(v.name));
  items = items.map((it, j) => (rev[j] ? it.map(x => lo + hi - x) : it));
  if (items.some(it => S.sd(it) === 0)) {
    sec.error = 'Algún ítem tiene varianza 0 (todas las respuestas iguales). Exclúyelo.';
    return sec;
  }
  const r = S.cronbach(items),
    n = r.n,
    a = r.alpha,
    om = S.omegaTotal(items[0].map((_, i) => items.map(it => it[i]))).omega;
  const dup = [];
  for (let p_ = 0; p_ < items.length; p_++)
    for (let q = p_ + 1; q < items.length; q++)
      if (Math.abs(S.pearson(items[p_], items[q]).r) > 0.9999) dup.push(`${esc(vars[p_].name)} – ${esc(vars[q].name)}`);
  if (dup.length)
    sec.checks.push(
      chk(
        'no',
        `Ítems idénticos (correlación ±1): ${list(dup)}. Probablemente es la misma columna repetida o una calculada a partir de otra; inflan el alfa. Revisa los datos y deja solo una.`
      )
    );
  const qual =
    a >= 0.9
      ? 'excelente'
      : a >= 0.8
        ? 'buena'
        : a >= 0.7
          ? 'aceptable'
          : a >= 0.6
            ? 'cuestionable'
            : a >= 0.5
              ? 'pobre'
              : 'inaceptable';
  sec.decision = `Se calcula el alfa de Cronbach de ${vars.length} ítems con ${n} casos completos${rev.some(Boolean) ? `, invirtiendo ${list(vars.filter((_, j) => rev[j]).map(v => esc(v.name)))}` : ''}.`;
  sec.why.push(
    'El alfa de Cronbach estima la consistencia interna: si los ítems de una escala miden un mismo constructo.'
  );
  sec.why.push('Es el índice de fiabilidad más solicitado en TFM, tesis y artículos al usar cuestionarios.');
  sec.why.push(
    'Criterio orientativo (George y Mallery): ≥ .90 excelente, ≥ .80 bueno, ≥ .70 aceptable, ≥ .60 cuestionable, ≥ .50 pobre.'
  );
  if (rev.some(Boolean))
    sec.why.push(`Los ítems inversos se recodifican como (${lo} + ${hi}) − respuesta antes del cálculo.`);
  const neg = vars.filter((_, j) => r.stats[j].rit < 0),
    low = vars.filter((_, j) => r.stats[j].rit >= 0 && r.stats[j].rit < 0.3);
  const better = vars.filter((_, j) => r.stats[j].alphaDel > a + 0.01);
  if (neg.length)
    sec.warn = `${list(neg.map(v => esc(v.name)))} ${neg.length > 1 ? 'correlacionan' : 'correlaciona'} negativamente con el resto de la escala. Probablemente ${neg.length > 1 ? 'son ítems inversos' : 'es un ítem inverso'}: márcalo en «Ítems inversos» y vuelve a generar el análisis.`;
  sec.checks.push(
    neg.length || low.length
      ? chk(
          'no',
          `Ítems con correlación ítem-total corregida baja (< .30): ${list(neg.concat(low).map(v => esc(v.name)))}.`
        )
      : chk('ok', 'Todos los ítems tienen una correlación ítem-total corregida ≥ .30.')
  );
  if (better.length)
    sec.checks.push(
      chk(
        'info',
        `Eliminar ${list(better.map(v => esc(v.name)))} aumentaría el alfa. Valóralo según el contenido del ítem, no solo por el número.`
      )
    );
  sec.checks.push(
    chk(
      vars.length >= 3 ? 'ok' : 'no',
      `Número de ítems: ${vars.length}.${vars.length < 3 ? ' Con 2 ítems el alfa es poco informativo; considera la correlación de Spearman-Brown.' : ''}`
    )
  );
  sec.checks.push(
    chk(
      'info',
      `El alfa asume que todos los ítems miden un único factor con cargas similares (tau-equivalencia). Por eso se informa también el omega de McDonald (ω = ${nz(om.toFixed(3))}), que no lo exige${Math.abs(om - a) > 0.03 ? '; aquí difieren, así que conviene informar sobre todo el omega' : '; aquí ambos coinciden prácticamente'}.`
    )
  );
  alphaReport({ sec, a, r, om, n, vars, qual, rev, lo, hi });
  return sec;
}

/** Estadísticos por ítem, fiabilidad por mitades, redacción y código R del alfa */
function alphaReport({ sec, a, r, om, n, vars, qual, rev, lo, hi }) {
  sec.tables.push(
    apaTable(
      'Fiabilidad de la escala',
      [
        'α de Cronbach',
        'IC 95 % (α)',
        'α estandarizado',
        'ω de McDonald',
        '<i>r</i> media inter-ítem',
        'Ítems',
        '<i>n</i>',
        '<i>M</i> (total)',
        '<i>DT</i> (total)',
      ],
      [
        [
          nz(a.toFixed(3)),
          `[${nz(r.ci[0].toFixed(3))}, ${nz(r.ci[1].toFixed(3))}]`,
          nz(r.alphaStd.toFixed(3)),
          nz(om.toFixed(3)),
          r2s(r.rbar),
          r.k,
          n,
          f(r.totalMean),
          f(r.totalSd),
        ],
      ],
      'IC del alfa por el método de Feldt (como psych). ω de McDonald (total) estimado con un modelo de un factor por ejes principales.'
    )
  );
  if (r.split) {
    const sp = r.split;
    sec.tables.push(
      apaTable(
        'Fiabilidad de dos mitades',
        ['Mitad', 'Ítems', 'α'],
        [
          ['Primera', `${list(vars.slice(0, sp.k1).map(v => esc(v.name)))}`, nz(sp.alpha1.toFixed(3))],
          [
            'Segunda',
            `${list(vars.slice(sp.k1).map(v => esc(v.name)))}`,
            isFinite(sp.alpha2) ? nz(sp.alpha2.toFixed(3)) : '—',
          ],
        ],
        `Correlación entre las mitades = ${r2s(sp.r)}; Spearman-Brown (longitud igual) = ${nz(sp.sbEq.toFixed(3))}; Spearman-Brown (longitud desigual) = ${nz(sp.sbUneq.toFixed(3))}; coeficiente de Guttman = ${nz(sp.guttman.toFixed(3))}. Mitades en el orden de los ítems, como SPSS.`
      )
    );
  }
  sec.tables.push(
    apaTable(
      'Estadísticos de los ítems',
      ['Ítem', '<i>M</i>', '<i>DT</i>', 'Correlación ítem-total corregida', 'α si se elimina el ítem'],
      vars.map((v, j) => [
        esc(v.name) + (rev[j] ? ' (invertido)' : ''),
        f(r.stats[j].mean),
        f(r.stats[j].sd),
        r2s(r.stats[j].rit),
        isFinite(r.stats[j].alphaDel) ? nz(r.stats[j].alphaDel.toFixed(3)) : '—',
      ])
    )
  );
  let t = `La consistencia interna de la escala formada por ${vars.length} ítems fue ${qual}, α = ${nz(a.toFixed(2))}, IC 95 % [${nz(r.ci[0].toFixed(2))}, ${nz(r.ci[1].toFixed(2))}], ω = ${nz(om.toFixed(2))} (<i>n</i> = ${n}).`;
  t += ` Las correlaciones ítem-total corregidas oscilaron entre ${r2s(minOf(r.stats.map(s => s.rit)))} y ${r2s(maxOf(r.stats.map(s => s.rit)))}.`;
  if (rev.some(Boolean))
    t += ` ${list(vars.filter((_, j) => rev[j]).map(v => esc(v.name)))} se ${rev.filter(Boolean).length > 1 ? 'recodificaron' : 'recodificó'} de forma inversa antes del análisis.`;
  sec.text.push(t);
  const keys = vars.filter((_, j) => rev[j]).map(v => rq(v.name));
  sec.code =
    `# Fiabilidad (alfa de Cronbach y omega de McDonald)\npsych::alpha(datos[, c(${vars.map(v => rq(v.name)).join(', ')})]${keys.length ? `, keys = c(${keys.join(', ')})` : ''})\n` +
    `it <- datos[complete.cases(datos[, c(${vars.map(v => rq(v.name)).join(', ')})]), c(${vars.map(v => rq(v.name)).join(', ')})]\n` +
    (keys.length ? `for (k in c(${keys.join(', ')})) it[[k]] <- ${lo} + ${hi} - it[[k]]  # ítems inversos\n` : '') +
    `l <- as.numeric(psych::fa(it, nfactors = 1, fm = "pa")$loadings); l <- l * sign(sum(l))\nsum(l)^2 / (sum(l)^2 + sum(1 - l^2))  # omega total\npsych::alpha.ci(psych::alpha(it, warnings = FALSE)$total$raw_alpha, nrow(it), ncol(it))  # IC de Feldt\ntotal <- rowSums(it); c(M_total = mean(total), DT_total = sd(total))` +
    (r.split
      ? `\nh1 <- rowSums(it[, 1:${r.split.k1}]); h2 <- rowSums(it[, -(1:${r.split.k1})]); r <- cor(h1, h2)\nc(r = r, spearman_brown = 2 * r / (1 + r), guttman = 2 * (1 - (var(h1) + var(h2)) / var(h1 + h2)))  # dos mitades\nc(alfa_mitad1 = psych::alpha(it[, 1:${r.split.k1}], warnings = FALSE)$total$raw_alpha, alfa_mitad2 = psych::alpha(it[, -(1:${r.split.k1})], warnings = FALSE)$total$raw_alpha)`
      : '');
}

export { runAgree, runAlpha };
