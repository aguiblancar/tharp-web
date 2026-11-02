/* Tharp · aplicación · Lectura de archivos: Excel, CSV, SPSS y JASP */
import { esc } from '../graficos.js';
import { renderTf } from './preparacion.js';
import { detect, renderVars } from './variables.js';
import { ST } from '../estado.js';
import { show } from '../navegacion.js';
import { $, maxOf, track } from '../utilidades.js';
import { CONTACTO, ErrorDeUsuario, errorInesperado, mostrarError } from '../avisos.js';
import { read as readJasp } from './jasp.js';
import { read as readSav } from './sav.js';

const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', '.', '-', '#n/a', 'ns/nc', 'nsnc', '#¡valor!', '#value!']);
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (v instanceof Date)
    return isNaN(v)
      ? null
      : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`; // fecha local (toISOString daría el día anterior al este de UTC)
  const s = String(v).trim();
  return MISSING.has(s.toLowerCase()) ? null : s;
}
function toNum(v) {
  if (v === null) return null;
  if (typeof v === 'number') return v;
  let s = v.replace(/\s/g, '');
  if (/^-?\d*,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return s !== '' && isFinite(n) ? n : null;
}
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const cnt = ch => first.split(ch).length - 1,
    delim = [';', ',', '\t'].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows = [];
  let row = [],
    cell = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // decimal: coma si el separador es «;» o si hay números con coma decimal en un archivo tabulado
  rows.delim = delim;
  rows.dec = delim === ';' || (delim === '\t' && /(^|\t)-?\d+,\d+(\t|$)/m.test(text)) ? ',' : '.';
  return rows;
}
// Excel en Windows guarda los CSV en Windows-1252: si el texto no es UTF-8 válido, se relee con esa codificación
async function readText(file) {
  const buf = await file.arrayBuffer();
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'UTF-8-BOM' };
  } catch (e) {
    return { text: new TextDecoder('windows-1252').decode(buf), enc: 'latin1' };
  }
}
async function loadFile(file) {
  // aviso mientras se lee (los archivos grandes tardan) y una pausa breve para que el navegador lo muestre antes de bloquearse
  $('#loadErr').innerHTML = `<p class="muted small" style="text-align:center">Leyendo ${esc(file.name)}…</p>`;
  await new Promise(r => setTimeout(r, 30));
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    if (['csv', 'tsv', 'txt'].includes(ext)) {
      ST.wb = null;
      ST.sheet = '';
      const { text, enc } = await readText(file),
        rows = parseCSV(text);
      ST.csv = { sep: rows.delim, dec: rows.dec, enc };
      setData(file.name, rows);
    } else if (['xlsx', 'xls', 'ods', 'xlsm'].includes(ext)) {
      if (!window.XLSX)
        throw new ErrorDeUsuario('No se pudo cargar el lector de Excel. Recarga la página e inténtalo de nuevo.');
      ST.wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const name =
        ST.wb.SheetNames.find(
          n => XLSX.utils.sheet_to_json(ST.wb.Sheets[n], { header: 1, blankrows: false }).length > 1
        ) || ST.wb.SheetNames[0];
      loadSheet(file.name, name);
    } else if (ext === 'jasp') {
      $('#loadErr').innerHTML = '<p class="muted small" style="text-align:center">Leyendo el archivo de JASP…</p>';
      ST.wb = null;
      ST.sheet = '';
      const r = await readJasp(await file.arrayBuffer());
      ST.source = r.version;
      ST.sourceApp = 'JASP';
      ST.sourceNotes = [];
      setData(file.name, r.aoa, null, r.hints);
      $('#loadErr').innerHTML = '';
    } else if (ext === 'sav' || ext === 'zsav') {
      ST.wb = null;
      ST.sheet = '';
      const r = await readSav(await file.arrayBuffer());
      ST.source = r.version;
      ST.sourceApp = r.app;
      ST.sourceNotes = r.notes;
      setData(file.name, r.aoa, null, r.hints);
    } else throw new ErrorDeUsuario('Formato no admitido. Usa un archivo .xlsx, .xls, .csv, .sav (SPSS) o .jasp.');
    if (/Leyendo /.test($('#loadErr').textContent)) $('#loadErr').innerHTML = '';
  } catch (e) {
    if (e instanceof ErrorDeUsuario) mostrarError('#loadErr', e.message);
    else {
      errorInesperado(e, 'No se pudo leer el archivo');
      mostrarError('#loadErr', `No se pudo leer el archivo por un error inesperado de Tharp. ${CONTACTO}`);
    }
  }
}
function loadSheet(fileName, sheet) {
  ST.sheet = sheet;
  const ws = ST.wb.Sheets[sheet],
    aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  // filas físicas (con las vacías) para que el script R se salte las mismas filas de título que Tharp
  ST.xlsRows = XLSX.utils
    .sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true })
    .map(r => JSON.stringify(r.map(norm)));
  setData(fileName, aoa);
}
function setData(fileName, aoa, defaults, hints) {
  if (!/\.(xlsx|xls|ods|xlsm)$/i.test(fileName)) ST.xlsRows = null;
  if (!hints) ST.source = '';
  if (!aoa || aoa.length < 2)
    throw new ErrorDeUsuario(
      'El archivo no contiene datos: necesita una fila de nombres y al menos una fila de datos.'
    );
  // Excel con un título (u otras filas con una sola celda) encima de la cabecera: la cabecera es la primera fila con al menos la mitad de las columnas
  const isXls = /\.(xlsx|xls|ods|xlsm)$/i.test(fileName),
    filled = r => r.filter(v => v !== null && v !== undefined && String(v).trim() !== '').length;
  ST.skip = 0;
  ST.skipPhys = 0;
  if (isXls) {
    const w0 = maxOf(aoa.map(r => r.length)),
      k = aoa.slice(0, 10).findIndex(r => filled(r) >= Math.max(2, Math.ceil(w0 / 2)));
    if (k > 0 && aoa.slice(0, k).every(r => filled(r) <= 1)) {
      const head = JSON.stringify(aoa[k].map(norm));
      ST.skip = k;
      ST.skipPhys = Math.max(0, (ST.xlsRows || []).indexOf(head));
      aoa = aoa.slice(k);
    }
  }
  const width = maxOf(aoa.map(r => r.length)),
    seen = {};
  const headers = Array.from({ length: width }, (_, i) => {
    let h =
      aoa[0][i] === null || aoa[0][i] === undefined || String(aoa[0][i]).trim() === ''
        ? 'var_' + (i + 1)
        : String(aoa[0][i]).trim();
    if (seen[h]) h = h + '_' + ++seen[h];
    else seen[h] = 1;
    return h;
  });
  const rows = aoa
    .slice(1)
    .map(r => headers.map((_, i) => norm(r[i])))
    .filter(r => r.some(v => v !== null));
  if (!rows.length) throw new ErrorDeUsuario('No se han encontrado filas con datos.');
  // CSV con separador de miles (7.626,54 o 1.234.567; en inglés 7,626.54): si una columna lo usa de forma inequívoca, se lee entera así
  ST.thousands = {};
  if (/\.(csv|tsv|txt)$/i.test(fileName)) {
    const TH = {
      es: [/^-?\d{1,3}(\.\d{3})+,\d+$/, /^-?\d{1,3}(\.\d{3}){2,}$/],
      en: [/^-?\d{1,3}(,\d{3})+\.\d+$/, /^-?\d{1,3}(,\d{3}){2,}$/],
    };
    headers.forEach((h, c) => {
      const vals = rows
        .map(r => r[c])
        .filter(v => typeof v === 'string')
        .map(v => v.replace(/\s/g, ''));
      const kind = ['es', 'en'].find(k => vals.some(v => TH[k].some(re => re.test(v))));
      if (!kind) return;
      const conv = x => {
        const t = kind === 'es' ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
        return /^-?\d*\.?\d+$/.test(t) ? Number(t) : null;
      };
      if (vals.filter(v => conv(v) !== null).length < 0.95 * vals.length) return;
      rows.forEach(r => {
        if (typeof r[c] === 'string') {
          const n = conv(r[c].replace(/\s/g, ''));
          if (n !== null) r[c] = n;
        }
      });
      ST.thousands[h] = kind;
    });
  }
  Object.assign(ST, {
    fileName,
    headers,
    rawHeaders: Array.from({ length: width }, (_, i) =>
      aoa[0][i] === null || aoa[0][i] === undefined ? '' : String(aoa[0][i])
    ),
    rows,
    defaults: defaults || null,
    ordOpen: null,
  });
  ST.vars = headers
    .map((name, i) =>
      detect(
        name,
        i,
        rows.map(r => r[i]),
        hints && hints[String(aoa[0][i])]
      )
    )
    .filter(v => !(v.valid === 0 && /^var_\d+$/.test(v.name)));
  ST.base = { headers: headers.slice(), rows: rows.map(r => r.slice()), vars: ST.vars.map(v => v.name) };
  ST.tf = [];
  renderTf();
  renderVars();
  show(2);
  track('datos_cargados', {
    formato:
      fileName === 'tharp_datos_ejemplo.csv' && defaults ? 'ejemplo' : (fileName.split('.').pop() || '').toLowerCase(),
  });
}

export { MISSING, norm, toNum, parseCSV, readText, loadFile, loadSheet, setData };
