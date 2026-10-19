/* Tharp · aplicación · Análisis: Valores perdidos (prueba MCAR de Little) */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, list, pt, pv, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

// Valores perdidos: resumen por variable, patrones y prueba MCAR de Little (EM como norm::em.norm; prueba como naniar::mcar_test)
function runMissing(names) {
  const sec = nuevaSeccion('Análisis de valores perdidos', { test: 'Prueba MCAR de Little' });
  if (names.length < 2) {
    sec.error = 'Selecciona al menos dos variables cuantitativas.';
    return sec;
  }
  const cols = names.map(nm => numOf(vByName(nm))),
    N = ST.rows.length,
    X = ST.rows.map((_, i) => cols.map(c => c[i]));
  const miss = cols.map(c => c.filter(x => x === null).length),
    complete = X.filter(r => r.every(x => x !== null)).length,
    totalMiss = S.sum(miss);
  const few = names.filter((_, j) => N - miss[j] < 2);
  if (few.length) {
    sec.error = `${list(few.map(esc))} ${few.length > 1 ? 'tienen' : 'tiene'} menos de 2 valores observados.`;
    return sec;
  }
  const obs = cols.map(c => c.filter(x => x !== null)),
    r = totalMiss ? S.littleMCAR(X) : null;
  sec.decision = `Se analizaron los valores perdidos de ${names.length} variables cuantitativas en ${N} casos.`;
  sec.why.push(
    'Antes de analizar conviene saber cuántos datos faltan y si faltan al azar: si no es así, los análisis con casos completos pueden estar sesgados.'
  );
  sec.why.push(
    'La prueba de Little (1988) compara las medias de cada patrón de valores perdidos con las medias estimadas con todos los datos (algoritmo EM). Si no es significativa, los datos son compatibles con faltar completamente al azar (MCAR); no lo demuestra.'
  );
  sec.tables.push(
    apaTable(
      'Valores perdidos por variable',
      ['Variable', '<i>n</i>', 'Perdidos', '%', '<i>M</i>', '<i>DT</i>'].concat(
        r && !r.singular ? ['<i>M</i> (EM)', '<i>DT</i> (EM)'] : []
      ),
      names.map((nm, j) =>
        [esc(nm), N - miss[j], miss[j], f((miss[j] / N) * 100, 1), f(S.mean(obs[j])), f(S.sd(obs[j]))].concat(
          r && !r.singular ? [f(r.mu[j]), f(Math.sqrt(r.sigma[j][j]))] : []
        )
      ),
      `<i>M</i> y <i>DT</i>: con los casos disponibles en cada variable.${r && !r.singular ? ' EM: estimaciones de máxima verosimilitud con todos los casos, que suponen que los datos faltan al azar (MAR).' : ''}`
    )
  );
  missingPatterns({ totalMiss, sec, names, miss, r, N, complete });
  const pmax = (Math.max(...miss) / N) * 100;
  sec.checks.push(
    chk(
      !totalMiss ? 'ok' : pmax <= 5 ? 'ok' : 'info',
      !totalMiss
        ? 'No hay valores perdidos en las variables elegidas.'
        : `El porcentaje de perdidos por variable va de ${f((Math.min(...miss) / N) * 100, 1)} % a ${f(pmax, 1)} %.${pmax > 5 ? ' Por encima del 5 %, la forma de tratarlos puede influir en los resultados.' : ''}`
    )
  );
  if (r && !r.singular)
    sec.checks.push(
      chk(
        r.p >= 0.05 ? 'ok' : 'no',
        r.p >= 0.05
          ? `Little: ${pt(r.p)}. Los datos son compatibles con faltar completamente al azar.`
          : `Little: ${pt(r.p)}. Los datos no faltan completamente al azar: los análisis con casos completos pueden estar sesgados; valora la imputación múltiple o métodos de máxima verosimilitud, que suponen MAR.`
      )
    );
  sec.text.push(
    `Se analizaron los valores perdidos de ${names.length} variables cuantitativas (<i>N</i> = ${N}; ${complete} casos completos, ${f((complete / N) * 100, 1)} %). ` +
      (!totalMiss
        ? 'No había valores perdidos.'
        : `El porcentaje de valores perdidos por variable osciló entre el ${f((Math.min(...miss) / N) * 100, 1)} % y el ${f(pmax, 1)} %. ` +
          (r.singular
            ? 'La prueba MCAR de Little no pudo calcularse de forma fiable por la cantidad de valores perdidos.'
            : r.p >= 0.05
              ? `La prueba MCAR de Little no fue estadísticamente significativa, χ²(${r.df}) = ${f(r.chi)}, ${pt(r.p)}, lo que es compatible con que los datos falten completamente al azar.`
              : `La prueba MCAR de Little fue estadísticamente significativa, χ²(${r.df}) = ${f(r.chi)}, ${pt(r.p)}, lo que indica que los datos no faltan completamente al azar.`))
  );
  const V = `c(${names.map(rq).join(', ')})`;
  sec.code =
    `# Análisis de valores perdidos\nd <- datos[, ${V}]\nprint(data.frame(n = colSums(!is.na(d)), perdidos = colSums(is.na(d)), porcentaje = 100 * colMeans(is.na(d)), M = sapply(d, mean, na.rm = TRUE), DT = sapply(d, sd, na.rm = TRUE)), digits = 7)\n` +
    `patron <- apply(is.na(d), 1, function(r) paste(names(d)[r], collapse = ", "))\nprint(cbind(n = sort(table(patron), decreasing = TRUE), porcentaje = 100 * sort(prop.table(table(patron)), decreasing = TRUE)), digits = 7)  # patrones (vacío = casos completos)\nc(casos_completos = sum(complete.cases(d)), porcentaje = 100 * mean(complete.cases(d)))` +
    (totalMiss && !r.singular
      ? `\nnaniar::mcar_test(d)  # prueba MCAR de Little (EM con el criterio de convergencia por defecto de norm)\n# La misma prueba con el EM convergido del todo, como Tharp\nmcar_tharp <- function(x) {\n  x <- as.matrix(x); s <- norm::prelim.norm(x); pr <- norm::getparam.norm(s, norm::em.norm(s, showits = FALSE, criterion = 1e-10, maxits = 10000))\n  clave <- apply(is.na(x), 1, paste, collapse = ""); d2 <- 0; k <- 0\n  for (g in unique(clave)) { xx <- x[clave == g, , drop = FALSE]; o <- which(!is.na(xx[1, ])); if (!length(o)) next; k <- k + length(o)\n    dv <- colMeans(xx[, o, drop = FALSE]) - pr$mu[o]; d2 <- d2 + nrow(xx) * drop(t(dv) %*% solve(pr$sigma[o, o, drop = FALSE]) %*% dv) }\n  print(rbind(M_EM = pr$mu, DT_EM = sqrt(diag(pr$sigma))), digits = 7)\n  print(c(chi2 = d2, gl = k - ncol(x), p = pchisq(d2, k - ncol(x), lower.tail = FALSE), patrones = length(unique(clave))), digits = 7)\n}\nmcar_tharp(d)`
      : '');
  return sec;
}
/** Patrones de valores perdidos, prueba MCAR de Little y tabla de patrones */
function missingPatterns({ totalMiss, sec, names, miss, r, N, complete }) {
  if (totalMiss) {
    const g = r.groups.slice().sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)),
      lab = q => (q.missing.length ? list(q.missing.map(j => esc(names[j]))) : 'Ninguna (casos completos)'),
      MAXP = 12;
    sec.tables.push(
      apaTable(
        'Patrones de valores perdidos',
        ['Variables con valores perdidos', '<i>n</i>', '%'],
        g
          .slice(0, MAXP)
          .map(q => [lab(q), q.n, f((q.n / N) * 100, 1)])
          .concat(
            g.length > MAXP
              ? [
                  [
                    `Otros ${g.length - MAXP} patrones`,
                    S.sum(g.slice(MAXP).map(q => q.n)),
                    f((S.sum(g.slice(MAXP).map(q => q.n)) / N) * 100, 1),
                  ],
                ]
              : []
          ),
        `${g.length} patrones distintos. Casos completos: ${complete} (${f((complete / N) * 100, 1)} %).`
      )
    );
    if (r.singular)
      sec.warn =
        'Hay demasiados valores perdidos para estimar las covarianzas entre las variables (la estimación por EM no converge a una matriz válida), así que la prueba de Little no es fiable y no se muestra. Prueba con menos variables o con las que tengan menos perdidos.';
    else
      sec.tables.push(
        apaTable(
          'Prueba MCAR de Little',
          ['χ²', '<i>gl</i>', '<i>p</i>', 'Patrones'],
          [[f(r.chi), r.df, pv(r.p), r.patterns]],
          'H₀: los datos faltan completamente al azar (MCAR).'
        )
      );
  }
  if (totalMiss)
    sec.charts.push(
      fig(
        'Porcentaje de valores perdidos por variable',
        CH.barsCat(
          names,
          miss.map(m => +((m / N) * 100).toFixed(1)),
          '% de valores perdidos'
        )
      )
    );
}

export { runMissing };
