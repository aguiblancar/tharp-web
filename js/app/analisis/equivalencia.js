/* Tharp · aplicación · Análisis: Pruebas de equivalencia (TOST) */
import S from '../../motor/index.js';
import { esc } from '../graficos.js';
import { catOf, levelsOf, numOf, vByName } from '../datos/variables.js';
import { dfF, f, fmtNum, nz, pt, pv, rq } from '../formato.js';
import { apaTable, chk, nuevaSeccion } from '../resultados/piezas.js';

// Una muestra frente a un valor de referencia (por ejemplo, el punto medio de una escala o una norma publicada)
// Equivalencia (TOST, Schuirmann, 1987; Lakens, 2017): dos pruebas t unilaterales frente a los límites [low, high]; IC del 90 %
function runTost(o) {
  const D = { ind: 'dos grupos independientes', paired: 'dos medidas relacionadas', one: 'una muestra' }[o.des];
  const sec = nuevaSeccion(
    `Equivalencia (TOST): ${o.y || ''}${o.des === 'ind' && o.g ? ` según ${o.g}` : o.des === 'paired' && o.y2 ? ` frente a ${o.y2}` : o.des === 'one' && isFinite(o.mu) ? ` frente a ${fmtNum(o.mu)}` : ''}`,
    { test: 'Prueba de equivalencia (TOST)' }
  );
  if (!o.y || !vByName(o.y)) {
    sec.error = 'Elige la variable cuantitativa.';
    return sec;
  }
  if (!(isFinite(o.low) && isFinite(o.high)) || !(o.low < 0 && o.high > 0)) {
    sec.error =
      'Los límites de equivalencia deben ser un número negativo (inferior) y otro positivo (superior), por ejemplo −0.5 y 0.5.';
    return sec;
  }
  const y = numOf(vByName(o.y)),
    U = o.unit === 'd' ? 'd' : 'raw',
    Y = rq(o.y);
  let a,
    b = null,
    lab,
    rc;
  if (o.des === 'ind') {
    if (!o.g || !vByName(o.g)) {
      sec.error = 'Elige la variable de grupo (con exactamente dos categorías).';
      return sec;
    }
    const g = catOf(vByName(o.g)),
      lv = levelsOf(vByName(o.g));
    if (lv.length !== 2) {
      sec.error = 'La variable de grupo debe tener exactamente dos categorías.';
      return sec;
    }
    a = [];
    b = [];
    y.forEach((v, i) => {
      if (v !== null && g[i] === lv[0]) a.push(v);
      else if (v !== null && g[i] === lv[1]) b.push(v);
    });
    lab = [`${esc(lv[0])} − ${esc(lv[1])}`];
    rc = `x = datos[[${Y}]][datos[[${rq(o.g)}]] == ${rq(lv[0])}], y = datos[[${Y}]][datos[[${rq(o.g)}]] == ${rq(lv[1])}], var.equal = FALSE`;
    sec.why.push(
      `Se comparan las medias de ${esc(o.y)} en ${esc(lv[0])} y ${esc(lv[1])} con la t de Welch, que no supone varianzas iguales (como TOSTER por defecto).`
    );
  } else if (o.des === 'paired') {
    if (!o.y2 || !vByName(o.y2) || o.y2 === o.y) {
      sec.error = 'Elige la segunda medida (distinta de la primera).';
      return sec;
    }
    const y2 = numOf(vByName(o.y2));
    a = [];
    b = [];
    y.forEach((v, i) => {
      if (v !== null && y2[i] !== null) {
        a.push(v);
        b.push(y2[i]);
      }
    });
    lab = [`${esc(o.y2)} − ${esc(o.y)}`];
    rc = `x = d2[[${rq(o.y2)}]], y = d2[[${Y}]], paired = TRUE`;
    sec.why.push(
      `Se analiza la diferencia ${esc(o.y2)} − ${esc(o.y)} dentro de cada persona (casos con las dos medidas).`
    );
  } else {
    if (!isFinite(o.mu)) {
      sec.error = 'Escribe un valor de referencia numérico.';
      return sec;
    }
    a = y.filter(v => v !== null);
    lab = [`${esc(o.y)} − ${fmtNum(o.mu)}`];
    rc = `x = datos[[${Y}]], mu = ${fmtNum(o.mu)}`;
    sec.why.push(`Se compara la media de ${esc(o.y)} con el valor de referencia ${fmtNum(o.mu)}.`);
  }
  if (a.length < 3 || (b && b.length < 3)) {
    sec.error = 'Se necesitan al menos 3 casos en cada grupo o medida.';
    return sec;
  }
  const r = S.tost(a, b, { type: o.des, mu: o.mu, low: o.low, high: o.high, bound: U, equalVar: false });
  if (!(r.se > 0)) {
    sec.error = 'No hay variabilidad en los datos: no se puede realizar la prueba.';
    return sec;
  }
  const bTxt =
    U === 'd'
      ? `d = ${fmtNum(o.low)} y ${fmtNum(o.high)} (en unidades de ${esc(o.y)}: ${f(r.low)} y ${f(r.high)})`
      : `${fmtNum(o.low)} y ${fmtNum(o.high)}`;
  sec.decision = `Prueba de equivalencia (TOST) para ${D}, con límites de equivalencia ${bTxt} y α = .05.`;
  sec.why.push(
    'Un resultado no significativo en la prueba t clásica no demuestra que no haya diferencia. La prueba de equivalencia contrasta si la diferencia es menor que la mínima que tendría importancia práctica: hay equivalencia si las dos pruebas unilaterales (la diferencia es mayor que el límite inferior y menor que el superior) son significativas, es decir, si el IC del 90 % queda dentro de los límites.'
  );
  // normalidad, como en las demás pruebas t
  tostChecks({ o, sec, b, a, U, r, lab });
  tostReport({ sec, lab, r, D, bTxt, o, Y, rc, U });
  return sec;
}
/** Supuestos de la prueba de equivalencia: normalidad, límites en d y prueba t clásica de referencia */
function tostChecks({ o, sec, b, a, U, r, lab }) {
  const nrm = (x, nm) => {
    const w = S.shapiro(x),
      n = x.length,
      T = w
        ? `Shapiro-Wilk${nm ? ` en ${nm}` : ''}: <i>W</i> = ${nz(w.W.toFixed(3))}, ${pt(w.p)}`
        : `Shapiro-Wilk no calculable${nm ? ` en ${nm}` : ''}`;
    return w && w.p >= 0.05
      ? chk('ok', T + '. Se cumple la normalidad.')
      : n >= 30
        ? chk('info', T + `. No es normal, pero con <i>n</i> = ${n} ≥ 30 la prueba t es robusta.`)
        : chk('no', T + '. No se cumple y la muestra es pequeña: interpreta con cautela.');
  };
  if (o.des === 'ind') {
    sec.checks.push(nrm(a, lab[0].split(' − ')[0]));
    sec.checks.push(nrm(b, lab[0].split(' − ')[1]));
  } else
    sec.checks.push(
      nrm(o.des === 'paired' ? b.map((v, i) => v - a[i]) : a, o.des === 'paired' ? 'las diferencias' : '')
    );
  if (U === 'd')
    sec.checks.push(
      chk(
        'info',
        `Límites en d pasados a unidades de la variable con la ${o.des === 'ind' ? 'raíz de la media de las varianzas de los dos grupos' : o.des === 'paired' ? 'DT de las diferencias' : 'DT de la muestra'} (DT = ${f(r.sd)}), como TOSTER. Si conoces la diferencia mínima relevante en las unidades de la variable, es preferible fijarla así.`
      )
    );
  sec.checks.push(
    chk(
      'info',
      'Los límites deben fijarse antes de ver los datos y justificarse (estudios previos, criterio clínico o la diferencia mínima importante).'
    )
  );
}
/** Tabla de las dos pruebas unilaterales, redacción APA y código R (TOSTER) */
function tostReport({ sec, lab, r, D, bTxt, o, Y, rc, U }) {
  sec.tables.push(
    apaTable(
      'Prueba de equivalencia (TOST)',
      [
        'Comparación',
        'Diferencia',
        'IC 90 %',
        'Límites',
        '<i>t</i> (límite inferior)',
        '<i>p</i>',
        '<i>t</i> (límite superior)',
        '<i>p</i>',
        '<i>gl</i>',
        '<i>p</i> TOST',
      ],
      [
        [
          lab[0],
          f(r.est),
          `[${f(r.ci[0])}, ${f(r.ci[1])}]`,
          `[${f(r.low)}, ${f(r.high)}]`,
          f(r.tLo),
          pv(r.pLo),
          f(r.tHi),
          pv(r.pHi),
          dfF(r.df),
          pv(r.p),
        ],
      ],
      `La <i>p</i> del TOST es la mayor de las dos pruebas unilaterales. Prueba t clásica (diferencia = 0): <i>t</i>(${dfF(r.df)}) = ${f(r.t0)}, ${pt(r.p0)}. d = ${f(r.dEst)}.`
    )
  );
  const nhst = r.p0 < 0.05;
  sec.text.push(
    `Se realizó una prueba de equivalencia de dos pruebas unilaterales (TOST; Lakens, 2017) para ${D}, con límites de equivalencia de ${bTxt}. La diferencia fue de ${f(r.est)}, IC 90 % [${f(r.ci[0])}, ${f(r.ci[1])}]. ` +
      (r.equivalent
        ? `El efecto fue estadísticamente equivalente: queda dentro de los límites, <i>t</i>(${dfF(r.df)}) = ${f(r.pLo > r.pHi ? r.tLo : r.tHi)}, ${pt(r.p)}. `
        : `No se pudo concluir que haya equivalencia, <i>t</i>(${dfF(r.df)}) = ${f(r.pLo > r.pHi ? r.tLo : r.tHi)}, ${pt(r.p)}: el IC del 90 % no queda dentro de los límites. `) +
      `La prueba t clásica ${nhst ? 'sí' : 'no'} detectó una diferencia distinta de 0, <i>t</i>(${dfF(r.df)}) = ${f(r.t0)}, ${pt(r.p0)}${r.equivalent && nhst ? ', por lo que la diferencia existe pero es demasiado pequeña para tener importancia práctica' : !r.equivalent && !nhst ? ', así que el resultado no es concluyente (posiblemente falta tamaño muestral)' : ''}.`
  );
  sec.code =
    `# Equivalencia (TOST) con TOSTER\n` +
    (o.des === 'paired' ? `d2 <- na.omit(datos[, c(${Y}, ${rq(o.y2)})])\n` : '') +
    (o.des === 'ind'
      ? `tapply(datos[[${Y}]], datos[[${rq(o.g)}]], shapiro.test)  # normalidad por grupo\n`
      : o.des === 'paired'
        ? `shapiro.test(d2[[${rq(o.y2)}]] - d2[[${Y}]])  # normalidad de las diferencias\n`
        : `shapiro.test(datos[[${Y}]])  # normalidad\n`) +
    (o.des === 'one'
      ? `# en una muestra, TOSTER toma los límites en la escala de la variable: valor de referencia + límite\n`
      : '') +
    `r <- TOSTER::t_TOST(${rc}, low_eqbound = ${o.des === 'one' ? `${fmtNum(o.mu)} + ` : ''}${U === 'd' && o.des === 'one' ? `${fmtNum(o.low)} * sd(datos[[${Y}]], na.rm = TRUE)` : fmtNum(o.low)}, high_eqbound = ${o.des === 'one' ? `${fmtNum(o.mu)} + ` : ''}${U === 'd' && o.des === 'one' ? `${fmtNum(o.high)} * sd(datos[[${Y}]], na.rm = TRUE)` : fmtNum(o.high)}, eqbound_type = "${U === 'd' && o.des !== 'one' ? 'SMD' : 'raw'}", alpha = .05)\n` +
    `r\nprint(r$TOST, digits = 7)  # t, EE, gl y p de la t clásica y de las dos pruebas unilaterales\nprint(r$effsize, digits = 7)  # diferencia con IC del 90 %\nprint(r$eqb, digits = 7)  # límites en unidades de la variable\n${o.des === 'one' ? `c(limite_inf = r$eqb$low_eq[1] - ${fmtNum(o.mu)}, limite_sup = r$eqb$high_eq[1] - ${fmtNum(o.mu)})  # límites respecto al valor de referencia\n` : ''}max(r$TOST[2:3, "p.value"])  # p del TOST`;
}

export { runTost };
