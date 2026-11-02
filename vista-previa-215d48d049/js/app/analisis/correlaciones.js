/* Tharp · aplicación · Análisis: Correlaciones */
import CH, { esc } from '../graficos.js';
import S from '../../motor/index.js';
import { numeracion } from '../estado.js';
import { numOf, vByName } from '../datos/variables.js';
import { f, lbl, list, pt, pv, r2s, rq, stars } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

function runCorrelations(names, method, zNames = []) {
  zNames = zNames.filter(z => !names.includes(z));
  const vars = names.map(vByName).filter(v => v && v.type === 'num'),
    Zv = zNames.map(vByName),
    partial = Zv.length > 0;
  const sec = nuevaSeccion(partial ? 'Correlaciones parciales' : 'Correlaciones');
  if (vars.length < 2) {
    sec.error = 'Selecciona al menos dos variables cuantitativas (distintas de las que controlas).';
    return sec;
  }
  if (partial && method === 'kendall') {
    sec.error =
      'La correlación parcial está disponible con Pearson o Spearman. Elige uno de esos métodos o quita las variables de control.';
    return sec;
  }
  const skewed = vars.filter(v => Math.abs(S.skewness(numOf(v).filter(a => a !== null))) > 1);
  let m = method;
  if (m === 'auto') m = skewed.length ? 'spearman' : 'pearson';
  const P = m === 'pearson',
    K = m === 'kendall',
    sym = P ? '<i>r</i>' : K ? 'τ<sub>b</sub>' : '<i>r</i><sub>s</sub>',
    name = P ? 'Pearson' : K ? 'Kendall (tau-b)' : 'Spearman';
  sec.test = `Correlación ${partial ? 'parcial ' : ''}de ${name}`;
  if (partial)
    sec.why.push(
      `Correlación parcial: se elimina de cada par la parte que comparten con ${list(zNames.map(esc))} (regresión de ambas variables sobre ${zNames.length > 1 ? 'ellas' : 'ella'} y correlación de los residuos${P ? '' : ', sobre los rangos'}). Se usan los casos completos en todas las variables.`
    );
  if (K)
    sec.why.push(
      'Tau-b de Kendall: medida de asociación por rangos basada en pares concordantes y discordantes, corregida por empates; adecuada con muestras pequeñas o muchas puntuaciones repetidas.'
    );
  sec.decision =
    method === 'auto'
      ? P
        ? 'Se usa Pearson porque ninguna variable presenta una asimetría marcada.'
        : `Se usa Spearman porque ${list(skewed.map(v => esc(v.name)))} ${skewed.length > 1 ? 'presentan' : 'presenta'} una asimetría marcada (|asimetría| > 1).`
      : `Método elegido por ti: ${name}.`;
  sec.why.push('Todas las variables son cuantitativas y se quiere medir la fuerza y dirección de su relación.');
  sec.why.push(
    P
      ? 'Pearson mide relación lineal y es adecuada cuando las variables tienen distribuciones aproximadamente simétricas.'
      : 'Spearman trabaja con rangos: es robusta ante asimetría y valores atípicos y mide relaciones monótonas.'
  );
  sec.why.push(
    'Los valores perdidos se eliminan por parejas: cada correlación usa todos los casos disponibles para ese par.'
  );
  const { k, R, pairs, nmin, nmax } = correlationPairs({ vars, Zv, partial, m, P, K });
  if (!pairs.length) {
    sec.error = `Hay muy pocos casos completos para calcular las correlaciones: cada par de variables necesita al menos ${4 + Zv.length} casos con ambos valores${Zv.length ? ' (y los de las variables de control)' : ''}.`;
    return sec;
  }
  correlationsTables({ vars, pairs, sec, partial, name, sym, zNames, P, K, nmin, nmax, skewed, R, m });
  correlationsReport({ pairs, partial, name, k, zNames, sec, vars, Zv, P, m, K, sym });
  return sec;
}
/** Correlación de cada par de variables con los casos disponibles (y las variables de control) */
function correlationPairs({ vars, Zv, partial, m, P, K }) {
  const k = vars.length,
    R = [],
    pairs = [];
  let nmin = Infinity,
    nmax = 0;
  for (let i = 0; i < k; i++) {
    R[i] = [];
    for (let j = 0; j < i; j++) {
      const xi = numOf(vars[i]),
        xj = numOf(vars[j]),
        zs = Zv.map(numOf),
        a = [],
        b = [],
        zc = Zv.map(() => []);
      xi.forEach((v, t) => {
        if (v !== null && xj[t] !== null && zs.every(z => z[t] !== null)) {
          a.push(v);
          b.push(xj[t]);
          zs.forEach((z, q) => zc[q].push(z[t]));
        }
      });
      const c =
        a.length > 3 + Zv.length
          ? partial
            ? S.partialCorr(a, b, zc, m)
            : P
              ? S.pearson(a, b)
              : K
                ? S.kendall(a, b)
                : S.spearman(a, b)
          : null;
      R[i][j] = c;
      if (c) {
        nmin = Math.min(nmin, c.n);
        nmax = Math.max(nmax, c.n);
        pairs.push({ i, j, c, a, b });
      }
    }
  }
  return { k, R, pairs, nmin, nmax };
}
/** Tablas de detalle por pares y de matriz de correlaciones, y supuestos (asimetría, linealidad, correlaciones perfectas, número de pruebas) */
function correlationsTables({ vars, pairs, sec, partial, name, sym, zNames, P, K, nmin, nmax, skewed, R, m }) {
  const cell = c => {
    if (!c || !isFinite(c.r)) return '—';
    const al = Math.min(0.55, Math.abs(c.r) * 0.6),
      bg = c.r >= 0 ? `rgba(42,120,214,${al})` : `rgba(227,73,72,${al})`;
    return `<span style="display:inline-block;min-width:52px;padding:2px 6px;border-radius:4px;background:${bg}" title="${P ? 'r' : 'rs'} = ${c.r.toFixed(3)}, p = ${c.p.toFixed(4)}, n = ${c.n}">${r2s(c.r)}${stars(c.p)}</span>`;
  };
  const rows = vars.map((v, i) => {
    const x = numOf(v).filter(a => a !== null),
      d = S.describe(x);
    return [`${i + 1}. ${esc(v.name)}`, f(d.mean), f(d.sd)].concat(
      vars.map((_, j) => (j < i ? cell(R[i][j]) : j === i ? '—' : ''))
    );
  });
  // detalle por pares: coeficiente, IC 95 %, n, p y p con corrección de Holm
  const holmP = S.holm(pairs.map(q => q.c.p));
  const pairRows = pairs.map((q, z) => {
    const ci = partial ? null : S.corrCI(q.c.r, q.c.n, m);
    return [`${esc(vars[q.i].name)} – ${esc(vars[q.j].name)}`, r2s(q.c.r)]
      .concat(partial ? [q.c.n, q.c.df] : [`[${r2s(ci[0])}, ${r2s(ci[1])}]`, q.c.n])
      .concat([pv(q.c.p), pv(holmP[z])]);
  });
  sec.tables.push(
    apaTable(
      `Detalle de las correlaciones${partial ? ' parciales' : ''} de ${name}`,
      ['Par', sym]
        .concat(partial ? ['<i>n</i>', '<i>gl</i>'] : ['IC 95 %', '<i>n</i>'])
        .concat(['<i>p</i>', '<i>p</i> (Holm)']),
      pairRows,
      `${partial ? `Controlando por ${list(zNames.map(esc))}. ` : `IC por la transformación <i>z</i> de Fisher${P ? '' : K ? ' con el error típico de Fieller et al. (1957)' : ' con el error típico de Bonett y Wright (2000)'}. `}${!P && !partial ? `<i>p</i> exacta cuando no hay empates (como R y JASP)${K ? ' y <i>n</i> < 50' : ''}. ` : ''}<i>p</i> (Holm) corrige por el número de correlaciones calculadas.`
    )
  );
  sec.tables.push(
    apaTable(
      `Medias, desviaciones típicas y correlaciones${partial ? ' parciales' : ''} de ${name}`,
      ['Variable', '<i>M</i>', '<i>DT</i>'].concat(vars.map((_, j) => String(j + 1))),
      rows,
      `${sym} de ${name}${partial ? `, controlando por ${list(zNames.map(esc))}` : ''}. <i>n</i> = ${nmin === nmax ? nmin : nmin + '–' + nmax} (eliminación por parejas). * <i>p</i> < .05. ** <i>p</i> < .01. *** <i>p</i> < .001.`,
      'corr'
    )
  );
  sec.checks.push(
    skewed.length
      ? chk(
          P ? 'no' : 'ok',
          `Asimetría marcada en ${list(skewed.map(v => esc(v.name)))}${P ? ': considera usar Spearman.' : ': por eso se usa Spearman.'}`
        )
      : chk('ok', 'Ninguna variable presenta asimetría marcada.')
  );
  sec.checks.push(
    chk(
      'info',
      'Linealidad: revisa el diagrama de dispersión. Una correlación cercana a 0 no descarta relaciones no lineales (por ejemplo, en forma de U).'
    )
  );
  const perf = pairs.filter(q => Math.abs(q.c.r) > 0.9999);
  if (perf.length)
    sec.checks.push(
      chk(
        'no',
        `Correlación perfecta (±1) entre ${list(perf.map(q => `${esc(vars[q.i].name)} – ${esc(vars[q.j].name)}`))}: suele indicar que una variable está repetida o se calculó a partir de la otra. Revisa los datos.`
      )
    );
  if (pairs.length > 10)
    sec.checks.push(
      chk(
        'no',
        `Se han calculado ${pairs.length} correlaciones: con tantas pruebas aumenta la probabilidad de falsos positivos. Considera una corrección (por ejemplo, Holm) o interpreta solo las hipótesis planteadas a priori.`
      )
    );
}
/** Redacción APA, diagrama de dispersión del par más fuerte y código R de las correlaciones */
function correlationsReport({ pairs, partial, name, k, zNames, sec, vars, Zv, P, m, K, sym }) {
  const sig = pairs.filter(p => p.c.p < 0.05).sort((a, b) => Math.abs(b.c.r) - Math.abs(a.c.r));
  let t = `Se calcularon las correlaciones ${partial ? 'parciales ' : ''}de ${name} entre ${k} variables (${pairs.length} ${pairs.length === 1 ? 'par' : 'pares'})${partial ? `, controlando por ${list(zNames.map(esc))}` : ''}. `;
  if (!sig.length) t += 'Ninguna de las correlaciones fue estadísticamente significativa.';
  else {
    t += `${sig.length === 1 ? 'Una correlación fue' : sig.length + ' correlaciones fueron'} estadísticamente ${sig.length === 1 ? 'significativa' : 'significativas'}. `;
    t +=
      sig
        .slice(0, 5)
        .map(
          p =>
            `${esc(vars[p.i].name)} y ${esc(vars[p.j].name)} mostraron una correlación ${p.c.r > 0 ? 'positiva' : 'negativa'} ${lbl.corr(p.c.r)}, ${K ? sym : `${sym}(${p.c.df})`} = ${r2s(p.c.r)}, ${pt(p.c.p)}`
        )
        .join('; ') + '.';
    if (sig.length > 5) t += ` Las demás correlaciones significativas se muestran en la Tabla ${numeracion.tabla}.`;
  }
  sec.text.push(t);
  if (pairs.length) {
    const top = pairs.slice().sort((a, b) => Math.abs(b.c.r) - Math.abs(a.c.r))[0];
    const reg = (() => {
      const mx = S.mean(top.b),
        my = S.mean(top.a);
      let sxy = 0,
        sxx = 0;
      top.b.forEach((v, i) => {
        sxy += (v - mx) * (top.a[i] - my);
        sxx += (v - mx) ** 2;
      });
      const b = sxy / sxx;
      return [my - b * mx, b];
    })();
    sec.charts.push(
      fig(
        `Relación más fuerte: ${vars[top.i].name} y ${vars[top.j].name}`,
        CH.scatter(top.b, top.a, vars[top.j].name, vars[top.i].name, { line: reg })
      )
    );
  }
  const VV = `c(${vars.map(v => rq(v.name)).join(', ')})`;
  sec.code = partial
    ? `# Correlaciones parciales de ${name}, controlando por ${zNames.join(', ')}\nd <- na.omit(datos[, c(${vars
        .concat(Zv)
        .map(v => rq(v.name))
        .join(
          ', '
        )})])\npsych::partial.r(d${P ? '' : ', method = "spearman"'}, x = ${VV}, y = c(${zNames.map(rq).join(', ')}))\n` +
      `# p de cada correlación parcial (gl = n − 2 − número de variables controladas)\npsych::corr.p(psych::partial.r(d${P ? '' : ', method = "spearman"'}, x = ${VV}, y = c(${zNames.map(rq).join(', ')})), n = nrow(d) - ${zNames.length}, adjust = "none")`
    : `# Correlaciones de ${name}\npsych::corr.test(datos[, ${VV}], method = "${m}", use = "pairwise", adjust = "none")\n` +
      `# IC 95 % de cada par por la z de Fisher (EE de Bonett y Wright con Spearman, de Fieller et al. con Kendall), como Tharp\nic_r <- function(x, y, metodo) { ok <- complete.cases(x, y); n <- sum(ok); r <- cor(x[ok], y[ok], method = metodo)\n  se <- switch(metodo, kendall = sqrt(.437 / (n - 4)), spearman = sqrt((1 + r^2 / 2) / (n - 3)), 1 / sqrt(n - 3)); c(r = r, n = n, IC_inf = tanh(atanh(r) - qnorm(.975) * se), IC_sup = tanh(atanh(r) + qnorm(.975) * se), p = suppressWarnings(cor.test(x[ok], y[ok], method = metodo)$p.value)) }\n` +
      `tab_r <- rbind(${pairs.map(q => `${rq(vars[q.i].name + ' – ' + vars[q.j].name)} = ic_r(datos[[${rq(vars[q.i].name)}]], datos[[${rq(vars[q.j].name)}]], "${m}")`).join(',\n  ')})\nprint(cbind(tab_r, p_Holm = p.adjust(tab_r[, "p"], "holm")), digits = 7)\n` +
      pairs
        .map(q => `cor.test(datos[[${rq(vars[q.i].name)}]], datos[[${rq(vars[q.j].name)}]], method = "${m}")`)
        .slice(0, 6)
        .join('\n') +
      (pairs.length > 6 ? '\n# … (igual para el resto de pares)' : '');
}

export { runCorrelations };
