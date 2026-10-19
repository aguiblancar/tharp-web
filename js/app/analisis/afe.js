/* Tharp · aplicación · Análisis: Análisis factorial exploratorio */
import CH, { esc } from '../graficos.js';
import S from '../../motor/index.js';
import { numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, list, nz, pt, pv, r2s, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion } from '../resultados/piezas.js';
import { maxOf, minOf } from '../utilidades.js';

function runEfa(names, nSel, rot, ext = 'pa') {
  const PCA = ext === 'pca',
    EXT = {
      pa: 'ejes principales',
      minres: 'mínimos residuos (MinRes)',
      ml: 'máxima verosimilitud',
      pca: 'componentes principales',
    }[ext];
  const OBL = ['oblimin', 'promax', 'geomin'].includes(rot),
    U = PCA ? 'componente' : 'factor',
    Us = PCA ? 'componentes' : 'factores';
  const ROTN =
    {
      oblimin: 'oblimin',
      promax: 'promax',
      geomin: 'geomin',
      varimax: 'varimax',
      quartimax: 'quartimax',
      equamax: 'equamax',
      none: 'sin rotación',
    }[rot] || rot;
  const sec = nuevaSeccion(PCA ? 'Análisis de componentes principales' : 'Análisis factorial exploratorio', {
    test: '',
  });
  const vars = names.map(vByName).filter(v => v && v.type === 'num'),
    p = vars.length;
  if (p < 3) {
    sec.error = 'Selecciona al menos tres ítems cuantitativos.';
    return sec;
  }
  const cols = vars.map(numOf),
    idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)),
    n = idx.length;
  if (n < p + 2) {
    sec.error = `Hay muy pocos casos completos (${n}) para ${p} ítems.`;
    return sec;
  }
  const X = idx.map(i => cols.map(c => c[i]));
  if (vars.some((_, j) => S.sd(X.map(r => r[j])) === 0)) {
    sec.error = 'Algún ítem tiene el mismo valor en todos los casos. Exclúyelo.';
    return sec;
  }
  const R = S.corMatrix(X),
    adec = S.kmoBartlett(R, n);
  if (!adec || !isFinite(adec.kmo)) {
    sec.error =
      'La matriz de correlaciones es singular: algún ítem es combinación exacta de otros (por ejemplo, un total de la escala). Exclúyelo.';
    return sec;
  }
  const eig = S.eigSym(R).values,
    pa = S.parallelAnalysis(n, p, eig, 100);
  let m = nSel === 'auto' ? pa.nfactors : +nSel;
  const auto = nSel === 'auto';
  if (m < 1) {
    m = 1;
    sec.checks.push(
      chk(
        'no',
        'El análisis paralelo no indica ningún factor por encima del azar: los ítems apenas comparten varianza. Se muestra la solución de un factor solo como referencia.'
      )
    );
  }
  if (m > p - 1) m = p - 1;
  const r = S.efa(X, m, rot, ext),
    names2 = vars.map(v => v.name),
    F = Array.from({ length: m }, (_, j) => `${PCA ? 'C' : 'F'}${j + 1}`);
  const kq = r.adec.kmo,
    kl =
      kq >= 0.9
        ? 'excelente'
        : kq >= 0.8
          ? 'muy buena'
          : kq >= 0.7
            ? 'buena'
            : kq >= 0.6
              ? 'aceptable'
              : kq >= 0.5
                ? 'pobre'
                : 'inaceptable';
  sec.test = `${PCA ? 'Análisis de componentes principales' : `Análisis factorial exploratorio (${EXT}`}${m > 1 && rot !== 'none' ? `${PCA ? ' (' : ', '}rotación ${ROTN})` : PCA ? '' : ')'}`;
  sec.decision = `Se realizó un análisis factorial exploratorio de ${p} ítems con ${n} casos completos, extrayendo ${m} ${m > 1 ? Us : U} ${auto ? 'según el análisis paralelo' : '(número elegido por ti)'} por ${EXT}${m > 1 ? ` con rotación ${rot}` : ''}.`;
  efaWhy({ sec, ext, auto, m, rot, OBL, ROTN, Us });
  const { B, prim, weak } = efaChecks({ sec, kq, kl, vars, r, n, p, ext });
  efaTables({ sec, kq, B, n, p, PCA, eig, m, rot, OBL, F, names2, EXT, ROTN, pa, r });
  efaReport({ OBL, m, r, PCA, EXT, rot, ROTN, p, n, kl, kq, B, auto, Us, U, F, weak, sec, names2, ext, vars, prim });
  return sec;
}
/** Motivos de la extracción, la rotación y el número de factores */
function efaWhy({ sec, ext, auto, m, rot, OBL, ROTN, Us }) {
  sec.why.push(
    'El análisis factorial exploratorio estudia qué dimensiones subyacen a un conjunto de ítems: qué ítems «van juntos» porque miden lo mismo.'
  );
  sec.why.push(
    {
      pa: 'Se usa la extracción por ejes principales, que no exige normalidad multivariante y es robusta con escalas tipo Likert.',
      minres:
        'Extracción por mínimos residuos (MinRes/ULS): minimiza las correlaciones no explicadas; no exige normalidad multivariante y es la opción por defecto de psych y jamovi.',
      ml: 'Extracción por máxima verosimilitud: permite contrastar el ajuste del modelo (χ², RMSEA, TLI), pero asume normalidad multivariante.',
      pca: 'Análisis de componentes principales: resume la varianza total de los ítems en pocos componentes. A diferencia del análisis factorial, no separa la varianza común del error; es útil para reducir datos, no para estudiar constructos latentes.',
    }[ext]
  );
  sec.why.push(
    auto
      ? 'El número de factores lo decide el análisis paralelo de Horn: se retienen los factores cuyos autovalores superan el percentil 95 de los obtenidos con datos aleatorios del mismo tamaño. Es más fiable que el criterio de autovalor mayor que 1.'
      : 'Has fijado tú el número de factores; el análisis paralelo se muestra como referencia.'
  );
  if (m > 1)
    sec.why.push(
      rot === 'none'
        ? 'Sin rotación: solución inicial, difícil de interpretar con varios factores.'
        : OBL
          ? `Rotación ${ROTN} (oblicua): permite que los ${Us} correlacionen, lo habitual en constructos psicológicos y educativos.`
          : `Rotación ${ROTN} (ortogonal): obliga a que los ${Us} sean independientes entre sí.`
    );
}
/** Supuestos y diagnósticos: KMO, MSA, Bartlett, número de factores, cargas débiles o cruzadas, Heywood y ajuste ML */
function efaChecks({ sec, kq, kl, vars, r, n, p, ext }) {
  sec.checks.push(
    chk(
      kq >= 0.6 ? 'ok' : 'no',
      `Adecuación muestral (KMO) = ${nz(kq.toFixed(3))}: ${kl}.${kq < 0.6 ? ' Por debajo de .60 el análisis factorial no es recomendable.' : ''}`
    )
  );
  const lowMsa = vars.filter((_, j) => r.adec.msa[j] < 0.5);
  if (lowMsa.length)
    sec.checks.push(
      chk(
        'no',
        `Ítems con adecuación individual (MSA) < .50: ${list(lowMsa.map(v => esc(v.name)))}. Considera eliminarlos.`
      )
    );
  const B = r.adec.bartlett;
  sec.checks.push(
    chk(
      B.p < 0.05 ? 'ok' : 'no',
      `Esfericidad de Bartlett: χ²(${B.df}) = ${f(B.chi)}, ${pt(B.p)}. ${B.p < 0.05 ? 'Los ítems están suficientemente correlacionados.' : 'Los ítems no están correlacionados: el análisis factorial no tiene sentido.'}`
    )
  );
  sec.checks.push(
    chk(
      n >= 200 ? 'ok' : n >= 100 ? 'info' : 'no',
      `Tamaño muestral: ${n} casos (${f(n / p, 1)} por ítem).${n >= 200 ? '' : n >= 100 ? ' Aceptable; con comunalidades altas los resultados son estables.' : ' Pequeño: los resultados pueden ser inestables.'}`
    )
  );
  const prim = r.L.map(row => {
    const a = row.map(Math.abs),
      mx = maxOf(a);
    return { j: a.indexOf(mx), mx, cross: a.filter(v => v >= 0.32).length > 1 };
  });
  const weak = vars.filter((_, i) => prim[i].mx < 0.4),
    cross = vars.filter((_, i) => prim[i].cross && prim[i].mx >= 0.4),
    hey = vars.filter((_, i) => r.h2[i] > 1);
  sec.checks.push(
    weak.length
      ? chk(
          'no',
          `Ítems sin ninguna carga ≥ .40: ${list(weak.map(v => esc(v.name)))}. No se asocian claramente a ningún factor.`
        )
      : chk('ok', 'Todos los ítems tienen al menos una carga ≥ .40.')
  );
  if (cross.length)
    sec.checks.push(
      chk('info', `Ítems con cargas cruzadas (≥ .32 en más de un factor): ${list(cross.map(v => esc(v.name)))}.`)
    );
  if (hey.length)
    sec.warn = `Caso Heywood: ${list(hey.map(v => esc(v.name)))} ${hey.length > 1 ? 'tienen' : 'tiene'} una comunalidad mayor que 1, lo que indica un problema en la solución (demasiados factores o muestra pequeña). Prueba con menos factores.`;
  if (!r.converged && ext === 'pa')
    sec.checks.push(chk('no', 'La extracción no convergió del todo en 50 iteraciones: interpreta con cautela.'));
  if (ext === 'ml' && r.fit && isFinite(r.fit.p)) {
    const ok = r.fit.rmsea <= 0.08 && r.fit.tli >= 0.9;
    sec.tables.push(
      apaTable(
        'Ajuste del modelo (máxima verosimilitud)',
        ['χ²', '<i>gl</i>', '<i>p</i>', 'RMSEA', 'TLI'],
        [[f(r.fit.chi), r.fit.df, pv(r.fit.p), nz(r.fit.rmsea.toFixed(3)), nz(r.fit.tli.toFixed(3))]],
        'χ² con la corrección de Bartlett; RMSEA y TLI calculados como en psych (los que muestran JASP y jamovi). Orientativo: RMSEA ≤ .08 y TLI ≥ .90 indican un ajuste aceptable.'
      )
    );
    sec.checks.push(
      chk(
        ok ? 'ok' : 'info',
        `Ajuste del modelo: RMSEA = ${nz(r.fit.rmsea.toFixed(3))}, TLI = ${nz(r.fit.tli.toFixed(3))}.${ok ? ' Ajuste aceptable.' : ' Ajuste mejorable: valora otro número de factores.'} El χ² (${pt(r.fit.p)}) es muy sensible al tamaño muestral.`
      )
    );
  }
  const neg = vars.filter((_, i) => r.L[i][prim[i].j] < -0.3);
  if (neg.length)
    sec.checks.push(
      chk(
        'info',
        `Cargas negativas en ${list(neg.map(v => esc(v.name)))}: probablemente son ítems inversos; recodifícalos antes de calcular puntuaciones o la fiabilidad.`
      )
    );
  return { B, prim, weak };
}
/** Tablas de autovalores, cargas, comunalidades, varianza explicada y correlaciones entre factores; gráfico de sedimentación */
function efaTables({ sec, kq, B, n, p, PCA, eig, m, rot, OBL, F, names2, EXT, ROTN, pa, r }) {
  sec.tables.push(
    apaTable(
      'Adecuación de los datos al análisis factorial',
      ['KMO', 'χ² de Bartlett', '<i>gl</i>', '<i>p</i>', '<i>n</i>', 'Ítems'],
      [[nz(kq.toFixed(3)), f(B.chi), B.df, pv(B.p), n, p]]
    )
  );
  const kk = Math.min(p, 10);
  sec.tables.push(
    apaTable(
      'Autovalores y análisis paralelo',
      [PCA ? 'Componente' : 'Factor', 'Autovalor', '% varianza', 'Percentil 95 aleatorio', 'Retener'],
      eig
        .slice(0, kk)
        .map((e, j) => [
          j + 1,
          f(e),
          f((e / p) * 100, 1),
          f(pa.p95[j]),
          e > pa.p95[j] && j < pa.nfactors ? 'Sí' : 'No',
        ]),
      'Autovalores de la matriz de correlaciones. Análisis paralelo con 100 conjuntos de datos aleatorios.'
    )
  );
  const bold = v => (Math.abs(v) >= 0.4 ? `<b>${r2s(v)}</b>` : r2s(v));
  sec.tables.push(
    apaTable(
      `${PCA ? 'Cargas en los componentes' : 'Cargas factoriales'}${m > 1 && rot !== 'none' ? (OBL ? ' (matriz de configuración)' : ' rotadas') : ''}`,
      ['Ítem'].concat(F).concat(['<i>h</i>²', '<i>u</i>²']),
      names2.map((nm, i) =>
        [esc(nm)].concat(r.L[i].map(bold)).concat([nz(r.h2[i].toFixed(2)), nz(r.u2[i].toFixed(2))])
      ),
      `Extracción por ${EXT}${m > 1 ? `, ${rot === 'none' ? 'sin rotación' : `rotación ${ROTN}`}` : ''}. En negrita, cargas ≥ .40. <i>h</i>² = comunalidad; <i>u</i>² = unicidad.`
    )
  );
  let cum = 0;
  sec.tables.push(
    apaTable(
      'Varianza explicada',
      [PCA ? 'Componente' : 'Factor', 'SC de las cargas', '% varianza'].concat(m > 1 && !OBL ? ['% acumulado'] : []),
      F.map((fn, j) => {
        cum += r.prop[j];
        return [fn, f(r.ss[j]), f(r.prop[j] * 100, 1)].concat(m > 1 && !OBL ? [f(cum * 100, 1)] : []);
      }),
      m > 1 && OBL ? 'Con rotación oblicua los factores comparten varianza y los porcentajes no se suman.' : ''
    )
  );
  if (m > 1 && OBL)
    sec.tables.push(
      apaTable(
        'Correlaciones entre factores',
        [''].concat(F),
        F.map((fn, a) => [fn].concat(F.map((_, b) => (a === b ? '—' : b < a ? r2s(r.Phi[a][b]) : ''))))
      )
    );
  sec.charts.push(
    fig(
      'Gráfico de sedimentación y análisis paralelo',
      CH.scree(eig.slice(0, Math.min(p, 15)), pa.p95.slice(0, Math.min(p, 15))),
      CH.legend(['Datos observados', 'Aleatorio (percentil 95)'])
    )
  );
}
/** Redacción APA, alternativa y código R (psych) del análisis factorial exploratorio */
function efaReport({
  OBL,
  m,
  r,
  PCA,
  EXT,
  rot,
  ROTN,
  p,
  n,
  kl,
  kq,
  B,
  auto,
  Us,
  U,
  F,
  weak,
  sec,
  names2,
  ext,
  vars,
  prim,
}) {
  const total = OBL && m > 1 ? null : S.sum(r.prop);
  let t = `Se realizó un ${PCA ? 'análisis de componentes principales' : `análisis factorial exploratorio con extracción por ${EXT}`}${m > 1 && rot !== 'none' ? ` y rotación ${ROTN}` : ''} sobre los ${p} ítems (<i>n</i> = ${n}). La medida de adecuación muestral de Kaiser-Meyer-Olkin fue ${kl} (KMO = ${nz(kq.toFixed(2))}) y la prueba de esfericidad de Bartlett ${B.p < 0.05 ? 'fue' : 'no fue'} significativa, χ²(${B.df}) = ${f(B.chi)}, ${pt(B.p)}. `;
  t += auto ? `El análisis paralelo indicó retener ${m} ${m > 1 ? Us : U}` : `Se extrajeron ${m} ${m > 1 ? Us : U}`;
  t += total !== null ? `, que ${m > 1 ? 'explicaron' : 'explicó'} el ${f(total * 100, 1)} % de la varianza. ` : '. ';
  t += F.map((fn, j) => {
    const its = vars.filter((_, i) => prim[i].j === j && prim[i].mx >= 0.4);
    if (!its.length) return `Ningún ítem cargó de forma destacada en el ${U} ${j + 1}.`;
    const ld = its.map(v => Math.abs(r.L[names2.indexOf(v.name)][j])),
      ng = its.filter(v => r.L[names2.indexOf(v.name)][j] < 0);
    return `${m > 1 ? `El ${U} ${j + 1} agrupó` : `El ${U} agrupó`} ${its.length === 1 ? 'el ítem' : 'los ítems'} ${list(its.map(v => esc(v.name)))} (cargas ${its.length === 1 ? 'de' : 'entre'} ${nz(minOf(ld).toFixed(2))}${its.length > 1 ? ` y ${nz(maxOf(ld).toFixed(2))}` : ''}${ng.length ? ` en valor absoluto; ${list(ng.map(v => esc(v.name)))} con carga negativa, propia de un ítem inverso` : ''}).`;
  }).join(' ');
  if (m > 1 && OBL) {
    const cs = [];
    for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) cs.push(r.Phi[a][b]);
    t +=
      cs.length === 1
        ? ` La correlación entre los dos ${Us} fue ${r2s(cs[0])}.`
        : ` Las correlaciones entre ${Us} oscilaron entre ${r2s(minOf(cs))} y ${r2s(maxOf(cs))}.`;
  }
  if (weak.length)
    t += ` ${list(weak.map(v => esc(v.name)))} no ${weak.length > 1 ? 'mostraron' : 'mostró'} cargas ≥ .40 en ningún factor.`;
  sec.text.push(t);
  sec.alt =
    'Análisis factorial confirmatorio (por ejemplo, con lavaan en R) para contrastar una estructura teórica definida a priori. Con ítems ordinales de pocas categorías, puede usarse la matriz de correlaciones policóricas.';
  const Q = names2.map(rq).join(', ');
  sec.code =
    `# Análisis factorial exploratorio\nitems <- datos[complete.cases(datos[, c(${Q})]), c(${Q})]\npsych::KMO(items)\npsych::cortest.bartlett(cor(items), n = nrow(items))\npsych::fa.parallel(items, fm = "pa", fa = "pc", n.iter = 100, quant = .95)\n` +
    (PCA
      ? `afe <- psych::principal(items, nfactors = ${m}, rotate = "${m > 1 ? rot : 'none'}")`
      : `afe <- psych::fa(items, nfactors = ${m}, fm = "${ext}", rotate = "${m > 1 ? (rot === 'geomin' ? 'geominQ' : rot) : 'none'}")`) +
    `\nprint(afe$loadings, cutoff = .3, sort = TRUE)\nafe$communality\nL <- unclass(afe$loadings); Ph <- if (is.null(afe$Phi)) diag(ncol(L)) else afe$Phi; sc <- diag(Ph %*% crossprod(L)); rbind(SC_cargas = sc, pct_varianza = 100 * sc / nrow(L))  # varianza explicada` +
    (m > 1 && OBL ? '\nafe$Phi' : '') +
    (ext === 'ml' ? '\nafe$STATISTIC; afe$dof; afe$PVAL; afe$RMSEA; afe$TLI  # ajuste' : '');
}

export { runEfa };
