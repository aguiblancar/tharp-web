/* Tharp · aplicación · Análisis: Mediación y modelos de PROCESS */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, list, nz, pt, pv, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion, numOrBin, rCode01 } from '../resultados/piezas.js';

// Modelos de PROCESS con varios mediadores, en serie, de mediación moderada o con covariables
function runProcess(mo, yN, xN, mNames, wN, cNames) {
  const model = mo === '4p' ? 4 : +mo,
    MN = {
      4: mNames.length > 1 ? 'mediación con mediadores en paralelo' : 'mediación simple',
      6: 'mediación en serie',
      7: 'mediación moderada en la primera etapa',
      14: 'mediación moderada en la segunda etapa',
    }[model];
  const sec = nuevaSeccion(
    `Mediación: ${xN} → ${mNames.join(model === 6 ? ' → ' : ', ')} → ${yN}${wN ? ` (moderador: ${wN})` : ''}`,
    { test: `PROCESS, modelo ${model} (${MN}, bootstrap)` }
  );
  const used = [yN, xN, ...mNames, wN].filter(Boolean);
  if (new Set(used).size !== used.length) {
    sec.error = 'Y, X, los mediadores y el moderador deben ser variables distintas.';
    return sec;
  }
  if ((model === 7 || model === 14) && !wN) {
    sec.error = 'Elige un moderador (W).';
    return sec;
  }
  if ((mo === '4p' || model === 6) && mNames.length < 2) {
    sec.error = 'Marca al menos un mediador adicional.';
    return sec;
  }
  if (model === 6 && mNames.length > 4) {
    sec.error = 'El modelo en serie admite hasta 4 mediadores.';
    return sec;
  }
  cNames = cNames.filter(c => !used.includes(c));
  const xv = numOrBin(vByName(xN)),
    wv = wN ? numOrBin(vByName(wN)) : null;
  if (!xv || (wN && !wv)) {
    sec.error = 'X y W deben ser cuantitativas o tener exactamente 2 categorías.';
    return sec;
  }
  const yv = numOf(vByName(yN)),
    mv = mNames.map(m => numOf(vByName(m))),
    cv = cNames.map(c => numOf(vByName(c)));
  const idx = ST.rows
      .map((_, i) => i)
      .filter(
        i =>
          yv[i] !== null &&
          xv.vals[i] !== null &&
          mv.every(m => m[i] !== null) &&
          (!wv || wv.vals[i] !== null) &&
          cv.every(c => c[i] !== null)
      ),
    n = idx.length;
  if (n < 10 + mNames.length + cNames.length) {
    sec.error = `Hay pocos casos completos (${n}).`;
    return sec;
  }
  const pick_ = arr => idx.map(i => arr[i]),
    r = S.processModel(model, pick_(yv), pick_(xv.vals), mv.map(pick_), wv ? pick_(wv.vals) : null, cv.map(pick_));
  if (!r) {
    sec.error = 'No se pudo estimar el modelo (colinealidad entre variables).';
    return sec;
  }
  const nm = k =>
    k === 'X'
      ? esc(xN)
      : k === 'W'
        ? esc(wN)
        : k === 'X×W'
          ? `${esc(xN)} × ${esc(wN)}`
          : /^M\d$/.test(k)
            ? esc(mNames[+k[1]])
            : /^M\d×W$/.test(k)
              ? `${esc(mNames[+k[1]])} × ${esc(wN)}`
              : /^C\d$/.test(k)
                ? esc(cNames[+k[1]])
                : k;
  const ci2 = c => `[${f(c[0], 3)}, ${f(c[1], 3)}]`,
    sig = c => c[0] > 0 || c[1] < 0;
  processWhy({ sec, model, MN, r, wN, cNames, n, xv, xN, yN, mNames, nm, ci2 });
  const { E } = processTables({ r, ci2, model, sec, MN, xN, yN, mNames, wN, cNames, sig, wv });
  // código R reproducible: variables con nombres cortos (Y, X, M1…, W, C1…) y bootstrap percentil con el paquete boot
  processRCode({ mNames, cNames, yN, xN, xv, wN, wv, model, sec, MN, E });
  return sec;
}
/** Motivos, decisión y avisos del modelo de PROCESS */
function processWhy({ sec, model, MN, r, wN, cNames, n, xv, xN, yN, mNames, nm, ci2 }) {
  sec.why.push(
    `Modelo ${model} de PROCESS (Hayes, 2022): ${MN}. ${model === 6 ? 'Los mediadores se encadenan en el orden indicado.' : ''}`
  );
  sec.why.push(
    `Los efectos indirectos se contrastan con intervalos de confianza bootstrap percentil (${r.B} remuestras, semilla fija para que el resultado sea reproducible): hay efecto si el intervalo no incluye el 0.`
  );
  if (wN)
    sec.why.push(
      `Los efectos indirectos condicionados se calculan en ${r.wv.length === 2 ? 'los dos valores' : 'los percentiles 16, 50 y 84'} de ${esc(wN)} (como PROCESS v4). El índice de mediación moderada (Hayes, 2015) contrasta si el efecto indirecto cambia con W.`
    );
  if (cNames.length) sec.why.push(`Covariables en todas las ecuaciones: ${list(cNames.map(esc))}.`);
  sec.decision = `Se estimó el modelo ${model} de PROCESS (${MN}) con ${n} casos e intervalos bootstrap de ${r.B} remuestras.`;
  if (xv.bin)
    sec.checks.push(chk('info', `${esc(xN)} es dicotómica: se codifica 0 = ${esc(xv.lv[0])}, 1 = ${esc(xv.lv[1])}.`));
  r.eqs.forEach(e => {
    const dvN = e.dv === 'Y' ? esc(yN) : esc(mNames[+e.dv.slice(1)]);
    sec.tables.push(
      apaTable(
        `Ecuación de ${dvN}`,
        ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>t</i>', '<i>p</i>', 'IC 95 %'],
        e.names.map((k, j) => [nm(k), f(e.b[j], 3), f(e.se[j], 3), f(e.t[j]), pv(e.p[j]), ci2(e.ci[j])]),
        `<i>R</i>² = ${nz(e.r2.toFixed(3))}, <i>F</i>(${e.df1}, ${e.dfr}) = ${f(e.F)}, ${pt(e.pF)}.`
      )
    );
  });
}
/** Tablas de efectos directos, indirectos y condicionados, y redacción APA del modelo de PROCESS */
function processTables({ r, ci2, model, sec, MN, xN, yN, mNames, wN, cNames, sig, wv }) {
  const effRows = [
    ['Efecto total (c)', f(r.total.b, 3), f(r.total.se, 3), ci2(r.total.ci), pv(r.total.p)],
    ['Efecto directo (c′)', f(r.direct.b, 3), f(r.direct.se, 3), ci2(r.direct.ci), pv(r.direct.p)],
  ];
  const E = r.effects,
    ind = [];
  if (model === 4) {
    mNames.forEach((m, j) => ind.push([`Indirecto a través de ${esc(m)}`, E['ind' + j]]));
    if (mNames.length > 1) {
      ind.push(['Indirecto total', E.indTot]);
      for (let a = 0; a < mNames.length; a++)
        for (let b = a + 1; b < mNames.length; b++)
          ind.push([`Contraste: ${esc(mNames[a])} − ${esc(mNames[b])}`, E[`con${a}_${b}`]]);
    }
  }
  if (model === 6) {
    Object.keys(E)
      .filter(k => k.startsWith('path'))
      .forEach(k =>
        ind.push([
          `${esc(xN)} → ${k
            .slice(4)
            .split('_')
            .map(j => esc(mNames[+j]))
            .join(' → ')} → ${esc(yN)}`,
          E[k],
        ])
      );
    ind.push(['Indirecto total', E.indTot]);
  }
  if (model === 7 || model === 14) {
    r.wv.forEach((w, q) =>
      ind.push([
        `Indirecto con ${esc(wN)} = ${wv.bin ? esc(wv.lv[q]) : f(w)}${wv.bin ? '' : ` (percentil ${[16, 50, 84][q]})`}`,
        E['cond' + q],
      ])
    );
    ind.push(['Índice de mediación moderada', E.imm]);
  }
  ind.forEach(([lab, e]) =>
    effRows.push([lab, f(e.est, 3), f(e.se, 3), ci2(e.ci), sig(e.ci) ? 'IC excluye 0' : 'IC incluye 0'])
  );
  sec.tables.push(
    apaTable(
      'Efectos total, directo e indirectos',
      ['Efecto', 'Estimación', '<i>EE</i>', 'IC 95 %', 'Significación'],
      effRows,
      `Efectos total y directo con su <i>t</i> habitual; efectos indirectos con EE e IC bootstrap percentil (${r.B} remuestras). Coeficientes no estandarizados.`
    )
  );
  let t = `Se estimó un modelo de ${MN} (modelo ${model} de PROCESS; Hayes, 2022) para analizar si el efecto de ${esc(xN)} sobre ${esc(yN)} ${model === 7 || model === 14 ? `a través de ${esc(mNames[0])} dependía de ${esc(wN)}` : `estaba mediado por ${list(mNames.map(esc))}`}${cNames.length ? `, controlando ${list(cNames.map(esc))}` : ''}, con intervalos de confianza bootstrap de ${r.B} remuestras. `;
  t += `El efecto total fue ${r.total.p < 0.05 ? 'significativo' : 'no significativo'} (<i>c</i> = ${f(r.total.b)}, ${pt(r.total.p)}) y el directo ${r.direct.p < 0.05 ? 'significativo' : 'no significativo'} (<i>c′</i> = ${f(r.direct.b)}, ${pt(r.direct.p)}). `;
  t +=
    ind
      .map(
        ([lab, e]) =>
          `${lab.replace(/<[^>]+>/g, '')}: ${f(e.est, 3)}, IC 95 % ${ci2(e.ci)}${sig(e.ci) ? ' (significativo)' : ' (no significativo)'}`
      )
      .join('; ') + '.';
  if (model === 7 || model === 14)
    t += sig(E.imm.ci)
      ? ` El índice de mediación moderada fue significativo: el efecto indirecto cambió según ${esc(wN)}.`
      : ` El índice de mediación moderada no fue significativo: no hay evidencia de que el efecto indirecto dependa de ${esc(wN)}.`;
  sec.text.push(t);
  return { E };
}
/** Código R reproducible del modelo de PROCESS con bootstrap */
function processRCode({ mNames, cNames, yN, xN, xv, wN, wv, model, sec, MN, E }) {
  const Mn = mNames.map((_, j) => 'M' + (j + 1)),
    Cn = cNames.map((_, j) => 'C' + (j + 1)),
    Cf = Cn.length ? ' + ' + Cn.join(' + ') : '';
  const src = v => `datos[[${rq(v)}]]`,
    bin = (v, info) => (info && info.bin ? `as.numeric(${src(v)} == ${rq(info.lv[1])})` : src(v));
  const dfCode = `d <- data.frame(Y = ${src(yN)}, X = ${bin(xN, xv)}${mNames.map((m, j) => `, ${Mn[j]} = ${src(m)}`).join('')}${wN ? `, W = ${bin(wN, wv)}` : ''}${cNames.map((c, j) => `, ${Cn[j]} = ${src(c)}`).join('')})`;
  let body;
  if (model === 4)
    body = Mn.map((m, j) => `a${j + 1} <- coef(lm(${m} ~ X${Cf}, d))["X"]`)
      .concat([
        `bY <- coef(lm(Y ~ X + ${Mn.join(' + ')}${Cf}, d))`,
        `ind <- c(${Mn.map((m, j) => `a${j + 1} * bY["${m}"]`).join(', ')})`,
        Mn.length > 1 ? 'c(ind, total = sum(ind))' : 'ind',
      ])
      .join('; ');
  else if (model === 6) {
    const eqs = Mn.map(
      (m, j) =>
        `e${j + 1} <- coef(lm(${m} ~ X${Mn.slice(0, j)
          .map(z => ' + ' + z)
          .join('')}${Cf}, d))`
    );
    const paths = Object.keys(E)
      .filter(k => k.startsWith('path'))
      .map(k => k.slice(4).split('_').map(Number));
    const expr = ch =>
      [`e${ch[0] + 1}["X"]`]
        .concat(ch.slice(1).map((j, q) => `e${j + 1}["${Mn[ch[q]]}"]`))
        .concat([`bY["${Mn[ch[ch.length - 1]]}"]`])
        .join(' * ');
    body = eqs
      .concat([
        `bY <- coef(lm(Y ~ X + ${Mn.join(' + ')}${Cf}, d))`,
        `ind <- c(${paths.map(expr).join(', ')})`,
        'c(ind, total = sum(ind))',
      ])
      .join('; ');
  } else if (model === 7)
    body = `eM <- coef(lm(M1 ~ X * W${Cf}, d)); b <- coef(lm(Y ~ X + M1${Cf}, d))["M1"]; c((eM["X"] + eM["X:W"] * ws) * b, indice = unname(eM["X:W"] * b))`;
  else
    body = `a <- coef(lm(M1 ~ X${Cf}, d))["X"]; eY <- coef(lm(Y ~ X + M1 * W${Cf}, d)); c(a * (eY["M1"] + eY["M1:W"] * ws), indice = unname(a * eY["M1:W"]))`;
  const eqR =
    model === 4
      ? Mn.map(m => `verF(lm(${m} ~ X${Cf}, d))`).concat([`verF(lm(Y ~ X + ${Mn.join(' + ')}${Cf}, d))`])
      : model === 6
        ? Mn.map(
            (m, j) =>
              `verF(lm(${m} ~ X${Mn.slice(0, j)
                .map(z => ' + ' + z)
                .join('')}${Cf}, d))`
          ).concat([`verF(lm(Y ~ X + ${Mn.join(' + ')}${Cf}, d))`])
        : model === 7
          ? [`verF(lm(M1 ~ X * W${Cf}, d))`, `verF(lm(Y ~ X + M1${Cf}, d))`]
          : [`verF(lm(M1 ~ X${Cf}, d))`, `verF(lm(Y ~ X + M1 * W${Cf}, d))`];
  sec.code =
    `# PROCESS, modelo ${model} (${MN}) con bootstrap percentil\n# Y = ${yN}; X = ${xN}${mNames.map((m, j) => `; ${Mn[j]} = ${m}`).join('')}${wN ? `; W = ${wN}` : ''}${cNames.map((c, j) => `; ${Cn[j]} = ${c}`).join('')}\n${dfCode}\nd <- d[complete.cases(d), ]\n` +
    (wN ? `ws <- ${wv.bin ? 'c(0, 1)' : 'quantile(d$W, c(.16, .5, .84))'}  # valores de W (como PROCESS v4)\n` : '') +
    `efectos <- function(d, i) { d <- d[i, ]; ${body} }\nset.seed(20261015)\nb <- boot::boot(d, efectos, R = 5000)\nb$t0  # estimaciones\nt(apply(b$t, 2, quantile, c(.025, .975)))  # IC 95 % percentil\n# Ecuaciones (resumen y F sin redondear)\nverF <- function(m) { s <- summary(m); print(s); print(confint(m)); f <- s$fstatistic; c(F = unname(f[1]), gl1 = unname(f[2]), gl2 = unname(f[3]), p = unname(pf(f[1], f[2], f[3], lower.tail = FALSE))) }\n${eqR.join('\n')}\nsummary(lm(Y ~ X${Cf}, d))  # efecto total\nconfint(lm(Y ~ X${Cf}, d))`;
}
function runMediation(yN, xN, mN) {
  const sec = nuevaSeccion(`Mediación: ${xN} → ${mN} → ${yN}`, { test: 'Mediación simple (bootstrap)' });
  if (new Set([yN, xN, mN]).size < 3) {
    sec.error = 'El predictor, el mediador y la variable dependiente deben ser distintos.';
    return sec;
  }
  const xi = numOrBin(vByName(xN)),
    mv = numOf(vByName(mN)),
    yv = numOf(vByName(yN));
  if (!xi) {
    sec.error = 'El predictor debe ser cuantitativo o tener exactamente 2 categorías.';
    return sec;
  }
  const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && mv[i] !== null && xi.vals[i] !== null),
    n = idx.length;
  if (n < 20) {
    sec.error = 'Hay muy pocos casos completos para estimar una mediación (se recomiendan bastantes más de 20).';
    return sec;
  }
  const y = idx.map(i => yv[i]),
    x = idx.map(i => xi.vals[i]),
    m = idx.map(i => mv[i]);
  if (S.sd(x) === 0 || S.sd(m) === 0) {
    sec.error = 'El predictor o el mediador no varía.';
    return sec;
  }
  const r = S.mediation(y, x, m, 5000);
  if (!r) {
    sec.error = 'No se pudo estimar el modelo (colinealidad perfecta).';
    return sec;
  }
  const sigInd = r.ci[0] > 0 || r.ci[1] < 0,
    xL = xi.bin ? `${xN} (0 = ${xi.lv[0]}, 1 = ${xi.lv[1]})` : xN;
  sec.decision = `Se estimó un modelo de mediación simple (${esc(xN)} → ${esc(mN)} → ${esc(yN)}) con ${n} casos completos; el efecto indirecto se contrastó con un intervalo de confianza bootstrap de ${r.B} remuestras.`;
  sec.why.push(
    `Se quiere saber si ${esc(xN)} influye en ${esc(yN)} a través de ${esc(mN)}: el efecto indirecto es el producto de la ruta a (${esc(xN)} → ${esc(mN)}) por la ruta b (${esc(mN)} → ${esc(yN)}, controlando ${esc(xN)}).`
  );
  sec.why.push(
    'El efecto indirecto no sigue una distribución normal, por eso se contrasta con un intervalo de confianza bootstrap (método percentil): es significativo si el intervalo no incluye el 0. Es el procedimiento recomendado (Hayes, PROCESS) frente a la prueba de Sobel o los pasos de Baron y Kenny.'
  );
  sec.checks.push(
    chk(
      'info',
      'La mediación supone un orden causal (X antes que M, y M antes que Y). Con datos transversales, el análisis muestra que los datos son compatibles con ese modelo, pero no demuestra causalidad.'
    )
  );
  sec.checks.push(
    chk(
      n >= 100 ? 'ok' : 'info',
      `Tamaño muestral: ${n} casos.${n >= 100 ? '' : ' Con muestras pequeñas el intervalo bootstrap es amplio y la potencia, baja.'}`
    )
  );
  sec.alt =
    'Mediación con varios mediadores o moderación de la mediación (modelos 7, 14 o 58 de PROCESS) si el diseño lo requiere.';
  mediationReport({ sec, xN, mN, yN, r, xi, xL, sigInd });
  return sec;
}
/** Tablas de caminos y del efecto indirecto, diagrama, redacción y código R de la mediación */
function mediationReport({ sec, xN, mN, yN, r, xi, xL, sigInd }) {
  const st = (k, nm) => [esc(nm), f(r[k], 3), f(r.se[k], 3), f(r.t[k]), pv(r.p[k])];
  sec.tables.push(
    apaTable(
      'Rutas del modelo de mediación',
      ['Ruta', '<i>B</i>', '<i>EE</i>', '<i>t</i>', '<i>p</i>'],
      [
        st('a', `a: ${xN} → ${mN}`),
        st('b', `b: ${mN} → ${yN}`),
        st('cp', `c′ (directo): ${xN} → ${yN}`),
        st('c', `c (total): ${xN} → ${yN}`),
      ],
      `<i>R</i>² de ${esc(mN)} = ${nz(r.r2m.toFixed(3))}; <i>R</i>² de ${esc(yN)} = ${nz(r.r2y.toFixed(3))}.${xi.bin ? ` ${esc(xL)}.` : ''}`
    )
  );
  sec.tables.push(
    apaTable(
      'Efecto indirecto',
      ['Efecto', '<i>B</i>', '<i>EE</i> bootstrap', 'IC 95 % bootstrap', 'Estandarizado'],
      [
        [
          `${esc(xN)} → ${esc(mN)} → ${esc(yN)}`,
          f(r.ab, 3),
          f(r.bootSe, 3),
          `[${f(r.ci[0], 3)}, ${f(r.ci[1], 3)}]`,
          f(r.abStd, 3),
        ],
      ],
      `IC bootstrap percentil con ${r.B} remuestras (al ser un procedimiento aleatorio, otra ejecución o R pueden diferir en la tercera cifra decimal). Prueba de Sobel, como referencia: <i>z</i> = ${f(r.sobel.z)}, ${pt(r.sobel.p)}.`
    )
  );
  const star = p => (p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : '');
  sec.charts.push(
    fig(
      'Diagrama del modelo de mediación',
      CH.pathDiagram(xN, mN, yN, {
        a: `a = ${f(r.a, 2)}${star(r.p.a)}`,
        b: `b = ${f(r.b, 2)}${star(r.p.b)}`,
        c: `c′ = ${f(r.cp, 2)}${star(r.p.cp)} (c = ${f(r.c, 2)}${star(r.p.c)})`,
      }),
      '<div class="small muted" style="margin:0 0 6px">Coeficientes no estandarizados. * <i>p</i> &lt; .05, ** <i>p</i> &lt; .01, *** <i>p</i> &lt; .001.</div>'
    )
  );
  let t = `Se analizó si ${esc(mN)} mediaba la relación entre ${esc(xN)} y ${esc(yN)} mediante un modelo de mediación simple con intervalos de confianza bootstrap (${r.B} remuestras). `;
  t += `${esc(xN)} ${r.p.a < 0.05 ? 'predijo significativamente' : 'no predijo significativamente'} ${esc(mN)} (<i>a</i> = ${f(r.a, 2)}, ${pt(r.p.a)}), y ${esc(mN)} ${r.p.b < 0.05 ? 'predijo significativamente' : 'no predijo significativamente'} ${esc(yN)} controlando ${esc(xN)} (<i>b</i> = ${f(r.b, 2)}, ${pt(r.p.b)}). `;
  t += sigInd
    ? `El efecto indirecto fue estadísticamente significativo, <i>ab</i> = ${f(r.ab, 3)}, IC 95 % [${f(r.ci[0], 3)}, ${f(r.ci[1], 3)}]. `
    : `El efecto indirecto no fue estadísticamente significativo, <i>ab</i> = ${f(r.ab, 3)}, IC 95 % [${f(r.ci[0], 3)}, ${f(r.ci[1], 3)}]. `;
  t += `El efecto total de ${esc(xN)} sobre ${esc(yN)} ${r.p.c < 0.05 ? 'fue' : 'no fue'} significativo (<i>c</i> = ${f(r.c, 2)}, ${pt(r.p.c)}) y el efecto directo, controlando ${esc(mN)}, ${r.p.cp < 0.05 ? 'siguió siendo significativo' : 'no fue significativo'} (<i>c′</i> = ${f(r.cp, 2)}, ${pt(r.p.cp)}).`;
  sec.text.push(t);
  sec.code =
    `# Mediación: ${xN} → ${mN} → ${yN} (bootstrap percentil)\nd <- data.frame(X = ${rCode01(xN, xi)}, M = datos[[${rq(mN)}]], Y = datos[[${rq(yN)}]])\nd <- d[complete.cases(d), ]\n` +
    `ruta_a <- lm(M ~ X, data = d); ruta_bc <- lm(Y ~ X + M, data = d); total <- lm(Y ~ X, data = d)\nsummary(ruta_a); summary(ruta_bc); summary(total)\n` +
    `set.seed(2026)\nindirecto <- replicate(5000, { i <- sample(nrow(d), replace = TRUE); coef(lm(M ~ X, data = d[i, ]))[["X"]] * coef(lm(Y ~ X + M, data = d[i, ]))[["M"]] })\n` +
    `coef(ruta_a)[["X"]] * coef(ruta_bc)[["M"]]  # efecto indirecto\ncoef(ruta_a)[["X"]] * coef(ruta_bc)[["M"]] * sd(d$X) / sd(d$Y)  # efecto indirecto estandarizado\nquantile(indirecto, c(.025, .975))  # IC 95 % bootstrap\n# Prueba de Sobel (como referencia)\na <- coef(ruta_a)[["X"]]; b <- coef(ruta_bc)[["M"]]; ea <- coef(summary(ruta_a))["X", 2]; eb <- coef(summary(ruta_bc))["M", 2]\nz <- a * b / sqrt(b^2 * ea^2 + a^2 * eb^2); c(z = z, p = 2 * pnorm(-abs(z)))`;
}

export { runProcess, runMediation };
