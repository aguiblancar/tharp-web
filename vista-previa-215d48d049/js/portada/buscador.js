// Buscador de pruebas de la portada («¿Qué prueba uso?»): presenta el árbol de buscador-arbol.js
import { PREGUNTAS, siguiente, pasos, recomendacion } from './buscador-arbol.js';

const box = document.getElementById('finderBox');
const state = {};
const history = [];

function esc(s) {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

/** Pantalla de una pregunta con sus opciones */
function preguntaHTML(key, done) {
  const q = PREGUNTAS[key];
  const opciones = q.o
    .map(
      o =>
        '<button class="opt" data-k="' +
        key +
        '" data-v="' +
        o[0] +
        '"><b>' +
        o[1] +
        '</b>' +
        (o[2] ? '<small>' + o[2] + '</small>' : '') +
        '</button>'
    )
    .join('');
  return (
    '<div class="q"><h3>' +
    q.t +
    '</h3>' +
    (q.h ? '<p class="hint">' + q.h + '</p>' : '<p class="hint"></p>') +
    '<div class="opts">' +
    opciones +
    '</div></div>' +
    '<div class="finder-foot">' +
    (done ? '<button class="link" id="back">Atrás</button>' : '<span></span>') +
    '<span style="color:var(--soft);font-size:.9rem">Paso ' +
    (done + 1) +
    '</span></div>'
  );
}

/** Llamada a la acción: analizar en Tharp o pedir el análisis si aún no está */
function accionHTML(r) {
  if (!r.inApp)
    return (
      '<div class="upsell"><div><strong>Este análisis todavía no está en Tharp</strong><br><span style="color:var(--soft)">Estamos trabajando en ello. Mientras tanto, puedes hacerlo en R con el código de arriba, o en JASP o SPSS.</span></div><a class="btn btn-line" href="mailto:info@tharp.es?subject=Quiero%20este%20an%C3%A1lisis%20en%20Tharp&body=' +
      encodeURIComponent('Me gustaría poder hacer en Tharp: ' + r.name) +
      '">Pedir este análisis</a></div>'
    );
  return (
    '<div class="upsell"><div><strong>' +
    (r.auto ? 'Tharp hace esta comparación con tus datos' : 'Tharp hace este análisis con tus datos') +
    '</strong><br><span style="color:var(--soft)">' +
    (r.auto
      ? 'Ten en cuenta que Tharp elige entre la prueba paramétrica y esta alternativa no paramétrica según se cumplan o no los supuestos, no según el nivel de medida.'
      : 'Comprueba los supuestos, aplica la alternativa si hace falta y redacta los resultados.') +
    ' Tus datos no salen de tu navegador.</span></div><a class="btn btn-dark" href="app.html">Analizar mis datos</a></div>'
  );
}

/** Pantalla de la recomendación final */
function resultadoHTML(r) {
  const lista = xs => '<ul>' + xs.map(w => '<li>' + w + '</li>').join('') + '</ul>';
  return (
    '<div class="result"><h3>' +
    r.name +
    '</h3>' +
    '<h4>Por qué</h4>' +
    lista(r.why) +
    '<h4>Supuestos que debes comprobar</h4>' +
    lista(r.assum) +
    '<h4>Alternativa</h4><div class="alt">' +
    r.alt +
    '</div>' +
    '<h4>Código R</h4><pre>' +
    esc(r.code) +
    '</pre>' +
    (r.warn ? '<div class="warn">⚠️ ' + r.warn + '</div>' : '') +
    '<p style="color:var(--soft);font-size:.88rem;margin-top:18px">Es una orientación general según tu diseño. La decisión final depende de tu pregunta de investigación y de tus datos.</p>' +
    accionHTML(r) +
    '<div class="finder-foot"><button class="link" id="back">Atrás</button><button class="link" id="restart">Empezar de nuevo</button></div></div>'
  );
}

function registrar(r) {
  try {
    window.umami && window.umami.track('buscador_resultado', { prueba: r.name });
  } catch (e) {
    /* estadística opcional */
  }
}

/** Conecta las opciones y los botones «Atrás» y «Empezar de nuevo» */
function conectar() {
  box.querySelectorAll('.opt').forEach(b =>
    b.addEventListener('click', () => {
      state[b.dataset.k] = b.dataset.v;
      history.push(b.dataset.k);
      render();
    })
  );
  const back = document.getElementById('back');
  if (back)
    back.addEventListener('click', () => {
      delete state[history.pop()];
      render();
    });
  const rs = document.getElementById('restart');
  if (rs)
    rs.addEventListener('click', () => {
      Object.keys(state).forEach(k => delete state[k]);
      history.length = 0;
      render();
    });
}

function render() {
  const key = siguiente(state);
  const done = history.length;
  const pct = key ? Math.round((done / pasos(state)) * 100) : 100;
  let html = '<div class="progress"><i style="width:' + pct + '%"></i></div>';
  if (key) html += preguntaHTML(key, done);
  else {
    const r = recomendacion(state);
    registrar(r);
    html += resultadoHTML(r);
  }
  box.innerHTML = html;
  conectar();
}

render();
