/* Tharp · aplicación · Análisis: MANOVA y MANCOVA */
import S from '../../motor/index.js';
import { esc } from '../graficos.js';
import { catOf, numOf, ordOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, list, nz, pt, pv, r2s, rq } from '../formato.js';
import { apaTable, chk, nuevaSeccion } from '../resultados/piezas.js';
import { maxOf, minOf } from '../utilidades.js';

// MANOVA / MANCOVA con uno o dos factores entre sujetos
function runManova(yNames, fNames, cNames) {
  fNames = [...new Set(fNames)].filter(f => !yNames.includes(f));
  cNames = cNames.filter(c => !yNames.includes(c));
  const sec = nuevaSeccion(
    `${cNames.length ? 'MANCOVA' : 'MANOVA'}: ${yNames.length ? yNames.join(', ') + ' según ' : 'según '}${fNames.join(' × ')}${cNames.length ? `, controlando ${cNames.join(', ')}` : ''}`,
    { test: `${cNames.length ? 'MANCOVA' : 'MANOVA'} (SC tipo III)` }
  );
  if (yNames.length < 2) {
    sec.error = 'Selecciona al menos dos variables dependientes.';
    return sec;
  }
  if (!fNames.length) {
    sec.error = 'Elige un factor.';
    return sec;
  }
  const Yv = yNames.map(v => numOf(vByName(v))),
    fc = fNames.map(nm => catOf(vByName(nm))),
    cc = cNames.map(nm => numOf(vByName(nm)));
  const idx = ST.rows
      .map((_, i) => i)
      .filter(i => Yv.every(y => y[i] !== null) && fc.every(c => c[i] !== null) && cc.every(c => c[i] !== null)),
    n = idx.length;
  const lv = fNames.map((nm, f) =>
      ordOf(
        vByName(nm),
        idx.map(i => fc[f][i])
      )
    ),
    L = lv.map(l => l.length),
    p = yNames.length;
  if (L.some(k => k < 2)) {
    sec.error = 'Cada factor necesita al menos 2 niveles con datos.';
    return sec;
  }
  const Fm = idx.map(i => fc.map((c, f) => lv[f].indexOf(c[i]))),
    Ys = Yv.map(y => idx.map(i => y[i])),
    C = cc.map(c => idx.map(i => c[i]));
  const cellOf = r => r.join('|'),
    cells = new Map();
  Fm.forEach((r, q) => {
    const k_ = cellOf(r);
    if (!cells.has(k_)) cells.set(k_, []);
    cells.get(k_).push(q);
  });
  const nCells = L.reduce((a, b) => a * b, 1),
    minCell = minOf([...cells.values()].map(c => c.length));
  if (cells.size < nCells || minCell < 2) {
    sec.error = 'Hay combinaciones de niveles sin datos o con un solo caso. Agrupa niveles o usa un único factor.';
    return sec;
  }
  const r = S.manova(Ys, Fm, L, C);
  if (!r) {
    sec.error = 'No se pudo estimar el modelo (alguna variable dependiente es combinación exacta de otras).';
    return sec;
  }
  const tName = t => (t.cov !== undefined ? esc(cNames[t.cov]) : t.factors.map(f => esc(fNames[f])).join(' × '));
  manovaChecksAndDescriptives({ sec, p, yNames, fNames, cNames, L, n, minCell, cells, Ys, lv });
  const { uni, aB } = manovaTests({ r, sec, yNames, p, tName, Ys, Fm, L, C });
  manovaTextAndCode({ cNames, yNames, fNames, r, sec, tName, uni, aB });
  return sec;
}
/** Motivos, supuestos (M de Box, correlación entre dependientes) y descriptivos por casilla */
function manovaChecksAndDescriptives({ sec, p, yNames, fNames, cNames, L, n, minCell, cells, Ys, lv }) {
  sec.why.push(
    `${p} variables dependientes cuantitativas (${list(yNames.map(esc))}) y ${fNames.length === 1 ? 'un factor' : 'dos factores'} entre sujetos (${fNames.map((nm, f) => `${esc(nm)}: ${L[f]} niveles`).join('; ')})${cNames.length ? `, ajustando por ${list(cNames.map(esc))}` : ''}.`
  );
  sec.why.push(
    'La MANOVA contrasta si los grupos difieren en el conjunto de variables dependientes teniendo en cuenta sus correlaciones, y controla el error tipo I frente a hacer una ANOVA por variable. Se interpreta la traza de Pillai, la más robusta con grupos desiguales o heterogeneidad de covarianzas.'
  );
  sec.decision = `Se realizó una ${cNames.length ? 'MANCOVA' : 'MANOVA'} ${L.join('×')} con ${p} variables dependientes y ${n} casos (SC de tipo III).`;
  if (minCell < p)
    sec.checks.push(
      chk(
        'no',
        `La casilla más pequeña tiene ${minCell} casos, menos que el número de variables dependientes (${p}): la MANOVA pierde potencia y la M de Box no es fiable.`
      )
    );
  const groups = [...cells.values()].map(qs => qs.map(q => Ys.map(y => y[q])));
  if (minCell > p) {
    const bm = S.boxM(groups);
    sec.checks.push(
      chk(
        bm.p >= 0.001 ? 'ok' : 'no',
        `Igualdad de matrices de covarianzas (M de Box): χ²(${bm.df}) = ${f(bm.chi)}, ${pt(bm.p)}.${bm.p >= 0.001 ? ' Se cumple (criterio habitual: p > .001).' : ' No se cumple: por eso se interpreta la traza de Pillai, más robusta.'}`
      )
    );
  }
  yNames.forEach((nm, d) => {
    const lev = S.levene(groups.map(G => G.map(row => row[d])));
    sec.checks.push(
      chk(
        lev.p >= 0.05 ? 'ok' : 'no',
        `Homogeneidad de varianzas en ${esc(nm)} (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.`
      )
    );
  });
  const R_ = S.corMatrix(Ys[0].map((_, i) => Ys.map(y => y[i]))),
    rs = [];
  for (let a = 0; a < p; a++) for (let b = a + 1; b < p; b++) rs.push(R_[a][b]);
  sec.checks.push(
    chk(
      maxOf(rs.map(Math.abs)) < 0.9 ? 'info' : 'no',
      `Correlaciones entre las variables dependientes: de ${r2s(minOf(rs))} a ${r2s(maxOf(rs))}.${maxOf(rs.map(Math.abs)) >= 0.9 ? ' Hay correlaciones muy altas (≥ .90): posible multicolinealidad; valora quitar alguna variable.' : ' La MANOVA tiene más sentido con correlaciones moderadas.'}`
    )
  );
  // descriptivos por casilla
  const dRows = [...cells.entries()].map(([k_, qs]) =>
    [
      k_
        .split('|')
        .map((l, f) => esc(lv[f][+l]))
        .join(' · '),
      qs.length,
    ].concat(
      Ys.map(y => {
        const x = qs.map(q => y[q]);
        return `${f(S.mean(x))} (${f(S.sd(x))})`;
      })
    )
  );
  sec.tables.push(
    apaTable(
      'Medias (desviaciones típicas) por grupo',
      [fNames.map(esc).join(' · '), '<i>n</i>'].concat(yNames.map(esc)),
      dRows
    )
  );
}
/** Pruebas multivariadas (Pillai, Wilks, Hotelling, Roy) y ANOVA univariadas de seguimiento */
function manovaTests({ r, sec, yNames, p, tName, Ys, Fm, L, C }) {
  const TN = {
      pillai: 'Traza de Pillai',
      wilks: 'Lambda de Wilks',
      hotelling: 'Traza de Hotelling-Lawley',
      roy: 'Raíz mayor de Roy',
    },
    mRows = [];
  r.terms.forEach(t =>
    Object.keys(TN).forEach((k, q) => {
      const o = t.tests[k];
      mRows.push([
        q === 0 ? tName(t) : '',
        TN[k],
        nz(o.stat.toFixed(3)),
        f(o.F),
        +o.df1.toFixed(2),
        +o.df2.toFixed(2),
        pv(o.p),
        k === 'pillai' ? nz(t.eta2.pillai.toFixed(3)) : k === 'wilks' ? nz(t.eta2.wilks.toFixed(3)) : '',
      ]);
    })
  );
  sec.tables.push(
    apaTable(
      'Contrastes multivariados',
      [
        'Efecto',
        'Estadístico',
        'Valor',
        '<i>F</i>',
        '<i>gl</i><sub>1</sub>',
        '<i>gl</i><sub>2</sub>',
        '<i>p</i>',
        'η²<sub>p</sub>',
      ],
      mRows,
      'SC de tipo III (como SPSS y car::Anova). η²<sub>p</sub> multivariado: V/s para Pillai y 1 − Λ<sup>1/s</sup> para Wilks (s = mín(variables, gl del efecto)). La F de Roy es una cota superior.'
    )
  );
  // ANOVA univariadas de seguimiento
  const uni = yNames.map((nm, d) => S.glmFactorial(Ys[d], Fm, L, C)),
    uRows = [];
  uni.forEach((g, d) =>
    g.terms.forEach((t, q) =>
      uRows.push([
        q === 0 ? esc(yNames[d]) : '',
        tName(t),
        f(t.F),
        `${t.df}, ${g.dfE}`,
        pv(t.p),
        nz(t.peta2.toFixed(3)),
      ])
    )
  );
  const aB = 0.05 / p;
  sec.tables.push(
    apaTable(
      'ANOVA univariadas de seguimiento',
      ['Variable dependiente', 'Efecto', '<i>F</i>', '<i>gl</i>', '<i>p</i>', 'η²<sub>p</sub>'],
      uRows,
      `Se interpretan solo si el contraste multivariado del efecto es significativo. Con corrección de Bonferroni, α = .05 / ${p} = ${nz(aB.toFixed(4))}.`
    )
  );
  return { uni, aB };
}
/** Redacción APA y código R de la MANOVA */
function manovaTextAndCode({ cNames, yNames, fNames, r, sec, tName, uni, aB }) {
  const st = t =>
    `<i>V</i> = ${nz(t.tests.pillai.stat.toFixed(2))}, <i>F</i>(${+t.tests.pillai.df1.toFixed(2)}, ${+t.tests.pillai.df2.toFixed(2)}) = ${f(t.tests.pillai.F)}, ${pt(t.tests.pillai.p)}, η²<sub>p</sub> = ${nz(t.eta2.pillai.toFixed(2))}`;
  let txt =
    `Se realizó una ${cNames.length ? 'MANCOVA' : 'MANOVA'} para comparar ${list(yNames.map(esc))} según ${list(fNames.map(esc))}${cNames.length ? `, controlando ${list(cNames.map(esc))}` : ''}. Según la traza de Pillai, ` +
    r.terms
      .map(
        t =>
          `${t.factors && t.factors.length > 1 ? `la interacción ${tName(t)}` : t.cov !== undefined ? `la covariable ${tName(t)}` : `el efecto de ${tName(t)}`} ${t.tests.pillai.p < 0.05 ? 'fue' : 'no fue'} estadísticamente significativ${t.cov !== undefined || (t.factors && t.factors.length > 1) ? 'a' : 'o'}, ${st(t)}`
      )
      .join('; ') +
    '.';
  r.terms.forEach((t, ti) => {
    if (t.tests.pillai.p >= 0.05 || t.cov !== undefined) return;
    const sigD = uni.map((g, d) => ({ d, t: g.terms[ti] })).filter(o => o.t.p < aB);
    txt += sigD.length
      ? ` Las ANOVA de seguimiento (α corregida = ${nz(aB.toFixed(3))}) mostraron diferencias según ${tName(t)} en ${list(sigD.map(o => `${esc(yNames[o.d])} (<i>F</i>(${o.t.df}, ${uni[o.d].dfE}) = ${f(o.t.F)}, ${pt(o.t.p)}, η²<sub>p</sub> = ${nz(o.t.peta2.toFixed(2))})`))}.`
      : ` Ninguna ANOVA de seguimiento de ${tName(t)} fue significativa con la α corregida.`;
  });
  sec.text.push(txt);
  const Yc = `cbind(${yNames.map(v => `\`${v}\``).join(', ')})`,
    Fs = fNames.map(v => `factor(\`${v}\`)`).join(' * '),
    Cs = cNames.map(v => `\`${v}\``).join(' + ');
  sec.code =
    `# ${cNames.length ? 'MANCOVA' : 'MANOVA'}\noptions(contrasts = c("contr.sum", "contr.poly"))\nd <- datos[complete.cases(datos[, c(${yNames.concat(fNames, cNames).map(rq).join(', ')})]), ]\nmodelo <- lm(${Yc} ~ ${Fs}${Cs ? ' + ' + Cs : ''}, data = d)\nm3 <- car::Anova(modelo, type = 3)\nfor (ts in c("Pillai", "Wilks", "Hotelling-Lawley", "Roy")) print(summary(m3, test = ts, univariate = FALSE))\n` +
    `for (f in c(${fNames.map(rq).join(', ')})) print(aggregate(d[, c(${yNames.map(rq).join(', ')})], by = list(nivel = d[[f]]), FUN = function(x) c(n = length(x), M = mean(x), DT = sd(x))))  # medias y DT\nheplots::boxM(d[, c(${yNames.map(rq).join(', ')})], interaction(${fNames.map(v => `d[[${rq(v)}]]`).join(', ')}))  # M de Box\n# ANOVA de seguimiento\n` +
    yNames.map(v => `car::Anova(lm(\`${v}\` ~ ${Fs}${Cs ? ' + ' + Cs : ''}, data = d), type = 3)`).join('\n');
}

export { runManova };
