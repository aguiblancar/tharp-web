/* Tharp · aplicación · Análisis: Regresión logística binaria, multinomial y ordinal */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { catOf, levelsOf, ordOf, vByName } from '../datos/variables.js';
import { f, list, nz, pt, pv, rn, rq } from '../formato.js';
import { apaTable, chk, design, fig, nuevaSeccion } from '../resultados/piezas.js';
import { maxOf } from '../utilidades.js';

// Regresión logística multinomial u ordinal (variable dependiente con 3 o más categorías)
function runPolyLogit(yName, xNames, model) {
  const sec = nuevaSeccion(`Regresión logística: ${yName}`);
  xNames = xNames.filter(n => n !== yName);
  if (!xNames.length) {
    sec.error = 'Selecciona al menos un predictor distinto de la variable dependiente.';
    return sec;
  }
  const yv = vByName(yName),
    ycat = catOf(yv);
  const { idx, cols, X } = design(xNames, i => ycat[i] !== null);
  const lv = ordOf(
      yv,
      idx.map(i => ycat[i])
    ),
    K = lv.length,
    y = idx.map(i => lv.indexOf(ycat[i])),
    n = idx.length;
  if (K < 3) {
    sec.error =
      'La variable dependiente necesita al menos 3 categorías con datos (con 2, usa la regresión logística binaria).';
    return sec;
  }
  const ordered =
    model === 'ordinal' ||
    (model === 'auto' &&
      !!(yv.order && (yv.orderUser || yv.orderNote || (yv.hint && /ordinal/i.test(yv.hint.note || '')))));
  const ORD = ordered,
    p = cols.length,
    cnt = lv.map((_, k) => y.filter(v => v === k).length);
  if (cnt.some(c => c < 2)) {
    sec.error = `Alguna categoría tiene menos de 2 casos (${lv.map((l, k) => `${esc(l)}: ${cnt[k]}`).join(', ')}). Agrupa categorías en «Preparar los datos».`;
    return sec;
  }
  const fit = cs => {
    const Xs = X.map(r => cs.map(j => r[j]));
    return ORD
      ? S.ordinalLogit(
          Xs.map(r => r.slice(1)),
          y,
          K
        )
      : S.multinomial(Xs, y, K);
  };
  const all = cols.map((_, j) => j),
    m = fit(all);
  if (!m || !isFinite(m.ll)) {
    sec.error =
      'El modelo no converge (separación perfecta o colinealidad entre predictores). Reduce los predictores o agrupa categorías.';
    return sec;
  }
  sec.test = ORD ? 'Regresión logística ordinal (odds proporcionales)' : 'Regresión logística multinomial';
  const pr = S.pseudoR2(m.ll, m.ll0, n),
    dfM = ORD ? p - 1 : (K - 1) * (p - 1),
    LR = 2 * (m.ll - m.ll0),
    pLR = 1 - jStat.chisquare.cdf(LR, dfM);
  const nPar = ORD ? K - 1 + (p - 1) : (K - 1) * p,
    aic = -2 * m.ll + 2 * nPar;
  sec.why.push(`Variable dependiente: ${esc(yName)} con ${K} categorías (${list(lv.map(esc))}).`);
  sec.why.push(
    ORD
      ? `Las categorías están ordenadas (${lv.map(esc).join(' < ')}), así que se usa el modelo de odds proporcionales: un único coeficiente por predictor que indica si aumenta la probabilidad de estar en categorías más altas. Comprueba que el orden es el correcto (botón «Orden» en Variables).`
      : `Las categorías no tienen un orden natural, así que se usa la regresión multinomial: cada categoría se compara con la de referencia («${esc(lv[0])}»), con sus propios coeficientes.`
  );
  sec.decision = `Se ajustó una regresión logística ${ORD ? 'ordinal de odds proporcionales' : 'multinomial'} de ${esc(yName)} con ${n} casos completos.`;
  sec.alt = ORD
    ? 'Si no se cumple el supuesto de odds proporcionales, la regresión multinomial (ignora el orden) o un modelo ordinal parcialmente proporcional.'
    : 'Si las categorías tienen orden, la regresión ordinal es más parsimoniosa y potente.';
  // contrastes de razón de verosimilitudes de cada predictor (modelo sin ese término)
  const lrt = xNames.map(t => {
    const keep = all.filter(j => j === 0 || cols[j].v.name !== t),
      r = fit(keep),
      dfT = (ORD ? 1 : K - 1) * (all.length - keep.length),
      ch = 2 * (m.ll - r.ll);
    return { t, ch, df: dfT, p: 1 - jStat.chisquare.cdf(ch, dfT) };
  });
  polyLogitModelTables({ sec, m, LR, dfM, pLR, pr, aic, lrt });
  const { z } = polyLogitCoefficients({ ORD, sec, cols, m, xNames, X, y, K, lv });
  const { corr } = polyLogitClassification({ y, sec, lv, n, nPar, m, cnt });
  polyLogitReport({ lrt, sec, ORD, lv, yName, xNames, pLR, dfM, n, LR, pr, corr, cols, m, z });
  return sec;
}
/** Tablas de ajuste global y de razón de verosimilitudes de cada predictor */
function polyLogitModelTables({ sec, m, LR, dfM, pLR, pr, aic, lrt }) {
  sec.tables.push(
    apaTable(
      'Ajuste del modelo',
      [
        '−2LL (nulo)',
        '−2LL (modelo)',
        'χ²',
        '<i>gl</i>',
        '<i>p</i>',
        '<i>R</i>² McFadden',
        '<i>R</i>² Cox-Snell',
        '<i>R</i>² Nagelkerke',
        'AIC',
      ],
      [
        [
          f(-2 * m.ll0),
          f(-2 * m.ll),
          f(LR),
          dfM,
          pv(pLR),
          nz(pr.mcfadden.toFixed(3)),
          nz(pr.coxsnell.toFixed(3)),
          nz(pr.nagelkerke.toFixed(3)),
          f(aic),
        ],
      ],
      'χ² = razón de verosimilitudes frente al modelo sin predictores.'
    )
  );
  sec.tables.push(
    apaTable(
      'Contrastes de razón de verosimilitudes de cada predictor',
      ['Predictor', 'χ²', '<i>gl</i>', '<i>p</i>'],
      lrt.map(o => [esc(o.t), f(o.ch), o.df, pv(o.p)]),
      'Compara el modelo completo con el modelo sin ese predictor (como SPSS).'
    )
  );
}
/** Coeficientes con OR e IC (umbrales y prueba de Brant si es ordinal; por categoría si es multinomial) */
function polyLogitCoefficients({ ORD, sec, cols, m, xNames, X, y, K, lv }) {
  const z = 1.959963984540054,
    orRow = (lab, b, se) => {
      const zz = b / se;
      return [
        lab,
        f(b, 3),
        f(se, 3),
        f(zz),
        pv(2 * (1 - jStat.normal.cdf(Math.abs(zz), 0, 1))),
        f(Math.exp(b)),
        `[${f(Math.exp(b - z * se))}, ${f(Math.exp(b + z * se))}]`,
      ];
    };
  if (ORD) {
    sec.tables.push(
      apaTable(
        'Coeficientes de la regresión ordinal',
        ['Término', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'OR', 'IC 95 % (OR)'],
        cols.slice(1).map((c, j) => orRow(esc(c.name), m.beta[j], m.seBeta[j])),
        'OR > 1: más probabilidad de estar en categorías más altas. Signo como en SPSS y polr (logit P(Y ≤ j) = θ<sub>j</sub> − <i>x</i>β).'
      )
    );
    sec.tables.push(
      apaTable(
        'Umbrales',
        ['Umbral', 'θ', '<i>EE</i>'],
        m.theta.map((t, j) => [`${esc(lv[j])} | ${esc(lv[j + 1])}`, f(t, 3), f(m.seTheta[j], 3)])
      )
    );
    const grp = xNames.map(t =>
        cols
          .slice(1)
          .map((c, j) => (c.v.name === t ? j : -1))
          .filter(j => j >= 0)
      ),
      bt = S.brantTest(
        X.map(r => r.slice(1)),
        y,
        K,
        grp
      );
    if (bt && isFinite(bt.omnibus.chi)) {
      sec.tables.push(
        apaTable(
          'Prueba de Brant del supuesto de odds proporcionales',
          ['', 'χ²', '<i>gl</i>', '<i>p</i>'],
          [['Global', f(bt.omnibus.chi), bt.omnibus.df, pv(bt.omnibus.p)]].concat(
            xNames.map((t, q) => [esc(t), f(bt.byVar[q].chi), bt.byVar[q].df, pv(bt.byVar[q].p)])
          ),
          'Un resultado significativo indica que el efecto de ese predictor cambia entre los cortes de la variable dependiente (no se cumplen las odds proporcionales). Brant (1990).'
        )
      );
      const bad = xNames.filter((_, q) => bt.byVar[q].p < 0.05);
      sec.checks.push(
        chk(
          bt.omnibus.p >= 0.05 && !bad.length ? 'ok' : 'no',
          `Odds proporcionales (prueba de Brant): χ²(${bt.omnibus.df}) = ${f(bt.omnibus.chi)}, ${pt(bt.omnibus.p)}.${bt.omnibus.p >= 0.05 && !bad.length ? ' Se cumple.' : ` No se cumple${bad.length ? ` (${list(bad.map(esc))})` : ''}: considera la regresión multinomial o un modelo ordinal parcialmente proporcional.`}`
        )
      );
    } else
      sec.checks.push(
        chk(
          'info',
          'No se pudo calcular la prueba de Brant (algún corte tiene muy pocos casos). Revisa el supuesto de odds proporcionales con la regresión multinomial.'
        )
      );
  } else {
    const rows = [];
    m.B.forEach((bk, k) =>
      bk.forEach((b, j) =>
        rows.push(
          orRow(
            j === 0
              ? `<b>${esc(lv[k + 1])}</b> vs. ${esc(lv[0])}: ${esc(cols[j].name)}`
              : `&nbsp;&nbsp;&nbsp;${esc(cols[j].name)}`,
            b,
            m.SE[k][j]
          )
        )
      )
    );
    sec.tables.push(
      apaTable(
        `Coeficientes de la regresión multinomial (referencia: ${lv[0]})`,
        ['Término', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'OR', 'IC 95 % (OR)'],
        rows,
        'OR = odds ratio de pertenecer a esa categoría frente a la de referencia. Contrastes de Wald.'
      )
    );
  }
  return { z };
}
/** Tabla de clasificación y aviso de tamaño muestral de la logística multinomial u ordinal */
function polyLogitClassification({ y, sec, lv, n, nPar, m, cnt }) {
  const corr = y.filter((v, i) => v === m.pred[i]).length;
  sec.tables.push(
    apaTable(
      'Tabla de clasificación',
      ['Observado'].concat(lv.map(l => `Predicho: ${esc(l)}`)).concat(['% correcto']),
      lv.map((l, k) =>
        [esc(l)]
          .concat(lv.map((_, q) => y.filter((v, i) => v === k && m.pred[i] === q).length))
          .concat([f((y.filter((v, i) => v === k && m.pred[i] === k).length / cnt[k]) * 100, 1)])
      ),
      `Porcentaje global correcto: ${f((corr / n) * 100, 1)} % (asignando cada caso a la categoría más probable).`
    )
  );
  if (n < 10 * nPar)
    sec.checks.push(
      chk(
        'no',
        `Tamaño muestral: ${n} casos para ${nPar} parámetros. Se recomiendan al menos 10 casos por parámetro: los coeficientes pueden ser inestables.`
      )
    );
  return { corr };
}
/** Redacción APA y código R de la logística multinomial u ordinal */
function polyLogitReport({ lrt, sec, ORD, lv, yName, xNames, pLR, dfM, n, LR, pr, corr, cols, m, z }) {
  const sigT = lrt.filter(o => o.p < 0.05);
  sec.text.push(
    `Se realizó una regresión logística ${ORD ? 'ordinal de odds proporcionales' : `multinomial (categoría de referencia: ${esc(lv[0])})`} para predecir ${esc(yName)} a partir de ${list(xNames.map(esc))}. El modelo ${pLR < 0.05 ? 'fue' : 'no fue'} estadísticamente significativo frente al modelo nulo, χ²(${dfM}, <i>N</i> = ${n}) = ${f(LR)}, ${pt(pLR)}, <i>R</i>² de Nagelkerke = ${nz(pr.nagelkerke.toFixed(2))}, y clasificó correctamente al ${f((corr / n) * 100, 1)} % de los casos. ` +
      (sigT.length
        ? `${list(sigT.map(o => esc(o.t)))} ${sigT.length > 1 ? 'contribuyeron' : 'contribuyó'} significativamente al modelo (${sigT.map(o => `${esc(o.t)}: χ²(${o.df}) = ${f(o.ch)}, ${pt(o.p)}`).join('; ')}).`
        : 'Ningún predictor contribuyó significativamente al modelo.') +
      (ORD
        ? ' ' +
          cols
            .slice(1)
            .map((c, j) => {
              const b = m.beta[j],
                se = m.seBeta[j],
                pp = 2 * (1 - jStat.normal.cdf(Math.abs(b / se), 0, 1));
              return pp < 0.05
                ? `${esc(c.name)} se asoció con una ${b > 0 ? 'mayor' : 'menor'} probabilidad de categorías más altas (OR = ${f(Math.exp(b))}, IC 95 % [${f(Math.exp(b - z * se))}, ${f(Math.exp(b + z * se))}], ${pt(pp)}).`
                : '';
            })
            .filter(Boolean)
            .join(' ')
        : '')
  );
  const fml = `${xNames.map(rn).join(' + ')}`,
    Yf = `factor(datos[[${rq(yName)}]], levels = c(${lv.map(rq).join(', ')})${ORD ? ', ordered = TRUE' : ''})`;
  sec.code =
    `# Regresión logística ${ORD ? 'ordinal' : 'multinomial'}: ${yName}\nd <- datos; d$.y <- ${Yf}\nd <- d[complete.cases(d[, c(".y", ${xNames.map(rq).join(', ')})]), ]\n` +
    (ORD
      ? `modelo <- MASS::polr(.y ~ ${fml}, data = d, Hess = TRUE)\nsummary(modelo)\nct <- coef(summary(modelo)); cbind(ct, p = 2 * pnorm(-abs(ct[, "t value"])))  # p de Wald\nexp(cbind(OR = coef(modelo), confint.default(modelo)[names(coef(modelo)), ]))\ncar::Anova(modelo, type = 3)  # razón de verosimilitudes de cada predictor\n` +
        '# Prueba de Brant como Tharp: regresiones logísticas binarias por corte y su covarianza conjunta.\n# (El paquete brant no traspone los bloques de covarianza entre cortes: con varios predictores su χ² difiere.)\nbrant_tharp <- function(modelo, d) {\n  mm <- model.matrix(modelo); X <- mm[, colnames(mm) != "(Intercept)", drop = FALSE]; y <- as.integer(d$.y) - 1; J <- nlevels(d$.y) - 1\n  Xc <- cbind(1, X); p <- ncol(X); asg <- attr(mm, "assign")[colnames(mm) != "(Intercept)"]\n  ajustes <- lapply(1:J, function(j) glm.fit(Xc, as.numeric(y > j - 1), family = binomial(), control = list(epsilon = 1e-14, maxit = 100)))\n  pis <- lapply(ajustes, fitted); fits <- lapply(ajustes, coef)\n  XWX <- function(w) t(Xc) %*% (Xc * w); Inv <- lapply(pis, function(pi) solve(XWX(pi * (1 - pi)))); V <- matrix(0, J * p, J * p)\n  for (a in 1:J) for (b in a:J) { w <- if (a == b) pis[[a]] * (1 - pis[[a]]) else pis[[b]] - pis[[a]] * pis[[b]]\n    blk <- (Inv[[a]] %*% XWX(w) %*% Inv[[b]])[-1, -1, drop = FALSE]; ia <- (a - 1) * p + 1:p; ib <- (b - 1) * p + 1:p; V[ia, ib] <- blk; V[ib, ia] <- t(blk) }\n  beta <- unlist(lapply(fits, function(f) f[-1]))\n  prueba <- function(vars) { D <- do.call(rbind, lapply(2:J, function(j) t(sapply(vars, function(v) { r <- numeric(J * p); r[v] <- 1; r[(j - 1) * p + v] <- -1; r }))))\n    Db <- D %*% beta; chi <- drop(t(Db) %*% solve(D %*% V %*% t(D)) %*% Db); c(chi2 = chi, gl = nrow(D), p = pchisq(chi, nrow(D), lower.tail = FALSE)) }\n  rbind(Global = prueba(1:p), t(sapply(split(seq_len(p), attr(terms(modelo), "term.labels")[asg]), prueba)))\n}\nprint(brant_tharp(modelo, d), digits = 7)\n'
      : `modelo <- nnet::multinom(.y ~ ${fml}, data = d, trace = FALSE)\nsummary(modelo)\nB <- coef(modelo); EE <- summary(modelo)$standard.errors; z <- B / EE\nprint(list(B = B, EE = EE, z = z, p = 2 * pnorm(-abs(z)), OR = exp(B), OR_inf = exp(B - qnorm(.975) * EE), OR_sup = exp(B + qnorm(.975) * EE)), digits = 7)  # coeficientes, Wald y odds ratios\ncar::Anova(modelo, type = 3)  # razón de verosimilitudes de cada predictor\n`) +
    `nulo <- update(modelo, . ~ 1); chi2 <- deviance(nulo) - deviance(modelo); gl <- modelo$edf - nulo$edf\nc(m2LL_nulo = deviance(nulo), m2LL_modelo = deviance(modelo), chi2 = chi2, gl = gl, p = pchisq(chi2, gl, lower.tail = FALSE), R2_McFadden = 1 - deviance(modelo) / deviance(nulo),\n  R2_CoxSnell = 1 - exp(-chi2 / nrow(d)), R2_Nagelkerke = (1 - exp(-chi2 / nrow(d))) / (1 - exp(-deviance(nulo) / nrow(d))), AIC = AIC(modelo))  # ajuste frente al modelo nulo\nperformance::r2_nagelkerke(modelo)\ntable(observado = d$.y, predicho = predict(modelo))`;
}
function runLogistic(yName, xNames) {
  const sec = nuevaSeccion(`Regresión logística: ${yName}`, { test: 'Regresión logística binaria' });
  xNames = xNames.filter(n => n !== yName);
  if (!xNames.length) {
    sec.error = 'Selecciona al menos un predictor distinto de la variable dependiente.';
    return sec;
  }
  const yv = vByName(yName),
    lv = levelsOf(yv);
  if (lv.length !== 2) {
    sec.error = `La variable dependiente debe tener exactamente 2 categorías (tiene ${lv.length}).`;
    return sec;
  }
  const ycat = catOf(yv),
    { idx, cols, X } = design(xNames, i => ycat[i] !== null),
    y = idx.map(i => (ycat[i] === lv[1] ? 1 : 0)),
    n = idx.length,
    p = cols.length;
  if (n < p + 2) {
    sec.error = `Hay pocos casos completos (${n}) para estimar ${p} coeficientes (las variables categóricas cuentan una vez por cada categoría distinta de la de referencia).`;
    return sec;
  }
  const m = S.logistic(X, y);
  if (!m) {
    sec.error = 'Hay colinealidad perfecta entre los predictores. Elimina alguno.';
    return sec;
  }
  const ev = Math.min(m.events, n - m.events),
    epv = ev / (p - 1),
    multi = p > 2,
    ev1 = esc(lv[1]),
    ev0 = esc(lv[0]);
  sec.decision = `Se ajustó una regresión logística binaria para predecir ${esc(yName)} = «${ev1}» (frente a «${ev0}») con ${n} casos completos.`;
  sec.why.push(
    `Variable dependiente: ${esc(yName)} → dicotómica (${ev0} / ${ev1}). Se modeliza la probabilidad de «${ev1}».`
  );
  sec.why.push(
    'Con una variable dependiente dicotómica no se puede usar regresión lineal: la logística modeliza la probabilidad entre 0 y 1.'
  );
  sec.why.push(
    'Los efectos se expresan como odds ratios (OR): OR > 1 aumenta la probabilidad del suceso; OR < 1 la reduce.'
  );
  logisticChecks({ sec, epv, ev, p, m, multi, ev1, ev0, X });
  sec.alt =
    'Regresión de Firth si hay separación o pocos sucesos; regresión multinomial si la variable dependiente tiene más de dos categorías.';
  logisticTables({ sec, m, n, yName, lv, cols, ev0, ev1 });
  logisticReport({ cols, yName, ev1, xNames, m, n, sec, lv, multi });
  return sec;
}
/** Supuestos de la logística binaria: eventos por predictor, separación, Hosmer-Lemeshow, colinealidad y clasificación */
function logisticChecks({ sec, epv, ev, p, m, multi, ev1, ev0, X }) {
  sec.checks.push(
    chk(
      epv >= 10 ? 'ok' : 'no',
      `Sucesos por predictor: ${f(epv, 1)} (${ev} casos en la categoría menos frecuente para ${p - 1} coeficientes).${epv >= 10 ? ' Se cumple el criterio orientativo de ≥ 10.' : ' Por debajo de 10: el modelo puede ser inestable; reduce predictores.'}`
    )
  );
  if (m.separation)
    sec.warn =
      'Posible separación completa o casi completa: algún predictor clasifica los casos casi perfectamente y los coeficientes no son fiables. Consulta a un estadístico antes de continuar (puede necesitarse regresión de Firth).';
  if (!(m.hl.df >= 1))
    sec.checks.push(
      chk(
        'info',
        `Bondad de ajuste (Hosmer-Lemeshow): no se puede calcular, porque el modelo solo predice ${m.hl.groups} probabilidades distintas y la prueba necesita al menos 3 grupos de riesgo. Es habitual con un único predictor categórico.`
      )
    );
  else
    sec.checks.push(
      chk(
        m.hl.p >= 0.05 ? 'ok' : 'no',
        `Bondad de ajuste (Hosmer-Lemeshow): χ²(${m.hl.df}) = ${f(m.hl.chi)}, ${pt(m.hl.p)}. ${m.hl.p >= 0.05 ? 'El modelo ajusta adecuadamente.' : 'Indica falta de ajuste.'}`
      )
    );
  if (multi) {
    const vif = S.ols(
        X,
        X.map((_, i) => i)
      ).vif,
      maxV = maxOf(vif.slice(1));
    sec.checks.push(
      chk(
        maxV < 5 ? 'ok' : 'no',
        `Multicolinealidad: VIF máximo = ${f(maxV)}.${maxV < 5 ? ' Sin problemas.' : ' Revisa los predictores correlacionados.'}`
      )
    );
  }
  const sens = m.tab[1][1] / (m.tab[1][0] + m.tab[1][1]),
    spec = m.tab[0][0] / (m.tab[0][0] + m.tab[0][1]);
  if (Math.min(sens, spec) < 0.2)
    sec.checks.push(
      chk(
        'no',
        `Clasificación desequilibrada: el modelo solo identifica correctamente al ${f(Math.min(sens, spec) * 100, 1)} % de los casos «${sens < spec ? ev1 : ev0}». El % correcto global (${f(m.acc * 100, 1)} %) refleja sobre todo la categoría mayoritaria: no lo presentes como capacidad predictiva.`
      )
    );
  sec.checks.push(
    chk(
      'info',
      'Linealidad del logit: se asume una relación lineal entre cada predictor continuo y el logaritmo de las odds (puede comprobarse con la prueba de Box-Tidwell).'
    )
  );
}
/** Tablas de la logística binaria: ajuste del modelo, coeficientes con OR e IC y clasificación */
function logisticTables({ sec, m, n, yName, lv, cols, ev0, ev1 }) {
  sec.tables.push(
    apaTable(
      'Resumen del modelo de regresión logística',
      [
        'χ²',
        '<i>gl</i>',
        '<i>p</i>',
        '−2LL',
        '<i>R</i>² de Cox y Snell',
        '<i>R</i>² de Nagelkerke',
        '% correcto',
        '<i>n</i>',
      ],
      [[f(m.LR), m.df, pv(m.pLR), f(m.dev), nz(m.cs.toFixed(3)), nz(m.nag.toFixed(3)), f(m.acc * 100, 1), n]],
      'χ² = prueba de razón de verosimilitud frente al modelo nulo. Clasificación con punto de corte .50.'
    )
  );
  sec.tables.push(
    apaTable(
      `Coeficientes del modelo para ${yName} = «${lv[1]}»`,
      ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'OR', 'IC 95 % (OR)'],
      cols.map((c, j) => [
        esc(c.name),
        f(m.b[j], 3),
        f(m.se[j], 3),
        f(m.z[j]),
        pv(m.p[j]),
        j ? f(m.or[j]) : '',
        j ? `[${f(m.ci[j][0])}, ${f(m.ci[j][1])}]` : '',
      ]),
      'OR = odds ratio. IC de Wald.'
    )
  );
  sec.tables.push(
    apaTable(
      'Tabla de clasificación',
      ['Observado', `Predicho: ${ev0}`, `Predicho: ${ev1}`, '% correcto'],
      [
        [ev0, m.tab[0][0], m.tab[0][1], f((m.tab[0][0] / (m.tab[0][0] + m.tab[0][1])) * 100, 1)],
        [ev1, m.tab[1][0], m.tab[1][1], f((m.tab[1][1] / (m.tab[1][0] + m.tab[1][1])) * 100, 1)],
        ['Global', '', '', f(m.acc * 100, 1)],
      ]
    )
  );
}
/** Redacción APA, figura de probabilidades predichas y código R de la logística binaria */
function logisticReport({ cols, yName, ev1, xNames, m, n, sec, lv, multi }) {
  const sig = cols.map((c, j) => ({ c, j })).filter(o => o.j > 0 && m.p[o.j] < 0.05);
  let t = `Se realizó una regresión logística binaria para predecir la probabilidad de ${esc(yName)} = «${ev1}» a partir de ${list(xNames.map(esc))}. El modelo ${m.pLR < 0.05 ? '' : 'no '}fue estadísticamente significativo, χ²(${m.df}, <i>N</i> = ${n}) = ${f(m.LR)}, ${pt(m.pLR)}, con un <i>R</i>² de Cox y Snell de ${nz(m.cs.toFixed(3))} y un <i>R</i>² de Nagelkerke de ${nz(m.nag.toFixed(3))}, y clasificó correctamente al ${f(m.acc * 100, 1)} % de los casos. `;
  if (sig.length)
    t +=
      list(
        sig.map(
          o =>
            `${esc(o.c.name)} se asoció con una ${m.b[o.j] > 0 ? 'mayor' : 'menor'} probabilidad de «${ev1}» (OR = ${f(m.or[o.j])}, IC 95 % [${f(m.ci[o.j][0])}, ${f(m.ci[o.j][1])}], ${pt(m.p[o.j])})`
        )
      ) + '. ';
  const ns = cols.filter((c, j) => j > 0 && m.p[j] >= 0.05).map(c => esc(c.name));
  if (ns.length)
    t += `${list(ns)} no ${ns.length > 1 ? 'fueron predictores significativos' : 'fue un predictor significativo'}.`;
  sec.text.push(t);
  sec.charts.push(
    fig(
      'Odds ratios e IC 95 %',
      CH.forest(
        cols.slice(1).map(c => c.name),
        m.or.slice(1),
        m.ci.slice(1)
      )
    )
  );
  sec.code =
    `# Regresión logística: ${yName} (suceso = "${lv[1]}")\nmodelo <- glm(${rn(yName)} ~ ${xNames.map(rn).join(' + ')}, data = datos, family = binomial)\nsummary(modelo)\nchi2 <- modelo$null.deviance - modelo$deviance; gl <- modelo$df.null - modelo$df.residual\nc(chi2 = chi2, gl = gl, p = pchisq(chi2, gl, lower.tail = FALSE))  # modelo frente al nulo\nexp(cbind(OR = coef(modelo), confint.default(modelo)))\nperformance::r2_coxsnell(modelo); performance::r2_nagelkerke(modelo)\n# Hosmer-Lemeshow: grupos por los deciles de la probabilidad predicha (como ResourceSelection::hoslem.test)\nprob <- fitted(modelo); yobs <- modelo$y\nG <- ${Math.min(10, Math.floor(n / 5))}; grupos <- cut(prob, unique(quantile(prob, (0:G) / G)), include.lowest = TRUE)\nobs <- xtabs(cbind(1 - yobs, yobs) ~ grupos); esp <- xtabs(cbind(1 - prob, prob) ~ grupos)\nhl <- sum((obs - esp)^2 / esp); c(chi2 = hl, gl = nlevels(grupos) - 2, p = pchisq(hl, nlevels(grupos) - 2, lower.tail = FALSE))` +
    (multi ? '\ncar::vif(modelo)' : '');
}

export { runPolyLogit, runLogistic };
