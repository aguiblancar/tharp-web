/* Tharp · aplicación · Análisis: Modelos lineales mixtos */
import S from '../../motor/index.js';
import { esc } from '../graficos.js';
import { numOf, vByName } from '../datos/variables.js';
import { f, list, nz, pt, pv, r2s, rn } from '../formato.js';
import { apaTable, chk, design, nuevaSeccion } from '../resultados/piezas.js';
import { maxOf, minOf } from '../utilidades.js';

function runLmm(yN, xNames, gN, slopeN, inter = []) {
  const sec = nuevaSeccion(`Modelo mixto: ${yN}`, { test: 'Modelo lineal mixto (REML)' });
  xNames = xNames.filter(n => n !== yN && n !== gN);
  if (gN === yN) {
    sec.error = 'La variable de agrupación no puede ser la variable dependiente.';
    return sec;
  }
  if (slopeN && !xNames.includes(slopeN)) {
    sec.error = `Para estimar una pendiente aleatoria de ${slopeN}, inclúyela también como efecto fijo.`;
    return sec;
  }
  const yv = numOf(vByName(yN)),
    gv = vByName(gN).raw.map(x => (x === null ? null : String(x)));
  const [iA, iB] = inter,
    hasI = !!(iA && iB);
  if ((iA || iB) && !hasI) {
    sec.error = 'Para la interacción elige los dos predictores (A y B).';
    return sec;
  }
  if (hasI && (iA === iB || !xNames.includes(iA) || !xNames.includes(iB))) {
    sec.error = 'Los dos predictores de la interacción deben ser distintos y estar incluidos como efectos fijos.';
    return sec;
  }
  const { idx, cols, X } = design(xNames, i => yv[i] !== null && gv[i] !== null),
    n = idx.length;
  if (hasI) {
    // columnas de la interacción: producto de las columnas de A por las de B (variables ficticias incluidas)
    const ca = cols.map((c, k) => ({ c, k })).filter(o => o.c.v && o.c.v.name === iA),
      cb = cols.map((c, k) => ({ c, k })).filter(o => o.c.v && o.c.v.name === iB);
    ca.forEach(a =>
      cb.forEach(b => {
        cols.push({ name: `${a.c.name} × ${b.c.name}`, inter: true });
        X.forEach(r => r.push(r[a.k] * r[b.k]));
      })
    );
  }
  if (n < 10) {
    sec.error = 'Hay muy pocas observaciones completas.';
    return sec;
  }
  const g = idx.map(i => gv[i]),
    y = idx.map(i => yv[i]),
    sizes = Object.values(g.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {})),
    ng = sizes.length;
  if (maxOf(sizes) < 2) {
    sec.error = `Cada valor de «${gN}» aparece en una sola fila. Un modelo mixto necesita varias filas por persona o grupo: organiza los datos en formato largo (una fila por medición) o elige otra variable de agrupación.`;
    return sec;
  }
  if (ng < 3) {
    sec.error = `Solo hay ${ng} grupos: se necesitan bastantes más para estimar la variabilidad entre grupos.`;
    return sec;
  }
  const zcol = slopeN ? cols.findIndex(c => c.name === slopeN) : -1;
  if (slopeN && (zcol < 0 || cols[zcol].level !== undefined)) {
    sec.error = 'La pendiente aleatoria debe ser un predictor cuantitativo.';
    return sec;
  }
  if (xNames.length && n < cols.length + 3) {
    sec.error = 'Hay pocas observaciones para tantos predictores.';
    return sec;
  }
  const r = S.lmm(y, X, g, zcol),
    r0 = S.lmm(
      y,
      y.map(() => [1]),
      g,
      -1
    );
  if (!r || !isFinite(r.s2)) {
    sec.error = 'No se pudo estimar el modelo (colinealidad perfecta entre predictores o datos insuficientes).';
    return sec;
  }
  lmmChecks({ r, sec, n, ng, gN, hasI, iA, iB, slopeN, r0, yN, sizes });
  lmmTables({ sec, cols, gN, r, slopeN, n, ng, r0 });
  lmmTextAndCode({ cols, yN, n, ng, gN, slopeN, r0, sec, xNames, hasI, iA, iB, r });
  return sec;
}
/** Motivos y supuestos del modelo mixto (normalidad de residuos, ajuste singular, tamaño de los grupos) */
function lmmChecks({ r, sec, n, ng, gN, hasI, iA, iB, slopeN, r0, yN, sizes }) {
  const sw = S.shapiro(r.resid.length > 5000 ? r.resid.slice(0, 5000) : r.resid);
  sec.decision = `Se ajustó un modelo lineal mixto por REML con ${n} observaciones de ${ng} unidades de ${esc(gN)}, con intercepto aleatorio${hasI ? ` y la interacción ${esc(iA)} × ${esc(iB)}` : ''}${slopeN ? ` y pendiente aleatoria de ${esc(slopeN)}` : ''}.`;
  sec.why.push(
    `Las observaciones no son independientes: varias pertenecen a la misma unidad (${esc(gN)}). Ignorarlo infla los falsos positivos; el modelo mixto lo tiene en cuenta con efectos aleatorios.`
  );
  sec.why.push(
    `El intercepto aleatorio permite que cada ${esc(gN)} tenga su propio nivel medio${slopeN ? `, y la pendiente aleatoria, que el efecto de ${esc(slopeN)} varíe entre ellos` : ''}.`
  );
  sec.why.push(
    'Los grados de libertad de los efectos fijos se calculan con la aproximación de Satterthwaite (como lmerTest en R), y los datos perdidos no obligan a eliminar a la persona entera: se usan todas las mediciones disponibles.'
  );
  sec.checks.push(
    chk(
      r0.icc >= 0.05 ? 'ok' : 'info',
      `Correlación intraclase (modelo nulo): CCI = ${nz(r0.icc.toFixed(3))}. El ${f(r0.icc * 100, 1)} % de la varianza de ${esc(yN)} se debe a diferencias entre unidades de ${esc(gN)}.${r0.icc < 0.05 ? ' Es baja: el modelo mixto puede no aportar mucho frente a una regresión.' : ''}`
    )
  );
  sec.checks.push(
    chk(
      ng >= 20 ? 'ok' : 'info',
      `Número de grupos: ${ng} (entre ${minOf(sizes)} y ${maxOf(sizes)} observaciones por grupo).${ng >= 20 ? '' : ' Con menos de 20 grupos la varianza aleatoria se estima con poca precisión.'}`
    )
  );
  if (r.singular)
    sec.warn =
      'Ajuste singular: la varianza de algún efecto aleatorio es prácticamente 0 (o la correlación entre efectos aleatorios es ±1). El modelo es demasiado complejo para los datos: simplifica la parte aleatoria (por ejemplo, quita la pendiente aleatoria).';
  if (sw)
    sec.checks.push(
      chk(
        sw.p >= 0.05 ? 'ok' : n >= 100 ? 'info' : 'no',
        `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}.${sw.p >= 0.05 ? '' : n >= 100 ? ' Con muchas observaciones el modelo es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña.'}`
      )
    );
  sec.alt = 'Modelo lineal generalizado mixto (GLMM) si la variable dependiente es dicotómica o un recuento.';
}
/** Tablas de efectos fijos y de componentes de varianza del modelo mixto */
function lmmTables({ sec, cols, gN, r, slopeN, n, ng, r0 }) {
  sec.tables.push(
    apaTable(
      'Efectos fijos',
      ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>gl</i>', '<i>t</i>', '<i>p</i>', 'IC 95 %'],
      cols.map((c, j) => [
        esc(c.name),
        f(r.beta[j], 3),
        f(r.se[j], 3),
        f(r.df[j], 1),
        f(r.t[j]),
        pv(r.p[j]),
        `[${f(r.ci[j][0], 3)}, ${f(r.ci[j][1], 3)}]`,
      ]),
      'Grados de libertad de Satterthwaite. Las variables categóricas se codifican frente a su primera categoría.'
    )
  );
  const reRows = [[`${esc(gN)}: intercepto`, f(r.Tau[0][0], 3), f(Math.sqrt(r.Tau[0][0]), 3)]];
  if (slopeN) reRows.push([`${esc(gN)}: pendiente de ${esc(slopeN)}`, f(r.Tau[1][1], 3), f(Math.sqrt(r.Tau[1][1]), 3)]);
  reRows.push(['Residual', f(r.s2, 3), f(Math.sqrt(r.s2), 3)]);
  sec.tables.push(
    apaTable(
      'Efectos aleatorios',
      ['Componente', 'Varianza', '<i>DT</i>'],
      reRows,
      (slopeN ? `Correlación entre intercepto y pendiente aleatorios: ${r2s(r.corRE)}. ` : '') +
        `${n} observaciones; ${ng} grupos. <i>R</i>² marginal = ${nz(r.r2m.toFixed(3))}; <i>R</i>² condicional = ${nz(r.r2c.toFixed(3))} (Nakagawa). CCI del modelo nulo = ${nz(r0.icc.toFixed(3))}.`
    )
  );
}
/** Redacción APA y código R del modelo lineal mixto */
function lmmTextAndCode({ cols, yN, n, ng, gN, slopeN, r0, sec, xNames, hasI, iA, iB, r }) {
  const sig = cols.map((c, j) => ({ c, j })).filter(o => o.j > 0 && r.p[o.j] < 0.05);
  let t = `Se ajustó un modelo lineal mixto (REML) para ${esc(yN)} con ${n} observaciones anidadas en ${ng} unidades de ${esc(gN)}, con intercepto aleatorio${slopeN ? ` y pendiente aleatoria de ${esc(slopeN)}` : ''}. La correlación intraclase del modelo nulo fue ${nz(r0.icc.toFixed(2))}: el ${f(r0.icc * 100, 1)} % de la varianza se debía a diferencias entre unidades de ${esc(gN)}. `;
  if (cols.length > 1) {
    const sigI = sig.filter(o => o.c.inter);
    if (hasI)
      t += sigI.length
        ? `La interacción ${esc(iA)} × ${esc(iB)} fue estadísticamente significativa (${list(sigI.map(o => `<i>B</i> = ${f(r.beta[o.j], 2)}, <i>t</i>(${f(r.df[o.j], 1)}) = ${f(r.t[o.j])}, ${pt(r.p[o.j])}`))}): el efecto de ${esc(iA)} depende de ${esc(iB)}, por lo que los efectos principales deben interpretarse con cautela. `
        : `La interacción ${esc(iA)} × ${esc(iB)} no fue estadísticamente significativa. `;
    if (sig.filter(o => !o.c.inter).length)
      t +=
        list(
          sig
            .filter(o => !o.c.inter)
            .map(
              o =>
                `${esc(o.c.name)} se asoció ${r.beta[o.j] > 0 ? 'positivamente' : 'negativamente'} con ${esc(yN)} (<i>B</i> = ${f(r.beta[o.j], 2)}, <i>t</i>(${f(r.df[o.j], 1)}) = ${f(r.t[o.j])}, ${pt(r.p[o.j])})`
            )
        ) + '. ';
    const nsM = cols.filter((c, j) => j > 0 && !c.inter && r.p[j] >= 0.05).map(c => esc(c.name));
    if (nsM.length)
      t += `${list(nsM)} no ${nsM.length > 1 ? 'fueron predictores significativos' : 'fue un predictor significativo'}. `;
    t += `Los efectos fijos explicaron el ${f(r.r2m * 100, 1)} % de la varianza (<i>R</i>² marginal) y el modelo completo, el ${f(r.r2c * 100, 1)} % (<i>R</i>² condicional).`;
  }
  sec.text.push(t);
  const fx = (xNames.length ? xNames.map(rn).join(' + ') : '1') + (hasI ? ` + ${rn(iA)}:${rn(iB)}` : '');
  sec.code =
    `# Modelo lineal mixto: ${yN}\nmodelo <- lmerTest::lmer(${rn(yN)} ~ ${fx} + (${slopeN ? `1 + ${rn(slopeN)}` : '1'} | ${rn(gN)}), data = datos, REML = TRUE)\nsummary(modelo)  # gl de Satterthwaite\ncf <- summary(modelo)$coefficients; cbind(IC_inf = cf[, 1] - qt(.975, cf[, "df"]) * cf[, 2], IC_sup = cf[, 1] + qt(.975, cf[, "df"]) * cf[, 2])  # IC 95 % con t y gl de Satterthwaite (como Tharp y SPSS)\nconfint(modelo, method = "Wald")  # referencia: IC de Wald (normal)\n` +
    `performance::r2_nakagawa(modelo)\nperformance::icc(lmerTest::lmer(${rn(yN)} ~ 1 + (1 | ${rn(gN)}), data = datos, REML = TRUE))  # CCI del modelo nulo\nshapiro.test(head(residuals(modelo), 5000))  # residuos condicionales (shapiro.test admite hasta 5000)`;
}

export { runLmm };
