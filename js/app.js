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
  const lbl = { d: v => { v = Math.abs(v); return v < .2 ? 'trivial' : v < .5 ? 'pequeño' : v < .8 ? 'mediano' : 'grande'; },
    eta: v => (v < .01 ? 'trivial' : v < .06 ? 'pequeño' : v < .14 ? 'mediano' : 'grande'),
    r: v => { v = Math.abs(v); return v < .1 ? 'trivial' : v < .3 ? 'pequeño' : v < .5 ? 'mediano' : 'grande'; },
    corr: v => { v = Math.abs(v); return v < .1 ? 'muy débil' : v < .3 ? 'débil' : v < .5 ? 'moderada' : 'fuerte'; } };
  const rn = n => (/^[A-Za-z.][A-Za-z0-9._]*$/.test(n) ? n : '`' + n.replace(/`/g, '\\`') + '`');
  const rq = n => JSON.stringify(n);
  const cmp = (a, b) => { const na = Number(a), nb = Number(b); return (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }); };
  const list = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]);

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
    Object.assign(ST, { fileName, headers, rows, defaults: defaults || null });
    ST.vars = headers.map((name, i) => detect(name, i, rows.map(r => r[i]), hints && hints[String(aoa[0][i])])).filter(v => !(v.valid === 0 && /^var_\d+$/.test(v.name)));
    renderVars(); show(2);
  }

  // ---------- detección de variables ----------
  function detect(name, i, raw, hint) {
    const valid = raw.filter(v => v !== null), v = { name, i, raw, valid: valid.length, missing: raw.length - valid.length, note: [] };
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
    v.labelled = !!(hint && hint.labels); v.auto = v.type; return v;
  }
  const numOf = v => v._num || (v._num = v.raw.map(toNum));
  const catOf = v => v.raw.map(x => (x === null ? null : String(x)));
  const levelsOf = v => [...new Set(catOf(v).filter(x => x !== null))].sort(cmp);
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
      else if (v.type === 'cat') { const lv = levelsOf(v), c = catOf(v); sum = `${lv.length} categorías: ` + lv.slice(0, 4).map(l => `${esc(l)} (${c.filter(x => x === l).length})`).join(', ') + (lv.length > 4 ? '…' : ''); }
      h += `<tr><td><b>${esc(v.name)}</b></td><td><select data-v="${idx}"><option value="num"${v.type === 'num' ? ' selected' : ''}>Cuantitativa</option><option value="cat"${v.type === 'cat' ? ' selected' : ''}>Categórica</option><option value="ign"${v.type === 'ign' ? ' selected' : ''}>Ignorar</option></select></td>
        <td>${v.valid}</td><td>${v.missing ? `<span class="pill warn">${v.missing}</span>` : '0'}</td><td class="small">${sum}</td><td>${v.note.map(t => `<span class="pill">${esc(t)}</span>`).join('')}${v.type !== v.auto ? '<span class="pill">Cambiado por ti</span>' : ''}</td></tr>`;
    });
    $('#varTable').innerHTML = h + '</tbody>';
    $$('#varTable select').forEach(s => s.onchange = () => { ST.vars[+s.dataset.v].type = s.value; renderVars(); });
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
      `<div class="field"><span>Variables</span>${chips('desc', nums.concat(cats), () => true)}</div>`);
    h += card('corr', nums.length >= 2, 'Correlaciones', 'Matriz de correlaciones con significación. Tharp elige Pearson o Spearman según la distribución.',
      `<div class="field"><span>Variables cuantitativas</span>${chips('corr', nums, v => (D.corr ? D.corr.includes(v.name) : nums.indexOf(v) < 8))}</div>
       <label class="field"><span>Método</span><select id="corrM"><option value="auto">Automático (recomendado)</option><option value="pearson">Pearson</option><option value="spearman">Spearman</option></select></label>`,
      nums.length < 2 ? 'Necesitas al menos dos variables cuantitativas.' : '');
    const dComp = D.comp || {};
    h += card('comp', nums.length >= 1 && facs.length >= 1, 'Comparación entre grupos', 'Prueba t, ANOVA o sus alternativas no paramétricas, con comprobación automática de supuestos y post hoc.',
      `<div class="field"><span>Variables dependientes (cuantitativas)</span>${chips('compY', nums, v => (dComp.y ? dComp.y.includes(v.name) : v === nums[0]))}</div>
       <label class="field"><span>Variable de agrupación</span>${sel('compG', facs, pick(dComp.g, facs[0] && facs[0].name))}</label>`,
      !(nums.length >= 1 && facs.length >= 1) ? 'Necesitas una variable cuantitativa y una categórica con 2 a 12 grupos.' : '');
    const dP = D.paired || {};
    h += card('paired', !!D.paired && nums.length >= 2, 'Comparación de medidas relacionadas (pre/post)', 'Las mismas personas medidas dos veces: prueba t relacionada o Wilcoxon.',
      `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Medida 1 (p. ej., pre)</span>${sel('pA', nums, pick(dP.a, nums[0] && nums[0].name))}</label>
       <label class="field"><span>Medida 2 (p. ej., post)</span>${sel('pB', nums, pick(dP.b, nums[1] && nums[1].name))}</label></div>`,
      nums.length < 2 ? 'Necesitas dos variables cuantitativas.' : '');
    const dC = D.chi || {};
    h += card('chi', facs.length >= 2, 'Asociación entre variables categóricas', 'Tabla de contingencia, chi-cuadrado (o Fisher) y V de Cramér.',
      `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable en filas</span>${sel('cA', facs, pick(dC.a, facs[0] && facs[0].name))}</label>
       <label class="field"><span>Variable en columnas</span>${sel('cB', facs, pick(dC.b, facs[1] && facs[1].name))}</label></div>`,
      facs.length < 2 ? 'Necesitas dos variables categóricas.' : '');
    const dR = D.reg || {}, regY = pick(dR.y, nums[0] && nums[0].name);
    h += card('reg', !!D.reg && nums.length >= 1, 'Regresión lineal', 'Coeficientes, β estandarizados, R², y diagnóstico completo: normalidad, homocedasticidad, multicolinealidad e influencia.',
      `<label class="field"><span>Variable dependiente</span>${sel('rY', nums, regY)}</label>
       <div class="field"><span>Predictores</span>${chips('rX', nums.concat(facs), v => (dR.x ? dR.x.includes(v.name) : false))}</div>`,
      nums.length < 1 ? 'Necesitas una variable cuantitativa como dependiente.' : '');
    const bins = cats.filter(v => levelsOf(v).length === 2), dL = D.logit || {};
    h += card('logit', !!D.logit && bins.length >= 1, 'Regresión logística binaria', 'Para variables dependientes dicotómicas (sí/no): odds ratios, R² de Nagelkerke, Hosmer-Lemeshow y tabla de clasificación.',
      `<label class="field"><span>Variable dependiente (2 categorías)</span>${sel('lY', bins, pick(dL.y, bins[0] && bins[0].name))}</label>
       <div class="field"><span>Predictores</span>${chips('lX', nums.concat(facs), v => (dL.x ? dL.x.includes(v.name) : false))}</div>`,
      !bins.length ? 'Necesitas una variable categórica con exactamente 2 categorías.' : '');
    const f6 = facs.filter(v => levelsOf(v).length <= 6), dF = D.fact || {};
    h += card('fact', !!D.fact && nums.length >= 1 && f6.length >= 2, 'ANOVA factorial (dos factores)', 'Efectos principales e interacción con sumas de cuadrados de tipo III, η² parcial y gráfico de interacción.',
      `<label class="field"><span>Variable dependiente</span>${sel('fY', nums, pick(dF.y, nums[0] && nums[0].name))}</label>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor 1</span>${sel('fA', f6, pick(dF.a, f6[0] && f6[0].name))}</label>
       <label class="field"><span>Factor 2</span>${sel('fB', f6, pick(dF.b, f6[1] && f6[1].name))}</label></div>`,
      !(nums.length >= 1 && f6.length >= 2) ? 'Necesitas una variable cuantitativa y dos categóricas de 2 a 6 niveles.' : '');
    const dA = D.alpha || {};
    h += card('alpha', !!D.alpha && nums.length >= 2, 'Fiabilidad de una escala (alfa de Cronbach)', 'Consistencia interna de un cuestionario: alfa, correlación ítem-total y alfa si se elimina cada ítem.',
      `<div class="field"><span>Ítems de la escala</span>${chips('aI', nums, v => (dA.items ? dA.items.includes(v.name) : false))}</div>
       <div class="field"><span>Ítems inversos (se recodifican)</span>${chips('aR', nums, v => (dA.rev ? dA.rev.includes(v.name) : false))}</div>`,
      nums.length < 2 ? 'Necesitas al menos dos ítems cuantitativos.' : '');
    $('#anList').innerHTML = h;
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
  function runDescriptives(names) {
    const vars = names.map(vByName).filter(Boolean), nums = vars.filter(v => v.type === 'num'), cats = vars.filter(v => v.type === 'cat');
    const sec = { title: 'Estadísticos descriptivos', test: 'Descriptivos', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    sec.decision = `Se describen ${vars.length} variables. Para las cuantitativas se informa media y desviación típica junto a mediana y asimetría; para las categóricas, frecuencias y porcentajes.`;
    sec.why.push('El análisis descriptivo resume la muestra antes de cualquier contraste de hipótesis y es obligatorio en el apartado de resultados.');
    sec.why.push('Se informa la mediana además de la media porque, si la distribución es asimétrica, la mediana representa mejor el valor típico.');
    const textParts = [`La muestra estuvo compuesta por ${ST.rows.length} participantes.`];
    if (nums.length) {
      const rows = [], skewed = [];
      nums.forEach(v => {
        const x = numOf(v).filter(a => a !== null); if (x.length < 2) return; const d = S.describe(x);
        if (Math.abs(d.skew) > 1) skewed.push(v.name);
        rows.push([esc(v.name), d.n, ST.rows.length - d.n, f(d.mean), f(d.sd), f(d.median), +d.min.toFixed(3), +d.max.toFixed(3), f(d.skew), f(d.kurt)]);
        if (sec.charts.length < 12) sec.charts.push(fig(v.name, CH.histogram(x, v.name)));
      });
      sec.tables.push(apaTable('Estadísticos descriptivos de las variables cuantitativas', ['Variable', '<i>n</i>', 'Perdidos', '<i>M</i>', '<i>DT</i>', '<i>Mdn</i>', 'Mín.', 'Máx.', 'Asimetría', 'Curtosis'], rows,
        'Curtosis expresada como exceso respecto a la distribución normal (0 = normal).'));
      sec.checks.push(skewed.length ? chk('no', `Asimetría marcada (|asimetría| > 1) en ${list(skewed.map(esc))}: para estas variables conviene informar mediana y rango intercuartílico.`)
        : chk('ok', 'Ninguna variable cuantitativa presenta una asimetría marcada (|asimetría| ≤ 1).'));
      const nt = nums.slice(0, 6).map(v => { const x = numOf(v).filter(a => a !== null); if (x.length < 2) return ''; const d = S.describe(x); return `${esc(v.name)} (<i>M</i> = ${f(d.mean)}, <i>DT</i> = ${f(d.sd)}; rango ${+d.min.toFixed(2)}–${+d.max.toFixed(2)})`; }).filter(Boolean);
      if (nt.length) textParts.push(`En cuanto a las variables cuantitativas, se obtuvieron los siguientes valores: ${list(nt)}.`);
    }
    if (cats.length) {
      const rows = [];
      cats.forEach(v => {
        const c = catOf(v), lv = levelsOf(v), nv = c.filter(x => x !== null).length;
        rows.push([`<b>${esc(v.name)}</b>`, '', '', '']);
        lv.forEach(l => { const k = c.filter(x => x === l).length; rows.push(['&nbsp;&nbsp;&nbsp;' + esc(l), k, f(k / ST.rows.length * 100, 1), f(k / nv * 100, 1)]); });
        if (nv < ST.rows.length) rows.push(['&nbsp;&nbsp;&nbsp;<span class="muted">Perdidos</span>', ST.rows.length - nv, f((ST.rows.length - nv) / ST.rows.length * 100, 1), '']);
        if (sec.charts.length < 18 && lv.length <= 15) sec.charts.push(fig(v.name, CH.barsCat(lv, lv.map(l => c.filter(x => x === l).length), v.name)));
      });
      sec.tables.push(apaTable('Frecuencias de las variables categóricas', ['Variable / categoría', '<i>n</i>', '%', '% válido'], rows));
      cats.slice(0, 4).forEach(v => {
        const c = catOf(v), lv = levelsOf(v), nv = c.filter(x => x !== null).length;
        const parts = lv.slice(0, 5).map(l => { const k = c.filter(x => x === l).length; return `${esc(l)} el ${f(k / nv * 100, 1)} % (<i>n</i> = ${k})`; });
        textParts.push(`Respecto a ${esc(v.name)}, ${list(parts)}${lv.length > 5 ? ', entre otras categorías' : ''}.`);
      });
    }
    sec.text.push(textParts.join(' '));
    sec.code = `# Descriptivos\n${nums.length ? `psych::describe(datos[, c(${nums.map(v => rq(v.name)).join(', ')})])\n` : ''}` +
      cats.map(v => `table(datos$${rn(v.name)}, useNA = "ifany"); round(prop.table(table(datos$${rn(v.name)})) * 100, 1)`).join('\n');
    return sec;
  }

  function runCorrelations(names, method) {
    const vars = names.map(vByName).filter(v => v && v.type === 'num');
    const sec = { title: 'Correlaciones', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (vars.length < 2) { sec.error = 'Selecciona al menos dos variables cuantitativas.'; return sec; }
    const skewed = vars.filter(v => Math.abs(S.skewness(numOf(v).filter(a => a !== null))) > 1);
    let m = method;
    if (m === 'auto') m = skewed.length ? 'spearman' : 'pearson';
    const P = m === 'pearson', sym = P ? '<i>r</i>' : '<i>r</i><sub>s</sub>', name = P ? 'Pearson' : 'Spearman';
    sec.test = `Correlación de ${name}`;
    sec.decision = method === 'auto' ? (P ? 'Se usa Pearson porque ninguna variable presenta una asimetría marcada.' : `Se usa Spearman porque ${list(skewed.map(v => esc(v.name)))} ${skewed.length > 1 ? 'presentan' : 'presenta'} una asimetría marcada (|asimetría| > 1).`) : `Método elegido por ti: ${name}.`;
    sec.why.push('Todas las variables son cuantitativas y se quiere medir la fuerza y dirección de su relación.');
    sec.why.push(P ? 'Pearson mide relación lineal y es adecuada cuando las variables tienen distribuciones aproximadamente simétricas.' : 'Spearman trabaja con rangos: es robusta ante asimetría y valores atípicos y mide relaciones monótonas.');
    sec.why.push('Los valores perdidos se eliminan por parejas: cada correlación usa todos los casos disponibles para ese par.');
    const k = vars.length, R = [], pairs = []; let nmin = Infinity, nmax = 0;
    for (let i = 0; i < k; i++) { R[i] = []; for (let j = 0; j < i; j++) {
      const xi = numOf(vars[i]), xj = numOf(vars[j]), a = [], b = [];
      xi.forEach((v, t) => { if (v !== null && xj[t] !== null) { a.push(v); b.push(xj[t]); } });
      const c = a.length > 3 ? (P ? S.pearson(a, b) : S.spearman(a, b)) : null; R[i][j] = c;
      if (c) { nmin = Math.min(nmin, c.n); nmax = Math.max(nmax, c.n); pairs.push({ i, j, c, a, b }); }
    } }
    const cell = c => { if (!c || !isFinite(c.r)) return '—'; const al = Math.min(.55, Math.abs(c.r) * .6), bg = c.r >= 0 ? `rgba(42,120,214,${al})` : `rgba(227,73,72,${al})`;
      return `<span style="display:inline-block;min-width:52px;padding:2px 6px;border-radius:4px;background:${bg}" title="${P ? 'r' : 'rs'} = ${c.r.toFixed(3)}, p = ${c.p.toFixed(4)}, n = ${c.n}">${r2s(c.r)}${stars(c.p)}</span>`; };
    const rows = vars.map((v, i) => { const x = numOf(v).filter(a => a !== null), d = S.describe(x);
      return [`${i + 1}. ${esc(v.name)}`, f(d.mean), f(d.sd)].concat(vars.map((_, j) => (j < i ? cell(R[i][j]) : j === i ? '—' : ''))); });
    sec.tables.push(apaTable(`Medias, desviaciones típicas y correlaciones de ${name}`, ['Variable', '<i>M</i>', '<i>DT</i>'].concat(vars.map((_, j) => String(j + 1))), rows,
      `${sym} de ${name}. <i>n</i> = ${nmin === nmax ? nmin : nmin + '–' + nmax} (eliminación por parejas). * <i>p</i> < .05. ** <i>p</i> < .01. *** <i>p</i> < .001.`, 'corr'));
    sec.checks.push(skewed.length ? chk(P ? 'no' : 'ok', `Asimetría marcada en ${list(skewed.map(v => esc(v.name)))}${P ? ': considera usar Spearman.' : ': por eso se usa Spearman.'}`) : chk('ok', 'Ninguna variable presenta asimetría marcada.'));
    sec.checks.push(chk('info', 'Linealidad: revisa el diagrama de dispersión. Una correlación cercana a 0 no descarta relaciones no lineales (por ejemplo, en forma de U).'));
    if (pairs.length > 10) sec.checks.push(chk('no', `Se han calculado ${pairs.length} correlaciones: con tantas pruebas aumenta la probabilidad de falsos positivos. Considera una corrección (por ejemplo, Holm) o interpreta solo las hipótesis planteadas a priori.`));
    const sig = pairs.filter(p => p.c.p < .05).sort((a, b) => Math.abs(b.c.r) - Math.abs(a.c.r));
    let t = `Se calcularon las correlaciones de ${name} entre ${k} variables (${pairs.length} ${pairs.length === 1 ? 'par' : 'pares'}). `;
    if (!sig.length) t += 'Ninguna de las correlaciones fue estadísticamente significativa.';
    else {
      t += `${sig.length === 1 ? 'Una correlación fue' : sig.length + ' correlaciones fueron'} estadísticamente ${sig.length === 1 ? 'significativa' : 'significativas'}. `;
      t += sig.slice(0, 5).map(p => `${esc(vars[p.i].name)} y ${esc(vars[p.j].name)} mostraron una correlación ${p.c.r > 0 ? 'positiva' : 'negativa'} ${lbl.corr(p.c.r)}, ${sym}(${p.c.df}) = ${r2s(p.c.r)}, ${pt(p.c.p)}`).join('; ') + '.';
      if (sig.length > 5) t += ` Las demás correlaciones significativas se muestran en la Tabla ${tabNo}.`;
    }
    sec.text.push(t);
    if (pairs.length) { const top = pairs.slice().sort((a, b) => Math.abs(b.c.r) - Math.abs(a.c.r))[0];
      const reg = (() => { const mx = S.mean(top.b), my = S.mean(top.a); let sxy = 0, sxx = 0; top.b.forEach((v, i) => { sxy += (v - mx) * (top.a[i] - my); sxx += (v - mx) ** 2; }); const b = sxy / sxx; return [my - b * mx, b]; })();
      sec.charts.push(fig(`Relación más fuerte: ${vars[top.i].name} y ${vars[top.j].name}`, CH.scatter(top.b, top.a, vars[top.j].name, vars[top.i].name, { line: reg }))); }
    sec.code = `# Correlaciones de ${name}\npsych::corr.test(datos[, c(${vars.map(v => rq(v.name)).join(', ')})], method = "${m}", use = "pairwise", adjust = "none")`;
    return sec;
  }

  function runCompare(yName, gName) {
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
      if (normOK) {
        const r = S.tTestInd(A.x, B.x, eqVar), name = eqVar ? 'prueba t de Student para muestras independientes' : 'prueba t de Welch para muestras independientes';
        sec.test = eqVar ? 'Prueba t de Student' : 'Prueba t de Welch';
        sec.why.push(eqVar ? 'Las varianzas son homogéneas (Levene p ≥ .05): se usa la prueba t clásica.' : 'Las varianzas no son homogéneas (Levene p < .05): se usa la corrección de Welch, que no asume varianzas iguales.');
        sec.decision = `Se eligió la ${name} porque se comparan 2 grupos independientes en una variable cuantitativa, la normalidad es aceptable y las varianzas ${eqVar ? 'son homogéneas' : 'difieren (corrección de Welch)'}.`;
        sec.alt = 'U de Mann-Whitney si no se cumpliera la normalidad con muestras pequeñas.';
        sec.tables.push(apaTable(`Resultado de la ${name}`, ['', '<i>t</i>', '<i>gl</i>', '<i>p</i>', 'Diferencia de medias', 'IC 95 %', '<i>d</i> de Cohen'],
          [[`${esc(A.name)} − ${esc(B.name)}`, f(r.t), dfF(r.df), pv(r.p), f(r.diff), `[${f(r.ci[0])}, ${f(r.ci[1])}]`, f(r.d)]]));
        const mw = S.mannWhitney(A.x, B.x); sec.sens = `Análisis de sensibilidad: la U de Mann-Whitney da ${pt(mw.p)}, ${(mw.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión de la prueba t.`;
        const st = `<i>t</i>(${dfF(r.df)}) = ${f(r.t)}, ${pt(r.p)}, <i>d</i> = ${f(r.d)}, IC 95 % de la diferencia [${f(r.ci[0])}, ${f(r.ci[1])}]`;
        sec.text.push(`Se aplicó una ${name} para comparar ${esc(yName)} entre ${esc(A.name)} y ${esc(B.name)}. ` + (r.p < .05
          ? `${esc(A.name)} (${MD(A)}) obtuvo puntuaciones significativamente ${r.diff > 0 ? 'más altas' : 'más bajas'} que ${esc(B.name)} (${MD(B)}), ${st}. El tamaño del efecto fue ${lbl.d(r.d)}.`
          : `No se encontraron diferencias estadísticamente significativas entre ${esc(A.name)} (${MD(A)}) y ${esc(B.name)} (${MD(B)}), ${st}.`));
        code += `t.test(${Y} ~ ${G}, data = datos, var.equal = ${eqVar ? 'TRUE' : 'FALSE'})\neffectsize::cohens_d(${Y} ~ ${G}, data = datos)`;
      } else {
        const r = S.mannWhitney(A.x, B.x); sec.test = 'U de Mann-Whitney';
        sec.decision = 'Se eligió la U de Mann-Whitney porque se comparan 2 grupos independientes y la normalidad no se cumple en algún grupo con muestra pequeña.';
        sec.alt = 'Prueba t para muestras independientes si los datos fueran aproximadamente normales.';
        sec.tables.push(apaTable('Resultado de la prueba U de Mann-Whitney', ['', '<i>U</i>', '<i>z</i>', '<i>p</i>', '<i>r</i>'], [[`${esc(A.name)} vs. ${esc(B.name)}`, f(r.U, 1), f(r.z), pv(r.p), nz(r.r.toFixed(2))]],
          '<i>r</i> = |<i>z</i>| / √<i>N</i>. Se aplicó la aproximación normal con corrección por continuidad y por empates.'));
        const w = S.tTestInd(A.x, B.x, false); sec.sens = `Análisis de sensibilidad: la prueba t de Welch da ${pt(w.p)}, ${(w.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
        const st = `<i>U</i> = ${f(r.U, 1)}, <i>z</i> = ${f(r.z)}, ${pt(r.p)}, <i>r</i> = ${nz(r.r.toFixed(2))}`;
        sec.text.push(`Dado que no se cumplía el supuesto de normalidad, se aplicó la prueba U de Mann-Whitney. ` + (r.p < .05
          ? `${esc(A.name)} (${MdnD(A)}) obtuvo puntuaciones significativamente ${A.d.median >= B.d.median ? 'más altas' : 'más bajas'} en ${esc(yName)} que ${esc(B.name)} (${MdnD(B)}), ${st}, con un tamaño del efecto ${lbl.r(r.r)}.`
          : `No se encontraron diferencias estadísticamente significativas en ${esc(yName)} entre ${esc(A.name)} (${MdnD(A)}) y ${esc(B.name)} (${MdnD(B)}), ${st}.`));
        code += `wilcox.test(${Y} ~ ${G}, data = datos, exact = FALSE, correct = TRUE)`;
      }
    } else {
      const names = groups.map(q => q.name), posthocText = (ph, kind, useMedian) => {
        const sig = ph.filter(c => c.padj < .05);
        if (!sig.length) return ` Las comparaciones post hoc (${kind}) no detectaron diferencias significativas entre pares concretos.`;
        return ` Las comparaciones post hoc (${kind}) mostraron diferencias significativas entre ` + list(sig.map(c => { const a = groups[c.i], b = groups[c.j], hi = (useMedian ? a.d.median >= b.d.median : a.d.mean >= b.d.mean) ? [a, b] : [b, a];
          return `${esc(hi[0].name)} y ${esc(hi[1].name)} (${pt(c.padj)}; puntuaciones más altas en ${esc(hi[0].name)})`; })) + (sig.length < ph.length ? '. El resto de comparaciones no fueron significativas.' : '.');
      };
      if (normOK) {
        const cl = S.anova(xs);
        let om, ph, phName;
        if (eqVar) { om = cl; sec.test = 'ANOVA de un factor'; phName = 'Tukey HSD'; ph = S.hasTukey ? S.tukeyHSD(xs, cl.msw, cl.df2) : S.pairwiseHolm(xs, true); if (!S.hasTukey) phName = 't por pares con corrección de Holm'; }
        else { om = S.welchAnova(xs); sec.test = 'ANOVA de Welch'; phName = 'Games-Howell'; ph = S.hasTukey ? S.gamesHowell(xs) : S.pairwiseHolm(xs, false); if (!S.hasTukey) phName = 't de Welch por pares con corrección de Holm'; }
        sec.why.push(eqVar ? 'Las varianzas son homogéneas: ANOVA clásico con post hoc de Tukey.' : 'Las varianzas no son homogéneas: ANOVA de Welch con post hoc de Games-Howell, que no asumen varianzas iguales.');
        sec.decision = `Se eligió el ${sec.test} porque se comparan ${k} grupos independientes en una variable cuantitativa con normalidad aceptable${eqVar ? ' y varianzas homogéneas' : ' y varianzas distintas'}.`;
        sec.alt = 'Prueba de Kruskal-Wallis si no se cumpliera la normalidad con muestras pequeñas.';
        if (eqVar) sec.tables.push(apaTable('Resultado del ANOVA de un factor', ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²'],
          [[esc(gName), f(cl.ssb), cl.df1, f(cl.ssb / cl.df1), f(cl.F), pv(cl.p), nz(cl.eta2.toFixed(3))], ['Error', f(cl.ssw), cl.df2, f(cl.msw), '', '', ''], ['Total', f(cl.ssb + cl.ssw), cl.df1 + cl.df2, '', '', '', '']]));
        else sec.tables.push(apaTable('Resultado del ANOVA de Welch', ['', '<i>F</i>', '<i>gl</i><sub>1</sub>', '<i>gl</i><sub>2</sub>', '<i>p</i>', 'η²'], [[esc(gName), f(om.F), om.df1, f(om.df2), pv(om.p), nz(cl.eta2.toFixed(3))]], 'η² calculado a partir del ANOVA clásico, como medida descriptiva del tamaño del efecto.'));
        const kw = S.kruskal(xs); sec.sens = `Análisis de sensibilidad: la prueba de Kruskal-Wallis da ${pt(kw.p)}, ${(kw.p < .05) === (om.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
        const st = `<i>F</i>(${om.df1}, ${dfF(om.df2)}) = ${f(om.F)}, ${pt(om.p)}, η² = ${nz(cl.eta2.toFixed(3))}`;
        let t = `Se aplicó un ${sec.test} para comparar ${esc(yName)} entre los grupos de ${esc(gName)} (${groups.map(q => `${esc(q.name)}: ${MD(q)}`).join('; ')}). `;
        if (om.p < .05) {
          t += `Se encontraron diferencias estadísticamente significativas, ${st}, con un tamaño del efecto ${lbl.eta(cl.eta2)}.` + posthocText(ph, phName, false);
          sec.tables.push(apaTable(`Comparaciones post hoc (${phName})`, ['Comparación', 'Diferencia de medias', '<i>p</i> ajustada'], ph.map(c => [`${esc(names[c.i])} − ${esc(names[c.j])}`, f(c.diff), pv(c.padj)])));
        } else t += `No se encontraron diferencias estadísticamente significativas, ${st}.`;
        sec.text.push(t);
        code += eqVar ? `modelo <- aov(${Y} ~ ${G}, data = datos)\nsummary(modelo)\neffectsize::eta_squared(modelo)\nTukeyHSD(modelo)`
          : `oneway.test(${Y} ~ ${G}, data = datos, var.equal = FALSE)\nrstatix::games_howell_test(datos, ${Y} ~ ${G})`;
      } else {
        const kw = S.kruskal(xs), ph = S.dunn(xs, kw); sec.test = 'Prueba de Kruskal-Wallis';
        sec.decision = `Se eligió la prueba de Kruskal-Wallis porque se comparan ${k} grupos independientes y la normalidad no se cumple en algún grupo con muestra pequeña.`;
        sec.alt = 'ANOVA de un factor si los datos fueran aproximadamente normales.';
        sec.tables.push(apaTable('Resultado de la prueba de Kruskal-Wallis', ['', '<i>H</i>', '<i>gl</i>', '<i>p</i>', 'ε²'], [[esc(gName), f(kw.H), kw.df, pv(kw.p), nz(kw.eps2.toFixed(3))]]));
        const w = S.welchAnova(xs); sec.sens = `Análisis de sensibilidad: el ANOVA de Welch da ${pt(w.p)}, ${(w.p < .05) === (kw.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
        const st = `<i>H</i>(${kw.df}) = ${f(kw.H)}, ${pt(kw.p)}, ε² = ${nz(kw.eps2.toFixed(3))}`;
        let t = `Dado que no se cumplía el supuesto de normalidad, se aplicó la prueba de Kruskal-Wallis para comparar ${esc(yName)} entre los grupos de ${esc(gName)} (${groups.map(q => `${esc(q.name)}: ${MdnD(q)}`).join('; ')}). `;
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

  function runPaired(aName, bName) {
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
    if (normOK) {
      const r = S.tTestPaired(a, b); sec.test = 'Prueba t para muestras relacionadas';
      sec.why.push('Las diferencias son aproximadamente normales (o n ≥ 30): se usa la prueba t para muestras relacionadas.');
      sec.decision = 'Se eligió la prueba t para muestras relacionadas porque son dos medidas de las mismas personas y la normalidad de las diferencias es aceptable.';
      sec.alt = 'Prueba de rangos con signo de Wilcoxon si las diferencias no fueran normales.';
      sec.tables.push(apaTable('Resultado de la prueba t para muestras relacionadas', ['', '<i>t</i>', '<i>gl</i>', '<i>p</i>', 'Diferencia de medias', 'IC 95 %', '<i>d</i><sub>z</sub>'],
        [[`${esc(bName)} − ${esc(aName)}`, f(r.t), r.df, pv(r.p), f(r.diff), `[${f(r.ci[0])}, ${f(r.ci[1])}]`, f(r.dz)]], '<i>d</i><sub>z</sub> = media de las diferencias / desviación típica de las diferencias.'));
      const w = S.wilcoxonSigned(a, b); sec.sens = `Análisis de sensibilidad: la prueba de Wilcoxon da ${pt(w.p)}, ${(w.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
      const st = `<i>t</i>(${r.df}) = ${f(r.t)}, ${pt(r.p)}, <i>d</i><sub>z</sub> = ${f(r.dz)}, IC 95 % de la diferencia [${f(r.ci[0])}, ${f(r.ci[1])}]`;
      sec.text.push(`Se aplicó una prueba t para muestras relacionadas para comparar ${esc(aName)} (<i>M</i> = ${f(da.mean)}, <i>DT</i> = ${f(da.sd)}) y ${esc(bName)} (<i>M</i> = ${f(db.mean)}, <i>DT</i> = ${f(db.sd)}). ` +
        (r.p < .05 ? `Las puntuaciones ${r.diff > 0 ? 'aumentaron' : 'disminuyeron'} de forma estadísticamente significativa, ${st}, con un tamaño del efecto ${lbl.d(r.dz)}.` : `No se encontraron diferencias estadísticamente significativas, ${st}.`));
      sec.code = `# ${aName} frente a ${bName}\nshapiro.test(datos$${B} - datos$${A})\nt.test(datos$${B}, datos$${A}, paired = TRUE)`;
    } else {
      const r = S.wilcoxonSigned(a, b); sec.test = 'Prueba de rangos con signo de Wilcoxon';
      sec.why.push('Las diferencias no son normales y la muestra es pequeña: se usa la prueba de Wilcoxon, que no requiere normalidad.');
      sec.decision = 'Se eligió la prueba de Wilcoxon porque son dos medidas de las mismas personas y las diferencias no siguen una distribución normal.';
      sec.alt = 'Prueba t para muestras relacionadas si las diferencias fueran normales.';
      sec.tables.push(apaTable('Resultado de la prueba de rangos con signo de Wilcoxon', ['', '<i>V</i>', '<i>z</i>', '<i>p</i>', '<i>r</i>'], [[`${esc(bName)} − ${esc(aName)}`, f(r.V, 1), f(r.z), pv(r.p), nz(r.r.toFixed(2))]],
        `<i>V</i> = suma de rangos de las diferencias positivas. Se excluyeron ${n - r.n} diferencias nulas. Aproximación normal con corrección por continuidad.`));
      const t = S.tTestPaired(a, b); sec.sens = `Análisis de sensibilidad: la prueba t relacionada da ${pt(t.p)}, ${(t.p < .05) === (r.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
      const st = `<i>z</i> = ${f(r.z)}, ${pt(r.p)}, <i>r</i> = ${nz(r.r.toFixed(2))}`;
      sec.text.push(`Dado que las diferencias no seguían una distribución normal, se aplicó la prueba de rangos con signo de Wilcoxon para comparar ${esc(aName)} (<i>Mdn</i> = ${f(da.median)}) y ${esc(bName)} (<i>Mdn</i> = ${f(db.median)}). ` +
        (r.p < .05 ? `Se encontraron diferencias estadísticamente significativas, ${st}, con un tamaño del efecto ${lbl.r(r.r)}.` : `No se encontraron diferencias estadísticamente significativas, ${st}.`));
      sec.code = `# ${aName} frente a ${bName}\nshapiro.test(datos$${B} - datos$${A})\nwilcox.test(datos$${B}, datos$${A}, paired = TRUE, exact = FALSE, correct = TRUE)`;
    }
    return sec;
  }

  function runChi(aName, bName) {
    const sec = { title: `Asociación entre ${aName} y ${bName}`, why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (aName === bName) { sec.error = 'Elige dos variables distintas.'; return sec; }
    const ca = catOf(vByName(aName)), cb = catOf(vByName(bName)), keep = ca.map((v, i) => v !== null && cb[i] !== null);
    const la = [...new Set(ca.filter((v, i) => keep[i]))].sort(cmp), lb = [...new Set(cb.filter((v, i) => keep[i]))].sort(cmp);
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
    if (!is2x2 && (r.pctSmall > .2 || r.minE < 1)) sec.warn = 'Hay demasiadas casillas con frecuencias esperadas bajas: el resultado del chi-cuadrado puede no ser fiable. Considera agrupar categorías con pocos casos o consulta a un estadístico antes de continuar.';
    sec.alt = is2x2 ? 'Prueba exacta de Fisher cuando hay frecuencias esperadas bajas.' : 'Agrupar categorías poco frecuentes si las frecuencias esperadas son bajas.';
    const rows = la.map((l, i) => [esc(l)].concat(lb.map((_, j) => { const a = r.adj[i][j]; const mark = a > 1.96 ? ' ▲' : a < -1.96 ? ' ▼' : '';
      return `${tab[i][j]} (${f(tab[i][j] / r.rs[i] * 100, 1)} %)${mark}`; })).concat([String(r.rs[i])]));
    rows.push(['Total'].concat(lb.map((_, j) => `${r.cs[j]} (${f(r.cs[j] / r.N * 100, 1)} %)`)).concat([String(r.N)]));
    sec.tables.push(apaTable(`Tabla de contingencia de ${aName} y ${bName}`, [esc(aName)].concat(lb.map(esc)).concat(['Total']), rows,
      'Recuentos y porcentaje dentro de cada fila. ▲/▼: residuo tipificado corregido > 1.96 / < −1.96 (más / menos casos de los esperados).'));
    sec.tables.push(apaTable('Resultado de la prueba de independencia', ['', 'χ²', '<i>gl</i>', '<i>p</i>', '<i>V</i> de Cramér', '<i>N</i>'].concat(is2x2 ? ['<i>p</i> exacta de Fisher'] : []),
      [[`${esc(aName)} × ${esc(bName)}`, f(r.chi), r.df, pv(r.p), nz(r.V.toFixed(3)), r.N].concat(is2x2 ? [pv(fisher.p)] : [])], 'χ² de Pearson sin corrección de continuidad.'));
    const P = useFisher ? fisher.p : r.p;
    const st = useFisher ? `prueba exacta de Fisher, ${pt(fisher.p)}, <i>V</i> = ${nz(r.V.toFixed(2))}` : `χ²(${r.df}, <i>N</i> = ${r.N}) = ${f(r.chi)}, ${pt(r.p)}, <i>V</i> = ${nz(r.V.toFixed(2))}`;
    let t = P < .05 ? `Se encontró una asociación estadísticamente significativa entre ${esc(aName)} y ${esc(bName)}, ${st}.` : `No se encontró una asociación estadísticamente significativa entre ${esc(aName)} y ${esc(bName)}, ${st}.`;
    if (P < .05) { const hi = []; la.forEach((l, i) => lb.forEach((m, j) => { if (r.adj[i][j] > 1.96) hi.push(`${esc(m)} en el grupo ${esc(l)} (${f(tab[i][j] / r.rs[i] * 100, 1)} %)`); }));
      if (hi.length) t += ` En concreto, hubo más casos de los esperados de ${list(hi.slice(0, 4))}.`; }
    sec.text.push(t);
    if (lb.length <= 8) sec.charts.push(fig(`${bName} dentro de cada grupo de ${aName}`, CH.groupedBars(la, lb, tab.map((row, i) => row.map(c => c / r.rs[i] * 100))), CH.legend(lb)));
    sec.code = `# Asociación entre ${aName} y ${bName}\ntabla <- table(datos$${A}, datos$${B})\nprop.table(tabla, 1) * 100\nchisq.test(tabla, correct = FALSE)\nchisq.test(tabla, correct = FALSE)$expected\nchisq.test(tabla, correct = FALSE)$stdres\nrcompanion::cramerV(tabla)` + (is2x2 ? '\nfisher.test(tabla)' : '');
    return sec;
  }

  // matriz de diseño: constante + predictores numéricos + variables ficticias (primera categoría = referencia)
  function design(xNames, rowOk) {
    const pv_ = xNames.map(vByName);
    const idx = ST.rows.map((_, i) => i).filter(i => rowOk(i) && pv_.every(v => (v.type === 'num' ? numOf(v)[i] !== null : v.raw[i] !== null)));
    const cols = [{ name: '(Constante)' }];
    pv_.forEach(v => { if (v.type === 'num') cols.push({ name: v.name, v });
      else { const lv = [...new Set(idx.map(i => String(v.raw[i])))].sort(cmp); lv.slice(1).forEach(l => cols.push({ name: `${v.name}: ${l} (ref. ${lv[0]})`, v, level: l })); } });
    const X = idx.map(i => cols.map(c => (!c.v ? 1 : c.level === undefined ? numOf(c.v)[i] : (String(c.v.raw[i]) === c.level ? 1 : 0))));
    return { idx, cols, X };
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
    const r = S.cronbach(items), n = r.n, a = r.alpha;
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
    sec.checks.push(chk('info', 'El alfa asume que todos los ítems miden un único factor con cargas similares (tau-equivalencia). Si no es así, el omega de McDonald es más adecuado.'));
    sec.tables.push(apaTable('Fiabilidad de la escala', ['α de Cronbach', 'α estandarizado', '<i>r</i> media inter-ítem', 'Ítems', '<i>n</i>', '<i>M</i> (total)', '<i>DT</i> (total)'],
      [[nz(a.toFixed(3)), nz(r.alphaStd.toFixed(3)), r2s(r.rbar), r.k, n, f(r.totalMean), f(r.totalSd)]]));
    sec.tables.push(apaTable('Estadísticos de los ítems', ['Ítem', '<i>M</i>', '<i>DT</i>', 'Correlación ítem-total corregida', 'α si se elimina el ítem'],
      vars.map((v, j) => [esc(v.name) + (rev[j] ? ' (invertido)' : ''), f(r.stats[j].mean), f(r.stats[j].sd), r2s(r.stats[j].rit), isFinite(r.stats[j].alphaDel) ? nz(r.stats[j].alphaDel.toFixed(3)) : '—'])));
    let t = `La consistencia interna de la escala formada por ${vars.length} ítems fue ${qual}, α = ${nz(a.toFixed(2))} (<i>n</i> = ${n}).`;
    t += ` Las correlaciones ítem-total corregidas oscilaron entre ${r2s(Math.min(...r.stats.map(s => s.rit)))} y ${r2s(Math.max(...r.stats.map(s => s.rit)))}.`;
    if (rev.some(Boolean)) t += ` ${list(vars.filter((_, j) => rev[j]).map(v => esc(v.name)))} se ${rev.filter(Boolean).length > 1 ? 'recodificaron' : 'recodificó'} de forma inversa antes del análisis.`;
    sec.text.push(t);
    const keys = vars.filter((_, j) => rev[j]).map(v => rq(v.name));
    sec.code = `# Fiabilidad (alfa de Cronbach)\npsych::alpha(datos[, c(${vars.map(v => rq(v.name)).join(', ')})]${keys.length ? `, keys = c(${keys.join(', ')})` : ''})`;
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

  function runFactorial(yName, aName, bName) {
    const sec = { title: `${yName} según ${aName} × ${bName}`, test: 'ANOVA factorial (SC tipo III)', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (aName === bName) { sec.error = 'Elige dos factores distintos.'; return sec; }
    const yv = numOf(vByName(yName)), ca = catOf(vByName(aName)), cb = catOf(vByName(bName));
    const idx = ST.rows.map((_, i) => i).filter(i => yv[i] !== null && ca[i] !== null && cb[i] !== null);
    const la = [...new Set(idx.map(i => ca[i]))].sort(cmp), lb = [...new Set(idx.map(i => cb[i]))].sort(cmp);
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
    const st = k => `<i>F</i>(${r[k].df}, ${r.dfE}) = ${f(r[k].F)}, ${pt(r[k].p)}, η²<sub>p</sub> = ${nz(r[k].peta2.toFixed(3))}`;
    let t = `Se realizó un ANOVA factorial ${la.length}×${lb.length} para analizar el efecto de ${esc(aName)} y ${esc(bName)} sobre ${esc(yName)}. `;
    t += `El efecto principal de ${esc(aName)} ${r.A.p < .05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st('A')}. `;
    t += `El efecto principal de ${esc(bName)} ${r.B.p < .05 ? 'fue' : 'no fue'} estadísticamente significativo, ${st('B')}. `;
    t += `La interacción ${esc(aName)} × ${esc(bName)} ${r.AB.p < .05 ? 'fue' : 'no fue'} estadísticamente significativa, ${st('AB')}.`;
    if (r.AB.p < .05) { t += ` Esto indica que el efecto de ${esc(aName)} depende del nivel de ${esc(bName)} (véase la figura), por lo que los efectos principales deben interpretarse con cautela.`;
      sec.checks.push(chk('info', 'La interacción es significativa: analiza los efectos simples (el efecto de un factor dentro de cada nivel del otro). El código R incluye cómo hacerlo con emmeans.')); }
    sec.text.push(t);
    if (lb.length <= 8) sec.charts.push(fig(`Interacción ${aName} × ${bName}: medias e IC 95 %`, CH.interaction(la, lb.map((b, j) => ({ name: b, means: la.map((_, i) => S.mean(cells[i][j])), ci: la.map((_, i) => S.meanCI(cells[i][j])) })), yName), CH.legend(lb)));
    const Y = rn(yName), A = rn(aName), B = rn(bName);
    sec.code = `# ANOVA factorial: ${yName} ~ ${aName} × ${bName}\noptions(contrasts = c("contr.sum", "contr.poly"))\nmodelo <- aov(${Y} ~ ${A} * ${B}, data = datos)\ncar::Anova(modelo, type = 3)\neffectsize::eta_squared(car::Anova(modelo, type = 3), partial = TRUE)\ncar::leveneTest(${Y} ~ ${A} * ${B}, data = datos, center = mean)\nshapiro.test(residuals(modelo))\n# Efectos simples\nemmeans::emmeans(modelo, pairwise ~ ${A} | ${B}, adjust = "holm")`;
    return sec;
  }

  function runRegression(yName, xNames) {
    const sec = { title: `Regresión lineal: ${yName}`, test: '', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    xNames = xNames.filter(n => n !== yName);
    if (!xNames.length) { sec.error = 'Selecciona al menos un predictor distinto de la variable dependiente.'; return sec; }
    const yv = numOf(vByName(yName)), { idx, cols, X } = design(xNames, i => yv[i] !== null), n = idx.length, p = cols.length;
    if (n < p + 2) { sec.error = `Hay pocos casos completos (${n}) para ${p - 1} predictores.`; return sec; }
    const y = idx.map(i => yv[i]); if (S.sd(y) === 0) { sec.error = `${yName} tiene el mismo valor en todos los casos: no se puede ajustar una regresión.`; return sec; }
    const m = S.ols(X, y);
    if (!m) { sec.error = 'Hay colinealidad perfecta entre los predictores (por ejemplo, una variable es combinación exacta de otras). Elimina alguno.'; return sec; }
    const multi = cols.length > 2, het = m.bp.p < .05, sdY = S.sd(y);
    sec.test = `Regresión lineal ${multi ? 'múltiple' : 'simple'} (MCO)${het ? ' con errores robustos HC3' : ''}`;
    sec.why.push(`Variable dependiente: ${esc(yName)} → cuantitativa.`);
    sec.why.push(`${xNames.length} predictor${xNames.length > 1 ? 'es' : ''}: ${list(xNames.map(esc))}. Las variables categóricas se codifican como variables ficticias frente a una categoría de referencia.`);
    sec.why.push('La regresión estima cuánto cambia la variable dependiente por cada unidad de cada predictor, manteniendo constantes los demás.');
    sec.decision = `Se ajustó una regresión lineal ${multi ? 'múltiple' : 'simple'} con ${n} casos completos.` + (het ? ' Como no se cumple la homocedasticidad, los contrastes de los coeficientes usan errores típicos robustos (HC3).' : '');
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
    sec.tables.push(apaTable('Resumen del modelo de regresión', ['<i>R</i>²', '<i>R</i>² ajustado', '<i>F</i>', '<i>gl</i>', '<i>p</i>', '<i>n</i>'], [[nz(m.r2.toFixed(3)), nz(m.adjr2.toFixed(3)), f(m.F), `${m.df1}, ${m.dfr}`, pv(m.pF), n]]));
    const head = ['Predictor', '<i>B</i>', '<i>EE</i>', 'IC 95 % (<i>B</i>)', 'β', '<i>t</i>', '<i>p</i>'].concat(het ? ['<i>EE</i> (HC3)', '<i>p</i> (HC3)'] : []).concat(multi ? ['VIF'] : []);
    const beta = cols.map((c, j) => (j === 0 ? null : m.b[j] * S.sd(X.map(r => r[j])) / sdY));
    const rows = cols.map((c, j) => [esc(c.name), f(m.b[j], 3), f(m.se[j], 3), `[${f(m.ci[j][0], 3)}, ${f(m.ci[j][1], 3)}]`, j ? r2s(beta[j]) : '', f(m.t[j]), pv(m.pv[j])]
      .concat(het ? [f(m.se3[j], 3), pv(m.p3[j])] : []).concat(multi ? [j ? f(m.vif[j]) : ''] : []));
    sec.tables.push(apaTable(`Coeficientes del modelo de regresión para ${yName}`, head, rows, '<i>B</i> = coeficiente no estandarizado; β = coeficiente estandarizado.' + (het ? ' HC3 = errores típicos robustos a la heterocedasticidad.' : '')));
    const pUse = het ? m.p3 : m.pv, sigP = cols.map((c, j) => ({ c, j })).filter(o => o.j > 0 && pUse[o.j] < .05);
    let t = `Se realizó un análisis de regresión lineal ${multi ? 'múltiple' : 'simple'} para predecir ${esc(yName)} a partir de ${list(xNames.map(esc))}. El modelo ${m.pF < .05 ? '' : 'no '}fue estadísticamente significativo, <i>F</i>(${m.df1}, ${m.dfr}) = ${f(m.F)}, ${pt(m.pF)}, y explicó el ${f(m.r2 * 100, 1)} % de la varianza (<i>R</i>² ajustado = ${nz(m.adjr2.toFixed(2))}). `;
    if (m.pF < .05) {
      if (sigP.length) t += list(sigP.map(o => `${esc(o.c.name)} ${m.b[o.j] > 0 ? 'se asoció positivamente' : 'se asoció negativamente'} con ${esc(yName)} (<i>B</i> = ${f(m.b[o.j], 2)}, β = ${r2s(beta[o.j])}, ${pt(pUse[o.j])})`)) + '. ';
      const ns = cols.filter((c, j) => j > 0 && pUse[j] >= .05).map(c => esc(c.name));
      if (ns.length) t += `${list(ns)} no ${ns.length > 1 ? 'fueron predictores significativos' : 'fue un predictor significativo'}.`;
    }
    if (het) t += ' Los contrastes de los coeficientes se basan en errores típicos robustos (HC3).';
    sec.text.push(t);
    if (!multi && cols[1].level === undefined) sec.charts.push(fig(`${yName} según ${cols[1].name}`, CH.scatter(X.map(r => r[1]), y, cols[1].name, yName, { line: [m.b[0], m.b[1]] })));
    sec.charts.push(fig('Residuos frente a valores predichos', CH.scatter(m.fit, m.e, 'Valor predicho', 'Residuo', { zero: true })));
    const fml = `${rn(yName)} ~ ${xNames.map(rn).join(' + ')}`;
    sec.code = `# Regresión lineal: ${yName}\nmodelo <- lm(${fml}, data = datos)\nsummary(modelo)\nconfint(modelo)\nparameters::standardize_parameters(modelo, method = "basic")  # β como en SPSS\nshapiro.test(residuals(modelo))\nlmtest::bptest(modelo)\nlmtest::dwtest(modelo)\n` + (multi ? 'car::vif(modelo)\n' : '') + `sum(cooks.distance(modelo) > 4 / nobs(modelo))` + (het ? '\nlmtest::coeftest(modelo, vcov = sandwich::vcovHC(modelo, type = "HC3"))' : '');
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
    const nn = ST.vars.filter(v => v.type === 'num' && v.nonNum); if (nn.length) log.push(`Valores no numéricos tratados como perdidos en ${list(nn.map(v => `${esc(v.name)} (${v.nonNum})`))}.`);
    log.push('Valores perdidos: cada análisis usa los casos con datos completos en sus variables (las correlaciones, por parejas).');
    const add = s => { secs.push(s); if (s.decision) log.push(`<b>${esc(s.title)}:</b> ${s.decision}`); else if (s.error) log.push(`<b>${esc(s.title)}:</b> no se pudo realizar. ${esc(s.error)}`); };
    try {
      if (isOn('desc')) { const v = checkedVals('desc'); if (v.length) add(runDescriptives(v)); }
      if (isOn('corr')) add(runCorrelations(checkedVals('corr'), $('#corrM').value));
      if (isOn('comp')) { const g = $('#compG') && $('#compG').value; checkedVals('compY').forEach(y => add(runCompare(y, g))); }
      if (isOn('paired')) add(runPaired($('#pA').value, $('#pB').value));
      if (isOn('chi')) add(runChi($('#cA').value, $('#cB').value));
      if (isOn('reg')) add(runRegression($('#rY').value, checkedVals('rX')));
      if (isOn('logit')) add(runLogistic($('#lY').value, checkedVals('lX')));
      if (isOn('fact')) add(runFactorial($('#fY').value, $('#fA').value, $('#fB').value));
      if (isOn('alpha')) add(runAlpha(checkedVals('aI'), checkedVals('aR')));
    } catch (e) { console.error(e); alert('Ha ocurrido un error inesperado en el análisis: ' + e.message); return; }
    if (!secs.length) { alert('Selecciona al menos un análisis.'); return; }
    ST.sections = secs; ST.log = log; renderResults(); show(4);
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
    $$('[data-png]').forEach(b => b.onclick = () => { const [si, ci] = b.dataset.png.split('-').map(Number), c = ST.sections[si].charts[ci]; svgToPng(c.svg, c.title); });
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
      download('tharp_resultados.docx', await D.Packer.toBlob(doc));
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
    // niveles en el mismo orden que Tharp: así coinciden las categorías de referencia y el suceso de la logística
    const fac = v => { const x = `datos$${rn(v.name)}`, src = isSav ? (v.labelled ? `as.character(haven::as_factor(${x}))` : `haven::zap_labels(${x})`) : x;
      return `${x} <- factor(${src}, levels = c(${levelsOf(v).map(rq).join(', ')}))`; };
    if (cats.length) s += `\n# Variables categóricas como factor (mismo orden de categorías que en Tharp)\n${cats.map(fac).join('\n')}\n`;
    if (isSav) s += `datos <- as.data.frame(haven::zap_labels(datos))\n`;
    s += '\n' + ST.sections.filter(x => !x.error).map(x => x.code).join('\n\n') + '\n';
    download('tharp_analisis.R', new Blob([s], { type: 'text/plain' }));
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
    return rows;
  }
  const DEMO_DEFAULTS = { comp: { y: ['ansiedad_post'], g: 'grupo' }, paired: { a: 'ansiedad_pre', b: 'ansiedad_post' }, chi: { a: 'sexo', b: 'fuma' },
    reg: { y: 'rendimiento', x: ['horas_sueno', 'estres', 'ansiedad_post'] }, logit: { y: 'fuma', x: ['estres', 'sexo', 'edad'] },
    fact: { y: 'ansiedad_post', a: 'grupo', b: 'sexo' }, alpha: { items: ['ae1', 'ae2', 'ae3', 'ae4', 'ae5', 'ae6'], rev: ['ae4'] }, corr: ['edad', 'horas_sueno', 'ansiedad_pre', 'ansiedad_post', 'estres', 'autoestima', 'rendimiento', 'satisfaccion'] };

  // ---------- navegación ----------
  function show(n) {
    [1, 2, 3, 4].forEach(i => $('#s' + i).classList.toggle('hidden', i !== n));
    $$('#stepper div').forEach(d => { const s = +d.dataset.s; d.className = s === n ? 'on' : s < n ? 'done' : ''; });
    if (n === 3) renderConfig();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('[data-go]').forEach(b => b.onclick = () => show(+b.dataset.go));
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
