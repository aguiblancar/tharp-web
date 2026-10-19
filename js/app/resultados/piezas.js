/* Tharp · aplicación · Piezas comunes de los resultados: tablas APA, figuras, diseño y código R auxiliar */
import { esc } from '../graficos.js';
import { numeracion, ST } from '../estado.js';
import S from '../../motor/index.js';
import { catOf, levelsOf, numOf, ordOf, vByName } from '../datos/variables.js';
import { rq } from '../formato.js';

/**
 * Sección de resultados: la unidad común que produce cada análisis. La pantalla (resultados/ejecutar.js), el Word
 * (exportar/word.js) y el script de R (exportar/r.js) se construyen a partir de las secciones.
 * @typedef {Object} Seccion
 * @property {string} title Título del análisis (por ejemplo, «ansiedad_post según grupo»).
 * @property {string[]} why Motivos de la elección de la prueba (HTML).
 * @property {{ s: 'ok' | 'no' | 'info', t: string }[]} checks Supuestos comprobados y su resultado.
 * @property {TablaAPA[]} tables Tablas en formato APA, creadas con apaTable().
 * @property {{ title: string, svg: string, legend: string, wide: boolean }[]} charts Figuras (SVG), creadas con fig().
 * @property {string[]} text Párrafos de resultados redactados en APA (HTML).
 * @property {string} code Código R que reproduce los números de la sección.
 * @property {string} [test] Prueba realizada (etiqueta breve).
 * @property {string} [decision] Decisión para el registro de decisiones.
 * @property {string} [error] Motivo por el que no se pudo realizar el análisis.
 * @property {string} [warn] Aviso destacado.
 * @property {string} [alt] Alternativa a la prueba elegida.
 * @property {string} [sens] Nota de análisis de sensibilidad.
 */

/**
 * Crea una sección vacía con su título y, opcionalmente, campos iniciales (por ejemplo, un error).
 * @param {string} title
 * @param {Partial<Seccion>} [extra]
 * @returns {Seccion}
 */
const nuevaSeccion = (title, extra = {}) => ({
  title,
  why: [],
  checks: [],
  tables: [],
  charts: [],
  text: [],
  code: '',
  ...extra,
});

/**
 * Tabla en formato APA como dato estructurado: la pantalla la convierte en HTML (tablaHTML) y el Word la construye
 * directamente a partir de sus campos, sin volver a leer HTML.
 * @typedef {Object} TablaAPA
 * @property {number} num Número de tabla dentro de los resultados.
 * @property {string} title Título (texto plano).
 * @property {string[]} head Encabezados de columna (HTML en línea: cursivas, subíndices).
 * @property {Array<Array<string|number>>} rows Filas de celdas (HTML en línea).
 * @property {string} [note] Nota de la tabla (HTML en línea), sin el «Nota.» inicial.
 * @property {string} [cls] Clase CSS adicional.
 */

/**
 * HTML de una tabla APA para la pantalla.
 * @param {TablaAPA} t
 * @returns {string}
 */
const tablaHTML = t =>
  `<div class="scroll"><table class="apa ${t.cls}"><caption><b>Tabla ${t.num}</b><i>${esc(t.title)}</i></caption><thead><tr>${t.head.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.note ? `<div class="note"><i>Nota.</i> ${t.note}</div>` : ''}</div>`;

/**
 * Crea una tabla APA numerada.
 * @param {string} title
 * @param {string[]} head
 * @param {Array<Array<string|number>>} rows
 * @param {string} [note]
 * @param {string} [cls]
 * @returns {TablaAPA}
 */
function apaTable(title, head, rows, note, cls = '') {
  numeracion.tabla++;
  return {
    num: numeracion.tabla,
    title,
    head,
    rows,
    note,
    cls,
  };
}
const fig = (title, svg, legendHtml = '', wide = false) => ({ title, svg, legend: legendHtml, wide });
const chk = (s, t) => ({ s, t });
// código R de GT2 de Hochberg y Gabriel: módulo máximo estudentizado integrado con la densidad de sqrt(χ²/gl)
const gtCode = meth =>
  `print(tapply(dd$y, dd$g, mean), digits = 7)  # medias de los grupos\n# ${meth === 'gt2' ? 'GT2 de Hochberg' : 'Gabriel'}: módulo máximo estudentizado con m = k(k − 1)/2 comparaciones\nlocal({ m <- tapply(dd$y, dd$g, mean); n <- tapply(dd$y, dd$g, length); k <- length(m); gl <- nrow(dd) - k; mce <- sum(tapply(dd$y, dd$g, function(v) sum((v - mean(v))^2))) / gl; M <- k * (k - 1) / 2\n  dS <- function(s) exp(log(2) + (gl / 2) * log(gl / 2) - lgamma(gl / 2) + (gl - 1) * log(s) - gl * s^2 / 2)\n  psmm <- function(c) integrate(function(s) (2 * pnorm(c * s) - 1)^M * dS(s), 0, Inf, rel.tol = 1e-12, subdivisions = 2000L)$value; res <- NULL\n  for (a in 1:(k - 1)) for (b in (a + 1):k) { est <- abs(m[a] - m[b]) / ${meth === 'gt2' ? 'sqrt(mce * (1 / n[a] + 1 / n[b]))' : '(sqrt(mce) * (1 / sqrt(2 * n[a]) + 1 / sqrt(2 * n[b])))'}\n    res <- rbind(res, data.frame(par = paste(names(m)[a], "-", names(m)[b]), estadistico = est, p = 1 - psmm(est))) }\n  print(res, digits = 7) })`;
// matriz de diseño: constante + predictores numéricos + variables ficticias (primera categoría = referencia)
function design(xNames, rowOk) {
  const pv_ = xNames.map(vByName);
  const idx = ST.rows
    .map((_, i) => i)
    .filter(i => rowOk(i) && pv_.every(v => (v.type === 'num' ? numOf(v)[i] !== null : v.raw[i] !== null)));
  const cols = [{ name: '(Constante)' }];
  pv_.forEach(v => {
    if (v.type === 'num') cols.push({ name: v.name, v });
    else {
      const lv = ordOf(
        v,
        idx.map(i => String(v.raw[i]))
      );
      lv.slice(1).forEach(l => cols.push({ name: `${v.name}: ${l} (ref. ${lv[0]})`, v, level: l }));
    }
  });
  const X = idx.map(i =>
    cols.map(c => (!c.v ? 1 : c.level === undefined ? numOf(c.v)[i] : String(c.v.raw[i]) === c.level ? 1 : 0))
  );
  return { idx, cols, X };
}
// variable cuantitativa o de 2 categorías codificada 0/1 (0 = primera categoría)
function numOrBin(v) {
  if (v.type === 'num') return { vals: numOf(v), bin: false };
  const lv = levelsOf(v);
  if (lv.length !== 2) return null;
  return { vals: catOf(v).map(x => (x === null ? null : x === lv[1] ? 1 : 0)), bin: true, lv };
}
function rCode01(v, info) {
  return info.bin
    ? `as.numeric(datos[[${rq(v)}]] == ${rq(info.lv[1])})  # 0 = ${info.lv[0]}, 1 = ${info.lv[1]}`
    : `datos[[${rq(v)}]]`;
}
// Selección de predictores con contrastes F parciales (cada variable categórica entra o sale como un bloque).
// Criterios por defecto de SPSS y JASP: entrada p < .05 y salida p > .10. Todos los pasos usan los mismos casos.
function stepSelect(X, y, cols, terms, method, PIN = 0.05, POUT = 0.1) {
  const colsOf = t => cols.map((c, j) => (j > 0 && c.v.name === t ? j : -1)).filter(j => j >= 0);
  const n = y.length,
    dfT = t => colsOf(t).length;
  const fitT = ts => {
    const js = [0].concat(...ts.map(colsOf));
    const m = S.olsCore(
      X.map(r => js.map(j => r[j])),
      y
    );
    return m && { sse: m.sse, r2: m.r2, p: js.length };
  };
  const partial = (small, big, t) => {
    const a = fitT(small),
      b = fitT(big);
    if (!a || !b || n - b.p <= 0) return null;
    const F = (a.sse - b.sse) / dfT(t) / (b.sse / (n - b.p));
    return { F, df: [dfT(t), n - b.p], p: S.pF(F, dfT(t), n - b.p) };
  };
  let cur = method === 'backward' ? terms.slice() : [],
    prevR2 = cur.length ? fitT(cur).r2 : 0;
  const steps = [],
    seen = new Set([cur.slice().sort().join('|')]);
  const log = (accion, t, test) => {
    const r2 = cur.length ? fitT(cur).r2 : 0;
    steps.push({ accion, t, r2, dr2: r2 - prevR2, ...test });
    prevR2 = r2;
  };
  for (let it = 0; it < 4 * terms.length + 4; it++) {
    let moved = false;
    if (method !== 'backward') {
      const best = terms
        .filter(t => !cur.includes(t))
        .map(t => ({ t, r: partial(cur, cur.concat([t]), t) }))
        .filter(o => o.r)
        .sort((a, b) => a.r.p - b.r.p)[0];
      if (best && best.r.p < PIN && !seen.has(cur.concat([best.t]).sort().join('|'))) {
        cur = cur.concat([best.t]);
        log('entra', best.t, best.r);
        seen.add(cur.slice().sort().join('|'));
        moved = true;
      }
    }
    if (method !== 'forward' && cur.length) {
      const worst = cur
        .map(t => ({
          t,
          r: partial(
            cur.filter(u => u !== t),
            cur,
            t
          ),
        }))
        .filter(o => o.r)
        .sort((a, b) => b.r.p - a.r.p)[0];
      if (worst && worst.r.p > POUT) {
        cur = cur.filter(t => t !== worst.t);
        log('sale', worst.t, worst.r);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { selected: cur, steps };
}

export { nuevaSeccion, apaTable, tablaHTML, fig, chk, gtCode, design, numOrBin, rCode01, stepSelect };
