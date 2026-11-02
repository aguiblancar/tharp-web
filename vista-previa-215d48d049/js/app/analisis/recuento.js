/* Tharp · aplicación · Análisis: Regresión de Poisson y binomial negativa */
import S from '../../motor/index.js';
import { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { f, list, pt, pv, rn, rq } from '../formato.js';
import { apaTable, chk, design, nuevaSeccion } from '../resultados/piezas.js';

// Regresión para recuentos: Poisson o binomial negativa (enlace log), con exposición opcional (offset = log de la exposición)
function runCount(yName, xNames, fam, offName) {
  const sec = nuevaSeccion(`Regresión para recuentos: ${yName || ''}`);
  const J_chi = (x, df) => jStat.chisquare.cdf(x, df);
  xNames = xNames.filter(n => n !== yName && n !== offName);
  if (!yName || !vByName(yName)) {
    sec.error = 'Elige la variable dependiente (un recuento).';
    return sec;
  }
  if (!xNames.length) {
    sec.error = 'Selecciona al menos un predictor distinto de la variable dependiente.';
    return sec;
  }
  const yv = numOf(vByName(yName)),
    ov = offName ? numOf(vByName(offName)) : null;
  const { idx, cols, X } = design(xNames, i => yv[i] !== null && (!ov || (ov[i] !== null && ov[i] > 0))),
    y = idx.map(i => yv[i]),
    n = idx.length,
    p = cols.length;
  if (y.some(v => v < 0 || !Number.isInteger(v))) {
    sec.error = `${yName} no es un recuento: debe tomar valores enteros iguales o mayores que 0.`;
    return sec;
  }
  if (n < p + 5) {
    sec.error = `Hay pocos casos completos (${n}) para estimar ${p} coeficientes.`;
    return sec;
  }
  const off = ov ? idx.map(i => Math.log(ov[i])) : null;
  const mp = S.countReg(X, y, 'poisson', off);
  if (!mp) {
    sec.error = 'No se pudo estimar el modelo (colinealidad perfecta entre los predictores).';
    return sec;
  }
  const mn = S.countReg(X, y, 'negbin', off),
    lrNB = mn && !mn.poissonLimit ? Math.max(0, 2 * (mn.ll - mp.ll)) : 0,
    pNB = 0.5 * (1 - J_chi(lrNB, 1));
  const useNB = fam === 'negbin' || (fam === 'auto' && mn && !mn.poissonLimit && pNB < 0.05),
    m = useNB && mn && !mn.poissonLimit ? mn : mp,
    NB = m === mn;
  const nul = S.countReg(
      X.map(() => [1]),
      y,
      NB ? 'negbin' : 'poisson',
      off
    ),
    lr = Math.max(0, 2 * (m.ll - nul.ll)),
    dfm = p - 1,
    pLR = 1 - J_chi(lr, dfm);
  const MN = NB ? 'binomial negativa' : 'de Poisson';
  sec.test = `Regresión ${MN}`;
  sec.decision = `Se ajustó una regresión ${MN} (enlace logarítmico) para ${esc(yName)} con ${n} casos completos${offName ? `, con ${esc(offName)} como exposición` : ''}.`;
  countWhyAndChecks({ sec, yName, fam, mn, pNB, lrNB, MN, mp, NB, y, m });
  countTables({ sec, NB, n, m, lr, dfm, pLR, MN, cols, offName });
  countReport({ cols, sec, MN, yName, offName, xNames, n, pLR, dfm, lr, NB, m });
  return sec;
}
/** Motivos de la elección de Poisson o binomial negativa y supuestos (sobredispersión, ceros, tamaño muestral) */
function countWhyAndChecks({ sec, yName, fam, mn, pNB, lrNB, MN, mp, NB, y, m }) {
  sec.why.push(
    `${esc(yName)} es un recuento (números enteros ≥ 0): los modelos para recuentos respetan que no puede ser negativo y que su variabilidad crece con la media. Los coeficientes se interpretan como razones de tasas (IRR): cuántas veces cambia el recuento esperado por cada unidad del predictor.`
  );
  if (fam === 'auto')
    sec.why.push(
      mn && !mn.poissonLimit
        ? `Sobredispersión: la binomial negativa ${pNB < 0.05 ? 'mejora' : 'no mejora'} significativamente a la de Poisson (razón de verosimilitudes, χ² = ${f(lrNB)}, ${pt(pNB)}; θ en el límite del espacio, por eso p = ½·P(χ²₁ > χ²)), así que se usa la regresión ${MN}.`
        : 'No hay sobredispersión (la binomial negativa coincide con la de Poisson: θ tiende a infinito), así que se usa la regresión de Poisson.'
    );
  else if (fam === 'negbin' && (!mn || mn.poissonLimit))
    sec.checks.push(
      chk(
        'info',
        'Has elegido la binomial negativa, pero los datos no tienen sobredispersión (θ tiende a infinito): equivale a la regresión de Poisson, que es la que se muestra.'
      )
    );
  sec.checks.push(
    chk(
      mp.dispersion <= 1.5 ? 'ok' : NB ? 'info' : 'no',
      `Dispersión del modelo de Poisson (χ² de Pearson / gl) = ${f(mp.dispersion)}${mp.dispersion <= 1.5 ? ': sin sobredispersión relevante.' : NB ? ': hay sobredispersión, por eso se usa la binomial negativa.' : ': hay sobredispersión; los errores típicos de Poisson pueden ser demasiado pequeños (valora la binomial negativa).'}`
    )
  );
  const z0 = y.filter(v => v === 0).length,
    e0 = S.sum(m.mu.map(u => (NB ? Math.pow(m.theta / (m.theta + u), m.theta) : Math.exp(-u))));
  sec.checks.push(
    chk(
      z0 <= 1.5 * e0 + 2 ? 'ok' : 'info',
      `Ceros observados: ${z0}; esperados según el modelo: ${f(e0, 1)}.${z0 > 1.5 * e0 + 2 ? ' Hay más ceros de los esperados: podría convenir un modelo con exceso de ceros (en R, pscl::zeroinfl o hurdle).' : ''}`
    )
  );
}
/** Tablas de ajuste y de coeficientes con razones de tasas (IRR) e IC */
function countTables({ sec, NB, n, m, lr, dfm, pLR, MN, cols, offName }) {
  sec.tables.push(
    apaTable(
      'Ajuste del modelo',
      ['<i>n</i>', 'Log-verosimilitud', 'Desvianza', 'AIC', 'χ² (frente al nulo)', '<i>gl</i>', '<i>p</i>'].concat(
        NB ? ['θ', 'EE (θ)'] : []
      ),
      [[n, f(m.ll), f(m.dev), f(m.aic), f(lr), dfm, pv(pLR)].concat(NB ? [f(m.theta, 3), f(m.thetaSE, 3)] : [])],
      `χ² = razón de verosimilitudes frente al modelo solo con la constante${NB ? ' (cada uno con su θ)' : ''}.${NB ? ' θ = parámetro de dispersión de la binomial negativa (varianza = μ + μ²/θ).' : ''}`
    )
  );
  sec.tables.push(
    apaTable(
      `Coeficientes de la regresión ${MN}`,
      ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'IRR', 'IC 95 % (IRR)'],
      cols.map((c, j) => [
        esc(c.name),
        f(m.b[j], 3),
        f(m.se[j], 3),
        f(m.z[j]),
        pv(m.p[j]),
        j ? f(m.irr[j]) : '',
        j ? `[${f(m.ci[j][0])}, ${f(m.ci[j][1])}]` : '',
      ]),
      `IRR = razón de tasas (exp(B)); IC de Wald.${offName ? ` La exposición (${esc(offName)}) entra como desplazamiento: los coeficientes se refieren a la tasa por unidad de exposición.` : ''}`
    )
  );
}
/** Redacción APA y código R de la regresión de recuentos */
function countReport({ cols, sec, MN, yName, offName, xNames, n, pLR, dfm, lr, NB, m }) {
  const sig = cols.map((c, j) => ({ c, j })).filter(o => o.j > 0 && m.p[o.j] < 0.05);
  sec.text.push(
    `Se realizó una regresión ${MN} para predecir ${esc(yName)}${offName ? ` (con ${esc(offName)} como exposición)` : ''} a partir de ${list(xNames.map(esc))} (<i>N</i> = ${n}). El modelo ${pLR < 0.05 ? 'fue' : 'no fue'} estadísticamente significativo frente al modelo nulo, χ²(${dfm}) = ${f(lr)}, ${pt(pLR)}. ` +
      (sig.length
        ? sig
            .map(
              o =>
                `${esc(o.c.name)} se asoció con ${m.b[o.j] > 0 ? 'un aumento' : 'una disminución'} del recuento esperado (IRR = ${f(m.irr[o.j])}, IC 95 % [${f(m.ci[o.j][0])}, ${f(m.ci[o.j][1])}], ${pt(m.p[o.j])})`
            )
            .join('; ') + '.'
        : 'Ningún predictor se asoció significativamente con el recuento.')
  );
  const fml = xNames.map(rn).join(' + ') + (offName ? ` + offset(log(${rn(offName)}))` : '');
  sec.code =
    `# Regresión para recuentos: ${yName}\nd <- datos[complete.cases(datos[, c(${[yName]
      .concat(xNames, offName ? [offName] : [])
      .map(rq)
      .join(', ')})]), ]${offName ? `\nd <- d[d[[${rq(offName)}]] > 0, ]` : ''}\n` +
    `pois <- glm(${rn(yName)} ~ ${fml}, data = d, family = poisson)\nsum(residuals(pois, "pearson")^2) / df.residual(pois)  # dispersión\nnb <- MASS::glm.nb(${rn(yName)} ~ ${fml}, data = d)\n` +
    `lr <- 2 * (as.numeric(logLik(nb)) - as.numeric(logLik(pois))); c(chi2 = lr, p = .5 * pchisq(lr, 1, lower.tail = FALSE))  # binomial negativa frente a Poisson\n` +
    `modelo <- ${NB ? 'nb' : 'pois'}\nprint(summary(modelo), digits = 7)\nprint(exp(cbind(IRR = coef(modelo), confint.default(modelo))), digits = 7)  # razones de tasas con IC de Wald\n` +
    `nulo <- ${NB ? `MASS::glm.nb(${rn(yName)} ~ 1${offName ? ` + offset(log(${rn(offName)}))` : ''}, data = d)` : `glm(${rn(yName)} ~ 1${offName ? ` + offset(log(${rn(offName)}))` : ''}, data = d, family = poisson)`}\n` +
    `c(logLik = as.numeric(logLik(modelo)), desvianza = deviance(modelo), AIC = AIC(modelo), chi2 = 2 * (as.numeric(logLik(modelo)) - as.numeric(logLik(nulo))), gl = ${dfm})${NB ? '\nc(theta = modelo$theta, EE = modelo$SE.theta)' : ''}\n` +
    `c(ceros_observados = sum(d[[${rq(yName)}]] == 0), ceros_esperados = sum(${NB ? 'dnbinom(0, mu = fitted(modelo), size = modelo$theta)' : 'dpois(0, fitted(modelo))'}))`;
}

export { runCount };
