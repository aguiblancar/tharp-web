/* Tharp · aplicación · Utilidades de la interfaz: selectores, estadísticas de uso, descargas */

// mínimo y máximo sin «Math.min(...a)», que desborda la pila con decenas de miles de valores; mismo resultado (NaN si hay NaN; ±Infinity si está vacío)
const minOf = a => {
  let m = Infinity;
  for (const v of a) {
    if (v !== v) return NaN;
    if (v < m) m = v;
  }
  return m;
};
const maxOf = a => {
  let m = -Infinity;
  for (const v of a) {
    if (v !== v) return NaN;
    if (v > m) m = v;
  }
  return m;
};
const $ = s => document.querySelector(s),
  $$ = s => [...document.querySelectorAll(s)];
// estadísticas de uso anónimas (Umami, sin cookies): solo tipos de archivo y de análisis, nunca datos ni nombres de variables
const track = (ev, data) => {
  try {
    if (window.umami) window.umami.track(ev, data);
  } catch (e) {
    /* nunca debe afectar al análisis */
  }
};
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
const slug = s =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
    .slice(0, 50);

export { minOf, maxOf, $, $$, track, download, slug };
