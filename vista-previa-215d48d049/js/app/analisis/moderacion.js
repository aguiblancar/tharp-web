/* Tharp · aplicación · Análisis: Moderación */
import S from '../../motor/index.js';
import CH, { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { ST } from '../estado.js';
import { f, list, nz, pt, pv, rq } from '../formato.js';
import { apaTable, chk, fig, nuevaSeccion, numOrBin, rCode01 } from '../resultados/piezas.js';
import { maxOf, minOf } from '../utilidades.js';

function runModeration(yN, xN, wN) {
  const sec = nuevaSeccion(`Moderación: ${xN} → ${yN}, moderado por ${wN}`, {
    test: 'Moderación (regresión con interacción)',
  });
  if (new Set([yN, xN, wN]).size < 3) {
    sec.error = 'La variable dependiente, el predictor y el moderador deben ser distintos.';
    return sec;
  }
  const yv = numOf(vByName(yN)),
    xi = numOrBin(vByName(xN)),
    wi = numOrBin(vByName(wN));
  if (!xi || !wi) {
    sec.error = 'El predictor y el moderador deben ser cuantitativos o tener exactamente 2 categorías.';
    return sec;
  }
  const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && xi.vals[i] !== null && wi.vals[i] !== null),
    n = idx.length;
  if (n < 10) {
    sec.error = 'Hay muy pocos casos completos.';
    return sec;
  }
  const y = idx.map(i => yv[i]),
    x = idx.map(i => xi.vals[i]),
    w = idx.map(i => wi.vals[i]);
  if (S.sd(x) === 0 || S.sd(w) === 0) {
    sec.error = 'El predictor o el moderador no varía.';
    return sec;
  }
  const r = S.moderation(y, x, w, null, !xi.bin, !wi.bin);
  if (r && r.r2 > 1 - 1e-10) {
    sec.error =
      'La variable dependiente es una combinación exacta de las predictoras (R² = 1): no hay error que estimar, así que el modelo no tiene sentido. Revisa si una variable se calculó a partir de otra.';
    return sec;
  }
  if (!r) {
    sec.error = 'No se pudo estimar el modelo (colinealidad perfecta).';
    return sec;
  }
  const sdW = S.sd(w),
    mW = S.mean(w),
    sdX = S.sd(x),
    mX = S.mean(x);
  const wPts = wi.bin
    ? [
        { v: 0, lab: `${wN} = ${wi.lv[0]}` },
        { v: 1, lab: `${wN} = ${wi.lv[1]}` },
      ]
    : [
        { v: mW - sdW, lab: `${wN} bajo (−1 DT = ${f(mW - sdW)})` },
        { v: mW, lab: `${wN} medio (${f(mW)})` },
        { v: mW + sdW, lab: `${wN} alto (+1 DT = ${f(mW + sdW)})` },
      ];
  const sl = wPts.map(pt0 => Object.assign(r.slope(pt0.v), { lab: pt0.lab }));
  const xLab = xi.bin ? `${xN} (0 = ${xi.lv[0]}, 1 = ${xi.lv[1]})` : `${xN} (centrada)`,
    wLab = wi.bin ? `${wN} (0 = ${wi.lv[0]}, 1 = ${wi.lv[1]})` : `${wN} (centrada)`;
  sec.decision = `Se estimó un modelo de moderación (regresión con el término de interacción ${esc(xN)} × ${esc(wN)}) con ${n} casos completos${!xi.bin || !wi.bin ? '; las variables cuantitativas se centraron en su media' : ''}.`;
  sec.why.push(
    `Se quiere saber si el efecto de ${esc(xN)} sobre ${esc(yN)} depende de ${esc(wN)}: eso es un efecto de moderación, que se contrasta con el término de interacción.`
  );
  sec.why.push(
    'Centrar las variables cuantitativas no cambia la interacción, pero hace interpretables los efectos principales (son el efecto de cada variable en el valor medio de la otra) y reduce la colinealidad.'
  );
  sec.why.push(
    wi.bin
      ? `Como el moderador tiene dos categorías, se estima el efecto de ${esc(xN)} en cada una.`
      : 'Las pendientes simples muestran el efecto de X para valores bajos (−1 DT), medios y altos (+1 DT) del moderador; la región de Johnson-Neyman indica a partir de qué valor exacto del moderador el efecto es significativo.'
  );
  moderationChecksAndTables({ r, sec, n, xLab, wLab, xN, wN, yN, sl });
  // región de Johnson-Neyman dentro del rango observado
  const { jnTxt } = moderationJohnsonNeymanAndChart({ wi, xi, mX, sdX, xN, sec, yN, wN, wPts, w, r });
  moderationTextAndCode({ r, wN, xN, yN, xi, wi, sec, sl, jnTxt });
  return sec;
}
/** Supuestos, tabla del modelo y pendientes simples de la moderación */
function moderationChecksAndTables({ r, sec, n, xLab, wLab, xN, wN, yN, sl }) {
  const swr = S.shapiro(r.resid);
  sec.checks.push(
    chk(
      swr && swr.p >= 0.05 ? 'ok' : n >= 100 ? 'info' : 'no',
      `Normalidad de los residuos (Shapiro-Wilk): ${swr ? `<i>W</i> = ${nz(swr.W.toFixed(3))}, ${pt(swr.p)}` : 'no calculable'}.${swr && swr.p < 0.05 && n >= 100 ? ' Con muestras grandes el modelo es robusto a desviaciones moderadas.' : ''}`
    )
  );
  sec.checks.push(
    chk(
      r.bp.p >= 0.05 ? 'ok' : 'no',
      `Homocedasticidad (Breusch-Pagan): χ²(${r.bp.df}) = ${f(r.bp.LM)}, ${pt(r.bp.p)}.${r.bp.p >= 0.05 ? ' Se cumple.' : ' No se cumple: interpreta los errores típicos con cautela.'}`
    )
  );
  sec.checks.push(
    chk('info', 'Linealidad: se asume que la relación entre X e Y es lineal para cada valor del moderador.')
  );
  sec.alt =
    'Si el moderador es categórico con más de dos grupos, un ANOVA factorial o una regresión con variables ficticias y sus interacciones.';
  const nmT = ['(Constante)', xLab, wLab, `${xN} × ${wN}`],
    tc = k => `[${f(r.ci[k][0], 3)}, ${f(r.ci[k][1], 3)}]`;
  sec.tables.push(
    apaTable(
      `Modelo de moderación para ${yN}`,
      ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>t</i>', '<i>p</i>', 'IC 95 %'],
      nmT.map((nm, k) => [esc(nm), f(r.b[k], 3), f(r.se[k], 3), f(r.t[k]), pv(r.p[k]), tc(k)]),
      `<i>R</i>² = ${nz(r.r2.toFixed(3))}, <i>F</i>(${r.df1}, ${r.dfr}) = ${f(r.F)}, ${pt(r.pF)}. Cambio en <i>R</i>² por la interacción: Δ<i>R</i>² = ${nz(r.dR2.toFixed(3))}, <i>F</i>(1, ${r.dfr}) = ${f(r.Fch)}, ${pt(r.pch)}.`
    )
  );
  sec.tables.push(
    apaTable(
      `Efecto de ${xN} sobre ${yN} según ${wN} (pendientes simples)`,
      ['Valor del moderador', 'Efecto de X', '<i>EE</i>', '<i>t</i>', '<i>p</i>', 'IC 95 %'],
      sl.map(o => [esc(o.lab), f(o.b, 3), f(o.se, 3), f(o.t), pv(o.p), `[${f(o.ci[0], 3)}, ${f(o.ci[1], 3)}]`])
    )
  );
}
/** Región de Johnson-Neyman y gráfico de pendientes simples */
function moderationJohnsonNeymanAndChart({ wi, xi, mX, sdX, xN, sec, yN, wN, wPts, w, r }) {
  let jnTxt = '';
  if (!wi.bin) {
    const lo = minOf(w),
      hi = maxOf(w),
      cuts = [lo].concat(r.jn.filter(v => v > lo && v < hi)).concat([hi]),
      segs = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const mid = (cuts[k] + cuts[k + 1]) / 2;
      if (r.slope(mid).p < 0.05) segs.push([cuts[k], cuts[k + 1]]);
    }
    const inner = r.jn.filter(v => v > lo && v < hi);
    jnTxt = !segs.length
      ? `En el rango observado de ${esc(wN)} (${f(lo)} a ${f(hi)}), el efecto de ${esc(xN)} no fue significativo para ningún valor del moderador.`
      : segs.length === 1 && segs[0][0] === lo && segs[0][1] === hi
        ? `El efecto de ${esc(xN)} fue significativo en todo el rango observado de ${esc(wN)} (${f(lo)} a ${f(hi)}).`
        : `Según la técnica de Johnson-Neyman, el efecto de ${esc(xN)} fue significativo cuando ${esc(wN)} ${list(segs.map(sg => (sg[0] === lo ? `≤ ${f(sg[1])}` : sg[1] === hi ? `≥ ${f(sg[0])}` : `estaba entre ${f(sg[0])} y ${f(sg[1])}`)))}${inner.length ? '' : ''}.`;
    sec.checks.push(chk('info', `Región de Johnson-Neyman (α = .05): ${jnTxt}`));
  }
  // gráfico: valores predichos de Y para X bajo/medio/alto en cada nivel del moderador
  const xPts = xi.bin
    ? [
        { v: 0, lab: xi.lv[0] },
        { v: 1, lab: xi.lv[1] },
      ]
    : [
        { v: mX - sdX, lab: `${xN} bajo` },
        { v: mX, lab: `${xN} medio` },
        { v: mX + sdX, lab: `${xN} alto` },
      ];
  const pred = (xv, wv) => {
    const xc = xv - r.mx,
      wc = wv - r.mw;
    return r.b[0] + r.b[1] * xc + r.b[2] * wc + r.b[3] * xc * wc;
  };
  sec.charts.push(
    fig(
      `Efecto de ${xN} sobre ${yN} según ${wN}`,
      CH.interaction(
        xPts.map(o => o.lab),
        wPts.map(o => ({
          name: o.lab,
          means: xPts.map(xp => pred(xp.v, o.v)),
          ci: xPts.map(xp => [pred(xp.v, o.v), pred(xp.v, o.v)]),
        })),
        `${yN} (predicho)`
      ),
      CH.legend(wPts.map(o => o.lab))
    )
  );
  return { jnTxt };
}
/** Redacción APA y código R de la moderación */
function moderationTextAndCode({ r, wN, xN, yN, xi, wi, sec, sl, jnTxt }) {
  const st = `<i>B</i> = ${f(r.b[3], 3)}, <i>t</i>(${r.dfr}) = ${f(r.t[3])}, ${pt(r.p[3])}, Δ<i>R</i>² = ${nz(r.dR2.toFixed(3))}`;
  let t = `Se analizó si ${esc(wN)} moderaba la relación entre ${esc(xN)} y ${esc(yN)} mediante una regresión con el término de interacción${!xi.bin || !wi.bin ? ' (variables cuantitativas centradas)' : ''}. El modelo explicó el ${f(r.r2 * 100, 1)} % de la varianza de ${esc(yN)}, <i>F</i>(${r.df1}, ${r.dfr}) = ${f(r.F)}, ${pt(r.pF)}. `;
  if (r.p[3] < 0.05) {
    t += `La interacción ${esc(xN)} × ${esc(wN)} fue estadísticamente significativa, ${st}, lo que indica que el efecto de ${esc(xN)} depende de ${esc(wN)}. `;
    t +=
      'El análisis de pendientes simples mostró que el efecto de ' +
      esc(xN) +
      ' ' +
      list(
        sl.map(
          o =>
            `${o.p < 0.05 ? 'fue significativo' : 'no fue significativo'} ${wi.bin ? `en ${esc(o.lab.split(' = ')[1])}` : `con ${esc(wN)} ${o.lab.split(' ')[1]}`} (<i>B</i> = ${f(o.b, 2)}, ${pt(o.p)})`
        )
      ) +
      '. ';
    if (jnTxt) t += jnTxt;
  } else
    t += `La interacción ${esc(xN)} × ${esc(wN)} no fue estadísticamente significativa, ${st}: no hay evidencia de que ${esc(wN)} modere el efecto de ${esc(xN)}.`;
  sec.text.push(t);
  const Y = rq(yN);
  sec.code =
    `# Moderación: ${xN} → ${yN}, moderador ${wN}\nd <- data.frame(Y = datos[[${Y}]], X = ${rCode01(xN, xi)}, W = ${rCode01(wN, wi)})\nd <- d[complete.cases(d), ]\n` +
    (wi.bin
      ? ''
      : 'c(bajo = mean(d$W) - sd(d$W), medio = mean(d$W), alto = mean(d$W) + sd(d$W))  # valores del moderador (−1 DT, media, +1 DT)\n') +
    (xi.bin ? '' : 'd$X <- d$X - mean(d$X)  # centrada\n') +
    (wi.bin ? '' : 'd$W <- d$W - mean(d$W)  # centrada\n') +
    `modelo <- lm(Y ~ X * W, data = d)\nsummary(modelo); confint(modelo)\ns <- summary(modelo)$fstatistic; c(F = unname(s[1]), gl1 = unname(s[2]), gl2 = unname(s[3]), p = unname(pf(s[1], s[2], s[3], lower.tail = FALSE)))  # sin redondear\nanova(lm(Y ~ X + W, data = d), modelo)  # cambio en R² por la interacción\nshapiro.test(residuals(modelo))\nlmtest::bptest(modelo)\n` +
    `emmeans::emtrends(modelo, ~ W, var = "X", at = list(W = ${wi.bin ? 'c(0, 1)' : 'c(-sd(d$W), 0, sd(d$W))'}), infer = TRUE)  # pendientes simples\n# Región de Johnson-Neyman (paquete interactions): interactions::johnson_neyman(modelo, pred = X, modx = W)`;
}

export { runModeration };
