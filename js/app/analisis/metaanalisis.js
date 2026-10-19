/* Tharp · aplicación · Análisis: Metaanálisis */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, pt, pv, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';

// Columnas que necesita cada tipo de tamaño del efecto, su nombre en el texto y en las tablas
const META_COLUMNAS = {
  SMD: ['M1', 'S1', 'N1', 'M2', 'S2', 'N2'],
  MD: ['M1', 'S1', 'N1', 'M2', 'S2', 'N2'],
  OR: ['A', 'B', 'C', 'D'],
  COR: ['R', 'N'],
  GEN: ['Y', 'E'],
};
const META_NOMBRE = {
  SMD: 'g de Hedges',
  MD: 'diferencia de medias',
  OR: 'odds ratio',
  COR: 'r',
  GEN: 'tamaño del efecto',
};
const META_CABECERA = {
  SMD: '<i>g</i> de Hedges',
  MD: 'Diferencia de medias',
  OR: 'Odds ratio',
  COR: '<i>r</i>',
  GEN: 'Tamaño del efecto',
};
const META_CAMPO = {
  M1: 'media 1',
  S1: 'DT 1',
  N1: 'n 1',
  M2: 'media 2',
  S2: 'DT 2',
  N2: 'n 2',
  A: 'eventos 1',
  B: 'no eventos 1',
  C: 'eventos 2',
  D: 'no eventos 2',
  R: 'r',
  N: 'n',
  Y: 'efecto',
  E: 'error típico',
};
// Metaanálisis: una fila por estudio; tamaños del efecto como metafor::escalc y modelo como rma (REML, DL o efectos fijos)
function runMeta(o) {
  const T = o.type,
    need = META_COLUMNAS[T];
  const ENAME = META_NOMBRE[T],
    HEAD = META_CABECERA[T],
    AXL = HEAD.replace(/<\/?i>/g, ''),
    back = T === 'OR' ? Math.exp : T === 'COR' ? Math.tanh : v => v,
    ref = 0;
  const sec = nuevaSeccion(`Metaanálisis (${ENAME})`, {
    test: `Metaanálisis de ${{ REML: 'efectos aleatorios (REML)', DL: 'efectos aleatorios (DerSimonian-Laird)', FE: 'efectos fijos' }[o.method]}`,
  });
  const names = need.map(k => o.cols[k]);
  if (names.some(nm => !nm || !vByName(nm))) {
    sec.error = `Elige en el análisis las columnas de cada estudio: ${need
      .filter(k => !o.cols[k] || !vByName(o.cols[k]))
      .map(k => META_CAMPO[k])
      .join(', ')} (una fila por estudio).`;
    return sec;
  }
  if (new Set(names).size < names.length) {
    sec.error = 'Cada dato debe estar en una columna distinta.';
    return sec;
  }
  const C = Object.fromEntries(need.map(k => [k, numOf(vByName(o.cols[k]))])),
    lab = o.label && vByName(o.label) ? vByName(o.label).raw : null;
  const ok = i =>
    need.every(k => C[k][i] !== null) &&
    (T === 'COR'
      ? C.N[i] > 3 && Math.abs(C.R[i]) < 1
      : T === 'GEN'
        ? C.E[i] > 0
        : T === 'OR'
          ? need.every(k => C[k][i] >= 0)
          : C.N1[i] > 1 && C.N2[i] > 1 && C.S1[i] > 0 && C.S2[i] > 0);
  const idx = ST.rows.map((_, i) => i).filter(ok),
    k = idx.length;
  if (k < 2) {
    sec.error = 'Se necesitan al menos 2 estudios con todos los datos válidos.';
    return sec;
  }
  const es = idx.map(i =>
    T === 'GEN'
      ? { yi: C.Y[i], vi: C.E[i] ** 2 }
      : S.effectSize(
          T,
          T === 'OR'
            ? { a: C.A[i], b: C.B[i], c: C.C[i], d: C.D[i] }
            : T === 'COR'
              ? { r: C.R[i], n: C.N[i] }
              : { m1: C.M1[i], sd1: C.S1[i], n1: C.N1[i], m2: C.M2[i], sd2: C.S2[i], n2: C.N2[i] }
        )
  );
  const y = es.map(e => e.yi),
    v = es.map(e => e.vi),
    m = S.meta(y, v, o.method);
  if (!m) {
    sec.error = 'No se pudo estimar el modelo.';
    return sec;
  }
  const zq = 1.959963984540054,
    L = (i, q) => (lab ? String(lab[i] === null ? `Fila ${i + 1}` : lab[i]) : `Estudio ${q + 1}`),
    B = x => f(back(x)),
    RE = o.method !== 'FE';
  sec.decision = `Metaanálisis de ${k} estudios (${ENAME}) con un modelo de ${RE ? `efectos aleatorios (${o.method === 'REML' ? 'REML' : 'DerSimonian-Laird'})` : 'efectos fijos'}.`;
  sec.why.push(
    RE
      ? 'El modelo de efectos aleatorios supone que cada estudio estima un efecto distinto (por diferencias de población, diseño o medida) y estima su media y su variabilidad (τ²); es el recomendado cuando los estudios no son réplicas exactas.'
      : 'El modelo de efectos fijos supone que todos los estudios estiman el mismo efecto; solo es apropiado si son réplicas prácticamente idénticas.'
  );
  if (T === 'SMD')
    sec.why.push(
      'g de Hedges: diferencia de medias estandarizada con la corrección del sesgo en muestras pequeñas (como metafor::escalc).'
    );
  if (T === 'OR')
    sec.why.push(
      'Las odds ratio se combinan en escala logarítmica y se muestran en la original; si alguna casilla es 0, se suma 0.5 a las cuatro de ese estudio.'
    );
  if (T === 'COR')
    sec.why.push('Las correlaciones se combinan con la transformación z de Fisher y se muestran como r.');
  metaTablesAndChecks({ sec, HEAD, idx, RE, k, B, m, T, v, L, y, zq });
  metaReport({ sec, ENAME, idx, m, RE, AXL, T, back, ref, y, v, o, k, B, names, lab, L, zq });
  return sec;
}
/** Tablas de estudios, del modelo y de heterogeneidad; Egger y supuestos */
function metaTablesAndChecks({ sec, HEAD, idx, RE, k, B, m, T, v, L, y, zq }) {
  sec.tables.push(
    apaTable(
      'Estudios incluidos',
      ['Estudio', HEAD, 'IC 95 %', 'Peso (%)'],
      idx.map((i, q) => {
        const se_ = Math.sqrt(v[q]);
        return [esc(L(i, q)), B(y[q]), `[${B(y[q] - zq * se_)}, ${B(y[q] + zq * se_)}]`, f(m.weights[q], 1)];
      })
    )
  );
  sec.tables.push(
    apaTable(
      'Efecto combinado',
      ['<i>k</i>', HEAD, 'IC 95 %', '<i>z</i>', '<i>p</i>'].concat(RE ? ['Intervalo de predicción 95 %'] : []),
      [
        [k, B(m.est), `[${B(m.ci[0][0])}, ${B(m.ci[0][1])}]`, f(m.z[0]), pv(m.pval[0])].concat(
          RE ? [`[${B(m.pi[0])}, ${B(m.pi[1])}]`] : []
        ),
      ],
      `${T === 'OR' || T === 'COR' ? `Estimación en escala ${T === 'OR' ? 'logarítmica' : 'z de Fisher'}: ${f(m.est, 3)} (EE = ${f(m.se[0], 3)}). ` : `EE = ${f(m.se[0], 3)}. `}${RE ? 'El intervalo de predicción indica dónde estaría el efecto de un estudio nuevo.' : ''}`
    )
  );
  const ci = m.tau2CI;
  sec.tables.push(
    apaTable(
      'Heterogeneidad',
      ['<i>Q</i>', '<i>gl</i>', '<i>p</i>', 'I² (%)']
        .concat(RE ? ['IC 95 % (I²)', 'τ²', 'IC 95 % (τ²)'] : [])
        .concat(['H²']),
      [
        [f(m.QE), m.dfQ, pv(m.pQ), f(m.I2, 1)]
          .concat(
            RE
              ? [`[${f(ci.I2[0], 1)}, ${f(ci.I2[1], 1)}]`, f(m.tau2, 3), `[${f(ci.tau2[0], 3)}, ${f(ci.tau2[1], 3)}]`]
              : []
          )
          .concat([f(m.H2)]),
      ],
      `I²: proporción de la variabilidad debida a diferencias reales entre estudios (orientativo: 25 % baja, 50 % moderada, 75 % alta). ${RE ? 'IC de τ² e I² por el método del perfil de Q.' : ''}`
    )
  );
  if (m.egger)
    sec.tables.push(
      apaTable(
        'Prueba de Egger (asimetría del embudo)',
        ['<i>z</i>', '<i>p</i>', 'Efecto con EE → 0', 'IC 95 %'],
        [[f(m.egger.z), pv(m.egger.p), B(m.egger.b), `[${B(m.egger.ci[0])}, ${B(m.egger.ci[1])}]`]],
        'Metarregresión del efecto sobre su error típico (como metafor::regtest). Una p < .05 sugiere sesgo de publicación o efectos de estudios pequeños.'
      )
    );
  sec.checks.push(
    chk(
      k >= 10 ? 'ok' : 'info',
      `Número de estudios: ${k}.${k >= 10 ? '' : ' Con menos de 10 estudios, la prueba de Egger y el gráfico de embudo tienen poca potencia y τ² se estima con poca precisión.'}`
    )
  );
  sec.checks.push(
    chk(
      m.pQ >= 0.05 ? 'ok' : 'info',
      `Heterogeneidad: Q(${m.dfQ}) = ${f(m.QE)}, ${pt(m.pQ)}; I² = ${f(m.I2, 1)} %.${m.pQ < 0.05 ? (RE ? ' Hay heterogeneidad: el modelo de efectos aleatorios la tiene en cuenta; conviene explorar sus causas (subgrupos o metarregresión).' : ' Hay heterogeneidad: un modelo de efectos aleatorios sería más adecuado.') : ''}`
    )
  );
}
/** Gráficos, redacción APA y código R del metaanálisis */
function metaReport({ sec, ENAME, idx, m, RE, AXL, T, back, ref, y, v, o, k, B, names, lab, L, zq }) {
  metaCharts({ sec, ENAME, idx, m, RE, AXL, T, back, ref, y, v, L, zq });
  metaText({ sec, RE, o, k, T, B, m });
  metaRCode({ names, T, sec, ENAME, o, lab, RE, m });
}

/** Gráficos de bosque y de embudo */
function metaCharts({ sec, ENAME, idx, m, RE, AXL, T, back, ref, y, v, L, zq }) {
  sec.charts.push(
    fig(
      `Gráfico de bosque (${ENAME})`,
      CH.metaForest(
        idx.map((i, q) => {
          const se_ = Math.sqrt(v[q]);
          return { label: L(i, q), y: y[q], lo: y[q] - zq * se_, hi: y[q] + zq * se_, w: m.weights[q] };
        }),
        { y: m.est, lo: m.ci[0][0], hi: m.ci[0][1], pi: RE ? m.pi : [NaN, NaN] },
        `${AXL}${T === 'OR' ? ' (escala logarítmica)' : ''}`,
        back,
        ref,
        T === 'OR' ? 'log' : T === 'COR' ? 'tanh' : ''
      ),
      '',
      true
    )
  );
  sec.charts.push(
    fig(
      'Gráfico de embudo',
      CH.funnel(y, v.map(Math.sqrt), m.est, T === 'OR' ? 'log(odds ratio)' : T === 'COR' ? 'z de Fisher' : ENAME)
    )
  );
}

/** Redacción APA del metaanálisis: efecto combinado, heterogeneidad y Egger */
function metaText({ sec, RE, o, k, T, B, m }) {
  sec.text.push(
    `Se realizó un metaanálisis de ${RE ? `efectos aleatorios (estimación de τ² por ${o.method === 'REML' ? 'máxima verosimilitud restringida' : 'DerSimonian-Laird'})` : 'efectos fijos'} con ${k} estudios. El efecto combinado fue ${{ SMD: '<i>g</i>', MD: 'una diferencia de medias de', OR: '<i>OR</i>', COR: '<i>r</i>', GEN: '' }[T]}${T === 'MD' || T === 'GEN' ? ' ' : ' = '}${B(m.est)}, IC 95 % [${B(m.ci[0][0])}, ${B(m.ci[0][1])}], <i>z</i> = ${f(m.z[0])}, ${pt(m.pval[0])}. ` +
      `La heterogeneidad ${m.pQ < 0.05 ? 'fue' : 'no fue'} estadísticamente significativa, <i>Q</i>(${m.dfQ}) = ${f(m.QE)}, ${pt(m.pQ)}, I² = ${f(m.I2, 1)} %${RE ? `, τ² = ${f(m.tau2, 3)}; el intervalo de predicción del 95 % fue [${B(m.pi[0])}, ${B(m.pi[1])}]` : ''}.` +
      (m.egger
        ? ` La prueba de Egger ${m.egger.p < 0.05 ? 'indicó' : 'no indicó'} asimetría en el gráfico de embudo, <i>z</i> = ${f(m.egger.z)}, ${pt(m.egger.p)}.`
        : '')
  );
}

/** Código R (metafor) que reproduce el metaanálisis */
function metaRCode({ names, T, sec, ENAME, o, lab, RE, m }) {
  const cn = kk => rq(o.cols[kk]),
    dsel = `dm <- datos[complete.cases(datos[, c(${names.map(rq).join(', ')})]), ]`;
  const esc_ = {
    SMD: `es <- escalc("SMD", m1i = dm[[${cn('M1')}]], sd1i = dm[[${cn('S1')}]], n1i = dm[[${cn('N1')}]], m2i = dm[[${cn('M2')}]], sd2i = dm[[${cn('S2')}]], n2i = dm[[${cn('N2')}]])`,
    MD: `es <- escalc("MD", m1i = dm[[${cn('M1')}]], sd1i = dm[[${cn('S1')}]], n1i = dm[[${cn('N1')}]], m2i = dm[[${cn('M2')}]], sd2i = dm[[${cn('S2')}]], n2i = dm[[${cn('N2')}]])`,
    OR: `es <- escalc("OR", ai = dm[[${cn('A')}]], bi = dm[[${cn('B')}]], ci = dm[[${cn('C')}]], di = dm[[${cn('D')}]], add = .5, to = "only0")`,
    COR: `es <- escalc("ZCOR", ri = dm[[${cn('R')}]], ni = dm[[${cn('N')}]])`,
    GEN: `es <- data.frame(yi = dm[[${cn('Y')}]], vi = dm[[${cn('E')}]]^2)`,
  }[T];
  const tr = T === 'OR' ? ', transf = exp' : T === 'COR' ? ', transf = transf.ztor' : '';
  sec.code =
    `# Metaanálisis (${ENAME})\nlibrary(metafor)\n${dsel}\n${esc_}\nprint(es, digits = 7)\nm <- rma(yi, vi, data = es, method = "${o.method}", control = list(threshold = 1e-10))${lab ? `\nm$slab <- as.character(dm[[${rq(o.label)}]])` : ''}\nprint(m, digits = 7)\n` +
    `print(predict(m${tr}), digits = 7)  # efecto combinado${RE ? ' e intervalo de predicción' : ''}${tr ? ' en la escala original' : ''}\nprint(cbind(yi = es$yi, peso = weights(m)), digits = 7)\n` +
    (tr
      ? `print(cbind(efecto = ${T === 'OR' ? 'exp' : 'transf.ztor'}(es$yi), ic_inf = ${T === 'OR' ? 'exp' : 'transf.ztor'}(es$yi - qnorm(.975) * sqrt(es$vi)), ic_sup = ${T === 'OR' ? 'exp' : 'transf.ztor'}(es$yi + qnorm(.975) * sqrt(es$vi))), digits = 7)  # cada estudio en la escala original\n`
      : `print(cbind(ic_inf = es$yi - qnorm(.975) * sqrt(es$vi), ic_sup = es$yi + qnorm(.975) * sqrt(es$vi)), digits = 7)  # IC de cada estudio\n`) +
    (RE ? `print(confint(m, control = list(tol = 1e-10)), digits = 7)  # IC de τ², I² y H² (perfil de Q)\n` : '') +
    (m.egger
      ? `eg <- regtest(m); eg\nprint(c(z = eg$zval, p = eg$pval, limite = eg$est, ic_inf = eg$ci.lb, ic_sup = eg$ci.ub), digits = 7)  # Egger${tr ? ` (límite en la escala original: ${T === 'OR' ? 'exp' : 'transf.ztor'}(eg$est))` : ''}\n${tr ? `print(${T === 'OR' ? 'exp' : 'transf.ztor'}(c(eg$est, eg$ci.lb, eg$ci.ub)), digits = 7)\n` : ''}`
      : '') +
    `forest(m${tr ? `, atransf = ${T === 'OR' ? 'exp' : 'transf.ztor'}` : ''})\nfunnel(m)`;
}

export { runMeta };
