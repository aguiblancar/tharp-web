/* Tharp · aplicación · Análisis: Análisis factorial confirmatorio e invarianza de medida */
import { esc } from '../graficos.js';
import S from '../../motor/index.js';
import { catOf, numOf, ordOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, list, nz, pt, pv, r2s, rq } from '../formato.js';
import { apaTable, chk, nuevaSeccion } from '../resultados/piezas.js';
import { maxOf, minOf } from '../utilidades.js';

function runCfa(spec, gN) {
  const sec = nuevaSeccion('Análisis factorial confirmatorio', { test: 'AFC (máxima verosimilitud)' });
  if (!spec.length) {
    sec.error = 'Asigna ítems al menos a un factor.';
    return sec;
  }
  const all = spec.flatMap(fc => fc.items),
    dup = all.filter((v, i) => all.indexOf(v) !== i);
  if (dup.length) {
    sec.error = `Cada ítem debe estar en un solo factor (repetido: ${list([...new Set(dup)].map(esc))}).`;
    return sec;
  }
  if (new Set(spec.map(fc => fc.name)).size < spec.length) {
    sec.error = 'Cada factor debe tener un nombre distinto.';
    return sec;
  }
  if (spec.length === 1 && spec[0].items.length < 3) {
    sec.error = 'Un modelo de un solo factor necesita al menos 3 ítems para poder estimarse.';
    return sec;
  }
  if (spec.some(fc => fc.items.length < 2)) {
    sec.error = 'Cada factor necesita al menos 2 ítems (mejor 3 o más).';
    return sec;
  }
  const vars = all.map(vByName),
    cols = vars.map(numOf),
    idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)),
    n = idx.length,
    p = all.length;
  if (n < p + 5) {
    sec.error = `Hay muy pocos casos completos (${n}) para ${p} ítems.`;
    return sec;
  }
  const X = idx.map(i => cols.map(c => c[i]));
  if (vars.some((_, j) => S.sd(X.map(r => r[j])) === 0)) {
    sec.error = 'Algún ítem tiene el mismo valor en todos los casos. Exclúyelo.';
    return sec;
  }
  const facIdx = [];
  let o = 0;
  spec.forEach(fc => {
    facIdx.push(fc.items.map(() => o++));
  });
  const r = S.cfa(X, facIdx),
    m = spec.length;
  if (!isFinite(r.chi)) {
    sec.error = 'El modelo no pudo estimarse (matriz de covarianzas singular o modelo no identificado).';
    return sec;
  }
  const sat = r.df === 0; // modelo saturado (p. ej., un factor con 3 ítems): reproduce exactamente las covarianzas y su ajuste no se puede contrastar
  const good = r.cfi >= 0.95 && r.tli >= 0.95 && r.rmsea <= 0.06 && r.srmr <= 0.08,
    ok = r.cfi >= 0.9 && r.tli >= 0.9 && r.rmsea <= 0.08 && r.srmr <= 0.1;
  const verdict = sat ? 'no evaluable (modelo saturado)' : good ? 'bueno' : ok ? 'aceptable' : 'insuficiente';
  const ix = v => (isFinite(v) ? nz(v.toFixed(3)) : '—');
  const { neg } = cfaWhyAndChecks({ sec, m, p, n, sat, good, ok, verdict, r, all, spec });
  cfaTables({ sec, sat, r, ix, n, spec, m, facIdx });
  const { iname, fname } = cfaReport({ m, spec, n, sat, verdict, r, neg, sec, all });
  if (gN) cfaInvariance(sec, { spec, all, facIdx, gN, cols, rItems: all.map(iname), fnames: spec.map(fname) });
  return sec;
}
/** Motivos del modelo y supuestos: ajuste, convergencia, Heywood, cargas débiles o negativas y validez discriminante */
function cfaWhyAndChecks({ sec, m, p, n, sat, good, ok, verdict, r, all, spec }) {
  sec.decision = `Se contrastó un modelo de ${m} factor${m > 1 ? 'es correlacionados' : ''} con ${p} ítems y ${n} casos completos, estimado por máxima verosimilitud.`;
  sec.why.push(
    'El análisis factorial confirmatorio comprueba si los datos se ajustan a una estructura de factores definida de antemano (por la teoría o por estudios previos), a diferencia del exploratorio, que la descubre.'
  );
  sec.why.push(
    'Cada factor se identifica fijando a 1 la carga de su primer ítem (ítem marcador); por eso se interpretan sobre todo las cargas estandarizadas.'
  );
  sec.why.push(
    'El ajuste se valora con varios índices a la vez (Hu y Bentler, 1999): CFI y TLI ≥ .95, RMSEA ≤ .06 y SRMR ≤ .08 indican buen ajuste; CFI y TLI ≥ .90 y RMSEA ≤ .08, ajuste aceptable.'
  );
  sec.checks.push(
    sat
      ? chk(
          'info',
          'Modelo saturado (0 grados de libertad): tiene tantos parámetros como varianzas y covarianzas, así que las reproduce exactamente y su ajuste no puede contrastarse. Las cargas y la fiabilidad sí son interpretables; para evaluar el ajuste hacen falta al menos 4 ítems por factor (o varios factores).'
        )
      : chk(
          good ? 'ok' : ok ? 'info' : 'no',
          `Ajuste global ${verdict}: CFI = ${nz(r.cfi.toFixed(3))}, TLI = ${nz(r.tli.toFixed(3))}, RMSEA = ${nz(r.rmsea.toFixed(3))}, SRMR = ${nz(r.srmr.toFixed(3))}.`
        )
  );
  if (!r.conv)
    sec.warn =
      'La estimación no convergió del todo: los resultados pueden no ser fiables. Revisa el modelo (ítems con muy poca relación con su factor) o la muestra.';
  if (r.heywood.length)
    sec.warn = `Caso Heywood: ${list(r.heywood.map(j => esc(all[j])))} ${r.heywood.length > 1 ? 'tienen' : 'tiene'} una varianza residual negativa, lo que indica un modelo mal especificado o una muestra pequeña. Los resultados no son interpretables tal cual.`;
  const weak = all.filter((_, j) => Math.abs(r.std[j]) < 0.4);
  sec.checks.push(
    weak.length
      ? chk('no', `Cargas estandarizadas < .40: ${list(weak.map(esc))}. Estos ítems apenas reflejan su factor.`)
      : chk('ok', 'Todas las cargas estandarizadas son ≥ .40.')
  );
  const neg = all.filter((_, j) => r.std[j] < -0.3);
  if (neg.length)
    sec.checks.push(chk('info', `Cargas negativas en ${list(neg.map(esc))}: probablemente son ítems inversos.`));
  sec.checks.push(
    chk(
      n >= 200 ? 'ok' : 'info',
      `Tamaño muestral: ${n} casos.${n >= 200 ? '' : ' Se recomiendan al menos 200 para un AFC estable.'}`
    )
  );
  sec.checks.push(
    chk(
      'info',
      'La máxima verosimilitud supone variables continuas y normales. Con ítems tipo Likert de pocas categorías (5 o menos), considera en R un estimador para datos ordinales (WLSMV) o la versión robusta (MLR).'
    )
  );
  if (m > 1) {
    const fl = [];
    for (let a = 0; a < m; a++)
      for (let b = 0; b < a; b++)
        if (Math.abs(r.facCor[a][b]) >= Math.sqrt(Math.min(r.rel[a].ave, r.rel[b].ave)))
          fl.push(`${esc(spec[a].name)} y ${esc(spec[b].name)}`);
    sec.checks.push(
      fl.length
        ? chk(
            'no',
            `Validez discriminante (Fornell-Larcker) dudosa entre ${list(fl)}: su correlación supera la raíz de la AVE.`
          )
        : chk(
            'ok',
            'Validez discriminante (Fornell-Larcker): cada factor comparte más varianza con sus ítems que con los demás factores.'
          )
    );
  }
  sec.alt =
    'Si el ajuste es insuficiente, revisa ítems con cargas bajas o un análisis factorial exploratorio previo. Con ítems ordinales, el estimador WLSMV en lavaan.';
  return { neg };
}
/** Tablas de ajuste global, cargas, fiabilidad y validez convergente y correlaciones entre factores */
function cfaTables({ sec, sat, r, ix, n, spec, m, facIdx }) {
  const crit = (v, g0, a0, inv) =>
    inv
      ? v <= g0
        ? 'bueno'
        : v <= a0
          ? 'aceptable'
          : 'insuficiente'
      : v >= g0
        ? 'bueno'
        : v >= a0
          ? 'aceptable'
          : 'insuficiente';
  sec.tables.push(
    apaTable(
      'Índices de ajuste del modelo',
      ['χ²', '<i>gl</i>', '<i>p</i>', 'CFI', 'TLI', 'RMSEA', 'IC 90 % RMSEA', 'SRMR', '<i>n</i>'],
      [
        [
          f(sat ? 0 : r.chi),
          r.df,
          sat ? '—' : pv(r.pval),
          sat ? '—' : ix(r.cfi),
          ix(r.tli),
          sat ? '—' : ix(r.rmsea),
          sat ? '—' : `[${ix(r.rmseaCI[0])}, ${ix(r.rmseaCI[1])}]`,
          sat ? '—' : ix(r.srmr),
          n,
        ],
      ],
      sat
        ? 'Modelo saturado (gl = 0): reproduce exactamente los datos, por lo que los índices de ajuste no son informativos. Estimación por máxima verosimilitud.'
        : `Valoración: CFI ${crit(r.cfi, 0.95, 0.9)}, TLI ${crit(r.tli, 0.95, 0.9)}, RMSEA ${crit(r.rmsea, 0.06, 0.08, true)}, SRMR ${crit(r.srmr, 0.08, 0.1, true)}. Estimación por máxima verosimilitud.`
    )
  );
  const rows = [];
  spec.forEach((fc, k) =>
    fc.items.forEach((it, i) => {
      const j = facIdx[k][i],
        e = r.est.find(q => q.t === 'l' && q.j === j);
      rows.push([
        i === 0 ? `<b>${esc(fc.name)}</b>` : '',
        esc(it),
        e ? f(e.est, 3) : '1 (fijo)',
        e ? f(e.se, 3) : '—',
        e ? f(e.z) : '—',
        e ? pv(e.p) : '—',
        r2s(r.std[j]),
        nz((1 - r.std[j] ** 2).toFixed(2)),
      ]);
    })
  );
  sec.tables.push(
    apaTable(
      'Cargas factoriales',
      ['Factor', 'Ítem', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'β', 'Varianza residual (est.)'],
      rows,
      'β = carga estandarizada. El primer ítem de cada factor fija la escala (carga = 1).'
    )
  );
  sec.tables.push(
    apaTable(
      'Fiabilidad y validez convergente',
      ['Factor', 'Ítems', 'ω', 'AVE'],
      spec.map((fc, k) => [esc(fc.name), fc.items.length, nz(r.rel[k].omega.toFixed(3)), nz(r.rel[k].ave.toFixed(3))]),
      'ω = fiabilidad compuesta (omega) a partir del AFC; los ítems con carga negativa (inversos) se consideran recodificados. AVE = varianza media extraída (≥ .50 indica validez convergente).'
    )
  );
  if (m > 1)
    sec.tables.push(
      apaTable(
        'Correlaciones entre factores',
        [''].concat(spec.map(fc => esc(fc.name))),
        spec.map((fc, a) =>
          [esc(fc.name)].concat(spec.map((_, b) => (a === b ? '—' : b < a ? r2s(r.facCor[a][b]) : '')))
        )
      )
    );
}
/** Redacción APA y código R (lavaan) del análisis factorial confirmatorio */
function cfaReport({ m, spec, n, sat, verdict, r, neg, sec, all }) {
  let t = `Se realizó un análisis factorial confirmatorio por máxima verosimilitud para contrastar un modelo de ${m} factor${m > 1 ? 'es correlacionados' : ''} (${spec.map(fc => `${esc(fc.name)}: ${fc.items.length} ítems`).join('; ')}) con ${n} participantes. `;
  t += sat
    ? 'Al tratarse de un modelo saturado (0 grados de libertad), su ajuste no puede contrastarse. '
    : `El ajuste del modelo fue ${verdict}, χ²(${r.df}) = ${f(r.chi)}, ${pt(r.pval)}, CFI = ${nz(r.cfi.toFixed(2))}, TLI = ${nz(r.tli.toFixed(2))}, RMSEA = ${nz(r.rmsea.toFixed(3))}, IC 90 % [${nz(r.rmseaCI[0].toFixed(3))}, ${nz(r.rmseaCI[1].toFixed(3))}], SRMR = ${nz(r.srmr.toFixed(3))}. `;
  const absS = r.std.map(Math.abs);
  t += `Las cargas estandarizadas oscilaron entre ${nz(minOf(absS).toFixed(2))} y ${nz(maxOf(absS).toFixed(2))}${neg.length ? ' en valor absoluto' : ''}`;
  t += `, y la fiabilidad compuesta fue ${list(spec.map((fc, k) => `${m > 1 ? `${esc(fc.name)} ` : ''}ω = ${nz(r.rel[k].omega.toFixed(2))}`))}.`;
  if (m > 1) {
    const cs = [];
    for (let a = 0; a < m; a++) for (let b = 0; b < a; b++) cs.push(r.facCor[a][b]);
    t +=
      m === 2
        ? ` La correlación entre los factores fue <i>r</i> = ${r2s(cs[0])}.`
        : ` Las correlaciones entre factores oscilaron entre ${r2s(minOf(cs))} y ${r2s(maxOf(cs))}.`;
  }
  sec.text.push(t);
  const syn = n0 => /^[A-Za-z.][A-Za-z0-9._]*$/.test(n0),
    allSyn = all.every(syn) && spec.every(fc => syn(fc.name.replace(/\s+/g, '_')));
  const iname = (it, j) => (allSyn ? it : `i${j + 1}`),
    fname = (fc, k) => (allSyn ? fc.name.replace(/\s+/g, '_') : `F${k + 1}`);
  let jj = 0;
  const modelo = spec
    .map((fc, k) => `${fname(fc, k)} =~ ${fc.items.map(it => iname(it, jj++)).join(' + ')}`)
    .join('\n');
  sec.code =
    `# Análisis factorial confirmatorio (lavaan)\nitems <- datos[complete.cases(datos[, c(${all.map(rq).join(', ')})]), c(${all.map(rq).join(', ')})]\n` +
    (allSyn
      ? ''
      : `names(items) <- c(${all.map((_, j) => rq('i' + (j + 1))).join(', ')})  # ${all.map((it, j) => `i${j + 1} = ${it}`).join('; ')}\n`) +
    `modelo <- '\n${modelo}\n'\najuste <- lavaan::cfa(modelo, data = items)\nlavaan::summary(ajuste, fit.measures = TRUE, standardized = TRUE)  # con lavaan:: (sin cargar el paquete, summary() no lo reconoce)\nlavaan::fitMeasures(ajuste, c("chisq", "df", "pvalue", "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "srmr"))\nlavaan::standardizedSolution(ajuste)\n` +
    `est <- lavaan::lavInspect(ajuste, "est"); est_std <- lavaan::lavInspect(ajuste, "std")\nfiabilidad <- t(sapply(colnames(est$lambda), function(f) { it <- est$lambda[, f] != 0; sl <- sum(abs(est$lambda[it, f]))^2 * est$psi[f, f]\n  c(omega = sl / (sl + sum(diag(est$theta)[it])), AVE = mean(est_std$lambda[it, f]^2)) }))  # ω con |λ|: los ítems inversos cuentan como recodificados\nprint(fiabilidad, digits = 6)`;
  return { iname, fname };
}
// Invarianza de medida entre grupos (AFC multigrupo): configural → métrica → escalar → estricta
function cfaInvariance(sec, { spec, all, facIdx, gN, cols, rItems, fnames }) {
  const gv = vByName(gN);
  if (!gv) return;
  if (all.includes(gN)) {
    sec.checks.push(chk('no', 'Invarianza: la variable de agrupación no puede ser uno de los ítems.'));
    return;
  }
  const gc = catOf(gv),
    idx = ST.rows.map((_, i) => i).filter(i => gc[i] !== null && cols.every(c => c[i] !== null));
  const lv = ordOf(
      gv,
      idx.map(i => gc[i])
    ),
    p = all.length,
    G = lv.length;
  if (G < 2) {
    sec.checks.push(chk('no', `Invarianza: ${esc(gN)} solo tiene un grupo con casos completos.`));
    return;
  }
  const gi = lv.map(l => idx.filter(i => gc[i] === l)),
    ng = gi.map(a => a.length);
  const small = lv.filter((_, g) => ng[g] < p + 5);
  if (small.length) {
    sec.checks.push(
      chk(
        'no',
        `Invarianza no calculada: ${list(small.map(esc))} ${small.length > 1 ? 'tienen' : 'tiene'} muy pocos casos completos para ${p} ítems (hacen falta al menos ${p + 5} por grupo).`
      )
    );
    return;
  }
  const Xg = gi.map(a => a.map(i => cols.map(c => c[i])));
  if (Xg.some(X => all.some((_, j) => S.sd(X.map(r => r[j])) === 0))) {
    sec.checks.push(
      chk('no', 'Invarianza no calculada: algún ítem tiene el mismo valor en todos los casos de un grupo.')
    );
    return;
  }
  const LEV = ['configural', 'metric', 'scalar', 'strict'],
    NAME = [
      'Configural',
      'Métrica (cargas iguales)',
      'Escalar (+ interceptos iguales)',
      'Estricta (+ varianzas residuales iguales)',
    ];
  const fits = LEV.map(l => S.cfaMG(Xg, facIdx, l));
  if (fits.some(r => !isFinite(r.chi))) {
    sec.checks.push(
      chk(
        'no',
        'Invarianza no calculada: algún modelo multigrupo no pudo estimarse (matriz de covarianzas singular en algún grupo).'
      )
    );
    return;
  }
  if (fits.some(r => !r.converged))
    sec.warn =
      (sec.warn ? sec.warn + ' ' : '') +
      'Algún modelo de invarianza no convergió del todo: interpreta esa comparación con cautela.';
  if (fits.some(r => r.params.some(q => q.key[0] === 'u' && q.est < 0)))
    sec.warn =
      (sec.warn ? sec.warn + ' ' : '') +
      'Algún modelo de invarianza tiene varianzas residuales negativas (caso Heywood) en algún grupo: el modelo puede estar mal especificado para ese grupo.';
  sec.decision += ` Se evaluó además su invarianza de medida entre los ${G} grupos de ${esc(gN)}.`;
  const { c0, fitOk, fitGood, dl, cFail, reached, ix, sg, dec } = invarianceLevels({ fits });
  invarianceWhyAndChecks({ sec, gN, ng, G, lv, fitOk, cFail, reached });
  const { lm } = invarianceTables({ sec, gN, fits, c0, dec, reached, NAME, ix, dl, sg, spec, lv });
  invarianceReport({ G, gN, lv, fitGood, fitOk, c0, cFail, lm, sec, ng, reached, dl, sg });
  sec.code +=
    `\n\n# Invarianza de medida entre grupos de ${gN} (AFC multigrupo, lavaan)\nmg <- datos[complete.cases(datos[, c(${all.concat(gN).map(rq).join(', ')})]), ]\n` +
    `mg <- data.frame(setNames(mg[, c(${all.map(rq).join(', ')})], c(${rItems.map(rq).join(', ')})), grupo_inv = factor(as.character(mg[[${rq(gN)}]]), levels = c(${lv.map(rq).join(', ')})))\n` +
    `niveles <- list(configural = NULL, metrica = "loadings", escalar = c("loadings", "intercepts"), estricta = c("loadings", "intercepts", "residuals"))\n` +
    `ajustes_inv <- lapply(niveles, function(eq) lavaan::cfa(modelo, data = mg, group = "grupo_inv", group.equal = eq))\n` +
    `indices <- t(sapply(ajustes_inv, lavaan::fitMeasures, c("chisq", "df", "pvalue", "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "srmr")))\nprint(indices, digits = 6)\n` +
    `cambios <- data.frame(d_chisq = diff(indices[, "chisq"]), d_gl = diff(indices[, "df"]), p = pchisq(diff(indices[, "chisq"]), diff(indices[, "df"]), lower.tail = FALSE), d_CFI = diff(indices[, "cfi"]), d_RMSEA = diff(indices[, "rmsea"]))\nprint(cambios, digits = 6)  # criterio: d_CFI >= -0.010 y d_RMSEA <= 0.015` +
    (lm
      ? `\nmedias <- lavaan::parameterEstimates(ajustes_inv$escalar); medias <- medias[medias$op == "~1" & medias$lhs %in% c(${fnames.map(rq).join(', ')}) & medias$group > 1, ]\nmedias$grupo <- levels(mg$grupo_inv)[medias$group]; print(medias[, c("lhs", "grupo", "est", "se", "z", "pvalue")], digits = 6)  # diferencias respecto a ${lv[0]}`
      : '');
}
/** Diferencias de ajuste entre niveles anidados (Δχ², ΔCFI, ΔRMSEA) y nivel de invarianza alcanzado */
function invarianceLevels({ fits }) {
  const c0 = fits[0],
    fitOk = c0.cfi >= 0.9 && c0.tli >= 0.9 && c0.rmsea <= 0.08 && c0.srmr <= 0.1,
    fitGood = c0.cfi >= 0.95 && c0.tli >= 0.95 && c0.rmsea <= 0.06 && c0.srmr <= 0.08;
  const dl = fits.map((r, k) =>
    k
      ? {
          chi: r.chi - fits[k - 1].chi,
          df: r.df - fits[k - 1].df,
          cfi: r.cfi - fits[k - 1].cfi,
          rmsea: r.rmsea - fits[k - 1].rmsea,
        }
      : null
  );
  dl.forEach(d => {
    if (d) d.p = d.df > 0 ? 1 - jStat.chisquare.cdf(Math.max(d.chi, 0), d.df) : NaN;
  });
  // nivel alcanzado: el primero que no se sostiene corta la secuencia (ΔCFI ≥ −.010 y ΔRMSEA ≤ .015)
  const cFail = [
    c0.cfi < 0.9 && 'CFI < .90',
    c0.tli < 0.9 && 'TLI < .90',
    c0.rmsea > 0.08 && 'RMSEA > .08',
    c0.srmr > 0.1 && 'SRMR > .10',
  ].filter(Boolean);
  let reached = 0;
  for (let k = 1; k < 4 && reached === k - 1; k++) if (dl[k].cfi >= -0.01 && dl[k].rmsea <= 0.015) reached = k;
  const ix = v => (isFinite(v) ? nz(v.toFixed(3)) : '—'),
    sg = v => (isFinite(v) ? (v < 0 ? '−' : '') + nz(Math.abs(v).toFixed(3)) : '—');
  const dec = k =>
    k === 0
      ? fitGood
        ? 'Ajuste bueno'
        : fitOk
          ? 'Ajuste aceptable'
          : `Ajuste insuficiente (${cFail.join(', ')})`
      : reached >= k
        ? 'Se sostiene'
        : reached === k - 1
          ? 'No se sostiene'
          : 'No procede';
  return { c0, fitOk, fitGood, dl, cFail, reached, ix, sg, dec };
}
/** Motivos y supuestos de la invarianza de medida (criterios ΔCFI y ΔRMSEA, ajuste configural) */
function invarianceWhyAndChecks({ sec, gN, ng, G, lv, fitOk, cFail, reached }) {
  sec.why.push(
    `La invarianza de medida comprueba si el cuestionario mide lo mismo en todos los grupos de ${esc(gN)}, condición para comparar sus puntuaciones. Se ajustan modelos cada vez más restrictivos: configural (misma estructura), métrica (mismas cargas; permite comparar relaciones), escalar (mismos interceptos; permite comparar medias) y estricta (mismas varianzas residuales).`
  );
  sec.why.push(
    'Cada nivel se acepta si el ajuste apenas empeora respecto al anterior: ΔCFI ≥ −.010 (Cheung y Rensvold, 2002) y ΔRMSEA ≤ .015 (Chen, 2007). La diferencia de χ² se informa, pero con muestras grandes detecta diferencias triviales.'
  );
  sec.checks.push(
    chk(
      ng.every(n => n >= 200) ? 'ok' : 'info',
      `Invarianza: ${G} grupos de ${esc(gN)} (${lv.map((l, g) => `${esc(l)}: ${ng[g]}`).join('; ')}).${ng.every(n => n >= 200) ? '' : ' Se recomiendan al menos 200 casos por grupo.'}`
    )
  );
  if (!fitOk)
    sec.checks.push(
      chk(
        'no',
        `El modelo configural no cumple todos los criterios de ajuste aceptable (${list(cFail)}): la estructura factorial podría no ser la misma en todos los grupos. Interpreta con cautela los niveles siguientes.`
      )
    );
  sec.checks.push(
    chk(
      reached >= 2 ? 'ok' : 'info',
      `Nivel de invarianza alcanzado: ${['configural', 'métrica', 'escalar', 'estricta'][reached]}.${reached >= 2 ? ' Las medias de los factores pueden compararse entre grupos.' : reached === 1 ? ' Pueden compararse las relaciones entre variables, pero no las medias (prueba la invarianza parcial en R liberando interceptos).' : ' Las cargas difieren entre grupos: las puntuaciones no son comparables.'}`
    )
  );
}
/** Tablas de ajuste por nivel de invarianza y diferencias, y medias latentes si se alcanza la invarianza escalar */
function invarianceTables({ sec, gN, fits, c0, dec, reached, NAME, ix, dl, sg, spec, lv }) {
  sec.tables.push(
    apaTable(
      `Invarianza de medida entre grupos de ${esc(gN)}: ajuste de los modelos`,
      ['Modelo', 'χ²', '<i>gl</i>', '<i>p</i>', 'CFI', 'TLI', 'RMSEA', 'IC 90 % RMSEA', 'SRMR'],
      fits.map((r, k) => [
        NAME[k],
        f(r.chi),
        r.df,
        pv(r.p),
        ix(r.cfi),
        ix(r.tli),
        ix(r.rmsea),
        `[${ix(r.rmseaCI[0])}, ${ix(r.rmseaCI[1])}]`,
        ix(r.srmr),
      ]),
      `AFC multigrupo por máxima verosimilitud con estructura de medias (${c0.N} casos). El RMSEA multigrupo incluye el factor √G, como lavaan. Modelo configural: ${dec(0).toLowerCase()}.`
    )
  );
  sec.tables.push(
    apaTable(
      `Invarianza de medida entre grupos de ${esc(gN)}: comparación de modelos`,
      ['Comparación', 'Δχ²', 'Δ<i>gl</i>', '<i>p</i>', 'ΔCFI', 'ΔRMSEA', 'Decisión'],
      [1, 2, 3].map(k => [
        `${['', 'Métrica', 'Escalar', 'Estricta'][k]} frente a ${['configural', 'métrica', 'escalar'][k - 1]}`,
        f(dl[k].chi),
        dl[k].df,
        pv(dl[k].p),
        sg(dl[k].cfi),
        sg(dl[k].rmsea),
        dec(k),
      ]),
      'Criterio: el nivel se sostiene si ΔCFI ≥ −.010 y ΔRMSEA ≤ .015. Cuando un nivel no se sostiene, los siguientes no proceden.'
    )
  );
  let lm = null;
  if (reached >= 2) {
    const sc = fits[2],
      P = new Map(sc.params.map(q => [q.key, q]));
    lm = [];
    spec.forEach((fc, k) =>
      lv.forEach((l, g) => {
        if (!g) return;
        const q = P.get(`a:${k}:${g}`),
          z = q.est / q.se;
        lm.push({ fc, l, est: q.est, se: q.se, z, p: 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1)) });
      })
    );
    sec.tables.push(
      apaTable(
        'Diferencias de medias latentes (modelo escalar)',
        ['Factor', 'Grupo', 'Diferencia', '<i>EE</i>', '<i>z</i>', '<i>p</i>'],
        lm.map(o => [esc(o.fc.name), esc(o.l), f(o.est, 3), f(o.se, 3), f(o.z), pv(o.p)]),
        `Diferencia de cada grupo respecto a ${esc(lv[0])} (grupo de referencia, con media latente fijada en 0), en la escala del ítem marcador de cada factor.`
      )
    );
  }
  return { lm };
}
/** Redacción APA y código R (lavaan) de la invarianza de medida */
function invarianceReport({ G, gN, lv, fitGood, fitOk, c0, cFail, lm, sec, ng, reached, dl, sg }) {
  let t = `Se evaluó la invarianza de medida entre los ${G} grupos de ${esc(gN)} (${lv.map((l, g) => `${esc(l)}: <i>n</i> = ${ng[g]}`).join('; ')}) mediante análisis factorial confirmatorio multigrupo. `;
  t += `El modelo configural mostró un ajuste ${fitGood ? 'bueno' : fitOk ? 'aceptable' : 'insuficiente'}, χ²(${c0.df}) = ${f(c0.chi)}, CFI = ${nz(c0.cfi.toFixed(3))}, RMSEA = ${nz(c0.rmsea.toFixed(3))}, SRMR = ${nz(c0.srmr.toFixed(3))}`;
  t += fitOk ? '' : ` (incumple el criterio: ${list(cFail)})`;
  {
    const done = [];
    for (let k = 1; k < 4 && reached >= k - 1; k++)
      done.push(
        `la invarianza ${['', 'métrica', 'escalar', 'estricta'][k]} ${reached >= k ? 'se sostuvo' : 'no se sostuvo'} (Δχ²(${dl[k].df}) = ${f(dl[k].chi)}, ${pt(dl[k].p)}, ΔCFI = ${sg(dl[k].cfi)}, ΔRMSEA = ${sg(dl[k].rmsea)})`
      );
    t += `; ${list(done)}. ${reached >= 2 ? `Por tanto, las medias de los factores pueden compararse entre los grupos de ${esc(gN)}.` : reached === 1 ? `Por tanto, pueden compararse las relaciones entre variables, pero no las medias de los factores entre los grupos de ${esc(gN)}.` : `Por tanto, las puntuaciones no son comparables entre los grupos de ${esc(gN)}.`}`;
  }
  if (lm) {
    const sig = lm.filter(o => o.p < 0.05);
    t += sig.length
      ? ` En el modelo escalar, ${list(sig.map(o => `la media latente de ${esc(o.fc.name)} en ${esc(o.l)} fue ${o.est > 0 ? 'mayor' : 'menor'} que en ${esc(lv[0])} (diferencia = ${f(o.est, 2)}, <i>z</i> = ${f(o.z)}, ${pt(o.p)})`))}.`
      : ` En el modelo escalar, ninguna media latente difirió significativamente de la de ${esc(lv[0])}.`;
  }
  sec.text.push(t);
}

export { runCfa };
