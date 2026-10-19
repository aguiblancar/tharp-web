/* Tharp · aplicación · Paso 4: ejecución de los análisis, registro de decisiones y presentación de resultados */
import { esc } from '../graficos.js';
import { numeracion, ST } from '../estado.js';
import { isOn } from '../configuracion.js';
import { ANALISIS } from '../analisis/registro.js';
import { byType, levelsOf } from '../datos/variables.js';
import { rOut } from '../exportar/r.js';
import { svgToPng } from '../exportar/word.js';
import { list } from '../formato.js';
import { show } from '../navegacion.js';
import { $, $$, track } from '../utilidades.js';
import { tablaHTML } from './piezas.js';
import TharpVersion from '../../comun/version.js';

function run() {
  numeracion.tabla = 0;
  numeracion.figura = 0;
  const secs = [],
    log = [];
  const ign = ST.vars.filter(v => v.type === 'ign').map(v => v.name),
    changed = ST.vars.filter(v => v.type !== v.auto);
  log.push(
    `Archivo «${esc(ST.fileName)}»: ${ST.rows.length} participantes y ${ST.vars.length} variables (${byType('num').length} cuantitativas, ${byType('cat').length} categóricas).`
  );
  if (ST.source)
    log.push(
      `Archivo de ${esc(ST.source)}: se han respetado los tipos de medida (escala, ordinal, nominal) y las etiquetas de valor definidos en ${ST.sourceApp}.`,
      ...ST.sourceNotes.map(esc)
    );
  if (ign.length) log.push(`Variables excluidas del análisis: ${list(ign.map(esc))}.`);
  if (changed.length)
    log.push(
      `Tipos de variable modificados por ti: ${list(changed.map(v => `${esc(v.name)} → ${{ num: 'cuantitativa', cat: 'categórica', ign: 'ignorada' }[v.type]}`))}.`
    );
  if (ST.tf && ST.tf.length)
    log.push(
      `Preparación de los datos: ${ST.tf.map(t => t.desc + (t.type === 'filter' ? ` (quedan ${t.kept} casos)` : '')).join('; ')}.`
    );
  const ordU = ST.vars.filter(v => v.type === 'cat' && v.orderUser);
  if (ordU.length)
    log.push(
      `Orden de categorías elegido por ti: ${ordU.map(v => `${esc(v.name)} (${list(levelsOf(v).map(esc))})`).join('; ')}.`
    );
  const nn = ST.vars.filter(v => v.type === 'num' && v.nonNum);
  if (nn.length)
    log.push(`Valores no numéricos tratados como perdidos en ${list(nn.map(v => `${esc(v.name)} (${v.nonNum})`))}.`);
  log.push(
    'Valores perdidos: cada análisis usa los casos con datos completos en sus variables (las correlaciones, por parejas).'
  );
  const add = s => {
    secs.push(s);
    if (s.decision) log.push(`<b>${esc(s.title)}:</b> ${s.decision}`);
    else if (s.error) log.push(`<b>${esc(s.title)}:</b> no se pudo realizar. ${esc(s.error)}`);
  };
  try {
    for (const a of ANALISIS) if (isOn(a.id) && (!a.activo || a.activo())) a.ejecutar(add);
  } catch (e) {
    console.error(e);
    alert('Ha ocurrido un error inesperado en el análisis: ' + e.message);
    return;
  }
  if (!secs.length) {
    alert('Selecciona al menos un análisis.');
    return;
  }
  ST.sections = secs;
  ST.log = log;
  renderResults();
  show(4);
  track('analisis_ejecutados', {
    n: secs.length,
    pruebas: secs
      .filter(x => !x.error)
      .map(x => x.test || '')
      .join(' | ')
      .slice(0, 480),
  });
}
// cita de Tharp (APA 7, software): frase para el método y referencia; sin datos ni nombres de variables
function citeTharp() {
  const V = TharpVersion || {
      version: '',
      year: new Date().getFullYear(),
      url: 'https://tharp.es',
      doi: '',
      autor: 'Agüí Ruiz, B.',
      autorCorto: 'Agüí Ruiz',
    },
    link = V.doi ? `https://doi.org/${V.doi}` : V.url;
  return {
    version: V.version,
    method: `Los análisis estadísticos se realizaron con Tharp (versión ${V.version}; ${V.autorCorto}, ${V.year}).`,
    refHtml: `${V.autor} (${V.year}). <i>Tharp</i> (Versión ${V.version}) [Software]. ${link}`,
    refText: `${V.autor} (${V.year}). Tharp (Versión ${V.version}) [Software]. ${link}`,
  };
}
function citeBox() {
  const c = citeTharp();
  return `<div class="res cite"><h2>Cómo citar Tharp</h2>
    <p class="small muted">Las normas APA (7.ª ed.) piden mencionar en el método el software con el que se hicieron los análisis y citarlo en las referencias, como se hace con SPSS, JASP o R.</p>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px"><b>En el apartado de análisis de datos</b><button class="btn btn-line btn-sm" data-cite="citeM">Copiar</button></div>
    <p id="citeM">${c.method}</p>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px"><b>En la lista de referencias</b><button class="btn btn-line btn-sm" data-cite="citeR">Copiar</button></div>
    <p id="citeR" style="padding-left:2em;text-indent:-2em">${c.refHtml}</p>
    <p class="small muted">Si usas el script de R para reproducir los análisis, cita también R y los paquetes empleados: <code>citation()</code> y <code>citation("nombre_del_paquete")</code> en R dan la referencia de cada uno.</p></div>`;
}
function renderResults() {
  $('#log').innerHTML = ST.log.map(l => `<li>${l}</li>`).join('');
  $('#results').innerHTML =
    ST.sections
      .map((s, si) => {
        if (s.error)
          return `<div class="res"><h2>${esc(s.title)}</h2><div class="warnbox">⚠️ ${esc(s.error)}</div></div>`;
        const charts = s.charts
          .map((c, ci) => {
            numeracion.figura++;
            return `<figure${c.wide ? ' class="wide"' : ''}><figcaption><span>Figura ${numeracion.figura}. ${esc(c.title)}</span><button data-png="${si}-${ci}">PNG</button></figcaption>${c.legend}${c.svg}</figure>`;
          })
          .join('');
        return `<div class="res" data-sec="${si}">
      <h2>${esc(s.title)}</h2><span class="test">${esc(s.test || '')}</span>
      <p class="decision">${s.decision || ''}</p>
      ${s.warn ? `<div class="warnbox">⚠️ ${s.warn}</div>` : ''}
      ${s.tables.map(tablaHTML).join('')}
      ${charts ? `<div class="charts${s.charts.length === 1 ? ' one' : ''}">${charts}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px"><b>Redacción de resultados (APA)</b><button class="btn btn-line btn-sm" data-copy="${si}">Copiar texto</button></div>
      <div class="text" id="txt${si}">${s.text.map(t => `<p>${t}</p>`).join('')}</div>
      ${s.sens ? `<p class="small muted">${s.sens}</p>` : ''}
      <details open><summary>¿Por qué este análisis?</summary><ul class="why">${s.why.map(w => `<li>${w}</li>`).join('')}</ul>${s.alt ? `<p class="small" style="margin:10px 0 0"><b>Alternativa:</b> ${s.alt}</p>` : ''}</details>
      ${s.checks.length ? `<details open><summary>Supuestos comprobados</summary><ul class="checks">${s.checks.map(c => `<li class="${c.s}">${c.t}</li>`).join('')}</ul></details>` : ''}
      <details><summary>Código R para reproducirlo</summary><pre>${esc(rOut(s.code))}</pre></details>
    </div>`;
      })
      .join('') + (ST.sections.length ? citeBox() : '');
  $$('[data-cite]').forEach(
    b =>
      (b.onclick = () => {
        const el = $('#' + b.dataset.cite);
        navigator.clipboard.writeText(el.innerText).then(() => {
          b.textContent = 'Copiado ✓';
          setTimeout(() => (b.textContent = 'Copiar'), 1500);
        });
        track('copiar_cita');
      })
  );
  $$('[data-copy]').forEach(
    b =>
      (b.onclick = () => {
        const t = $('#txt' + b.dataset.copy).innerText;
        navigator.clipboard.writeText(t).then(() => {
          b.textContent = 'Copiado ✓';
          setTimeout(() => (b.textContent = 'Copiar texto'), 1500);
        });
      })
  );
  $$('[data-png]').forEach(
    b =>
      (b.onclick = () => {
        const [si, ci] = b.dataset.png.split('-').map(Number),
          c = ST.sections[si].charts[ci];
        svgToPng(c.svg, c.title);
        track('descarga_png');
      })
  );
}

export { run, citeTharp, citeBox, renderResults };
