/* Tharp · aplicación · punto de entrada: conecta la interfaz con cada paso y arranca la aplicación */
import { loadFile, setData } from './datos/lectura.js';
import { tfForm } from './datos/preparacion.js';
import { ST } from './estado.js';
import { exportR } from './exportar/r.js';
import { exportDocx } from './exportar/word.js';
import { DEMO_DEFAULTS, demoData, show } from './navegacion.js';
import { calcularPotencia, pwUI, showPow } from './potencia.js';
import { run } from './resultados/ejecutar.js';
import { $, $$, download, track } from './utilidades.js';

/** Navegación entre pasos y calculadora de potencia (app.html#potencia) */
function conectarNavegacion() {
  $$('[data-go]').forEach(b => (b.onclick = () => show(+b.dataset.go)));
  $('#powOpen').onclick = () => {
    showPow(true);
    history.replaceState(null, '', '#potencia');
  };
  $('#powClose').onclick = () => {
    showPow(false);
    history.replaceState(null, '', location.pathname);
  };
  ['pwTest', 'pwMode'].forEach(id => ($('#' + id).onchange = pwUI));
  if (location.hash === '#potencia') showPow(true);
  window.addEventListener('hashchange', () => showPow(location.hash === '#potencia'));
  $('#pwRun').onclick = calcularPotencia;
  $('#tfType').onchange = tfForm;
}

/** Paso 1: elegir o soltar un archivo, datos de ejemplo y su descarga en CSV */
function conectarDatos() {
  const drop = $('#drop'),
    file = $('#file');
  drop.onclick = () => file.click();
  drop.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      file.click();
    }
  };
  file.onchange = () => {
    if (file.files[0]) loadFile(file.files[0]);
    file.value = '';
  };
  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.remove('over');
    })
  );
  drop.addEventListener('drop', e => {
    const f0 = e.dataTransfer.files[0];
    if (f0) loadFile(f0);
  });
  $('#demo').onclick = () => {
    ST.wb = null;
    ST.sheet = '';
    setData('tharp_datos_ejemplo.csv', demoData(), DEMO_DEFAULTS);
  };
  $('#dlDemo').onclick = e => {
    e.preventDefault();
    const csv = demoData()
      .map(r => r.map(v => (v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v)).join(';'))
      .join('\r\n');
    download('tharp_datos_ejemplo.csv', new Blob(['\uFEFF' + csv], { type: 'text/csv' }));
  };
}

/** Pasos 3 y 4: calcular y descargar Word y script R */
function conectarResultados() {
  // «Calculando…» mientras dura el cálculo (con archivos grandes puede tardar varios segundos y la página no responde):
  // se cambia el botón y se espera un instante para que el navegador lo pinte antes de bloquearse; evita además el doble clic
  $('#run').onclick = () => {
    const btn = $('#run');
    if (btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Calculando…';
    btn.setAttribute('aria-busy', 'true');
    document.body.style.cursor = 'progress';
    setTimeout(() => {
      try {
        run();
      } finally {
        btn.disabled = false;
        btn.textContent = label;
        btn.removeAttribute('aria-busy');
        document.body.style.cursor = '';
      }
    }, 40);
  };
  $('#dlWord').onclick = exportDocx;
  $('#dlR').onclick = exportR;
}

/** app.html#importar: el archivo que se eligió en la portada, guardado en IndexedDB de este navegador (nunca sale del equipo) */
function importarDesdePortada() {
  try {
    const rq = indexedDB.open('tharp', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('traspaso');
    rq.onsuccess = () => {
      const st = rq.result.transaction('traspaso', 'readwrite').objectStore('traspaso'),
        g = st.get('archivo');
      g.onsuccess = () => {
        const f = g.result;
        st.delete('archivo');
        if (f) {
          loadFile(f);
          track('archivo_portada');
        }
      };
    };
  } catch (e) {
    /* sin IndexedDB: la persona elige el archivo en la app */
  }
}

/** Enlaces de la portada: #ejemplo (datos de ejemplo con un análisis completo) e #importar */
function abrirDesdePortada() {
  if (location.hash === '#ejemplo') {
    history.replaceState(null, '', location.pathname);
    $('#demo').click();
    show(3);
    $('#run').click();
    track('ejemplo_portada');
  }
  if (location.hash === '#importar') {
    history.replaceState(null, '', location.pathname);
    importarDesdePortada();
  }
}

conectarNavegacion();
conectarDatos();
conectarResultados();
window.TharpState = ST; // solo lectura: lo usan las pruebas automáticas
show(1);
abrirDesdePortada();
// la interfaz ya está conectada (las pruebas automáticas esperan esta marca antes de interactuar)
document.documentElement.dataset.appLista = 'true';
