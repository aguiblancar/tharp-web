/* Tharp — aplicación (todo se ejecuta en el navegador) */
(function () {
  'use strict';
  const S = window.TharpStats, CH = window.TharpCharts, esc = CH.esc;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const ST = { fileName: '', wb: null, sheet: '', headers: [], rows: [], vars: [], sections: [], log: [], defaults: null };

  // ---------- formato ----------
  const f = (x, d = 2) => (x === null || x === undefined || !isFinite(x) ? '—' : x.toFixed(d));
  const nz = s => s.replace(/^(-?)0\./, '$1.');                    // sin cero inicial (p, r, β)
  const pv = p => (p < .001 ? '< .001' : nz(p.toFixed(3)));        // p en tablas
  const pt = p => '<i>p</i> ' + (p < .001 ? '< .001' : '= ' + nz(p.toFixed(3))); // p en texto
  const r2s = r => nz(r.toFixed(2));
  const dfF = d => (Math.abs(d - Math.round(d)) < 1e-9 ? String(Math.round(d)) : d.toFixed(2));
  const stars = p => (p < .001 ? '***' : p < .01 ? '**' : p < .05 ? '*' : '');
  // intervalo con extremos infinitos (hipótesis unilaterales) y valor de referencia sin ceros sobrantes
  const ciTxt = c => `[${isFinite(c[0]) ? f(c[0]) : '−∞'}, ${isFinite(c[1]) ? f(c[1]) : '∞'}]`;
  const fmtNum = v => String(Math.round(v * 1e6) / 1e6);
  const J_inv = p => window.jStat.normal.inv(p, 0, 1), f_ = (x, d = 2) => f(x, d);
  const lbl = { d: v => { v = Math.abs(v); return v < .2 ? 'trivial' : v < .5 ? 'pequeño' : v < .8 ? 'mediano' : 'grande'; },
    eta: v => (v < .01 ? 'trivial' : v < .06 ? 'pequeño' : v < .14 ? 'mediano' : 'grande'),
    r: v => { v = Math.abs(v); return v < .1 ? 'trivial' : v < .3 ? 'pequeño' : v < .5 ? 'mediano' : 'grande'; },
    corr: v => { v = Math.abs(v); return v < .1 ? 'muy débil' : v < .3 ? 'débil' : v < .5 ? 'moderada' : 'fuerte'; } };
  const rn = n => (/^[A-Za-z.][A-Za-z0-9._]*$/.test(n) ? n : '`' + n.replace(/`/g, '\\`') + '`');
  const rq = n => JSON.stringify(n);
  const cmp = (a, b) => { const na = Number(a), nb = Number(b); return (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }); };
  const list = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]);

  // estadísticas de uso anónimas (Umami, sin cookies): solo tipos de archivo y de análisis, nunca datos ni nombres de variables
  const track = (ev, data) => { try { if (window.umami) window.umami.track(ev, data); } catch (e) { /* nunca debe afectar al análisis */ } };

  // ---------- lectura de datos ----------
  const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', '.', '-', '#n/a', 'ns/nc', 'nsnc', '#¡valor!', '#value!']);
  function norm(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim(); return MISSING.has(s.toLowerCase()) ? null : s;
  }
  function toNum(v) {
    if (v === null) return null; if (typeof v === 'number') return v;
    let s = v.replace(/\s/g, ''); if (/^-?\d*,\d+$/.test(s)) s = s.replace(',', '.');
    const n = Number(s); return s !== '' && isFinite(n) ? n : null;
  }
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const cnt = ch => first.split(ch).length - 1, delim = [';', ',', '\t'].sort((a, b) => cnt(b) - cnt(a))[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    // decimal: coma si el separador es «;» o si hay números con coma decimal en un archivo tabulado
    rows.delim = delim; rows.dec = delim === ';' || (delim === '\t' && /(^|\t)-?\d+,\d+(\t|$)/m.test(text)) ? ',' : '.';
    return rows;
  }
  // Excel en Windows guarda los CSV en Windows-1252: si el texto no es UTF-8 válido, se relee con esa codificación
  async function readText(file) {
    const buf = await file.arrayBuffer();
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'UTF-8-BOM' }; }
    catch (e) { return { text: new TextDecoder('windows-1252').decode(buf), enc: 'latin1' }; }
  }
  async function loadFile(file) {
    $('#loadErr').innerHTML = '';
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      if (['csv', 'tsv', 'txt'].includes(ext)) {
        ST.wb = null; ST.sheet = ''; const { text, enc } = await readText(file), rows = parseCSV(text);
        ST.csv = { sep: rows.delim, dec: rows.dec, enc }; setData(file.name, rows);
      }
      else if (['xlsx', 'xls', 'ods', 'xlsm'].includes(ext)) {
        if (!window.XLSX) throw new Error('No se pudo cargar el lector de Excel. Recarga la página e inténtalo de nuevo.');
        ST.wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const name = ST.wb.SheetNames.find(n => (XLSX.utils.sheet_to_json(ST.wb.Sheets[n], { header: 1, blankrows: false }).length > 1)) || ST.wb.SheetNames[0];
        loadSheet(file.name, name);
      } else if (ext === 'jasp') {
        $('#loadErr').innerHTML = '<p class="muted small" style="text-align:center">Leyendo el archivo de JASP…</p>';
        ST.wb = null; ST.sheet = '';
        const r = await window.TharpJasp.read(await file.arrayBuffer());
        ST.source = r.version; ST.sourceApp = 'JASP'; ST.sourceNotes = []; setData(file.name, r.aoa, null, r.hints); $('#loadErr').innerHTML = '';
      } else if (ext === 'sav' || ext === 'zsav') {
        ST.wb = null; ST.sheet = '';
        const r = await window.TharpSav.read(await file.arrayBuffer());
        ST.source = r.version; ST.sourceApp = r.app; ST.sourceNotes = r.notes; setData(file.name, r.aoa, null, r.hints);
      } else throw new Error('Formato no admitido. Usa un archivo .xlsx, .xls, .csv, .sav (SPSS) o .jasp.');
    } catch (e) { $('#loadErr').innerHTML = `<div class="err">${esc(e.message || e)}</div>`; }
  }
  function loadSheet(fileName, sheet) {
    ST.sheet = sheet;
    setData(fileName, XLSX.utils.sheet_to_json(ST.wb.Sheets[sheet], { header: 1, raw: true, defval: null, blankrows: false }));
  }
  function setData(fileName, aoa, defaults, hints) {
    if (!hints) ST.source = '';
    if (!aoa || aoa.length < 2) throw new Error('El archivo no contiene datos: necesita una fila de nombres y al menos una fila de datos.');
    const width = Math.max(...aoa.map(r => r.length)), seen = {};
    const headers = Array.from({ length: width }, (_, i) => {
      let h = aoa[0][i] === null || aoa[0][i] === undefined || String(aoa[0][i]).trim() === '' ? 'var_' + (i + 1) : String(aoa[0][i]).trim();
      if (seen[h]) h = h + '_' + (++seen[h]); else seen[h] = 1; return h;
    });
    const rows = aoa.slice(1).map(r => headers.map((_, i) => norm(r[i]))).filter(r => r.some(v => v !== null));
    if (!rows.length) throw new Error('No se han encontrado filas con datos.');
    Object.assign(ST, { fileName, headers, rows, defaults: defaults || null, ordOpen: null });
    ST.vars = headers.map((name, i) => detect(name, i, rows.map(r => r[i]), hints && hints[String(aoa[0][i])])).filter(v => !(v.valid === 0 && /^var_\d+$/.test(v.name)));
    ST.base = { headers: headers.slice(), rows: rows.map(r => r.slice()), vars: ST.vars.map(v => v.name) }; ST.tf = []; renderTf();
    renderVars(); show(2);
    track('datos_cargados', { formato: fileName === 'tharp_datos_ejemplo.csv' && defaults ? 'ejemplo' : (fileName.split('.').pop() || '').toLowerCase() });
  }

  // escalas ordinales habituales (español e inglés); se usa la primera en la que encajan todas las categorías presentes
  const ORD_SCALES = [
    ['nunca', 'casi nunca', 'rara vez', 'pocas veces', 'a veces', 'algunas veces', 'a menudo', 'frecuentemente', 'muchas veces', 'bastantes veces', 'casi siempre', 'siempre'],
    ['totalmente en desacuerdo', 'muy en desacuerdo', 'en desacuerdo', 'algo en desacuerdo', 'ni de acuerdo ni en desacuerdo', 'neutral', 'indiferente', 'algo de acuerdo', 'de acuerdo', 'muy de acuerdo', 'totalmente de acuerdo'],
    ['nada', 'muy poco', 'poco', 'algo', 'regular', 'bastante', 'mucho', 'muchisimo'],
    ['muy bajo', 'muy baja', 'bajo', 'baja', 'medio bajo', 'media baja', 'medio', 'media', 'medio alto', 'media alta', 'alto', 'alta', 'muy alto', 'muy alta'],
    ['inferior', 'bajo', 'baja', 'medio', 'media', 'superior', 'alto', 'alta'],
    ['ninguno', 'ninguna', 'leve', 'ligero', 'ligera', 'moderado', 'moderada', 'grave', 'severo', 'severa', 'muy grave', 'extremo', 'extrema'],
    ['muy malo', 'muy mala', 'malo', 'mala', 'regular', 'normal', 'aceptable', 'bueno', 'buena', 'muy bueno', 'muy buena', 'excelente'],
    ['muy insatisfecho', 'muy insatisfecha', 'insatisfecho', 'insatisfecha', 'neutral', 'satisfecho', 'satisfecha', 'muy satisfecho', 'muy satisfecha'],
    ['sin estudios', 'primaria', 'estudios primarios', 'eso', 'secundaria', 'estudios secundarios', 'secundaria o fp medio', 'bachillerato', 'fp', 'fp medio', 'fp grado medio', 'fp superior', 'fp grado superior', 'fp superior o universitarios', 'universitarios', 'universitaria', 'grado', 'master', 'máster', 'doctorado'],
    ['pre', 'pretest', 'antes', 'post', 'postest', 'despues', 'seguimiento'],
    ['never', 'rarely', 'sometimes', 'often', 'always'],
    ['strongly disagree', 'disagree', 'neutral', 'agree', 'strongly agree'],
    ['none', 'mild', 'moderate', 'severe'],
    ['low', 'medium', 'high'],
  ];
  const normTxt = t => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  function knownOrder(levels) {
    if (levels.length < 2 || levels.length > 12) return null;
    const nl = levels.map(normTxt);
    for (const sc of ORD_SCALES) { const sn = sc.map(normTxt); if (nl.every(l => sn.includes(l))) return levels.slice().sort((a, b) => sn.indexOf(normTxt(a)) - sn.indexOf(normTxt(b))); }
    return null;
  }

  // ---------- detección de variables ----------
  function detect(name, i, raw, hint) {
    const valid = raw.filter(v => v !== null), v = { name, i, raw, hint, valid: valid.length, missing: raw.length - valid.length, note: [] };
    const nums = valid.map(toNum), okN = nums.filter(x => x !== null), uniq = new Set(valid.map(String)).size;
    v.nonNum = valid.length - okN.length;
    const isId = /^(id|n|n[ºo°]|num|numero|número|código|codigo|code|participante|sujeto|caso|case)$|(^id[_ ]|[_ ]id$)/i.test(name);
    if (!valid.length) { v.type = 'ign'; v.note.push('Vacía'); }
    else if (okN.length / valid.length >= .95) {
      const ints = okN.every(Number.isInteger), u = new Set(okN).size;
      if (isId && u === okN.length) { v.type = 'ign'; v.note.push('Identificador'); }
      else if (ints && u <= 3) { v.type = 'cat'; v.note.push('Códigos numéricos con ' + u + ' valores: tratada como categórica'); }
      else { v.type = 'num'; if (ints && u <= 7) v.note.push('Pocos valores: ¿escala ordinal (Likert)?'); }
      if (v.nonNum) v.note.push(v.nonNum + ' valores no numéricos se tratarán como perdidos');
    } else {
      if (uniq === valid.length && valid.length > 10) { v.type = 'ign'; v.note.push(isId ? 'Identificador' : 'Texto con valores únicos'); }
      else if (uniq > 30) { v.type = 'ign'; v.note.push('Texto libre (' + uniq + ' valores distintos)'); }
      else v.type = 'cat';
    }
    if (hint && valid.length) {
      const uniqAll = new Set(valid.map(String)).size;
      if (hint.type === 'cat' && isId && uniqAll === valid.length) { v.type = 'ign'; v.note = ['Identificador']; }
      else { v.type = hint.type === 'num' && okN.length / valid.length < .95 ? 'cat' : hint.type; v.note = [hint.note].concat(v.nonNum && v.type === 'num' ? [v.nonNum + ' valores no numéricos se tratarán como perdidos'] : []); }
    }
    v.labelled = !!(hint && hint.labels); v.auto = v.type;
    // orden de las categorías: el de las etiquetas del archivo de origen o el de una escala ordinal reconocida
    const present = [...new Set(valid.map(String))];
    if (hint && hint.order) v.order = hint.order.map(String).filter(l => present.includes(l));
    else { const o = knownOrder(present); if (o) { v.order = o; v.orderNote = 'Orden de escala ordinal reconocido'; } }
    return v;
  }
  const numOf = v => v._num || (v._num = v.raw.map(toNum));
  const catOf = v => v.raw.map(x => (x === null ? null : String(x)));
  // orden de las categorías: el de la variable (etiquetas de SPSS/JASP, escala ordinal reconocida o el que elija la persona);
  // si no hay, numérico o alfabético. ordOf limita el orden a los valores presentes en un subconjunto de casos
  const ordOf = (v, present) => { const pr = [...new Set(present.filter(x => x !== null && x !== undefined).map(String))];
    if (!v || !v.order) return pr.sort(cmp); return v.order.filter(l => pr.includes(l)).concat(pr.filter(l => !v.order.includes(l)).sort(cmp)); };
  const levelsOf = v => ordOf(v, catOf(v));
  const byType = t => ST.vars.filter(v => v.type === t);
  const vByName = n => ST.vars.find(v => v.name === n);

  function renderVars() {
    const n = ST.rows.length, k = ST.vars.length;
    $('#detTitle').textContent = `Hemos detectado ${k} variables y ${n} participantes.`;
    const nNum = byType('num').length, nCat = byType('cat').length, nIgn = byType('ign').length, nMiss = ST.vars.filter(v => v.type !== 'ign' && v.missing).length;
    $('#detSummary').innerHTML = `<span><b>${nNum}</b>cuantitativas</span><span><b>${nCat}</b>categóricas</span>` +
      (nIgn ? `<span><b>${nIgn}</b>ignoradas</span>` : '') + (nMiss ? `<span><b>${nMiss}</b>con valores perdidos</span>` : '') +
      `<span class="muted">${esc(ST.fileName)}${ST.sheet ? ' · hoja «' + esc(ST.sheet) + '»' : ''}${ST.source ? ' · ' + esc(ST.source) + ' (tipos y etiquetas importados)' : ''}</span>`;
    $('#sheetSel').innerHTML = ST.wb && ST.wb.SheetNames.length > 1 ? `<label class="field"><span>Hoja</span><select id="sheet">${ST.wb.SheetNames.map(s => `<option${s === ST.sheet ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : '';
    if ($('#sheet')) $('#sheet').onchange = e => { try { loadSheet(ST.fileName, e.target.value); } catch (er) { alert(er.message); } };
    let h = '<thead><tr><th>Variable</th><th>Tipo</th><th>Válidos</th><th>Perdidos</th><th>Resumen</th><th>Notas</th></tr></thead><tbody>';
    ST.vars.forEach((v, idx) => {
      let sum = '';
      if (v.type === 'num') { const x = numOf(v).filter(a => a !== null); if (x.length) { const d = S.describe(x); sum = `<i>M</i> = ${f(d.mean)} · <i>DT</i> = ${f(d.sd)} · rango ${+d.min.toFixed(3)}–${+d.max.toFixed(3)}`; } }
      else if (v.type === 'cat') { const lv = levelsOf(v), c = catOf(v); sum = `${lv.length} categorías: ` + lv.slice(0, 4).map(l => `${esc(l)} (${c.filter(x => x === l).length})`).join(', ') + (lv.length > 4 ? '…' : '');
        if (lv.length >= 2 && lv.length <= 30) sum += ` <button class="btn btn-line btn-sm" data-ord="${idx}" style="padding:2px 10px;margin-left:6px">Orden</button>`;
        if (ST.ordOpen === idx) sum += `<div class="ordEd" style="margin-top:8px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#fff"><div class="muted small" style="margin-bottom:6px">Orden de las categorías (la primera es la de referencia en las regresiones; importa en tablas, gráficos, kappa ponderada y tendencias):</div>` +
          lv.map((l, q) => `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><button class="btn btn-line btn-sm" data-up="${q}" ${q === 0 ? 'disabled' : ''} style="padding:0 8px">↑</button><button class="btn btn-line btn-sm" data-dn="${q}" ${q === lv.length - 1 ? 'disabled' : ''} style="padding:0 8px">↓</button><span>${q + 1}. ${esc(l)}</span></div>`).join('') +
          `<button class="btn btn-line btn-sm" data-ordclose="1" style="margin-top:6px">Hecho</button></div>`; }
      h += `<tr><td><b>${esc(v.name)}</b></td><td><select data-v="${idx}"><option value="num"${v.type === 'num' ? ' selected' : ''}>Cuantitativa</option><option value="cat"${v.type === 'cat' ? ' selected' : ''}>Categórica</option><option value="ign"${v.type === 'ign' ? ' selected' : ''}>Ignorar</option></select></td>
        <td>${v.valid}</td><td>${v.missing ? `<span class="pill warn">${v.missing}</span>` : '0'}</td><td class="small">${sum}</td><td>${v.note.map(t => `<span class="pill">${esc(t)}</span>`).join('')}${v.type === 'cat' && v.orderUser ? '<span class="pill">Orden elegido por ti</span>' : v.type === 'cat' && v.orderNote ? `<span class="pill">${esc(v.orderNote)}</span>` : ''}${v.type !== v.auto ? '<span class="pill">Cambiado por ti</span>' : ''}</td></tr>`;
    });
    $('#varTable').innerHTML = h + '</tbody>';
    $$('#varTable select').forEach(s => s.onchange = () => { ST.vars[+s.dataset.v].type = s.value; renderVars(); });
    $$('#varTable [data-ord]').forEach(b => b.onclick = () => { ST.ordOpen = ST.ordOpen === +b.dataset.ord ? null : +b.dataset.ord; renderVars(); });
    $$('#varTable [data-ordclose]').forEach(b => b.onclick = () => { ST.ordOpen = null; renderVars(); });
    const move = (q, d) => { const v = ST.vars[ST.ordOpen], lv = levelsOf(v); [lv[q], lv[q + d]] = [lv[q + d], lv[q]]; v.order = lv; v.orderUser = true; renderVars(); };
    $$('#varTable [data-up]').forEach(b => b.onclick = () => move(+b.dataset.up, -1));
    $$('#varTable [data-dn]').forEach(b => b.onclick = () => move(+b.dataset.dn, 1));
  }

  // ---------- preparación de datos: transformaciones reproducibles ----------
  // cada transformación crea una variable nueva (o filtra casos); se guardan en ST.tf y se pueden deshacer reconstruyendo desde ST.base
  const TF_NAMES = { scale: 'Puntuación de escala', reverse: 'Ítem invertido', recode: 'Recodificación', cut: 'Grupos', diff: 'Diferencia', z: 'Puntuación z', filter: 'Filtro de casos' };
  const uniqueName = base => { let n = base.replace(/\s+/g, '_') || 'nueva', k = 2; while (ST.headers.includes(n)) n = `${base}_${k++}`; return n; };
  const colOf = name => { const v = vByName(name); return v ? v.raw : ST.rows.map(r => r[ST.headers.indexOf(name)]); };
  function addVar(name, values, hint) {
    const i = ST.headers.length; ST.headers.push(name); ST.rows.forEach((r, q) => r.push(values[q] === undefined ? null : values[q]));
    const v = detect(name, i, values, hint); v.derived = true; ST.vars.push(v); return v;
  }
  function refreshVars() { // tras filtrar: recalcula cada variable con las filas actuales, conservando lo que haya cambiado la persona
    ST.vars = ST.vars.map(v => { const nv = detect(v.name, v.i, ST.rows.map(r => r[v.i]), v.hint);
      if (v.type !== v.auto) nv.type = v.type; if (v.orderUser) { nv.order = v.order; nv.orderUser = true; } nv.derived = v.derived; return nv; });
  }
  function applyTf(t) {
    const P = t.p;
    if (t.type === 'filter') {
      const v = vByName(P.v), ok = x => { if (x === null || x === undefined) return false;
        if (P.op === '=' || P.op === '≠') { const eq = String(x) === String(P.val) || (toNum(x) !== null && toNum(x) === toNum(P.val)); return P.op === '=' ? eq : !eq; }
        const a = toNum(x), b = toNum(P.val); if (a === null || b === null) return false;
        return P.op === '>' ? a > b : P.op === '≥' ? a >= b : P.op === '<' ? a < b : a <= b; };
      const before = ST.rows.length; ST.rows = ST.rows.filter(r => ok(r[v.i])); refreshVars(); t.kept = ST.rows.length; t.removed = before - ST.rows.length; return;
    }
    let vals, hint;
    if (t.type === 'scale') {
      const cols = P.items.map(n => numOf(vByName(n))), k = cols.length, maxMiss = P.maxMiss || 0;
      vals = ST.rows.map((_, q) => { const xs = cols.map((c, j) => (c[q] === null ? null : P.rev.includes(P.items[j]) ? P.min + P.max - c[q] : c[q])), ok = xs.filter(x => x !== null);
        if (k - ok.length > maxMiss || !ok.length) return null; const m = ok.reduce((a, b) => a + b, 0) / ok.length; return P.method === 'mean' ? m : m * k; });
      hint = { type: 'num', note: `${P.method === 'mean' ? 'Media' : 'Suma'} de ${k} ítems${P.rev.length ? `, ${P.rev.length} invertidos` : ''}` };
    } else if (t.type === 'reverse') { const c = numOf(vByName(P.v)); vals = c.map(x => (x === null ? null : P.min + P.max - x)); hint = { type: 'num', note: `${P.v} invertido (${P.min}–${P.max})` }; }
    else if (t.type === 'recode') { const c = catOf(vByName(P.v)); vals = c.map(x => (x === null ? null : (P.map[x] === undefined ? x : P.map[x] === '' ? null : P.map[x])));
      const order = []; levelsOf(vByName(P.v)).forEach(l => { const nl = P.map[l] === undefined ? l : P.map[l]; if (nl !== '' && !order.includes(nl)) order.push(nl); });
      hint = { type: 'cat', note: `Recodificación de ${P.v}`, order }; }
    else if (t.type === 'cut') { const c = numOf(vByName(P.v)), labs = P.labels;
      vals = c.map(x => { if (x === null) return null; let g = P.breaks.findIndex(b => x <= b); if (g < 0) g = P.breaks.length; return labs[g]; });
      hint = { type: 'cat', note: `Grupos de ${P.v}`, order: labs.slice() }; }
    else if (t.type === 'diff') { const a = numOf(vByName(P.a)), b = numOf(vByName(P.b)); vals = a.map((x, q) => (x === null || b[q] === null ? null : b[q] - x)); hint = { type: 'num', note: `${P.b} − ${P.a}` }; }
    else if (t.type === 'z') { const c = numOf(vByName(P.v)), ok = c.filter(x => x !== null), m = S.mean(ok), sd = S.sd(ok); vals = c.map(x => (x === null ? null : (x - m) / sd)); hint = { type: 'num', note: `Puntuación z de ${P.v}` }; }
    const v = addVar(t.name, vals, hint); t.created = v.name;
  }
  function rebuildTf() {
    const keep = new Set(ST.base.vars), baseVars = ST.vars.filter(v => keep.has(v.name));
    ST.headers = ST.base.headers.slice(); ST.rows = ST.base.rows.map(r => r.slice()); ST.vars = baseVars; refreshVars();
    ST.tf.forEach(applyTf);
  }
  // código R equivalente (se inserta tras leer los datos y antes de convertir las categóricas en factor)
  function tfCode(t, isSav) {
    const P = t.p, col = n => `datos[[${rq(n)}]]`, numC = n => (isSav ? `as.numeric(haven::zap_labels(${col(n)}))` : `as.numeric(${col(n)})`),
      chrC = n => { const v = vByName(n); return isSav && v && v.labelled ? `as.character(haven::as_factor(${col(n)}))` : `as.character(${col(n)})`; };
    if (t.type === 'scale') return `# ${TF_NAMES.scale}: ${t.name}\nX <- sapply(c(${P.items.map(rq).join(', ')}), function(v) ${isSav ? 'as.numeric(haven::zap_labels(datos[[v]]))' : 'as.numeric(datos[[v]])'})\n` +
      (P.rev.length ? `inv <- c(${P.rev.map(rq).join(', ')}); X[, inv] <- ${P.min + P.max} - X[, inv]  # ítems inversos (${P.min}–${P.max})\n` : '') +
      `${col(t.name)} <- ifelse(rowSums(is.na(X)) <= ${P.maxMiss || 0}, rowMeans(X, na.rm = TRUE)${P.method === 'mean' ? '' : ` * ${P.items.length}`}, NA)`;
    if (t.type === 'reverse') return `# ${TF_NAMES.reverse}: ${t.name}\n${col(t.name)} <- ${P.min + P.max} - ${numC(P.v)}`;
    if (t.type === 'recode') return `# ${TF_NAMES.recode}: ${t.name}\n${col(t.name)} <- unname(c(${Object.entries(P.map).map(([a, b]) => `${rq(a)} = ${b === '' ? 'NA' : rq(b)}`).join(', ')})[${chrC(P.v)}])`;
    if (t.type === 'cut') return `# ${TF_NAMES.cut}: ${t.name}\n${col(t.name)} <- as.character(cut(${numC(P.v)}, breaks = c(-Inf, ${P.breaks.map(b => +b.toFixed(10)).join(', ')}, Inf), labels = c(${P.labels.map(rq).join(', ')}), right = TRUE))`;
    if (t.type === 'diff') return `# ${TF_NAMES.diff}: ${t.name}\n${col(t.name)} <- ${numC(P.b)} - ${numC(P.a)}`;
    if (t.type === 'z') return `# ${TF_NAMES.z}: ${t.name}\n${col(t.name)} <- as.numeric(scale(${numC(P.v)}))`;
    if (t.type === 'filter') { const v = vByName(P.v), isNum = v && v.type === 'num' && toNum(P.val) !== null, op = { '=': '==', '≠': '!=', '≥': '>=', '≤': '<=' }[P.op] || P.op;
      return `# ${TF_NAMES.filter}: ${P.v} ${P.op} ${P.val}\ndatos <- datos[!is.na(${isNum ? numC(P.v) : chrC(P.v)}) & ${isNum ? numC(P.v) : chrC(P.v)} ${op} ${isNum ? +toNum(P.val) : rq(String(P.val))}, ]`; }
    return '';
  }
  function renderTf() {
    const list = $('#tfList'); if (!list) return;
    list.innerHTML = ST.tf && ST.tf.length ? `<div style="margin-top:12px"><b class="small">Transformaciones aplicadas</b><ol class="small" style="margin:6px 0">${ST.tf.map((t, q) =>
      `<li>${esc(t.desc)}${t.type === 'filter' ? ` — quedan ${t.kept} casos (${t.removed} excluidos)` : ''} <button class="btn btn-line btn-sm" data-tfdel="${q}" style="padding:0 8px;margin-left:6px">Deshacer</button></li>`).join('')}</ol></div>` : '';
    $$('#tfList [data-tfdel]').forEach(b => b.onclick = () => { ST.tf.splice(+b.dataset.tfdel, 1); rebuildTf(); renderTf(); renderVars(); });
  }
  function tfForm() {
    const type = $('#tfType').value, F = $('#tfForm'); $('#tfMsg').innerHTML = '';
    const nums = ST.vars.filter(v => v.type === 'num'), cats = ST.vars.filter(v => v.type === 'cat'), all = ST.vars.filter(v => v.type !== 'ign');
    const opt = vs => vs.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('');
    const inp = (id, ph, w = 160, val = '') => `<input id="${id}" placeholder="${ph}" value="${esc(val)}" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:${w}px">`;
    const btn = '<p style="margin:10px 0 0"><button class="btn btn-dark btn-sm" id="tfAdd">Aplicar</button></p>';
    if (!type) { F.innerHTML = ''; return; }
    if (type === 'scale') F.innerHTML = `<div class="field"><span>Ítems de la escala</span>${chips('tfI', nums, () => false)}</div><div class="field"><span>Ítems inversos (se invierten antes de sumar)</span>${chips('tfR', nums, () => false)}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., ansiedad_total')}</label><label class="field"><span>Cálculo</span><select id="tfM"><option value="sum">Suma</option><option value="mean">Media</option></select></label>
      <label class="field"><span>Mínimo y máximo de la escala de respuesta</span><span style="display:flex;gap:6px">${inp('tfMin', 'mín.', 70)}${inp('tfMax', 'máx.', 70)}</span></label>
      <label class="field"><span>Ítems sin responder permitidos</span>${inp('tfMiss', '0', 70, '0')}</label></div>
      <p class="small muted" style="margin:4px 0 0">Si permites ítems sin responder, la puntuación se calcula con la media de los respondidos (en la suma, prorrateada al número total de ítems). Si se supera el máximo, la puntuación queda como perdida.</p>${btn}`;
    else if (type === 'reverse') F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Ítem</span><select id="tfV">${opt(nums)}</select></label><label class="field"><span>Mínimo y máximo posibles</span><span style="display:flex;gap:6px">${inp('tfMin', 'mín.', 70)}${inp('tfMax', 'máx.', 70)}</span></label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., ae4_inv')}</label></div>${btn}`;
    else if (type === 'recode') { F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable</span><select id="tfV">${opt(cats.concat(nums.filter(v => new Set(v.raw.filter(x => x !== null).map(String)).size <= 15)))}</select></label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., estudios_3')}</label></div><div id="tfMap"></div>${btn}`;
      const fill = () => { const v = vByName($('#tfV').value), lv = v ? (v.type === 'cat' ? levelsOf(v) : [...new Set(v.raw.filter(x => x !== null).map(String))].sort(cmp)) : [];
        $('#tfMap').innerHTML = `<p class="small muted" style="margin:6px 0">Escribe la nueva categoría de cada valor. Pon el mismo nombre para agrupar; déjalo en blanco para tratarlo como perdido.</p>` + lv.map((l, q) => `<div style="display:flex;gap:8px;align-items:center;margin:3px 0"><span style="min-width:180px">${esc(l)} →</span><input data-map="${q}" data-from="${esc(l)}" value="${esc(l)}" style="font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:8px;width:200px"></div>`).join(''); };
      $('#tfV').onchange = fill; fill(); }
    else if (type === 'cut') F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable cuantitativa</span><select id="tfV">${opt(nums)}</select></label><label class="field"><span>Método</span><select id="tfCM"><option value="median">Por la mediana (2 grupos)</option><option value="q">Por percentiles (grupos de igual tamaño)</option><option value="cuts">Por puntos de corte que yo indique</option></select></label>
      <label class="field"><span>Grupos (percentiles) o cortes</span>${inp('tfCuts', 'p. ej., 3   o bien   10, 20')}</label><label class="field"><span>Etiquetas (opcional)</span>${inp('tfL', 'p. ej., Bajo, Medio, Alto', 200)}</label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., ansiedad_grupo')}</label></div>
      <p class="small muted" style="margin:4px 0 0">Con puntos de corte, cada valor va al primer grupo cuyo corte sea mayor o igual (por ejemplo, con 10 y 20: ≤ 10, de 10 a 20, > 20). Dicotomizar una variable cuantitativa hace perder información: úsalo solo si está justificado (por ejemplo, un punto de corte clínico).</p>${btn}`;
    else if (type === 'diff') F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Primera (A, por ejemplo pre)</span><select id="tfA">${opt(nums)}</select></label><label class="field"><span>Segunda (B, por ejemplo post)</span><select id="tfB">${opt(nums)}</select></label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., cambio')}</label></div><p class="small muted" style="margin:4px 0 0">Se calcula B − A.</p>${btn}`;
    else if (type === 'z') F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable</span><select id="tfV">${opt(nums)}</select></label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., estres_z')}</label></div>${btn}`;
    else if (type === 'filter') { F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end"><label class="field"><span>Variable</span><select id="tfV">${opt(all)}</select></label><label class="field"><span>Condición</span><select id="tfOp"><option>=</option><option>≠</option><option>></option><option>≥</option><option><</option><option>≤</option></select></label><label class="field"><span>Valor</span><span id="tfValW"></span></label></div><p class="small muted" style="margin:4px 0 0">Se analizarán solo los casos que cumplan la condición. Los casos sin dato en la variable se excluyen.</p>${btn}`;
      const fill = () => { const v = vByName($('#tfV').value); $('#tfValW').innerHTML = v && v.type === 'cat' ? `<select id="tfVal">${levelsOf(v).map(l => `<option>${esc(l)}</option>`).join('')}</select>` : inp('tfVal', 'valor', 110); };
      $('#tfV').onchange = fill; fill(); }
    // mínimo y máximo sugeridos a partir de los datos
    const sugg = () => { const ns = type === 'scale' ? checkedVals('tfI') : [$('#tfV') && $('#tfV').value]; const xs = ns.filter(Boolean).flatMap(n => numOf(vByName(n)).filter(x => x !== null));
      if (xs.length && $('#tfMin') && $('#tfMax')) { $('#tfMin').value = Math.min(...xs); $('#tfMax').value = Math.max(...xs); } };
    if (type === 'reverse') { $('#tfV').onchange = sugg; sugg(); }
    if (type === 'scale') $$('input[name="tfI"]').forEach(b => b.addEventListener('change', sugg));
    $('#tfAdd').onclick = addTf;
  }
  function addTf() {
    const type = $('#tfType').value, msg = m => { $('#tfMsg').innerHTML = `<div class="err">${m}</div>`; }, num = id => parseFloat(String(($('#' + id) || {}).value || '').replace(',', '.'));
    const nameIn = (($('#tfN') || {}).value || '').trim();
    let t;
    if (type === 'scale') { const items = checkedVals('tfI'), rev = checkedVals('tfR').filter(r => items.includes(r)), mn = num('tfMin'), mx = num('tfMax'), miss = Math.max(0, Math.round(num('tfMiss') || 0));
      if (items.length < 2) return msg('Selecciona al menos dos ítems.'); if (rev.length && !(isFinite(mn) && isFinite(mx) && mx > mn)) return msg('Indica el mínimo y el máximo de la escala de respuesta para invertir los ítems.');
      if (miss >= items.length) return msg('Los ítems sin responder permitidos deben ser menos que el número de ítems.');
      const method = $('#tfM').value; t = { type, name: uniqueName(nameIn || 'escala'), p: { items, rev, min: mn, max: mx, method, maxMiss: miss } };
      t.desc = `${t.name} = ${method === 'mean' ? 'media' : 'suma'} de ${list(items.map(esc))}${rev.length ? ` (invertidos: ${list(rev.map(esc))})` : ''}${miss ? `; se permiten ${miss} ítem${miss > 1 ? 's' : ''} sin responder` : ''}`; }
    else if (type === 'reverse') { const v = $('#tfV').value, mn = num('tfMin'), mx = num('tfMax'); if (!(isFinite(mn) && isFinite(mx) && mx > mn)) return msg('Indica el mínimo y el máximo posibles del ítem.');
      t = { type, name: uniqueName(nameIn || v + '_inv'), p: { v, min: mn, max: mx } }; t.desc = `${t.name} = ${esc(v)} invertido (${mn} + ${mx} − valor)`; }
    else if (type === 'recode') { const v = $('#tfV').value, map = {}; $$('#tfMap [data-map]').forEach(i => { map[i.dataset.from] = i.value.trim(); });
      if (new Set(Object.values(map).filter(Boolean)).size < 1) return msg('Indica al menos una categoría nueva.');
      t = { type, name: uniqueName(nameIn || v + '_rec'), p: { v, map } }; t.desc = `${t.name} = ${esc(v)} recodificada (${Object.entries(map).filter(([a, b]) => a !== b).map(([a, b]) => `${esc(a)} → ${b === '' ? 'perdido' : esc(b)}`).join('; ') || 'sin cambios'})`; }
    else if (type === 'cut') { const v = $('#tfV').value, m = $('#tfCM').value, x = numOf(vByName(v)).filter(q => q !== null).sort((a, b) => a - b); let breaks;
      if (m === 'median') breaks = [S.quantile(x, .5)];
      else if (m === 'q') { const k = Math.round(num('tfCuts')); if (!(k >= 2 && k <= 10)) return msg('Indica cuántos grupos quieres (entre 2 y 10).'); breaks = Array.from({ length: k - 1 }, (_, j) => S.quantile(x, (j + 1) / k)); }
      else { breaks = String($('#tfCuts').value).split(/[;\s]+|,\s+/).map(q => parseFloat(q.replace(',', '.'))).filter(isFinite).sort((a, b) => a - b); if (!breaks.length) return msg('Escribe uno o más puntos de corte, separados por espacios o «; ».'); }
      breaks = [...new Set(breaks)];
      const userL = String($('#tfL').value || '').split(',').map(q => q.trim()).filter(Boolean), G = breaks.length + 1;
      const fmt = b => String(+b.toFixed(4)), autoL = G === 2 ? [`≤ ${fmt(breaks[0])}`, `> ${fmt(breaks[0])}`] : breaks.map((b, j) => (j === 0 ? `≤ ${fmt(b)}` : `${fmt(breaks[j - 1])}–${fmt(b)}`)).concat([`> ${fmt(breaks[breaks.length - 1])}`]);
      if (userL.length && userL.length !== G) return msg(`Escribe ${G} etiquetas separadas por comas (o déjalo vacío).`);
      t = { type, name: uniqueName(nameIn || v + '_grupo'), p: { v, breaks, labels: userL.length ? userL : autoL } };
      t.desc = `${t.name} = grupos de ${esc(v)} (${m === 'median' ? 'por la mediana' : m === 'q' ? 'por percentiles' : 'por puntos de corte'}: ${t.p.labels.map(esc).join(', ')})`; }
    else if (type === 'diff') { const a = $('#tfA').value, b = $('#tfB').value; if (a === b) return msg('Elige dos variables distintas.'); t = { type, name: uniqueName(nameIn || `${b}_menos_${a}`), p: { a, b } }; t.desc = `${t.name} = ${esc(b)} − ${esc(a)}`; }
    else if (type === 'z') { const v = $('#tfV').value; t = { type, name: uniqueName(nameIn || v + '_z'), p: { v } }; t.desc = `${t.name} = puntuación z de ${esc(v)}`; }
    else if (type === 'filter') { const v = $('#tfV').value, op = $('#tfOp').value, val = String(($('#tfVal') || {}).value || '').trim(); if (!val) return msg('Indica el valor de la condición.');
      const vv = vByName(v); if (vv && vv.type === 'num' && op !== '=' && op !== '≠' && toNum(val) === null) return msg('Para comparar con >, ≥, < o ≤, el valor debe ser numérico.');
      t = { type, name: '', p: { v, op, val } }; t.desc = `Filtro: solo los casos con ${esc(v)} ${op} ${esc(val)}`; }
    if (!t) return;
    ST.tf.push(t); applyTf(t);
    if (type === 'filter' && !ST.rows.length) { ST.tf.pop(); rebuildTf(); return msg('Ningún caso cumple esa condición: no se ha aplicado el filtro.'); }
    renderTf(); renderVars(); $('#tfType').value = ''; tfForm();
    $('#tfMsg').innerHTML = `<p class="small" style="color:var(--ok);margin:8px 0 0">✓ ${type === 'filter' ? `Filtro aplicado: quedan ${t.kept} casos.` : `Creada la variable «${esc(t.created)}».`}</p>`;
  }

  // ---------- configuración de análisis ----------
  function chips(name, vars, checked) { return `<div class="chips">${vars.map(v => `<label><input type="checkbox" name="${name}" value="${esc(v.name)}"${checked(v) ? ' checked' : ''}>${esc(v.name)}</label>`).join('') || '<span class="muted small">No hay variables de este tipo.</span>'}</div>`; }
  function sel(id, vars, def) { return `<select id="${id}">${vars.map(v => `<option value="${esc(v.name)}"${v.name === def ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select>`; }
  function renderConfig() {
    const nums = byType('num'), cats = byType('cat'), facs = cats.filter(v => { const k = levelsOf(v).length; return k >= 2 && k <= 12; });
    const D = ST.defaults || {};
    const has = n => vByName(n) && vByName(n).type !== 'ign';
    const pick = (cands, fallback) => (cands && has(cands) ? cands : fallback);
    const card = (id, on, title, desc, cfg, disabled) => `<div class="an${on && !disabled ? ' on' : ''}" data-an="${id}"><label><input type="checkbox"${on && !disabled ? ' checked' : ''}${disabled ? ' disabled' : ''}><span><b>${title}</b><span class="muted small">${disabled ? disabled : desc}</span></span></label><div class="cfg">${cfg}</div></div>`;
    let h = '';
    h += card('desc', true, 'Estadísticos descriptivos y gráficos', 'Media, desviación típica, mediana, asimetría y frecuencias, con histogramas y gráficos de barras.',
      `<div class="field"><span>Variables</span>${chips('desc', nums.concat(cats), () => true)}</div>
       <label class="field"><span>Dividir por grupos (opcional)</span><select id="descG"><option value="">No</option>${facs.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label>`);
    h += card('corr', nums.length >= 2, 'Correlaciones', 'Matriz de correlaciones con significación. Tharp elige Pearson o Spearman según la distribución.',
      `<div class="field"><span>Variables cuantitativas</span>${chips('corr', nums, v => (D.corr ? D.corr.includes(v.name) : nums.indexOf(v) < 8))}</div>
       <label class="field"><span>Método</span><select id="corrM"><option value="auto">Automático (recomendado)</option><option value="pearson">Pearson</option><option value="spearman">Spearman</option><option value="kendall">Tau-b de Kendall</option></select></label>
       <div class="field"><span>Controlar por (opcional: correlación parcial)</span>${chips('corrZ', nums, () => false)}</div>`,
      nums.length < 2 ? 'Necesitas al menos dos variables cuantitativas.' : '');
    const dComp = D.comp || {};
    h += card('comp', nums.length >= 1 && facs.length >= 1, 'Comparación entre grupos', 'Prueba t, ANOVA o sus alternativas no paramétricas, con comprobación automática de supuestos y post hoc.',
      `<div class="field"><span>Variables dependientes (cuantitativas)</span>${chips('compY', nums, v => (dComp.y ? dComp.y.includes(v.name) : v === nums[0]))}</div>
       <label class="field"><span>Variable de agrupación</span>${sel('compG', facs, pick(dComp.g, facs[0] && facs[0].name))}</label>
       <label class="field"><span>Hipótesis (solo con 2 grupos)</span><select id="compAlt"><option value="two">Bilateral: los grupos difieren (recomendada)</option><option value="greater">Unilateral: el primer grupo puntúa más</option><option value="less">Unilateral: el primer grupo puntúa menos</option></select></label>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Comparaciones post hoc (3 o más grupos)</span><select id="compPH" onchange="document.getElementById('compCtrlW').style.display = this.value === 'dunnett' ? '' : 'none'"><option value="auto">Automáticas: Tukey o Games-Howell según las varianzas (recomendado)</option><option value="tukey">Tukey HSD</option><option value="gh">Games-Howell</option><option value="bonferroni">Bonferroni</option><option value="holm">Holm</option><option value="sidak">Šidák</option><option value="scheffe">Scheffé</option><option value="tamhane">T2 de Tamhane</option><option value="dunnett">Dunnett (frente a un grupo control)</option><option value="lsd">DMS de Fisher (sin corrección)</option></select></label>
       <label class="field" id="compCtrlW" style="display:none"><span>Grupo control</span><select id="compCtrl"></select></label>
       <label class="field"><span>Contrastes planificados (opcional)</span><select id="compCon"><option value="">Ninguno</option><option value="polynomial">Polinómicos: tendencia lineal, cuadrática…</option><option value="simple">Simples: cada grupo frente al primero</option><option value="repeated">Repetidos: cada grupo frente al siguiente</option><option value="helmert">Helmert: cada grupo frente a la media de los siguientes</option><option value="difference">Diferencia: cada grupo frente a la media de los anteriores</option><option value="deviation">Desviación: cada grupo frente a la media global</option></select></label></div>`,
      !(nums.length >= 1 && facs.length >= 1) ? 'Necesitas una variable cuantitativa y una categórica con 2 a 12 grupos.' : '');
    h += card('one', false, 'Comparación con un valor de referencia (una muestra)', '¿La media difiere de un valor fijo, como el punto medio de una escala o una norma publicada? Prueba t para una muestra o Wilcoxon, según la normalidad.',
      `<div class="field"><span>Variables (una prueba para cada una)</span>${chips('oY', nums, v => v === nums[0])}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Valor de referencia</span><input id="oMu" type="number" step="any" value="0" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:140px"></label>
       <label class="field"><span>Hipótesis</span><select id="oAlt"><option value="two">Bilateral: la media difiere (recomendada)</option><option value="greater">Unilateral: la media es mayor</option><option value="less">Unilateral: la media es menor</option></select></label></div>`,
      nums.length < 1 ? 'Necesitas una variable cuantitativa.' : '');
    const dP = D.paired || {};
    const pDef = (dP.vars || []).filter(has);
    h += card('paired', !!D.paired && nums.length >= 2, 'Comparación de medidas relacionadas (pre/post o varios momentos)', 'Las mismas personas medidas dos o más veces: t relacionada o Wilcoxon (2 momentos); ANOVA de medidas repetidas o Friedman (3 o más). Con un factor entre sujetos (por ejemplo, control frente a tratamiento): ANOVA mixta.',
      `<div class="field"><span>Momentos o condiciones (en el orden de las columnas del archivo)</span>${chips('pM', nums, v => (pDef.length ? pDef.includes(v.name) : nums.indexOf(v) < 2))}</div>
       <label class="field"><span>Hipótesis (solo con 2 medidas y sin factor entre sujetos)</span><select id="pAlt"><option value="two">Bilateral: las medidas difieren (recomendada)</option><option value="greater">Unilateral: la segunda medida es mayor</option><option value="less">Unilateral: la segunda medida es menor</option></select></label>
       <details style="margin:4px 0 10px"><summary class="small">Dos factores intrasujeto (opcional; por ejemplo, condición × momento)</summary>
         <p class="small muted" style="margin:6px 0">Marca arriba todas las columnas en este orden: el segundo factor cambia más rápido (A1·B1, A1·B2, …, A2·B1, A2·B2…), como en SPSS. El número de columnas debe ser niveles del factor 1 × niveles del factor 2.</p>
         <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor 1: nombre y niveles</span><span style="display:flex;gap:6px"><input id="pW1N" placeholder="p. ej., condición" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:150px"><input id="pW1K" type="number" min="2" placeholder="niveles" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:90px"></span></label>
         <label class="field"><span>Factor 2: nombre y niveles</span><span style="display:flex;gap:6px"><input id="pW2N" placeholder="p. ej., momento" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:150px"><input id="pW2K" type="number" min="2" placeholder="niveles" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:90px"></span></label></div></details>
       <label class="field"><span>Factor entre sujetos (opcional: ANOVA mixta)</span><select id="pB"><option value="">Ninguno</option>${facs.map(v => `<option value="${esc(v.name)}"${dP.between === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>`,
      nums.length < 2 ? 'Necesitas dos variables cuantitativas.' : '');
    const dC = D.chi || {};
    h += card('chi', facs.length >= 2, 'Asociación entre variables categóricas', 'Tabla de contingencia, chi-cuadrado (o Fisher) y V de Cramér.',
      `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable en filas</span>${sel('cA', facs, pick(dC.a, facs[0] && facs[0].name))}</label>
       <label class="field"><span>Variable en columnas</span>${sel('cB', facs, pick(dC.b, facs[1] && facs[1].name))}</label></div>
       <label class="field"><span>Estratificar por (opcional: Mantel-Haenszel, tablas 2×2)</span><select id="cS"><option value="">Ninguna</option>${facs.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label>`,
      facs.length < 2 ? 'Necesitas dos variables categóricas.' : '');
    h += card('prop', false, 'Proporciones: binomial y bondad de ajuste', '¿La proporción de una categoría difiere de un valor esperado (binomial exacta)? ¿Las frecuencias se ajustan a unas proporciones teóricas (χ² de bondad de ajuste)?',
      `<div class="field"><span>Variables categóricas (una prueba para cada una)</span>${chips('prV', cats, v => v === cats[0])}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Proporción esperada (2 categorías; de la segunda categoría)</span><input id="prP0" type="number" step="any" min="0" max="1" value="0.5" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:120px"></label>
       <label class="field"><span>Hipótesis (2 categorías)</span><select id="prAlt"><option value="two">Bilateral (recomendada)</option><option value="greater">Unilateral: mayor que la esperada</option><option value="less">Unilateral: menor que la esperada</option></select></label>
       <label class="field"><span>Proporciones esperadas (3 o más categorías, en su orden; vacío = iguales)</span><input id="prProbs" placeholder="p. ej., 0.5, 0.3, 0.2" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:240px"></label></div>`,
      !cats.length ? 'Necesitas una variable categórica.' : '');
    h += card('agree', false, 'Acuerdo entre jueces y fiabilidad test-retest (CCI y kappa)', 'Puntuaciones de varios evaluadores o de dos aplicaciones del mismo test: coeficiente de correlación intraclase (cuantitativas) o kappa de Cohen y de Fleiss (categóricas).',
      `<div class="field"><span>Jueces o aplicaciones (una columna por juez o momento; todas cuantitativas o todas categóricas)</span>${chips('agV', nums.concat(cats), () => false)}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>CCI que se interpreta</span><select id="agM"><option value="ICC2">Dos factores, aleatorios, acuerdo absoluto (recomendado: jueces o momentos representativos)</option><option value="ICC3">Dos factores, mixtos, consistencia (solo estos jueces; importa el orden, no el valor exacto)</option><option value="ICC1">Un factor, aleatorios (cada sujeto valorado por jueces distintos)</option></select></label>
       <label class="field"><span>Unidad</span><select id="agU"><option value="single">Medida única (la puntuación de un juez)</option><option value="average">Promedio de los jueces (si usarás la media)</option></select></label>
       <label class="field"><span>Kappa de Cohen (categorías ordenadas)</span><select id="agW"><option value="none">Sin ponderar (categorías nominales)</option><option value="linear">Ponderada lineal</option><option value="quadratic">Ponderada cuadrática</option></select></label></div>`,
      (nums.length + cats.length) < 2 ? 'Necesitas al menos dos variables.' : '');
    const bins2 = cats.filter(v => levelsOf(v).length === 2);
    h += card('roc', false, 'Curva ROC (capacidad diagnóstica de una puntuación)', '¿Distingue una puntuación (test, escala, biomarcador) entre dos grupos, por ejemplo con y sin diagnóstico? Área bajo la curva, punto de corte óptimo, sensibilidad, especificidad y valores predictivos.',
      `<div class="field"><span>Puntuaciones (una curva para cada una)</span>${chips('rocX', nums, () => false)}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Estado real (2 categorías)</span>${sel('rocY', bins2, bins2[0] && bins2[0].name)}</label>
       <label class="field"><span>Categoría «positiva» (por ejemplo, con diagnóstico)</span><select id="rocPos"></select></label></div>`,
      !bins2.length || !nums.length ? 'Necesitas una puntuación cuantitativa y una variable con exactamente 2 categorías.' : '');
    const dR = D.reg || {}, regY = pick(dR.y, nums[0] && nums[0].name);
    h += card('reg', !!D.reg && nums.length >= 1, 'Regresión lineal', 'Coeficientes, β estandarizados, R², y diagnóstico completo: normalidad, homocedasticidad, multicolinealidad e influencia.',
      `<label class="field"><span>Variable dependiente</span>${sel('rY', nums, regY)}</label>
       <label class="field"><span>Método de entrada de los predictores</span><select id="rM" onchange="document.querySelectorAll('.rblk').forEach(e => e.style.display = this.value === 'blocks' ? '' : 'none'); document.getElementById('rXlab').textContent = this.value === 'blocks' ? 'Bloque 1 (predictores del primer modelo)' : 'Predictores'">${[['enter', 'Introducir: todos a la vez (recomendado)'], ['blocks', 'Jerárquica por bloques (Δ R²)'], ['stepwise', 'Por pasos (entrada p < .05, salida p > .10)'], ['forward', 'Hacia delante (entrada p < .05)'], ['backward', 'Hacia atrás (salida p > .10)']].map(([k, l]) => `<option value="${k}"${(dR.method || 'enter') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
       <div class="field"><span id="rXlab">${dR.method === 'blocks' ? 'Bloque 1 (predictores del primer modelo)' : 'Predictores'}</span>${chips('rX', nums.concat(facs), v => (dR.x ? dR.x.includes(v.name) : false))}</div>
       ${[2, 3].map(b => `<div class="field rblk" style="display:${dR.method === 'blocks' ? '' : 'none'}"><span>Bloque ${b} (se añaden al modelo anterior${b === 3 ? '; opcional' : ''})</span>${chips('rB' + b, nums.concat(facs), v => ((dR['b' + b] || []).includes(v.name)))}</div>`).join('')}`,
      nums.length < 1 ? 'Necesitas una variable cuantitativa como dependiente.' : '');
    const bins = cats.filter(v => levelsOf(v).length === 2), dL = D.logit || {};
    h += card('logit', !!D.logit && bins.length >= 1, 'Regresión logística binaria', 'Para variables dependientes dicotómicas (sí/no): odds ratios, R² de Nagelkerke, Hosmer-Lemeshow y tabla de clasificación.',
      `<label class="field"><span>Variable dependiente (2 categorías)</span>${sel('lY', bins, pick(dL.y, bins[0] && bins[0].name))}</label>
       <div class="field"><span>Predictores</span>${chips('lX', nums.concat(facs), v => (dL.x ? dL.x.includes(v.name) : false))}</div>`,
      !bins.length ? 'Necesitas una variable categórica con exactamente 2 categorías.' : '');
    const poly = cats.filter(v => { const k = levelsOf(v).length; return k >= 3 && k <= 10; });
    h += card('mlogit', false, 'Regresión logística multinomial u ordinal', 'Variable dependiente con 3 o más categorías: multinomial si no tienen orden (por ejemplo, tipo de tratamiento elegido) u ordinal de odds proporcionales si lo tienen (por ejemplo, leve, moderado, grave).',
      `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable dependiente (3 o más categorías)</span>${sel('mlY', poly, poly[0] && poly[0].name)}</label>
       <label class="field"><span>Modelo</span><select id="mlM"><option value="auto">Automático: ordinal si las categorías tienen orden, si no multinomial</option><option value="multinomial">Multinomial</option><option value="ordinal">Ordinal (odds proporcionales)</option></select></label></div>
       <div class="field"><span>Predictores</span>${chips('mlX', nums.concat(facs), () => false)}</div>`,
      !poly.length ? 'Necesitas una variable categórica con entre 3 y 10 categorías.' : '');
    const f6 = facs.filter(v => levelsOf(v).length <= 6), dF = D.fact || {};
    h += card('manova', false, 'MANOVA (varias variables dependientes a la vez)', 'Compara grupos en un conjunto de variables dependientes relacionadas a la vez (por ejemplo, las subescalas de un cuestionario): Pillai, Wilks, Hotelling y Roy, M de Box y ANOVA de seguimiento. Con covariables, MANCOVA.',
      `<div class="field"><span>Variables dependientes (2 o más)</span>${chips('mvY', nums, () => false)}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor</span>${sel('mvA', f6, f6[0] && f6[0].name)}</label>
       <label class="field"><span>Segundo factor (opcional)</span><select id="mvB"><option value="">Ninguno</option>${f6.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label></div>
       <div class="field"><span>Covariables (opcional: MANCOVA)</span>${chips('mvC', nums, () => false)}</div>`,
      nums.length < 2 || !f6.length ? 'Necesitas al menos dos variables cuantitativas y un factor con 2 a 6 grupos.' : '');
    h += card('fact', !!D.fact && nums.length >= 1 && f6.length >= 2, 'ANOVA factorial (dos factores)', 'Efectos principales e interacción con sumas de cuadrados de tipo III, η² parcial y gráfico de interacción.',
      `<div class="field"><span>Variables dependientes (un ANOVA para cada una)</span>${chips('fY', nums, v => v.name === pick(dF.y, nums[0] && nums[0].name))}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor 1</span>${sel('fA', f6, pick(dF.a, f6[0] && f6[0].name))}</label>
       <label class="field"><span>Factor 2</span>${sel('fB', f6, pick(dF.b, f6[1] && f6[1].name))}</label></div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor 3 (opcional)</span><select id="fC"><option value="">Ninguno</option>${f6.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label></div>
       <div class="field"><span>Covariables (opcional: ANCOVA factorial)</span>${chips('fCov', nums, () => false)}</div>`,
      !(nums.length >= 1 && f6.length >= 2) ? 'Necesitas una variable cuantitativa y dos categóricas de 2 a 6 niveles.' : '');
    const dA = D.alpha || {};
    const dA2 = D.ancova || {};
    h += card('ancova', !!D.ancova && nums.length >= 2 && facs.length >= 1, 'ANCOVA (comparación de grupos controlando covariables)', 'Compara grupos ajustando por una o más covariables (por ejemplo, la puntuación previa): medias ajustadas, homogeneidad de pendientes y comparaciones por pares.',
      `<label class="field"><span>Variable dependiente</span>${sel('acY', nums, pick(dA2.y, nums[0] && nums[0].name))}</label>
       <label class="field"><span>Factor (grupos)</span>${sel('acG', facs, pick(dA2.g, facs[0] && facs[0].name))}</label>
       <div class="field"><span>Covariables (cuantitativas)</span>${chips('acC', nums, v => (dA2.c ? dA2.c.includes(v.name) : false))}</div>`,
      !(nums.length >= 2 && facs.length >= 1) ? 'Necesitas una variable dependiente, un factor y al menos una covariable cuantitativa.' : '');
    h += card('binrel', false && bins.length >= 2, 'Cambio en variables sí/no (McNemar / Q de Cochran)', 'Las mismas personas responden una pregunta dicotómica en dos o más momentos: McNemar (2) o Q de Cochran (3 o más).',
      `<div class="field"><span>Momentos (variables con las mismas dos categorías, en el orden de las columnas)</span>${chips('bR', bins, () => false)}</div>`,
      bins.length < 2 ? 'Necesitas al menos dos variables categóricas con exactamente 2 categorías (por ejemplo, sí/no antes y después).' : '');
    const xs = nums.concat(bins), dMo = D.mod || {}, dMe = D.med || {};
    // por defecto, variables distintas en cada papel (Y y M cuantitativas; X puede ser de 2 categorías)
    const nmN = v => v && v.name, defMeY = nmN(nums[nums.length - 1]), defMeM = nmN(nums[nums.length - 2]), defMeX = nmN(xs.find(v => v.name !== defMeY && v.name !== defMeM));
    const defMoY = nmN(nums[0]), defMoX = nmN(xs.find(v => v.name !== defMoY)), defMoW = nmN(xs.find(v => v.name !== defMoY && v.name !== defMoX));
    h += card('mod', !!D.mod && nums.length >= 2, 'Moderación (efecto de interacción)', '¿El efecto de X sobre Y depende de una tercera variable? Interacción, pendientes simples, región de Johnson-Neyman y gráfico (modelo 1 de PROCESS).',
      `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable dependiente (Y)</span>${sel('moY', nums, pick(dMo.y, defMoY))}</label>
       <label class="field"><span>Predictor (X)</span>${sel('moX', xs, pick(dMo.x, defMoX))}</label>
       <label class="field"><span>Moderador (W)</span>${sel('moW', xs, pick(dMo.w, defMoW))}</label></div>`,
      nums.length < 2 ? 'Necesitas una variable dependiente cuantitativa, un predictor y un moderador (cuantitativos o de 2 categorías).' : '');
    h += card('med', !!D.med && nums.length >= 2, 'Mediación (efecto indirecto)', '¿X influye en Y a través de un mediador M? Efectos a, b, c y c′ y efecto indirecto con intervalo bootstrap (modelo 4 de PROCESS).',
      `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Predictor (X)</span>${sel('meX', xs, pick(dMe.x, defMeX))}</label>
       <label class="field"><span>Mediador (M)</span>${sel('meM', nums, pick(dMe.m, defMeM))}</label>
       <label class="field"><span>Variable dependiente (Y)</span>${sel('meY', nums, pick(dMe.y, defMeY))}</label></div>
       <label class="field"><span>Modelo de PROCESS</span><select id="meMod" onchange="document.getElementById('meMW').style.display = this.value === '4p' || this.value === '6' ? '' : 'none'; document.getElementById('meWW').style.display = this.value === '7' || this.value === '14' ? '' : 'none'">
         <option value="4">4 · Mediación simple (recomendado si tienes un mediador)</option><option value="4p">4 · Varios mediadores en paralelo</option><option value="6">6 · Mediadores en serie (X → M1 → M2 → Y)</option>
         <option value="7">7 · Mediación moderada: W modera X → M</option><option value="14">14 · Mediación moderada: W modera M → Y</option></select></label>
       <div class="field" id="meMW" style="display:none"><span>Mediadores adicionales (en serie, se encadenan después de M en el orden del archivo)</span>${chips('meM2', nums, () => false)}</div>
       <label class="field" id="meWW" style="display:none"><span>Moderador (W)</span>${sel('meW', xs, nmN(xs.find(v => v.name !== defMeY && v.name !== defMeM && v.name !== defMeX)))}</label>
       <div class="field"><span>Covariables (opcional)</span>${chips('meC', nums, () => false)}</div>`,
      nums.length < 2 ? 'Necesitas un predictor, un mediador cuantitativo y una variable dependiente cuantitativa.' : '');
    const dL2 = D.lmm || {}, allV = ST.vars, gDef = (allV.find(v => /^(id|participante|sujeto|caso|case|subject|grupo|clase|centro|escuela|colegio)$|(^id[_ ]|[_ ]id$)/i.test(v.name)) || allV[0] || {}).name;
    h += card('lmm', !!D.lmm && nums.length >= 1, 'Modelo lineal mixto (datos longitudinales o anidados)', 'Varias mediciones por persona, o personas dentro de grupos (alumnos en clases, pacientes en hospitales): efectos fijos con gl de Satterthwaite, efectos aleatorios, CCI y R² de Nakagawa.',
      `<p class="small muted" style="margin:0 0 10px">Los datos deben estar en <b>formato largo</b>: una fila por medición y una columna que identifique a la persona o al grupo.</p>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable dependiente</span>${sel('lmY', nums, pick(dL2.y, nums[0] && nums[0].name))}</label>
       <label class="field"><span>Agrupación (persona o grupo)</span>${sel('lmG', allV, pick(dL2.g, gDef))}</label>
       <label class="field"><span>Pendiente aleatoria (opcional)</span><select id="lmS"><option value="">Ninguna (solo intercepto aleatorio)</option>${nums.map(v => `<option value="${esc(v.name)}"${dL2.s === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label></div>
       <div class="field"><span>Efectos fijos (predictores)</span>${chips('lmX', nums.concat(facs), v => (dL2.x ? dL2.x.includes(v.name) : false))}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end"><label class="field"><span>Interacción (opcional): predictor A</span><select id="lmIA"><option value="">Sin interacción</option>${nums.concat(facs).map(v => `<option value="${esc(v.name)}"${dL2.ia === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
       <label class="field"><span>× predictor B</span><select id="lmIB"><option value="">—</option>${nums.concat(facs).map(v => `<option value="${esc(v.name)}"${dL2.ib === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label></div>`,
      nums.length < 1 ? 'Necesitas una variable dependiente cuantitativa.' : '');
    const dCf = D.cfa || [];
    h += card('cfa', !!D.cfa && nums.length >= 3, 'Análisis factorial confirmatorio', 'Contrasta una estructura de factores definida de antemano: índices de ajuste (CFI, TLI, RMSEA, SRMR), cargas estandarizadas, correlaciones entre factores y fiabilidad (ω, AVE).',
      `<p class="small muted" style="margin:0 0 10px">Asigna cada ítem a un solo factor. Deja vacíos los factores que no uses.</p>` +
      [0, 1, 2, 3].map(k => `<div class="field" style="border-top:1px solid var(--line);padding-top:10px"><span>Factor ${k + 1}: <input id="cfN${k}" value="${esc((dCf[k] && dCf[k].name) || `Factor ${k + 1}`)}" style="font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:8px;width:200px"></span>${chips('cfI' + k, nums, v => !!(dCf[k] && dCf[k].items.includes(v.name)))}</div>`).join(''),
      nums.length < 3 ? 'Necesitas al menos tres ítems cuantitativos.' : '');
    const dE = D.efa || {};
    h += card('efa', !!D.efa && nums.length >= 3, 'Análisis factorial exploratorio y componentes principales', 'Estructura interna de un cuestionario: KMO, Bartlett, análisis paralelo, cargas, comunalidades y varianza explicada; ejes principales, MinRes, máxima verosimilitud o ACP, con siete rotaciones.',
      `<div class="field"><span>Ítems</span>${chips('eI', nums, v => (dE.items ? dE.items.includes(v.name) : false))}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Número de factores</span><select id="eN"><option value="auto">Automático (análisis paralelo)</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(k => `<option value="${k}">${k}</option>`).join('')}</select></label>
       <label class="field"><span>Extracción</span><select id="eE"><option value="pa">Ejes principales (recomendada con ítems Likert)</option><option value="minres">Mínimos residuos (MinRes/ULS)</option><option value="ml">Máxima verosimilitud (con índices de ajuste)</option><option value="pca">Componentes principales (ACP)</option></select></label>
       <label class="field"><span>Rotación</span><select id="eR"><optgroup label="Oblicuas (factores correlacionados)"><option value="oblimin">Oblimin (recomendada)</option><option value="promax">Promax</option><option value="geomin">Geomin</option></optgroup><optgroup label="Ortogonales (factores independientes)"><option value="varimax">Varimax</option><option value="quartimax">Quartimax</option><option value="equamax">Equamax</option></optgroup><option value="none">Sin rotación</option></select></label></div>`,
      nums.length < 3 ? 'Necesitas al menos tres ítems cuantitativos.' : '');
    h += card('alpha', !!D.alpha && nums.length >= 2, 'Fiabilidad de una escala (alfa de Cronbach)', 'Consistencia interna de un cuestionario: alfa, correlación ítem-total y alfa si se elimina cada ítem.',
      `<div class="field"><span>Ítems de la escala</span>${chips('aI', nums, v => (dA.items ? dA.items.includes(v.name) : false))}</div>
       <div class="field"><span>Ítems inversos (se recodifican)</span>${chips('aR', nums, v => (dA.rev ? dA.rev.includes(v.name) : false))}</div>`,
      nums.length < 2 ? 'Necesitas al menos dos ítems cuantitativos.' : '');
    $('#anList').innerHTML = h;
    // el grupo control de Dunnett depende de la variable de agrupación elegida
    const fillCtrl = () => { const g = $('#compG') && vByName($('#compG').value), c = $('#compCtrl'); if (!g || !c) return;
      c.innerHTML = levelsOf(g).map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join(''); };
    if ($('#compG')) { $('#compG').addEventListener('change', fillCtrl); fillCtrl(); }
    const fillPos = () => { const v = $('#rocY') && vByName($('#rocY').value), c = $('#rocPos'); if (!v || !c) return; const lv = levelsOf(v);
      c.innerHTML = lv.map((l, q) => `<option value="${esc(l)}"${q === lv.length - 1 ? ' selected' : ''}>${esc(l)}</option>`).join(''); };
    if ($('#rocY')) { $('#rocY').addEventListener('change', fillPos); fillPos(); }
    $$('.an>label input').forEach(i => i.onchange = () => i.closest('.an').classList.toggle('on', i.checked));
  }
  const isOn = id => { const el = $(`.an[data-an="${id}"] > label input`); return el && el.checked; };
  const checkedVals = name => $$(`input[name="${name}"]:checked`).map(i => i.value);

  // ---------- piezas de resultados ----------
  let tabNo = 0, figNo = 0;
  function apaTable(title, head, rows, note, cls = '') {
    tabNo++;
    return `<div class="scroll"><table class="apa ${cls}"><caption><b>Tabla ${tabNo}</b><i>${esc(title)}</i></caption><thead><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>${note ? `<div class="note"><i>Nota.</i> ${note}</div>` : ''}</div>`;
  }
  const fig = (title, svg, legendHtml = '') => ({ title, svg, legend: legendHtml });
  const chk = (s, t) => ({ s, t });

  // ---------- análisis ----------
  function runDescriptives(names, gName = '') {
    const vars = names.map(vByName).filter(Boolean).filter(v => v.name !== gName), nums = vars.filter(v => v.type === 'num'), cats = vars.filter(v => v.type === 'cat');
    const sec = { title: 'Estadísticos descriptivos', test: 'Descriptivos', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    const G = gName ? vByName(gName) : null, gl = G ? levelsOf(G) : [], gc = G ? catOf(G) : null;
    sec.decision = `Se describen ${vars.length} variables${G ? `, también por grupos de ${esc(gName)}` : ''}. Para las cuantitativas se informa media y desviación típica junto a mediana, rango intercuartílico, asimetría y curtosis; para las categóricas, frecuencias y porcentajes.`;
    sec.why.push('El análisis descriptivo resume la muestra antes de cualquier contraste de hipótesis y es obligatorio en el apartado de resultados.');
    sec.why.push('Se informa la mediana y el rango intercuartílico además de la media porque, si la distribución es asimétrica, representan mejor el valor típico y la dispersión.');
    sec.why.push('La normalidad se valora con Shapiro-Wilk (la prueba más potente) y Kolmogorov-Smirnov con la corrección de Lilliefors (la que muestra SPSS en «Explorar»), junto con los gráficos Q-Q.');
    const textParts = [`La muestra estuvo compuesta por ${ST.rows.length} participantes.`];
    const q = (sx, pr) => S.quantile(sx, pr);
    if (nums.length) {
      const rows = [], skewed = [], normRows = [], outl = [];
      nums.forEach(v => {
        const x = numOf(v).filter(a => a !== null); if (x.length < 2) return; const d = S.describe(x), n = x.length, sx = x.slice().sort((a, b) => a - b);
        const q1 = q(sx, .25), q3 = q(sx, .75), iqr = q3 - q1;
        if (Math.abs(d.skew) > 1) skewed.push(v.name);
        rows.push([esc(v.name), n, ST.rows.length - n, f(d.mean), f(d.sd), f(d.median), `${f(q1)}–${f(q3)}`, +d.min.toFixed(3), +d.max.toFixed(3),
          n > 2 ? `${f(d.skew)} (${f(S.seSkew(n))})` : f(d.skew), n > 3 ? `${f(d.kurt)} (${f(S.seKurt(n))})` : f(d.kurt)]);
        const sw = n >= 3 && n <= 5000 ? S.shapiro(x) : null, ks = S.lilliefors(x);
        normRows.push([esc(v.name), sw ? nz(sw.W.toFixed(3)) : '—', sw ? pv(sw.p) : '—', ks ? nz(ks.D.toFixed(3)) : '—', ks ? pv(ks.p) : '—']);
        const tk = x.filter(a => a < q1 - 1.5 * iqr || a > q3 + 1.5 * iqr).length, z3 = x.filter(a => Math.abs((a - d.mean) / d.sd) > 3).length;
        if (tk || z3) outl.push(`${esc(v.name)} (${tk} según el criterio de 1.5·RIC${z3 ? `; ${z3} con |<i>z</i>| > 3` : ''})`);
        if (sec.charts.length < 18) { sec.charts.push(fig(v.name, CH.histogram(x, v.name))); sec.charts.push(fig(`${v.name}: gráfico Q-Q normal`, CH.qqplot(x, v.name, pr => J_inv(pr)))); }
      });
      sec.tables.push(apaTable('Estadísticos descriptivos de las variables cuantitativas', ['Variable', '<i>n</i>', 'Perdidos', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'RIC (P25–P75)', 'Mín.', 'Máx.', 'Asimetría (<i>EE</i>)', 'Curtosis (<i>EE</i>)'], rows,
        'Curtosis expresada como exceso respecto a la distribución normal (0 = normal). Errores típicos de asimetría y curtosis como en SPSS; percentiles con el método por defecto de R (tipo 7).'));
      sec.tables.push(apaTable('Pruebas de normalidad', ['Variable', '<i>W</i> de Shapiro-Wilk', '<i>p</i>', '<i>D</i> de Kolmogorov-Smirnov', '<i>p</i> (Lilliefors)'], normRows,
        'Con muestras grandes, desviaciones pequeñas e irrelevantes ya resultan significativas: interpreta las pruebas junto con los gráficos Q-Q, la asimetría y la curtosis.'));
      sec.checks.push(skewed.length ? chk('no', `Asimetría marcada (|asimetría| > 1) en ${list(skewed.map(esc))}: para estas variables conviene informar mediana y rango intercuartílico.`)
        : chk('ok', 'Ninguna variable cuantitativa presenta una asimetría marcada (|asimetría| ≤ 1).'));
      sec.checks.push(outl.length ? chk('info', `Posibles valores atípicos: ${list(outl)}. Revisa que no sean errores de introducción de datos antes de decidir si se mantienen.`) : chk('ok', 'No hay valores atípicos según el criterio de 1.5·RIC ni |z| > 3.'));
      if (nums.length <= 8) sec.charts.push(fig('Diagramas de caja', CH.boxplot(nums.map(v => ({ name: v.name, x: numOf(v).filter(a => a !== null) })).filter(g => g.x.length > 1), 'Variables')));
      const nt = nums.slice(0, 6).map(v => { const x = numOf(v).filter(a => a !== null); if (x.length < 2) return ''; const d = S.describe(x); return `${esc(v.name)} (<i>M</i> = ${f(d.mean)}, <i>DT</i> = ${f(d.sd)}; rango ${+d.min.toFixed(2)}–${+d.max.toFixed(2)})`; }).filter(Boolean);
      if (nt.length) textParts.push(`En cuanto a las variables cuantitativas, se obtuvieron los siguientes valores: ${list(nt)}.`);
      if (G) {
        const gr = []; nums.forEach(v => { const x = numOf(v); gl.forEach((l, j) => { const xs = x.filter((a, i) => a !== null && gc[i] === l); if (xs.length < 1) return; const d = S.describe(xs);
          gr.push([j === 0 ? esc(v.name) : '', esc(l), d.n, f(d.mean), xs.length > 1 ? f(d.sd) : '—', f(d.median), +d.min.toFixed(3), +d.max.toFixed(3)]); });
          if (sec.charts.length < 24 && gl.length <= 10) sec.charts.push(fig(`${v.name} por ${gName}`, CH.boxplot(gl.map(l => ({ name: l, x: x.filter((a, i) => a !== null && gc[i] === l) })).filter(g => g.x.length > 1), v.name))); });
        sec.tables.push(apaTable(`Estadísticos descriptivos por ${gName}`, ['Variable', esc(gName), '<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'Mín.', 'Máx.'], gr));
      }
    }
    if (cats.length) {
      const rows = [];
      cats.forEach(v => {
        const c = catOf(v), lv = levelsOf(v), nv = c.filter(x => x !== null).length; let acc = 0;
        rows.push([`<b>${esc(v.name)}</b>`, '', '', '', '']);
        lv.forEach(l => { const k = c.filter(x => x === l).length; acc += k; rows.push(['&nbsp;&nbsp;&nbsp;' + esc(l), k, f(k / ST.rows.length * 100, 1), f(k / nv * 100, 1), f(acc / nv * 100, 1)]); });
        if (nv < ST.rows.length) rows.push(['&nbsp;&nbsp;&nbsp;<span class="muted">Perdidos</span>', ST.rows.length - nv, f((ST.rows.length - nv) / ST.rows.length * 100, 1), '', '']);
        if (sec.charts.length < 24 && lv.length <= 15) sec.charts.push(fig(v.name, CH.barsCat(lv, lv.map(l => c.filter(x => x === l).length), v.name)));
      });
      sec.tables.push(apaTable('Frecuencias de las variables categóricas', ['Variable / categoría', '<i>n</i>', '%', '% válido', '% acumulado'], rows, 'El porcentaje acumulado sigue el orden de las categorías (relevante en variables ordinales).'));
      cats.slice(0, 4).forEach(v => {
        const c = catOf(v), lv = levelsOf(v), nv = c.filter(x => x !== null).length;
        const parts = lv.slice(0, 5).map(l => { const k = c.filter(x => x === l).length; return `${esc(l)} el ${f(k / nv * 100, 1)} % (<i>n</i> = ${k})`; });
        textParts.push(`Respecto a ${esc(v.name)}, ${list(parts)}${lv.length > 5 ? ', entre otras categorías' : ''}.`);
      });
    }
    sec.text.push(textParts.join(' '));
    const NN = nums.map(v => rq(v.name)).join(', ');
    sec.code = `# Descriptivos\n${nums.length ? `psych::describe(datos[, c(${NN})], type = 2, quant = c(.25, .75))  # asimetría y curtosis como SPSS\n` +
      `sapply(datos[, c(${NN})], function(x) c(shapiro.test(x)$p.value, nortest::lillie.test(x)$p.value))  # normalidad\n` +
      `boxplot(datos[, c(${NN})])\n` + (G ? `psych::describeBy(datos[, c(${NN})], group = datos[[${rq(gName)}]], mat = TRUE)\n` : '') : ''}` +
      cats.map(v => `t <- table(datos$${rn(v.name)}); cbind(n = t, pct = round(prop.table(t) * 100, 1), acum = round(cumsum(prop.table(t)) * 100, 1))`).join('\n');
    return sec;
  }

  function runCorrelations(names, method, zNames = []) {
    zNames = zNames.filter(z => !names.includes(z));
    const vars = names.map(vByName).filter(v => v && v.type === 'num'), Zv = zNames.map(vByName), partial = Zv.length > 0;
    const sec = { title: partial ? 'Correlaciones parciales' : 'Correlaciones', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (vars.length < 2) { sec.error = 'Selecciona al menos dos variables cuantitativas (distintas de las que controlas).'; return sec; }
    if (partial && method === 'kendall') { sec.error = 'La correlación parcial está disponible con Pearson o Spearman. Elige uno de esos métodos o quita las variables de control.'; return sec; }
    const skewed = vars.filter(v => Math.abs(S.skewness(numOf(v).filter(a => a !== null))) > 1);
    let m = method;
    if (m === 'auto') m = skewed.length ? 'spearman' : 'pearson';
    const P = m === 'pearson', K = m === 'kendall', sym = P ? '<i>r</i>' : K ? 'τ<sub>b</sub>' : '<i>r</i><sub>s</sub>', name = P ? 'Pearson' : K ? 'Kendall (tau-b)' : 'Spearman';
    sec.test = `Correlación ${partial ? 'parcial ' : ''}de ${name}`;
    if (partial) sec.why.push(`Correlación parcial: se elimina de cada par la parte que comparten con ${list(zNames.map(esc))} (regresión de ambas variables sobre ${zNames.length > 1 ? 'ellas' : 'ella'} y correlación de los residuos${P ? '' : ', sobre los rangos'}). Se usan los casos completos en todas las variables.`);
    if (K) sec.why.push('Tau-b de Kendall: medida de asociación por rangos basada en pares concordantes y discordantes, corregida por empates; adecuada con muestras pequeñas o muchas puntuaciones repetidas.');
    sec.decision = method === 'auto' ? (P ? 'Se usa Pearson porque ninguna variable presenta una asimetría marcada.' : `Se usa Spearman porque ${list(skewed.map(v => esc(v.name)))} ${skewed.length > 1 ? 'presentan' : 'presenta'} una asimetría marcada (|asimetría| > 1).`) : `Método elegido por ti: ${name}.`;
    sec.why.push('Todas las variables son cuantitativas y se quiere medir la fuerza y dirección de su relación.');
    sec.why.push(P ? 'Pearson mide relación lineal y es adecuada cuando las variables tienen distribuciones aproximadamente simétricas.' : 'Spearman trabaja con rangos: es robusta ante asimetría y valores atípicos y mide relaciones monótonas.');
    sec.why.push('Los valores perdidos se eliminan por parejas: cada correlación usa todos los casos disponibles para ese par.');
    const k = vars.length, R = [], pairs = []; let nmin = Infinity, nmax = 0;
    for (let i = 0; i < k; i++) { R[i] = []; for (let j = 0; j < i; j++) {
      const xi = numOf(vars[i]), xj = numOf(vars[j]), zs = Zv.map(numOf), a = [], b = [], zc = Zv.map(() => []);
      xi.forEach((v, t) => { if (v !== null && xj[t] !== null && zs.every(z => z[t] !== null)) { a.push(v); b.push(xj[t]); zs.forEach((z, q) => zc[q].push(z[t])); } });
      const c = a.length > 3 + Zv.length ? (partial ? S.partialCorr(a, b, zc, m) : P ? S.pearson(a, b) : K ? S.kendall(a, b) : S.spearman(a, b)) : null; R[i][j] = c;
      if (c) { nmin = Math.min(nmin, c.n); nmax = Math.max(nmax, c.n); pairs.push({ i, j, c, a, b }); }
    } }
    const cell = c => { if (!c || !isFinite(c.r)) return '—'; const al = Math.min(.55, Math.abs(c.r) * .6), bg = c.r >= 0 ? `rgba(42,120,214,${al})` : `rgba(227,73,72,${al})`;
      return `<span style="display:inline-block;min-width:52px;padding:2px 6px;border-radius:4px;background:${bg}" title="${P ? 'r' : 'rs'} = ${c.r.toFixed(3)}, p = ${c.p.toFixed(4)}, n = ${c.n}">${r2s(c.r)}${stars(c.p)}</span>`; };
    const rows = vars.map((v, i) => { const x = numOf(v).filter(a => a !== null), d = S.describe(x);
      return [`${i + 1}. ${esc(v.name)}`, f(d.mean), f(d.sd)].concat(vars.map((_, j) => (j < i ? cell(R[i][j]) : j === i ? '—' : ''))); });
    // detalle por pares: coeficiente, IC 95 %, n, p y p con corrección de Holm
    const holmP = S.holm(pairs.map(q => q.c.p));
    const pairRows = pairs.map((q, z) => { const ci = partial ? null : S.corrCI(q.c.r, q.c.n, m);
      return [`${esc(vars[q.i].name)} – ${esc(vars[q.j].name)}`, r2s(q.c.r)].concat(partial ? [q.c.n, q.c.df] : [`[${r2s(ci[0])}, ${r2s(ci[1])}]`, q.c.n]).concat([pv(q.c.p), pv(holmP[z])]); });
    sec.tables.push(apaTable(`Detalle de las correlaciones${partial ? ' parciales' : ''} de ${name}`, ['Par', sym].concat(partial ? ['<i>n</i>', '<i>gl</i>'] : ['IC 95 %', '<i>n</i>']).concat(['<i>p</i>', '<i>p</i> (Holm)']), pairRows,
      `${partial ? `Controlando por ${list(zNames.map(esc))}. ` : `IC por la transformación <i>z</i> de Fisher${P ? '' : K ? ' con el error típico de Fieller et al. (1957)' : ' con el error típico de Bonett y Wright (2000)'}. `}${!P && !partial ? `<i>p</i> exacta cuando no hay empates (como R y JASP)${K ? ' y <i>n</i> < 50' : ''}. ` : ''}<i>p</i> (Holm) corrige por el número de correlaciones calculadas.`));
    sec.tables.push(apaTable(`Medias, desviaciones típicas y correlaciones${partial ? ' parciales' : ''} de ${name}`, ['Variable', '<i>M</i>', '<i>DT</i>'].concat(vars.map((_, j) => String(j + 1))), rows,
      `${sym} de ${name}${partial ? `, controlando por ${list(zNames.map(esc))}` : ''}. <i>n</i> = ${nmin === nmax ? nmin : nmin + '–' + nmax} (eliminación por parejas). * <i>p</i> < .05. ** <i>p</i> < .01. *** <i>p</i> < .001.`, 'corr'));
    sec.checks.push(skewed.length ? chk(P ? 'no' : 'ok', `Asimetría marcada en ${list(skewed.map(v => esc(v.name)))}${P ? ': considera usar Spearman.' : ': por eso se usa Spearman.'}`) : chk('ok', 'Ninguna variable presenta asimetría marcada.'));
    sec.checks.push(chk('info', 'Linealidad: revisa el diagrama de dispersión. Una correlación cercana a 0 no descarta relaciones no lineales (por ejemplo, en forma de U).'));
    if (pairs.length > 10) sec.checks.push(chk('no', `Se han calculado ${pairs.length} correlaciones: con tantas pruebas aumenta la probabilidad de falsos positivos. Considera una corrección (por ejemplo, Holm) o interpreta solo las hipótesis planteadas a priori.`));
    const sig = pairs.filter(p => p.c.p < .05).sort((a, b) => Math.abs(b.c.r) - Math.abs(a.c.r));
    let t = `Se calcularon las correlaciones ${partial ? 'parciales ' : ''}de ${name} entre ${k} variables (${pairs.length} ${pairs.length === 1 ? 'par' : 'pares'})${partial ? `, controlando por ${list(zNames.map(esc))}` : ''}. `;
    if (!sig.length) t += 'Ninguna de las correlaciones fue estadísticamente significativa.';
    else {
      t += `${sig.length === 1 ? 'Una correlación fue' : sig.length + ' correlaciones fueron'} estadísticamente ${sig.length === 1 ? 'significativa' : 'significativas'}. `;
      t += sig.slice(0, 5).map(p => `${esc(vars[p.i].name)} y ${esc(vars[p.j].name)} mostraron una correlación ${p.c.r > 0 ? 'positiva' : 'negativa'} ${lbl.corr(p.c.r)}, ${K ? sym : `${sym}(${p.c.df})`} = ${r2s(p.c.r)}, ${pt(p.c.p)}`).join('; ') + '.';
      if (sig.length > 5) t += ` Las demás correlaciones significativas se muestran en la Tabla ${tabNo}.`;
    }
    sec.text.push(t);
    if (pairs.length) { const top = pairs.slice().sort((a, b) => Math.abs(b.c.r) - Math.abs(a.c.r))[0];
      const reg = (() => { const mx = S.mean(top.b), my = S.mean(top.a); let sxy = 0, sxx = 0; top.b.forEach((v, i) => { sxy += (v - mx) * (top.a[i] - my); sxx += (v - mx) ** 2; }); const b = sxy / sxx; return [my - b * mx, b]; })();
      sec.charts.push(fig(`Relación más fuerte: ${vars[top.i].name} y ${vars[top.j].name}`, CH.scatter(top.b, top.a, vars[top.j].name, vars[top.i].name, { line: reg }))); }
    const VV = `c(${vars.map(v => rq(v.name)).join(', ')})`;
    sec.code = partial
      ? `# Correlaciones parciales de ${name}, controlando por ${zNames.join(', ')}\nd <- na.omit(datos[, c(${vars.concat(Zv).map(v => rq(v.name)).join(', ')})])\npsych::partial.r(d${P ? '' : ', method = "spearman"'}, x = ${VV}, y = c(${zNames.map(rq).join(', ')}))\n` +
        `# p de cada correlación parcial (gl = n − 2 − número de variables controladas)\npsych::corr.p(psych::partial.r(d${P ? '' : ', method = "spearman"'}, x = ${VV}, y = c(${zNames.map(rq).join(', ')})), n = nrow(d) - ${zNames.length}, adjust = "none")`
      : `# Correlaciones de ${name}\npsych::corr.test(datos[, ${VV}], method = "${m}", use = "pairwise", adjust = "none")\n` +
        pairs.map(q => `cor.test(datos[[${rq(vars[q.i].name)}]], datos[[${rq(vars[q.j].name)}]], method = "${m}")`).slice(0, 6).join('\n') + (pairs.length > 6 ? '\n# … (igual para el resto de pares)' : '');
    return sec;
  }

  function runCompare(yName, gName, alt = 'two', opts = {}) {
    const yv = vByName(yName), gv = vByName(gName), y = numOf(yv), g = catOf(gv), lv = levelsOf(gv);
    const sec = { title: `${yName} según ${gName}`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    let groups = lv.map(l => ({ name: l, x: [] }));
    y.forEach((v, i) => { if (v !== null && g[i] !== null) groups[lv.indexOf(g[i])].x.push(v); });
    const dropped = groups.filter(q => q.x.length < 3); groups = groups.filter(q => q.x.length >= 3);
    if (groups.length < 2) { sec.error = 'Se necesitan al menos dos grupos con 3 o más casos.'; return sec; }
    if (groups.some(q => S.sd(q.x) === 0)) { sec.error = 'Algún grupo tiene todos los valores iguales (varianza 0): no se puede realizar la prueba.'; return sec; }
    const k = groups.length, xs = groups.map(q => q.x), N = S.sum(xs.map(a => a.length));
    groups.forEach(q => { q.d = S.describe(q.x); q.sw = S.shapiro(q.x); q.normOK = q.x.length >= 30 || (q.sw && q.sw.p >= .05); });
    const normOK = groups.every(q => q.normOK), lev = S.levene(xs), eqVar = lev.p >= .05, Y = rn(yName), G = rn(gName);
    const nameList = list(groups.map(q => esc(q.name)));
    sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa.`);
    sec.why.push(`Variable de agrupación: ${esc(gName)} → ${k} grupos (${nameList}).`);
    sec.why.push('Grupos independientes: se asume que cada participante pertenece a un solo grupo.');
    groups.forEach(q => {
      const sw = q.sw ? `Shapiro-Wilk: <i>W</i> = ${nz(q.sw.W.toFixed(3))}, ${pt(q.sw.p)}` : 'Shapiro-Wilk no calculable';
      if (q.sw && q.sw.p >= .05) sec.checks.push(chk('ok', `Normalidad en ${esc(q.name)} (<i>n</i> = ${q.x.length}): ${sw}.`));
      else if (q.x.length >= 30) sec.checks.push(chk('info', `Normalidad en ${esc(q.name)} (<i>n</i> = ${q.x.length}): ${sw}. No es normal, pero con <i>n</i> ≥ 30 la prueba paramétrica es robusta (teorema central del límite).`));
      else sec.checks.push(chk('no', `Normalidad en ${esc(q.name)} (<i>n</i> = ${q.x.length}): ${sw}. No se cumple y la muestra es pequeña.`));
    });
    sec.checks.push(chk(eqVar ? 'ok' : 'no', `Homogeneidad de varianzas (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}. ${eqVar ? 'Se cumple.' : 'No se cumple.'}`));
    sec.checks.push(chk('info', 'Independencia: depende del diseño. Si son las mismas personas medidas varias veces, usa «Comparación de medidas relacionadas».'));
    if (dropped.length) sec.checks.push(chk('no', `Se han excluido grupos con menos de 3 casos: ${list(dropped.map(q => esc(q.name)))}.`));
    const missN = ST.rows.length - N;
    sec.tables.push(apaTable(`Estadísticos descriptivos de ${yName} por ${gName}`, [esc(gName), '<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'IC 95 % (<i>M</i>)'],
      groups.map(q => [esc(q.name), q.x.length, f(q.d.mean), f(q.d.sd), f(q.d.median), `[${f(q.d.ci[0])}, ${f(q.d.ci[1])}]`]), missN ? `Se excluyeron ${missN} casos con valores perdidos.` : ''));
    sec.charts.push(fig(`${yName} por ${gName}: medias e IC 95 %`, CH.meansCI(groups.map(q => ({ name: q.name, x: q.x, mean: q.d.mean, ci: q.d.ci })), yName)));
    const MD = q => `<i>M</i> = ${f(q.d.mean)}, <i>DT</i> = ${f(q.d.sd)}`, MdnD = q => `<i>Mdn</i> = ${f(q.d.median)}`;
    let code = `# ${yName} según ${gName}\ntapply(datos$${Y}, datos$${G}, shapiro.test)   # normalidad por grupo\ncar::leveneTest(${Y} ~ ${G}, data = datos, center = mean)\n`;
    const normWhy = normOK ? 'La normalidad se cumple en todos los grupos (o n ≥ 30), por lo que se usa una prueba paramétrica.' : 'La normalidad no se cumple en algún grupo con muestra pequeña, por lo que se usa una prueba no paramétrica, que no requiere normalidad.';
    sec.why.push(normWhy);
    if (k === 2) {
      const [A, B] = groups;
      const one = alt !== 'two', hyp = one ? ` (hipótesis unilateral: ${esc(A.name)} ${alt === 'greater' ? '>' : '<'} ${esc(B.name)})` : '';
      const rAlt = { two: 'two.sided', greater: 'greater', less: 'less' }[alt];
      if (one) sec.why.push(`Has elegido una hipótesis unilateral: se contrasta si ${esc(A.name)} puntúa ${alt === 'greater' ? 'más' : 'menos'} que ${esc(B.name)}. Debe decidirse antes de ver los datos; si no, usa la bilateral.`);
      if (normOK) {
        const r = S.tTestInd(A.x, B.x, eqVar, alt), name = eqVar ? 'prueba t de Student para muestras independientes' : 'prueba t de Welch para muestras independientes';
        sec.test = (eqVar ? 'Prueba t de Student' : 'Prueba t de Welch') + (one ? ' (unilateral)' : '');
        sec.why.push(eqVar ? 'Las varianzas son homogéneas (Levene p ≥ .05): se usa la prueba t clásica.' : 'Las varianzas no son homogéneas (Levene p < .05): se usa la corrección de Welch, que no asume varianzas iguales.');
        sec.decision = `Se eligió la ${name}${hyp} porque se comparan 2 grupos independientes en una variable cuantitativa, la normalidad es aceptable y las varianzas ${eqVar ? 'son homogéneas' : 'difieren (corrección de Welch)'}.`;
        sec.alt = 'U de Mann-Whitney si no se cumpliera la normalidad con muestras pequeñas.';
        sec.tables.push(apaTable(`Resultado de la ${name}`, ['', '<i>t</i>', '<i>gl</i>', '<i>p</i>' + (one ? ' (unilateral)' : ''), 'Diferencia de medias', `IC ${one ? '95 % unilateral' : '95 %'}`, '<i>d</i> de Cohen', 'IC 95 % (<i>d</i>)', '<i>g</i> de Hedges'],
          [[`${esc(A.name)} − ${esc(B.name)}`, f(r.t), dfF(r.df), pv(r.p), f(r.diff), ciTxt(r.ci), f(r.d), ciTxt(r.dCI), f(r.g)]],
          (eqVar ? '<i>d</i> = diferencia de medias / desviación típica combinada.' : '<i>d</i> = diferencia de medias / raíz de la media de las dos varianzas (como JASP con Welch).') + ' IC de <i>d</i> por la distribución <i>t</i> no central. <i>g</i> = <i>d</i> con la corrección de Hedges para muestras pequeñas.'));
        const mw = S.mannWhitney(A.x, B.x, alt); sec.sens = `Análisis de sensibilidad: la U de Mann-Whitney da ${pt(mw.p)}, ${(mw.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión de la prueba t.`;
        const st = `<i>t</i>(${dfF(r.df)}) = ${f(r.t)}, ${pt(r.p)}${one ? ' (unilateral)' : ''}, <i>d</i> = ${f(r.d)}, IC 95 % [${ciTxt(r.dCI).slice(1, -1)}]`;
        sec.text.push(`Se aplicó una ${name}${hyp} para comparar ${esc(yName)} entre ${esc(A.name)} y ${esc(B.name)}. ` + (r.p < .05
          ? `${esc(A.name)} (${MD(A)}) obtuvo puntuaciones significativamente ${r.diff > 0 ? 'más altas' : 'más bajas'} que ${esc(B.name)} (${MD(B)}), ${st}. El tamaño del efecto fue ${lbl.d(r.d)}.`
          : `No se encontraron diferencias estadísticamente significativas entre ${esc(A.name)} (${MD(A)}) y ${esc(B.name)} (${MD(B)}), ${st}.`));
        code += `t.test(${Y} ~ ${G}, data = datos, var.equal = ${eqVar ? 'TRUE' : 'FALSE'}${one ? `, alternative = "${rAlt}"` : ''})\n` +
          (eqVar ? `effectsize::cohens_d(${Y} ~ ${G}, data = datos${one ? `, alternative = "${rAlt}"` : ''})  # d con IC (t no central)\neffectsize::hedges_g(${Y} ~ ${G}, data = datos)`
            : `# d de Welch como JASP: diferencia / sqrt((s1^2 + s2^2) / 2)\nwith(datos, diff(rev(tapply(${Y}, ${G}, mean))) / sqrt(mean(tapply(${Y}, ${G}, var))))`);
      } else {
        const r = S.mannWhitney(A.x, B.x, alt); sec.test = 'U de Mann-Whitney' + (one ? ' (unilateral)' : '');
        sec.decision = `Se eligió la U de Mann-Whitney${hyp} porque se comparan 2 grupos independientes y la normalidad no se cumple en algún grupo con muestra pequeña.`;
        sec.alt = 'Prueba t para muestras independientes si los datos fueran aproximadamente normales.';
        sec.tables.push(apaTable('Resultado de la prueba U de Mann-Whitney', ['', '<i>U</i>', '<i>z</i>', '<i>p</i>' + (one ? ' (unilateral)' : ''), '<i>r</i><sub>rb</sub>', 'IC 95 % (<i>r</i><sub>rb</sub>)'], [[`${esc(A.name)} vs. ${esc(B.name)}`, f(r.U, 1), f(r.z), pv(r.p), f(r.rb), ciTxt(r.rbCI)]],
          `<i>U</i> del grupo ${esc(A.name)}. ${r.exact ? '<i>p</i> exacta (sin empates y menos de 50 casos por grupo, como R y JASP).' : '<i>p</i> por la aproximación normal con corrección por continuidad y por empates.'} <i>r</i><sub>rb</sub> = correlación biserial por rangos (positiva si ${esc(A.name)} tiende a puntuar más), como JASP.`));
        const w = S.tTestInd(A.x, B.x, false, alt); sec.sens = `Análisis de sensibilidad: la prueba t de Welch da ${pt(w.p)}, ${(w.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
        const st = `<i>U</i> = ${f(r.U, 1)}, ${pt(r.p)}${one ? ' (unilateral)' : ''}, <i>r</i><sub>rb</sub> = ${f(r.rb)}, IC 95 % [${ciTxt(r.rbCI).slice(1, -1)}]`;
        sec.text.push(`Dado que no se cumplía el supuesto de normalidad, se aplicó la prueba U de Mann-Whitney${hyp}. ` + (r.p < .05
          ? `${esc(A.name)} (${MdnD(A)}) obtuvo puntuaciones significativamente ${r.rb >= 0 ? 'más altas' : 'más bajas'} en ${esc(yName)} que ${esc(B.name)} (${MdnD(B)}), ${st}, con un tamaño del efecto ${lbl.r(Math.abs(r.rb))}.`
          : `No se encontraron diferencias estadísticamente significativas en ${esc(yName)} entre ${esc(A.name)} (${MdnD(A)}) y ${esc(B.name)} (${MdnD(B)}), ${st}.`));
        code += `wilcox.test(${Y} ~ ${G}, data = datos${one ? `, alternative = "${rAlt}"` : ''})  # exacta si no hay empates y n < 50, como Tharp\neffectsize::rank_biserial(${Y} ~ ${G}, data = datos)`;
      }
    } else {
      const names = groups.map(q => q.name), posthocText = (ph, kind, useMedian) => {
        const sig = ph.filter(c => c.padj < .05);
        if (!sig.length) return ` Las comparaciones post hoc (${kind}) no detectaron diferencias significativas entre pares concretos.`;
        return ` Las comparaciones post hoc (${kind}) mostraron diferencias significativas entre ` + list(sig.map(c => { const a = groups[c.i], b = groups[c.j], hi = (useMedian ? a.d.median >= b.d.median : a.d.mean >= b.d.mean) ? [a, b] : [b, a];
          return `${esc(hi[0].name)} y ${esc(hi[1].name)} (${pt(c.padj)}${c.d !== undefined ? `, <i>d</i> = ${f(Math.abs(c.d))}, efecto ${lbl.d(c.d)}` : ''}; puntuaciones más altas en ${esc(hi[0].name)})`; })) + (sig.length < ph.length ? '. El resto de comparaciones no fueron significativas.' : '.');
      };
      if (normOK) {
        const cl = S.anova(xs);
        code += `dd <- data.frame(y = datos[[${rq(yName)}]], g = factor(datos[[${rq(gName)}]]))  # nombres simples para aov y TukeyHSD\ndd <- dd[complete.cases(dd), ]\n`;
        let om, ph, phName;
        if (eqVar) { om = cl; sec.test = 'ANOVA de un factor'; phName = 'Tukey HSD'; ph = S.hasTukey ? S.tukeyHSD(xs, cl.msw, cl.df2) : S.pairwiseHolm(xs, true); if (!S.hasTukey) phName = 't por pares con corrección de Holm'; }
        else { om = S.welchAnova(xs); sec.test = 'ANOVA de Welch'; phName = 'Games-Howell'; ph = S.hasTukey ? S.gamesHowell(xs) : S.pairwiseHolm(xs, false); if (!S.hasTukey) phName = 't de Welch por pares con corrección de Holm'; }
        // prueba post hoc elegida por la persona (si no, la automática según la homogeneidad de varianzas)
        const PHN = { tukey: 'Tukey HSD', gh: 'Games-Howell', bonferroni: 'Bonferroni', holm: 'Holm', sidak: 'Šidák', scheffe: 'Scheffé', lsd: 'DMS de Fisher, sin corrección', tamhane: 'T2 de Tamhane', dunnett: 'Dunnett' };
        const userPH = opts.ph && opts.ph !== 'auto' ? opts.ph : null, robustPH = m => m === 'gh' || m === 'tamhane';
        if (userPH) {
          phName = PHN[userPH];
          if (userPH === 'tukey') ph = S.tukeyHSD(xs, cl.msw, cl.df2);
          else if (userPH === 'gh') ph = S.gamesHowell(xs);
          else if (userPH === 'dunnett') { const ci = Math.max(0, names.indexOf(opts.ctrl)); ph = S.dunnett(xs, ci, cl.msw, cl.df2); phName = `Dunnett, frente a ${esc(names[ci])}`; }
          else ph = S.posthocMethod(xs, cl.msw, cl.df2, userPH);
          sec.why.push(`Comparaciones post hoc elegidas por ti: ${phName}.${robustPH(userPH) !== !eqVar ? ` Ten en cuenta que ${eqVar ? 'las varianzas son homogéneas, así que Tukey sería suficiente' : 'las varianzas no son homogéneas: es preferible una prueba que no las asuma iguales (Games-Howell o T2 de Tamhane)'}.` : ''}`);
        }
        // d de Cohen por pares: con varianzas homogéneas, sobre la DT del error del modelo (√MCE), como JASP y emmeans::eff_size;
        // con varianzas distintas, sobre la media de las dos varianzas (d_av)
        const useAv = userPH ? robustPH(userPH) : !eqVar;
        ph.forEach(c => { c.d = c.diff / Math.sqrt(!useAv ? cl.msw : (S.variance(xs[c.i]) + S.variance(xs[c.j])) / 2); });
        sec.why.push(eqVar ? 'Las varianzas son homogéneas: ANOVA clásico con post hoc de Tukey.' : 'Las varianzas no son homogéneas: ANOVA de Welch con post hoc de Games-Howell, que no asumen varianzas iguales.');
        sec.decision = `Se eligió el ${sec.test} porque se comparan ${k} grupos independientes en una variable cuantitativa con normalidad aceptable${eqVar ? ' y varianzas homogéneas' : ' y varianzas distintas'}.`;
        sec.alt = 'Prueba de Kruskal-Wallis si no se cumpliera la normalidad con muestras pequeñas.';
        if (eqVar) sec.tables.push(apaTable('Resultado del ANOVA de un factor', ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²', 'ω²'],
          [[esc(gName), f(cl.ssb), cl.df1, f(cl.ssb / cl.df1), f(cl.F), pv(cl.p), nz(cl.eta2.toFixed(3)), nz(cl.omega2.toFixed(3))], ['Error', f(cl.ssw), cl.df2, f(cl.msw), '', '', '', ''], ['Total', f(cl.ssb + cl.ssw), cl.df1 + cl.df2, '', '', '', '', '']],
          'ω² = omega cuadrado, estimación menos sesgada del tamaño del efecto en la población.'));
        else { const bf = S.brownForsythe(xs);
          sec.tables.push(apaTable('Resultado del ANOVA robusto (varianzas distintas)', ['Prueba', '<i>F</i>', '<i>gl</i><sub>1</sub>', '<i>gl</i><sub>2</sub>', '<i>p</i>', 'η²', 'ω²'],
            [['Welch', f(om.F), om.df1, f(om.df2), pv(om.p), nz(cl.eta2.toFixed(3)), nz(cl.omega2.toFixed(3))], ['Brown-Forsythe', f(bf.F), bf.df1, f(bf.df2), pv(bf.p), '', '']],
            'Se interpreta la prueba de Welch; Brown-Forsythe se muestra como comprobación. η² y ω² se calculan a partir del ANOVA clásico, como medidas descriptivas del tamaño del efecto.')); }
        if (opts.con) {
          const cs = S.contrasts(xs, cl.msw, cl.df2, opts.con), CN = { polynomial: 'polinómicos (tendencia)', helmert: 'de Helmert (cada grupo frente a la media de los siguientes)', difference: 'de diferencia (cada grupo frente a la media de los anteriores)', repeated: 'repetidos (cada grupo frente al siguiente)', simple: `simples (cada grupo frente a ${esc(names[0])})`, deviation: 'de desviación (cada grupo frente a la media global)' };
          const lab = c => c.name || ({ helmert: `${esc(names[c.i])} vs. media de ${list(names.slice(c.i + 1).map(esc))}`, difference: `${esc(names[c.i + 1])} vs. media de ${list(names.slice(0, c.i + 1).map(esc))}`, repeated: `${esc(names[c.i])} − ${esc(names[c.i + 1])}`, simple: `${esc(names[c.i + 1])} − ${esc(names[0])}`, deviation: `${esc(names[c.i + 1])} − media global` }[opts.con]);
          sec.tables.push(apaTable(`Contrastes planificados ${CN[opts.con]}`, ['Contraste', 'Pesos', 'Estimación', '<i>EE</i>', `<i>t</i>(${cl.df2})`, '<i>p</i>'],
            cs.map(c => [lab(c), c.w.map(w => fmtNum(Math.round(w * 1000) / 1000)).join(', '), f(c.est), f(c.se), f(c.t), pv(c.p)]),
            `Pesos en el orden de los grupos (${list(names.map(esc))}). Contrastes planificados con el error del ANOVA y sin corrección por comparaciones múltiples, como en SPSS: deben decidirse antes de ver los datos.${opts.con === 'polynomial' ? ' Los contrastes de tendencia solo tienen sentido si los grupos siguen un orden (por ejemplo, dosis o niveles crecientes).' : ''}`));
          sec.why.push(`Contrastes planificados ${CN[opts.con]}, elegidos por ti.`);
          code += `# Contrastes planificados (sin corrección)\nem <- emmeans::emmeans(aov(y ~ g, data = dd), ~ g)\nemmeans::contrast(em, list(${cs.map((c, q) => `${rq('c' + (q + 1))} = c(${c.w.map(w => +w.toFixed(6)).join(', ')})`).join(', ')}), adjust = "none")\n`;
        }
        const kw = S.kruskal(xs); sec.sens = `Análisis de sensibilidad: la prueba de Kruskal-Wallis da ${pt(kw.p)}, ${(kw.p < .05) === (om.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
        const st = `<i>F</i>(${om.df1}, ${dfF(om.df2)}) = ${f(om.F)}, ${pt(om.p)}, η² = ${nz(cl.eta2.toFixed(3))}`;
        let t = `Se aplicó un ${sec.test} para comparar ${esc(yName)} según ${esc(gName)} (${groups.map(q => `${esc(q.name)}: ${MD(q)}`).join('; ')}). `;
        const phNote = (useAv ? '<i>d</i> = diferencia de medias / raíz de la media de las dos varianzas, adecuada cuando las varianzas difieren.' : '<i>d</i> = diferencia de medias / √<i>MC</i><sub>error</sub> (como JASP).')
          + ' Tamaño del efecto: 0.20 pequeño, 0.50 mediano, 0.80 grande (Cohen, 1988).'
          + (userPH === 'lsd' ? ' <b>Sin corrección por comparaciones múltiples</b>: el riesgo de falsos positivos aumenta con el número de comparaciones.' : '');
        const phRows = ph.map(c => [`${esc(names[c.i])} − ${esc(names[c.j])}`, f(c.diff), pv(c.padj), f(c.d)]);
        const phTable = () => sec.tables.push(apaTable(`Comparaciones post hoc (${phName})`, ['Comparación', 'Diferencia de medias', '<i>p</i> ajustada', '<i>d</i> de Cohen'], phRows, phNote));
        if (om.p < .05) {
          t += `Se encontraron diferencias estadísticamente significativas, ${st}, con un tamaño del efecto ${lbl.eta(cl.eta2)}.` + posthocText(ph, phName, false);
          phTable();
        } else { t += `No se encontraron diferencias estadísticamente significativas, ${st}.`; if (userPH) { phTable(); t += ` Las comparaciones ${phName} se muestran porque las pediste, pero con una prueba global no significativa deben interpretarse con mucha cautela.`; } }
        sec.text.push(t);
        code += eqVar ? `modelo <- aov(y ~ g, data = dd)\nsummary(modelo)\neffectsize::eta_squared(modelo)\neffectsize::omega_squared(modelo)\nTukeyHSD(modelo)\n# d de Cohen por pares (como JASP): diferencia de medias / √MCE\nemmeans::eff_size(emmeans::emmeans(modelo, ~ g), sigma = sigma(modelo), edf = df.residual(modelo))`
          : `oneway.test(y ~ g, data = dd, var.equal = FALSE)\nonewaytests::bf.test(y ~ g, data = dd)  # Brown-Forsythe\nrstatix::games_howell_test(dd, y ~ g)`;
        if (userPH) code += '\n# Comparaciones post hoc elegidas\n' + ({ bonferroni: 'pairwise.t.test(dd$y, dd$g, p.adjust.method = "bonferroni", pool.sd = TRUE)', holm: 'pairwise.t.test(dd$y, dd$g, p.adjust.method = "holm", pool.sd = TRUE)',
          lsd: 'pairwise.t.test(dd$y, dd$g, p.adjust.method = "none", pool.sd = TRUE)', sidak: 'p <- pairwise.t.test(dd$y, dd$g, p.adjust.method = "none", pool.sd = TRUE)$p.value; m <- sum(!is.na(p)); 1 - (1 - p)^m  # Šidák',
          scheffe: 'DescTools::ScheffeTest(aov(y ~ g, data = dd))', tamhane: 'PMCMRplus::tamhaneT2Test(y ~ g, data = dd)', tukey: 'TukeyHSD(aov(y ~ g, data = dd))', gh: 'rstatix::games_howell_test(dd, y ~ g)',
          dunnett: `dd$g <- relevel(dd$g, ref = ${rq(opts.ctrl || names[0])})\nsummary(multcomp::glht(aov(y ~ g, data = dd), linfct = multcomp::mcp(g = "Dunnett")))` })[userPH];
      } else {
        const kw = S.kruskal(xs), ph = S.dunn(xs, kw); sec.test = 'Prueba de Kruskal-Wallis';
        sec.decision = `Se eligió la prueba de Kruskal-Wallis porque se comparan ${k} grupos independientes y la normalidad no se cumple en algún grupo con muestra pequeña.`;
        sec.alt = 'ANOVA de un factor si los datos fueran aproximadamente normales.';
        sec.tables.push(apaTable('Resultado de la prueba de Kruskal-Wallis', ['', '<i>H</i>', '<i>gl</i>', '<i>p</i>', 'ε²'], [[esc(gName), f(kw.H), kw.df, pv(kw.p), nz(kw.eps2.toFixed(3))]]));
        const w = S.welchAnova(xs); sec.sens = `Análisis de sensibilidad: el ANOVA de Welch da ${pt(w.p)}, ${(w.p < .05) === (kw.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
        const st = `<i>H</i>(${kw.df}) = ${f(kw.H)}, ${pt(kw.p)}, ε² = ${nz(kw.eps2.toFixed(3))}`;
        let t = `Dado que no se cumplía el supuesto de normalidad, se aplicó la prueba de Kruskal-Wallis para comparar ${esc(yName)} según ${esc(gName)} (${groups.map(q => `${esc(q.name)}: ${MdnD(q)}`).join('; ')}). `;
        if (kw.p < .05) {
          t += `Se encontraron diferencias estadísticamente significativas, ${st}.` + posthocText(ph, 'Dunn con corrección de Holm', true);
          sec.tables.push(apaTable('Comparaciones post hoc (Dunn, corrección de Holm)', ['Comparación', '<i>z</i>', '<i>p</i> ajustada'], ph.map(c => [`${esc(names[c.i])} − ${esc(names[c.j])}`, f(c.z), pv(c.padj)])));
        } else t += `No se encontraron diferencias estadísticamente significativas, ${st}.`;
        sec.text.push(t);
        code += `kruskal.test(${Y} ~ ${G}, data = datos)\nFSA::dunnTest(${Y} ~ ${G}, data = datos, method = "holm")`;
      }
    }
    if (dropped.length) code = `# Tharp excluyó los grupos con menos de 3 casos: ${dropped.map(q => q.name).join(', ')}\nd <- droplevels(subset(datos, !(${G} %in% c(${dropped.map(q => rq(q.name)).join(', ')}))))\n` +
      code.replace(/(?<![$\w`])datos(?![\w`])/g, 'd');
    sec.code = code; return sec;
  }

  function runPaired(aName, bName, alt = 'two') {
    const sec = { title: `${aName} frente a ${bName} (medidas relacionadas)`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (aName === bName) { sec.error = 'Elige dos variables distintas.'; return sec; }
    const xa = numOf(vByName(aName)), xb = numOf(vByName(bName)), a = [], b = [];
    xa.forEach((v, i) => { if (v !== null && xb[i] !== null) { a.push(v); b.push(xb[i]); } });
    if (a.length < 3) { sec.error = 'Se necesitan al menos 3 casos con ambas medidas.'; return sec; }
    const d = b.map((v, i) => v - a[i]); if (S.sd(d) === 0) { sec.error = 'Las diferencias son todas iguales: no se puede realizar la prueba.'; return sec; }
    const n = a.length, sw = S.shapiro(d), normOK = n >= 30 || (sw && sw.p >= .05), da = S.describe(a), db = S.describe(b), A = rn(aName), B = rn(bName);
    sec.why.push(`Se comparan dos medidas de las mismas personas: ${esc(aName)} y ${esc(bName)}.`);
    sec.why.push('Al ser medidas relacionadas, se analiza la diferencia dentro de cada persona, lo que elimina la variabilidad entre sujetos.');
    const swT = sw ? `Shapiro-Wilk de las diferencias: <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}` : 'Shapiro-Wilk no calculable';
    sec.checks.push(sw && sw.p >= .05 ? chk('ok', swT + '. Se cumple la normalidad.') : n >= 30 ? chk('info', swT + `. No es normal, pero con <i>n</i> = ${n} ≥ 30 la prueba t es robusta.`) : chk('no', swT + '. No se cumple y la muestra es pequeña.'));
    sec.tables.push(apaTable('Estadísticos descriptivos de las medidas relacionadas', ['Medida', '<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>'],
      [[esc(aName), n, f(da.mean), f(da.sd), f(da.median)], [esc(bName), n, f(db.mean), f(db.sd), f(db.median)]], ST.rows.length - n ? `Se excluyeron ${ST.rows.length - n} casos sin ambas medidas.` : ''));
    sec.charts.push(fig(`${aName} y ${bName}: medias e IC 95 %`, CH.meansCI([{ name: aName, x: a, mean: da.mean, ci: da.ci }, { name: bName, x: b, mean: db.mean, ci: db.ci }], 'Puntuación', { connect: true })));
    const one = alt !== 'two', rAlt = { two: 'two.sided', greater: 'greater', less: 'less' }[alt], ALT = one ? `, alternative = "${rAlt}"` : '';
    const hyp = one ? ` (hipótesis unilateral: ${esc(bName)} ${alt === 'greater' ? '>' : '<'} ${esc(aName)})` : '';
    if (one) sec.why.push(`Has elegido una hipótesis unilateral: se contrasta si ${esc(bName)} es ${alt === 'greater' ? 'mayor' : 'menor'} que ${esc(aName)}. Debe decidirse antes de ver los datos.`);
    if (normOK) {
      const r = S.tTestPaired(a, b, alt); sec.test = 'Prueba t para muestras relacionadas' + (one ? ' (unilateral)' : '');
      sec.why.push('Las diferencias son aproximadamente normales (o n ≥ 30): se usa la prueba t para muestras relacionadas.');
      sec.decision = `Se eligió la prueba t para muestras relacionadas${hyp} porque son dos medidas de las mismas personas y la normalidad de las diferencias es aceptable.`;
      sec.alt = 'Prueba de rangos con signo de Wilcoxon si las diferencias no fueran normales.';
      sec.tables.push(apaTable('Resultado de la prueba t para muestras relacionadas', ['', '<i>t</i>', '<i>gl</i>', '<i>p</i>' + (one ? ' (unilateral)' : ''), 'Diferencia de medias', 'IC 95 %', '<i>d</i><sub>z</sub>', 'IC 95 % (<i>d</i><sub>z</sub>)'],
        [[`${esc(bName)} − ${esc(aName)}`, f(r.t), r.df, pv(r.p), f(r.diff), ciTxt(r.ci), f(r.dz), ciTxt(r.dzCI)]], '<i>d</i><sub>z</sub> = media de las diferencias / desviación típica de las diferencias (como JASP); IC por la distribución <i>t</i> no central.'));
      const w = S.wilcoxonSigned(a, b, alt); sec.sens = `Análisis de sensibilidad: la prueba de Wilcoxon da ${pt(w.p)}, ${(w.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
      const st = `<i>t</i>(${r.df}) = ${f(r.t)}, ${pt(r.p)}${one ? ' (unilateral)' : ''}, <i>d</i><sub>z</sub> = ${f(r.dz)}, IC 95 % [${ciTxt(r.dzCI).slice(1, -1)}]`;
      sec.text.push(`Se aplicó una prueba t para muestras relacionadas${hyp} para comparar ${esc(aName)} (<i>M</i> = ${f(da.mean)}, <i>DT</i> = ${f(da.sd)}) y ${esc(bName)} (<i>M</i> = ${f(db.mean)}, <i>DT</i> = ${f(db.sd)}). ` +
        (r.p < .05 ? `Las puntuaciones ${r.diff > 0 ? 'aumentaron' : 'disminuyeron'} de forma estadísticamente significativa, ${st}, con un tamaño del efecto ${lbl.d(r.dz)}.` : `No se encontraron diferencias estadísticamente significativas, ${st}.`));
      sec.code = `# ${aName} frente a ${bName}\nshapiro.test(datos$${B} - datos$${A})\nt.test(datos$${B}, datos$${A}, paired = TRUE${ALT})\neffectsize::cohens_d(datos$${B}, datos$${A}, paired = TRUE${ALT})  # d_z con IC`;
    } else {
      const r = S.wilcoxonSigned(a, b, alt); sec.test = 'Prueba de rangos con signo de Wilcoxon' + (one ? ' (unilateral)' : '');
      sec.why.push('Las diferencias no son normales y la muestra es pequeña: se usa la prueba de Wilcoxon, que no requiere normalidad.');
      sec.decision = `Se eligió la prueba de Wilcoxon${hyp} porque son dos medidas de las mismas personas y las diferencias no siguen una distribución normal.`;
      sec.alt = 'Prueba t para muestras relacionadas si las diferencias fueran normales.';
      sec.tables.push(apaTable('Resultado de la prueba de rangos con signo de Wilcoxon', ['', '<i>V</i>', '<i>z</i>', '<i>p</i>' + (one ? ' (unilateral)' : ''), '<i>r</i><sub>rb</sub>', 'IC 95 % (<i>r</i><sub>rb</sub>)'], [[`${esc(bName)} − ${esc(aName)}`, f(r.V, 1), f(r.z), pv(r.p), f(r.rb), ciTxt(r.rbCI)]],
        `<i>V</i> = suma de rangos de las diferencias positivas. Se excluyeron ${n - r.n} diferencias nulas. ${r.exact ? '<i>p</i> exacta (sin empates ni ceros y menos de 50 pares, como R y JASP).' : '<i>p</i> por la aproximación normal con corrección por continuidad.'} <i>r</i><sub>rb</sub> = correlación biserial por rangos de pares emparejados (como JASP).`));
      const t = S.tTestPaired(a, b, alt); sec.sens = `Análisis de sensibilidad: la prueba t relacionada da ${pt(t.p)}, ${(t.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
      const st = `<i>V</i> = ${f(r.V, 1)}, ${pt(r.p)}${one ? ' (unilateral)' : ''}, <i>r</i><sub>rb</sub> = ${f(r.rb)}, IC 95 % [${ciTxt(r.rbCI).slice(1, -1)}]`;
      sec.text.push(`Dado que las diferencias no seguían una distribución normal, se aplicó la prueba de rangos con signo de Wilcoxon${hyp} para comparar ${esc(aName)} (<i>Mdn</i> = ${f(da.median)}) y ${esc(bName)} (<i>Mdn</i> = ${f(db.median)}). ` +
        (r.p < .05 ? `Se encontraron diferencias estadísticamente significativas, ${st}, con un tamaño del efecto ${lbl.r(Math.abs(r.rb))}.` : `No se encontraron diferencias estadísticamente significativas, ${st}.`));
      sec.code = `# ${aName} frente a ${bName}\nshapiro.test(datos$${B} - datos$${A})\nwilcox.test(datos$${B}, datos$${A}, paired = TRUE${ALT})  # exacta si no hay empates ni ceros y n < 50\neffectsize::rank_biserial(datos$${B}, datos$${A}, paired = TRUE)`;
    }
    return sec;
  }

  // Una muestra frente a un valor de referencia (por ejemplo, el punto medio de una escala o una norma publicada)
  function runOneSample(name, mu, alt = 'two') {
    const sec = { title: `${name} frente a ${fmtNum(mu)} (una muestra)`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    const x = numOf(vByName(name)).filter(v => v !== null), n = x.length;
    if (!isFinite(mu)) { sec.error = 'Escribe un valor de referencia numérico.'; return sec; }
    if (n < 3) { sec.error = 'Se necesitan al menos 3 casos.'; return sec; }
    if (S.sd(x) === 0) { sec.error = `${name} tiene el mismo valor en todos los casos: no se puede realizar la prueba.`; return sec; }
    const one = alt !== 'two', rAlt = { two: 'two.sided', greater: 'greater', less: 'less' }[alt], ALT = one ? `, alternative = "${rAlt}"` : '', X = rn(name);
    const hyp = one ? ` (hipótesis unilateral: media ${alt === 'greater' ? '>' : '<'} ${fmtNum(mu)})` : '';
    const ds = S.describe(x), sw = S.shapiro(x), normOK = n >= 30 || (sw && sw.p >= .05);
    sec.why.push(`Se compara la media de ${esc(name)} con un valor de referencia fijo (${fmtNum(mu)}), por ejemplo el punto medio de una escala o una norma publicada.`);
    if (one) sec.why.push(`Has elegido una hipótesis unilateral: se contrasta si la media es ${alt === 'greater' ? 'mayor' : 'menor'} que ${fmtNum(mu)}. Debe decidirse antes de ver los datos.`);
    const swT = sw ? `Shapiro-Wilk: <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}` : 'Shapiro-Wilk no calculable';
    sec.checks.push(sw && sw.p >= .05 ? chk('ok', swT + '. Se cumple la normalidad.') : n >= 30 ? chk('info', swT + `. No es normal, pero con <i>n</i> = ${n} ≥ 30 la prueba t es robusta.`) : chk('no', swT + '. No se cumple y la muestra es pequeña.'));
    sec.tables.push(apaTable(`Estadísticos descriptivos de ${name}`, ['<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'IC 95 % (<i>M</i>)'], [[n, f(ds.mean), f(ds.sd), f(ds.median), `[${f(ds.ci[0])}, ${f(ds.ci[1])}]`]], ST.rows.length - n ? `Se excluyeron ${ST.rows.length - n} casos sin dato.` : ''));
    if (normOK) {
      const r = S.tTestOne(x, mu, alt); sec.test = 'Prueba t para una muestra' + (one ? ' (unilateral)' : '');
      sec.decision = `Se eligió la prueba t para una muestra${hyp} porque se compara una media con un valor de referencia y la normalidad es aceptable (o <i>n</i> ≥ 30).`;
      sec.alt = 'Prueba de rangos con signo de Wilcoxon para una muestra si los datos no fueran normales.';
      sec.tables.push(apaTable('Resultado de la prueba t para una muestra', ['', '<i>t</i>', '<i>gl</i>', '<i>p</i>' + (one ? ' (unilateral)' : ''), 'Diferencia', 'IC 95 % (diferencia)', '<i>d</i> de Cohen', 'IC 95 % (<i>d</i>)'],
        [[`${esc(name)} − ${fmtNum(mu)}`, f(r.t), r.df, pv(r.p), f(r.diff), ciTxt(r.ci), f(r.d), ciTxt(r.dCI)]], '<i>d</i> = (media − valor de referencia) / desviación típica (como JASP); IC por la distribución <i>t</i> no central.'));
      const w = S.wilcoxonOne(x, mu, alt); sec.sens = `Análisis de sensibilidad: la prueba de Wilcoxon da ${pt(w.p)}, ${(w.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
      sec.text.push(`Se aplicó una prueba t para una muestra${hyp} para comparar la media de ${esc(name)} (<i>M</i> = ${f(ds.mean)}, <i>DT</i> = ${f(ds.sd)}) con el valor ${fmtNum(mu)}. ` + (r.p < .05
        ? `La media fue significativamente ${r.diff > 0 ? 'superior' : 'inferior'}, <i>t</i>(${r.df}) = ${f(r.t)}, ${pt(r.p)}, <i>d</i> = ${f(r.d)}, IC 95 % [${ciTxt(r.dCI).slice(1, -1)}], con un tamaño del efecto ${lbl.d(r.d)}.`
        : `No se encontraron diferencias estadísticamente significativas, <i>t</i>(${r.df}) = ${f(r.t)}, ${pt(r.p)}, <i>d</i> = ${f(r.d)}.`));
      sec.code = `# ${name} frente a ${mu}\nshapiro.test(datos$${X})\nt.test(datos$${X}, mu = ${mu}${ALT})\neffectsize::cohens_d(datos$${X}, mu = ${mu}${ALT})  # d con IC`;
    } else {
      const r = S.wilcoxonOne(x, mu, alt); sec.test = 'Prueba de rangos con signo de Wilcoxon para una muestra' + (one ? ' (unilateral)' : '');
      sec.decision = `Se eligió la prueba de Wilcoxon para una muestra${hyp} porque los datos no siguen una distribución normal y la muestra es pequeña.`;
      sec.alt = 'Prueba t para una muestra si los datos fueran normales.';
      sec.tables.push(apaTable('Resultado de la prueba de Wilcoxon para una muestra', ['', '<i>V</i>', '<i>z</i>', '<i>p</i>' + (one ? ' (unilateral)' : ''), '<i>r</i><sub>rb</sub>', 'IC 95 % (<i>r</i><sub>rb</sub>)'], [[`${esc(name)} − ${fmtNum(mu)}`, f(r.V, 1), f(r.z), pv(r.p), f(r.rb), ciTxt(r.rbCI)]],
        `Se excluyeron ${n - r.n} valores iguales a ${fmtNum(mu)}. ${r.exact ? '<i>p</i> exacta (como R y JASP).' : '<i>p</i> por la aproximación normal con corrección por continuidad.'} <i>r</i><sub>rb</sub> = correlación biserial por rangos (como JASP).`));
      const t = S.tTestOne(x, mu, alt); sec.sens = `Análisis de sensibilidad: la prueba t para una muestra da ${pt(t.p)}, ${(t.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
      sec.text.push(`Dado que los datos no seguían una distribución normal, se aplicó la prueba de rangos con signo de Wilcoxon${hyp} para comparar ${esc(name)} (<i>Mdn</i> = ${f(ds.median)}) con el valor ${fmtNum(mu)}. ` + (r.p < .05
        ? `Se encontraron diferencias estadísticamente significativas, <i>V</i> = ${f(r.V, 1)}, ${pt(r.p)}, <i>r</i><sub>rb</sub> = ${f(r.rb)}, con un tamaño del efecto ${lbl.r(Math.abs(r.rb))}.`
        : `No se encontraron diferencias estadísticamente significativas, <i>V</i> = ${f(r.V, 1)}, ${pt(r.p)}, <i>r</i><sub>rb</sub> = ${f(r.rb)}.`));
      sec.code = `# ${name} frente a ${mu}\nshapiro.test(datos$${X})\nwilcox.test(datos$${X}, mu = ${mu}${ALT})  # exacta si no hay empates ni ceros y n < 50\neffectsize::rank_biserial(datos$${X}, mu = ${mu})`;
    }
    return sec;
  }

  // Medidas repetidas con dos factores intrasujeto (y un factor entre sujetos opcional)
  function runRm2(cols, wNames, kw, gName) {
    const [A, B] = wNames, K = kw[0] * kw[1];
    const sec = { title: `${A} × ${B} (medidas repetidas${gName ? ` × ${gName}` : ''})`, test: `ANOVA de medidas repetidas de dos factores${gName ? ' con un factor entre sujetos' : ''}`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (cols.length !== K) { sec.error = `Has marcado ${cols.length} columnas, pero ${A} (${kw[0]} niveles) × ${B} (${kw[1]} niveles) requiere ${K}.`; return sec; }
    const X = cols.map(nm => numOf(vByName(nm))), gc = gName ? catOf(vByName(gName)) : null;
    const idx = ST.rows.map((_, i) => i).filter(i => X.every(c => c[i] !== null) && (!gc || gc[i] !== null));
    const lv = gName ? ordOf(vByName(gName), idx.map(i => gc[i])) : [''], G = lv.length, g = gName ? idx.map(i => lv.indexOf(gc[i])) : null;
    const Y = idx.map(i => X.map(c => c[i])), n = Y.length;
    if (n - G < K) { sec.error = `Hay pocos casos completos (${n}) para ${K} medidas.`; return sec; }
    if (gName && lv.some((_, j) => g.filter(x => x === j).length < 2)) { sec.error = 'Cada grupo necesita al menos 2 personas con todas las medidas.'; return sec; }
    const r = S.rmFactorial(Y, kw, g, G), lab = (a, b) => `${A} ${a + 1} · ${B} ${b + 1}`;
    sec.why.push(`Diseño intrasujeto ${kw[0]}×${kw[1]}: ${esc(A)} (${kw[0]} niveles) × ${esc(B)} (${kw[1]} niveles), con ${K} medidas de las mismas ${n} personas${gName ? ` y ${esc(gName)} como factor entre sujetos (${list(lv.map(esc))})` : ''}.`);
    sec.why.push('Cada efecto intrasujeto (los dos principales y su interacción) se contrasta con su propio término de error, y su esfericidad se comprueba por separado (como SPSS, JASP y afex).');
    sec.decision = `Se ajustó una ANOVA de medidas repetidas ${kw[0]}×${kw[1]}${gName ? ` con ${esc(gName)} como factor entre sujetos` : ''} con ${n} personas.`;
    sec.tables.push(apaTable('Correspondencia de las columnas con las condiciones', ['Columna', esc(A), esc(B)], cols.map((c, q) => [esc(c), Math.floor(q / kw[1]) + 1, (q % kw[1]) + 1]),
      `Comprueba que el orden es el correcto: el segundo factor (${esc(B)}) cambia más rápido.`));
    const dRows = []; lv.forEach((l, j) => cols.forEach((c, q) => { const x = Y.filter((_, i) => !g || g[i] === j).map(rw => rw[q]), d = S.describe(x); dRows.push([gName && q === 0 ? esc(l) : '', esc(c), lab(Math.floor(q / kw[1]), q % kw[1]), d.n, f(d.mean), f(d.sd)]); }));
    sec.tables.push(apaTable('Estadísticos descriptivos', (gName ? [esc(gName)] : ['']).concat(['Columna', 'Condición', '<i>n</i>', '<i>M</i>', '<i>DT</i>']), dRows));
    const eName = e => e.factors.map(f => esc(wNames[f])).join(' × '), corr = [];
    const sphRows = r.effects.filter(e => e.mauchly).map(e => { const ok = e.mauchly.p >= .05; if (!ok) corr.push(eName(e)); return [eName(e), nz(e.mauchly.W.toFixed(3)), f(e.mauchly.chi), e.mauchly.df, pv(e.mauchly.p), nz(e.gg.toFixed(3)), nz(e.hf.toFixed(3))]; });
    if (sphRows.length) { sec.tables.push(apaTable('Esfericidad (Mauchly) y épsilon de corrección', ['Efecto', '<i>W</i>', 'χ²', '<i>gl</i>', '<i>p</i>', 'ε Greenhouse-Geisser', 'ε Huynh-Feldt'], sphRows, 'Los efectos con 2 niveles cumplen la esfericidad por definición. Si Mauchly es significativo, se aplica Greenhouse-Geisser a ese efecto.'));
      sec.checks.push(chk(corr.length ? 'no' : 'ok', corr.length ? `No se cumple la esfericidad en ${list(corr)}: se corrigen sus grados de libertad con Greenhouse-Geisser.` : 'Se cumple la esfericidad en todos los efectos intrasujeto con más de dos niveles.')); }
    const rowE = (nm, t, e) => { const useGG = e.mauchly && e.mauchly.p < .05, eps = useGG ? e.gg : 1;
      return [nm, f(t.ss), dfF(t.df * eps), f(t.ss / (t.df * eps)), f(t.F), pv(useGG ? t.pGG : t.p), nz(t.peta2.toFixed(3)), nz(t.ges.toFixed(3))]; };
    const rows = [];
    if (r.B) rows.push(['<i>Entre sujetos</i>', '', '', '', '', '', '', ''], [esc(gName), f(r.B.ss), r.B.df, f(r.B.ss / r.B.df), f(r.B.F), pv(r.B.p), nz(r.B.peta2.toFixed(3)), nz(r.B.ges.toFixed(3))], ['Error', f(r.ssSe), r.dfS, f(r.ssSe / r.dfS), '', '', '', '']);
    rows.push(['<i>Intrasujeto</i>', '', '', '', '', '', '', '']);
    r.effects.forEach(e => { const useGG = e.mauchly && e.mauchly.p < .05, eps = useGG ? e.gg : 1; rows.push(rowE(eName(e), e.T, e)); if (e.TG) rows.push(rowE(`${eName(e)} × ${esc(gName)}`, e.TG, e)); rows.push([`Error (${eName(e)})`, f(e.ssE), dfF(e.dfE * eps), f(e.ssE / (e.dfE * eps)), '', '', '', '']); });
    sec.tables.push(apaTable('Resultado de la ANOVA de medidas repetidas', ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>', 'η²<sub>G</sub>'], rows,
      `${corr.length ? 'Grados de libertad corregidos con Greenhouse-Geisser en los efectos sin esfericidad. ' : ''}Cada efecto intrasujeto tiene su propio término de error. η²<sub>G</sub> = eta cuadrado generalizado (comparable entre diseños).`));
    const phRows = []; [0, 1].forEach(fi => { const w = r.within(fi); w.pairs.forEach((o, q) => phRows.push([q === 0 ? esc(wNames[fi]) : '', `${o.a + 1} − ${o.b + 1}`, f(o.est), f(o.se), f(o.t), pv(o.padj)])); });
    sec.tables.push(apaTable('Comparaciones por pares de los efectos principales intrasujeto', ['Factor', 'Niveles', 'Diferencia', '<i>EE</i>', `<i>t</i>(${r.dfS})`, '<i>p</i> (Holm)'], phRows,
      `Medias marginales promediando el otro factor${gName ? ' y los grupos sin ponderar' : ''}; error propio de cada diferencia (como emmeans y JASP).`));
    const cellM = (a, b) => S.mean(Y.map(rw => rw[a * kw[1] + b])), ciM = (a, b) => S.meanCI(Y.map(rw => rw[a * kw[1] + b]));
    sec.charts.push(fig(`Interacción ${A} × ${B}: medias e IC 95 %`, CH.interaction(Array.from({ length: kw[0] }, (_, a) => `${A} ${a + 1}`), Array.from({ length: kw[1] }, (_, b) => ({ name: `${B} ${b + 1}`, means: Array.from({ length: kw[0] }, (_, a) => cellM(a, b)), ci: Array.from({ length: kw[0] }, (_, a) => ciM(a, b)) })), 'Puntuación'), CH.legend(Array.from({ length: kw[1] }, (_, b) => `${B} ${b + 1}`))));
    const stt = (t, e) => { const useGG = e.mauchly && e.mauchly.p < .05, eps = useGG ? e.gg : 1; return `<i>F</i>(${dfF(t.df * eps)}, ${dfF(e.dfE * eps)}) = ${f(t.F)}, ${pt(useGG ? t.pGG : t.p)}, η²<sub>p</sub> = ${nz(t.peta2.toFixed(3))}`; };
    let txt = `Se realizó una ANOVA de medidas repetidas ${kw[0]}×${kw[1]} con ${esc(A)} y ${esc(B)} como factores intrasujeto${gName ? ` y ${esc(gName)} como factor entre sujetos` : ''}${corr.length ? ' (corrección de Greenhouse-Geisser donde no se cumplía la esfericidad)' : ''}. `;
    txt += r.effects.map(e => `${e.factors.length > 1 ? `La interacción ${eName(e)}` : `El efecto principal de ${eName(e)}`} ${(e.mauchly && e.mauchly.p < .05 ? e.T.pGG : e.T.p) < .05 ? 'fue' : 'no fue'} estadísticamente significativ${e.factors.length > 1 ? 'a' : 'o'}, ${stt(e.T, e)}.` + (e.TG ? ` La interacción con ${esc(gName)} ${(e.mauchly && e.mauchly.p < .05 ? e.TG.pGG : e.TG.p) < .05 ? 'fue' : 'no fue'} significativa, ${stt(e.TG, e)}.` : '')).join(' ');
    if (r.B) txt += ` El efecto principal de ${esc(gName)} ${r.B.p < .05 ? 'fue' : 'no fue'} estadísticamente significativo, <i>F</i>(${r.B.df}, ${r.dfS}) = ${f(r.B.F)}, ${pt(r.B.p)}, η²<sub>p</sub> = ${nz(r.B.peta2.toFixed(3))}.`;
    sec.text.push(txt);
    sec.code = `# ANOVA de medidas repetidas ${A} × ${B}${gName ? ` × ${gName}` : ''}\nmedidas <- c(${cols.map(rq).join(', ')})\nd <- datos[complete.cases(datos[, c(medidas${gName ? ', ' + rq(gName) : ''})]), ]\nd$id <- factor(seq_len(nrow(d)))\n` +
      `largo <- data.frame(id = rep(d$id, ${K}), ${gName ? `grupo = factor(rep(d[[${rq(gName)}]], ${K})), ` : ''}A = factor(rep((seq_len(${K}) - 1) %/% ${kw[1]} + 1, each = nrow(d))), B = factor(rep((seq_len(${K}) - 1) %% ${kw[1]} + 1, each = nrow(d))), valor = unlist(d[, medidas], use.names = FALSE))\n` +
      `modelo <- afex::aov_ez("id", "valor", largo, within = c("A", "B")${gName ? ', between = "grupo"' : ''}, anova_table = list(correction = "${corr.length ? 'GG' : 'none'}", es = c("pes", "ges")))\nmodelo\nsummary(modelo)  # Mauchly y épsilon\npairs(emmeans::emmeans(modelo, ~ A), adjust = "holm")\npairs(emmeans::emmeans(modelo, ~ B), adjust = "holm")`;
    return sec;
  }

  // ANOVA mixta: k medidas de las mismas personas (intrasujeto) × un factor entre sujetos
  function runMixed(names, gName) {
    const k = names.length, cols = names.map(n => numOf(vByName(n))), cg = catOf(vByName(gName));
    const sec = { title: `${names.join(', ')} × ${gName} (ANOVA mixta)`, test: 'ANOVA mixta (SC tipo III)', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (names.includes(gName)) { sec.error = 'El factor entre sujetos no puede ser una de las medidas.'; return sec; }
    const idx = ST.rows.map((_, i) => i).filter(i => cg[i] !== null && cols.every(c => c[i] !== null));
    const lv = ordOf(vByName(gName), idx.map(i => cg[i])), G = lv.length;
    if (G < 2) { sec.error = `${gName} necesita al menos 2 grupos con datos completos.`; return sec; }
    const Y = idx.map(i => cols.map(c => c[i])), g = idx.map(i => lv.indexOf(cg[i])), n = Y.length, ng = lv.map((_, j) => g.filter(x => x === j).length);
    if (ng.some(c => c < 2)) { sec.error = 'Cada grupo necesita al menos 2 personas con todas las medidas.'; return sec; }
    if (n - G < k) { sec.error = `Hay pocos casos (${n}) para ${k} medidas y ${G} grupos.`; return sec; }
    const r = S.mixedAnova(Y, g, G); const L = list(names.map(esc));
    // supuestos
    const gm = S.mean(r.subjMeans), resid = Y.flatMap((row, i) => row.map((v, a) => v - r.cellMeans[g[i]][a] - r.subjMeans[i] + S.mean(r.cellMeans[g[i]])));
    void gm; const sw = S.shapiro(resid);
    sec.checks.push(sw && sw.p >= .05 ? chk('ok', `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}. Se cumple.`)
      : chk(n >= 30 ? 'info' : 'no', `Normalidad de los residuos (Shapiro-Wilk): ${sw ? `<i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}` : 'no calculable'}.${n >= 30 ? ' Con muestras de este tamaño el ANOVA es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña: interpreta con cautela.'}`));
    names.forEach((nm, a) => { const lev = S.levene(lv.map((_, j) => Y.filter((_, i) => g[i] === j).map(row => row[a])));
      sec.checks.push(chk(lev.p >= .05 ? 'ok' : 'no', `Homogeneidad de varianzas entre grupos en ${esc(nm)} (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.${lev.p >= .05 ? ' Se cumple.' : ' No se cumple: interpreta con cautela, sobre todo si los grupos tienen tamaños distintos.'}`)); });
    const sph = r.mauchly, sphOK = !sph || sph.p >= .05, eps = sphOK ? 1 : r.gg;
    if (sph) sec.checks.push(chk(sphOK ? 'ok' : 'no', `Esfericidad (Mauchly): <i>W</i> = ${nz(sph.W.toFixed(3))}, χ²(${sph.df}) = ${f(sph.chi)}, ${pt(sph.p)}. ${sphOK ? 'Se cumple.' : `No se cumple: se aplica la corrección de Greenhouse-Geisser (ε = ${nz(r.gg.toFixed(3))}; Huynh-Feldt ε = ${nz(r.hf.toFixed(3))}) a los efectos intrasujeto.`}`));
    sec.checks.push(chk(Math.max(...ng) === Math.min(...ng) ? 'ok' : 'info', `Tamaño de los grupos: ${lv.map((l, j) => `${esc(l)} = ${ng[j]}`).join(', ')}${Math.max(...ng) === Math.min(...ng) ? ' (equilibrado).' : ' (no equilibrado; se usan sumas de cuadrados de tipo III).'}`));
    sec.why.push(`Factor intrasujeto (medidas repetidas): ${L} → ${k} medidas de las mismas personas.`);
    sec.why.push(`Factor entre sujetos: ${esc(gName)} → ${G} grupos independientes (${list(lv.map(esc))}).`);
    sec.why.push(`La ANOVA mixta contrasta tres cosas: si las puntuaciones cambian entre medidas, si los grupos difieren en general y, sobre todo, si el cambio es distinto según el grupo (interacción). En un diseño pre/post con grupo control, la interacción es la prueba de que la intervención funciona.`);
    sec.decision = `Se ajustó una ANOVA mixta ${G}×${k} (${esc(gName)} × medida) con ${n} personas y sumas de cuadrados de tipo III${sphOK ? '' : '; como no se cumple la esfericidad, los efectos intrasujeto se corrigen con Greenhouse-Geisser'}.`;
    sec.alt = 'Si no se cumplen los supuestos con muestras pequeñas, un modelo lineal mixto o pruebas no paramétricas por separado (Friedman en cada grupo y Kruskal-Wallis en cada medida).';
    // descriptivos
    const desc = []; lv.forEach((l, j) => names.forEach((nm, a) => { const d = S.describe(Y.filter((_, i) => g[i] === j).map(row => row[a])); desc.push([a === 0 ? esc(l) : '', esc(nm), d.n, f(d.mean), f(d.sd)]); }));
    sec.tables.push(apaTable(`Estadísticos descriptivos por ${gName} y medida`, [esc(gName), 'Medida', '<i>n</i>', '<i>M</i>', '<i>DT</i>'], desc, ST.rows.length - n ? `Se excluyeron ${ST.rows.length - n} casos sin todas las medidas o sin grupo.` : ''));
    // tabla del ANOVA
    const P = e => (sphOK ? e.p : e.pGG), d1 = e => e.df1 * (sphOK ? 1 : r.gg), d2 = e => e.df2 * (sphOK ? 1 : r.gg);
    const row = (nm, e, within) => [nm, f(e.ss), dfF(within ? d1(e) : e.df1), f(e.ss / (within ? d1(e) : e.df1)), f(e.F), pv(within ? P(e) : e.p), nz(e.peta2.toFixed(3)), nz(e.ges.toFixed(3))];
    sec.tables.push(apaTable('Resultado de la ANOVA mixta', ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>', 'η²<sub>G</sub>'], [
      ['<i>Entre sujetos</i>', '', '', '', '', '', '', ''], row(esc(gName), r.B, false), ['Error', f(r.ssSe), r.dfSe, f(r.ssSe / r.dfSe), '', '', '', ''],
      ['<i>Intrasujeto</i>', '', '', '', '', '', '', ''], row('Medida', r.T, true), row(`Medida × ${esc(gName)}`, r.TG, true), ['Error', f(r.ssE), dfF(r.dfE * eps), f(r.ssE / (r.dfE * eps)), '', '', '', '']],
      `SC de tipo III. ${sphOK ? '' : 'Grados de libertad intrasujeto corregidos con Greenhouse-Geisser. '}η²<sub>p</sub> = eta cuadrado parcial; η²<sub>G</sub> = eta cuadrado generalizado.`));
    // comparaciones por pares entre medidas (promediando los grupos), con d_av
    const pooledVar = a => { let ss = 0; lv.forEach((_, j) => { const x = Y.filter((_, i) => g[i] === j).map(row => row[a]), m = S.mean(x); ss += S.sum(x.map(v => (v - m) ** 2)); }); return ss / r.dfSe; };
    r.within.forEach(o => { o.d = o.est / Math.sqrt((pooledVar(o.a) + pooledVar(o.b)) / 2); });
    if (P(r.T) < .05 && k > 2) sec.tables.push(apaTable('Comparaciones por pares entre medidas (promediando los grupos)', ['Comparación', 'Diferencia', '<i>EE</i>', `<i>t</i>(${r.dfSe})`, '<i>p</i> (Holm)', '<i>d</i>'],
      r.within.map(o => [`${esc(names[o.a])} − ${esc(names[o.b])}`, f(o.est), f(o.se), f(o.t), pv(o.padj), f(o.d)]),
      'Medias marginales sin ponderar por el tamaño de los grupos y error propio de cada diferencia (como emmeans y JASP). <i>d</i> = diferencia / raíz de la media de las dos varianzas intragrupo.'));
    let phB = null;
    if (r.B.p < .05 && G > 2) { const xs = lv.map((_, j) => r.subjMeans.filter((_, i) => g[i] === j)), msw = r.ssSe / k / r.dfSe;
      phB = S.hasTukey ? S.tukeyHSD(xs, msw, r.dfSe) : S.pairwiseHolm(xs, true); phB.forEach(c => { c.d = c.diff / Math.sqrt(msw); });
      sec.tables.push(apaTable(`Comparaciones entre grupos de ${gName} (${S.hasTukey ? 'Tukey' : 'Holm'}, media de las medidas)`, ['Comparación', 'Diferencia', '<i>p</i> ajustada', '<i>d</i>'], phB.map(c => [`${esc(lv[c.i])} − ${esc(lv[c.j])}`, f(c.diff), pv(c.padj), f(c.d)]))); }
    // efectos simples si hay interacción
    let simple = null;
    if (P(r.TG) < .05) {
      const atT = names.map((nm, a) => { const o = S.anova(lv.map((_, j) => Y.filter((_, i) => g[i] === j).map(row => row[a]))); return [`${esc(gName)} en ${esc(nm)}`, `<i>F</i>(${o.df1}, ${o.df2}) = ${f(o.F)}`, pv(o.p), nz(o.eta2.toFixed(3))]; });
      const inG = lv.map((l, j) => { const Yj = Y.filter((_, i) => g[i] === j); if (Yj.length < 3) return [`Medida en ${esc(l)}`, 'pocos casos', '', ''];
        const o = S.rmAnova(Yj), cor = o.mauchly && o.mauchly.p < .05, pp = cor ? o.pGG : o.p, e2 = cor ? o.gg : 1;
        return [`Medida en ${esc(l)}`, `<i>F</i>(${dfF(o.df1 * e2)}, ${dfF(o.df2 * e2)}) = ${f(o.F)}${cor ? ' (G-G)' : ''}`, pv(pp), nz(o.peta2.toFixed(3))]; });
      simple = atT.concat(inG);
      sec.tables.push(apaTable('Efectos simples', ['Efecto', 'Estadístico', '<i>p</i>', 'η²<sub>p</sub>'], simple,
        'Comparación de los grupos en cada medida (ANOVA de un factor) y cambio entre medidas dentro de cada grupo (ANOVA de medidas repetidas). Con varias pruebas, valora corregir el nivel de significación (por ejemplo, Bonferroni).'));
      sec.checks.push(chk('info', 'La interacción es significativa: interpreta los efectos simples (tabla y gráfico) antes que los efectos principales.'));
    }
    sec.charts.push(fig(`Interacción medida × ${gName}: medias e IC 95 %`, CH.interaction(names, lv.map((l, j) => ({ name: l, means: names.map((_, a) => r.cellMeans[j][a]), ci: names.map((_, a) => S.meanCI(Y.filter((_, i) => g[i] === j).map(row => row[a]))) })), 'Puntuación'), CH.legend(lv)));
    // redacción
    const st = (e, w) => `<i>F</i>(${dfF(w ? d1(e) : e.df1)}, ${dfF(w ? d2(e) : e.df2)}) = ${f(e.F)}, ${pt(w ? P(e) : e.p)}, η²<sub>p</sub> = ${nz(e.peta2.toFixed(3))}`;
    let t = `Se realizó una ANOVA mixta ${G}×${k} con ${esc(gName)} como factor entre sujetos y la medida (${L}) como factor intrasujeto${sphOK ? '' : ', con la corrección de Greenhouse-Geisser por no cumplirse la esfericidad'}. `;
    t += `La interacción medida × ${esc(gName)} ${P(r.TG) < .05 ? 'fue' : 'no fue'} estadísticamente significativa, ${st(r.TG, true)}${P(r.TG) < .05 ? ', lo que indica que el cambio entre medidas fue distinto según el grupo (véanse los efectos simples y la figura)' : ''}. `;
    t += `El efecto principal de la medida ${P(r.T) < .05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st(r.T, true)}. `;
    t += `El efecto principal de ${esc(gName)} ${r.B.p < .05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st(r.B, false)}.`;
    if (P(r.T) < .05 && k > 2) { const sig = r.within.filter(o => o.padj < .05);
      t += sig.length ? ` Las comparaciones por pares (corrección de Holm) mostraron diferencias entre ${list(sig.map(o => `${esc(names[o.a])} y ${esc(names[o.b])} (${pt(o.padj)}, <i>d</i> = ${f(Math.abs(o.d))})`))}.` : ' Las comparaciones por pares (corrección de Holm) no detectaron diferencias entre medidas concretas.'; }
    sec.text.push(t);
    const Q = names.map(rq).join(', ');
    sec.code = `# ANOVA mixta: ${names.join(', ')} × ${gName}\nmedidas <- c(${Q})\nd <- datos[complete.cases(datos[, c(medidas, ${rq(gName)})]), c(medidas, ${rq(gName)})]\nd$id <- factor(seq_len(nrow(d)))\n` +
      `largo <- data.frame(id = rep(d$id, ${k}), grupo = factor(rep(d[[${rq(gName)}]], ${k})), medida = factor(rep(medidas, each = nrow(d)), levels = medidas), valor = unlist(d[, medidas], use.names = FALSE))\n` +
      `modelo <- afex::aov_ez("id", "valor", largo, between = "grupo", within = "medida", type = 3, anova_table = list(correction = "${sphOK ? 'none' : 'GG'}", es = c("pes", "ges")))\nmodelo\nsummary(modelo)  # Mauchly, Greenhouse-Geisser y Huynh-Feldt\ncar::leveneTest(valor ~ grupo, data = subset(largo, medida == medidas[1]), center = mean)  # repetir para cada medida\n` +
      `pairs(emmeans::emmeans(modelo, ~ medida), adjust = "holm")\n` + (G > 2 ? `pairs(emmeans::emmeans(modelo, ~ grupo), adjust = "tukey")\n` : '') + `# Efectos simples\nemmeans::joint_tests(modelo, by = "medida")\nemmeans::joint_tests(modelo, by = "grupo")`;
    return sec;
  }
  function runRepeated(names) {
    const k = names.length, cols = names.map(n => numOf(vByName(n)));
    const sec = { title: `${names.join(', ')} (medidas repetidas)`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    const idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)), n = idx.length;
    if (n < 3) { sec.error = 'Se necesitan al menos 3 casos con todas las medidas.'; return sec; }
    const Y = idx.map(i => cols.map(c => c[i])), ds = names.map((_, j) => S.describe(Y.map(r => r[j])));
    if (Y.every(r => r.every(v => v === r[0]))) { sec.error = 'Todas las personas tienen el mismo valor en todos los momentos: no hay variación que analizar.'; return sec; }
    const lv = list(names.map(esc));
    // normalidad de los residuos del modelo de medidas repetidas (valor − media del sujeto − media del momento + media global)
    const gm = S.mean(Y.flat()), sm = Y.map(S.mean), resid = Y.flatMap((r, i) => r.map((v, j) => v - sm[i] - ds[j].mean + gm));
    const sw = S.shapiro(resid), normOK = n >= 30 || (sw && sw.p >= .05);
    sec.why.push(`Se comparan ${k} medidas de las mismas personas: ${lv}.`);
    sec.why.push('Al ser medidas relacionadas, el análisis separa la variabilidad entre personas de la debida a los momentos, lo que da más potencia que comparar grupos independientes.');
    const swT = sw ? `Shapiro-Wilk de los residuos: <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}` : 'Shapiro-Wilk no calculable';
    sec.checks.push(sw && sw.p >= .05 ? chk('ok', swT + '. Se cumple la normalidad.') : n >= 30 ? chk('info', swT + `. No es normal, pero con <i>n</i> = ${n} ≥ 30 el ANOVA es robusto.`) : chk('no', swT + '. No se cumple y la muestra es pequeña.'));
    sec.tables.push(apaTable('Estadísticos descriptivos de las medidas repetidas', ['Medida', '<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'IC 95 % (<i>M</i>)'],
      names.map((nm, j) => [esc(nm), n, f(ds[j].mean), f(ds[j].sd), f(ds[j].median), `[${f(ds[j].ci[0])}, ${f(ds[j].ci[1])}]`]), ST.rows.length - n ? `Se excluyeron ${ST.rows.length - n} casos sin todas las medidas.` : ''));
    sec.charts.push(fig(`${names.join(', ')}: medias e IC 95 %`, CH.meansCI(names.map((nm, j) => ({ name: nm, x: Y.map(r => r[j]), mean: ds[j].mean, ci: ds[j].ci })), 'Puntuación', { connect: true })));
    const pairs = []; for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) pairs.push([a, b]);
    const posthoc = (kind, test) => { const r = pairs.map(([a, b]) => ({ a, b, r: test(Y.map(x => x[a]), Y.map(x => x[b])) })), adj = S.holm(r.map(o => o.r.p));
      r.forEach((o, i) => o.padj = adj[i]); return r; };
    const phText = (ph, kind, med) => { const sig = ph.filter(o => o.padj < .05);
      if (!sig.length) return ` Las comparaciones por pares (${kind}) no detectaron diferencias significativas entre momentos concretos.`;
      return ` Las comparaciones por pares (${kind}) mostraron diferencias significativas entre ` + list(sig.map(o => { const da = ds[o.a], db = ds[o.b], up = med ? db.median > da.median : db.mean > da.mean;
        return `${esc(names[o.a])} y ${esc(names[o.b])} (${pt(o.padj)}; puntuaciones más ${up ? 'altas' : 'bajas'} en ${esc(names[o.b])})`; })) + (sig.length < ph.length ? '. El resto de comparaciones no fueron significativas.' : '.'); };
    const Q = names.map(rq).join(', ');
    let code = `# ${names.join(', ')} (medidas repetidas)\nmedidas <- c(${Q})\ndatos_mr <- datos[complete.cases(datos[, medidas]), medidas]\ndatos_mr$id <- factor(seq_len(nrow(datos_mr)))\n` +
      `largo <- data.frame(id = rep(datos_mr$id, ${k}), momento = factor(rep(medidas, each = nrow(datos_mr)), levels = medidas), valor = unlist(datos_mr[, medidas], use.names = FALSE))\n`;
    if (normOK) {
      const r = S.rmAnova(Y), sph = r.mauchly, sphOK = !sph || sph.p >= .05, eps = sphOK ? 1 : r.gg, P = sphOK ? r.p : r.pGG;
      const d1 = r.df1 * eps, d2 = r.df2 * eps;
      sec.test = 'ANOVA de medidas repetidas' + (sphOK ? '' : ' (corrección de Greenhouse-Geisser)');
      sec.why.push('La normalidad es aceptable (o n ≥ 30): se usa el ANOVA de medidas repetidas.');
      if (sph) sec.checks.push(chk(sphOK ? 'ok' : 'no', `Esfericidad (Mauchly): <i>W</i> = ${nz(sph.W.toFixed(3))}, χ²(${sph.df}) = ${f(sph.chi)}, ${pt(sph.p)}. ${sphOK ? 'Se cumple.' : `No se cumple: se aplica la corrección de Greenhouse-Geisser (ε = ${nz(r.gg.toFixed(3))}) a los grados de libertad.`}`));
      sec.decision = `Se eligió el ANOVA de medidas repetidas porque se comparan ${k} medidas de las mismas personas y la normalidad es aceptable${sph ? (sphOK ? ', con esfericidad' : '; como no se cumple la esfericidad, se corrigen los grados de libertad con Greenhouse-Geisser') : ''}.`;
      sec.alt = 'Prueba de Friedman si no se cumpliera la normalidad con muestras pequeñas.';
      sec.tables.push(apaTable('Resultado del ANOVA de medidas repetidas', ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>', 'η²<sub>G</sub>'],
        [['Momento', f(r.ssCond), dfF(d1), f(r.ssCond / d1), f(r.F), pv(P), nz(r.peta2.toFixed(3)), nz(r.ges.toFixed(3))], ['Error', f(r.ssErr), dfF(d2), f(r.ssErr / d2), '', '', '', '']],
        (sphOK ? '' : 'Grados de libertad corregidos con Greenhouse-Geisser. ') + 'η²<sub>p</sub> = eta cuadrado parcial; η²<sub>G</sub> = eta cuadrado generalizado.'));
      const fr = S.friedman(Y); sec.sens = `Análisis de sensibilidad: la prueba de Friedman da ${pt(fr.p)}, ${(fr.p < .05) === (P < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
      const st = `<i>F</i>(${dfF(d1)}, ${dfF(d2)}) = ${f(r.F)}, ${pt(P)}, η²<sub>p</sub> = ${nz(r.peta2.toFixed(3))}`;
      let t = `Se aplicó un ANOVA de medidas repetidas para comparar ${lv} (${names.map((nm, j) => `${esc(nm)}: <i>M</i> = ${f(ds[j].mean)}, <i>DT</i> = ${f(ds[j].sd)}`).join('; ')})${sphOK ? '' : ', con la corrección de Greenhouse-Geisser por no cumplirse la esfericidad'}. `;
      if (P < .05) {
        const ph = posthoc('t relacionadas', S.tTestPaired);
        t += `Se encontraron diferencias estadísticamente significativas entre los momentos, ${st}.` + phText(ph, '<i>t</i> relacionadas con corrección de Holm', false);
        sec.tables.push(apaTable('Comparaciones por pares (t relacionadas, corrección de Holm)', ['Comparación', 'Diferencia de medias', '<i>t</i>', '<i>gl</i>', '<i>p</i> ajustada'],
          ph.map(o => [`${esc(names[o.b])} − ${esc(names[o.a])}`, f(o.r.diff), f(o.r.t), o.r.df, pv(o.padj)])));
      } else t += `No se encontraron diferencias estadísticamente significativas entre los momentos, ${st}.`;
      sec.text.push(t);
      code += `rstatix::anova_test(largo, dv = valor, wid = id, within = momento, effect.size = "pes")  # incluye Mauchly y Greenhouse-Geisser\nrstatix::pairwise_t_test(largo, valor ~ momento, paired = TRUE, p.adjust.method = "holm")`;
    } else {
      const r = S.friedman(Y); sec.test = 'Prueba de Friedman';
      sec.why.push('La normalidad no se cumple y la muestra es pequeña: se usa la prueba de Friedman, que trabaja con rangos dentro de cada persona.');
      sec.decision = `Se eligió la prueba de Friedman porque se comparan ${k} medidas de las mismas personas y no se cumple la normalidad.`;
      sec.alt = 'ANOVA de medidas repetidas si los datos fueran aproximadamente normales.';
      sec.tables.push(apaTable('Resultado de la prueba de Friedman', ['', 'χ²', '<i>gl</i>', '<i>p</i>', '<i>W</i> de Kendall', '<i>n</i>'], [[lv, f(r.Q), r.df, pv(r.p), nz(r.W.toFixed(3)), n]],
        'Rangos promedio: ' + names.map((nm, j) => `${esc(nm)} = ${f(r.meanRanks[j])}`).join('; ') + '. <i>W</i> de Kendall como tamaño del efecto.'));
      const a = S.rmAnova(Y), aP = a.mauchly && a.mauchly.p < .05 ? a.pGG : a.p;
      sec.sens = `Análisis de sensibilidad: el ANOVA de medidas repetidas da ${pt(aP)}, ${(aP < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
      const st = `χ²(${r.df}) = ${f(r.Q)}, ${pt(r.p)}, <i>W</i> = ${nz(r.W.toFixed(2))}`;
      let t = `Dado que no se cumplía el supuesto de normalidad, se aplicó la prueba de Friedman para comparar ${lv} (${names.map((nm, j) => `${esc(nm)}: <i>Mdn</i> = ${f(ds[j].median)}`).join('; ')}). `;
      if (r.p < .05) {
        const ph = posthoc('Wilcoxon', S.wilcoxonSigned);
        t += `Se encontraron diferencias estadísticamente significativas, ${st}.` + phText(ph, 'Wilcoxon con corrección de Holm', true);
        sec.tables.push(apaTable('Comparaciones por pares (Wilcoxon, corrección de Holm)', ['Comparación', '<i>z</i>', '<i>p</i> ajustada'],
          ph.map(o => [`${esc(names[o.b])} − ${esc(names[o.a])}`, f(o.r.z), pv(o.padj)])));
      } else t += `No se encontraron diferencias estadísticamente significativas, ${st}.`;
      sec.text.push(t);
      code += `friedman.test(as.matrix(datos_mr[, medidas]))\nrstatix::friedman_effsize(largo, valor ~ momento | id)\nrstatix::pairwise_wilcox_test(largo, valor ~ momento, paired = TRUE, p.adjust.method = "holm")  # p exacta sin empates ni ceros y n < 50, como Tharp`;
    }
    sec.code = code; return sec;
  }

  function runChi(aName, bName, sName = '') {
    const sec = { title: `Asociación entre ${aName} y ${bName}`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (aName === bName) { sec.error = 'Elige dos variables distintas.'; return sec; }
    const ca = catOf(vByName(aName)), cb = catOf(vByName(bName)), keep = ca.map((v, i) => v !== null && cb[i] !== null);
    const la = ordOf(vByName(aName), ca.filter((v, i) => keep[i])), lb = ordOf(vByName(bName), cb.filter((v, i) => keep[i]));
    if (la.length < 2 || lb.length < 2) { sec.error = 'Cada variable necesita al menos 2 categorías con datos.'; return sec; }
    const tab = la.map(() => lb.map(() => 0)); ca.forEach((v, i) => { if (keep[i]) tab[la.indexOf(v)][lb.indexOf(cb[i])]++; });
    const r = S.chiSquare(tab), is2x2 = la.length === 2 && lb.length === 2, A = rn(aName), B = rn(bName);
    const useFisher = is2x2 && r.minE < 5, fisher = is2x2 ? S.fisher2x2(tab[0][0], tab[0][1], tab[1][0], tab[1][1]) : null;
    sec.test = useFisher ? 'Prueba exacta de Fisher' : 'Chi-cuadrado de independencia';
    sec.why.push(`Las dos variables son categóricas: ${esc(aName)} (${la.length} categorías) y ${esc(bName)} (${lb.length} categorías).`);
    sec.why.push('Se quiere saber si la distribución de una variable depende de la otra (asociación), comparando frecuencias observadas y esperadas.');
    sec.why.push('El tamaño de la asociación se expresa con la V de Cramér (0 = ninguna, 1 = perfecta).');
    const pct = (r.pctSmall * 100).toFixed(0);
    if (r.pctSmall <= .2 && r.minE >= 1) sec.checks.push(chk('ok', `Frecuencias esperadas: ${pct} % de las casillas con valor esperado < 5 (mínimo ${f(r.minE)}). Se cumple el criterio (≤ 20 % y ninguna < 1).`));
    else sec.checks.push(chk('no', `Frecuencias esperadas: ${pct} % de las casillas con valor esperado < 5 (mínimo ${f(r.minE)}). No se cumple el criterio (≤ 20 % y ninguna < 1).`));
    sec.checks.push(chk('info', 'Independencia: cada participante debe aparecer en una sola casilla de la tabla.'));
    if (useFisher) { sec.why.push('En una tabla 2×2 con alguna frecuencia esperada < 5, la aproximación chi-cuadrado no es fiable: se usa la prueba exacta de Fisher.'); sec.decision = 'Se eligió la prueba exacta de Fisher porque la tabla es 2×2 y hay frecuencias esperadas menores que 5.'; }
    else sec.decision = 'Se eligió la prueba chi-cuadrado de independencia porque ambas variables son categóricas' + (r.pctSmall <= .2 ? ' y las frecuencias esperadas son suficientes.' : ', aunque hay frecuencias esperadas bajas (ver aviso).');
    const lowE = !is2x2 && (r.pctSmall > .2 || r.minE < 1), ffh = lowE ? S.fisherRxC(tab) : null;
    if (lowE && !ffh) sec.warn = 'Hay demasiadas casillas con frecuencias esperadas bajas y la tabla es demasiado grande para la prueba exacta: el chi-cuadrado puede no ser fiable. Agrupa categorías con pocos casos (en «Preparar los datos»).';
    if (ffh) { sec.why.push(`Hay frecuencias esperadas bajas, así que se usa la prueba exacta de Fisher-Freeman-Halton (extensión de Fisher a tablas ${la.length}×${lb.length}), calculada sobre las ${ffh.tables.toLocaleString('es-ES')} tablas posibles con los mismos totales.`); sec.test = 'Prueba exacta de Fisher-Freeman-Halton'; sec.decision = 'Se eligió la prueba exacta de Fisher-Freeman-Halton porque la tabla tiene frecuencias esperadas bajas.'; }
    sec.alt = is2x2 ? 'Prueba exacta de Fisher cuando hay frecuencias esperadas bajas.' : 'Agrupar categorías poco frecuentes si las frecuencias esperadas son bajas.';
    const rows = la.map((l, i) => [esc(l)].concat(lb.map((_, j) => { const a = r.adj[i][j]; const mark = a > 1.96 ? ' ▲' : a < -1.96 ? ' ▼' : '';
      return `${tab[i][j]} (${f(tab[i][j] / r.rs[i] * 100, 1)} %)${mark}`; })).concat([String(r.rs[i])]));
    rows.push(['Total'].concat(lb.map((_, j) => `${r.cs[j]} (${f(r.cs[j] / r.N * 100, 1)} %)`)).concat([String(r.N)]));
    sec.tables.push(apaTable(`Tabla de contingencia de ${aName} y ${bName}`, [esc(aName)].concat(lb.map(esc)).concat(['Total']), rows,
      'Recuentos y porcentaje dentro de cada fila. ▲/▼: residuo tipificado corregido > 1.96 / < −1.96 (más / menos casos de los esperados).'));
    sec.tables.push(apaTable(`Frecuencias esperadas y residuos tipificados corregidos`, [esc(aName)].concat(lb.map(esc)), la.map((l, i) => [esc(l)].concat(lb.map((_, j) => `${f(r.E[i][j], 1)} · ${f(r.adj[i][j])}`))),
      'En cada casilla: frecuencia esperada si no hubiera asociación · residuo tipificado corregido (|valor| > 1.96 indica una diferencia significativa en esa casilla).'));
    const tr = [['χ² de Pearson', f(r.chi), r.df, pv(r.p)], ['Razón de verosimilitudes (<i>G</i>²)', f(r.G2), r.df, pv(r.pG2)]];
    if (is2x2) { tr.push(['χ² con corrección de Yates', f(r.yates.chi), 1, pv(r.yates.p)]); tr.push(['Prueba exacta de Fisher', '', '', pv(fisher.p)]); }
    if (ffh) tr.push(['Prueba exacta de Fisher-Freeman-Halton', '', '', pv(ffh.p)]);
    sec.tables.push(apaTable('Resultado de las pruebas de independencia', ['Prueba', 'Valor', '<i>gl</i>', '<i>p</i>'], tr,
      `<i>N</i> = ${r.N}. Tamaño de la asociación: <i>V</i> de Cramér = ${nz(r.V.toFixed(3))}${is2x2 ? `, φ = ${nz(r.phi.toFixed(3))}` : ''}, coeficiente de contingencia = ${nz(r.Ccont.toFixed(3))}. ${useFisher ? 'Se interpreta la prueba exacta de Fisher (frecuencias esperadas bajas).' : 'Se interpreta el χ² de Pearson.'}`));
    let rk = null;
    if (is2x2) { rk = S.risk2x2(tab); const ci = c => `[${f(c[0])}, ${f(c[1])}]`;
      sec.tables.push(apaTable('Estimación del riesgo (tabla 2×2)', ['Medida', 'Valor', 'IC 95 %'], [
        [`Odds ratio (${esc(la[0])} / ${esc(la[1])})`, f(rk.or), ci(rk.orCI)],
        [`Riesgo relativo de «${esc(lb[0])}» (${esc(la[0])} frente a ${esc(la[1])})`, f(rk.rr1), ci(rk.rr1CI)],
        [`Riesgo relativo de «${esc(lb[1])}» (${esc(la[0])} frente a ${esc(la[1])})`, f(rk.rr2), ci(rk.rr2CI)]],
        `Odds ratio = (a·d)/(b·c), con la primera fila y la primera columna como referencia de la tabla; IC por el método logarítmico (Woolf y Katz), como SPSS y JASP.${rk.haldane ? ' Como alguna casilla vale 0, se sumó 0.5 a todas (corrección de Haldane-Anscombe).' : ''} Un IC que no incluye el 1 indica asociación significativa.`));
      sec.why.push('En una tabla 2×2 se calculan además la odds ratio y el riesgo relativo, que expresan la magnitud de la asociación de forma interpretable (cuántas veces más probable).'); }
    const P = useFisher ? fisher.p : ffh ? ffh.p : r.p;
    const st = useFisher ? `prueba exacta de Fisher, ${pt(fisher.p)}, <i>V</i> = ${nz(r.V.toFixed(2))}` : ffh ? `prueba exacta de Fisher-Freeman-Halton, ${pt(ffh.p)}, <i>V</i> = ${nz(r.V.toFixed(2))}` : `χ²(${r.df}, <i>N</i> = ${r.N}) = ${f(r.chi)}, ${pt(r.p)}, <i>V</i> = ${nz(r.V.toFixed(2))}`;
    const va = vByName(aName), vb = vByName(bName), isOrd = v => !!v.order || levelsOf(v).every(l => toNum(l) !== null);
    let oa = null;
    if (isOrd(va) && isOrd(vb) && !is2x2) { oa = S.ordinalAssoc(tab);
      const or_ = (k, lab) => [lab, f(oa[k].est, 3), f(oa[k].ase, 3), `[${f(oa[k].ci[0], 3)}, ${f(oa[k].ci[1], 3)}]`, f(oa[k].z), pv(oa[k].p)];
      sec.tables.push(apaTable('Medidas de asociación ordinal', ['Medida', 'Valor', '<i>EE</i> asint.', 'IC 95 %', '<i>z</i>', '<i>p</i>'],
        [or_('gamma', 'Gamma de Goodman y Kruskal'), or_('taub', 'Tau-b de Kendall'), or_('tauc', 'Tau-c de Stuart'), or_('somersCR', `d de Somers (${esc(bName)} dependiente)`), or_('somersRC', `d de Somers (${esc(aName)} dependiente)`)],
        `Las dos variables son ordinales (orden: ${esc(aName)} = ${levelsOf(va).map(esc).join(' < ')}; ${esc(bName)} = ${levelsOf(vb).map(esc).join(' < ')}). Valores positivos: a más ${esc(aName)}, más ${esc(bName)}. Errores típicos asintóticos y contrastes como en SPSS.`));
      sec.why.push('Como las dos variables tienen un orden, se añaden medidas de asociación ordinal (gamma, tau-b, tau-c y d de Somers), que indican la dirección de la relación, algo que la V de Cramér no recoge.'); }
    let mh = null;
    if (sName && sName !== aName && sName !== bName && is2x2) { const cs_ = catOf(vByName(sName)), ls = ordOf(vByName(sName), cs_.filter((v, i) => keep[i] && v !== null));
      const strata = ls.map(sv => { const t2 = [[0, 0], [0, 0]]; ca.forEach((v, i) => { if (keep[i] && cs_[i] === sv) t2[la.indexOf(v)][lb.indexOf(cb[i])]++; }); return { sv, t2 }; }).filter(o => o.t2.flat().reduce((x, y) => x + y, 0) > 1);
      if (strata.length >= 2) { mh = S.mantelHaenszel(strata.map(o => o.t2));
        sec.tables.push(apaTable(`Análisis estratificado por ${sName} (Mantel-Haenszel)`, ['Estrato', '<i>n</i>', 'Odds ratio'], strata.map(o => { const [[a_, b_], [c_, d_]] = o.t2, rk_ = S.risk2x2(o.t2); return [esc(o.sv), a_ + b_ + c_ + d_, f(rk_.or)]; }).concat([['<b>Común (Mantel-Haenszel)</b>', '', `${f(mh.or)} [${f(mh.ci[0])}, ${f(mh.ci[1])}]`]]),
          `χ² de Mantel-Haenszel (con corrección de continuidad) = ${f(mh.chi)}, <i>gl</i> = 1, ${pt(mh.p)}: contrasta la asociación controlando ${esc(sName)}. Homogeneidad de las odds ratio entre estratos (Breslow-Day con corrección de Tarone): χ²(${mh.bd.df}) = ${f(mh.bd.chi)}, ${pt(mh.bd.p)}. IC de la OR común de Robins, Breslow y Greenland.`));
        sec.checks.push(chk(mh.bd.p >= .05 ? 'ok' : 'no', `Homogeneidad de las odds ratio entre los estratos de ${esc(sName)} (Breslow-Day): ${pt(mh.bd.p)}.${mh.bd.p >= .05 ? ' Se cumple: la OR común resume bien la asociación.' : ' No se cumple: la asociación cambia según el estrato; interpreta cada estrato por separado.'}`)); }
      else sec.checks.push(chk('info', `No hay al menos dos estratos de ${esc(sName)} con datos: no se realiza el análisis estratificado.`)); }
    else if (sName && !is2x2) sec.checks.push(chk('info', 'El análisis estratificado de Mantel-Haenszel solo está disponible para tablas 2×2.'));
    let t = P < .05 ? `Se encontró una asociación estadísticamente significativa entre ${esc(aName)} y ${esc(bName)}, ${st}.` : `No se encontró una asociación estadísticamente significativa entre ${esc(aName)} y ${esc(bName)}, ${st}.`;
    if (P < .05) { const hi = []; la.forEach((l, i) => lb.forEach((m, j) => { if (r.adj[i][j] > 1.96) hi.push(`${esc(m)} en el grupo ${esc(l)} (${f(tab[i][j] / r.rs[i] * 100, 1)} %)`); }));
      if (hi.length) t += ` En concreto, hubo más casos de los esperados de ${list(hi.slice(0, 4))}.`; }
    if (rk) t += ` La odds ratio fue ${f(rk.or)}, IC 95 % [${f(rk.orCI[0])}, ${f(rk.orCI[1])}]: la odds de «${esc(lb[0])}» en ${esc(la[0])} fue ${f(rk.or)} veces la de ${esc(la[1])}.`;
    if (oa) t += ` La asociación ordinal fue ${oa.taub.est > 0 ? 'positiva' : 'negativa'}, τ<sub>b</sub> = ${nz(oa.taub.est.toFixed(2))}, ${pt(oa.taub.p)}.`;
    if (mh) t += ` Controlando ${esc(sName)}, la odds ratio común de Mantel-Haenszel fue ${f(mh.or)}, IC 95 % [${f(mh.ci[0])}, ${f(mh.ci[1])}], χ²<sub>MH</sub>(1) = ${f(mh.chi)}, ${pt(mh.p)}.`;
    sec.text.push(t);
    if (lb.length <= 8) sec.charts.push(fig(`${bName} dentro de cada grupo de ${aName}`, CH.groupedBars(la, lb, tab.map((row, i) => row.map(c => c / r.rs[i] * 100))), CH.legend(lb)));
    sec.code = `# Asociación entre ${aName} y ${bName}\ntabla <- table(datos$${A}, datos$${B})\nprop.table(tabla, 1) * 100\nchisq.test(tabla, correct = FALSE)\nchisq.test(tabla, correct = FALSE)$expected\nchisq.test(tabla, correct = FALSE)$stdres\nDescTools::GTest(tabla)  # razón de verosimilitudes\nDescTools::CramerV(tabla); DescTools::ContCoef(tabla)` + (is2x2 ? '\nchisq.test(tabla, correct = TRUE)  # Yates\nfisher.test(tabla)\nDescTools::Phi(tabla)\nDescTools::OddsRatio(tabla, method = "wald")\nDescTools::RelRisk(tabla, method = "wald"); DescTools::RelRisk(tabla[, 2:1], method = "wald")' : '');
    if (ffh) sec.code += '\nfisher.test(tabla)  # Fisher-Freeman-Halton (exacta R×C)';
    if (oa) sec.code += '\nDescTools::GoodmanKruskalGamma(tabla, conf.level = .95)\nDescTools::KendallTauB(tabla, conf.level = .95)\nDescTools::StuartTauC(tabla, conf.level = .95)\nDescTools::SomersDelta(tabla, direction = "column", conf.level = .95)';
    if (mh) sec.code += `\n# Mantel-Haenszel estratificado por ${sName}\nt3 <- table(datos$${rn(aName)}, datos$${rn(bName)}, datos$${rn(sName)})\nmantelhaen.test(t3)\nDescTools::BreslowDayTest(t3, correct = TRUE)`;
    return sec;
  }

  // Proporciones: binomial exacta (2 categorías) o χ² de bondad de ajuste (3 o más)
  function runProp(name, p0, alt, probsTxt) {
    const v = vByName(name), x = catOf(v).filter(q => q !== null), lv = levelsOf(v), counts = lv.map(l => x.filter(q => q === l).length), N = x.length;
    const sec = { title: `Proporciones de ${name}`, why: [], checks: [], tables: [], charts: [], text: [], code: '' }, X = rn(name);
    if (lv.length < 2 || N < 1) { sec.error = 'La variable necesita al menos 2 categorías con datos.'; return sec; }
    if (lv.length === 2) {
      if (!(p0 > 0 && p0 < 1)) { sec.error = 'La proporción esperada debe estar entre 0 y 1 (por ejemplo, 0.5).'; return sec; }
      const r = S.binomTest(counts[1], N, p0, alt), one = alt !== 'two', rAlt = { two: 'two.sided', greater: 'greater', less: 'less' }[alt];
      sec.test = 'Prueba binomial exacta' + (one ? ' (unilateral)' : '');
      sec.why.push(`${esc(name)} tiene 2 categorías: se contrasta si la proporción de «${esc(lv[1])}» difiere de la esperada (${fmtNum(p0)}) con la prueba binomial exacta, válida con cualquier tamaño de muestra.`);
      sec.decision = `Se eligió la prueba binomial exacta para comparar la proporción observada de «${esc(lv[1])}» con ${fmtNum(p0)}.`;
      sec.alt = 'Con muestras grandes, la aproximación normal da prácticamente el mismo resultado.';
      sec.tables.push(apaTable(`Prueba binomial de ${name}`, ['Categoría', '<i>n</i>', 'Total', 'Proporción', 'Esperada', '<i>p</i>' + (one ? ' (unilateral)' : ''), 'IC 95 % (proporción)'],
        [[esc(lv[1]), counts[1], N, nz(r.prop.toFixed(3)), fmtNum(p0), pv(r.p), `[${nz(r.ci[0].toFixed(3))}, ${nz(r.ci[1].toFixed(3))}]`]], 'IC exacto de Clopper-Pearson.'));
      sec.text.push(`Se aplicó una prueba binomial exacta${one ? ' unilateral' : ''} para comparar la proporción de «${esc(lv[1])}» en ${esc(name)} (${counts[1]} de ${N}, ${f(r.prop * 100, 1)} %, IC 95 % [${f(r.ci[0] * 100, 1)}, ${f(r.ci[1] * 100, 1)}] %) con el valor esperado de ${f(p0 * 100, 1)} %. ` +
        (r.p < .05 ? `La proporción observada fue significativamente ${r.prop > p0 ? 'mayor' : 'menor'} que la esperada, ${pt(r.p)}.` : `No difirió significativamente de la esperada, ${pt(r.p)}.`));
      sec.code = `# Proporción de «${lv[1]}» en ${name}\nbinom.test(sum(datos$${X} == ${rq(lv[1])}, na.rm = TRUE), sum(!is.na(datos$${X})), p = ${p0}${one ? `, alternative = "${rAlt}"` : ''})`;
      return sec;
    }
    let probs = null;
    if (probsTxt) { probs = (/[;\s]/.test(probsTxt) ? probsTxt.split(/[;\s]+/) : probsTxt.split(',')).map(q => parseFloat(q.replace(',', '.'))).filter(q => isFinite(q));
      if (probs.length !== lv.length || probs.some(q => q <= 0)) { sec.error = `Escribe ${lv.length} proporciones positivas separadas por comas o espacios, en el orden de las categorías (${list(lv.map(esc))}).`; return sec; } }
    const r = S.chiGOF(counts, probs); sec.test = 'χ² de bondad de ajuste';
    sec.why.push(`${esc(name)} tiene ${lv.length} categorías: se contrasta si las frecuencias observadas se ajustan a ${probs ? 'las proporciones indicadas' : 'una distribución uniforme (todas las categorías igual de frecuentes)'}.`);
    sec.decision = `Se eligió la χ² de bondad de ajuste para comparar las frecuencias de ${esc(name)} con ${probs ? 'las proporciones esperadas indicadas' : 'proporciones iguales'}.`;
    sec.checks.push(chk(r.minE >= 5 ? 'ok' : 'no', `Frecuencias esperadas: mínimo ${f(r.minE, 1)}. ${r.minE >= 5 ? 'Todas ≥ 5: se cumple el criterio.' : 'Alguna < 5: la aproximación χ² puede no ser fiable; valora agrupar categorías.'}`));
    sec.tables.push(apaTable(`Frecuencias observadas y esperadas de ${name}`, ['Categoría', 'Observadas', '%', 'Proporción esperada', 'Esperadas', 'Residuo tipificado'],
      lv.map((l, i) => [esc(l), counts[i], f(counts[i] / N * 100, 1), nz(r.probs[i].toFixed(3)), f(r.E[i], 1), f(r.resid[i])]).concat([['Total', N, '100.0', '', '', '']])));
    sec.tables.push(apaTable('Resultado de la χ² de bondad de ajuste', ['χ²', '<i>gl</i>', '<i>p</i>', '<i>w</i> de Cohen', '<i>N</i>'], [[f(r.chi), r.df, pv(r.p), nz(r.w.toFixed(3)), N]], '<i>w</i> = √(χ²/<i>N</i>): 0.10 pequeño, 0.30 mediano, 0.50 grande.'));
    sec.text.push(`Se aplicó una prueba χ² de bondad de ajuste para comparar las frecuencias de ${esc(name)} con ${probs ? 'las proporciones esperadas' : 'una distribución uniforme'}. ` + (r.p < .05
      ? `Las frecuencias observadas difirieron significativamente de las esperadas, χ²(${r.df}, <i>N</i> = ${N}) = ${f(r.chi)}, ${pt(r.p)}, <i>w</i> = ${nz(r.w.toFixed(2))}.`
      : `Las frecuencias observadas no difirieron significativamente de las esperadas, χ²(${r.df}, <i>N</i> = ${N}) = ${f(r.chi)}, ${pt(r.p)}.`));
    sec.code = `# Bondad de ajuste de ${name}\nobs <- table(factor(datos$${X}, levels = c(${lv.map(rq).join(', ')})))\nchisq.test(obs${probs ? `, p = c(${r.probs.map(q => +q.toFixed(6)).join(', ')})` : ''})`;
    return sec;
  }

  // Acuerdo entre jueces: CCI (cuantitativas) o kappa (categóricas)
  function runAgree(names, opts) {
    const sec = { title: 'Acuerdo entre jueces', why: [], checks: [], tables: [], charts: [], text: [], code: '' }, vs = names.map(vByName);
    if (vs.length < 2) { sec.error = 'Selecciona al menos dos variables: una por juez o por aplicación.'; return sec; }
    const types = [...new Set(vs.map(v => v.type))];
    if (types.length > 1) { sec.error = 'Las variables deben ser todas cuantitativas (CCI) o todas categóricas (kappa).'; return sec; }
    const Q = `c(${names.map(rq).join(', ')})`;
    if (types[0] === 'num') {
      const cols = vs.map(numOf), idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)), Y = idx.map(i => cols.map(c => c[i]));
      if (Y.length < 3) { sec.error = 'Se necesitan al menos 3 casos con todas las puntuaciones.'; return sec; }
      const r = S.icc(Y), key = opts.model + (opts.unit === 'average' ? 'k' : ''), sel = r.forms.find(q => q.type === key);
      const MW = { ICC1: 'Un factor, aleatorios, medida única', ICC1k: 'Un factor, aleatorios, promedio', ICC2: 'Dos factores, aleatorios, acuerdo absoluto, medida única', ICC2k: 'Dos factores, aleatorios, acuerdo absoluto, promedio', ICC3: 'Dos factores, mixtos, consistencia, medida única', ICC3k: 'Dos factores, mixtos, consistencia, promedio' };
      const lvl = v => v < .5 ? 'pobre' : v < .75 ? 'moderada' : v < .9 ? 'buena' : 'excelente';
      sec.test = `Coeficiente de correlación intraclase (${key})`;
      sec.why.push(`${vs.length} jueces o aplicaciones cuantitativas (${list(names.map(esc))}) sobre ${Y.length} sujetos: el CCI mide qué parte de la variabilidad se debe a diferencias reales entre sujetos y no a desacuerdos entre jueces.`);
      sec.why.push(`Se interpreta el ${MW[key]} (${key}; McGraw y Wong, 1996). ${opts.model === 'ICC2' ? 'Es la forma recomendada para fiabilidad entre jueces y test-retest cuando se quiere generalizar a otros jueces o momentos (Koo y Li, 2016).' : opts.model === 'ICC3' ? 'Solo valora la consistencia (que ordenen igual a los sujetos), no que den exactamente la misma puntuación.' : 'Adecuado cuando cada sujeto es evaluado por jueces distintos.'}`);
      sec.decision = `Se calculó el CCI ${MW[key].toLowerCase()} con ${Y.length} sujetos y ${vs.length} jueces o aplicaciones.`;
      sec.checks.push(chk('info', 'Interpretación (Koo y Li, 2016): < .50 pobre, .50–.75 moderada, .75–.90 buena, > .90 excelente; conviene basarla en el intervalo de confianza.'));
      if (ST.rows.length - Y.length) sec.checks.push(chk('info', `Se excluyeron ${ST.rows.length - Y.length} casos sin todas las puntuaciones.`));
      sec.tables.push(apaTable('Coeficientes de correlación intraclase', ['Forma', 'Modelo', 'CCI', 'IC 95 %', '<i>F</i>', '<i>gl</i><sub>1</sub>', '<i>gl</i><sub>2</sub>', '<i>p</i>'],
        r.forms.map(q => [(q.type === key ? '<b>' : '') + q.type + (q.type === key ? '</b>' : ''), MW[q.type], nz(q.icc.toFixed(3)), `[${nz(q.ci[0].toFixed(3))}, ${nz(q.ci[1].toFixed(3))}]`, f(q.F), q.df1, q.df2, pv(q.p)]),
        `En negrita, la forma elegida. Nomenclatura de Shrout y Fleiss (1979); modelos e IC de McGraw y Wong (1996). <i>F</i> contrasta CCI = 0.`));
      sec.text.push(`Se calculó el coeficiente de correlación intraclase (${MW[key].toLowerCase()}) para evaluar el acuerdo entre ${list(names.map(esc))} en ${Y.length} sujetos. El CCI fue ${nz(sel.icc.toFixed(2))}, IC 95 % [${nz(sel.ci[0].toFixed(2))}, ${nz(sel.ci[1].toFixed(2))}], <i>F</i>(${sel.df1}, ${sel.df2}) = ${f(sel.F)}, ${pt(sel.p)}, lo que indica una fiabilidad ${lvl(sel.icc)} según los criterios de Koo y Li (2016).`);
      sec.code = `# Coeficiente de correlación intraclase\nd <- na.omit(datos[, ${Q}])\nirr::icc(d, model = "${opts.model === 'ICC1' ? 'oneway' : 'twoway'}", type = "${opts.model === 'ICC3' ? 'consistency' : 'agreement'}", unit = "${opts.unit}")\npsych::ICC(d)  # las 6 formas`;
      return sec;
    }
    const cols = vs.map(catOf), idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)), R = idx.map(i => cols.map(c => c[i]));
    if (R.length < 3) { sec.error = 'Se necesitan al menos 3 casos valorados por todos los jueces.'; return sec; }
    const lv = ordOf(vs.find(v => v.order) || vs[0], R.flat());
    if (vs.length === 2) {
      const w = opts.weight, r = S.cohenKappa(R.map(x => x[0]), R.map(x => x[1]), lv, w), wn = { none: '', linear: ' ponderada lineal', quadratic: ' ponderada cuadrática' }[w];
      const lk = v => v < 0 ? 'peor que el azar' : v <= .2 ? 'leve' : v <= .4 ? 'aceptable' : v <= .6 ? 'moderado' : v <= .8 ? 'considerable' : 'casi perfecto';
      sec.test = `Kappa de Cohen${wn}`;
      sec.why.push(`Dos jueces asignan categorías (${list(lv.map(esc))}) a los mismos ${R.length} casos: la kappa de Cohen mide el acuerdo corrigiendo el que se esperaría por azar.`);
      if (w !== 'none') sec.why.push(`Kappa ponderada (${w === 'linear' ? 'lineal' : 'cuadrática'}): los desacuerdos entre categorías cercanas penalizan menos que entre categorías lejanas; adecuada si las categorías están ordenadas (orden usado: ${list(lv.map(esc))}).`);
      sec.decision = `Se calculó la kappa de Cohen${wn} entre ${esc(names[0])} y ${esc(names[1])} con ${R.length} casos.`;
      sec.checks.push(chk('info', 'Interpretación (Landis y Koch, 1977): ≤ .20 leve, .21–.40 aceptable, .41–.60 moderado, .61–.80 considerable, > .80 casi perfecto.'));
      const tab = lv.map(a => lv.map(b => R.filter(x => x[0] === a && x[1] === b).length));
      sec.tables.push(apaTable(`Tabla de acuerdo entre ${names[0]} (filas) y ${names[1]} (columnas)`, [''].concat(lv.map(esc)), lv.map((a, i) => [esc(a)].concat(tab[i].map((c, j) => (i === j ? `<b>${c}</b>` : String(c))))), 'En negrita, los acuerdos.'));
      sec.tables.push(apaTable(`Kappa de Cohen${wn}`, ['κ', '<i>EE</i>', 'IC 95 %', '<i>z</i>', '<i>p</i>', 'Acuerdo observado', 'Acuerdo esperado', '<i>n</i>'],
        [[nz(r.kappa.toFixed(3)), nz(r.se.toFixed(3)), `[${nz(r.ci[0].toFixed(3))}, ${nz(r.ci[1].toFixed(3))}]`, f(r.z), pv(r.p), `${f(r.po * 100, 1)} %`, `${f(r.pe * 100, 1)} %`, r.n]],
        '<i>z</i> y <i>p</i> contrastan κ = 0 (Fleiss, Cohen y Everitt, 1969); IC con el error típico asintótico.'));
      sec.text.push(`Se calculó la kappa de Cohen${wn} para evaluar el acuerdo entre ${esc(names[0])} y ${esc(names[1])} (${R.length} casos). El acuerdo observado fue del ${f(r.po * 100, 1)} % y la kappa fue ${nz(r.kappa.toFixed(2))}, IC 95 % [${nz(r.ci[0].toFixed(2))}, ${nz(r.ci[1].toFixed(2))}], <i>z</i> = ${f(r.z)}, ${pt(r.p)}, lo que indica un acuerdo ${lk(r.kappa)} (Landis y Koch, 1977).`);
      sec.code = `# Kappa de Cohen\nd <- na.omit(datos[, ${Q}])\nirr::kappa2(d, weight = "${{ none: 'unweighted', linear: 'equal', quadratic: 'squared' }[w]}")\npsych::cohen.kappa(d)  # IC de kappa y kappa ponderada`;
      return sec;
    }
    const r = S.fleissKappa(R, lv);
    sec.test = 'Kappa de Fleiss';
    sec.why.push(`${vs.length} jueces asignan categorías (${list(lv.map(esc))}) a los mismos ${R.length} casos: la kappa de Fleiss generaliza la de Cohen a más de dos jueces.`);
    sec.decision = `Se calculó la kappa de Fleiss entre ${vs.length} jueces con ${R.length} casos.`;
    sec.tables.push(apaTable('Kappa de Fleiss', ['', 'κ', '<i>z</i>', '<i>p</i>'], [['Global', nz(r.kappa.toFixed(3)), f(r.z), pv(r.p)]].concat(r.byCat.map(c => [`Categoría ${esc(c.level)}`, nz(c.kappa.toFixed(3)), '', ''])),
      `<i>z</i> y <i>p</i> contrastan κ = 0. ${R.length} casos, ${vs.length} jueces.`));
    sec.text.push(`Se calculó la kappa de Fleiss para evaluar el acuerdo entre ${vs.length} jueces (${list(names.map(esc))}) en ${R.length} casos: κ = ${nz(r.kappa.toFixed(2))}, <i>z</i> = ${f(r.z)}, ${pt(r.p)}.`);
    sec.code = `# Kappa de Fleiss\nd <- na.omit(datos[, ${Q}])\nirr::kappam.fleiss(d, detail = TRUE)`;
    return sec;
  }

  // Curva ROC: una o varias puntuaciones frente a un estado real dicotómico
  function runRoc(xNames, yName, posLab) {
    const sec = { title: `Curva ROC: ${yName}`, test: 'Análisis de la curva ROC', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (!xNames.length) { sec.error = 'Selecciona al menos una puntuación.'; return sec; }
    const yv = vByName(yName), y = catOf(yv), lv = levelsOf(yv); if (lv.length !== 2) { sec.error = 'El estado real debe tener exactamente 2 categorías.'; return sec; }
    const pos = posLab && lv.includes(posLab) ? posLab : lv[1], neg = lv.find(l => l !== pos), res = [];
    xNames.forEach(nm => { const x = numOf(vByName(nm)), P = [], N = [];
      x.forEach((v, i) => { if (v === null || y[i] === null) return; (y[i] === pos ? P : N).push(v); });
      if (P.length < 2 || N.length < 2) return;
      let r = S.roc(P, N), flip = false;
      if (S.median(P) < S.median(N)) { r = S.roc(P.map(v => -v), N.map(v => -v)); flip = true; } // como pROC: dirección según las medianas
      res.push({ nm, r, flip, nP: P.length, nN: N.length }); });
    if (!res.length) { sec.error = 'Hacen falta al menos 2 casos en cada categoría con puntuación.'; return sec; }
    const lev = a => (a >= .9 ? 'excelente' : a >= .8 ? 'buena' : a >= .7 ? 'aceptable' : a >= .6 ? 'pobre' : 'insuficiente');
    sec.why.push(`Se evalúa si ${list(res.map(o => esc(o.nm)))} ${res.length > 1 ? 'distinguen' : 'distingue'} entre «${esc(pos)}» (positivos) y «${esc(neg)}» (negativos) en ${esc(yName)}.`);
    sec.why.push('El área bajo la curva (AUC) es la probabilidad de que un caso positivo elegido al azar puntúe más que uno negativo: 0.5 = azar, 1 = discriminación perfecta. Intervalo y error típico de DeLong (como pROC, SPSS y jamovi).');
    sec.why.push('El punto de corte óptimo maximiza el índice de Youden (sensibilidad + especificidad − 1). Si los errores no cuestan lo mismo (por ejemplo, en cribado conviene no dejar escapar casos), puede preferirse otro corte de la tabla.');
    sec.decision = `Se analizó la curva ROC de ${list(res.map(o => esc(o.nm)))} para distinguir «${esc(pos)}» de «${esc(neg)}».`;
    res.forEach(o => { if (o.flip) sec.checks.push(chk('info', `En ${esc(o.nm)}, las puntuaciones más bajas corresponden a «${esc(pos)}»: el punto de corte se interpreta como «positivo si la puntuación es ≤ el corte».`)); });
    const n0 = res[0]; if (Math.min(n0.nP, n0.nN) < 20) sec.checks.push(chk('info', `Pocos casos en alguna categoría (${n0.nP} positivos, ${n0.nN} negativos): el AUC y el punto de corte serán imprecisos (ver el intervalo).`));
    sec.tables.push(apaTable('Área bajo la curva ROC', ['Puntuación', 'AUC', '<i>EE</i>', 'IC 95 %', '<i>z</i>', '<i>p</i>', 'Positivos', 'Negativos'],
      res.map(o => [esc(o.nm), nz(o.r.auc.toFixed(3)), nz(o.r.se.toFixed(3)), `[${nz(o.r.ci[0].toFixed(3))}, ${nz(o.r.ci[1].toFixed(3))}]`, f(o.r.z), pv(o.r.p), o.nP, o.nN]),
      '<i>z</i> y <i>p</i> contrastan AUC = .5 (discriminación al azar). Orientativo (Hosmer y Lemeshow): .7–.8 aceptable, .8–.9 buena, ≥ .9 excelente.'));
    const ct = v => (Math.abs(v) === Infinity ? '—' : +v.toFixed(4));
    sec.tables.push(apaTable('Punto de corte óptimo (índice de Youden)', ['Puntuación', 'Corte', 'Sensibilidad', 'Especificidad', 'Youden', 'VPP', 'VPN', 'RV+', 'RV−'],
      res.map(o => { const b = o.r.best; return [esc(o.nm), `${o.flip ? '≤' : '≥'} ${ct(o.flip ? -b.t : b.t)}`, nz(b.se.toFixed(3)), nz(b.sp.toFixed(3)), nz(b.youden.toFixed(3)), nz(b.ppv.toFixed(3)), nz(b.npv.toFixed(3)), isFinite(b.lrp) ? f(b.lrp) : '∞', f(b.lrn)]; }),
      `Corte = punto medio entre dos puntuaciones observadas (como pROC y SPSS); se clasifica como «${esc(pos)}» quien cumple la condición. VPP y VPN dependen de la prevalencia de la muestra (${f(n0.nP / (n0.nP + n0.nN) * 100, 1)} %). RV = razón de verosimilitudes.`));
    const o0 = res[0], cut = o0.r.pts.filter(q => isFinite(q.t)), stepK = Math.max(1, Math.ceil(cut.length / 25));
    sec.tables.push(apaTable(`Coordenadas de la curva de ${o0.nm}`, ['Corte', 'Sensibilidad', 'Especificidad', 'Youden'],
      cut.filter((_, q) => q % stepK === 0).map(q => [`${o0.flip ? '≤' : '≥'} ${ct(o0.flip ? -q.t : q.t)}`, nz(q.se.toFixed(3)), nz(q.sp.toFixed(3)), nz((q.se + q.sp - 1).toFixed(3))]),
      cut.length > 25 ? `Se muestra uno de cada ${stepK} cortes posibles.` : ''));
    sec.charts.push(fig(`Curva ROC${res.length > 1 ? '' : ` de ${res[0].nm}`}`, CH.rocCurve(res.map(o => ({ name: o.nm, auc: o.r.auc, pts: o.r.pts })), res.length === 1 ? res[0].r.best : null), res.length > 1 ? CH.legend(res.map(o => o.nm)) : ''));
    sec.text.push(res.map(o => { const b = o.r.best;
      return `El área bajo la curva ROC de ${esc(o.nm)} fue ${nz(o.r.auc.toFixed(2))}, IC 95 % [${nz(o.r.ci[0].toFixed(2))}, ${nz(o.r.ci[1].toFixed(2))}], ${pt(o.r.p)}, lo que indica una capacidad de discriminación ${lev(o.r.auc)} entre «${esc(pos)}» y «${esc(neg)}». El punto de corte óptimo según el índice de Youden (${o.flip ? '≤' : '≥'} ${ct(o.flip ? -b.t : b.t)}) ofreció una sensibilidad de ${f(b.se * 100, 1)} % y una especificidad de ${f(b.sp * 100, 1)} %.`; }).join(' '));
    sec.code = `# Curva ROC\nlibrary(pROC)\n` + res.map(o => `r <- roc(datos[[${rq(yName)}]], datos[[${rq(o.nm)}]], levels = c(${rq(neg)}, ${rq(pos)}), direction = "${o.flip ? '>' : '<'}")\nauc(r); ci.auc(r, method = "delong")\ncoords(r, "best", best.method = "youden", ret = c("threshold", "sensitivity", "specificity", "ppv", "npv"))\nplot(r)`).join('\n');
    return sec;
  }

  // matriz de diseño: constante + predictores numéricos + variables ficticias (primera categoría = referencia)
  function design(xNames, rowOk) {
    const pv_ = xNames.map(vByName);
    const idx = ST.rows.map((_, i) => i).filter(i => rowOk(i) && pv_.every(v => (v.type === 'num' ? numOf(v)[i] !== null : v.raw[i] !== null)));
    const cols = [{ name: '(Constante)' }];
    pv_.forEach(v => { if (v.type === 'num') cols.push({ name: v.name, v });
      else { const lv = ordOf(v, idx.map(i => String(v.raw[i]))); lv.slice(1).forEach(l => cols.push({ name: `${v.name}: ${l} (ref. ${lv[0]})`, v, level: l })); } });
    const X = idx.map(i => cols.map(c => (!c.v ? 1 : c.level === undefined ? numOf(c.v)[i] : (String(c.v.raw[i]) === c.level ? 1 : 0))));
    return { idx, cols, X };
  }

  // variable cuantitativa o de 2 categorías codificada 0/1 (0 = primera categoría)
  function numOrBin(v) {
    if (v.type === 'num') return { vals: numOf(v), bin: false };
    const lv = levelsOf(v); if (lv.length !== 2) return null;
    return { vals: catOf(v).map(x => (x === null ? null : x === lv[1] ? 1 : 0)), bin: true, lv };
  }
  function rCode01(v, info) { return info.bin ? `as.numeric(datos[[${rq(v)}]] == ${rq(info.lv[1])})  # 0 = ${info.lv[0]}, 1 = ${info.lv[1]}` : `datos[[${rq(v)}]]`; }

  function runCfa(spec) {
    const sec = { title: 'Análisis factorial confirmatorio', test: 'AFC (máxima verosimilitud)', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (!spec.length) { sec.error = 'Asigna ítems al menos a un factor.'; return sec; }
    const all = spec.flatMap(fc => fc.items), dup = all.filter((v, i) => all.indexOf(v) !== i);
    if (dup.length) { sec.error = `Cada ítem debe estar en un solo factor (repetido: ${list([...new Set(dup)].map(esc))}).`; return sec; }
    if (new Set(spec.map(fc => fc.name)).size < spec.length) { sec.error = 'Cada factor debe tener un nombre distinto.'; return sec; }
    if (spec.length === 1 && spec[0].items.length < 3) { sec.error = 'Un modelo de un solo factor necesita al menos 3 ítems para poder estimarse.'; return sec; }
    if (spec.some(fc => fc.items.length < 2)) { sec.error = 'Cada factor necesita al menos 2 ítems (mejor 3 o más).'; return sec; }
    const vars = all.map(vByName), cols = vars.map(numOf), idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)), n = idx.length, p = all.length;
    if (n < p + 5) { sec.error = `Hay muy pocos casos completos (${n}) para ${p} ítems.`; return sec; }
    const X = idx.map(i => cols.map(c => c[i]));
    if (vars.some((_, j) => S.sd(X.map(r => r[j])) === 0)) { sec.error = 'Algún ítem tiene el mismo valor en todos los casos. Exclúyelo.'; return sec; }
    const facIdx = []; let o = 0; spec.forEach(fc => { facIdx.push(fc.items.map(() => o++)); });
    const r = S.cfa(X, facIdx), m = spec.length;
    if (!isFinite(r.chi)) { sec.error = 'El modelo no pudo estimarse (matriz de covarianzas singular o modelo no identificado).'; return sec; }
    const good = r.cfi >= .95 && r.tli >= .95 && r.rmsea <= .06 && r.srmr <= .08, ok = r.cfi >= .90 && r.tli >= .90 && r.rmsea <= .08 && r.srmr <= .10;
    const verdict = good ? 'bueno' : ok ? 'aceptable' : 'insuficiente';
    sec.decision = `Se contrastó un modelo de ${m} factor${m > 1 ? 'es correlacionados' : ''} con ${p} ítems y ${n} casos completos, estimado por máxima verosimilitud.`;
    sec.why.push('El análisis factorial confirmatorio comprueba si los datos se ajustan a una estructura de factores definida de antemano (por la teoría o por estudios previos), a diferencia del exploratorio, que la descubre.');
    sec.why.push('Cada factor se identifica fijando a 1 la carga de su primer ítem (ítem marcador); por eso se interpretan sobre todo las cargas estandarizadas.');
    sec.why.push('El ajuste se valora con varios índices a la vez (Hu y Bentler, 1999): CFI y TLI ≥ .95, RMSEA ≤ .06 y SRMR ≤ .08 indican buen ajuste; CFI y TLI ≥ .90 y RMSEA ≤ .08, ajuste aceptable.');
    sec.checks.push(chk(good ? 'ok' : ok ? 'info' : 'no', `Ajuste global ${verdict}: CFI = ${nz(r.cfi.toFixed(3))}, TLI = ${nz(r.tli.toFixed(3))}, RMSEA = ${nz(r.rmsea.toFixed(3))}, SRMR = ${nz(r.srmr.toFixed(3))}.`));
    if (!r.conv) sec.warn = 'La estimación no convergió del todo: los resultados pueden no ser fiables. Revisa el modelo (ítems con muy poca relación con su factor) o la muestra.';
    if (r.heywood.length) sec.warn = `Caso Heywood: ${list(r.heywood.map(j => esc(all[j])))} ${r.heywood.length > 1 ? 'tienen' : 'tiene'} una varianza residual negativa, lo que indica un modelo mal especificado o una muestra pequeña. Los resultados no son interpretables tal cual.`;
    const weak = all.filter((_, j) => Math.abs(r.std[j]) < .4);
    sec.checks.push(weak.length ? chk('no', `Cargas estandarizadas < .40: ${list(weak.map(esc))}. Estos ítems apenas reflejan su factor.`) : chk('ok', 'Todas las cargas estandarizadas son ≥ .40.'));
    const neg = all.filter((_, j) => r.std[j] < -.3); if (neg.length) sec.checks.push(chk('info', `Cargas negativas en ${list(neg.map(esc))}: probablemente son ítems inversos.`));
    sec.checks.push(chk(n >= 200 ? 'ok' : 'info', `Tamaño muestral: ${n} casos.${n >= 200 ? '' : ' Se recomiendan al menos 200 para un AFC estable.'}`));
    sec.checks.push(chk('info', 'La máxima verosimilitud supone variables continuas y normales. Con ítems tipo Likert de pocas categorías (5 o menos), considera en R un estimador para datos ordinales (WLSMV) o la versión robusta (MLR).'));
    if (m > 1) { const fl = []; for (let a = 0; a < m; a++) for (let b = 0; b < a; b++) if (Math.abs(r.facCor[a][b]) >= Math.sqrt(Math.min(r.rel[a].ave, r.rel[b].ave))) fl.push(`${esc(spec[a].name)} y ${esc(spec[b].name)}`);
      sec.checks.push(fl.length ? chk('no', `Validez discriminante (Fornell-Larcker) dudosa entre ${list(fl)}: su correlación supera la raíz de la AVE.`) : chk('ok', 'Validez discriminante (Fornell-Larcker): cada factor comparte más varianza con sus ítems que con los demás factores.')); }
    sec.alt = 'Si el ajuste es insuficiente, revisa ítems con cargas bajas o un análisis factorial exploratorio previo. Con ítems ordinales, el estimador WLSMV en lavaan.';
    const crit = (v, g0, a0, inv) => (inv ? (v <= g0 ? 'bueno' : v <= a0 ? 'aceptable' : 'insuficiente') : (v >= g0 ? 'bueno' : v >= a0 ? 'aceptable' : 'insuficiente'));
    sec.tables.push(apaTable('Índices de ajuste del modelo', ['χ²', '<i>gl</i>', '<i>p</i>', 'CFI', 'TLI', 'RMSEA', 'IC 90 % RMSEA', 'SRMR', '<i>n</i>'],
      [[f(r.chi), r.df, pv(r.pval), nz(r.cfi.toFixed(3)), nz(r.tli.toFixed(3)), nz(r.rmsea.toFixed(3)), `[${nz(r.rmseaCI[0].toFixed(3))}, ${nz(r.rmseaCI[1].toFixed(3))}]`, nz(r.srmr.toFixed(3)), n]],
      `Valoración: CFI ${crit(r.cfi, .95, .90)}, TLI ${crit(r.tli, .95, .90)}, RMSEA ${crit(r.rmsea, .06, .08, true)}, SRMR ${crit(r.srmr, .08, .10, true)}. Estimación por máxima verosimilitud.`));
    const rows = []; spec.forEach((fc, k) => fc.items.forEach((it, i) => { const j = facIdx[k][i], e = r.est.find(q => q.t === 'l' && q.j === j);
      rows.push([i === 0 ? `<b>${esc(fc.name)}</b>` : '', esc(it), e ? f(e.est, 3) : '1 (fijo)', e ? f(e.se, 3) : '—', e ? f(e.z) : '—', e ? pv(e.p) : '—', r2s(r.std[j]), nz((1 - r.std[j] ** 2).toFixed(2))]); }));
    sec.tables.push(apaTable('Cargas factoriales', ['Factor', 'Ítem', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'β', 'Varianza residual (est.)'], rows, 'β = carga estandarizada. El primer ítem de cada factor fija la escala (carga = 1).'));
    sec.tables.push(apaTable('Fiabilidad y validez convergente', ['Factor', 'Ítems', 'ω', 'AVE'], spec.map((fc, k) => [esc(fc.name), fc.items.length, nz(r.rel[k].omega.toFixed(3)), nz(r.rel[k].ave.toFixed(3))]),
      'ω = fiabilidad compuesta (omega) a partir del AFC; los ítems con carga negativa (inversos) se consideran recodificados. AVE = varianza media extraída (≥ .50 indica validez convergente).'));
    if (m > 1) sec.tables.push(apaTable('Correlaciones entre factores', [''].concat(spec.map(fc => esc(fc.name))), spec.map((fc, a) => [esc(fc.name)].concat(spec.map((_, b) => (a === b ? '—' : b < a ? r2s(r.facCor[a][b]) : ''))))));
    let t = `Se realizó un análisis factorial confirmatorio por máxima verosimilitud para contrastar un modelo de ${m} factor${m > 1 ? 'es correlacionados' : ''} (${spec.map(fc => `${esc(fc.name)}: ${fc.items.length} ítems`).join('; ')}) con ${n} participantes. `;
    t += `El ajuste del modelo fue ${verdict}, χ²(${r.df}) = ${f(r.chi)}, ${pt(r.pval)}, CFI = ${nz(r.cfi.toFixed(2))}, TLI = ${nz(r.tli.toFixed(2))}, RMSEA = ${nz(r.rmsea.toFixed(3))}, IC 90 % [${nz(r.rmseaCI[0].toFixed(3))}, ${nz(r.rmseaCI[1].toFixed(3))}], SRMR = ${nz(r.srmr.toFixed(3))}. `;
    const absS = r.std.map(Math.abs); t += `Las cargas estandarizadas oscilaron entre ${nz(Math.min(...absS).toFixed(2))} y ${nz(Math.max(...absS).toFixed(2))}${neg.length ? ' en valor absoluto' : ''}`;
    t += `, y la fiabilidad compuesta fue ${list(spec.map((fc, k) => `${m > 1 ? `${esc(fc.name)} ` : ''}ω = ${nz(r.rel[k].omega.toFixed(2))}`))}.`;
    if (m > 1) { const cs = []; for (let a = 0; a < m; a++) for (let b = 0; b < a; b++) cs.push(r.facCor[a][b]); t += ` Las correlaciones entre factores oscilaron entre ${r2s(Math.min(...cs))} y ${r2s(Math.max(...cs))}.`; }
    sec.text.push(t);
    const syn = n0 => /^[A-Za-z.][A-Za-z0-9._]*$/.test(n0), allSyn = all.every(syn) && spec.every(fc => syn(fc.name.replace(/\s+/g, '_')));
    const iname = (it, j) => (allSyn ? it : `i${j + 1}`), fname = (fc, k) => (allSyn ? fc.name.replace(/\s+/g, '_') : `F${k + 1}`);
    let jj = 0; const modelo = spec.map((fc, k) => `${fname(fc, k)} =~ ${fc.items.map(it => iname(it, jj++)).join(' + ')}`).join('\n');
    sec.code = `# Análisis factorial confirmatorio (lavaan)\nitems <- datos[complete.cases(datos[, c(${all.map(rq).join(', ')})]), c(${all.map(rq).join(', ')})]\n` +
      (allSyn ? '' : `names(items) <- c(${all.map((_, j) => rq('i' + (j + 1))).join(', ')})  # ${all.map((it, j) => `i${j + 1} = ${it}`).join('; ')}\n`) +
      `modelo <- '\n${modelo}\n'\najuste <- lavaan::cfa(modelo, data = items)\nsummary(ajuste, fit.measures = TRUE, standardized = TRUE)\nlavaan::fitMeasures(ajuste, c("chisq", "df", "pvalue", "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "srmr"))\nlavaan::standardizedSolution(ajuste)`;
    return sec;
  }

  function runLmm(yN, xNames, gN, slopeN, inter = []) {
    const sec = { title: `Modelo mixto: ${yN}`, test: 'Modelo lineal mixto (REML)', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    xNames = xNames.filter(n => n !== yN && n !== gN);
    if (gN === yN) { sec.error = 'La variable de agrupación no puede ser la variable dependiente.'; return sec; }
    if (slopeN && !xNames.includes(slopeN)) { sec.error = `Para estimar una pendiente aleatoria de ${slopeN}, inclúyela también como efecto fijo.`; return sec; }
    const yv = numOf(vByName(yN)), gv = vByName(gN).raw.map(x => (x === null ? null : String(x)));
    const [iA, iB] = inter, hasI = !!(iA && iB);
    if ((iA || iB) && !hasI) { sec.error = 'Para la interacción elige los dos predictores (A y B).'; return sec; }
    if (hasI && (iA === iB || !xNames.includes(iA) || !xNames.includes(iB))) { sec.error = 'Los dos predictores de la interacción deben ser distintos y estar incluidos como efectos fijos.'; return sec; }
    const { idx, cols, X } = design(xNames, i => yv[i] !== null && gv[i] !== null), n = idx.length;
    if (hasI) { // columnas de la interacción: producto de las columnas de A por las de B (variables ficticias incluidas)
      const ca = cols.map((c, k) => ({ c, k })).filter(o => o.c.v && o.c.v.name === iA), cb = cols.map((c, k) => ({ c, k })).filter(o => o.c.v && o.c.v.name === iB);
      ca.forEach(a => cb.forEach(b => { cols.push({ name: `${a.c.name} × ${b.c.name}`, inter: true }); X.forEach(r => r.push(r[a.k] * r[b.k])); }));
    }
    if (n < 10) { sec.error = 'Hay muy pocas observaciones completas.'; return sec; }
    const g = idx.map(i => gv[i]), y = idx.map(i => yv[i]), sizes = Object.values(g.reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {})), ng = sizes.length;
    if (Math.max(...sizes) < 2) { sec.error = `Cada valor de «${gN}» aparece en una sola fila. Un modelo mixto necesita varias filas por persona o grupo: organiza los datos en formato largo (una fila por medición) o elige otra variable de agrupación.`; return sec; }
    if (ng < 3) { sec.error = `Solo hay ${ng} grupos: se necesitan bastantes más para estimar la variabilidad entre grupos.`; return sec; }
    const zcol = slopeN ? cols.findIndex(c => c.name === slopeN) : -1;
    if (slopeN && (zcol < 0 || cols[zcol].level !== undefined)) { sec.error = 'La pendiente aleatoria debe ser un predictor cuantitativo.'; return sec; }
    if (xNames.length && n < cols.length + 3) { sec.error = 'Hay pocas observaciones para tantos predictores.'; return sec; }
    const r = S.lmm(y, X, g, zcol), r0 = S.lmm(y, y.map(() => [1]), g, -1);
    if (!r || !isFinite(r.s2)) { sec.error = 'No se pudo estimar el modelo (colinealidad perfecta entre predictores o datos insuficientes).'; return sec; }
    const sw = S.shapiro(r.resid.length > 5000 ? r.resid.slice(0, 5000) : r.resid);
    sec.decision = `Se ajustó un modelo lineal mixto por REML con ${n} observaciones de ${ng} unidades de ${esc(gN)}, con intercepto aleatorio${hasI ? ` y la interacción ${esc(iA)} × ${esc(iB)}` : ''}${slopeN ? ` y pendiente aleatoria de ${esc(slopeN)}` : ''}.`;
    sec.why.push(`Las observaciones no son independientes: varias pertenecen a la misma unidad (${esc(gN)}). Ignorarlo infla los falsos positivos; el modelo mixto lo tiene en cuenta con efectos aleatorios.`);
    sec.why.push(`El intercepto aleatorio permite que cada ${esc(gN)} tenga su propio nivel medio${slopeN ? `, y la pendiente aleatoria, que el efecto de ${esc(slopeN)} varíe entre ellos` : ''}.`);
    sec.why.push('Los grados de libertad de los efectos fijos se calculan con la aproximación de Satterthwaite (como lmerTest en R), y los datos perdidos no obligan a eliminar a la persona entera: se usan todas las mediciones disponibles.');
    sec.checks.push(chk(r0.icc >= .05 ? 'ok' : 'info', `Correlación intraclase (modelo nulo): CCI = ${nz(r0.icc.toFixed(3))}. El ${f(r0.icc * 100, 1)} % de la varianza de ${esc(yN)} se debe a diferencias entre unidades de ${esc(gN)}.${r0.icc < .05 ? ' Es baja: el modelo mixto puede no aportar mucho frente a una regresión.' : ''}`));
    sec.checks.push(chk(ng >= 20 ? 'ok' : 'info', `Número de grupos: ${ng} (entre ${Math.min(...sizes)} y ${Math.max(...sizes)} observaciones por grupo).${ng >= 20 ? '' : ' Con menos de 20 grupos la varianza aleatoria se estima con poca precisión.'}`));
    if (r.singular) sec.warn = 'Ajuste singular: la varianza de algún efecto aleatorio es prácticamente 0 (o la correlación entre efectos aleatorios es ±1). El modelo es demasiado complejo para los datos: simplifica la parte aleatoria (por ejemplo, quita la pendiente aleatoria).';
    if (sw) sec.checks.push(chk(sw.p >= .05 ? 'ok' : n >= 100 ? 'info' : 'no', `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}.${sw.p >= .05 ? '' : n >= 100 ? ' Con muchas observaciones el modelo es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña.'}`));
    sec.alt = 'Modelo lineal generalizado mixto (GLMM) si la variable dependiente es dicotómica o un recuento.';
    sec.tables.push(apaTable('Efectos fijos', ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>gl</i>', '<i>t</i>', '<i>p</i>', 'IC 95 %'],
      cols.map((c, j) => [esc(c.name), f(r.beta[j], 3), f(r.se[j], 3), f(r.df[j], 1), f(r.t[j]), pv(r.p[j]), `[${f(r.ci[j][0], 3)}, ${f(r.ci[j][1], 3)}]`]),
      'Grados de libertad de Satterthwaite. Las variables categóricas se codifican frente a su primera categoría.'));
    const reRows = [[`${esc(gN)}: intercepto`, f(r.Tau[0][0], 3), f(Math.sqrt(r.Tau[0][0]), 3)]];
    if (slopeN) reRows.push([`${esc(gN)}: pendiente de ${esc(slopeN)}`, f(r.Tau[1][1], 3), f(Math.sqrt(r.Tau[1][1]), 3)]);
    reRows.push(['Residual', f(r.s2, 3), f(Math.sqrt(r.s2), 3)]);
    sec.tables.push(apaTable('Efectos aleatorios', ['Componente', 'Varianza', '<i>DT</i>'], reRows,
      (slopeN ? `Correlación entre intercepto y pendiente aleatorios: ${r2s(r.corRE)}. ` : '') + `${n} observaciones; ${ng} grupos. <i>R</i>² marginal = ${nz(r.r2m.toFixed(3))}; <i>R</i>² condicional = ${nz(r.r2c.toFixed(3))} (Nakagawa). CCI del modelo nulo = ${nz(r0.icc.toFixed(3))}.`));
    const sig = cols.map((c, j) => ({ c, j })).filter(o => o.j > 0 && r.p[o.j] < .05), ns = cols.filter((c, j) => j > 0 && r.p[j] >= .05).map(c => esc(c.name));
    let t = `Se ajustó un modelo lineal mixto (REML) para ${esc(yN)} con ${n} observaciones anidadas en ${ng} unidades de ${esc(gN)}, con intercepto aleatorio${slopeN ? ` y pendiente aleatoria de ${esc(slopeN)}` : ''}. La correlación intraclase del modelo nulo fue ${nz(r0.icc.toFixed(2))}: el ${f(r0.icc * 100, 1)} % de la varianza se debía a diferencias entre unidades de ${esc(gN)}. `;
    if (cols.length > 1) {
      const sigI = sig.filter(o => o.c.inter);
      if (hasI) t += sigI.length ? `La interacción ${esc(iA)} × ${esc(iB)} fue estadísticamente significativa (${list(sigI.map(o => `<i>B</i> = ${f(r.beta[o.j], 2)}, <i>t</i>(${f(r.df[o.j], 1)}) = ${f(r.t[o.j])}, ${pt(r.p[o.j])}`))}): el efecto de ${esc(iA)} depende de ${esc(iB)}, por lo que los efectos principales deben interpretarse con cautela. ` : `La interacción ${esc(iA)} × ${esc(iB)} no fue estadísticamente significativa. `;
      if (sig.filter(o => !o.c.inter).length) t += list(sig.filter(o => !o.c.inter).map(o => `${esc(o.c.name)} se asoció ${r.beta[o.j] > 0 ? 'positivamente' : 'negativamente'} con ${esc(yN)} (<i>B</i> = ${f(r.beta[o.j], 2)}, <i>t</i>(${f(r.df[o.j], 1)}) = ${f(r.t[o.j])}, ${pt(r.p[o.j])})`)) + '. ';
      const nsM = cols.filter((c, j) => j > 0 && !c.inter && r.p[j] >= .05).map(c => esc(c.name));
      if (nsM.length) t += `${list(nsM)} no ${nsM.length > 1 ? 'fueron predictores significativos' : 'fue un predictor significativo'}. `;
      t += `Los efectos fijos explicaron el ${f(r.r2m * 100, 1)} % de la varianza (<i>R</i>² marginal) y el modelo completo, el ${f(r.r2c * 100, 1)} % (<i>R</i>² condicional).`;
    }
    sec.text.push(t);
    const fx = (xNames.length ? xNames.map(rn).join(' + ') : '1') + (hasI ? ` + ${rn(iA)}:${rn(iB)}` : '');
    sec.code = `# Modelo lineal mixto: ${yN}\nmodelo <- lmerTest::lmer(${rn(yN)} ~ ${fx} + (${slopeN ? `1 + ${rn(slopeN)}` : '1'} | ${rn(gN)}), data = datos, REML = TRUE)\nsummary(modelo)  # gl de Satterthwaite\nconfint(modelo, method = "Wald")\n` +
      `performance::r2_nakagawa(modelo)\nperformance::icc(lmerTest::lmer(${rn(yN)} ~ 1 + (1 | ${rn(gN)}), data = datos, REML = TRUE))  # CCI del modelo nulo`;
    return sec;
  }

  function runModeration(yN, xN, wN) {
    const sec = { title: `Moderación: ${xN} → ${yN}, moderado por ${wN}`, test: 'Moderación (regresión con interacción)', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (new Set([yN, xN, wN]).size < 3) { sec.error = 'La variable dependiente, el predictor y el moderador deben ser distintos.'; return sec; }
    const yv = numOf(vByName(yN)), xi = numOrBin(vByName(xN)), wi = numOrBin(vByName(wN));
    if (!xi || !wi) { sec.error = 'El predictor y el moderador deben ser cuantitativos o tener exactamente 2 categorías.'; return sec; }
    const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && xi.vals[i] !== null && wi.vals[i] !== null), n = idx.length;
    if (n < 10) { sec.error = 'Hay muy pocos casos completos.'; return sec; }
    const y = idx.map(i => yv[i]), x = idx.map(i => xi.vals[i]), w = idx.map(i => wi.vals[i]);
    if (S.sd(x) === 0 || S.sd(w) === 0) { sec.error = 'El predictor o el moderador no varía.'; return sec; }
    const r = S.moderation(y, x, w, null, !xi.bin, !wi.bin);
    if (!r) { sec.error = 'No se pudo estimar el modelo (colinealidad perfecta).'; return sec; }
    const sdW = S.sd(w), mW = S.mean(w), sdX = S.sd(x), mX = S.mean(x);
    const wPts = wi.bin ? [{ v: 0, lab: `${wN} = ${wi.lv[0]}` }, { v: 1, lab: `${wN} = ${wi.lv[1]}` }] : [{ v: mW - sdW, lab: `${wN} bajo (−1 DT = ${f(mW - sdW)})` }, { v: mW, lab: `${wN} medio (${f(mW)})` }, { v: mW + sdW, lab: `${wN} alto (+1 DT = ${f(mW + sdW)})` }];
    const sl = wPts.map(pt0 => Object.assign(r.slope(pt0.v), { lab: pt0.lab }));
    const xLab = xi.bin ? `${xN} (0 = ${xi.lv[0]}, 1 = ${xi.lv[1]})` : `${xN} (centrada)`, wLab = wi.bin ? `${wN} (0 = ${wi.lv[0]}, 1 = ${wi.lv[1]})` : `${wN} (centrada)`;
    sec.decision = `Se estimó un modelo de moderación (regresión con el término de interacción ${esc(xN)} × ${esc(wN)}) con ${n} casos completos${!xi.bin || !wi.bin ? '; las variables cuantitativas se centraron en su media' : ''}.`;
    sec.why.push(`Se quiere saber si el efecto de ${esc(xN)} sobre ${esc(yN)} depende de ${esc(wN)}: eso es un efecto de moderación, que se contrasta con el término de interacción.`);
    sec.why.push('Centrar las variables cuantitativas no cambia la interacción, pero hace interpretables los efectos principales (son el efecto de cada variable en el valor medio de la otra) y reduce la colinealidad.');
    sec.why.push(wi.bin ? `Como el moderador tiene dos categorías, se estima el efecto de ${esc(xN)} en cada una.` : 'Las pendientes simples muestran el efecto de X para valores bajos (−1 DT), medios y altos (+1 DT) del moderador; la región de Johnson-Neyman indica a partir de qué valor exacto del moderador el efecto es significativo.');
    const swr = S.shapiro(r.resid);
    sec.checks.push(chk(swr && swr.p >= .05 ? 'ok' : n >= 100 ? 'info' : 'no', `Normalidad de los residuos (Shapiro-Wilk): ${swr ? `<i>W</i> = ${nz(swr.W.toFixed(3))}, ${pt(swr.p)}` : 'no calculable'}.${swr && swr.p < .05 && n >= 100 ? ' Con muestras grandes el modelo es robusto a desviaciones moderadas.' : ''}`));
    sec.checks.push(chk(r.bp.p >= .05 ? 'ok' : 'no', `Homocedasticidad (Breusch-Pagan): χ²(${r.bp.df}) = ${f(r.bp.LM)}, ${pt(r.bp.p)}.${r.bp.p >= .05 ? ' Se cumple.' : ' No se cumple: interpreta los errores típicos con cautela.'}`));
    sec.checks.push(chk('info', 'Linealidad: se asume que la relación entre X e Y es lineal para cada valor del moderador.'));
    sec.alt = 'Si el moderador es categórico con más de dos grupos, un ANOVA factorial o una regresión con variables ficticias y sus interacciones.';
    const nmT = ['(Constante)', xLab, wLab, `${xN} × ${wN}`], tc = (k) => `[${f(r.ci[k][0], 3)}, ${f(r.ci[k][1], 3)}]`;
    sec.tables.push(apaTable(`Modelo de moderación para ${yN}`, ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>t</i>', '<i>p</i>', 'IC 95 %'], nmT.map((nm, k) => [esc(nm), f(r.b[k], 3), f(r.se[k], 3), f(r.t[k]), pv(r.p[k]), tc(k)]),
      `<i>R</i>² = ${nz(r.r2.toFixed(3))}, <i>F</i>(${r.df1}, ${r.dfr}) = ${f(r.F)}, ${pt(r.pF)}. Cambio en <i>R</i>² por la interacción: Δ<i>R</i>² = ${nz(r.dR2.toFixed(3))}, <i>F</i>(1, ${r.dfr}) = ${f(r.Fch)}, ${pt(r.pch)}.`));
    sec.tables.push(apaTable(`Efecto de ${xN} sobre ${yN} según ${wN} (pendientes simples)`, ['Valor del moderador', 'Efecto de X', '<i>EE</i>', '<i>t</i>', '<i>p</i>', 'IC 95 %'],
      sl.map(o => [esc(o.lab), f(o.b, 3), f(o.se, 3), f(o.t), pv(o.p), `[${f(o.ci[0], 3)}, ${f(o.ci[1], 3)}]`])));
    // región de Johnson-Neyman dentro del rango observado
    let jnTxt = '';
    if (!wi.bin) {
      const lo = Math.min(...w), hi = Math.max(...w), cuts = [lo].concat(r.jn.filter(v => v > lo && v < hi)).concat([hi]), segs = [];
      for (let k = 0; k < cuts.length - 1; k++) { const mid = (cuts[k] + cuts[k + 1]) / 2; if (r.slope(mid).p < .05) segs.push([cuts[k], cuts[k + 1]]); }
      const inner = r.jn.filter(v => v > lo && v < hi);
      jnTxt = !segs.length ? `En el rango observado de ${esc(wN)} (${f(lo)} a ${f(hi)}), el efecto de ${esc(xN)} no fue significativo para ningún valor del moderador.`
        : segs.length === 1 && segs[0][0] === lo && segs[0][1] === hi ? `El efecto de ${esc(xN)} fue significativo en todo el rango observado de ${esc(wN)} (${f(lo)} a ${f(hi)}).`
        : `Según la técnica de Johnson-Neyman, el efecto de ${esc(xN)} fue significativo cuando ${esc(wN)} ${list(segs.map(sg => (sg[0] === lo ? `≤ ${f(sg[1])}` : sg[1] === hi ? `≥ ${f(sg[0])}` : `estaba entre ${f(sg[0])} y ${f(sg[1])}`)))}${inner.length ? '' : ''}.`;
      sec.checks.push(chk('info', `Región de Johnson-Neyman (α = .05): ${jnTxt}`));
    }
    // gráfico: valores predichos de Y para X bajo/medio/alto en cada nivel del moderador
    const xPts = xi.bin ? [{ v: 0, lab: xi.lv[0] }, { v: 1, lab: xi.lv[1] }] : [{ v: mX - sdX, lab: `${xN} bajo` }, { v: mX, lab: `${xN} medio` }, { v: mX + sdX, lab: `${xN} alto` }];
    const pred = (xv, wv) => { const xc = xv - r.mx, wc = wv - r.mw; return r.b[0] + r.b[1] * xc + r.b[2] * wc + r.b[3] * xc * wc; };
    sec.charts.push(fig(`Efecto de ${xN} sobre ${yN} según ${wN}`, CH.interaction(xPts.map(o => o.lab), wPts.map(o => ({ name: o.lab, means: xPts.map(xp => pred(xp.v, o.v)), ci: xPts.map(xp => [pred(xp.v, o.v), pred(xp.v, o.v)]) })), `${yN} (predicho)`), CH.legend(wPts.map(o => o.lab))));
    const st = `<i>B</i> = ${f(r.b[3], 3)}, <i>t</i>(${r.dfr}) = ${f(r.t[3])}, ${pt(r.p[3])}, Δ<i>R</i>² = ${nz(r.dR2.toFixed(3))}`;
    let t = `Se analizó si ${esc(wN)} moderaba la relación entre ${esc(xN)} y ${esc(yN)} mediante una regresión con el término de interacción${!xi.bin || !wi.bin ? ' (variables cuantitativas centradas)' : ''}. El modelo explicó el ${f(r.r2 * 100, 1)} % de la varianza de ${esc(yN)}, <i>F</i>(${r.df1}, ${r.dfr}) = ${f(r.F)}, ${pt(r.pF)}. `;
    if (r.p[3] < .05) {
      t += `La interacción ${esc(xN)} × ${esc(wN)} fue estadísticamente significativa, ${st}, lo que indica que el efecto de ${esc(xN)} depende de ${esc(wN)}. `;
      t += 'El análisis de pendientes simples mostró que el efecto de ' + esc(xN) + ' ' + list(sl.map(o => `${o.p < .05 ? 'fue significativo' : 'no fue significativo'} ${wi.bin ? `en ${esc(o.lab.split(' = ')[1])}` : `con ${esc(wN)} ${o.lab.split(' ')[1]}`} (<i>B</i> = ${f(o.b, 2)}, ${pt(o.p)})`)) + '. ';
      if (jnTxt) t += jnTxt;
    } else t += `La interacción ${esc(xN)} × ${esc(wN)} no fue estadísticamente significativa, ${st}: no hay evidencia de que ${esc(wN)} modere el efecto de ${esc(xN)}.`;
    sec.text.push(t);
    const Y = rq(yN);
    sec.code = `# Moderación: ${xN} → ${yN}, moderador ${wN}\nd <- data.frame(Y = datos[[${Y}]], X = ${rCode01(xN, xi)}, W = ${rCode01(wN, wi)})\nd <- d[complete.cases(d), ]\n` +
      (xi.bin ? '' : 'd$X <- d$X - mean(d$X)  # centrada\n') + (wi.bin ? '' : 'd$W <- d$W - mean(d$W)  # centrada\n') +
      `modelo <- lm(Y ~ X * W, data = d)\nsummary(modelo); confint(modelo)\nanova(lm(Y ~ X + W, data = d), modelo)  # cambio en R² por la interacción\n` +
      `emmeans::emtrends(modelo, ~ W, var = "X", at = list(W = ${wi.bin ? 'c(0, 1)' : 'c(-sd(d$W), 0, sd(d$W))'}), infer = TRUE)  # pendientes simples\n# Región de Johnson-Neyman (paquete interactions): interactions::johnson_neyman(modelo, pred = X, modx = W)`;
    return sec;
  }

  // Modelos de PROCESS con varios mediadores, en serie, de mediación moderada o con covariables
  function runProcess(mo, yN, xN, mNames, wN, cNames) {
    const model = mo === '4p' ? 4 : +mo, MN = { 4: mNames.length > 1 ? 'mediación con mediadores en paralelo' : 'mediación simple', 6: 'mediación en serie', 7: 'mediación moderada en la primera etapa', 14: 'mediación moderada en la segunda etapa' }[model];
    const sec = { title: `Mediación: ${xN} → ${mNames.join(model === 6 ? ' → ' : ', ')} → ${yN}${wN ? ` (moderador: ${wN})` : ''}`, test: `PROCESS, modelo ${model} (${MN}, bootstrap)`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    const used = [yN, xN, ...mNames, wN].filter(Boolean); if (new Set(used).size !== used.length) { sec.error = 'Y, X, los mediadores y el moderador deben ser variables distintas.'; return sec; }
    if ((model === 7 || model === 14) && !wN) { sec.error = 'Elige un moderador (W).'; return sec; }
    if ((mo === '4p' || model === 6) && mNames.length < 2) { sec.error = 'Marca al menos un mediador adicional.'; return sec; }
    if (model === 6 && mNames.length > 4) { sec.error = 'El modelo en serie admite hasta 4 mediadores.'; return sec; }
    cNames = cNames.filter(c => !used.includes(c));
    const xv = numOrBin(vByName(xN)), wv = wN ? numOrBin(vByName(wN)) : null; if (!xv || (wN && !wv)) { sec.error = 'X y W deben ser cuantitativas o tener exactamente 2 categorías.'; return sec; }
    const yv = numOf(vByName(yN)), mv = mNames.map(m => numOf(vByName(m))), cv = cNames.map(c => numOf(vByName(c)));
    const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && xv.vals[i] !== null && mv.every(m => m[i] !== null) && (!wv || wv.vals[i] !== null) && cv.every(c => c[i] !== null)), n = idx.length;
    if (n < 10 + mNames.length + cNames.length) { sec.error = `Hay pocos casos completos (${n}).`; return sec; }
    const pick_ = arr => idx.map(i => arr[i]), r = S.processModel(model, pick_(yv), pick_(xv.vals), mv.map(pick_), wv ? pick_(wv.vals) : null, cv.map(pick_));
    if (!r) { sec.error = 'No se pudo estimar el modelo (colinealidad entre variables).'; return sec; }
    const nm = k => (k === 'X' ? esc(xN) : k === 'W' ? esc(wN) : k === 'X×W' ? `${esc(xN)} × ${esc(wN)}` : /^M\d$/.test(k) ? esc(mNames[+k[1]]) : /^M\d×W$/.test(k) ? `${esc(mNames[+k[1]])} × ${esc(wN)}` : /^C\d$/.test(k) ? esc(cNames[+k[1]]) : k);
    const ci2 = c => `[${f(c[0], 3)}, ${f(c[1], 3)}]`, sig = c => c[0] > 0 || c[1] < 0;
    sec.why.push(`Modelo ${model} de PROCESS (Hayes, 2022): ${MN}. ${model === 6 ? 'Los mediadores se encadenan en el orden indicado.' : ''}`);
    sec.why.push(`Los efectos indirectos se contrastan con intervalos de confianza bootstrap percentil (${r.B} remuestras, semilla fija para que el resultado sea reproducible): hay efecto si el intervalo no incluye el 0.`);
    if (wN) sec.why.push(`Los efectos indirectos condicionados se calculan en ${r.wv.length === 2 ? 'los dos valores' : 'los percentiles 16, 50 y 84'} de ${esc(wN)} (como PROCESS v4). El índice de mediación moderada (Hayes, 2015) contrasta si el efecto indirecto cambia con W.`);
    if (cNames.length) sec.why.push(`Covariables en todas las ecuaciones: ${list(cNames.map(esc))}.`);
    sec.decision = `Se estimó el modelo ${model} de PROCESS (${MN}) con ${n} casos e intervalos bootstrap de ${r.B} remuestras.`;
    if (xv.bin) sec.checks.push(chk('info', `${esc(xN)} es dicotómica: se codifica 0 = ${esc(xv.lv[0])}, 1 = ${esc(xv.lv[1])}.`));
    r.eqs.forEach(e => { const dvN = e.dv === 'Y' ? esc(yN) : esc(mNames[+e.dv.slice(1)]);
      sec.tables.push(apaTable(`Ecuación de ${dvN}`, ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>t</i>', '<i>p</i>', 'IC 95 %'], e.names.map((k, j) => [nm(k), f(e.b[j], 3), f(e.se[j], 3), f(e.t[j]), pv(e.p[j]), ci2(e.ci[j])]),
        `<i>R</i>² = ${nz(e.r2.toFixed(3))}, <i>F</i>(${e.df1}, ${e.dfr}) = ${f(e.F)}, ${pt(e.pF)}.`)); });
    const effRows = [['Efecto total (c)', f(r.total.b, 3), f(r.total.se, 3), ci2(r.total.ci), pv(r.total.p)], ['Efecto directo (c′)', f(r.direct.b, 3), f(r.direct.se, 3), ci2(r.direct.ci), pv(r.direct.p)]];
    const E = r.effects, ind = [];
    if (model === 4) { mNames.forEach((m, j) => ind.push([`Indirecto a través de ${esc(m)}`, E['ind' + j]])); if (mNames.length > 1) { ind.push(['Indirecto total', E.indTot]); for (let a = 0; a < mNames.length; a++) for (let b = a + 1; b < mNames.length; b++) ind.push([`Contraste: ${esc(mNames[a])} − ${esc(mNames[b])}`, E[`con${a}_${b}`]]); } }
    if (model === 6) { Object.keys(E).filter(k => k.startsWith('path')).forEach(k => ind.push([`${esc(xN)} → ${k.slice(4).split('_').map(j => esc(mNames[+j])).join(' → ')} → ${esc(yN)}`, E[k]])); ind.push(['Indirecto total', E.indTot]); }
    if (model === 7 || model === 14) { r.wv.forEach((w, q) => ind.push([`Indirecto con ${esc(wN)} = ${wv.bin ? esc(wv.lv[q]) : f(w)}${wv.bin ? '' : ` (percentil ${[16, 50, 84][q]})`}`, E['cond' + q]])); ind.push(['Índice de mediación moderada', E.imm]); }
    ind.forEach(([lab, e]) => effRows.push([lab, f(e.est, 3), f(e.se, 3), ci2(e.ci), sig(e.ci) ? 'IC excluye 0' : 'IC incluye 0']));
    sec.tables.push(apaTable('Efectos total, directo e indirectos', ['Efecto', 'Estimación', '<i>EE</i>', 'IC 95 %', 'Significación'], effRows,
      `Efectos total y directo con su <i>t</i> habitual; efectos indirectos con EE e IC bootstrap percentil (${r.B} remuestras). Coeficientes no estandarizados.`));
    let t = `Se estimó un modelo de ${MN} (modelo ${model} de PROCESS; Hayes, 2022) para analizar si el efecto de ${esc(xN)} sobre ${esc(yN)} ${model === 7 || model === 14 ? `a través de ${esc(mNames[0])} dependía de ${esc(wN)}` : `estaba mediado por ${list(mNames.map(esc))}`}${cNames.length ? `, controlando ${list(cNames.map(esc))}` : ''}, con intervalos de confianza bootstrap de ${r.B} remuestras. `;
    t += `El efecto total fue ${r.total.p < .05 ? 'significativo' : 'no significativo'} (<i>c</i> = ${f(r.total.b)}, ${pt(r.total.p)}) y el directo ${r.direct.p < .05 ? 'significativo' : 'no significativo'} (<i>c′</i> = ${f(r.direct.b)}, ${pt(r.direct.p)}). `;
    t += ind.map(([lab, e]) => `${lab.replace(/<[^>]+>/g, '')}: ${f(e.est, 3)}, IC 95 % ${ci2(e.ci)}${sig(e.ci) ? ' (significativo)' : ' (no significativo)'}`).join('; ') + '.';
    if (model === 7 || model === 14) t += sig(E.imm.ci) ? ` El índice de mediación moderada fue significativo: el efecto indirecto cambió según ${esc(wN)}.` : ` El índice de mediación moderada no fue significativo: no hay evidencia de que el efecto indirecto dependa de ${esc(wN)}.`;
    sec.text.push(t);
    // código R reproducible: variables con nombres cortos (Y, X, M1…, W, C1…) y bootstrap percentil con el paquete boot
    const Mn = mNames.map((_, j) => 'M' + (j + 1)), Cn = cNames.map((_, j) => 'C' + (j + 1)), Cf = Cn.length ? ' + ' + Cn.join(' + ') : '';
    const src = v => `datos[[${rq(v)}]]`, bin = (v, info) => (info && info.bin ? `as.numeric(${src(v)} == ${rq(info.lv[1])})` : src(v));
    const dfCode = `d <- data.frame(Y = ${src(yN)}, X = ${bin(xN, xv)}${mNames.map((m, j) => `, ${Mn[j]} = ${src(m)}`).join('')}${wN ? `, W = ${bin(wN, wv)}` : ''}${cNames.map((c, j) => `, ${Cn[j]} = ${src(c)}`).join('')})`;
    let body;
    if (model === 4) body = Mn.map((m, j) => `a${j + 1} <- coef(lm(${m} ~ X${Cf}, d))["X"]`).concat([`bY <- coef(lm(Y ~ X + ${Mn.join(' + ')}${Cf}, d))`, `ind <- c(${Mn.map((m, j) => `a${j + 1} * bY["${m}"]`).join(', ')})`, Mn.length > 1 ? 'c(ind, total = sum(ind))' : 'ind']).join('; ');
    else if (model === 6) { const eqs = Mn.map((m, j) => `e${j + 1} <- coef(lm(${m} ~ X${Mn.slice(0, j).map(z => ' + ' + z).join('')}${Cf}, d))`);
      const paths = Object.keys(E).filter(k => k.startsWith('path')).map(k => k.slice(4).split('_').map(Number));
      const expr = ch => [`e${ch[0] + 1}["X"]`].concat(ch.slice(1).map((j, q) => `e${j + 1}["${Mn[ch[q]]}"]`)).concat([`bY["${Mn[ch[ch.length - 1]]}"]`]).join(' * ');
      body = eqs.concat([`bY <- coef(lm(Y ~ X + ${Mn.join(' + ')}${Cf}, d))`, `ind <- c(${paths.map(expr).join(', ')})`, 'c(ind, total = sum(ind))']).join('; '); }
    else if (model === 7) body = `eM <- coef(lm(M1 ~ X * W${Cf}, d)); b <- coef(lm(Y ~ X + M1${Cf}, d))["M1"]; c((eM["X"] + eM["X:W"] * ws) * b, indice = unname(eM["X:W"] * b))`;
    else body = `a <- coef(lm(M1 ~ X${Cf}, d))["X"]; eY <- coef(lm(Y ~ X + M1 * W${Cf}, d)); c(a * (eY["M1"] + eY["M1:W"] * ws), indice = unname(a * eY["M1:W"]))`;
    const eqR = model === 4 ? Mn.map(m => `summary(lm(${m} ~ X${Cf}, d))`).concat([`summary(lm(Y ~ X + ${Mn.join(' + ')}${Cf}, d))`]) : model === 6 ? Mn.map((m, j) => `summary(lm(${m} ~ X${Mn.slice(0, j).map(z => ' + ' + z).join('')}${Cf}, d))`).concat([`summary(lm(Y ~ X + ${Mn.join(' + ')}${Cf}, d))`])
      : model === 7 ? [`summary(lm(M1 ~ X * W${Cf}, d))`, `summary(lm(Y ~ X + M1${Cf}, d))`] : [`summary(lm(M1 ~ X${Cf}, d))`, `summary(lm(Y ~ X + M1 * W${Cf}, d))`];
    sec.code = `# PROCESS, modelo ${model} (${MN}) con bootstrap percentil\n# Y = ${yN}; X = ${xN}${mNames.map((m, j) => `; ${Mn[j]} = ${m}`).join('')}${wN ? `; W = ${wN}` : ''}${cNames.map((c, j) => `; ${Cn[j]} = ${c}`).join('')}\n${dfCode}\nd <- d[complete.cases(d), ]\n` +
      (wN ? `ws <- ${wv.bin ? 'c(0, 1)' : 'quantile(d$W, c(.16, .5, .84))'}  # valores de W (como PROCESS v4)\n` : '') +
      `efectos <- function(d, i) { d <- d[i, ]; ${body} }\nset.seed(20261015)\nb <- boot::boot(d, efectos, R = 5000)\nb$t0  # estimaciones\nt(apply(b$t, 2, quantile, c(.025, .975)))  # IC 95 % percentil\n# Ecuaciones\n${eqR.join('\n')}\nsummary(lm(Y ~ X${Cf}, d))  # efecto total`;
    return sec;
  }
  function runMediation(yN, xN, mN) {
    const sec = { title: `Mediación: ${xN} → ${mN} → ${yN}`, test: 'Mediación simple (bootstrap)', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (new Set([yN, xN, mN]).size < 3) { sec.error = 'El predictor, el mediador y la variable dependiente deben ser distintos.'; return sec; }
    const xi = numOrBin(vByName(xN)), mv = numOf(vByName(mN)), yv = numOf(vByName(yN));
    if (!xi) { sec.error = 'El predictor debe ser cuantitativo o tener exactamente 2 categorías.'; return sec; }
    const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && mv[i] !== null && xi.vals[i] !== null), n = idx.length;
    if (n < 20) { sec.error = 'Hay muy pocos casos completos para estimar una mediación (se recomiendan bastantes más de 20).'; return sec; }
    const y = idx.map(i => yv[i]), x = idx.map(i => xi.vals[i]), m = idx.map(i => mv[i]);
    if (S.sd(x) === 0 || S.sd(m) === 0) { sec.error = 'El predictor o el mediador no varía.'; return sec; }
    const r = S.mediation(y, x, m, 5000);
    if (!r) { sec.error = 'No se pudo estimar el modelo (colinealidad perfecta).'; return sec; }
    const sigInd = r.ci[0] > 0 || r.ci[1] < 0, xL = xi.bin ? `${xN} (0 = ${xi.lv[0]}, 1 = ${xi.lv[1]})` : xN;
    sec.decision = `Se estimó un modelo de mediación simple (${esc(xN)} → ${esc(mN)} → ${esc(yN)}) con ${n} casos completos; el efecto indirecto se contrastó con un intervalo de confianza bootstrap de ${r.B} remuestras.`;
    sec.why.push(`Se quiere saber si ${esc(xN)} influye en ${esc(yN)} a través de ${esc(mN)}: el efecto indirecto es el producto de la ruta a (${esc(xN)} → ${esc(mN)}) por la ruta b (${esc(mN)} → ${esc(yN)}, controlando ${esc(xN)}).`);
    sec.why.push('El efecto indirecto no sigue una distribución normal, por eso se contrasta con un intervalo de confianza bootstrap (método percentil): es significativo si el intervalo no incluye el 0. Es el procedimiento recomendado (Hayes, PROCESS) frente a la prueba de Sobel o los pasos de Baron y Kenny.');
    sec.checks.push(chk('info', 'La mediación supone un orden causal (X antes que M, y M antes que Y). Con datos transversales, el análisis muestra que los datos son compatibles con ese modelo, pero no demuestra causalidad.'));
    sec.checks.push(chk(n >= 100 ? 'ok' : 'info', `Tamaño muestral: ${n} casos.${n >= 100 ? '' : ' Con muestras pequeñas el intervalo bootstrap es amplio y la potencia, baja.'}`));
    sec.alt = 'Mediación con varios mediadores o moderación de la mediación (modelos 7, 14 o 58 de PROCESS) si el diseño lo requiere.';
    const st = (k, nm) => [esc(nm), f(r[k], 3), f(r.se[k], 3), f(r.t[k]), pv(r.p[k])];
    sec.tables.push(apaTable('Rutas del modelo de mediación', ['Ruta', '<i>B</i>', '<i>EE</i>', '<i>t</i>', '<i>p</i>'],
      [st('a', `a: ${xN} → ${mN}`), st('b', `b: ${mN} → ${yN}`), st('cp', `c′ (directo): ${xN} → ${yN}`), st('c', `c (total): ${xN} → ${yN}`)],
      `<i>R</i>² de ${esc(mN)} = ${nz(r.r2m.toFixed(3))}; <i>R</i>² de ${esc(yN)} = ${nz(r.r2y.toFixed(3))}.${xi.bin ? ` ${esc(xL)}.` : ''}`));
    sec.tables.push(apaTable('Efecto indirecto', ['Efecto', '<i>B</i>', '<i>EE</i> bootstrap', 'IC 95 % bootstrap', 'Estandarizado'],
      [[`${esc(xN)} → ${esc(mN)} → ${esc(yN)}`, f(r.ab, 3), f(r.bootSe, 3), `[${f(r.ci[0], 3)}, ${f(r.ci[1], 3)}]`, f(r.abStd, 3)]],
      `IC bootstrap percentil con ${r.B} remuestras (al ser un procedimiento aleatorio, otra ejecución o R pueden diferir en la tercera cifra decimal). Prueba de Sobel, como referencia: <i>z</i> = ${f(r.sobel.z)}, ${pt(r.sobel.p)}.`));
    const star = p => (p < .001 ? '***' : p < .01 ? '**' : p < .05 ? '*' : '');
    sec.charts.push(fig('Diagrama del modelo de mediación', CH.pathDiagram(xN, mN, yN, { a: `a = ${f(r.a, 2)}${star(r.p.a)}`, b: `b = ${f(r.b, 2)}${star(r.p.b)}`, c: `c′ = ${f(r.cp, 2)}${star(r.p.cp)} (c = ${f(r.c, 2)}${star(r.p.c)})` }), '<div class="small muted" style="margin:0 0 6px">Coeficientes no estandarizados. * <i>p</i> &lt; .05, ** <i>p</i> &lt; .01, *** <i>p</i> &lt; .001.</div>'));
    let t = `Se analizó si ${esc(mN)} mediaba la relación entre ${esc(xN)} y ${esc(yN)} mediante un modelo de mediación simple con intervalos de confianza bootstrap (${r.B} remuestras). `;
    t += `${esc(xN)} ${r.p.a < .05 ? 'predijo significativamente' : 'no predijo significativamente'} ${esc(mN)} (<i>a</i> = ${f(r.a, 2)}, ${pt(r.p.a)}), y ${esc(mN)} ${r.p.b < .05 ? 'predijo significativamente' : 'no predijo significativamente'} ${esc(yN)} controlando ${esc(xN)} (<i>b</i> = ${f(r.b, 2)}, ${pt(r.p.b)}). `;
    t += sigInd ? `El efecto indirecto fue estadísticamente significativo, <i>ab</i> = ${f(r.ab, 3)}, IC 95 % [${f(r.ci[0], 3)}, ${f(r.ci[1], 3)}]. ` : `El efecto indirecto no fue estadísticamente significativo, <i>ab</i> = ${f(r.ab, 3)}, IC 95 % [${f(r.ci[0], 3)}, ${f(r.ci[1], 3)}]. `;
    t += `El efecto total de ${esc(xN)} sobre ${esc(yN)} ${r.p.c < .05 ? 'fue' : 'no fue'} significativo (<i>c</i> = ${f(r.c, 2)}, ${pt(r.p.c)}) y el efecto directo, controlando ${esc(mN)}, ${r.p.cp < .05 ? 'siguió siendo significativo' : 'no fue significativo'} (<i>c′</i> = ${f(r.cp, 2)}, ${pt(r.p.cp)}).`;
    sec.text.push(t);
    sec.code = `# Mediación: ${xN} → ${mN} → ${yN} (bootstrap percentil)\nd <- data.frame(X = ${rCode01(xN, xi)}, M = datos[[${rq(mN)}]], Y = datos[[${rq(yN)}]])\nd <- d[complete.cases(d), ]\n` +
      `ruta_a <- lm(M ~ X, data = d); ruta_bc <- lm(Y ~ X + M, data = d); total <- lm(Y ~ X, data = d)\nsummary(ruta_a); summary(ruta_bc); summary(total)\n` +
      `set.seed(2026)\nindirecto <- replicate(5000, { i <- sample(nrow(d), replace = TRUE); coef(lm(M ~ X, data = d[i, ]))[["X"]] * coef(lm(Y ~ X + M, data = d[i, ]))[["M"]] })\n` +
      `coef(ruta_a)[["X"]] * coef(ruta_bc)[["M"]]  # efecto indirecto\nquantile(indirecto, c(.025, .975))  # IC 95 % bootstrap`;
    return sec;
  }

  function runEfa(names, nSel, rot, ext = 'pa') {
    const PCA = ext === 'pca', EXT = { pa: 'ejes principales', minres: 'mínimos residuos (MinRes)', ml: 'máxima verosimilitud', pca: 'componentes principales' }[ext];
    const OBL = ['oblimin', 'promax', 'geomin'].includes(rot), U = PCA ? 'componente' : 'factor', Us = PCA ? 'componentes' : 'factores';
    const ROTN = { oblimin: 'oblimin', promax: 'promax', geomin: 'geomin', varimax: 'varimax', quartimax: 'quartimax', equamax: 'equamax', none: 'sin rotación' }[rot] || rot;
    const sec = { title: PCA ? 'Análisis de componentes principales' : 'Análisis factorial exploratorio', test: '', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    const vars = names.map(vByName).filter(v => v && v.type === 'num'), p = vars.length;
    if (p < 3) { sec.error = 'Selecciona al menos tres ítems cuantitativos.'; return sec; }
    const cols = vars.map(numOf), idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null)), n = idx.length;
    if (n < p + 2) { sec.error = `Hay muy pocos casos completos (${n}) para ${p} ítems.`; return sec; }
    const X = idx.map(i => cols.map(c => c[i]));
    if (vars.some((_, j) => S.sd(X.map(r => r[j])) === 0)) { sec.error = 'Algún ítem tiene el mismo valor en todos los casos. Exclúyelo.'; return sec; }
    const R = S.corMatrix(X), adec = S.kmoBartlett(R, n);
    if (!adec || !isFinite(adec.kmo)) { sec.error = 'La matriz de correlaciones es singular: algún ítem es combinación exacta de otros (por ejemplo, un total de la escala). Exclúyelo.'; return sec; }
    const eig = S.eigSym(R).values, pa = S.parallelAnalysis(n, p, eig, 100);
    let m = nSel === 'auto' ? pa.nfactors : +nSel, auto = nSel === 'auto';
    if (m < 1) { m = 1; sec.checks.push(chk('no', 'El análisis paralelo no indica ningún factor por encima del azar: los ítems apenas comparten varianza. Se muestra la solución de un factor solo como referencia.')); }
    if (m > p - 1) m = p - 1;
    const r = S.efa(X, m, rot, ext), names2 = vars.map(v => v.name), F = Array.from({ length: m }, (_, j) => `${PCA ? 'C' : 'F'}${j + 1}`);
    const kq = r.adec.kmo, kl = kq >= .9 ? 'excelente' : kq >= .8 ? 'muy buena' : kq >= .7 ? 'buena' : kq >= .6 ? 'aceptable' : kq >= .5 ? 'pobre' : 'inaceptable';
    sec.test = `${PCA ? 'Análisis de componentes principales' : `Análisis factorial exploratorio (${EXT}`}${m > 1 && rot !== 'none' ? `${PCA ? ' (' : ', '}rotación ${ROTN})` : PCA ? '' : ')'}`;
    sec.decision = `Se realizó un análisis factorial exploratorio de ${p} ítems con ${n} casos completos, extrayendo ${m} ${m > 1 ? Us : U} ${auto ? 'según el análisis paralelo' : '(número elegido por ti)'} por ${EXT}${m > 1 ? ` con rotación ${rot}` : ''}.`;
    sec.why.push('El análisis factorial exploratorio estudia qué dimensiones subyacen a un conjunto de ítems: qué ítems «van juntos» porque miden lo mismo.');
    sec.why.push({ pa: 'Se usa la extracción por ejes principales, que no exige normalidad multivariante y es robusta con escalas tipo Likert.',
      minres: 'Extracción por mínimos residuos (MinRes/ULS): minimiza las correlaciones no explicadas; no exige normalidad multivariante y es la opción por defecto de psych y jamovi.',
      ml: 'Extracción por máxima verosimilitud: permite contrastar el ajuste del modelo (χ², RMSEA, TLI), pero asume normalidad multivariante.',
      pca: 'Análisis de componentes principales: resume la varianza total de los ítems en pocos componentes. A diferencia del análisis factorial, no separa la varianza común del error; es útil para reducir datos, no para estudiar constructos latentes.' }[ext]);
    sec.why.push(auto ? 'El número de factores lo decide el análisis paralelo de Horn: se retienen los factores cuyos autovalores superan el percentil 95 de los obtenidos con datos aleatorios del mismo tamaño. Es más fiable que el criterio de autovalor mayor que 1.' : 'Has fijado tú el número de factores; el análisis paralelo se muestra como referencia.');
    if (m > 1) sec.why.push(rot === 'none' ? 'Sin rotación: solución inicial, difícil de interpretar con varios factores.' : OBL ? `Rotación ${ROTN} (oblicua): permite que los ${Us} correlacionen, lo habitual en constructos psicológicos y educativos.` : `Rotación ${ROTN} (ortogonal): obliga a que los ${Us} sean independientes entre sí.`);
    sec.checks.push(chk(kq >= .6 ? 'ok' : 'no', `Adecuación muestral (KMO) = ${nz(kq.toFixed(3))}: ${kl}.${kq < .6 ? ' Por debajo de .60 el análisis factorial no es recomendable.' : ''}`));
    const lowMsa = vars.filter((_, j) => r.adec.msa[j] < .5);
    if (lowMsa.length) sec.checks.push(chk('no', `Ítems con adecuación individual (MSA) < .50: ${list(lowMsa.map(v => esc(v.name)))}. Considera eliminarlos.`));
    const B = r.adec.bartlett;
    sec.checks.push(chk(B.p < .05 ? 'ok' : 'no', `Esfericidad de Bartlett: χ²(${B.df}) = ${f(B.chi)}, ${pt(B.p)}. ${B.p < .05 ? 'Los ítems están suficientemente correlacionados.' : 'Los ítems no están correlacionados: el análisis factorial no tiene sentido.'}`));
    sec.checks.push(chk(n >= 200 ? 'ok' : n >= 100 ? 'info' : 'no', `Tamaño muestral: ${n} casos (${f(n / p, 1)} por ítem).${n >= 200 ? '' : n >= 100 ? ' Aceptable; con comunalidades altas los resultados son estables.' : ' Pequeño: los resultados pueden ser inestables.'}`));
    const prim = r.L.map(row => { const a = row.map(Math.abs), mx = Math.max(...a); return { j: a.indexOf(mx), mx, cross: a.filter(v => v >= .32).length > 1 }; });
    const weak = vars.filter((_, i) => prim[i].mx < .4), cross = vars.filter((_, i) => prim[i].cross && prim[i].mx >= .4), hey = vars.filter((_, i) => r.h2[i] > 1);
    sec.checks.push(weak.length ? chk('no', `Ítems sin ninguna carga ≥ .40: ${list(weak.map(v => esc(v.name)))}. No se asocian claramente a ningún factor.`) : chk('ok', 'Todos los ítems tienen al menos una carga ≥ .40.'));
    if (cross.length) sec.checks.push(chk('info', `Ítems con cargas cruzadas (≥ .32 en más de un factor): ${list(cross.map(v => esc(v.name)))}.`));
    if (hey.length) sec.warn = `Caso Heywood: ${list(hey.map(v => esc(v.name)))} ${hey.length > 1 ? 'tienen' : 'tiene'} una comunalidad mayor que 1, lo que indica un problema en la solución (demasiados factores o muestra pequeña). Prueba con menos factores.`;
    if (!r.converged && ext === 'pa') sec.checks.push(chk('no', 'La extracción no convergió del todo en 50 iteraciones: interpreta con cautela.'));
    if (ext === 'ml' && r.fit && isFinite(r.fit.p)) { const ok = r.fit.rmsea <= .08 && r.fit.tli >= .90;
      sec.tables.push(apaTable('Ajuste del modelo (máxima verosimilitud)', ['χ²', '<i>gl</i>', '<i>p</i>', 'RMSEA', 'TLI'], [[f(r.fit.chi), r.fit.df, pv(r.fit.p), nz(r.fit.rmsea.toFixed(3)), nz(r.fit.tli.toFixed(3))]],
        'χ² con la corrección de Bartlett; RMSEA y TLI calculados como en psych (los que muestran JASP y jamovi). Orientativo: RMSEA ≤ .08 y TLI ≥ .90 indican un ajuste aceptable.'));
      sec.checks.push(chk(ok ? 'ok' : 'info', `Ajuste del modelo: RMSEA = ${nz(r.fit.rmsea.toFixed(3))}, TLI = ${nz(r.fit.tli.toFixed(3))}.${ok ? ' Ajuste aceptable.' : ' Ajuste mejorable: valora otro número de factores.'} El χ² (${pt(r.fit.p)}) es muy sensible al tamaño muestral.`)); }
    const neg = vars.filter((_, i) => r.L[i][prim[i].j] < -.3);
    if (neg.length) sec.checks.push(chk('info', `Cargas negativas en ${list(neg.map(v => esc(v.name)))}: probablemente son ítems inversos; recodifícalos antes de calcular puntuaciones o la fiabilidad.`));
    sec.tables.push(apaTable('Adecuación de los datos al análisis factorial', ['KMO', 'χ² de Bartlett', '<i>gl</i>', '<i>p</i>', '<i>n</i>', 'Ítems'], [[nz(kq.toFixed(3)), f(B.chi), B.df, pv(B.p), n, p]]));
    const kk = Math.min(p, 10);
    sec.tables.push(apaTable('Autovalores y análisis paralelo', [PCA ? 'Componente' : 'Factor', 'Autovalor', '% varianza', 'Percentil 95 aleatorio', 'Retener'],
      eig.slice(0, kk).map((e, j) => [j + 1, f(e), f(e / p * 100, 1), f(pa.p95[j]), e > pa.p95[j] && j < pa.nfactors ? 'Sí' : 'No']), 'Autovalores de la matriz de correlaciones. Análisis paralelo con 100 conjuntos de datos aleatorios.'));
    const bold = v => (Math.abs(v) >= .4 ? `<b>${r2s(v)}</b>` : r2s(v));
    sec.tables.push(apaTable(`${PCA ? 'Cargas en los componentes' : 'Cargas factoriales'}${m > 1 && rot !== 'none' ? (OBL ? ' (matriz de configuración)' : ' rotadas') : ''}`, ['Ítem'].concat(F).concat(['<i>h</i>²', '<i>u</i>²']),
      names2.map((nm, i) => [esc(nm)].concat(r.L[i].map(bold)).concat([nz(r.h2[i].toFixed(2)), nz(r.u2[i].toFixed(2))])),
      `Extracción por ${EXT}${m > 1 ? `, ${rot === 'none' ? 'sin rotación' : `rotación ${ROTN}`}` : ''}. En negrita, cargas ≥ .40. <i>h</i>² = comunalidad; <i>u</i>² = unicidad.`));
    let cum = 0;
    sec.tables.push(apaTable('Varianza explicada', [PCA ? 'Componente' : 'Factor', 'SC de las cargas', '% varianza'].concat(m > 1 && !OBL ? ['% acumulado'] : []),
      F.map((fn, j) => { cum += r.prop[j]; return [fn, f(r.ss[j]), f(r.prop[j] * 100, 1)].concat(m > 1 && !OBL ? [f(cum * 100, 1)] : []); }),
      m > 1 && OBL ? 'Con rotación oblicua los factores comparten varianza y los porcentajes no se suman.' : ''));
    if (m > 1 && OBL) sec.tables.push(apaTable('Correlaciones entre factores', [''].concat(F), F.map((fn, a) => [fn].concat(F.map((_, b) => (a === b ? '—' : b < a ? r2s(r.Phi[a][b]) : ''))))));
    sec.charts.push(fig('Gráfico de sedimentación y análisis paralelo', CH.scree(eig.slice(0, Math.min(p, 15)), pa.p95.slice(0, Math.min(p, 15))), CH.legend(['Datos observados', 'Aleatorio (percentil 95)'])));
    const total = OBL && m > 1 ? null : S.sum(r.prop);
    let t = `Se realizó un ${PCA ? 'análisis de componentes principales' : `análisis factorial exploratorio con extracción por ${EXT}`}${m > 1 && rot !== 'none' ? ` y rotación ${ROTN}` : ''} sobre los ${p} ítems (<i>n</i> = ${n}). La medida de adecuación muestral de Kaiser-Meyer-Olkin fue ${kl} (KMO = ${nz(kq.toFixed(2))}) y la prueba de esfericidad de Bartlett ${B.p < .05 ? 'fue' : 'no fue'} significativa, χ²(${B.df}) = ${f(B.chi)}, ${pt(B.p)}. `;
    t += auto ? `El análisis paralelo indicó retener ${m} ${m > 1 ? Us : U}` : `Se extrajeron ${m} ${m > 1 ? Us : U}`;
    t += total !== null ? `, que ${m > 1 ? 'explicaron' : 'explicó'} el ${f(total * 100, 1)} % de la varianza. ` : '. ';
    t += F.map((fn, j) => { const its = vars.filter((_, i) => prim[i].j === j && prim[i].mx >= .4); if (!its.length) return `Ningún ítem cargó de forma destacada en el ${U} ${j + 1}.`;
      const ld = its.map(v => Math.abs(r.L[names2.indexOf(v.name)][j])), ng = its.filter(v => r.L[names2.indexOf(v.name)][j] < 0);
      return `${m > 1 ? `El ${U} ${j + 1} agrupó` : `El ${U} agrupó`} ${its.length === 1 ? 'el ítem' : 'los ítems'} ${list(its.map(v => esc(v.name)))} (cargas ${its.length === 1 ? 'de' : 'entre'} ${nz(Math.min(...ld).toFixed(2))}${its.length > 1 ? ` y ${nz(Math.max(...ld).toFixed(2))}` : ''}${ng.length ? ` en valor absoluto; ${list(ng.map(v => esc(v.name)))} con carga negativa, propia de un ítem inverso` : ''}).`; }).join(' ');
    if (m > 1 && OBL) { const cs = []; for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) cs.push(r.Phi[a][b]); t += cs.length === 1 ? ` La correlación entre los dos ${Us} fue ${r2s(cs[0])}.` : ` Las correlaciones entre ${Us} oscilaron entre ${r2s(Math.min(...cs))} y ${r2s(Math.max(...cs))}.`; }
    if (weak.length) t += ` ${list(weak.map(v => esc(v.name)))} no ${weak.length > 1 ? 'mostraron' : 'mostró'} cargas ≥ .40 en ningún factor.`;
    sec.text.push(t);
    sec.alt = 'Análisis factorial confirmatorio (por ejemplo, con lavaan en R) para contrastar una estructura teórica definida a priori. Con ítems ordinales de pocas categorías, puede usarse la matriz de correlaciones policóricas.';
    const Q = names2.map(rq).join(', ');
    sec.code = `# Análisis factorial exploratorio\nitems <- datos[complete.cases(datos[, c(${Q})]), c(${Q})]\npsych::KMO(items)\npsych::cortest.bartlett(cor(items), n = nrow(items))\npsych::fa.parallel(items, fm = "pa", fa = "pc", n.iter = 100, quant = .95)\n` +
      (PCA ? `afe <- psych::principal(items, nfactors = ${m}, rotate = "${m > 1 ? rot : 'none'}")` : `afe <- psych::fa(items, nfactors = ${m}, fm = "${ext}", rotate = "${m > 1 ? (rot === 'geomin' ? 'geominQ' : rot) : 'none'}")`) +
      `\nprint(afe$loadings, cutoff = .3, sort = TRUE)\nafe$communality` + (m > 1 && OBL ? '\nafe$Phi' : '') + (ext === 'ml' ? '\nafe$STATISTIC; afe$dof; afe$PVAL; afe$RMSEA; afe$TLI  # ajuste' : '');
    return sec;
  }

  function runAlpha(names, reversed) {
    const sec = { title: 'Fiabilidad: alfa de Cronbach', test: 'Alfa de Cronbach', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    const vars = names.map(vByName).filter(v => v && v.type === 'num');
    if (vars.length < 2) { sec.error = 'Selecciona al menos dos ítems cuantitativos.'; return sec; }
    const cols = vars.map(numOf), idx = ST.rows.map((_, i) => i).filter(i => cols.every(c => c[i] !== null));
    if (idx.length < 3) { sec.error = 'Hay muy pocos casos con todos los ítems respondidos.'; return sec; }
    let items = cols.map(c => idx.map(i => c[i]));
    const lo = Math.min(...items.flat()), hi = Math.max(...items.flat()), rev = vars.map(v => reversed.includes(v.name));
    items = items.map((it, j) => (rev[j] ? it.map(x => lo + hi - x) : it));
    if (items.some(it => S.sd(it) === 0)) { sec.error = 'Algún ítem tiene varianza 0 (todas las respuestas iguales). Exclúyelo.'; return sec; }
    const r = S.cronbach(items), n = r.n, a = r.alpha, om = S.omegaTotal(items[0].map((_, i) => items.map(it => it[i]))).omega;
    const qual = a >= .9 ? 'excelente' : a >= .8 ? 'buena' : a >= .7 ? 'aceptable' : a >= .6 ? 'cuestionable' : a >= .5 ? 'pobre' : 'inaceptable';
    sec.decision = `Se calcula el alfa de Cronbach de ${vars.length} ítems con ${n} casos completos${rev.some(Boolean) ? `, invirtiendo ${list(vars.filter((_, j) => rev[j]).map(v => esc(v.name)))}` : ''}.`;
    sec.why.push('El alfa de Cronbach estima la consistencia interna: si los ítems de una escala miden un mismo constructo.');
    sec.why.push('Es el índice de fiabilidad más solicitado en TFM, tesis y artículos al usar cuestionarios.');
    sec.why.push('Criterio orientativo (George y Mallery): ≥ .90 excelente, ≥ .80 bueno, ≥ .70 aceptable, ≥ .60 cuestionable, ≥ .50 pobre.');
    if (rev.some(Boolean)) sec.why.push(`Los ítems inversos se recodifican como (${lo} + ${hi}) − respuesta antes del cálculo.`);
    const neg = vars.filter((_, j) => r.stats[j].rit < 0), low = vars.filter((_, j) => r.stats[j].rit >= 0 && r.stats[j].rit < .3);
    const better = vars.filter((_, j) => r.stats[j].alphaDel > a + .01);
    if (neg.length) sec.warn = `${list(neg.map(v => esc(v.name)))} ${neg.length > 1 ? 'correlacionan' : 'correlaciona'} negativamente con el resto de la escala. Probablemente ${neg.length > 1 ? 'son ítems inversos' : 'es un ítem inverso'}: márcalo en «Ítems inversos» y vuelve a generar el análisis.`;
    sec.checks.push(neg.length || low.length ? chk('no', `Ítems con correlación ítem-total corregida baja (< .30): ${list(neg.concat(low).map(v => esc(v.name)))}.`) : chk('ok', 'Todos los ítems tienen una correlación ítem-total corregida ≥ .30.'));
    if (better.length) sec.checks.push(chk('info', `Eliminar ${list(better.map(v => esc(v.name)))} aumentaría el alfa. Valóralo según el contenido del ítem, no solo por el número.`));
    sec.checks.push(chk(vars.length >= 3 ? 'ok' : 'no', `Número de ítems: ${vars.length}.${vars.length < 3 ? ' Con 2 ítems el alfa es poco informativo; considera la correlación de Spearman-Brown.' : ''}`));
    sec.checks.push(chk('info', `El alfa asume que todos los ítems miden un único factor con cargas similares (tau-equivalencia). Por eso se informa también el omega de McDonald (ω = ${nz(om.toFixed(3))}), que no lo exige${Math.abs(om - a) > .03 ? '; aquí difieren, así que conviene informar sobre todo el omega' : '; aquí ambos coinciden prácticamente'}.`));
    sec.tables.push(apaTable('Fiabilidad de la escala', ['α de Cronbach', 'α estandarizado', 'ω de McDonald', '<i>r</i> media inter-ítem', 'Ítems', '<i>n</i>', '<i>M</i> (total)', '<i>DT</i> (total)'],
      [[nz(a.toFixed(3)), nz(r.alphaStd.toFixed(3)), nz(om.toFixed(3)), r2s(r.rbar), r.k, n, f(r.totalMean), f(r.totalSd)]], 'ω de McDonald (total) estimado con un modelo de un factor por ejes principales.'));
    sec.tables.push(apaTable('Estadísticos de los ítems', ['Ítem', '<i>M</i>', '<i>DT</i>', 'Correlación ítem-total corregida', 'α si se elimina el ítem'],
      vars.map((v, j) => [esc(v.name) + (rev[j] ? ' (invertido)' : ''), f(r.stats[j].mean), f(r.stats[j].sd), r2s(r.stats[j].rit), isFinite(r.stats[j].alphaDel) ? nz(r.stats[j].alphaDel.toFixed(3)) : '—'])));
    let t = `La consistencia interna de la escala formada por ${vars.length} ítems fue ${qual}, α = ${nz(a.toFixed(2))}, ω = ${nz(om.toFixed(2))} (<i>n</i> = ${n}).`;
    t += ` Las correlaciones ítem-total corregidas oscilaron entre ${r2s(Math.min(...r.stats.map(s => s.rit)))} y ${r2s(Math.max(...r.stats.map(s => s.rit)))}.`;
    if (rev.some(Boolean)) t += ` ${list(vars.filter((_, j) => rev[j]).map(v => esc(v.name)))} se ${rev.filter(Boolean).length > 1 ? 'recodificaron' : 'recodificó'} de forma inversa antes del análisis.`;
    sec.text.push(t);
    const keys = vars.filter((_, j) => rev[j]).map(v => rq(v.name));
    sec.code = `# Fiabilidad (alfa de Cronbach y omega de McDonald)\npsych::alpha(datos[, c(${vars.map(v => rq(v.name)).join(', ')})]${keys.length ? `, keys = c(${keys.join(', ')})` : ''})\n` +
      `it <- datos[complete.cases(datos[, c(${vars.map(v => rq(v.name)).join(', ')})]), c(${vars.map(v => rq(v.name)).join(', ')})]\n` + (keys.length ? `for (k in c(${keys.join(', ')})) it[[k]] <- ${lo} + ${hi} - it[[k]]  # ítems inversos\n` : '') +
      `l <- as.numeric(psych::fa(it, nfactors = 1, fm = "pa")$loadings); l <- l * sign(sum(l))\nsum(l)^2 / (sum(l)^2 + sum(1 - l^2))  # omega total`;
    return sec;
  }

  // Regresión logística multinomial u ordinal (variable dependiente con 3 o más categorías)
  function runPolyLogit(yName, xNames, model) {
    const sec = { title: `Regresión logística: ${yName}`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    xNames = xNames.filter(n => n !== yName);
    if (!xNames.length) { sec.error = 'Selecciona al menos un predictor distinto de la variable dependiente.'; return sec; }
    const yv = vByName(yName), ycat = catOf(yv); let { idx, cols, X } = design(xNames, i => ycat[i] !== null);
    const lv = ordOf(yv, idx.map(i => ycat[i])), K = lv.length, y = idx.map(i => lv.indexOf(ycat[i])), n = idx.length;
    if (K < 3) { sec.error = 'La variable dependiente necesita al menos 3 categorías con datos (con 2, usa la regresión logística binaria).'; return sec; }
    const ordered = model === 'ordinal' || (model === 'auto' && !!(yv.order && (yv.orderUser || yv.orderNote || (yv.hint && /ordinal/i.test(yv.hint.note || '')))));
    const ORD = ordered, p = cols.length, cnt = lv.map((_, k) => y.filter(v => v === k).length);
    if (cnt.some(c => c < 2)) { sec.error = `Alguna categoría tiene menos de 2 casos (${lv.map((l, k) => `${esc(l)}: ${cnt[k]}`).join(', ')}). Agrupa categorías en «Preparar los datos».`; return sec; }
    const fit = cs => { const Xs = X.map(r => cs.map(j => r[j])); return ORD ? S.ordinalLogit(Xs.map(r => r.slice(1)), y, K) : S.multinomial(Xs, y, K); };
    const all = cols.map((_, j) => j), m = fit(all);
    if (!m || !isFinite(m.ll)) { sec.error = 'El modelo no converge (separación perfecta o colinealidad entre predictores). Reduce los predictores o agrupa categorías.'; return sec; }
    sec.test = ORD ? 'Regresión logística ordinal (odds proporcionales)' : 'Regresión logística multinomial';
    const pr = S.pseudoR2(m.ll, m.ll0, n), dfM = ORD ? p - 1 : (K - 1) * (p - 1), LR = 2 * (m.ll - m.ll0), pLR = 1 - jStat.chisquare.cdf(LR, dfM);
    const nPar = ORD ? (K - 1) + (p - 1) : (K - 1) * p, aic = -2 * m.ll + 2 * nPar;
    sec.why.push(`Variable dependiente: ${esc(yName)} con ${K} categorías (${list(lv.map(esc))}).`);
    sec.why.push(ORD ? `Las categorías están ordenadas (${lv.map(esc).join(' < ')}), así que se usa el modelo de odds proporcionales: un único coeficiente por predictor que indica si aumenta la probabilidad de estar en categorías más altas. Comprueba que el orden es el correcto (botón «Orden» en Variables).`
      : `Las categorías no tienen un orden natural, así que se usa la regresión multinomial: cada categoría se compara con la de referencia («${esc(lv[0])}»), con sus propios coeficientes.`);
    sec.decision = `Se ajustó una regresión logística ${ORD ? 'ordinal de odds proporcionales' : 'multinomial'} de ${esc(yName)} con ${n} casos completos.`;
    sec.alt = ORD ? 'Si no se cumple el supuesto de odds proporcionales, la regresión multinomial (ignora el orden) o un modelo ordinal parcialmente proporcional.' : 'Si las categorías tienen orden, la regresión ordinal es más parsimoniosa y potente.';
    // contrastes de razón de verosimilitudes de cada predictor (modelo sin ese término)
    const lrt = xNames.map(t => { const keep = all.filter(j => j === 0 || cols[j].v.name !== t), r = fit(keep), dfT = (ORD ? 1 : K - 1) * (all.length - keep.length), ch = 2 * (m.ll - r.ll); return { t, ch, df: dfT, p: 1 - jStat.chisquare.cdf(ch, dfT) }; });
    sec.tables.push(apaTable('Ajuste del modelo', ['−2LL (nulo)', '−2LL (modelo)', 'χ²', '<i>gl</i>', '<i>p</i>', '<i>R</i>² McFadden', '<i>R</i>² Cox-Snell', '<i>R</i>² Nagelkerke', 'AIC'],
      [[f(-2 * m.ll0), f(-2 * m.ll), f(LR), dfM, pv(pLR), nz(pr.mcfadden.toFixed(3)), nz(pr.coxsnell.toFixed(3)), nz(pr.nagelkerke.toFixed(3)), f(aic)]], 'χ² = razón de verosimilitudes frente al modelo sin predictores.'));
    sec.tables.push(apaTable('Contrastes de razón de verosimilitudes de cada predictor', ['Predictor', 'χ²', '<i>gl</i>', '<i>p</i>'], lrt.map(o => [esc(o.t), f(o.ch), o.df, pv(o.p)]), 'Compara el modelo completo con el modelo sin ese predictor (como SPSS).'));
    const z = 1.959963984540054, orRow = (lab, b, se) => { const zz = b / se; return [lab, f(b, 3), f(se, 3), f(zz), pv(2 * (1 - jStat.normal.cdf(Math.abs(zz), 0, 1))), f(Math.exp(b)), `[${f(Math.exp(b - z * se))}, ${f(Math.exp(b + z * se))}]`]; };
    if (ORD) {
      sec.tables.push(apaTable('Coeficientes de la regresión ordinal', ['Término', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'OR', 'IC 95 % (OR)'],
        cols.slice(1).map((c, j) => orRow(esc(c.name), m.beta[j], m.seBeta[j])), 'OR > 1: más probabilidad de estar en categorías más altas. Signo como en SPSS y polr (logit P(Y ≤ j) = θ<sub>j</sub> − <i>x</i>β).'));
      sec.tables.push(apaTable('Umbrales', ['Umbral', 'θ', '<i>EE</i>'], m.theta.map((t, j) => [`${esc(lv[j])} | ${esc(lv[j + 1])}`, f(t, 3), f(m.seTheta[j], 3)])));
      const grp = xNames.map(t => cols.slice(1).map((c, j) => (c.v.name === t ? j : -1)).filter(j => j >= 0)), bt = S.brantTest(X.map(r => r.slice(1)), y, K, grp);
      if (bt && isFinite(bt.omnibus.chi)) {
        sec.tables.push(apaTable('Prueba de Brant del supuesto de odds proporcionales', ['', 'χ²', '<i>gl</i>', '<i>p</i>'], [['Global', f(bt.omnibus.chi), bt.omnibus.df, pv(bt.omnibus.p)]].concat(xNames.map((t, q) => [esc(t), f(bt.byVar[q].chi), bt.byVar[q].df, pv(bt.byVar[q].p)])),
          'Un resultado significativo indica que el efecto de ese predictor cambia entre los cortes de la variable dependiente (no se cumplen las odds proporcionales). Brant (1990).'));
        const bad = xNames.filter((_, q) => bt.byVar[q].p < .05);
        sec.checks.push(chk(bt.omnibus.p >= .05 && !bad.length ? 'ok' : 'no', `Odds proporcionales (prueba de Brant): χ²(${bt.omnibus.df}) = ${f(bt.omnibus.chi)}, ${pt(bt.omnibus.p)}.${bt.omnibus.p >= .05 && !bad.length ? ' Se cumple.' : ` No se cumple${bad.length ? ` (${list(bad.map(esc))})` : ''}: considera la regresión multinomial o un modelo ordinal parcialmente proporcional.`}`));
      } else sec.checks.push(chk('info', 'No se pudo calcular la prueba de Brant (algún corte tiene muy pocos casos). Revisa el supuesto de odds proporcionales con la regresión multinomial.'));
    } else {
      const rows = []; m.B.forEach((bk, k) => bk.forEach((b, j) => rows.push(orRow(j === 0 ? `<b>${esc(lv[k + 1])}</b> vs. ${esc(lv[0])}: ${esc(cols[j].name)}` : `&nbsp;&nbsp;&nbsp;${esc(cols[j].name)}`, b, m.SE[k][j]))));
      sec.tables.push(apaTable(`Coeficientes de la regresión multinomial (referencia: ${lv[0]})`, ['Término', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'OR', 'IC 95 % (OR)'], rows, 'OR = odds ratio de pertenecer a esa categoría frente a la de referencia. Contrastes de Wald.'));
    }
    const corr = y.filter((v, i) => v === m.pred[i]).length;
    sec.tables.push(apaTable('Tabla de clasificación', ['Observado'].concat(lv.map(l => `Predicho: ${esc(l)}`)).concat(['% correcto']),
      lv.map((l, k) => [esc(l)].concat(lv.map((_, q) => y.filter((v, i) => v === k && m.pred[i] === q).length)).concat([f(y.filter((v, i) => v === k && m.pred[i] === k).length / cnt[k] * 100, 1)])),
      `Porcentaje global correcto: ${f(corr / n * 100, 1)} % (asignando cada caso a la categoría más probable).`));
    if (n < 10 * nPar) sec.checks.push(chk('no', `Tamaño muestral: ${n} casos para ${nPar} parámetros. Se recomiendan al menos 10 casos por parámetro: los coeficientes pueden ser inestables.`));
    const sigT = lrt.filter(o => o.p < .05);
    sec.text.push(`Se realizó una regresión logística ${ORD ? 'ordinal de odds proporcionales' : `multinomial (categoría de referencia: ${esc(lv[0])})`} para predecir ${esc(yName)} a partir de ${list(xNames.map(esc))}. El modelo ${pLR < .05 ? 'fue' : 'no fue'} estadísticamente significativo frente al modelo nulo, χ²(${dfM}, <i>N</i> = ${n}) = ${f(LR)}, ${pt(pLR)}, <i>R</i>² de Nagelkerke = ${nz(pr.nagelkerke.toFixed(2))}, y clasificó correctamente al ${f(corr / n * 100, 1)} % de los casos. ` +
      (sigT.length ? `${list(sigT.map(o => esc(o.t)))} ${sigT.length > 1 ? 'contribuyeron' : 'contribuyó'} significativamente al modelo (${sigT.map(o => `${esc(o.t)}: χ²(${o.df}) = ${f(o.ch)}, ${pt(o.p)}`).join('; ')}).` : 'Ningún predictor contribuyó significativamente al modelo.') +
      (ORD ? ' ' + cols.slice(1).map((c, j) => { const b = m.beta[j], se = m.seBeta[j], pp = 2 * (1 - jStat.normal.cdf(Math.abs(b / se), 0, 1)); return pp < .05 ? `${esc(c.name)} se asoció con una ${b > 0 ? 'mayor' : 'menor'} probabilidad de categorías más altas (OR = ${f(Math.exp(b))}, IC 95 % [${f(Math.exp(b - z * se))}, ${f(Math.exp(b + z * se))}], ${pt(pp)}).` : ''; }).filter(Boolean).join(' ') : ''));
    const fml = `${xNames.map(rn).join(' + ')}`, Yf = `factor(datos[[${rq(yName)}]], levels = c(${lv.map(rq).join(', ')})${ORD ? ', ordered = TRUE' : ''})`;
    sec.code = `# Regresión logística ${ORD ? 'ordinal' : 'multinomial'}: ${yName}\nd <- datos; d$.y <- ${Yf}\nd <- d[complete.cases(d[, c(".y", ${xNames.map(rq).join(', ')})]), ]\n` +
      (ORD ? `modelo <- MASS::polr(.y ~ ${fml}, data = d, Hess = TRUE)\nsummary(modelo)\nexp(cbind(OR = coef(modelo), confint.default(modelo)[names(coef(modelo)), ]))\ncar::Anova(modelo, type = 3)  # razón de verosimilitudes de cada predictor\nif (requireNamespace("brant", quietly = TRUE)) brant::brant(modelo)  # odds proporcionales\n`
        : `modelo <- nnet::multinom(.y ~ ${fml}, data = d, trace = FALSE)\nsummary(modelo)\nz <- coef(modelo) / summary(modelo)$standard.errors; 2 * (1 - pnorm(abs(z)))  # p de Wald\nexp(coef(modelo))  # odds ratios\ncar::Anova(modelo, type = 3)  # razón de verosimilitudes de cada predictor\n`) +
      `performance::r2_nagelkerke(modelo)\ntable(observado = d$.y, predicho = predict(modelo))`;
    return sec;
  }
  function runLogistic(yName, xNames) {
    const sec = { title: `Regresión logística: ${yName}`, test: 'Regresión logística binaria', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    xNames = xNames.filter(n => n !== yName);
    if (!xNames.length) { sec.error = 'Selecciona al menos un predictor distinto de la variable dependiente.'; return sec; }
    const yv = vByName(yName), lv = levelsOf(yv);
    if (lv.length !== 2) { sec.error = `La variable dependiente debe tener exactamente 2 categorías (tiene ${lv.length}).`; return sec; }
    const ycat = catOf(yv), { idx, cols, X } = design(xNames, i => ycat[i] !== null), y = idx.map(i => (ycat[i] === lv[1] ? 1 : 0)), n = idx.length, p = cols.length;
    if (n < p + 2) { sec.error = `Hay pocos casos completos (${n}) para ${p - 1} predictores.`; return sec; }
    const m = S.logistic(X, y);
    if (!m) { sec.error = 'Hay colinealidad perfecta entre los predictores. Elimina alguno.'; return sec; }
    const ev = Math.min(m.events, n - m.events), epv = ev / (p - 1), multi = p > 2, ev1 = esc(lv[1]), ev0 = esc(lv[0]);
    sec.decision = `Se ajustó una regresión logística binaria para predecir ${esc(yName)} = «${ev1}» (frente a «${ev0}») con ${n} casos completos.`;
    sec.why.push(`Variable dependiente: ${esc(yName)} → dicotómica (${ev0} / ${ev1}). Se modeliza la probabilidad de «${ev1}».`);
    sec.why.push('Con una variable dependiente dicotómica no se puede usar regresión lineal: la logística modeliza la probabilidad entre 0 y 1.');
    sec.why.push('Los efectos se expresan como odds ratios (OR): OR > 1 aumenta la probabilidad del suceso; OR < 1 la reduce.');
    sec.checks.push(chk(epv >= 10 ? 'ok' : 'no', `Sucesos por predictor: ${f(epv, 1)} (${ev} casos en la categoría menos frecuente para ${p - 1} coeficientes).${epv >= 10 ? ' Se cumple el criterio orientativo de ≥ 10.' : ' Por debajo de 10: el modelo puede ser inestable; reduce predictores.'}`));
    if (m.separation) sec.warn = 'Posible separación completa o casi completa: algún predictor clasifica los casos casi perfectamente y los coeficientes no son fiables. Consulta a un estadístico antes de continuar (puede necesitarse regresión de Firth).';
    sec.checks.push(chk(m.hl.p >= .05 ? 'ok' : 'no', `Bondad de ajuste (Hosmer-Lemeshow): χ²(${m.hl.df}) = ${f(m.hl.chi)}, ${pt(m.hl.p)}. ${m.hl.p >= .05 ? 'El modelo ajusta adecuadamente.' : 'Indica falta de ajuste.'}`));
    if (multi) { const vif = S.ols(X, X.map((_, i) => i)).vif, maxV = Math.max(...vif.slice(1)); sec.checks.push(chk(maxV < 5 ? 'ok' : 'no', `Multicolinealidad: VIF máximo = ${f(maxV)}.${maxV < 5 ? ' Sin problemas.' : ' Revisa los predictores correlacionados.'}`)); }
    const sens = m.tab[1][1] / (m.tab[1][0] + m.tab[1][1]), spec = m.tab[0][0] / (m.tab[0][0] + m.tab[0][1]);
    if (Math.min(sens, spec) < .2) sec.checks.push(chk('no', `Clasificación desequilibrada: el modelo solo identifica correctamente al ${f(Math.min(sens, spec) * 100, 1)} % de los casos «${sens < spec ? ev1 : ev0}». El % correcto global (${f(m.acc * 100, 1)} %) refleja sobre todo la categoría mayoritaria: no lo presentes como capacidad predictiva.`));
    sec.checks.push(chk('info', 'Linealidad del logit: se asume una relación lineal entre cada predictor continuo y el logaritmo de las odds (puede comprobarse con la prueba de Box-Tidwell).'));
    sec.alt = 'Regresión de Firth si hay separación o pocos sucesos; regresión multinomial si la variable dependiente tiene más de dos categorías.';
    sec.tables.push(apaTable('Resumen del modelo de regresión logística', ['χ²', '<i>gl</i>', '<i>p</i>', '−2LL', '<i>R</i>² de Cox y Snell', '<i>R</i>² de Nagelkerke', '% correcto', '<i>n</i>'],
      [[f(m.LR), m.df, pv(m.pLR), f(m.dev), nz(m.cs.toFixed(3)), nz(m.nag.toFixed(3)), f(m.acc * 100, 1), n]], 'χ² = prueba de razón de verosimilitud frente al modelo nulo. Clasificación con punto de corte .50.'));
    sec.tables.push(apaTable(`Coeficientes del modelo para ${yName} = «${lv[1]}»`, ['Predictor', '<i>B</i>', '<i>EE</i>', '<i>z</i>', '<i>p</i>', 'OR', 'IC 95 % (OR)'],
      cols.map((c, j) => [esc(c.name), f(m.b[j], 3), f(m.se[j], 3), f(m.z[j]), pv(m.p[j]), j ? f(m.or[j]) : '', j ? `[${f(m.ci[j][0])}, ${f(m.ci[j][1])}]` : '']), 'OR = odds ratio. IC de Wald.'));
    sec.tables.push(apaTable('Tabla de clasificación', ['Observado', `Predicho: ${ev0}`, `Predicho: ${ev1}`, '% correcto'],
      [[ev0, m.tab[0][0], m.tab[0][1], f(m.tab[0][0] / (m.tab[0][0] + m.tab[0][1]) * 100, 1)], [ev1, m.tab[1][0], m.tab[1][1], f(m.tab[1][1] / (m.tab[1][0] + m.tab[1][1]) * 100, 1)], ['Global', '', '', f(m.acc * 100, 1)]]));
    const sig = cols.map((c, j) => ({ c, j })).filter(o => o.j > 0 && m.p[o.j] < .05);
    let t = `Se realizó una regresión logística binaria para predecir la probabilidad de ${esc(yName)} = «${ev1}» a partir de ${list(xNames.map(esc))}. El modelo ${m.pLR < .05 ? '' : 'no '}fue estadísticamente significativo, χ²(${m.df}, <i>N</i> = ${n}) = ${f(m.LR)}, ${pt(m.pLR)}, con un <i>R</i>² de Cox y Snell de ${nz(m.cs.toFixed(3))} y un <i>R</i>² de Nagelkerke de ${nz(m.nag.toFixed(3))}, y clasificó correctamente al ${f(m.acc * 100, 1)} % de los casos. `;
    if (sig.length) t += list(sig.map(o => `${esc(o.c.name)} se asoció con una ${m.b[o.j] > 0 ? 'mayor' : 'menor'} probabilidad de «${ev1}» (OR = ${f(m.or[o.j])}, IC 95 % [${f(m.ci[o.j][0])}, ${f(m.ci[o.j][1])}], ${pt(m.p[o.j])})`)) + '. ';
    const ns = cols.filter((c, j) => j > 0 && m.p[j] >= .05).map(c => esc(c.name));
    if (ns.length) t += `${list(ns)} no ${ns.length > 1 ? 'fueron predictores significativos' : 'fue un predictor significativo'}.`;
    sec.text.push(t);
    sec.charts.push(fig('Odds ratios e IC 95 %', CH.forest(cols.slice(1).map(c => c.name), m.or.slice(1), m.ci.slice(1))));
    sec.code = `# Regresión logística: ${yName} (suceso = "${lv[1]}")\nmodelo <- glm(${rn(yName)} ~ ${xNames.map(rn).join(' + ')}, data = datos, family = binomial)\nsummary(modelo)\nexp(cbind(OR = coef(modelo), confint.default(modelo)))\nperformance::r2_coxsnell(modelo); performance::r2_nagelkerke(modelo)\nperformance::performance_hosmer(modelo, n_bins = 10)` + (multi ? '\ncar::vif(modelo)' : '');
    return sec;
  }

  function runAncova(yName, gName, covNames) {
    const sec = { title: covNames.length ? `${yName} según ${gName}, controlando ${covNames.join(', ')}` : `ANCOVA: ${yName} según ${gName}`, test: 'ANCOVA (SC tipo III)', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    covNames = covNames.filter(n => n !== yName);
    if (!covNames.length) { sec.error = 'Selecciona al menos una covariable distinta de la variable dependiente.'; return sec; }
    const yv = numOf(vByName(yName)), gc = catOf(vByName(gName)), cv = covNames.map(n => numOf(vByName(n)));
    const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && gc[i] !== null && cv.every(c => c[i] !== null));
    const lv = ordOf(vByName(gName), idx.map(i => gc[i])), L = lv.length, n = idx.length;
    if (L < 2) { sec.error = 'El factor necesita al menos 2 grupos con datos.'; return sec; }
    if (lv.some(l => idx.filter(i => gc[i] === l).length < 3)) { sec.error = 'Algún grupo tiene menos de 3 casos completos: no se puede estimar la ANCOVA. Agrupa categorías o elige otro factor.'; return sec; }
    if (n < L + covNames.length + 3) { sec.error = `Hay pocos casos completos (${n}) para este modelo.`; return sec; }
    const y = idx.map(i => yv[i]), g = idx.map(i => lv.indexOf(gc[i])), C = idx.map(i => cv.map(c => c[i]));
    const r = S.ancova(y, g, L, C);
    if (!r || !r.factor) { sec.error = 'No se pudo estimar el modelo: probablemente una covariable es constante o redundante.'; return sec; }
    const lev = S.levene(lv.map((_, j) => r.resid.filter((_, i) => g[i] === j))), sw = S.shapiro(r.resid), cl = list(covNames.map(esc));
    sec.decision = `Se ajustó una ANCOVA para comparar ${esc(yName)} entre los ${L} grupos de ${esc(gName)} controlando ${cl}, con ${n} casos completos y sumas de cuadrados de tipo III.`;
    sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa. Factor: ${esc(gName)} (${L} grupos). Covariable${covNames.length > 1 ? 's' : ''}: ${cl}.`);
    sec.why.push('La ANCOVA compara los grupos como si todos tuvieran el mismo valor en las covariables: elimina su influencia y suele aumentar la potencia (por ejemplo, al ajustar por la puntuación previa en un diseño pre/post).');
    sec.why.push('Se informan las medias ajustadas (estimadas en la media de las covariables), que son las que compara el contraste.');
    if (r.slopes) sec.checks.push(chk(r.slopes.p >= .05 ? 'ok' : 'no', `Homogeneidad de las pendientes de regresión (interacción factor × covariable): <i>F</i>(${r.slopes.df1}, ${r.slopes.df2}) = ${f(r.slopes.F)}, ${pt(r.slopes.p)}. ${r.slopes.p >= .05 ? 'Se cumple: la relación de la covariable con la variable dependiente es similar en todos los grupos.' : 'No se cumple: la relación con la covariable difiere entre grupos y la ANCOVA no es adecuada. Considera un modelo con interacción (moderación).'}`));
    if (r.slopes && r.slopes.p < .05) sec.warn = 'No se cumple la homogeneidad de las pendientes: las medias ajustadas pueden ser engañosas. Interpreta con cautela o consulta a un estadístico.';
    sec.checks.push(chk(lev.p >= .05 ? 'ok' : 'no', `Homogeneidad de varianzas de los residuos (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.${lev.p >= .05 ? ' Se cumple.' : ' No se cumple: interpreta con cautela si los grupos tienen tamaños distintos.'}`));
    if (sw) sec.checks.push(chk(sw.p >= .05 ? 'ok' : n >= 100 ? 'info' : 'no', `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}.${sw.p >= .05 ? '' : n >= 100 ? ' Con muestras grandes el modelo es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña.'}`));
    sec.checks.push(chk('info', 'Linealidad: se asume una relación lineal entre cada covariable y la variable dependiente dentro de cada grupo.'));
    sec.alt = 'Si no se cumple la homogeneidad de pendientes, un modelo de regresión con la interacción grupo × covariable.';
    const raw = lv.map((_, j) => S.describe(y.filter((_, i) => g[i] === j)));
    sec.tables.push(apaTable(`Medias observadas y ajustadas de ${yName} por ${gName}`, [esc(gName), '<i>n</i>', '<i>M</i>', '<i>DT</i>', '<i>M</i> ajustada', '<i>EE</i>', 'IC 95 % (<i>M</i> ajustada)'],
      lv.map((l, j) => [esc(l), raw[j].n, f(raw[j].mean), f(raw[j].sd), f(r.adj[j].mean), f(r.adj[j].se), `[${f(r.adj[j].ci[0])}, ${f(r.adj[j].ci[1])}]`]),
      `Medias ajustadas en la media de ${cl} (${covNames.map((nm, c) => `${esc(nm)} = ${f(S.mean(C.map(x => x[c])))}`).join('; ')}).`));
    sec.tables.push(apaTable('Resultado de la ANCOVA', ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>'],
      covNames.map((nm, c) => [esc(nm), f(r.covs[c].ss), 1, f(r.covs[c].ms), f(r.covs[c].F), pv(r.covs[c].p), nz(r.covs[c].peta2.toFixed(3))])
        .concat([[esc(gName), f(r.factor.ss), r.factor.df, f(r.factor.ms), f(r.factor.F), pv(r.factor.p), nz(r.factor.peta2.toFixed(3))], ['Error', f(r.sse), r.dfE, f(r.mse), '', '', '']]),
      'SC de tipo III. η²<sub>p</sub> = eta cuadrado parcial.'));
    sec.charts.push(fig(`${yName} por ${gName}: medias ajustadas e IC 95 %`, CH.meansCI(lv.map((l, j) => ({ name: l, x: y.filter((_, i) => g[i] === j), mean: r.adj[j].mean, ci: r.adj[j].ci })), yName + ' (ajustada)', { points: false })));
    const st = `<i>F</i>(${r.factor.df}, ${r.dfE}) = ${f(r.factor.F)}, ${pt(r.factor.p)}, η²<sub>p</sub> = ${nz(r.factor.peta2.toFixed(3))}`;
    let t = `Se realizó un análisis de covarianza (ANCOVA) para comparar ${esc(yName)} según ${esc(gName)}, controlando ${cl}. `;
    t += list(covNames.map((nm, c) => `${esc(nm)} ${r.covs[c].p < .05 ? 'se relacionó significativamente' : 'no se relacionó significativamente'} con ${esc(yName)}, <i>F</i>(1, ${r.dfE}) = ${f(r.covs[c].F)}, ${pt(r.covs[c].p)}`)) + '. ';
    t += r.factor.p < .05 ? `Tras ajustar por ${covNames.length > 1 ? 'las covariables' : 'la covariable'}, se encontraron diferencias estadísticamente significativas entre los grupos, ${st} (medias ajustadas: ${lv.map((l, j) => `${esc(l)} = ${f(r.adj[j].mean)}`).join('; ')}).`
      : `Tras ajustar por ${covNames.length > 1 ? 'las covariables' : 'la covariable'}, no se encontraron diferencias estadísticamente significativas entre los grupos, ${st}.`;
    if (r.factor.p < .05 && L > 2) {
      const sig = r.pairs.filter(o => o.padj < .05);
      t += sig.length ? ` Las comparaciones por pares de las medias ajustadas (corrección de Holm) mostraron diferencias entre ${list(sig.map(o => `${esc(lv[o.i])} y ${esc(lv[o.j])} (${pt(o.padj)})`))}.` : ' Las comparaciones por pares de las medias ajustadas (corrección de Holm) no detectaron diferencias entre pares concretos.';
    }
    if (r.factor.p < .05) sec.tables.push(apaTable('Comparaciones por pares de las medias ajustadas (corrección de Holm)', ['Comparación', 'Diferencia', '<i>EE</i>', '<i>t</i>', '<i>gl</i>', '<i>p</i> ajustada'],
      r.pairs.map(o => [`${esc(lv[o.i])} − ${esc(lv[o.j])}`, f(o.diff), f(o.se), f(o.t), r.dfE, pv(o.padj)])));
    sec.text.push(t);
    const Y = rn(yName), G = rn(gName), Cs = covNames.map(rn);
    sec.code = `# ANCOVA: ${yName} ~ ${gName} + ${covNames.join(' + ')}\noptions(contrasts = c("contr.sum", "contr.poly"))\nmodelo <- lm(${Y} ~ ${G} + ${Cs.join(' + ')}, data = datos)\ncar::Anova(modelo, type = 3)\neffectsize::eta_squared(car::Anova(modelo, type = 3), partial = TRUE)\n` +
      `anova(modelo, lm(${Y} ~ ${G} * (${Cs.join(' + ')}), data = datos))  # homogeneidad de pendientes\ncar::leveneTest(residuals(modelo) ~ modelo$model[[${rq(gName)}]], center = mean)\nshapiro.test(residuals(modelo))\nemmeans::emmeans(modelo, pairwise ~ ${G}, adjust = "holm")`;
    return sec;
  }

  function runBinRel(names) {
    const k = names.length, sec = { title: `${names.join(', ')} (cambio en una variable sí/no)`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (k < 2) { sec.error = 'Selecciona al menos dos variables (momentos).'; return sec; }
    const cs = names.map(n => catOf(vByName(n))), lv = ordOf(names.map(vByName).find(v => v.order) || vByName(names[0]), cs.flat());
    if (lv.length !== 2) { sec.error = `Las variables deben tener las mismas dos categorías (se han encontrado ${lv.length}: ${list(lv.slice(0, 6).map(esc))}).`; return sec; }
    const idx = ST.rows.map((_, i) => i).filter(i => cs.every(c => c[i] !== null)), n = idx.length, ev = lv[1];
    if (n < 5) { sec.error = 'Hay muy pocos casos con todas las respuestas.'; return sec; }
    const M = idx.map(i => cs.map(c => (c[i] === ev ? 1 : 0))), props = names.map((_, j) => S.mean(M.map(r => r[j])));
    sec.why.push(`Las mismas ${n} personas responden «${esc(lv[0])}» o «${esc(ev)}» en ${k} momentos: ${list(names.map(esc))}.`);
    sec.why.push('Con respuestas dicotómicas relacionadas no sirve el chi-cuadrado de independencia: hay que comparar los cambios dentro de cada persona.');
    sec.checks.push(chk('info', 'Independencia entre personas: cada fila debe ser un participante distinto.'));
    sec.tables.push(apaTable(`Porcentaje de «${ev}» en cada momento`, ['Momento', '<i>n</i>', `«${esc(ev)}»`, '%'], names.map((nm, j) => [esc(nm), n, S.sum(M.map(r => r[j])), f(props[j] * 100, 1)])));
    sec.charts.push(fig(`Porcentaje de «${ev}» en cada momento`, CH.barsCat(names, props.map(p => +(p * 100).toFixed(1)), '%')));
    const Q = names.map(rq).join(', ');
    if (k === 2) {
      const b = M.filter(r => r[0] === 0 && r[1] === 1).length, c = M.filter(r => r[0] === 1 && r[1] === 0).length, r = S.mcnemar(b, c), exact = b + c < 25, P = exact ? r.pExact : r.p;
      sec.test = 'Prueba de McNemar' + (exact ? ' (exacta)' : '');
      sec.decision = `Se eligió la prueba de McNemar porque son dos respuestas dicotómicas de las mismas personas${exact ? '; como hay pocos casos que cambian (menos de 25), se usa su versión exacta (binomial)' : ''}.`;
      sec.alt = 'Q de Cochran si hubiera tres o más momentos.';
      const a = M.filter(x => x[0] === 0 && x[1] === 0).length, d = M.filter(x => x[0] === 1 && x[1] === 1).length;
      sec.tables.push(apaTable(`Tabla de cambios entre ${names[0]} y ${names[1]}`, [`${esc(names[0])} \\ ${esc(names[1])}`, esc(lv[0]), esc(ev)], [[esc(lv[0]), a, b], [esc(ev), c, d]], `Casos que cambian: ${b} de «${esc(lv[0])}» a «${esc(ev)}» y ${c} de «${esc(ev)}» a «${esc(lv[0])}».`));
      sec.tables.push(apaTable('Resultado de la prueba de McNemar', ['', 'χ²', '<i>gl</i>', '<i>p</i>', '<i>p</i> exacta', '<i>n</i>'], [[`${esc(names[0])} → ${esc(names[1])}`, f(r.chi), 1, pv(r.p), pv(r.pExact), n]], 'χ² con corrección por continuidad. <i>p</i> exacta: prueba binomial sobre los casos discordantes.'));
      const st = exact ? `prueba de McNemar exacta, ${pt(P)}` : `χ²(1, <i>N</i> = ${n}) = ${f(r.chi)}, ${pt(P)}`;
      sec.text.push(`Se aplicó la prueba de McNemar para comparar la proporción de «${esc(ev)}» entre ${esc(names[0])} (${f(props[0] * 100, 1)} %) y ${esc(names[1])} (${f(props[1] * 100, 1)} %). ` +
        (P < .05 ? `El cambio fue estadísticamente significativo, ${st}: ${b} personas pasaron a «${esc(ev)}» y ${c} dejaron de estarlo.` : `El cambio no fue estadísticamente significativo, ${st}.`));
      sec.code = `# McNemar: ${names[0]} → ${names[1]}\ntabla <- table(datos[[${rq(names[0])}]], datos[[${rq(names[1])}]])\ntabla\nmcnemar.test(tabla, correct = TRUE)\nbinom.test(tabla[1, 2], tabla[1, 2] + tabla[2, 1])  # versión exacta`;
    } else {
      const r = S.cochranQ(M); sec.test = 'Q de Cochran';
      sec.decision = `Se eligió la Q de Cochran porque son ${k} respuestas dicotómicas de las mismas personas.`;
      sec.alt = 'McNemar para comparar solo dos momentos.';
      sec.tables.push(apaTable('Resultado de la Q de Cochran', ['', '<i>Q</i>', '<i>gl</i>', '<i>p</i>', '<i>n</i>'], [[list(names.map(esc)), f(r.Q), r.df, pv(r.p), n]]));
      let t = `Se aplicó la Q de Cochran para comparar la proporción de «${esc(ev)}» en ${list(names.map((nm, j) => `${esc(nm)} (${f(props[j] * 100, 1)} %)`))}. `;
      if (r.p < .05) {
        const pairs = []; for (let a = 0; a < k; a++) for (let b2 = a + 1; b2 < k; b2++) { const b = M.filter(x => x[a] === 0 && x[b2] === 1).length, c = M.filter(x => x[a] === 1 && x[b2] === 0).length; pairs.push({ a, b: b2, r: S.mcnemar(b, c) }); }
        S.holm(pairs.map(o => o.r.p)).forEach((p, i) => pairs[i].padj = p);
        const sig = pairs.filter(o => o.padj < .05);
        t += `Las diferencias fueron estadísticamente significativas, <i>Q</i>(${r.df}) = ${f(r.Q)}, ${pt(r.p)}.` + (sig.length ? ` Las comparaciones por pares (McNemar con corrección de Holm) mostraron diferencias entre ${list(sig.map(o => `${esc(names[o.a])} y ${esc(names[o.b])} (${pt(o.padj)})`))}.` : ' Las comparaciones por pares (McNemar con corrección de Holm) no detectaron diferencias entre pares concretos.');
        sec.tables.push(apaTable('Comparaciones por pares (McNemar, corrección de Holm)', ['Comparación', 'χ²', '<i>p</i> ajustada'], pairs.map(o => [`${esc(names[o.a])} − ${esc(names[o.b])}`, f(o.r.chi), pv(o.padj)])));
      } else t += `Las diferencias no fueron estadísticamente significativas, <i>Q</i>(${r.df}) = ${f(r.Q)}, ${pt(r.p)}.`;
      sec.text.push(t);
      sec.code = `# Q de Cochran: ${names.join(', ')}\nmedidas <- c(${Q})\nd <- datos[complete.cases(datos[, medidas]), medidas]\nd01 <- as.data.frame(lapply(d, function(x) as.integer(x == ${rq(ev)})))\nd01$id <- factor(seq_len(nrow(d01)))\nlargo <- data.frame(id = rep(d01$id, ${k}), momento = factor(rep(medidas, each = nrow(d01)), levels = medidas), valor = unlist(d01[, medidas], use.names = FALSE))\nrstatix::cochran_qtest(largo, valor ~ momento | id)\nrstatix::pairwise_mcnemar_test(largo, valor ~ momento | id, p.adjust.method = "holm")`;
    }
    return sec;
  }

  function runFactorial(yName, aName, bName) {
    const sec = { title: `${yName} según ${aName} × ${bName}`, test: 'ANOVA factorial (SC tipo III)', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (aName === bName) { sec.error = 'Elige dos factores distintos.'; return sec; }
    const yv = numOf(vByName(yName)), ca = catOf(vByName(aName)), cb = catOf(vByName(bName));
    const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && ca[i] !== null && cb[i] !== null);
    const la = ordOf(vByName(aName), idx.map(i => ca[i])), lb = ordOf(vByName(bName), idx.map(i => cb[i]));
    if (la.length < 2 || lb.length < 2) { sec.error = 'Cada factor necesita al menos 2 niveles con datos.'; return sec; }
    const cells = la.map(() => lb.map(() => [])); idx.forEach(i => cells[la.indexOf(ca[i])][lb.indexOf(cb[i])].push(yv[i]));
    if (cells.flat().some(c => c.length < 2)) { sec.error = 'Alguna combinación de niveles tiene menos de 2 casos: el ANOVA factorial no puede estimarse. Agrupa niveles o usa un único factor.'; return sec; }
    const y = idx.map(i => yv[i]), r = S.anova2(y, idx.map(i => la.indexOf(ca[i])), idx.map(i => lb.indexOf(cb[i])), la.length, lb.length);
    if (!r) { sec.error = 'No se pudo estimar el modelo.'; return sec; }
    const lev = S.levene(cells.flat()), sw = S.shapiro(r.resid), n = y.length, sizes = cells.flat().map(c => c.length), balanced = Math.max(...sizes) === Math.min(...sizes);
    sec.decision = `Se ajustó un ANOVA factorial ${la.length}×${lb.length} con sumas de cuadrados de tipo III (como SPSS) y ${n} casos.`;
    sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa.`);
    sec.why.push(`Dos factores entre sujetos: ${esc(aName)} (${la.length} niveles) y ${esc(bName)} (${lb.length} niveles).`);
    sec.why.push('El ANOVA factorial estima el efecto de cada factor y su interacción: si el efecto de un factor depende del nivel del otro.');
    sec.why.push(`Se usan sumas de cuadrados de tipo III, adecuadas ${balanced ? 'también' : 'especialmente'} cuando los grupos ${balanced ? 'están equilibrados' : 'tienen tamaños distintos'}.`);
    sec.checks.push(chk(lev.p >= .05 ? 'ok' : 'no', `Homogeneidad de varianzas entre las ${la.length * lb.length} casillas (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.${lev.p >= .05 ? ' Se cumple.' : ' No se cumple: interpreta con cautela, sobre todo si los tamaños de las casillas difieren.'}`));
    if (sw) sec.checks.push(chk(sw.p >= .05 ? 'ok' : n >= 100 ? 'info' : 'no', `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}.${sw.p >= .05 ? '' : n >= 100 ? ' Con muestras grandes el ANOVA es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña.'}`));
    sec.checks.push(chk(balanced ? 'ok' : 'info', `Tamaño de las casillas: entre ${Math.min(...sizes)} y ${Math.max(...sizes)} casos${balanced ? ' (diseño equilibrado).' : ' (diseño no equilibrado).'}`));
    sec.alt = 'Si no se cumple la homogeneidad con casillas desiguales, errores robustos o un modelo lineal generalizado.';
    const rows = []; la.forEach((a, i) => lb.forEach((b, j) => { const d = S.describe(cells[i][j]); rows.push([j === 0 ? esc(a) : '', esc(b), d.n, f(d.mean), f(d.sd)]); }));
    sec.tables.push(apaTable(`Estadísticos descriptivos de ${yName} por ${aName} y ${bName}`, [esc(aName), esc(bName), '<i>n</i>', '<i>M</i>', '<i>DT</i>'], rows));
    const eff = [['A', esc(aName)], ['B', esc(bName)], ['AB', `${esc(aName)} × ${esc(bName)}`]];
    sec.tables.push(apaTable('Resultado del ANOVA factorial', ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>'],
      eff.map(([k, nm]) => [nm, f(r[k].ss), r[k].df, f(r[k].ms), f(r[k].F), pv(r[k].p), nz(r[k].peta2.toFixed(3))]).concat([['Error', f(r.sse), r.dfE, f(r.mse), '', '', '']]), 'SC de tipo III. η²<sub>p</sub> = eta cuadrado parcial.'));
    // Medias marginales estimadas (media no ponderada de las medias de casilla, como emmeans y JASP) y comparaciones por pares
    // con ajuste de Tukey; d = diferencia / √MCE (emmeans::eff_size con sigma(modelo), como JASP)
    const cm = cells.map(row => row.map(c => S.mean(c))), tc = S.tcrit(r.dfE), sdE = Math.sqrt(r.mse);
    const marg = (levels, other, mean_, invn) => levels.map((lv, i) => {
      const em = S.mean(other.map((_, j) => mean_(i, j))), se = Math.sqrt(r.mse * S.sum(other.map((_, j) => invn(i, j))) / other.length ** 2);
      return { lv, em, se, ci: [em - tc * se, em + tc * se] }; });
    const emA = marg(la, lb, (i, j) => cm[i][j], (i, j) => 1 / cells[i][j].length), emB = marg(lb, la, (j, i) => cm[i][j], (j, i) => 1 / cells[i][j].length);
    const pairsOf = (em, other, invn) => { const out = [], k = em.length;
      for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
        const diff = em[i].em - em[j].em, se = Math.sqrt(r.mse * S.sum(other.map((_, o) => invn(i, o) + invn(j, o))) / other.length ** 2), tv = diff / se;
        const p = k === 2 ? S.pT(tv, r.dfE) : Math.min(1, 1 - jStat.tukey.cdf(Math.abs(tv) * Math.SQRT2, k, r.dfE));
        out.push({ a: em[i].lv, b: em[j].lv, diff, se, t: tv, p, d: diff / sdE }); }
      return out; };
    const pA = pairsOf(emA, lb, (i, j) => 1 / cells[i][j].length), pB = pairsOf(emB, la, (j, i) => 1 / cells[i][j].length);
    const obs = (fac, lv) => S.describe(idx.filter(i => (fac === 'A' ? ca[i] : cb[i]) === lv).map(i => yv[i]));
    sec.tables.push(apaTable(`Medias marginales estimadas de ${yName}`, ['Factor', 'Nivel', '<i>n</i>', '<i>M</i> observada (<i>DT</i>)', '<i>M</i> marginal estimada', '<i>EE</i>', 'IC 95 %'],
      [['A', emA, la], ['B', emB, lb]].flatMap(([k, em]) => em.map((e, q) => { const o = obs(k, e.lv); return [q === 0 ? esc(k === 'A' ? aName : bName) : '', esc(e.lv), o.n, `${f(o.mean)} (${f(o.sd)})`, f(e.em), f(e.se), `[${f(e.ci[0])}, ${f(e.ci[1])}]`]; })),
      'Las medias marginales estimadas promedian las medias de las casillas sin ponderar por su tamaño (como emmeans, JASP y SPSS); con casillas desiguales no coinciden con las medias observadas.'));
    sec.tables.push(apaTable(`Comparaciones de las medias marginales estimadas de ${yName}`, ['Factor', 'Comparación', 'Diferencia', '<i>EE</i>', '<i>t</i>(' + r.dfE + ')', '<i>p</i>', '<i>d</i> de Cohen'],
      [[aName, pA], [bName, pB]].flatMap(([nm, ps]) => ps.map((c, q) => [q === 0 ? esc(nm) : '', `${esc(c.a)} − ${esc(c.b)}`, f(c.diff), f(c.se), f(c.t), pv(c.p), f(c.d)])),
      `<i>p</i> con ajuste de Tukey cuando el factor tiene más de dos niveles. <i>d</i> = diferencia / √<i>MC</i><sub>error</sub> (como JASP). Tamaño del efecto: 0.20 pequeño, 0.50 mediano, 0.80 grande (Cohen, 1988).`));
    // con dos niveles, la redacción incluye las medias marginales y la d del efecto principal
    const dTxt = (ps, em) => ps.length === 1 ? ` (${esc(em[0].lv)}: <i>M</i> = ${f(em[0].em)}; ${esc(em[1].lv)}: <i>M</i> = ${f(em[1].em)}; <i>d</i> = ${f(Math.abs(ps[0].d))}, efecto ${lbl.d(ps[0].d)})` : '';
    const st = k => `<i>F</i>(${r[k].df}, ${r.dfE}) = ${f(r[k].F)}, ${pt(r[k].p)}, η²<sub>p</sub> = ${nz(r[k].peta2.toFixed(3))}`;
    let t = `Se realizó un ANOVA factorial ${la.length}×${lb.length} para analizar el efecto de ${esc(aName)} y ${esc(bName)} sobre ${esc(yName)}. `;
    t += `El efecto principal de ${esc(aName)} ${r.A.p < .05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st('A')}${r.A.p < .05 ? dTxt(pA, emA) : ''}. `;
    t += `El efecto principal de ${esc(bName)} ${r.B.p < .05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st('B')}${r.B.p < .05 ? dTxt(pB, emB) : ''}. `;
    t += `La interacción ${esc(aName)} × ${esc(bName)} ${r.AB.p < .05 ? 'fue' : 'no fue'} estadísticamente significativa, ${st('AB')}.`;
    if (r.AB.p < .05) { t += ` Esto indica que el efecto de ${esc(aName)} depende del nivel de ${esc(bName)} (véase la figura), por lo que los efectos principales deben interpretarse con cautela.`;
      sec.checks.push(chk('info', 'La interacción es significativa: analiza los efectos simples (el efecto de un factor dentro de cada nivel del otro). El código R incluye cómo hacerlo con emmeans.')); }
    sec.text.push(t);
    if (lb.length <= 8) sec.charts.push(fig(`Interacción ${aName} × ${bName}: medias e IC 95 %`, CH.interaction(la, lb.map((b, j) => ({ name: b, means: la.map((_, i) => S.mean(cells[i][j])), ci: la.map((_, i) => S.meanCI(cells[i][j])) })), yName), CH.legend(lb)));
    const Y = rn(yName), A = rn(aName), B = rn(bName);
    sec.code = `# ANOVA factorial: ${yName} ~ ${aName} × ${bName}\noptions(contrasts = c("contr.sum", "contr.poly"))\nmodelo <- aov(${Y} ~ ${A} * ${B}, data = datos)\ncar::Anova(modelo, type = 3)\neffectsize::eta_squared(car::Anova(modelo, type = 3), partial = TRUE)\ncar::leveneTest(${Y} ~ ${A} * ${B}, data = datos, center = mean)\nshapiro.test(residuals(modelo))\n# Medias marginales estimadas, comparaciones (Tukey) y d de Cohen (como JASP)\nfor (fac in c(${rq(aName)}, ${rq(bName)})) {\n  em <- emmeans::emmeans(modelo, fac)\n  print(em); print(pairs(em, adjust = "tukey"))\n  print(emmeans::eff_size(em, sigma = sigma(modelo), edf = df.residual(modelo)))\n}\n# Efectos simples\nemmeans::emmeans(modelo, pairwise ~ ${A} | ${B}, adjust = "holm")`;
    return sec;
  }

  // MANOVA / MANCOVA con uno o dos factores entre sujetos
  function runManova(yNames, fNames, cNames) {
    fNames = [...new Set(fNames)].filter(f => !yNames.includes(f)); cNames = cNames.filter(c => !yNames.includes(c));
    const sec = { title: `${yNames.join(', ')} según ${fNames.join(' × ')}${cNames.length ? `, controlando ${cNames.join(', ')}` : ''}`, test: `${cNames.length ? 'MANCOVA' : 'MANOVA'} (SC tipo III)`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (yNames.length < 2) { sec.error = 'Selecciona al menos dos variables dependientes.'; return sec; }
    if (!fNames.length) { sec.error = 'Elige un factor.'; return sec; }
    const Yv = yNames.map(v => numOf(vByName(v))), fc = fNames.map(nm => catOf(vByName(nm))), cc = cNames.map(nm => numOf(vByName(nm)));
    const idx = ST.rows.map((_, i) => i).filter(i => Yv.every(y => y[i] !== null) && fc.every(c => c[i] !== null) && cc.every(c => c[i] !== null)), n = idx.length;
    const lv = fNames.map((nm, f) => ordOf(vByName(nm), idx.map(i => fc[f][i]))), L = lv.map(l => l.length), p = yNames.length;
    if (L.some(k => k < 2)) { sec.error = 'Cada factor necesita al menos 2 niveles con datos.'; return sec; }
    const Fm = idx.map(i => fc.map((c, f) => lv[f].indexOf(c[i]))), Ys = Yv.map(y => idx.map(i => y[i])), C = cc.map(c => idx.map(i => c[i]));
    const cellOf = r => r.join('|'), cells = new Map(); Fm.forEach((r, q) => { const k_ = cellOf(r); if (!cells.has(k_)) cells.set(k_, []); cells.get(k_).push(q); });
    const nCells = L.reduce((a, b) => a * b, 1), minCell = Math.min(...[...cells.values()].map(c => c.length));
    if (cells.size < nCells || minCell < 2) { sec.error = 'Hay combinaciones de niveles sin datos o con un solo caso. Agrupa niveles o usa un único factor.'; return sec; }
    const r = S.manova(Ys, Fm, L, C); if (!r) { sec.error = 'No se pudo estimar el modelo (alguna variable dependiente es combinación exacta de otras).'; return sec; }
    const tName = t => (t.cov !== undefined ? esc(cNames[t.cov]) : t.factors.map(f => esc(fNames[f])).join(' × '));
    sec.why.push(`${p} variables dependientes cuantitativas (${list(yNames.map(esc))}) y ${fNames.length === 1 ? 'un factor' : 'dos factores'} entre sujetos (${fNames.map((nm, f) => `${esc(nm)}: ${L[f]} niveles`).join('; ')})${cNames.length ? `, ajustando por ${list(cNames.map(esc))}` : ''}.`);
    sec.why.push('La MANOVA contrasta si los grupos difieren en el conjunto de variables dependientes teniendo en cuenta sus correlaciones, y controla el error tipo I frente a hacer una ANOVA por variable. Se interpreta la traza de Pillai, la más robusta con grupos desiguales o heterogeneidad de covarianzas.');
    sec.decision = `Se realizó una ${cNames.length ? 'MANCOVA' : 'MANOVA'} ${L.join('×')} con ${p} variables dependientes y ${n} casos (SC de tipo III).`;
    if (minCell < p) sec.checks.push(chk('no', `La casilla más pequeña tiene ${minCell} casos, menos que el número de variables dependientes (${p}): la MANOVA pierde potencia y la M de Box no es fiable.`));
    const groups = [...cells.values()].map(qs => qs.map(q => Ys.map(y => y[q])));
    if (minCell > p) { const bm = S.boxM(groups); sec.checks.push(chk(bm.p >= .001 ? 'ok' : 'no', `Igualdad de matrices de covarianzas (M de Box): χ²(${bm.df}) = ${f(bm.chi)}, ${pt(bm.p)}.${bm.p >= .001 ? ' Se cumple (criterio habitual: p > .001).' : ' No se cumple: por eso se interpreta la traza de Pillai, más robusta.'}`)); }
    yNames.forEach((nm, d) => { const lev = S.levene(groups.map(G => G.map(row => row[d]))); sec.checks.push(chk(lev.p >= .05 ? 'ok' : 'no', `Homogeneidad de varianzas en ${esc(nm)} (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.`)); });
    const R_ = S.corMatrix(Ys[0].map((_, i) => Ys.map(y => y[i]))), rs = []; for (let a = 0; a < p; a++) for (let b = a + 1; b < p; b++) rs.push(R_[a][b]);
    sec.checks.push(chk(Math.max(...rs.map(Math.abs)) < .9 ? 'info' : 'no', `Correlaciones entre las variables dependientes: de ${r2s(Math.min(...rs))} a ${r2s(Math.max(...rs))}.${Math.max(...rs.map(Math.abs)) >= .9 ? ' Hay correlaciones muy altas (≥ .90): posible multicolinealidad; valora quitar alguna variable.' : ' La MANOVA tiene más sentido con correlaciones moderadas.'}`));
    // descriptivos por casilla
    const dRows = [...cells.entries()].map(([k_, qs]) => [k_.split('|').map((l, f) => esc(lv[f][+l])).join(' · '), qs.length].concat(Ys.map(y => { const x = qs.map(q => y[q]); return `${f(S.mean(x))} (${f(S.sd(x))})`; })));
    sec.tables.push(apaTable('Medias (desviaciones típicas) por grupo', [fNames.map(esc).join(' · '), '<i>n</i>'].concat(yNames.map(esc)), dRows));
    const TN = { pillai: 'Traza de Pillai', wilks: 'Lambda de Wilks', hotelling: 'Traza de Hotelling-Lawley', roy: 'Raíz mayor de Roy' }, mRows = [];
    r.terms.forEach(t => Object.keys(TN).forEach((k, q) => { const o = t.tests[k]; mRows.push([q === 0 ? tName(t) : '', TN[k], nz(o.stat.toFixed(3)), f(o.F), +o.df1.toFixed(2), +o.df2.toFixed(2), pv(o.p), k === 'pillai' ? nz(t.eta2.pillai.toFixed(3)) : k === 'wilks' ? nz(t.eta2.wilks.toFixed(3)) : '']); }));
    sec.tables.push(apaTable('Contrastes multivariados', ['Efecto', 'Estadístico', 'Valor', '<i>F</i>', '<i>gl</i><sub>1</sub>', '<i>gl</i><sub>2</sub>', '<i>p</i>', 'η²<sub>p</sub>'], mRows,
      'SC de tipo III (como SPSS y car::Anova). η²<sub>p</sub> multivariado: V/s para Pillai y 1 − Λ<sup>1/s</sup> para Wilks (s = mín(variables, gl del efecto)). La F de Roy es una cota superior.'));
    // ANOVA univariadas de seguimiento
    const uni = yNames.map((nm, d) => S.glmFactorial(Ys[d], Fm, L, C)), uRows = [];
    uni.forEach((g, d) => g.terms.forEach((t, q) => uRows.push([q === 0 ? esc(yNames[d]) : '', tName(t), f(t.F), `${t.df}, ${g.dfE}`, pv(t.p), nz(t.peta2.toFixed(3))])));
    const aB = .05 / p;
    sec.tables.push(apaTable('ANOVA univariadas de seguimiento', ['Variable dependiente', 'Efecto', '<i>F</i>', '<i>gl</i>', '<i>p</i>', 'η²<sub>p</sub>'], uRows,
      `Se interpretan solo si el contraste multivariado del efecto es significativo. Con corrección de Bonferroni, α = .05 / ${p} = ${nz(aB.toFixed(4))}.`));
    const st = t => `<i>V</i> = ${nz(t.tests.pillai.stat.toFixed(2))}, <i>F</i>(${+t.tests.pillai.df1.toFixed(2)}, ${+t.tests.pillai.df2.toFixed(2)}) = ${f(t.tests.pillai.F)}, ${pt(t.tests.pillai.p)}, η²<sub>p</sub> = ${nz(t.eta2.pillai.toFixed(2))}`;
    let txt = `Se realizó una ${cNames.length ? 'MANCOVA' : 'MANOVA'} para comparar ${list(yNames.map(esc))} según ${list(fNames.map(esc))}${cNames.length ? `, controlando ${list(cNames.map(esc))}` : ''}. Según la traza de Pillai, ` +
      r.terms.map(t => `${t.factors && t.factors.length > 1 ? `la interacción ${tName(t)}` : t.cov !== undefined ? `la covariable ${tName(t)}` : `el efecto de ${tName(t)}`} ${t.tests.pillai.p < .05 ? 'fue' : 'no fue'} estadísticamente significativ${t.cov !== undefined || (t.factors && t.factors.length > 1) ? 'a' : 'o'}, ${st(t)}`).join('; ') + '.';
    r.terms.forEach((t, ti) => { if (t.tests.pillai.p >= .05 || t.cov !== undefined) return; const sigD = uni.map((g, d) => ({ d, t: g.terms[ti] })).filter(o => o.t.p < aB);
      txt += sigD.length ? ` Las ANOVA de seguimiento (α corregida = ${nz(aB.toFixed(3))}) mostraron diferencias según ${tName(t)} en ${list(sigD.map(o => `${esc(yNames[o.d])} (<i>F</i>(${o.t.df}, ${uni[o.d].dfE}) = ${f(o.t.F)}, ${pt(o.t.p)}, η²<sub>p</sub> = ${nz(o.t.peta2.toFixed(2))})`))}.` : ` Ninguna ANOVA de seguimiento de ${tName(t)} fue significativa con la α corregida.`; });
    sec.text.push(txt);
    const Yc = `cbind(${yNames.map(v => `\`${v}\``).join(', ')})`, Fs = fNames.map(v => `factor(\`${v}\`)`).join(' * '), Cs = cNames.map(v => `\`${v}\``).join(' + ');
    sec.code = `# ${cNames.length ? 'MANCOVA' : 'MANOVA'}\noptions(contrasts = c("contr.sum", "contr.poly"))\nd <- datos[complete.cases(datos[, c(${yNames.concat(fNames, cNames).map(rq).join(', ')})]), ]\nmodelo <- lm(${Yc} ~ ${Fs}${Cs ? ' + ' + Cs : ''}, data = d)\nm3 <- car::Anova(modelo, type = 3)\nfor (ts in c("Pillai", "Wilks", "Hotelling-Lawley", "Roy")) print(summary(m3, test = ts, univariate = FALSE))\n` +
      `heplots::boxM(d[, c(${yNames.map(rq).join(', ')})], interaction(${fNames.map(v => `d[[${rq(v)}]]`).join(', ')}))  # M de Box\n# ANOVA de seguimiento\n` + yNames.map(v => `car::Anova(lm(\`${v}\` ~ ${Fs}${Cs ? ' + ' + Cs : ''}, data = d), type = 3)`).join('\n');
    return sec;
  }

  // ANOVA factorial general (2 o 3 factores) con covariables opcionales: SC de tipo III, medias marginales y comparaciones
  function runFactorialG(yName, fNames, cNames) {
    fNames = fNames.filter(Boolean); cNames = cNames.filter(c => c !== yName && !fNames.includes(c));
    const title = `${yName} según ${fNames.join(' × ')}${cNames.length ? `, controlando ${cNames.join(', ')}` : ''}`;
    const sec = { title, test: `${cNames.length ? 'ANCOVA' : 'ANOVA'} factorial (SC tipo III)`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (new Set(fNames).size !== fNames.length) { sec.error = 'Elige factores distintos.'; return sec; }
    if (fNames.includes(yName)) { sec.error = 'La variable dependiente no puede ser un factor.'; return sec; }
    const yv = numOf(vByName(yName)), fc = fNames.map(nm => catOf(vByName(nm))), cc = cNames.map(nm => numOf(vByName(nm)));
    const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && fc.every(c => c[i] !== null) && cc.every(c => c[i] !== null));
    const lv = fNames.map((nm, f) => ordOf(vByName(nm), idx.map(i => fc[f][i]))), L = lv.map(l => l.length), n = idx.length;
    if (L.some(k => k < 2)) { sec.error = 'Cada factor necesita al menos 2 niveles con datos.'; return sec; }
    const Fm = idx.map(i => fc.map((c, f) => lv[f].indexOf(c[i]))), y = idx.map(i => yv[i]), C = cc.map(c => idx.map(i => c[i]));
    const cellKey = r => r.join('|'), cells = new Map(); Fm.forEach((r, q) => { const k_ = cellKey(r); if (!cells.has(k_)) cells.set(k_, []); cells.get(k_).push(y[q]); });
    const nCells = L.reduce((a, b) => a * b, 1);
    if (cells.size < nCells || [...cells.values()].some(c => c.length < 2)) { sec.error = `Hay combinaciones de niveles con menos de 2 casos (${cells.size} de ${nCells} casillas con datos): el modelo con todas las interacciones no puede estimarse. Agrupa niveles o quita un factor.`; return sec; }
    const g = S.glmFactorial(y, Fm, L, C); if (!g) { sec.error = 'No se pudo estimar el modelo (colinealidad entre covariables).'; return sec; }
    const tName = t => (t.cov !== undefined ? esc(cNames[t.cov]) : t.factors.map(f => esc(fNames[f])).join(' × '));
    const design = L.join('×');
    sec.decision = `Se ajustó un${cNames.length ? 'a ANCOVA' : ' ANOVA'} factorial ${design} con sumas de cuadrados de tipo III (como SPSS)${cNames.length ? ` y ${cNames.length} covariable${cNames.length > 1 ? 's' : ''}` : ''}, con ${n} casos.`;
    sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa.`);
    sec.why.push(`${fNames.length} factores entre sujetos: ${fNames.map((nm, f) => `${esc(nm)} (${L[f]} niveles)`).join(', ')}. Se estiman sus efectos principales y todas sus interacciones.`);
    if (cNames.length) sec.why.push(`Covariables: ${list(cNames.map(esc))}. Los efectos de los factores se estiman ajustando por ellas (medias marginales con las covariables en su media).`);
    const lev = S.levene([...cells.values()]), sw = S.shapiro(g.resid), sizes = [...cells.values()].map(c => c.length);
    sec.checks.push(chk(lev.p >= .05 ? 'ok' : 'no', `Homogeneidad de varianzas entre las ${nCells} casillas (Levene): <i>F</i>(${lev.df1}, ${lev.df2}) = ${f(lev.F)}, ${pt(lev.p)}.${lev.p >= .05 ? ' Se cumple.' : ' No se cumple: interpreta con cautela, sobre todo con casillas desiguales.'}`));
    if (sw) sec.checks.push(chk(sw.p >= .05 ? 'ok' : n >= 100 ? 'info' : 'no', `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(sw.W.toFixed(3))}, ${pt(sw.p)}.${sw.p >= .05 ? '' : n >= 100 ? ' Con muestras grandes el ANOVA es robusto a desviaciones moderadas.' : ' No se cumple y la muestra es pequeña.'}`));
    sec.checks.push(chk(Math.max(...sizes) === Math.min(...sizes) ? 'ok' : 'info', `Tamaño de las casillas: entre ${Math.min(...sizes)} y ${Math.max(...sizes)} casos.`));
    if (cNames.length) { // homogeneidad de pendientes: ganancia al añadir las interacciones factor × covariable al modelo
      const codes = (f, l) => Array.from({ length: L[f] - 1 }, (_, j) => (l === j ? 1 : l === L[f] - 1 ? -1 : 0));
      const subs = []; for (let mask = 1; mask < (1 << L.length); mask++) subs.push([...Array(L.length).keys()].filter(f => mask & (1 << f)));
      const rowOf = (q, withInt) => { const lvq = Fm[q], r = [1];
        subs.forEach(sub => sub.reduce((acc, f) => { const c = codes(f, lvq[f]), out = []; acc.forEach(x => c.forEach(z => out.push(x * z))); return out; }, [1]).forEach(v => r.push(v)));
        C.forEach(c => r.push(c[q]));
        if (withInt) fNames.forEach((_, f) => codes(f, lvq[f]).forEach(code => C.forEach(c => r.push(code * c[q]))));
        return r; };
      const X0 = idx.map((_, q) => rowOf(q, false)), X1 = idx.map((_, q) => rowOf(q, true)), m0 = S.olsCore(X0, y), m1 = S.olsCore(X1, y);
      if (m0 && m1) { const dfn = X1[0].length - X0[0].length, dfd = n - X1[0].length, Fs = ((m0.sse - m1.sse) / dfn) / (m1.sse / dfd), ps = 1 - jStat.centralF.cdf(Fs, dfn, dfd);
        sec.checks.push(chk(ps >= .05 ? 'ok' : 'no', `Homogeneidad de las pendientes de regresión (interacción factores × covariables): <i>F</i>(${dfn}, ${dfd}) = ${f(Fs)}, ${pt(ps)}.${ps >= .05 ? ' Se cumple.' : ' No se cumple: la relación de la covariable con la variable dependiente cambia según el grupo; la ANCOVA puede ser engañosa.'}`)); }
    }
    sec.alt = 'Si no se cumplen los supuestos, errores robustos (HC3) o un modelo lineal generalizado; con muchas casillas pequeñas, reduce el número de factores.';
    sec.tables.push(apaTable(`Resultado de${cNames.length ? ' la ANCOVA' : 'l ANOVA'} factorial`, ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²<sub>p</sub>', 'ω²<sub>p</sub>'],
      g.terms.map(t => [tName(t), f(t.ss), t.df, f(t.ms), f(t.F), pv(t.p), nz(t.peta2.toFixed(3)), nz(t.pomega2.toFixed(3))]).concat([['Error', f(g.sse), g.dfE, f(g.mse), '', '', '', '']]),
      'SC de tipo III con codificación de efectos (como SPSS y car::Anova). η²<sub>p</sub> = eta cuadrado parcial; ω²<sub>p</sub> = omega cuadrado parcial.'));
    const tc = S.tcrit(g.dfE), emRows = [], prRows = [];
    fNames.forEach((nm, f) => { const pr = g.pairs(f);
      pr.emm.forEach((e, q) => emRows.push([q === 0 ? esc(nm) : '', esc(lv[f][e.levels[0]]), f_(e.em), f_(e.se), `[${f_(e.em - tc * e.se)}, ${f_(e.em + tc * e.se)}]`]));
      pr.pairs.forEach((c, q) => prRows.push([q === 0 ? esc(nm) : '', `${esc(lv[f][c.i])} − ${esc(lv[f][c.j])}`, f_(c.est), f_(c.se), f_(c.t), pv(c.p), f_(c.d)])); });
    sec.tables.push(apaTable(`Medias marginales estimadas de ${yName}`, ['Factor', 'Nivel', '<i>M</i> marginal estimada', '<i>EE</i>', 'IC 95 %'], emRows,
      `Promedian sin ponderar las casillas del resto de factores${cNames.length ? ', con las covariables en su media' : ''} (como emmeans, JASP y SPSS).`));
    sec.tables.push(apaTable(`Comparaciones de las medias marginales estimadas de ${yName}`, ['Factor', 'Comparación', 'Diferencia', '<i>EE</i>', `<i>t</i>(${g.dfE})`, '<i>p</i>', '<i>d</i> de Cohen'], prRows,
      '<i>p</i> con ajuste de Tukey cuando el factor tiene más de dos niveles. <i>d</i> = diferencia / √<i>MC</i><sub>error</sub> (como JASP).'));
    if (L[1] <= 8) { const e2 = g.emm([0, 1]); sec.charts.push(fig(`Interacción ${fNames[0]} × ${fNames[1]}: medias marginales estimadas`, CH.interaction(lv[0], lv[1].map((b, j) => ({ name: b,
      means: lv[0].map((_, i) => e2.find(e => e.levels[0] === i && e.levels[1] === j).em), ci: lv[0].map((_, i) => { const e = e2.find(x => x.levels[0] === i && x.levels[1] === j); return [e.em - tc * e.se, e.em + tc * e.se]; }) })), yName), CH.legend(lv[1]))); }
    const st = t => `<i>F</i>(${t.df}, ${g.dfE}) = ${f(t.F)}, ${pt(t.p)}, η²<sub>p</sub> = ${nz(t.peta2.toFixed(3))}`;
    const inter = g.terms.filter(t => t.factors && t.factors.length > 1), sigI = inter.filter(t => t.p < .05);
    let txt = `Se realizó un${cNames.length ? 'a ANCOVA' : ' ANOVA'} factorial ${design} para analizar el efecto de ${list(fNames.map(esc))} sobre ${esc(yName)}${cNames.length ? `, controlando ${list(cNames.map(esc))}` : ''}. `;
    txt += g.terms.filter(t => !(t.factors && t.factors.length > 1)).map(t => `${t.cov !== undefined ? `La covariable ${tName(t)}` : `El efecto principal de ${tName(t)}`} ${t.p < .05 ? 'fue' : 'no fue'} estadísticamente significativ${t.cov !== undefined ? 'a' : 'o'}, ${st(t)}.`).join(' ') + ' ';
    txt += inter.map(t => `La interacción ${tName(t)} ${t.p < .05 ? 'fue' : 'no fue'} estadísticamente significativa, ${st(t)}.`).join(' ');
    if (sigI.length) { txt += ' Las interacciones significativas indican que el efecto de un factor depende del nivel de otro (véase la figura), por lo que los efectos principales implicados deben interpretarse con cautela.';
      sec.checks.push(chk('info', 'Hay interacciones significativas: analiza los efectos simples (el código R incluye cómo hacerlo con emmeans).')); }
    sec.text.push(txt);
    const Y = rn(yName), FS = fNames.map(rn).join(' * '), CS = cNames.map(rn).join(' + ');
    sec.code = `# ${cNames.length ? 'ANCOVA' : 'ANOVA'} factorial: ${title}\noptions(contrasts = c("contr.sum", "contr.poly"))\nmodelo <- lm(${Y} ~ ${FS}${CS ? ' + ' + CS : ''}, data = datos)\ncar::Anova(modelo, type = 3)\neffectsize::omega_squared(car::Anova(modelo, type = 3), partial = TRUE)\n` +
      fNames.map(nm => `pairs(emmeans::emmeans(modelo, ${rq(nm)}), adjust = "tukey")`).join('\n') + `\n# Efectos simples\nemmeans::joint_tests(modelo, by = ${rq(fNames[1])})` + (cNames.length ? `\n# Homogeneidad de pendientes\nanova(modelo, update(modelo, . ~ . + (${fNames.map(rn).join(' + ')}):(${CS})))` : '');
    return sec;
  }

  // Selección de predictores con contrastes F parciales (cada variable categórica entra o sale como un bloque).
  // Criterios por defecto de SPSS y JASP: entrada p < .05 y salida p > .10. Todos los pasos usan los mismos casos.
  function stepSelect(X, y, cols, terms, method, PIN = .05, POUT = .10) {
    const colsOf = t => cols.map((c, j) => (j > 0 && c.v.name === t ? j : -1)).filter(j => j >= 0);
    const n = y.length, dfT = t => colsOf(t).length;
    const fitT = ts => { const js = [0].concat(...ts.map(colsOf)); const m = S.olsCore(X.map(r => js.map(j => r[j])), y); return m && { sse: m.sse, r2: m.r2, p: js.length }; };
    const partial = (small, big, t) => { const a = fitT(small), b = fitT(big); if (!a || !b || n - b.p <= 0) return null;
      const F = ((a.sse - b.sse) / dfT(t)) / (b.sse / (n - b.p)); return { F, df: [dfT(t), n - b.p], p: S.pF(F, dfT(t), n - b.p) }; };
    let cur = method === 'backward' ? terms.slice() : [], prevR2 = cur.length ? fitT(cur).r2 : 0;
    const steps = [], seen = new Set([cur.slice().sort().join('|')]);
    const log = (accion, t, test) => { const r2 = cur.length ? fitT(cur).r2 : 0; steps.push({ accion, t, r2, dr2: r2 - prevR2, ...test }); prevR2 = r2; };
    for (let it = 0; it < 4 * terms.length + 4; it++) {
      let moved = false;
      if (method !== 'backward') {
        const best = terms.filter(t => !cur.includes(t)).map(t => ({ t, r: partial(cur, cur.concat([t]), t) })).filter(o => o.r).sort((a, b) => a.r.p - b.r.p)[0];
        if (best && best.r.p < PIN && !seen.has(cur.concat([best.t]).sort().join('|'))) { cur = cur.concat([best.t]); log('entra', best.t, best.r); seen.add(cur.slice().sort().join('|')); moved = true; }
      }
      if (method !== 'forward' && cur.length) {
        const worst = cur.map(t => ({ t, r: partial(cur.filter(u => u !== t), cur, t) })).filter(o => o.r).sort((a, b) => b.r.p - a.r.p)[0];
        if (worst && worst.r.p > POUT) { cur = cur.filter(t => t !== worst.t); log('sale', worst.t, worst.r); moved = true; }
      }
      if (!moved) break;
    }
    return { selected: cur, steps };
  }
  function runRegression(yName, xNames, method = 'enter', blocks = null) {
    const stepwise = ['stepwise', 'forward', 'backward'].includes(method), hier = method === 'blocks', mName = { stepwise: 'por pasos', forward: 'hacia delante', backward: 'hacia atrás' }[method];
    const sec = { title: `Regresión lineal${stepwise ? ` ${mName}` : hier ? ' jerárquica' : ''}: ${yName}`, test: '', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (hier) { blocks = blocks.map(b => b.filter(n => n !== yName)).filter(b => b.length);
      if (blocks.length < 2) { sec.error = 'La regresión jerárquica necesita al menos dos bloques con predictores distintos: marca los del bloque 1 y los que se añaden en el bloque 2.'; return sec; } }
    xNames = xNames.filter(n => n !== yName);
    if (!xNames.length) { sec.error = 'Selecciona al menos un predictor distinto de la variable dependiente.'; return sec; }
    const yv = numOf(vByName(yName)), candidates = xNames.slice(); let { idx, cols, X } = design(xNames, i => yv[i] !== null); const n = idx.length;
    if (n < cols.length + 2) { sec.error = `Hay pocos casos completos (${n}) para ${cols.length - 1} predictores.`; return sec; }
    const y = idx.map(i => yv[i]); if (S.sd(y) === 0) { sec.error = `${yName} tiene el mismo valor en todos los casos: no se puede ajustar una regresión.`; return sec; }
    let sel = null;
    if (stepwise) {
      if (!S.olsCore(X, y)) { sec.error = 'Hay colinealidad perfecta entre los predictores (por ejemplo, una variable es combinación exacta de otras). Elimina alguno.'; return sec; }
      sel = stepSelect(X, y, cols, candidates, method);
      if (!sel.selected.length) { sec.error = `Ningún predictor cumplió el criterio de entrada (p < .05): el método ${mName} no seleccionó ninguna variable para predecir ${yName}.`; return sec; }
      // orden de entrada en la tabla de coeficientes, como SPSS y JASP
      const entered = sel.steps.filter(s => s.accion === 'entra').map(s => s.t);
      xNames = (method === 'backward' ? candidates : entered.filter((t, i) => entered.indexOf(t) === i)).filter(t => sel.selected.includes(t));
      const ordered = [0].concat(...xNames.map(t => cols.map((c, j) => (j > 0 && c.v.name === t ? j : -1)).filter(j => j >= 0)));
      X = X.map(r => ordered.map(j => r[j])); cols = ordered.map(j => cols[j]);
    }
    const p = cols.length;
    const m = S.ols(X, y);
    if (!m) { sec.error = 'Hay colinealidad perfecta entre los predictores (por ejemplo, una variable es combinación exacta de otras). Elimina alguno.'; return sec; }
    const multi = cols.length > 2, het = m.bp.p < .05, sdY = S.sd(y);
    sec.test = `Regresión lineal ${multi ? 'múltiple' : 'simple'} (MCO${stepwise ? `, ${mName}` : ''})${het ? ' con errores robustos HC3' : ''}`;
    sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa.`);
    if (stepwise) {
      sec.why.push(`${candidates.length} predictores candidatos: ${list(candidates.map(esc))}. Las variables categóricas se codifican como variables ficticias frente a una categoría de referencia y entran o salen del modelo como un bloque.`);
      sec.why.push(`Has elegido el método ${mName}: ${method === 'stepwise' ? 'en cada paso entra el predictor con menor valor <i>p</i> si es < .05, y sale cualquier predictor del modelo cuyo <i>p</i> supere .10 (criterios por defecto de SPSS y JASP)' : method === 'forward' ? 'en cada paso entra el predictor con menor valor <i>p</i> si es < .05, y los que entran no vuelven a salir' : 'se parte de todos los predictores y en cada paso sale el de mayor valor <i>p</i> si supera .10'}. Todos los pasos usan los mismos ${n} casos completos.`);
    } else sec.why.push(`${xNames.length} predictor${xNames.length > 1 ? 'es' : ''}: ${list(xNames.map(esc))}. Las variables categóricas se codifican como variables ficticias frente a una categoría de referencia.`);
    sec.why.push('La regresión estima cuánto cambia la variable dependiente por cada unidad de cada predictor, manteniendo constantes los demás.');
    sec.decision = (stepwise
      ? `Se ajustó una regresión lineal ${mName} con ${n} casos completos y ${candidates.length} predictores candidatos; el modelo final incluye ${xNames.length}: ${list(xNames.map(esc))}.`
      : `Se ajustó una regresión lineal ${multi ? 'múltiple' : 'simple'} con ${n} casos completos.`) + (het ? ' Como no se cumple la homocedasticidad, los contrastes de los coeficientes usan errores típicos robustos (HC3).' : '');
    if (stepwise) sec.checks.push(chk('info', 'Selección automática de predictores: los métodos por pasos se ajustan a las particularidades de la muestra, por lo que tienden a sobrestimar el <i>R</i>², y los <i>p</i>-valores del modelo final no tienen en cuenta la selección. Justifica los candidatos con la teoría y, si puedes, compara con el modelo con todos los predictores (método «Introducir»).'));
    if (het) sec.why.push('La prueba de Breusch-Pagan indica heterocedasticidad: los errores típicos clásicos no son fiables, así que se usan errores robustos HC3 para los contrastes.');
    const swr = S.shapiro(m.e);
    if (swr && swr.p >= .05) sec.checks.push(chk('ok', `Normalidad de los residuos (Shapiro-Wilk): <i>W</i> = ${nz(swr.W.toFixed(3))}, ${pt(swr.p)}.`));
    else sec.checks.push(chk(n >= 100 ? 'info' : 'no', `Normalidad de los residuos (Shapiro-Wilk): ${swr ? `<i>W</i> = ${nz(swr.W.toFixed(3))}, ${pt(swr.p)}` : 'no calculable'}.${n >= 100 ? ' Con muestras grandes la regresión es robusta a desviaciones moderadas.' : ' No se cumple: interpreta los p-valores con cautela.'}`));
    sec.checks.push(chk(het ? 'no' : 'ok', `Homocedasticidad (Breusch-Pagan): χ²(${m.bp.df}) = ${f(m.bp.LM)}, ${pt(m.bp.p)}. ${het ? 'No se cumple: se usan errores robustos HC3.' : 'Se cumple.'}`));
    sec.checks.push(chk(m.dw >= 1.5 && m.dw <= 2.5 ? 'ok' : 'no', `Independencia de los residuos (Durbin-Watson) = ${f(m.dw)} (aceptable entre 1.5 y 2.5). Solo es relevante si el orden de las filas tiene sentido, por ejemplo temporal.`));
    if (multi) { const maxV = Math.max(...m.vif.slice(1)); sec.checks.push(chk(maxV < 5 ? 'ok' : 'no', `Multicolinealidad: VIF máximo = ${f(maxV)}. ${maxV < 5 ? 'Sin problemas (VIF < 5).' : maxV < 10 ? 'Moderada (VIF entre 5 y 10): revisa los predictores correlacionados.' : 'Grave (VIF ≥ 10): elimina o combina predictores.'}`)); }
    const infl = m.cook.filter(c => c > 4 / n).length, big = m.cook.filter(c => c > 1).length;
    sec.checks.push(chk(big ? 'no' : 'info', `Casos influyentes (distancia de Cook): ${infl} casos superan 4/<i>n</i>${big ? ` y ${big} superan 1, lo que indica una influencia excesiva: revísalos` : '; ninguno supera 1'}.`));
    if (n < 10 * (p - 1)) sec.checks.push(chk('no', `Tamaño muestral: ${n} casos para ${p - 1} coeficientes. Se recomiendan al menos 10–15 casos por predictor.`));
    sec.alt = 'Si hay heterocedasticidad, errores robustos (HC3); si la relación no es lineal, transformar variables o añadir términos cuadráticos.';
    if (stepwise) {
      const stepRows = sel.steps.map((st, k) => [k + 1, `${st.accion === 'entra' ? 'Entra' : 'Sale'}: ${esc(st.t)}`, nz(st.r2.toFixed(3)), (st.dr2 < 0 ? '−' : '') + nz(Math.abs(st.dr2).toFixed(3)), `${f(st.F)} (${st.df[0]}, ${st.df[1]})`, pv(st.p)]);
      sec.tables.push(apaTable(`Pasos de la regresión ${mName}`, ['Paso', 'Cambio', '<i>R</i>²', 'Δ<i>R</i>²', '<i>F</i> de cambio (<i>gl</i>)', '<i>p</i>'], stepRows,
        `Criterio de entrada: <i>p</i> < .05${method !== 'forward' ? '; criterio de salida: <i>p</i> > .10' : ''}. ${method === 'backward' ? 'Se parte del modelo con todos los predictores; cada paso elimina uno.' : 'Cada paso añade o elimina un predictor respecto al anterior.'}`));
    }
    let hm = null;
    if (hier) {
      // un modelo por bloque, acumulando predictores; todos con los mismos casos completos (como SPSS y JASP)
      hm = blocks.map((_, b) => { const set = blocks.slice(0, b + 1).flat(), js = cols.map((c, j) => (j === 0 || set.includes(c.v.name) ? j : -1)).filter(j => j >= 0);
        const Xb = X.map(r => js.map(j => r[j])), mb = S.ols(Xb, y); return { js, m: mb, added: blocks[b], beta: js.map((j, q) => (q === 0 || !mb ? null : mb.b[q] * S.sd(X.map(r => r[j])) / sdY)) }; });
      if (hm.some(o => !o.m)) { sec.error = 'Hay colinealidad perfecta entre los predictores de algún bloque. Elimina alguno.'; return sec; }
      hm.forEach((o, b) => { const prev = b ? hm[b - 1] : null, r2p = prev ? prev.m.r2 : 0, df1 = o.js.length - (prev ? prev.js.length : 1), df2 = n - o.js.length;
        o.dr2 = o.m.r2 - r2p; o.Fc = (o.dr2 / df1) / ((1 - o.m.r2) / df2); o.dfc = [df1, df2]; o.pc = S.pF(o.Fc, df1, df2); });
      sec.why.push(`Regresión jerárquica en ${blocks.length} bloques: ${blocks.map((b, i) => `bloque ${i + 1}: ${list(b.map(esc))}`).join('; ')}. Cada modelo añade un bloque al anterior y Δ<i>R</i>² indica cuánta varianza explican los predictores nuevos por encima de los anteriores.`);
      sec.tables.push(apaTable('Resumen de los modelos de la regresión jerárquica', ['Modelo', 'Predictores añadidos', '<i>R</i>²', '<i>R</i>² ajustado', '<i>F</i> (<i>gl</i>)', '<i>p</i>', 'Δ<i>R</i>²', '<i>F</i> de cambio (<i>gl</i>)', '<i>p</i> del cambio'],
        hm.map((o, b) => [b + 1, list(o.added.map(esc)), nz(o.m.r2.toFixed(3)), nz(o.m.adjr2.toFixed(3)), `${f(o.m.F)} (${o.m.df1}, ${o.m.dfr})`, pv(o.m.pF), nz(o.dr2.toFixed(3)), `${f(o.Fc)} (${o.dfc[0]}, ${o.dfc[1]})`, pv(o.pc)]),
        `Todos los modelos usan los mismos ${n} casos completos. Δ<i>R</i>² y <i>F</i> de cambio comparan cada modelo con el anterior (el modelo 1, con el modelo nulo).`));
      const prevRows = hm.slice(0, -1).flatMap((o, b) => o.js.map((j, q) => [q === 0 ? `Modelo ${b + 1}` : '', esc(cols[j].name), f(o.m.b[q], 3), f(o.m.se[q], 3), q ? r2s(o.beta[q]) : '', f(o.m.t[q]), pv(o.m.pv[q])]));
      sec.tables.push(apaTable('Coeficientes de los modelos anteriores', ['Modelo', 'Predictor', '<i>B</i>', '<i>EE</i>', 'β', '<i>t</i>', '<i>p</i>'], prevRows, `Los coeficientes del modelo final (modelo ${hm.length}) aparecen en la tabla siguiente, con sus intervalos de confianza y el diagnóstico.`));
    }
    sec.tables.push(apaTable(stepwise ? `Resumen del modelo final${sel.steps.length ? ` (paso ${sel.steps.length})` : ''}` : hier ? `Resumen del modelo final (modelo ${hm.length})` : 'Resumen del modelo de regresión', ['<i>R</i>²', '<i>R</i>² ajustado', '<i>F</i>', '<i>gl</i>', '<i>p</i>', '<i>n</i>'], [[nz(m.r2.toFixed(3)), nz(m.adjr2.toFixed(3)), f(m.F), `${m.df1}, ${m.dfr}`, pv(m.pF), n]]));
    const head = ['Predictor', '<i>B</i>', '<i>EE</i>', 'IC 95 % (<i>B</i>)', 'β', '<i>t</i>', '<i>p</i>'].concat(het ? ['<i>EE</i> (HC3)', '<i>p</i> (HC3)'] : []).concat(multi ? ['VIF'] : []);
    const beta = cols.map((c, j) => (j === 0 ? null : m.b[j] * S.sd(X.map(r => r[j])) / sdY));
    const rows = cols.map((c, j) => [esc(c.name), f(m.b[j], 3), f(m.se[j], 3), `[${f(m.ci[j][0], 3)}, ${f(m.ci[j][1], 3)}]`, j ? r2s(beta[j]) : '', f(m.t[j]), pv(m.pv[j])]
      .concat(het ? [f(m.se3[j], 3), pv(m.p3[j])] : []).concat(multi ? [j ? f(m.vif[j]) : ''] : []));
    sec.tables.push(apaTable(`Coeficientes del modelo de regresión para ${yName}`, head, rows, '<i>B</i> = coeficiente no estandarizado; β = coeficiente estandarizado.' + (het ? ' HC3 = errores típicos robustos a la heterocedasticidad.' : '')));
    if (multi) { // correlaciones de orden cero, parcial y semiparcial de cada predictor y tolerancia (como SPSS)
      const corrRows = cols.slice(1).map((c, q) => { const j = q + 1, xj = X.map(r => r[j]), r0 = S.pearson(xj, y).r, tj = m.t[j], df = m.dfr;
        const part = tj * Math.sqrt((1 - m.r2) / df), partial = tj / Math.sqrt(tj * tj + df);
        return [esc(c.name), r2s(r0), r2s(partial), r2s(part), nz((part * part).toFixed(3)), nz((1 / m.vif[j]).toFixed(3))]; });
      sec.tables.push(apaTable('Correlaciones y colinealidad de los predictores', ['Predictor', '<i>r</i> de orden cero', '<i>r</i> parcial', '<i>r</i> semiparcial', '<i>sr</i>²', 'Tolerancia'], corrRows,
        '<i>sr</i>² = semiparcial al cuadrado: proporción de varianza de la variable dependiente que explica cada predictor por sí solo, por encima de los demás. Tolerancia = 1 / VIF (valores < .10 indican colinealidad grave).'));
    }
    const pUse = het ? m.p3 : m.pv, sigP = cols.map((c, j) => ({ c, j })).filter(o => o.j > 0 && pUse[o.j] < .05);
    const out = stepwise ? candidates.filter(c => !xNames.includes(c)) : [];
    const hierTxt = !hier ? '' : `Se realizó una regresión lineal jerárquica en ${hm.length} pasos para predecir ${esc(yName)}. ` + hm.map((o, b) => b === 0
      ? `En el modelo 1, ${list(o.added.map(esc))} explic${o.added.length > 1 ? 'aron' : 'ó'} el ${f(o.m.r2 * 100, 1)} % de la varianza, <i>F</i>(${o.m.df1}, ${o.m.dfr}) = ${f(o.m.F)}, ${pt(o.m.pF)}.`
      : `Al añadir ${list(o.added.map(esc))} en el modelo ${b + 1}, la varianza explicada ${o.pc < .05 ? 'aumentó significativamente' : 'no aumentó significativamente'}, Δ<i>R</i>² = ${nz(o.dr2.toFixed(3))}, <i>F</i>(${o.dfc[0]}, ${o.dfc[1]}) = ${f(o.Fc)}, ${pt(o.pc)}.`).join(' ') + ' ';
    let t = (hier ? hierTxt + `El modelo final (modelo ${hm.length})` : stepwise
      ? `Se realizó un análisis de regresión lineal múltiple ${mName} (criterio de entrada <i>p</i> < .05${method !== 'forward' ? ' y de salida <i>p</i> > .10' : ''}) para predecir ${esc(yName)} a partir de ${candidates.length} predictores candidatos. ${sel.steps.length ? `El procedimiento terminó en el paso ${sel.steps.length} con` : 'El modelo final incluyó'} ${xNames.length} predictor${xNames.length > 1 ? 'es' : ''}. El modelo final`
      : `Se realizó un análisis de regresión lineal ${multi ? 'múltiple' : 'simple'} para predecir ${esc(yName)} a partir de ${list(xNames.map(esc))}. El modelo`) + ` ${m.pF < .05 ? '' : 'no '}fue estadísticamente significativo, <i>F</i>(${m.df1}, ${m.dfr}) = ${f(m.F)}, ${pt(m.pF)}, y explicó el ${f(m.r2 * 100, 1)} % de la varianza (<i>R</i>² ajustado = ${nz(m.adjr2.toFixed(2))}). `;
    if (m.pF < .05) {
      if (sigP.length) t += list(sigP.map(o => `${esc(o.c.name)} ${m.b[o.j] > 0 ? 'se asoció positivamente' : 'se asoció negativamente'} con ${esc(yName)} (<i>B</i> = ${f(m.b[o.j], 2)}, β = ${r2s(beta[o.j])}, ${pt(pUse[o.j])})`)) + '. ';
      const ns = cols.filter((c, j) => j > 0 && pUse[j] >= .05).map(c => esc(c.name));
      if (ns.length) t += `${list(ns)} no ${ns.length > 1 ? 'fueron predictores significativos' : 'fue un predictor significativo'}.`;
    }
    if (out.length) t += ` ${list(out.map(esc))} no ${out.length > 1 ? 'entraron' : 'entró'} en el modelo.`;
    if (het) t += ' Los contrastes de los coeficientes se basan en errores típicos robustos (HC3).';
    sec.text.push(t);
    if (!multi && cols[1].level === undefined) sec.charts.push(fig(`${yName} según ${cols[1].name}`, CH.scatter(X.map(r => r[1]), y, cols[1].name, yName, { line: [m.b[0], m.b[1]] })));
    sec.charts.push(fig('Residuos frente a valores predichos', CH.scatter(m.fit, m.e, 'Valor predicho', 'Residuo', { zero: true })));
    const fml = `${rn(yName)} ~ ${xNames.map(rn).join(' + ')}`;
    const stepCode = !stepwise ? '' : `# Selección ${mName} con contrastes F parciales (entrada p < .05, salida p > .10), como SPSS y JASP.\n` +
      `# Las variables categóricas entran o salen como un bloque; todos los pasos usan los mismos casos completos.\n` +
      `candidatos <- c(${candidates.map(rq).join(', ')})\n` +
      `datos_c <- na.omit(datos[, c(${rq(yName)}, candidatos)])\n` +
      `ff <- function(v) reformulate(if (length(v)) sprintf("\`%s\`", v) else "1", response = sprintf("\`%s\`", ${rq(yName)}))\n` +
      `pvals <- function(tab) setNames(tab[-1, "Pr(>F)"], gsub("\`", "", rownames(tab)[-1]))\n` +
      `dentro <- ${method === 'backward' ? 'candidatos' : 'character(0)'}\n` +
      `repeat {\n  cambio <- FALSE\n` +
      (method !== 'backward' ? `  fuera <- setdiff(candidatos, dentro)\n  if (length(fuera)) {\n    pa <- pvals(add1(lm(ff(dentro), data = datos_c), scope = ff(candidatos), test = "F"))\n    if (min(pa) < .05) { dentro <- c(dentro, names(which.min(pa))); cambio <- TRUE }\n  }\n` : '') +
      (method !== 'forward' ? `  if (length(dentro)) {\n    pd <- pvals(drop1(lm(ff(dentro), data = datos_c), test = "F"))\n    if (max(pd) > .10) { dentro <- setdiff(dentro, names(which.max(pd))); cambio <- TRUE }\n  }\n` : '') +
      `  if (!cambio) break\n}\ndentro  # predictores seleccionados\n`;
    const hierCode = !hier ? '' : `# Regresión jerárquica: los mismos casos completos en todos los modelos\ndatos_c <- na.omit(datos[, c(${[yName].concat(blocks.flat()).map(rq).join(', ')})])\n` +
      blocks.map((b, i) => `m${i + 1} <- ${i === 0 ? `lm(${rn(yName)} ~ ${b.map(rn).join(' + ')}, data = datos_c)` : `update(m${i}, . ~ . + ${b.map(rn).join(' + ')})`}\n`).join('') +
      blocks.slice(1).map((_, i) => `anova(m${i + 1}, m${i + 2})  # F de cambio del modelo ${i + 2} (como SPSS y JASP)\n`).join('') + `sapply(list(${blocks.map((_, i) => 'm' + (i + 1)).join(', ')}), function(m) summary(m)$r.squared)  # R² de cada modelo\nmodelo <- m${blocks.length}\n`;
    sec.code = `# Regresión lineal${stepwise ? ` ${mName}` : hier ? ' jerárquica' : ''}: ${yName}\n` + (stepwise ? `${stepCode}modelo <- lm(ff(dentro), data = datos_c)\n` : hier ? hierCode : `modelo <- lm(${fml}, data = datos)\n`) + `summary(modelo)\nconfint(modelo)\nparameters::standardize_parameters(modelo, method = "basic")  # β como en SPSS\nshapiro.test(residuals(modelo))\nlmtest::bptest(modelo)\nlmtest::dwtest(modelo)\n` + (xNames.length > 1 ? 'car::vif(modelo)\n' : '') + `sum(cooks.distance(modelo) > 4 / nobs(modelo))` + (het ? '\nlmtest::coeftest(modelo, vcov = sandwich::vcovHC(modelo, type = "HC3"))' : '');
    return sec;
  }

  // ---------- ejecutar y mostrar ----------
  function run() {
    tabNo = 0; figNo = 0; const secs = [], log = [];
    const ign = ST.vars.filter(v => v.type === 'ign').map(v => v.name), changed = ST.vars.filter(v => v.type !== v.auto);
    log.push(`Archivo «${esc(ST.fileName)}»: ${ST.rows.length} participantes y ${ST.vars.length} variables (${byType('num').length} cuantitativas, ${byType('cat').length} categóricas).`);
    if (ST.source) log.push(`Archivo de ${esc(ST.source)}: se han respetado los tipos de medida (escala, ordinal, nominal) y las etiquetas de valor definidos en ${ST.sourceApp}.`, ...ST.sourceNotes.map(esc));
    if (ign.length) log.push(`Variables excluidas del análisis: ${list(ign.map(esc))}.`);
    if (changed.length) log.push(`Tipos de variable modificados por ti: ${list(changed.map(v => `${esc(v.name)} → ${{ num: 'cuantitativa', cat: 'categórica', ign: 'ignorada' }[v.type]}`))}.`);
    if (ST.tf && ST.tf.length) log.push(`Preparación de los datos: ${ST.tf.map(t => t.desc + (t.type === 'filter' ? ` (quedan ${t.kept} casos)` : '')).join('; ')}.`);
    const ordU = ST.vars.filter(v => v.type === 'cat' && v.orderUser); if (ordU.length) log.push(`Orden de categorías elegido por ti: ${ordU.map(v => `${esc(v.name)} (${list(levelsOf(v).map(esc))})`).join('; ')}.`);
    const nn = ST.vars.filter(v => v.type === 'num' && v.nonNum); if (nn.length) log.push(`Valores no numéricos tratados como perdidos en ${list(nn.map(v => `${esc(v.name)} (${v.nonNum})`))}.`);
    log.push('Valores perdidos: cada análisis usa los casos con datos completos en sus variables (las correlaciones, por parejas).');
    const add = s => { secs.push(s); if (s.decision) log.push(`<b>${esc(s.title)}:</b> ${s.decision}`); else if (s.error) log.push(`<b>${esc(s.title)}:</b> no se pudo realizar. ${esc(s.error)}`); };
    try {
      if (isOn('desc')) { const v = checkedVals('desc'); if (v.length) add(runDescriptives(v, ($('#descG') || {}).value || '')); }
      if (isOn('corr')) add(runCorrelations(checkedVals('corr'), $('#corrM').value, checkedVals('corrZ')));
      if (isOn('comp')) { const g = $('#compG') && $('#compG').value; checkedVals('compY').forEach(y => add(runCompare(y, g, ($('#compAlt') || {}).value || 'two', { ph: ($('#compPH') || {}).value || 'auto', ctrl: ($('#compCtrl') || {}).value || '', con: ($('#compCon') || {}).value || '' }))); }
      if (isOn('one')) { const ys = checkedVals('oY'), mu = parseFloat(String(($('#oMu') || {}).value || '').replace(',', '.'));
        if (ys.length) ys.forEach(y => add(runOneSample(y, mu, ($('#oAlt') || {}).value || 'two')));
        else add({ title: 'Una muestra', error: 'Selecciona al menos una variable.', why: [], checks: [], tables: [], charts: [], text: [] }); }
      if (isOn('prop')) { const vs = checkedVals('prV'), p0 = parseFloat(String(($('#prP0') || {}).value || '0.5').replace(',', '.')), pr = String(($('#prProbs') || {}).value || '').trim();
        if (vs.length) vs.forEach(v => add(runProp(v, p0, ($('#prAlt') || {}).value || 'two', pr)));
        else add({ title: 'Proporciones', error: 'Selecciona al menos una variable categórica.', why: [], checks: [], tables: [], charts: [], text: [] }); }
      if (isOn('agree')) add(runAgree(checkedVals('agV'), { model: ($('#agM') || {}).value || 'ICC2', unit: ($('#agU') || {}).value || 'single', weight: ($('#agW') || {}).value || 'none' }));
      if (isOn('roc')) add(runRoc(checkedVals('rocX'), ($('#rocY') || {}).value, ($('#rocPos') || {}).value));
      if (isOn('paired') && +(($('#pW1K') || {}).value) >= 2 && +(($('#pW2K') || {}).value) >= 2) {
        const k1 = Math.round(+$('#pW1K').value), k2 = Math.round(+$('#pW2K').value);
        add(runRm2(checkedVals('pM'), [($('#pW1N').value || 'Factor 1').trim(), ($('#pW2N').value || 'Factor 2').trim()], [k1, k2], ($('#pB') || {}).value || '')); }
      else if (isOn('paired')) { const m = checkedVals('pM'), gB = ($('#pB') || {}).value;
        add(m.length >= 2 && gB ? runMixed(m, gB) : m.length === 2 ? runPaired(m[0], m[1], ($('#pAlt') || {}).value || 'two') : m.length > 2 ? runRepeated(m) :{ title: 'Medidas relacionadas', error: 'Selecciona al menos dos momentos o condiciones.', why: [], checks: [], tables: [], charts: [], text: [] }); }
      if (isOn('chi')) add(runChi($('#cA').value, $('#cB').value, ($('#cS') || {}).value || ''));
      if (isOn('reg')) { const meth = ($('#rM') || {}).value || 'enter';
        if (meth === 'blocks') { const bl = [checkedVals('rX'), checkedVals('rB2'), checkedVals('rB3')].map((b, i, all) => b.filter(x => !all.slice(0, i).flat().includes(x))).filter(b => b.length);
          add(runRegression($('#rY').value, bl.flat(), 'blocks', bl)); }
        else add(runRegression($('#rY').value, checkedVals('rX'), meth)); }
      if (isOn('manova')) add(runManova(checkedVals('mvY'), [($('#mvA') || {}).value, ($('#mvB') || {}).value].filter(Boolean), checkedVals('mvC')));
      if (isOn('mlogit')) add(runPolyLogit(($('#mlY') || {}).value, checkedVals('mlX'), ($('#mlM') || {}).value || 'auto'));
      if (isOn('logit')) add(runLogistic($('#lY').value, checkedVals('lX')));
      if (isOn('fact')) { const ys = checkedVals('fY');
        const f3 = ($('#fC') || {}).value || '', cv = checkedVals('fCov');
        if (ys.length) ys.forEach(y => add(f3 || cv.length ? runFactorialG(y, [$('#fA').value, $('#fB').value].concat(f3 ? [f3] : []), cv) : runFactorial(y, $('#fA').value, $('#fB').value)));
        else add({ title: 'ANOVA factorial', error: 'Selecciona al menos una variable dependiente.', why: [], checks: [], tables: [], charts: [], text: [] }); }
      if (isOn('ancova')) add(runAncova($('#acY').value, $('#acG').value, checkedVals('acC')));
      if (isOn('binrel')) add(runBinRel(checkedVals('bR')));
      if (isOn('cfa')) add(runCfa([0, 1, 2, 3].map(k => ({ name: $('#cfN' + k).value.trim() || `Factor ${k + 1}`, items: checkedVals('cfI' + k) })).filter(fc => fc.items.length)));
      if (isOn('lmm')) add(runLmm($('#lmY').value, checkedVals('lmX'), $('#lmG').value, $('#lmS').value, [$('#lmIA').value, $('#lmIB').value]));
      if (isOn('mod')) add(runModeration($('#moY').value, $('#moX').value, $('#moW').value));
      if (isOn('med')) { const mo = ($('#meMod') || {}).value || '4', cvs = checkedVals('meC');
        if (mo === '4' && !cvs.length) add(runMediation($('#meY').value, $('#meX').value, $('#meM').value));
        else add(runProcess(mo, $('#meY').value, $('#meX').value, [$('#meM').value].concat(mo === '4p' || mo === '6' ? checkedVals('meM2').filter(m => m !== $('#meM').value) : []), mo === '7' || mo === '14' ? $('#meW').value : '', cvs)); }
      if (isOn('efa')) add(runEfa(checkedVals('eI'), $('#eN').value, $('#eR').value, ($('#eE') || {}).value || 'pa'));
      if (isOn('alpha')) add(runAlpha(checkedVals('aI'), checkedVals('aR')));
    } catch (e) { console.error(e); alert('Ha ocurrido un error inesperado en el análisis: ' + e.message); return; }
    if (!secs.length) { alert('Selecciona al menos un análisis.'); return; }
    ST.sections = secs; ST.log = log; renderResults(); show(4);
    track('analisis_ejecutados', { n: secs.length, pruebas: secs.filter(x => !x.error).map(x => x.test || '').join(' | ').slice(0, 480) });
  }
  function renderResults() {
    $('#log').innerHTML = ST.log.map(l => `<li>${l}</li>`).join('');
    $('#results').innerHTML = ST.sections.map((s, si) => {
      if (s.error) return `<div class="res"><h2>${esc(s.title)}</h2><div class="warnbox">⚠️ ${esc(s.error)}</div></div>`;
      const charts = s.charts.map((c, ci) => { figNo++; return `<figure><figcaption><span>Figura ${figNo}. ${esc(c.title)}</span><button data-png="${si}-${ci}">PNG</button></figcaption>${c.legend}${c.svg}</figure>`; }).join('');
      return `<div class="res" data-sec="${si}">
        <h2>${esc(s.title)}</h2><span class="test">${esc(s.test || '')}</span>
        <p class="decision">${s.decision || ''}</p>
        ${s.warn ? `<div class="warnbox">⚠️ ${s.warn}</div>` : ''}
        ${s.tables.join('')}
        ${charts ? `<div class="charts${s.charts.length === 1 ? ' one' : ''}">${charts}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px"><b>Redacción de resultados (APA)</b><button class="btn btn-line btn-sm" data-copy="${si}">Copiar texto</button></div>
        <div class="text" id="txt${si}">${s.text.map(t => `<p>${t}</p>`).join('')}</div>
        ${s.sens ? `<p class="small muted">${s.sens}</p>` : ''}
        <details open><summary>¿Por qué este análisis?</summary><ul class="why">${s.why.map(w => `<li>${w}</li>`).join('')}</ul>${s.alt ? `<p class="small" style="margin:10px 0 0"><b>Alternativa:</b> ${s.alt}</p>` : ''}</details>
        ${s.checks.length ? `<details open><summary>Supuestos comprobados</summary><ul class="checks">${s.checks.map(c => `<li class="${c.s}">${c.t}</li>`).join('')}</ul></details>` : ''}
        <details><summary>Código R para reproducirlo</summary><pre>${esc(s.code)}</pre></details>
      </div>`;
    }).join('');
    $$('[data-copy]').forEach(b => b.onclick = () => { const t = $('#txt' + b.dataset.copy).innerText; navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copiado ✓'; setTimeout(() => b.textContent = 'Copiar texto', 1500); }); });
    $$('[data-png]').forEach(b => b.onclick = () => { const [si, ci] = b.dataset.png.split('-').map(Number), c = ST.sections[si].charts[ci]; svgToPng(c.svg, c.title); track('descarga_png'); });
  }

  // ---------- exportación ----------
  function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').toLowerCase().slice(0, 50);
  function svgToPng(svg, title) {
    const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => { const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/), w = +vb[1], h = +vb[2], c = document.createElement('canvas'); c.width = w * 3; c.height = h * 3;
      const g = c.getContext('2d'); g.scale(3, 3); g.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url); c.toBlob(b => download(slug(title) + '.png', b)); };
    img.src = url;
  }
  function svgToPngBuffer(svg) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      img.onload = () => { const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/), w = +vb[1], h = +vb[2], c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
        const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
        c.toBlob(b => b.arrayBuffer().then(buf => res({ buf, w, h }), rej)); };
      img.onerror = rej; img.src = url;
    });
  }
  // Word (.docx) real: tablas APA, cursivas estadísticas y gráficos incrustados
  async function exportDocx() {
    const D = window.docx; if (!D) return exportWord();
    const btn = $('#dlWord'), label = btn.textContent; btn.textContent = 'Generando…'; btn.disabled = true;
    try {
      const runs = (html, base = {}) => { const out = [], el = document.createElement('div'); el.innerHTML = html;
        (function walk(node, st) { node.childNodes.forEach(c => {
          if (c.nodeType === 3) { if (c.textContent) out.push(new D.TextRun(Object.assign({ text: c.textContent.replace(/ /g, ' ') }, st))); return; }
          const t = c.tagName, s2 = Object.assign({}, st);
          if (t === 'I' || t === 'EM') s2.italics = true; if (t === 'B' || t === 'STRONG') s2.bold = true; if (t === 'SUB') s2.subScript = true; if (t === 'SUP') s2.superScript = true;
          if (t === 'BR') { out.push(new D.TextRun({ break: 1 })); return; }
          walk(c, s2); }); })(el, base);
        return out; };
      const P = (html, opt = {}) => new D.Paragraph(Object.assign({ children: runs(html, opt.run || {}), spacing: { after: 120 } }, opt.p || {}));
      const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, LINE = sz => ({ style: D.BorderStyle.SINGLE, size: sz, color: '000000' });
      const tableFrom = html => {
        const el = document.createElement('div'); el.innerHTML = html; const t = el.querySelector('table'), out = [];
        const cap = t.querySelector('caption'); if (cap) { out.push(P(`<b>${cap.querySelector('b').innerHTML}</b>`, { p: { spacing: { before: 240, after: 0 } } })); out.push(P(`<i>${cap.querySelector('i').innerHTML}</i>`)); }
        const head = [...t.querySelectorAll('thead th')], body = [...t.querySelectorAll('tbody tr')];
        const cell = (h, i, borders, bold) => new D.TableCell({ borders, children: [new D.Paragraph({ alignment: i === 0 ? D.AlignmentType.LEFT : D.AlignmentType.CENTER, children: runs(h.replace(/<span[^>]*>|<\/span>/g, ''), bold ? { bold: true } : {}) })] });
        const rows = [new D.TableRow({ tableHeader: true, children: head.map((h, i) => cell(h.innerHTML, i, { top: LINE(12), bottom: LINE(8), left: NONE, right: NONE }, false)) })];
        body.forEach((r, k) => rows.push(new D.TableRow({ children: [...r.children].map((c, i) => cell(c.innerHTML, i, { top: NONE, bottom: k === body.length - 1 ? LINE(12) : NONE, left: NONE, right: NONE })) })));
        out.push(new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE } }));
        const note = el.querySelector('.note'); if (note) out.push(P(note.innerHTML, { run: { size: 20 }, p: { spacing: { before: 80, after: 200 } } }));
        return out;
      };
      const kids = [new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun('Resultados del análisis estadístico')] }),
        P(`Generado con Tharp (tharp.es) el ${new Date().toLocaleDateString('es-ES')} a partir de «${esc(ST.fileName)}».`, { run: { color: '555555' } }),
        new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('Registro de decisiones')] })];
      ST.log.forEach((l, i) => kids.push(P(`${i + 1}. ${l}`)));
      let figN = 0;
      for (const s of ST.sections) {
        kids.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun(s.title)], spacing: { before: 360 } }));
        if (s.error) { kids.push(P(esc(s.error))); continue; }
        if (s.decision) kids.push(P(s.decision));
        s.tables.forEach(t => kids.push(...tableFrom(t)));
        kids.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun('Redacción de resultados')] }));
        s.text.forEach(t => kids.push(P(t)));
        for (const c of s.charts) {
          figN++; const { buf, w, h } = await svgToPngBuffer(c.svg), W = Math.min(560, w * (w > 400 ? .87 : 1.2)), Hh = W * h / w;
          kids.push(P(`<b>Figura ${figN}</b>`, { p: { spacing: { before: 240, after: 0 } } }), P(`<i>${esc(c.title)}</i>`));
          if (c.legend) kids.push(P(c.legend.replace(/<i[^>]*><\/i>/g, '■ '), { run: { size: 18 } }));
          kids.push(new D.Paragraph({ children: [new D.ImageRun({ data: buf, transformation: { width: W, height: Hh } })] }));
        }
        kids.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun('Justificación y supuestos')] }));
        s.why.forEach(w => kids.push(P('• ' + w)));
        if (s.alt) kids.push(P('<b>Alternativa:</b> ' + s.alt));
        s.checks.forEach(c => kids.push(P(({ ok: '✓ ', no: '⚠ ', info: 'ℹ ' })[c.s] + c.t)));
        if (s.sens) kids.push(P(s.sens));
      }
      const doc = new D.Document({ creator: 'Tharp', title: 'Resultados del análisis estadístico',
        styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } }, sections: [{ children: kids }] });
      download('tharp_resultados.docx', await D.Packer.toBlob(doc)); track('descarga_word');
    } catch (e) { console.error(e); alert('No se pudo generar el Word: ' + e.message); }
    finally { btn.textContent = label; btn.disabled = false; }
  }
  function exportWord() {
    const box = document.createElement('div'); box.innerHTML = $('#results').innerHTML;
    box.querySelectorAll('figure, details, button, .test').forEach(e => e.remove());
    box.querySelectorAll('.text').forEach(e => { e.removeAttribute('class'); e.removeAttribute('id'); });
    box.querySelectorAll('table.apa').forEach(t => {
      t.setAttribute('cellpadding', '4'); t.style.borderCollapse = 'collapse';
      const cap = t.querySelector('caption'); if (cap) { const p = document.createElement('p'); p.innerHTML = cap.innerHTML.replace('</b>', '</b><br>'); t.parentNode.insertBefore(p, t); cap.remove(); }
      t.querySelectorAll('thead th').forEach(c => c.setAttribute('style', 'border-top:1.5pt solid #000;border-bottom:1pt solid #000;padding:4px 8px;text-align:center'));
      const last = t.querySelectorAll('tbody tr'); last.forEach((r, i) => r.querySelectorAll('td').forEach(c => c.setAttribute('style', `padding:3px 8px;text-align:center;${i === last.length - 1 ? 'border-bottom:1.5pt solid #000;' : ''}`)));
      t.querySelectorAll('tr').forEach(r => { const c = r.firstElementChild; if (c) c.style.textAlign = 'left'; });
      t.querySelectorAll('td span[style]').forEach(s => s.removeAttribute('style'));
    });
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Resultados</title>
      <style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5}h1{font-size:16pt}h2{font-size:13pt;margin-top:18pt}table{border-collapse:collapse;margin:6pt 0}.note{font-size:10pt}.muted{color:#555}</style></head><body>
      <h1>Resultados del análisis estadístico</h1><p class="muted">Generado con Tharp (tharp.es) el ${new Date().toLocaleDateString('es-ES')} a partir de «${esc(ST.fileName)}».</p>
      <h2>Registro de decisiones</h2><ol>${ST.log.map(l => `<li>${l}</li>`).join('')}</ol>${box.innerHTML}
      <p class="muted" style="margin-top:24pt">Los gráficos pueden descargarse en formato PNG desde Tharp e insertarse en este documento.</p></body></html>`;
    download('tharp_resultados.doc', new Blob(['﻿', html], { type: 'application/msword' }));
  }
  function exportR() {
    const isCsv = /\.(csv|tsv|txt)$/i.test(ST.fileName), isJasp = /\.jasp$/i.test(ST.fileName), isSav = /\.z?sav$/i.test(ST.fileName), cats = byType('cat');
    let s = `# ===============================================================\n# Script generado por Tharp (tharp.es) — ${new Date().toLocaleDateString('es-ES')}\n# Reproduce los análisis realizados sobre «${ST.fileName}»\n# Paquetes: psych, car, effectsize, rstatix, FSA, rcompanion, lmtest, sandwich, parameters\n# ===============================================================\n\n`;
    const NA = 'c("", "NA", "N/A", "n/a", "NaN", "null", "NULL", ".", "-", "#N/A", "NS/NC", "ns/nc", "NSNC")';
    const csv = ST.csv || { sep: ';', dec: ',', enc: 'UTF-8-BOM' };
    s += isJasp ? `# R no lee archivos .jasp: en JASP usa Archivo → Exportar → Exportar datos (CSV) y guárdalo junto a este script.\ndatos <- read.csv(${rq(ST.fileName.replace(/\.jasp$/i, '.csv'))}, na.strings = ${NA}, check.names = FALSE, strip.white = TRUE)\n`
      : isSav ? `datos <- haven::read_sav(${rq(ST.fileName)})  # los valores perdidos definidos en SPSS se leen como NA\n`
      : isCsv ? `datos <- read.csv(${rq(ST.fileName)}, sep = ${rq(csv.sep)}, dec = ${rq(csv.dec)}, fileEncoding = ${rq(csv.enc)}, na.strings = ${NA}, check.names = FALSE, strip.white = TRUE)\n`
      : `datos <- readxl::read_excel(${rq(ST.fileName)}${ST.sheet ? ', sheet = ' + rq(ST.sheet) : ''}, na = ${NA})\ndatos <- as.data.frame(datos)\n`;
    if (ST.tf && ST.tf.length) s += `\n# Preparación de los datos (las mismas transformaciones que en Tharp, en el mismo orden)\n${ST.tf.map(t => tfCode(t, isSav)).join('\n')}\n`;
    // niveles en el mismo orden que Tharp: así coinciden las categorías de referencia y el suceso de la logística
    const fac = v => { const x = `datos$${rn(v.name)}`, src = isSav ? (v.labelled ? `as.character(haven::as_factor(${x}))` : `haven::zap_labels(${x})`) : x;
      return `${x} <- factor(${src}, levels = c(${levelsOf(v).map(rq).join(', ')}))`; };
    if (cats.length) s += `\n# Variables categóricas como factor (mismo orden de categorías que en Tharp)\n${cats.map(fac).join('\n')}\n`;
    if (isSav) s += `datos <- as.data.frame(haven::zap_labels(datos))\n`;
    s += '\n' + ST.sections.filter(x => !x.error).map(x => x.code).join('\n\n') + '\n';
    download('tharp_analisis.R', new Blob([s], { type: 'text/plain' })); track('descarga_r');
  }

  // ---------- datos de ejemplo ----------
  function demoData() {
    let seed = 20261014; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const norm = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const clip = (v, a, b) => Math.max(a, Math.min(b, v)), r1 = v => Math.round(v * 10) / 10;
    const head = ['id', 'sexo', 'edad', 'grupo', 'curso', 'horas_sueno', 'ansiedad_pre', 'ansiedad_post', 'estres', 'autoestima', 'rendimiento', 'satisfaccion', 'fuma', 'ae1', 'ae2', 'ae3', 'ae4', 'ae5', 'ae6'], rows = [head];
    const grupos = ['Control', 'Mindfulness', 'Ejercicio'], efecto = { Control: 0.5, Mindfulness: 5, Ejercicio: 3 };
    for (let i = 1; i <= 324; i++) {
      const sexo = rnd() < .58 ? 'Mujer' : 'Hombre', grupo = grupos[(i - 1) % 3], curso = ['1º', '2º', '3º', '4º'][Math.floor(rnd() * 4)];
      const edad = Math.round(clip(18 + Math.abs(norm()) * 4.5 + (rnd() < .06 ? 10 : 0), 18, 45));
      const sueno = r1(clip(7 + norm(), 3.5, 10)), pre = r1(clip(25 + (sexo === 'Mujer' ? 2 : 0) + norm() * 6, 5, 50));
      const post = r1(clip(pre - efecto[grupo] + norm() * 4, 3, 50));
      const estres = r1(clip(20 + .5 * (pre - 25) - 1.6 * (sueno - 7) + norm() * 4, 0, 40));
      const autoest = r1(clip(30 - .35 * (post - 22) + norm() * 4.5, 10, 40));
      const rend = r1(clip(6.4 + .35 * (sueno - 7) - .07 * (estres - 20) + norm() * 1.2, 0, 10));
      const satis = Math.round(clip(3 + .25 * (rend - 6.4) + norm() * .9, 1, 5));
      const fuma = rnd() < (.08 + .012 * Math.max(0, estres - 12)) ? 'Sí' : 'No';
      const lat = (autoest - 29) / 5, item = (inv) => Math.round(clip(3 + (inv ? -1 : 1) * .9 * lat + norm() * .75, 1, 5));
      rows.push([i, sexo, edad, grupo, curso, rnd() < .03 ? null : sueno, pre, post, estres, rnd() < .02 ? null : autoest, rend, rnd() < .04 ? null : satis, fuma,
        item(), item(), item(), item(true), item(), item()]);
    }
    // seguimiento a los 3 meses, con un generador aparte para no alterar el resto de los datos de ejemplo
    let s2 = 31415; const rnd2 = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
    const n2 = () => { let u = 0; while (!u) u = rnd2(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd2()); };
    rows[0].push('ansiedad_seguimiento');
    for (let i = 1; i < rows.length; i++) { const post = rows[i][7], g = rows[i][3]; rows[i].push(rnd2() < .05 ? null : r1(clip(post + (g === 'Control' ? -.3 : .9) + n2() * 3.2, 3, 50))); }
    return rows;
  }
  const DEMO_DEFAULTS = { comp: { y: ['ansiedad_post'], g: 'grupo' }, paired: { vars: ['ansiedad_pre', 'ansiedad_post', 'ansiedad_seguimiento'] }, chi: { a: 'sexo', b: 'fuma' },
    reg: { y: 'rendimiento', x: ['horas_sueno', 'estres', 'ansiedad_post'] }, logit: { y: 'fuma', x: ['estres', 'sexo', 'edad'] },
    fact: { y: 'ansiedad_post', a: 'grupo', b: 'sexo' }, alpha: { items: ['ae1', 'ae2', 'ae3', 'ae4', 'ae5', 'ae6'], rev: ['ae4'] }, efa: { items: ['ae1', 'ae2', 'ae3', 'ae4', 'ae5', 'ae6'] }, cfa: [{ name: 'Autoestima', items: ['ae1', 'ae2', 'ae3', 'ae4', 'ae5', 'ae6'] }], mod: { y: 'rendimiento', x: 'estres', w: 'horas_sueno' }, med: { x: 'ansiedad_pre', m: 'ansiedad_post', y: 'autoestima' }, ancova: { y: 'ansiedad_post', g: 'grupo', c: ['ansiedad_pre'] }, corr: ['edad', 'horas_sueno', 'ansiedad_pre', 'ansiedad_post', 'estres', 'autoestima', 'rendimiento', 'satisfaccion'] };

  // ---------- navegación ----------
  function show(n) {
    [1, 2, 3, 4].forEach(i => $('#s' + i).classList.toggle('hidden', i !== n));
    $$('#stepper div').forEach(d => { const s = +d.dataset.s; d.className = s === n ? 'on' : s < n ? 'done' : ''; });
    if (n === 3) renderConfig();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('[data-go]').forEach(b => b.onclick = () => show(+b.dataset.go));

  // ---------- calculadora de potencia y tamaño muestral (no necesita datos) ----------
  const PW = {
    't-ind': { es: 'd de Cohen', pre: [.2, .5, .8], n: 'n por grupo', help: 'd = diferencia de medias / desviación típica. Si los grupos tienen tamaños distintos, indica la razón n₂/n₁.' },
    't-paired': { es: 'd<sub>z</sub> de Cohen', pre: [.2, .5, .8], n: 'n (pares)', help: 'd<sub>z</sub> = media de las diferencias / desviación típica de las diferencias.' },
    't-one': { es: 'd de Cohen', pre: [.2, .5, .8], n: 'n', help: 'd = (media − valor de referencia) / desviación típica.' },
    anova: { es: 'f de Cohen', pre: [.1, .25, .4], n: 'n por grupo', k: 'Grupos', help: 'f = desviación típica de las medias de grupo / desviación típica dentro de los grupos (η² = f² / (1 + f²)).' },
    r: { es: 'r (correlación esperada)', pre: [.1, .3, .5], n: 'n', help: 'Correlación de Pearson que se espera encontrar.' },
    reg: { es: 'f² de Cohen', pre: [.02, .15, .35], n: 'N total', k: 'Predictores', help: 'f² = R² / (1 − R²). Por ejemplo, R² = .13 equivale a f² = .15.' },
    chi: { es: 'w de Cohen', pre: [.1, .3, .5], n: 'N total', k: 'Grados de libertad', help: 'w = √(χ²/N). gl = (filas − 1)·(columnas − 1) en una tabla de contingencia, o categorías − 1 en bondad de ajuste.' },
    p2: { es: 'h de Cohen', pre: [.2, .5, .8], n: 'n por grupo', help: 'h = 2·arcsen(√p₁) − 2·arcsen(√p₂). Por ejemplo, 50 % frente a 30 % da h ≈ .41.' },
  };
  const pwUI = () => { const t = $('#pwTest').value, c = PW[t], mode = $('#pwMode').value;
    $('#pwEsLab').innerHTML = c.es; $('#pwNLab').textContent = c.n; $('#pwHelp').innerHTML = c.help;
    $('#pwPresets').innerHTML = c.pre.map((v, i) => `<button class="btn btn-line btn-sm" data-pv="${v}">${['pequeño', 'mediano', 'grande'][i]} (${v})</button>`).join('');
    $$('#pwPresets [data-pv]').forEach(b => b.onclick = () => { $('#pwEs').value = b.dataset.pv; });
    $('#pwKW').classList.toggle('hidden', !c.k); if (c.k) $('#pwKLab').textContent = c.k;
    if (t === 'chi' && +$('#pwK').value < 1) $('#pwK').value = 1;
    $('#pwRatioW').classList.toggle('hidden', t !== 't-ind'); $('#pwAltW').classList.toggle('hidden', ['anova', 'reg', 'chi'].includes(t));
    $('#pwNW').classList.toggle('hidden', mode !== 'power'); $('#pwPowW').classList.toggle('hidden', mode === 'power'); };
  const showPow = on => { $('#sPow').classList.toggle('hidden', !on); $('#s1').classList.toggle('hidden', on); $('#stepper').classList.toggle('hidden', on); if (on) { pwUI(); window.scrollTo({ top: 0 }); } };
  $('#powOpen').onclick = () => { showPow(true); history.replaceState(null, '', '#potencia'); };
  $('#powClose').onclick = () => { showPow(false); history.replaceState(null, '', location.pathname); };
  ['pwTest', 'pwMode'].forEach(id => $('#' + id).onchange = pwUI);
  if (location.hash === '#potencia') showPow(true);
  window.addEventListener('hashchange', () => showPow(location.hash === '#potencia'));
  $('#pwRun').onclick = () => {
    const t = $('#pwTest').value, c = PW[t], num = id => parseFloat(String($('#' + id).value).replace(',', '.'));
    const es = num('pwEs'), alpha = num('pwAlpha'), target = num('pwPow'), k = Math.round(num('pwK')), ratio = num('pwRatio'), alt = ['anova', 'reg', 'chi'].includes(t) ? 'two' : $('#pwAlt').value, mode = $('#pwMode').value;
    const out = $('#pwOut'), err = m => { out.innerHTML = `<div class="err">${m}</div>`; };
    if (!(es > 0)) return err('El tamaño del efecto debe ser mayor que 0.');
    if (!(alpha > 0 && alpha < 1)) return err('α debe estar entre 0 y 1 (habitualmente .05).');
    if (mode === 'n' && !(target > 0 && target < 1)) return err('La potencia deseada debe estar entre 0 y 1 (habitualmente .80 o .90).');
    if (c.k && !(k >= 1)) return err(`Indica ${c.k.toLowerCase()} (un número entero).`);
    if (t === 'anova' && k < 2) return err('El ANOVA necesita al menos 2 grupos.');
    const [test, args] = t.startsWith('t-') ? ['t', { d: es, type: { 't-ind': 'ind', 't-paired': 'paired', 't-one': 'one' }[t], ratio: t === 't-ind' ? ratio || 1 : 1 }]
      : t === 'anova' ? ['anova', { f: es, k }] : t === 'r' ? ['r', { r: es }] : t === 'reg' ? ['reg', { f2: es, u: k }] : t === 'chi' ? ['chi', { w: es, df: k }] : ['p2', { h: es }];
    if (t === 'r' && es >= 1) return err('La correlación debe ser menor que 1.');
    Object.assign(args, { alpha, alt });
    const minN = t === 'reg' ? k + 2 : t === 'r' ? 4 : 2;
    let n = mode === 'n' ? S.sampleSize(test, args, target, minN) : Math.round(num('pwN'));
    if (!n || !(n >= minN)) return err(mode === 'n' ? 'No se alcanza esa potencia con un tamaño razonable: revisa el tamaño del efecto.' : `El tamaño debe ser al menos ${minN}.`);
    const pw = S.power(test, Object.assign({}, args, { n }));
    const perGroup = ['t-ind', 'anova', 'p2'].includes(t), n2 = t === 't-ind' ? Math.max(2, Math.round(n * (ratio || 1))) : n, total = t === 't-ind' ? n + n2 : t === 'anova' ? n * k : t === 'p2' ? 2 * n : n;
    const nTxt = t === 't-ind' ? (n2 === n ? `${n} participantes por grupo (${total} en total)` : `${n} y ${n2} participantes en cada grupo (${total} en total)`) : perGroup ? `${n} participantes por grupo (${total} en total)` : `${n} participantes`;
    const testName = { 't-ind': 'una prueba t para muestras independientes', 't-paired': 'una prueba t para muestras relacionadas', 't-one': 'una prueba t para una muestra', anova: `un ANOVA de un factor con ${k} grupos`, r: 'una correlación de Pearson', reg: `una regresión lineal múltiple con ${k} predictor${k > 1 ? 'es' : ''}`, chi: `una prueba χ² con ${k} grado${k > 1 ? 's' : ''} de libertad`, p2: 'una comparación de dos proporciones' }[t];
    const esTxt = `${c.es.replace(/ de Cohen| \(correlación esperada\)/, '')} = ${t === 'r' ? nz(f(es)) : f(es)}`, sided = alt === 'two' ? '' : ' (unilateral)', A_ = nz(f(alpha)), P_ = nz(f(target)), PW_ = nz(f(pw, 3));
    const sentence = mode === 'n'
      ? `Se realizó un análisis de potencia a priori para ${testName}${sided}. Para detectar un efecto de ${esTxt} con un nivel de significación de α = ${A_} y una potencia de ${P_}, se necesitan ${nTxt}; con ese tamaño, la potencia alcanzada es de ${PW_}.`
      : `Se realizó un análisis de potencia para ${testName}${sided}. Con ${nTxt}, un nivel de significación de α = ${A_} y un efecto de ${esTxt}, la potencia es de ${PW_}${pw < .8 ? ', inferior al .80 recomendado habitualmente' : ''}.`;
    // curva de potencia en función del tamaño
    const nMax = Math.max(n * 2, minN + 10), pts = []; for (let q = 0; q <= 40; q++) { const nn = Math.max(minN, Math.round(minN + (nMax - minN) * q / 40)); pts.push([nn, S.power(test, Object.assign({}, args, { n: nn }))]); }
    const W = 560, H = 230, X0 = 46, Y0 = 16, Wp = W - X0 - 14, Hp = H - Y0 - 34, sx = v => X0 + (v - minN) / (nMax - minN) * Wp, sy = v => Y0 + (1 - v) * Hp;
    const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px" role="img" aria-label="Curva de potencia">` +
      [0, .2, .4, .6, .8, 1].map(v => `<line x1="${X0}" x2="${X0 + Wp}" y1="${sy(v)}" y2="${sy(v)}" stroke="#e3e0d7"/><text x="${X0 - 6}" y="${sy(v) + 4}" text-anchor="end" font-size="11" fill="#5a6b7a">${v.toFixed(1)}</text>`).join('') +
      `<line x1="${X0}" x2="${X0 + Wp}" y1="${sy(target || .8)}" y2="${sy(target || .8)}" stroke="#2bb3a6" stroke-dasharray="4 3"/>` +
      `<polyline fill="none" stroke="#0b2540" stroke-width="2.2" points="${pts.map(([a, b]) => `${sx(a).toFixed(1)},${sy(b).toFixed(1)}`).join(' ')}"/>` +
      `<circle cx="${sx(n)}" cy="${sy(pw)}" r="5" fill="#2bb3a6"/>` +
      [minN, Math.round((minN + nMax) / 2), nMax].map(v => `<text x="${sx(v)}" y="${H - 14}" text-anchor="middle" font-size="11" fill="#5a6b7a">${v}</text>`).join('') +
      `<text x="${X0 + Wp / 2}" y="${H - 1}" text-anchor="middle" font-size="11" fill="#5a6b7a">${esc(c.n)}</text></svg>`;
    const rAlt = alt === 'two' ? '' : ', alternative = "greater"', rn_ = mode === 'n' ? '' : `n = ${n}, `, rp = mode === 'n' ? `, power = ${target}` : '';
    const code = { 't-ind': (ratio || 1) !== 1 ? `pwr::pwr.t2n.test(n1 = ${n}, n2 = ${n2}, d = ${es}, sig.level = ${alpha}${rAlt})` : `pwr::pwr.t.test(${rn_}d = ${es}, sig.level = ${alpha}${rp}, type = "two.sample"${rAlt})`,
      't-paired': `pwr::pwr.t.test(${rn_}d = ${es}, sig.level = ${alpha}${rp}, type = "paired"${rAlt})`, 't-one': `pwr::pwr.t.test(${rn_}d = ${es}, sig.level = ${alpha}${rp}, type = "one.sample"${rAlt})`,
      anova: `pwr::pwr.anova.test(k = ${k}, ${rn_}f = ${es}, sig.level = ${alpha}${rp})`, r: `pwr::pwr.r.test(${rn_}r = ${es}, sig.level = ${alpha}${rp}${rAlt})`,
      reg: `pwr::pwr.f2.test(u = ${k}, ${mode === 'n' ? '' : `v = ${n - k - 1}, `}f2 = ${es}, sig.level = ${alpha}${rp})  # N = u + v + 1`, chi: `pwr::pwr.chisq.test(w = ${es}, ${mode === 'n' ? '' : `N = ${n}, `}df = ${k}, sig.level = ${alpha}${rp})`,
      p2: `pwr::pwr.2p.test(h = ${es}, ${rn_}sig.level = ${alpha}${rp}${rAlt})` }[t];
    out.innerHTML = `<div class="res"><h2>${mode === 'n' ? 'Tamaño muestral necesario' : 'Potencia del estudio'}</h2>
      <p style="font-size:1.25rem;margin:8px 0">${mode === 'n' ? `<b>${nTxt.charAt(0).toUpperCase() + nTxt.slice(1)}</b>` : `<b>Potencia = ${PW_}</b>`}</p>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"><b>Redacción para el apartado de método</b><button class="btn btn-line btn-sm" id="pwCopy">Copiar texto</button></div>
      <div class="text" id="pwTxt"><p>${sentence}</p></div>
      <figure><figcaption><span>Potencia según el tamaño muestral (línea discontinua: potencia ${fmtNum(target || .8)})</span></figcaption>${svg}</figure>
      <p class="small muted">Prevé además las pérdidas: si esperas, por ejemplo, un 15 % de abandonos o cuestionarios incompletos, divide el tamaño entre 0.85. El tamaño del efecto debe justificarse con estudios previos o con el mínimo efecto de interés práctico, no elegirse para que salga un número cómodo.</p>
      <details><summary>Código R para reproducirlo</summary><pre>${esc(code)}</pre></details></div>`;
    $('#pwCopy').onclick = () => navigator.clipboard.writeText($('#pwTxt').innerText).then(() => { $('#pwCopy').textContent = 'Copiado ✓'; setTimeout(() => { $('#pwCopy').textContent = 'Copiar texto'; }, 1500); });
    track('potencia', { prueba: t, modo: mode });
  };
  $('#tfType').onchange = tfForm;
  const drop = $('#drop'), file = $('#file');
  drop.onclick = () => file.click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
  file.onchange = () => { if (file.files[0]) loadFile(file.files[0]); file.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f0 = e.dataTransfer.files[0]; if (f0) loadFile(f0); });
  $('#demo').onclick = () => { ST.wb = null; ST.sheet = ''; setData('tharp_datos_ejemplo.csv', demoData(), DEMO_DEFAULTS); };
  $('#dlDemo').onclick = e => { e.preventDefault();
    const csv = demoData().map(r => r.map(v => (v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v)).join(';')).join('\r\n');
    download('tharp_datos_ejemplo.csv', new Blob(['﻿' + csv], { type: 'text/csv' })); };
  $('#run').onclick = run;
  $('#dlWord').onclick = exportDocx;
  $('#dlR').onclick = exportR;
  window.TharpState = ST; // solo lectura: lo usan las pruebas automáticas
  show(1);
})();
