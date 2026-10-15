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
    Object.assign(ST, { fileName, headers, rows, defaults: defaults || null });
    ST.vars = headers.map((name, i) => detect(name, i, rows.map(r => r[i]), hints && hints[String(aoa[0][i])])).filter(v => !(v.valid === 0 && /^var_\d+$/.test(v.name)));
    renderVars(); show(2);
    track('datos_cargados', { formato: fileName === 'tharp_datos_ejemplo.csv' && defaults ? 'ejemplo' : (fileName.split('.').pop() || '').toLowerCase() });
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
    const pDef = (dP.vars || []).filter(has);
    h += card('paired', !!D.paired && nums.length >= 2, 'Comparación de medidas relacionadas (pre/post o varios momentos)', 'Las mismas personas medidas dos o más veces: t relacionada o Wilcoxon (2 momentos); ANOVA de medidas repetidas o Friedman (3 o más). Con un factor entre sujetos (por ejemplo, control frente a tratamiento): ANOVA mixta.',
      `<div class="field"><span>Momentos o condiciones (en el orden de las columnas del archivo)</span>${chips('pM', nums, v => (pDef.length ? pDef.includes(v.name) : nums.indexOf(v) < 2))}</div>
       <label class="field"><span>Factor entre sujetos (opcional: ANOVA mixta)</span><select id="pB"><option value="">Ninguno</option>${facs.map(v => `<option value="${esc(v.name)}"${dP.between === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>`,
      nums.length < 2 ? 'Necesitas dos variables cuantitativas.' : '');
    const dC = D.chi || {};
    h += card('chi', facs.length >= 2, 'Asociación entre variables categóricas', 'Tabla de contingencia, chi-cuadrado (o Fisher) y V de Cramér.',
      `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable en filas</span>${sel('cA', facs, pick(dC.a, facs[0] && facs[0].name))}</label>
       <label class="field"><span>Variable en columnas</span>${sel('cB', facs, pick(dC.b, facs[1] && facs[1].name))}</label></div>`,
      facs.length < 2 ? 'Necesitas dos variables categóricas.' : '');
    const dR = D.reg || {}, regY = pick(dR.y, nums[0] && nums[0].name);
    h += card('reg', !!D.reg && nums.length >= 1, 'Regresión lineal', 'Coeficientes, β estandarizados, R², y diagnóstico completo: normalidad, homocedasticidad, multicolinealidad e influencia.',
      `<label class="field"><span>Variable dependiente</span>${sel('rY', nums, regY)}</label>
       <div class="field"><span>Predictores</span>${chips('rX', nums.concat(facs), v => (dR.x ? dR.x.includes(v.name) : false))}</div>
       <label class="field"><span>Método de entrada de los predictores</span><select id="rM">${[['enter', 'Introducir: todos a la vez (recomendado)'], ['stepwise', 'Por pasos (entrada p < .05, salida p > .10)'], ['forward', 'Hacia delante (entrada p < .05)'], ['backward', 'Hacia atrás (salida p > .10)']].map(([k, l]) => `<option value="${k}"${(dR.method || 'enter') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`,
      nums.length < 1 ? 'Necesitas una variable cuantitativa como dependiente.' : '');
    const bins = cats.filter(v => levelsOf(v).length === 2), dL = D.logit || {};
    h += card('logit', !!D.logit && bins.length >= 1, 'Regresión logística binaria', 'Para variables dependientes dicotómicas (sí/no): odds ratios, R² de Nagelkerke, Hosmer-Lemeshow y tabla de clasificación.',
      `<label class="field"><span>Variable dependiente (2 categorías)</span>${sel('lY', bins, pick(dL.y, bins[0] && bins[0].name))}</label>
       <div class="field"><span>Predictores</span>${chips('lX', nums.concat(facs), v => (dL.x ? dL.x.includes(v.name) : false))}</div>`,
      !bins.length ? 'Necesitas una variable categórica con exactamente 2 categorías.' : '');
    const f6 = facs.filter(v => levelsOf(v).length <= 6), dF = D.fact || {};
    h += card('fact', !!D.fact && nums.length >= 1 && f6.length >= 2, 'ANOVA factorial (dos factores)', 'Efectos principales e interacción con sumas de cuadrados de tipo III, η² parcial y gráfico de interacción.',
      `<div class="field"><span>Variables dependientes (un ANOVA para cada una)</span>${chips('fY', nums, v => v.name === pick(dF.y, nums[0] && nums[0].name))}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor 1</span>${sel('fA', f6, pick(dF.a, f6[0] && f6[0].name))}</label>
       <label class="field"><span>Factor 2</span>${sel('fB', f6, pick(dF.b, f6[1] && f6[1].name))}</label></div>`,
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
       <label class="field"><span>Variable dependiente (Y)</span>${sel('meY', nums, pick(dMe.y, defMeY))}</label></div>`,
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
    h += card('efa', !!D.efa && nums.length >= 3, 'Análisis factorial exploratorio', 'Estructura interna de un cuestionario: KMO, Bartlett, análisis paralelo, cargas factoriales, comunalidades y varianza explicada.',
      `<div class="field"><span>Ítems</span>${chips('eI', nums, v => (dE.items ? dE.items.includes(v.name) : false))}</div>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Número de factores</span><select id="eN"><option value="auto">Automático (análisis paralelo)</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(k => `<option value="${k}">${k}</option>`).join('')}</select></label>
       <label class="field"><span>Rotación</span><select id="eR"><option value="oblimin">Oblimin (factores correlacionados, recomendada)</option><option value="varimax">Varimax (factores independientes)</option></select></label></div>`,
      nums.length < 3 ? 'Necesitas al menos tres ítems cuantitativos.' : '');
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
          return `${esc(hi[0].name)} y ${esc(hi[1].name)} (${pt(c.padj)}${c.d !== undefined ? `, <i>d</i> = ${f(Math.abs(c.d))}, efecto ${lbl.d(c.d)}` : ''}; puntuaciones más altas en ${esc(hi[0].name)})`; })) + (sig.length < ph.length ? '. El resto de comparaciones no fueron significativas.' : '.');
      };
      if (normOK) {
        const cl = S.anova(xs);
        let om, ph, phName;
        if (eqVar) { om = cl; sec.test = 'ANOVA de un factor'; phName = 'Tukey HSD'; ph = S.hasTukey ? S.tukeyHSD(xs, cl.msw, cl.df2) : S.pairwiseHolm(xs, true); if (!S.hasTukey) phName = 't por pares con corrección de Holm'; }
        else { om = S.welchAnova(xs); sec.test = 'ANOVA de Welch'; phName = 'Games-Howell'; ph = S.hasTukey ? S.gamesHowell(xs) : S.pairwiseHolm(xs, false); if (!S.hasTukey) phName = 't de Welch por pares con corrección de Holm'; }
        // d de Cohen por pares: con varianzas homogéneas, sobre la DT del error del modelo (√MCE), como JASP y emmeans::eff_size;
        // con varianzas distintas, sobre la media de las dos varianzas (d_av)
        ph.forEach(c => { c.d = c.diff / Math.sqrt(eqVar ? cl.msw : (S.variance(xs[c.i]) + S.variance(xs[c.j])) / 2); });
        sec.why.push(eqVar ? 'Las varianzas son homogéneas: ANOVA clásico con post hoc de Tukey.' : 'Las varianzas no son homogéneas: ANOVA de Welch con post hoc de Games-Howell, que no asumen varianzas iguales.');
        sec.decision = `Se eligió el ${sec.test} porque se comparan ${k} grupos independientes en una variable cuantitativa con normalidad aceptable${eqVar ? ' y varianzas homogéneas' : ' y varianzas distintas'}.`;
        sec.alt = 'Prueba de Kruskal-Wallis si no se cumpliera la normalidad con muestras pequeñas.';
        if (eqVar) sec.tables.push(apaTable('Resultado del ANOVA de un factor', ['Fuente', '<i>SC</i>', '<i>gl</i>', '<i>MC</i>', '<i>F</i>', '<i>p</i>', 'η²'],
          [[esc(gName), f(cl.ssb), cl.df1, f(cl.ssb / cl.df1), f(cl.F), pv(cl.p), nz(cl.eta2.toFixed(3))], ['Error', f(cl.ssw), cl.df2, f(cl.msw), '', '', ''], ['Total', f(cl.ssb + cl.ssw), cl.df1 + cl.df2, '', '', '', '']]));
        else sec.tables.push(apaTable('Resultado del ANOVA de Welch', ['', '<i>F</i>', '<i>gl</i><sub>1</sub>', '<i>gl</i><sub>2</sub>', '<i>p</i>', 'η²'], [[esc(gName), f(om.F), om.df1, f(om.df2), pv(om.p), nz(cl.eta2.toFixed(3))]], 'η² calculado a partir del ANOVA clásico, como medida descriptiva del tamaño del efecto.'));
        const kw = S.kruskal(xs); sec.sens = `Análisis de sensibilidad: la prueba de Kruskal-Wallis da ${pt(kw.p)}, ${(kw.p < .05) === (om.p < .05) ? 'coincidiendo con' : 'lo que <b>no coincide</b> con'} la conclusión.`;
        const st = `<i>F</i>(${om.df1}, ${dfF(om.df2)}) = ${f(om.F)}, ${pt(om.p)}, η² = ${nz(cl.eta2.toFixed(3))}`;
        let t = `Se aplicó un ${sec.test} para comparar ${esc(yName)} según ${esc(gName)} (${groups.map(q => `${esc(q.name)}: ${MD(q)}`).join('; ')}). `;
        if (om.p < .05) {
          t += `Se encontraron diferencias estadísticamente significativas, ${st}, con un tamaño del efecto ${lbl.eta(cl.eta2)}.` + posthocText(ph, phName, false);
          sec.tables.push(apaTable(`Comparaciones post hoc (${phName})`, ['Comparación', 'Diferencia de medias', '<i>p</i> ajustada', '<i>d</i> de Cohen'], ph.map(c => [`${esc(names[c.i])} − ${esc(names[c.j])}`, f(c.diff), pv(c.padj), f(c.d)]),
            eqVar ? '<i>d</i> = diferencia de medias / √<i>MC</i><sub>error</sub> (como JASP). Tamaño del efecto: 0.20 pequeño, 0.50 mediano, 0.80 grande (Cohen, 1988).' : '<i>d</i> = diferencia de medias / raíz de la media de las dos varianzas, adecuada cuando las varianzas difieren. Tamaño del efecto: 0.20 pequeño, 0.50 mediano, 0.80 grande (Cohen, 1988).'));
        } else t += `No se encontraron diferencias estadísticamente significativas, ${st}.`;
        sec.text.push(t);
        code += eqVar ? `modelo <- aov(${Y} ~ ${G}, data = datos)\nsummary(modelo)\neffectsize::eta_squared(modelo)\nTukeyHSD(modelo)\n# d de Cohen por pares (como JASP): diferencia de medias / √MCE\nemmeans::eff_size(emmeans::emmeans(modelo, ~ ${G}), sigma = sigma(modelo), edf = df.residual(modelo))`
          : `oneway.test(${Y} ~ ${G}, data = datos, var.equal = FALSE)\nrstatix::games_howell_test(datos, ${Y} ~ ${G})`;
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

  // ANOVA mixta: k medidas de las mismas personas (intrasujeto) × un factor entre sujetos
  function runMixed(names, gName) {
    const k = names.length, cols = names.map(n => numOf(vByName(n))), cg = catOf(vByName(gName));
    const sec = { title: `${names.join(', ')} × ${gName} (ANOVA mixta)`, test: 'ANOVA mixta (SC tipo III)', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
    if (names.includes(gName)) { sec.error = 'El factor entre sujetos no puede ser una de las medidas.'; return sec; }
    const idx = ST.rows.map((_, i) => i).filter(i => cg[i] !== null && cols.every(c => c[i] !== null));
    const lv = [...new Set(idx.map(i => cg[i]))].sort(cmp), G = lv.length;
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
      code += `friedman.test(as.matrix(datos_mr[, medidas]))\nrstatix::friedman_effsize(largo, valor ~ momento | id)\nrstatix::pairwise_wilcox_test(largo, valor ~ momento, paired = TRUE, p.adjust.method = "holm", exact = FALSE)`;
    }
    sec.code = code; return sec;
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

  function runEfa(names, nSel, rot) {
    const sec = { title: 'Análisis factorial exploratorio', test: '', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
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
    const r = S.efa(X, m, rot), names2 = vars.map(v => v.name), F = Array.from({ length: m }, (_, j) => `F${j + 1}`);
    const kq = r.adec.kmo, kl = kq >= .9 ? 'excelente' : kq >= .8 ? 'muy buena' : kq >= .7 ? 'buena' : kq >= .6 ? 'aceptable' : kq >= .5 ? 'pobre' : 'inaceptable';
    sec.test = `Análisis factorial exploratorio (ejes principales${m > 1 ? `, rotación ${rot}` : ''})`;
    sec.decision = `Se realizó un análisis factorial exploratorio de ${p} ítems con ${n} casos completos, extrayendo ${m} factor${m > 1 ? 'es' : ''} ${auto ? 'según el análisis paralelo' : '(número elegido por ti)'} por ejes principales${m > 1 ? ` con rotación ${rot}` : ''}.`;
    sec.why.push('El análisis factorial exploratorio estudia qué dimensiones subyacen a un conjunto de ítems: qué ítems «van juntos» porque miden lo mismo.');
    sec.why.push('Se usa la extracción por ejes principales, que no exige normalidad multivariante y es robusta con escalas tipo Likert.');
    sec.why.push(auto ? 'El número de factores lo decide el análisis paralelo de Horn: se retienen los factores cuyos autovalores superan el percentil 95 de los obtenidos con datos aleatorios del mismo tamaño. Es más fiable que el criterio de autovalor mayor que 1.' : 'Has fijado tú el número de factores; el análisis paralelo se muestra como referencia.');
    if (m > 1) sec.why.push(rot === 'oblimin' ? 'Rotación oblimin: permite que los factores correlacionen, lo habitual en constructos psicológicos y educativos.' : 'Rotación varimax: obliga a que los factores sean independientes entre sí.');
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
    if (!r.converged) sec.checks.push(chk('no', 'La extracción no convergió del todo en 50 iteraciones: interpreta con cautela.'));
    const neg = vars.filter((_, i) => r.L[i][prim[i].j] < -.3);
    if (neg.length) sec.checks.push(chk('info', `Cargas negativas en ${list(neg.map(v => esc(v.name)))}: probablemente son ítems inversos; recodifícalos antes de calcular puntuaciones o la fiabilidad.`));
    sec.tables.push(apaTable('Adecuación de los datos al análisis factorial', ['KMO', 'χ² de Bartlett', '<i>gl</i>', '<i>p</i>', '<i>n</i>', 'Ítems'], [[nz(kq.toFixed(3)), f(B.chi), B.df, pv(B.p), n, p]]));
    const kk = Math.min(p, 10);
    sec.tables.push(apaTable('Autovalores y análisis paralelo', ['Factor', 'Autovalor', '% varianza', 'Percentil 95 aleatorio', 'Retener'],
      eig.slice(0, kk).map((e, j) => [j + 1, f(e), f(e / p * 100, 1), f(pa.p95[j]), e > pa.p95[j] && j < pa.nfactors ? 'Sí' : 'No']), 'Autovalores de la matriz de correlaciones. Análisis paralelo con 100 conjuntos de datos aleatorios.'));
    const bold = v => (Math.abs(v) >= .4 ? `<b>${r2s(v)}</b>` : r2s(v));
    sec.tables.push(apaTable(`Cargas factoriales${m > 1 ? (rot === 'oblimin' ? ' (matriz de configuración)' : ' rotadas') : ''}`, ['Ítem'].concat(F).concat(['<i>h</i>²', '<i>u</i>²']),
      names2.map((nm, i) => [esc(nm)].concat(r.L[i].map(bold)).concat([nz(r.h2[i].toFixed(2)), nz(r.u2[i].toFixed(2))])),
      `Extracción por ejes principales${m > 1 ? `, rotación ${rot}` : ''}. En negrita, cargas ≥ .40. <i>h</i>² = comunalidad; <i>u</i>² = unicidad.`));
    let cum = 0;
    sec.tables.push(apaTable('Varianza explicada', ['Factor', 'SC de las cargas', '% varianza'].concat(m > 1 && rot !== 'oblimin' ? ['% acumulado'] : []),
      F.map((fn, j) => { cum += r.prop[j]; return [fn, f(r.ss[j]), f(r.prop[j] * 100, 1)].concat(m > 1 && rot !== 'oblimin' ? [f(cum * 100, 1)] : []); }),
      m > 1 && rot === 'oblimin' ? 'Con rotación oblicua los factores comparten varianza y los porcentajes no se suman.' : ''));
    if (m > 1 && rot === 'oblimin') sec.tables.push(apaTable('Correlaciones entre factores', [''].concat(F), F.map((fn, a) => [fn].concat(F.map((_, b) => (a === b ? '—' : b < a ? r2s(r.Phi[a][b]) : ''))))));
    sec.charts.push(fig('Gráfico de sedimentación y análisis paralelo', CH.scree(eig.slice(0, Math.min(p, 15)), pa.p95.slice(0, Math.min(p, 15))), CH.legend(['Datos observados', 'Aleatorio (percentil 95)'])));
    const total = rot === 'oblimin' && m > 1 ? null : S.sum(r.prop);
    let t = `Se realizó un análisis factorial exploratorio con extracción por ejes principales${m > 1 ? ` y rotación ${rot}` : ''} sobre los ${p} ítems (<i>n</i> = ${n}). La medida de adecuación muestral de Kaiser-Meyer-Olkin fue ${kl} (KMO = ${nz(kq.toFixed(2))}) y la prueba de esfericidad de Bartlett ${B.p < .05 ? 'fue' : 'no fue'} significativa, χ²(${B.df}) = ${f(B.chi)}, ${pt(B.p)}. `;
    t += auto ? `El análisis paralelo indicó retener ${m} factor${m > 1 ? 'es' : ''}` : `Se extrajeron ${m} factor${m > 1 ? 'es' : ''}`;
    t += total !== null ? `, que ${m > 1 ? 'explicaron' : 'explicó'} el ${f(total * 100, 1)} % de la varianza. ` : '. ';
    t += F.map((fn, j) => { const its = vars.filter((_, i) => prim[i].j === j && prim[i].mx >= .4); if (!its.length) return `Ningún ítem cargó de forma destacada en el factor ${j + 1}.`;
      const ld = its.map(v => Math.abs(r.L[names2.indexOf(v.name)][j])), ng = its.filter(v => r.L[names2.indexOf(v.name)][j] < 0);
      return `${m > 1 ? `El factor ${j + 1} agrupó` : 'El factor agrupó'} ${its.length === 1 ? 'el ítem' : 'los ítems'} ${list(its.map(v => esc(v.name)))} (cargas ${its.length === 1 ? 'de' : 'entre'} ${nz(Math.min(...ld).toFixed(2))}${its.length > 1 ? ` y ${nz(Math.max(...ld).toFixed(2))}` : ''}${ng.length ? ` en valor absoluto; ${list(ng.map(v => esc(v.name)))} con carga negativa, propia de un ítem inverso` : ''}).`; }).join(' ');
    if (m > 1 && rot === 'oblimin') { const cs = []; for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) cs.push(r.Phi[a][b]); t += ` Las correlaciones entre factores oscilaron entre ${r2s(Math.min(...cs))} y ${r2s(Math.max(...cs))}.`; }
    if (weak.length) t += ` ${list(weak.map(v => esc(v.name)))} no ${weak.length > 1 ? 'mostraron' : 'mostró'} cargas ≥ .40 en ningún factor.`;
    sec.text.push(t);
    sec.alt = 'Análisis factorial confirmatorio (por ejemplo, con lavaan en R) para contrastar una estructura teórica definida a priori. Con ítems ordinales de pocas categorías, puede usarse la matriz de correlaciones policóricas.';
    const Q = names2.map(rq).join(', ');
    sec.code = `# Análisis factorial exploratorio\nitems <- datos[complete.cases(datos[, c(${Q})]), c(${Q})]\npsych::KMO(items)\npsych::cortest.bartlett(cor(items), n = nrow(items))\npsych::fa.parallel(items, fm = "pa", fa = "pc", n.iter = 100, quant = .95)\n` +
      `afe <- psych::fa(items, nfactors = ${m}, fm = "pa", rotate = "${m > 1 ? rot : 'none'}")\nprint(afe$loadings, cutoff = .3, sort = TRUE)\nafe$communality` + (m > 1 && rot === 'oblimin' ? '\nafe$Phi' : '');
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
    const lv = [...new Set(idx.map(i => gc[i]))].sort(cmp), L = lv.length, n = idx.length;
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
    const cs = names.map(n => catOf(vByName(n))), lv = [...new Set(cs.flat().filter(x => x !== null))].sort(cmp);
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
  function runRegression(yName, xNames, method = 'enter') {
    const stepwise = method !== 'enter', mName = { stepwise: 'por pasos', forward: 'hacia delante', backward: 'hacia atrás' }[method];
    const sec = { title: `Regresión lineal${stepwise ? ` ${mName}` : ''}: ${yName}`, test: '', why: [], checks: [], tables: [], charts: [], text: [], code: '' };
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
    sec.tables.push(apaTable(stepwise ? `Resumen del modelo final${sel.steps.length ? ` (paso ${sel.steps.length})` : ''}` : 'Resumen del modelo de regresión', ['<i>R</i>²', '<i>R</i>² ajustado', '<i>F</i>', '<i>gl</i>', '<i>p</i>', '<i>n</i>'], [[nz(m.r2.toFixed(3)), nz(m.adjr2.toFixed(3)), f(m.F), `${m.df1}, ${m.dfr}`, pv(m.pF), n]]));
    const head = ['Predictor', '<i>B</i>', '<i>EE</i>', 'IC 95 % (<i>B</i>)', 'β', '<i>t</i>', '<i>p</i>'].concat(het ? ['<i>EE</i> (HC3)', '<i>p</i> (HC3)'] : []).concat(multi ? ['VIF'] : []);
    const beta = cols.map((c, j) => (j === 0 ? null : m.b[j] * S.sd(X.map(r => r[j])) / sdY));
    const rows = cols.map((c, j) => [esc(c.name), f(m.b[j], 3), f(m.se[j], 3), `[${f(m.ci[j][0], 3)}, ${f(m.ci[j][1], 3)}]`, j ? r2s(beta[j]) : '', f(m.t[j]), pv(m.pv[j])]
      .concat(het ? [f(m.se3[j], 3), pv(m.p3[j])] : []).concat(multi ? [j ? f(m.vif[j]) : ''] : []));
    sec.tables.push(apaTable(`Coeficientes del modelo de regresión para ${yName}`, head, rows, '<i>B</i> = coeficiente no estandarizado; β = coeficiente estandarizado.' + (het ? ' HC3 = errores típicos robustos a la heterocedasticidad.' : '')));
    const pUse = het ? m.p3 : m.pv, sigP = cols.map((c, j) => ({ c, j })).filter(o => o.j > 0 && pUse[o.j] < .05);
    const out = stepwise ? candidates.filter(c => !xNames.includes(c)) : [];
    let t = (stepwise
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
    sec.code = `# Regresión lineal${stepwise ? ` ${mName}` : ''}: ${yName}\n` + (stepwise ? `${stepCode}modelo <- lm(ff(dentro), data = datos_c)\n` : `modelo <- lm(${fml}, data = datos)\n`) + `summary(modelo)\nconfint(modelo)\nparameters::standardize_parameters(modelo, method = "basic")  # β como en SPSS\nshapiro.test(residuals(modelo))\nlmtest::bptest(modelo)\nlmtest::dwtest(modelo)\n` + (xNames.length > 1 ? 'car::vif(modelo)\n' : '') + `sum(cooks.distance(modelo) > 4 / nobs(modelo))` + (het ? '\nlmtest::coeftest(modelo, vcov = sandwich::vcovHC(modelo, type = "HC3"))' : '');
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
      if (isOn('paired')) { const m = checkedVals('pM'), gB = ($('#pB') || {}).value;
        add(m.length >= 2 && gB ? runMixed(m, gB) : m.length === 2 ? runPaired(m[0], m[1]) : m.length > 2 ? runRepeated(m) :{ title: 'Medidas relacionadas', error: 'Selecciona al menos dos momentos o condiciones.', why: [], checks: [], tables: [], charts: [], text: [] }); }
      if (isOn('chi')) add(runChi($('#cA').value, $('#cB').value));
      if (isOn('reg')) add(runRegression($('#rY').value, checkedVals('rX'), ($('#rM') || {}).value || 'enter'));
      if (isOn('logit')) add(runLogistic($('#lY').value, checkedVals('lX')));
      if (isOn('fact')) { const ys = checkedVals('fY');
        if (ys.length) ys.forEach(y => add(runFactorial(y, $('#fA').value, $('#fB').value)));
        else add({ title: 'ANOVA factorial', error: 'Selecciona al menos una variable dependiente.', why: [], checks: [], tables: [], charts: [], text: [] }); }
      if (isOn('ancova')) add(runAncova($('#acY').value, $('#acG').value, checkedVals('acC')));
      if (isOn('binrel')) add(runBinRel(checkedVals('bR')));
      if (isOn('cfa')) add(runCfa([0, 1, 2, 3].map(k => ({ name: $('#cfN' + k).value.trim() || `Factor ${k + 1}`, items: checkedVals('cfI' + k) })).filter(fc => fc.items.length)));
      if (isOn('lmm')) add(runLmm($('#lmY').value, checkedVals('lmX'), $('#lmG').value, $('#lmS').value, [$('#lmIA').value, $('#lmIB').value]));
      if (isOn('mod')) add(runModeration($('#moY').value, $('#moX').value, $('#moW').value));
      if (isOn('med')) add(runMediation($('#meY').value, $('#meX').value, $('#meM').value));
      if (isOn('efa')) add(runEfa(checkedVals('eI'), $('#eN').value, $('#eR').value));
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
