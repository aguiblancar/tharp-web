/* Tharp · aplicación · Análisis: ANOVA y ANCOVA factorial */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { catOf, numOf, ordOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, f_, lbl, list, nz, pt, pv, rn, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';
import { maxOf, minOf } from '../utilidades.js';

function runFactorial(yName, aName, bName) {
  const sec = nuevaSeccion(`${yName} según ${aName} × ${bName}`, { test: 'ANOVA factorial (SC tipo III)' });
  if (aName === bName) {
    sec.error = 'Elige dos factores distintos.';
    return sec;
  }
  const yv = numOf(vByName(yName)),
    ca = catOf(vByName(aName)),
    cb = catOf(vByName(bName));
  const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && ca[i] !== null && cb[i] !== null);
  const la = ordOf(
      vByName(aName),
      idx.map(i => ca[i])
    ),
    lb = ordOf(
      vByName(bName),
      idx.map(i => cb[i])
    );
  if (la.length < 2 || lb.length < 2) {
    sec.error = 'Cada factor necesita al menos 2 niveles con datos.';
    return sec;
  }
  const cells = la.map(() => lb.map(() => []));
  idx.forEach(i => cells[la.indexOf(ca[i])][lb.indexOf(cb[i])].push(yv[i]));
  if (cells.flat().some(c => c.length < 2)) {
    sec.error =
      'Alguna combinación de niveles tiene menos de 2 casos: el ANOVA factorial no puede estimarse. Agrupa niveles o usa un único factor.';
    return sec;
  }
  const y = idx.map(i => yv[i]),
    r = S.anova2(
      y,
      idx.map(i => la.indexOf(ca[i])),
      idx.map(i => lb.indexOf(cb[i])),
      la.length,
      lb.length
    );
  if (!r) {
    sec.error = 'No se pudo estimar el modelo.';
    return sec;
  }
  factorialChecksAndTable({ cells, r, y, sec, la, lb, yName, aName, bName });
  // Medias marginales estimadas (media no ponderada de las medias de casilla, como emmeans y JASP) y comparaciones por pares
  // con ajuste de Tukey; d = diferencia / √MCE (emmeans::eff_size con sigma(modelo), como JASP)
  const { emA, emB, pA, pB } = factorialMarginalMeans({ cells, r, la, lb, sec, yName, aName, bName, idx, ca, cb, yv });
  // con dos niveles, la redacción incluye las medias marginales y la d del efecto principal
  factorialTextAndCode({ la, lb, aName, bName, yName, r, pA, emA, pB, emB, sec, cells });
  return sec;
}
/** Supuestos, motivos y tablas de descriptivos y del ANOVA factorial de dos factores */
function factorialChecksAndTable({ cells, r, y, sec, la, lb, yName, aName, bName }) {
  const lev = S.levene(cells.flat()),
    sw = S.shapiro(r.resid),
    n = y.length,
    sizes = cells.flat().map(c => c.length),
    balanced = maxOf(sizes) === minOf(sizes);
  sec.decision = `Se ajustó un ANOVA factorial ${la.length}×${lb.length} con sumas de cuadrados de tipo III (como SPSS) y ${n} casos.`;
  sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa.`);
  sec.why.push(
    `Dos factores entre sujetos: ${esc(aName)} (${la.length} niveles) y ${esc(bName)} (${lb.length} niveles).`
  );
  sec.why.push(
    'El ANOVA factorial estima el efecto de cada factor y su interacción: si el efecto de un factor depende del nivel del otro.'
  );
  sec.why.push(
    `Se usan sumas de cuadrados de tipo III, adecuadas ${balanced ? 'también' : 'especialmente'} cuando los grupos ${balanced ? 'están equilibrados' : 'tienen tamaños distintos'}.`
  );
  sec.checks.push(
    chk(
      lev.p >= 0.05 ? 'ok' : 'no',
      `Homogeneidad de varianzas entre las ${la.length * lb.length} casillas (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.${lev.p >= 0.05 ? ' Se cumple.' : ' No se cumple: interpreta con cautela, sobre todo si los tamaños de las casillas difieren.'}`
    )
  );
  if (sw)
    sec.checks.push(
      chk(
        sw.p >= 0.05 ? 'ok' : n >= 100 ? 'info' : 'no',
        `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}.${sw.p >= 0.05 ? '' : n >= 100 ? ' Con muestras grandes el ANOVA es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña.'}`
      )
    );
  sec.checks.push(
    chk(
      balanced ? 'ok' : 'info',
      `Tamaño de las casillas: entre ${minOf(sizes)} y ${maxOf(sizes)} casos${balanced ? ' (diseño equilibrado).' : ' (diseño no equilibrado).'}`
    )
  );
  sec.alt =
    'Si no se cumple la homogeneidad con casillas desiguales, errores robustos o un modelo lineal generalizado.';
  const rows = [];
  la.forEach((a, i) =>
    lb.forEach((b, j) => {
      const d = S.describe(cells[i][j]);
      rows.push([j === 0 ? esc(a) : '', esc(b), d.n, f(d.mean), f(d.sd)]);
    })
  );
  sec.tables.push(
    apaTable(
      `Estadísticos descriptivos de ${yName} por ${aName} y ${bName}`,
      [esc(aName), esc(bName), '<i>n</i>', '<i>M</i>', '<i>DT</i>'],
      rows
    )
  );
  const eff = [
    ['A', esc(aName)],
    ['B', esc(bName)],
    ['AB', `${esc(aName)} × ${esc(bName)}`],
  ];
  sec.tables.push(
    apaTable(
      'Resultado del ANOVA factorial',
      ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>'],
      eff
        .map(([k, nm]) => [nm, f(r[k].ss), r[k].df, f(r[k].ms), f(r[k].F), pv(r[k].p), nz(r[k].peta2.toFixed(3))])
        .concat([['Error', f(r.sse), r.dfE, f(r.mse), '', '', '']]),
      'SC de tipo III. η²<sub>p</sub> = eta cuadrado parcial.'
    )
  );
}
/** Medias marginales estimadas y comparaciones con ajuste de Tukey y d de Cohen */
function factorialMarginalMeans({ cells, r, la, lb, sec, yName, aName, bName, idx, ca, cb, yv }) {
  const cm = cells.map(row => row.map(c => S.mean(c))),
    tc = S.tcrit(r.dfE),
    sdE = Math.sqrt(r.mse);
  const marg = (levels, other, mean_, invn) =>
    levels.map((lv, i) => {
      const em = S.mean(other.map((_, j) => mean_(i, j))),
        se = Math.sqrt((r.mse * S.sum(other.map((_, j) => invn(i, j)))) / other.length ** 2);
      return { lv, em, se, ci: [em - tc * se, em + tc * se] };
    });
  const emA = marg(
      la,
      lb,
      (i, j) => cm[i][j],
      (i, j) => 1 / cells[i][j].length
    ),
    emB = marg(
      lb,
      la,
      (j, i) => cm[i][j],
      (j, i) => 1 / cells[i][j].length
    );
  const pairsOf = (em, other, invn) => {
    const out = [],
      k = em.length;
    for (let i = 0; i < k; i++)
      for (let j = i + 1; j < k; j++) {
        const diff = em[i].em - em[j].em,
          se = Math.sqrt((r.mse * S.sum(other.map((_, o) => invn(i, o) + invn(j, o)))) / other.length ** 2),
          tv = diff / se;
        const p = k === 2 ? S.pT(tv, r.dfE) : Math.min(1, 1 - jStat.tukey.cdf(Math.abs(tv) * Math.SQRT2, k, r.dfE));
        out.push({ a: em[i].lv, b: em[j].lv, diff, se, t: tv, p, d: diff / sdE });
      }
    return out;
  };
  const pA = pairsOf(emA, lb, (i, j) => 1 / cells[i][j].length),
    pB = pairsOf(emB, la, (j, i) => 1 / cells[i][j].length);
  const obs = (fac, lv) => S.describe(idx.filter(i => (fac === 'A' ? ca[i] : cb[i]) === lv).map(i => yv[i]));
  sec.tables.push(
    apaTable(
      `Medias marginales estimadas de ${yName}`,
      [
        'Factor',
        'Nivel',
        '<i>n</i>',
        '<i>M</i> observada (<i>DT</i>)',
        '<i>M</i> marginal estimada',
        '<i>EE</i>',
        'IC 95 %',
      ],
      [
        ['A', emA, la],
        ['B', emB, lb],
      ].flatMap(([k, em]) =>
        em.map((e, q) => {
          const o = obs(k, e.lv);
          return [
            q === 0 ? esc(k === 'A' ? aName : bName) : '',
            esc(e.lv),
            o.n,
            `${f(o.mean)} (${f(o.sd)})`,
            f(e.em),
            f(e.se),
            `[${f(e.ci[0])}, ${f(e.ci[1])}]`,
          ];
        })
      ),
      'Las medias marginales estimadas promedian las medias de las casillas sin ponderar por su tamaño (como emmeans, JASP y SPSS); con casillas desiguales no coinciden con las medias observadas.'
    )
  );
  sec.tables.push(
    apaTable(
      `Comparaciones de las medias marginales estimadas de ${yName}`,
      ['Factor', 'Comparación', 'Diferencia', '<i>EE</i>', '<i>t</i>(' + r.dfE + ')', '<i>p</i>', '<i>d</i> de Cohen'],
      [
        [aName, pA],
        [bName, pB],
      ].flatMap(([nm, ps]) =>
        ps.map((c, q) => [
          q === 0 ? esc(nm) : '',
          `${esc(c.a)} − ${esc(c.b)}`,
          f(c.diff),
          f(c.se),
          f(c.t),
          pv(c.p),
          f(c.d),
        ])
      ),
      `<i>p</i> con ajuste de Tukey cuando el factor tiene más de dos niveles. <i>d</i> = diferencia / √<i>MC</i><sub>error</sub> (como JASP). Tamaño del efecto: 0.20 pequeño, 0.50 mediano, 0.80 grande (Cohen, 1988).`
    )
  );
  return { emA, emB, pA, pB };
}
/** Redacción APA, gráfico de interacción y código R del ANOVA factorial de dos factores */
function factorialTextAndCode({ la, lb, aName, bName, yName, r, pA, emA, pB, emB, sec, cells }) {
  const dTxt = (ps, em) =>
    ps.length === 1
      ? ` (${esc(em[0].lv)}: <i>M</i> = ${f(em[0].em)}; ${esc(em[1].lv)}: <i>M</i> = ${f(em[1].em)}; <i>d</i> = ${f(Math.abs(ps[0].d))}, efecto ${lbl.d(ps[0].d)})`
      : '';
  const st = k =>
    `<i>F</i>(${r[k].df}, ${r.dfE}) = ${f(r[k].F)}, ${pt(r[k].p)}, η²<sub>p</sub> = ${nz(r[k].peta2.toFixed(3))}`;
  let t = `Se realizó un ANOVA factorial ${la.length}×${lb.length} para analizar el efecto de ${esc(aName)} y ${esc(bName)} sobre ${esc(yName)}. `;
  t += `El efecto principal de ${esc(aName)} ${r.A.p < 0.05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st('A')}${r.A.p < 0.05 ? dTxt(pA, emA) : ''}. `;
  t += `El efecto principal de ${esc(bName)} ${r.B.p < 0.05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st('B')}${r.B.p < 0.05 ? dTxt(pB, emB) : ''}. `;
  t += `La interacción ${esc(aName)} × ${esc(bName)} ${r.AB.p < 0.05 ? 'fue' : 'no fue'} estadísticamente significativa, ${st('AB')}.`;
  if (r.AB.p < 0.05) {
    t += ` Esto indica que el efecto de ${esc(aName)} depende del nivel de ${esc(bName)} (véase la figura), por lo que los efectos principales deben interpretarse con cautela.`;
    sec.checks.push(
      chk(
        'info',
        'La interacción es significativa: analiza los efectos simples (el efecto de un factor dentro de cada nivel del otro). El código R incluye cómo hacerlo con emmeans.'
      )
    );
  }
  sec.text.push(t);
  if (lb.length <= 8)
    sec.charts.push(
      fig(
        `Interacción ${aName} × ${bName}: medias e IC 95 %`,
        CH.interaction(
          la,
          lb.map((b, j) => ({
            name: b,
            means: la.map((_, i) => S.mean(cells[i][j])),
            ci: la.map((_, i) => S.meanCI(cells[i][j])),
          })),
          yName
        ),
        CH.legend(lb)
      )
    );
  const Y = rn(yName),
    A = rn(aName),
    B = rn(bName);
  sec.code = `# ANOVA factorial: ${yName} ~ ${aName} × ${bName}\noptions(contrasts = c("contr.sum", "contr.poly"))\nmodelo <- aov(${Y} ~ ${A} * ${B}, data = datos)\ncar::Anova(modelo, type = 3)\neffectsize::eta_squared(car::Anova(modelo, type = 3), partial = TRUE)\naggregate(${Y} ~ ${A} + ${B}, data = datos, FUN = function(x) c(n = length(x), M = mean(x), DT = sd(x)))  # descriptivos por casilla\nfor (f in c(${rq(aName)}, ${rq(bName)})) print(aggregate(modelo$model[[1]], by = list(nivel = modelo$model[[f]]), FUN = function(x) c(n = length(x), M = mean(x), DT = sd(x))))  # medias observadas por nivel\ncar::leveneTest(${Y} ~ ${A} * ${B}, data = datos, center = mean)\nshapiro.test(residuals(modelo))\n# Medias marginales estimadas, comparaciones (Tukey) y d de Cohen (como JASP)\nfor (fac in c(${rq(aName)}, ${rq(bName)})) {\n  em <- emmeans::emmeans(modelo, fac)\n  print(em); print(pairs(em, adjust = "tukey"))\n  print(emmeans::eff_size(em, sigma = sigma(modelo), edf = df.residual(modelo)))\n}\n# Efectos simples\nemmeans::emmeans(modelo, pairwise ~ ${A} | ${B}, adjust = "holm")`;
}
// ANOVA factorial general (2 o 3 factores) con covariables opcionales: SC de tipo III, medias marginales y comparaciones
function runFactorialG(yName, fNames, cNames) {
  fNames = fNames.filter(Boolean);
  cNames = cNames.filter(c => c !== yName && !fNames.includes(c));
  const title = `${yName} según ${fNames.join(' × ')}${cNames.length ? `, controlando ${cNames.join(', ')}` : ''}`;
  const sec = nuevaSeccion(title, { test: `${cNames.length ? 'ANCOVA' : 'ANOVA'} factorial (SC tipo III)` });
  if (new Set(fNames).size !== fNames.length) {
    sec.error = 'Elige factores distintos.';
    return sec;
  }
  if (fNames.includes(yName)) {
    sec.error = 'La variable dependiente no puede ser un factor.';
    return sec;
  }
  const yv = numOf(vByName(yName)),
    fc = fNames.map(nm => catOf(vByName(nm))),
    cc = cNames.map(nm => numOf(vByName(nm)));
  const idx = ST.rows
    .map((_, i) => i)
    .filter(i => yv[i] !== null && fc.every(c => c[i] !== null) && cc.every(c => c[i] !== null));
  const lv = fNames.map((nm, f) =>
      ordOf(
        vByName(nm),
        idx.map(i => fc[f][i])
      )
    ),
    L = lv.map(l => l.length),
    n = idx.length;
  if (L.some(k => k < 2)) {
    sec.error = 'Cada factor necesita al menos 2 niveles con datos.';
    return sec;
  }
  const Fm = idx.map(i => fc.map((c, f) => lv[f].indexOf(c[i]))),
    y = idx.map(i => yv[i]),
    C = cc.map(c => idx.map(i => c[i]));
  const cellKey = r => r.join('|'),
    cells = new Map();
  Fm.forEach((r, q) => {
    const k_ = cellKey(r);
    if (!cells.has(k_)) cells.set(k_, []);
    cells.get(k_).push(y[q]);
  });
  const nCells = L.reduce((a, b) => a * b, 1);
  if (cells.size < nCells || [...cells.values()].some(c => c.length < 2)) {
    sec.error = `Hay combinaciones de niveles con menos de 2 casos (${cells.size} de ${nCells} casillas con datos): el modelo con todas las interacciones no puede estimarse. Agrupa niveles o quita un factor.`;
    return sec;
  }
  const g = S.glmFactorial(y, Fm, L, C);
  if (!g) {
    sec.error = 'No se pudo estimar el modelo (colinealidad entre covariables).';
    return sec;
  }
  const tName = t => (t.cov !== undefined ? esc(cNames[t.cov]) : t.factors.map(f => esc(fNames[f])).join(' × '));
  const design = L.join('×');
  sec.decision = `Se ajustó un${cNames.length ? 'a ANCOVA' : ' ANOVA'} factorial ${design} con sumas de cuadrados de tipo III (como SPSS)${cNames.length ? ` y ${cNames.length} covariable${cNames.length > 1 ? 's' : ''}` : ''}, con ${n} casos.`;
  sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa.`);
  sec.why.push(
    `${fNames.length} factores entre sujetos: ${fNames.map((nm, f) => `${esc(nm)} (${L[f]} niveles)`).join(', ')}. Se estiman sus efectos principales y todas sus interacciones.`
  );
  if (cNames.length)
    sec.why.push(
      `Covariables: ${list(cNames.map(esc))}. Los efectos de los factores se estiman ajustando por ellas (medias marginales con las covariables en su media).`
    );
  factorialGChecks({ cells, g, sec, nCells, n, cNames, idx, y, L, Fm, C, fNames });
  factorialGTables({ sec, cNames, g, fNames, yName, L, tName, lv });
  factorialGTextAndCode({ g, cNames, design, fNames, yName, sec, title, tName });
  return sec;
}
/** Supuestos (Levene, normalidad de residuos, homogeneidad de pendientes con covariables) */
function factorialGChecks({ cells, g, sec, nCells, n, cNames, idx, y, L, Fm, C, fNames }) {
  const lev = S.levene([...cells.values()]),
    sw = S.shapiro(g.resid),
    sizes = [...cells.values()].map(c => c.length);
  sec.checks.push(
    chk(
      lev.p >= 0.05 ? 'ok' : 'no',
      `Homogeneidad de varianzas entre las ${nCells} casillas (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.${lev.p >= 0.05 ? ' Se cumple.' : ' No se cumple: interpreta con cautela, sobre todo con casillas desiguales.'}`
    )
  );
  if (sw)
    sec.checks.push(
      chk(
        sw.p >= 0.05 ? 'ok' : n >= 100 ? 'info' : 'no',
        `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}.${sw.p >= 0.05 ? '' : n >= 100 ? ' Con muestras grandes el ANOVA es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña.'}`
      )
    );
  sec.checks.push(
    chk(
      maxOf(sizes) === minOf(sizes) ? 'ok' : 'info',
      `Tamaño de las casillas: entre ${minOf(sizes)} y ${maxOf(sizes)} casos.`
    )
  );
  if (cNames.length) {
    // homogeneidad de pendientes: ganancia al añadir las interacciones factor × covariable al modelo
    const codes = (f, l) => Array.from({ length: L[f] - 1 }, (_, j) => (l === j ? 1 : l === L[f] - 1 ? -1 : 0));
    const subs = [];
    for (let mask = 1; mask < 1 << L.length; mask++)
      subs.push([...Array(L.length).keys()].filter(f => mask & (1 << f)));
    const rowOf = (q, withInt) => {
      const lvq = Fm[q],
        r = [1];
      subs.forEach(sub =>
        sub
          .reduce(
            (acc, f) => {
              const c = codes(f, lvq[f]),
                out = [];
              acc.forEach(x => c.forEach(z => out.push(x * z)));
              return out;
            },
            [1]
          )
          .forEach(v => r.push(v))
      );
      C.forEach(c => r.push(c[q]));
      if (withInt) fNames.forEach((_, f) => codes(f, lvq[f]).forEach(code => C.forEach(c => r.push(code * c[q]))));
      return r;
    };
    const X0 = idx.map((_, q) => rowOf(q, false)),
      X1 = idx.map((_, q) => rowOf(q, true)),
      m0 = S.olsCore(X0, y),
      m1 = S.olsCore(X1, y);
    if (m0 && m1) {
      const dfn = X1[0].length - X0[0].length,
        dfd = n - X1[0].length,
        Fs = (m0.sse - m1.sse) / dfn / (m1.sse / dfd),
        ps = 1 - jStat.centralF.cdf(Fs, dfn, dfd);
      sec.checks.push(
        chk(
          ps >= 0.05 ? 'ok' : 'no',
          `Homogeneidad de las pendientes de regresión (interacción factores × covariables): <i>F</i>(${dfn}, ${dfd}) = ${f(Fs)}, ${pt(ps)}.${ps >= 0.05 ? ' Se cumple.' : ' No se cumple: la relación de la covariable con la variable dependiente cambia según el grupo; la ANCOVA puede ser engañosa.'}`
        )
      );
    }
  }
  sec.alt =
    'Si no se cumplen los supuestos, errores robustos (HC3) o un modelo lineal generalizado; con muchas casillas pequeñas, reduce el número de factores.';
}
/** Tablas del modelo, medias marginales estimadas, comparaciones y gráfico de interacción */
function factorialGTables({ sec, cNames, g, fNames, yName, L, tName, lv }) {
  sec.tables.push(
    apaTable(
      `Resultado de${cNames.length ? ' la ANCOVA' : 'l ANOVA'} factorial`,
      ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>', 'ω²<sub>p</sub>'],
      g.terms
        .map(t => [tName(t), f(t.ss), t.df, f(t.ms), f(t.F), pv(t.p), nz(t.peta2.toFixed(3)), nz(t.pomega2.toFixed(3))])
        .concat([['Error', f(g.sse), g.dfE, f(g.mse), '', '', '', '']]),
      'SC de tipo III con codificación de efectos (como SPSS y car::Anova). η²<sub>p</sub> = eta cuadrado parcial; ω²<sub>p</sub> = omega cuadrado parcial.'
    )
  );
  const tc = S.tcrit(g.dfE),
    emRows = [],
    prRows = [];
  fNames.forEach((nm, f) => {
    const pr = g.pairs(f);
    pr.emm.forEach((e, q) =>
      emRows.push([
        q === 0 ? esc(nm) : '',
        esc(lv[f][e.levels[0]]),
        f_(e.em),
        f_(e.se),
        `[${f_(e.em - tc * e.se)}, ${f_(e.em + tc * e.se)}]`,
      ])
    );
    pr.pairs.forEach((c, q) =>
      prRows.push([
        q === 0 ? esc(nm) : '',
        `${esc(lv[f][c.i])} − ${esc(lv[f][c.j])}`,
        f_(c.est),
        f_(c.se),
        f_(c.t),
        pv(c.p),
        f_(c.d),
      ])
    );
  });
  sec.tables.push(
    apaTable(
      `Medias marginales estimadas de ${yName}`,
      ['Factor', 'Nivel', '<i>M</i> marginal estimada', '<i>EE</i>', 'IC 95 %'],
      emRows,
      `Promedian sin ponderar las casillas del resto de factores${cNames.length ? ', con las covariables en su media' : ''} (como emmeans, JASP y SPSS).`
    )
  );
  sec.tables.push(
    apaTable(
      `Comparaciones de las medias marginales estimadas de ${yName}`,
      ['Factor', 'Comparación', 'Diferencia', '<i>EE</i>', `<i>t</i>(${g.dfE})`, '<i>p</i>', '<i>d</i> de Cohen'],
      prRows,
      '<i>p</i> con ajuste de Tukey cuando el factor tiene más de dos niveles. <i>d</i> = diferencia / √<i>MC</i><sub>error</sub> (como JASP).'
    )
  );
  if (L[1] <= 8) {
    const e2 = g.emm([0, 1]);
    sec.charts.push(
      fig(
        `Interacción ${fNames[0]} × ${fNames[1]}: medias marginales estimadas`,
        CH.interaction(
          lv[0],
          lv[1].map((b, j) => ({
            name: b,
            means: lv[0].map((_, i) => e2.find(e => e.levels[0] === i && e.levels[1] === j).em),
            ci: lv[0].map((_, i) => {
              const e = e2.find(x => x.levels[0] === i && x.levels[1] === j);
              return [e.em - tc * e.se, e.em + tc * e.se];
            }),
          })),
          yName
        ),
        CH.legend(lv[1])
      )
    );
  }
}
/** Redacción APA y código R del ANOVA o ANCOVA factorial */
function factorialGTextAndCode({ g, cNames, design, fNames, yName, sec, title, tName }) {
  const st = t => `<i>F</i>(${t.df}, ${g.dfE}) = ${f(t.F)}, ${pt(t.p)}, η²<sub>p</sub> = ${nz(t.peta2.toFixed(3))}`;
  const inter = g.terms.filter(t => t.factors && t.factors.length > 1),
    sigI = inter.filter(t => t.p < 0.05);
  let txt = `Se realizó un${cNames.length ? 'a ANCOVA' : ' ANOVA'} factorial ${design} para analizar el efecto de ${list(fNames.map(esc))} sobre ${esc(yName)}${cNames.length ? `, controlando ${list(cNames.map(esc))}` : ''}. `;
  txt +=
    g.terms
      .filter(t => !(t.factors && t.factors.length > 1))
      .map(
        t =>
          `${t.cov !== undefined ? `La covariable ${tName(t)}` : `El efecto principal de ${tName(t)}`} ${t.p < 0.05 ? 'fue' : 'no fue'} estadísticamente significativ${t.cov !== undefined ? 'a' : 'o'}, ${st(t)}.`
      )
      .join(' ') + ' ';
  txt += inter
    .map(t => `La interacción ${tName(t)} ${t.p < 0.05 ? 'fue' : 'no fue'} estadísticamente significativa, ${st(t)}.`)
    .join(' ');
  if (sigI.length) {
    txt +=
      ' Las interacciones significativas indican que el efecto de un factor depende del nivel de otro (véase la figura), por lo que los efectos principales implicados deben interpretarse con cautela.';
    sec.checks.push(
      chk(
        'info',
        'Hay interacciones significativas: analiza los efectos simples (el código R incluye cómo hacerlo con emmeans).'
      )
    );
  }
  sec.text.push(txt);
  const Y = rn(yName),
    FS = fNames.map(rn).join(' * '),
    CS = cNames.map(rn).join(' + ');
  sec.code =
    `# ${cNames.length ? 'ANCOVA' : 'ANOVA'} factorial: ${title}\noptions(contrasts = c("contr.sum", "contr.poly"))\nmodelo <- lm(${Y} ~ ${FS}${CS ? ' + ' + CS : ''}, data = datos)\ncar::Anova(modelo, type = 3)\neffectsize::eta_squared(car::Anova(modelo, type = 3), partial = TRUE)\neffectsize::omega_squared(car::Anova(modelo, type = 3), partial = TRUE)\n` +
    `aggregate(modelo$model[[1]], by = modelo$model[, c(${fNames.map(rq).join(', ')}), drop = FALSE], FUN = function(x) c(n = length(x), M = mean(x), DT = sd(x)))  # descriptivos por casilla\ncar::leveneTest(modelo$model[[1]] ~ interaction(modelo$model[, c(${fNames.map(rq).join(', ')})], drop = TRUE), center = mean)  # Levene entre casillas\nshapiro.test(residuals(modelo))\n` +
    fNames
      .map(
        nm =>
          `emmeans::emmeans(modelo, ${rq(nm)})  # medias marginales estimadas\npairs(emmeans::emmeans(modelo, ${rq(nm)}), adjust = "tukey")`
      )
      .join('\n') +
    `\n# Efectos simples\nemmeans::joint_tests(modelo, by = ${rq(fNames[1])})` +
    (cNames.length
      ? `\n# Homogeneidad de pendientes\nanova(modelo, update(modelo, . ~ . + (${fNames.map(rn).join(' + ')}):(${CS})))`
      : '');
}

export { runFactorial, runFactorialG };
