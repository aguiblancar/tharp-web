/* Tharp · aplicación · Exportación del script de R que reproduce cada número */
import { tfCode } from '../datos/preparacion.js';
import { byType, levelsOf } from '../datos/variables.js';
import { ST } from '../estado.js';
import { rn, rq } from '../formato.js';
import { citeTharp } from '../resultados/ejecutar.js';
import { download, track } from '../utilidades.js';

// los tamaños del efecto de effectsize se imprimen con 2 decimales por defecto: se piden 4 para poder comprobar los de Tharp
// Las funciones de impresión de R redondean (summary a 4 cifras, psych y effectsize a 2 decimales…): para que cada número
// de Tharp se pueda comprobar en la salida, las llamadas sueltas a esas funciones se imprimen con más cifras.
const R_DIG = [
  [/^(effectsize::|parameters::)/, 4],
  [/^psych::cortest\.bartlett\(/, 7],
  [/^(psych::)/, 4],
  [/^car::Anova\(/, 7, 'con_mc'],
  [/^(summary|anova)\(/, 7],
];
// las secciones que fijan la codificación de efectos (SC tipo III) la restauran al terminar, para no alterar las siguientes
const rContr = code => {
  const O = 'options(contrasts = c("contr.sum", "contr.poly"))';
  return code.includes(O)
    ? code.replace(O, `op <- ${O}  # codificación de efectos (SC tipo III) en esta sección`) +
        '\noptions(op)  # se restaura la codificación por defecto para el resto del script'
    : code;
};
const rOut = code =>
  rContr(code || '')
    .split('\n')
    .map(line => {
      const k = line.search(/\s+#/),
        call = (k >= 0 ? line.slice(0, k) : line).trim(),
        cm = k >= 0 ? line.slice(k) : '';
      const rule = R_DIG.find(([re]) => re.test(call));
      if (!rule || !call.endsWith(')') || /^\w[\w.]*\s*<-/.test(call) || /fit\.measures/.test(call)) return line; // lavaan imprime su propio resumen
      let depth = 0,
        ok = true;
      for (let i = 0; i < call.length; i++) {
        const c = call[i];
        if (c === '"') {
          i = call.indexOf('"', i + 1);
          if (i < 0) {
            ok = false;
            break;
          }
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0 && i < call.length - 1) {
            ok = false;
            break;
          }
        }
      } // una sola llamada, sin «;»
      return ok && depth === 0 ? `print(${rule[2] ? `${rule[2]}(${call})` : call}, digits = ${rule[1]})${cm}` : line;
    })
    .join('\n');
function exportR() {
  const isCsv = /\.(csv|tsv|txt)$/i.test(ST.fileName),
    isJasp = /\.jasp$/i.test(ST.fileName),
    isSav = /\.z?sav$/i.test(ST.fileName),
    cats = byType('cat');
  let s = `# ===============================================================\n# Script generado por Tharp ${citeTharp().version} (tharp.es) — ${new Date().toLocaleDateString('es-ES')}\n# Reproduce los análisis realizados sobre «${ST.fileName}»\n# Paquetes: psych, car, effectsize, rstatix, FSA, rcompanion, lmtest, sandwich, parameters\n#\n# Cómo citarlo (APA 7):\n#   ${citeTharp().refText}\n#   Cita también R y los paquetes que uses: citation() y citation("paquete") dan sus referencias.\n# ===============================================================\n\n`;
  const NA = 'c("", "NA", "N/A", "n/a", "NaN", "null", "NULL", ".", "-", "#N/A", "NS/NC", "ns/nc", "NSNC")';
  const csv = ST.csv || { sep: ';', dec: ',', enc: 'UTF-8-BOM' };
  s += isJasp
    ? `# R no lee archivos .jasp: en JASP usa Archivo → Exportar → Exportar datos (CSV) y guárdalo junto a este script.\ndatos <- read.csv(${rq(ST.fileName.replace(/\.jasp$/i, '.csv'))}, na.strings = ${NA}, check.names = FALSE, strip.white = TRUE)\n`
    : isSav
      ? `datos <- haven::read_sav(${rq(ST.fileName)})  # los valores perdidos definidos en SPSS se leen como NA\n`
      : isCsv
        ? `datos <- read.csv(${rq(ST.fileName)}, sep = ${rq(csv.sep)}, dec = ${rq(csv.dec)}, fileEncoding = ${rq(csv.enc)}, na.strings = ${NA}, check.names = FALSE, strip.white = TRUE)\n`
        : `datos <- readxl::read_excel(${rq(ST.fileName)}${ST.sheet ? ', sheet = ' + rq(ST.sheet) : ''}${ST.skipPhys ? `, skip = ${ST.skipPhys}` : ''}, na = ${NA})${ST.skipPhys ? '  # se salta las filas de título encima de la cabecera' : ''}\ndatos <- as.data.frame(datos)\n`;
  if (!isSav && ST.rawHeaders && ST.rawHeaders.some((h, i) => h !== ST.headers[i]))
    s += `# Nombres de columna como en Tharp (repetidos, vacíos o con espacios sobrantes)\nif (ncol(datos) == ${ST.headers.length}) names(datos) <- c(${ST.headers.map(rq).join(', ')})\n`;
  const th = Object.entries(ST.thousands || {});
  if (th.length)
    s += `# Columnas con separador de miles (como las lee Tharp)\n${th.map(([h, k]) => `datos[[${rq(h)}]] <- as.numeric(${k === 'es' ? `sub(",", ".", gsub(".", "", datos[[${rq(h)}]], fixed = TRUE), fixed = TRUE)` : `gsub(",", "", datos[[${rq(h)}]], fixed = TRUE)`})`).join('\n')}\n`;
  if (ST.tf && ST.tf.length)
    s += `\n# Preparación de los datos (las mismas transformaciones que en Tharp, en el mismo orden)\n${ST.tf.map(t => tfCode(t, isSav)).join('\n')}\n`;
  // niveles en el mismo orden que Tharp: así coinciden las categorías de referencia y el suceso de la logística
  const fac = v => {
    const x = `datos$${rn(v.name)}`,
      src = isSav ? (v.labelled ? `as.character(haven::as_factor(${x}))` : `haven::zap_labels(${x})`) : x;
    return `${x} <- factor(${src}, levels = c(${levelsOf(v).map(rq).join(', ')}))`;
  };
  if (cats.length)
    s += `\n# Variables categóricas como factor (mismo orden de categorías que en Tharp)\n${cats.map(fac).join('\n')}\n`;
  if (isSav) s += `datos <- as.data.frame(haven::zap_labels(datos))\n`;
  s +=
    '\n# Más cifras en la salida, para poder comprobar cada número de Tharp\noptions(digits = 7, pillar.sigfig = 7)\nif (requireNamespace("emmeans", quietly = TRUE)) emmeans::emm_options(opt.digits = FALSE)\n# Tablas de car::Anova con la media cuadrática (MC = SC / gl), como en Tharp\ncon_mc <- function(a) { if (!"Sum Sq" %in% names(a)) return(a); a <- as.data.frame(a); a$MC <- a[["Sum Sq"]] / a$Df; a }\n# Descriptivos como en Tharp: n, media, DT, mediana, IC 95 % de la media (t), mínimo y máximo\ndescr <- function(x) { x <- x[!is.na(x)]; n <- length(x); m <- mean(x); s <- sd(x); h <- qt(.975, n - 1) * s / sqrt(n)\n  c(n = n, M = m, DT = s, Mdn = median(x), IC_inf = m - h, IC_sup = m + h, Min = min(x), Max = max(x)) }\n';
  s +=
    '\n' +
    ST.sections
      .filter(x => !x.error)
      .map(x => rOut(x.code))
      .join('\n\n') +
    '\n';
  download('tharp_analisis.R', new Blob([s], { type: 'text/plain' }));
  track('descarga_r');
}

export { R_DIG, rContr, rOut, exportR };
