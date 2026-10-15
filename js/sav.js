/* Tharp — lector de archivos de SPSS (.sav sin comprimir o con compresión bytecode; .zsav con zlib).
   Sin dependencias: todo se procesa en el navegador. Formato documentado por GNU PSPP («System File Format»). */
(function (root) {
  'use strict';
  const DATE_FMT = new Set([20, 22, 23, 24, 28, 29, 30, 38, 39, 85]), DATETIME_FMT = new Set([22, 85]), TIME_FMT = new Set([21, 25, 40]);
  const SPSS_EPOCH = 12219379200; // segundos entre 1582-10-14 (origen de SPSS) y 1970-01-01
  const bad = () => new Error('El archivo .sav está dañado o no se reconoce. Guárdalo de nuevo desde SPSS o expórtalo como Excel/CSV.');
  const CODEPAGES = { 65001: 'utf-8', 20127: 'windows-1252', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5' };
  const encodingOf = code => CODEPAGES[code] || (code >= 1250 && code <= 1258 ? 'windows-' + code : code >= 28591 && code <= 28605 ? 'iso-8859-' + (code - 28590) : 'windows-1252');
  const pad = n => String(n).padStart(2, '0');

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Tu navegador no puede leer archivos .zsav. Actualízalo o guarda el archivo en SPSS sin compresión ZSAV.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Lee el diccionario y los datos. Devuelve las columnas «en bruto» (números, o bytes en las de texto) y sus metadatos.
  async function parse(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer), dv = new DataView(arrayBuffer), len = u8.length;
    if (len < 176) throw bad();
    const magic = String.fromCharCode(...u8.subarray(0, 4));
    if (magic !== '$FL2' && magic !== '$FL3') throw new Error('El archivo no es un .sav de SPSS válido.');
    const lc = dv.getInt32(64, true), le = lc === 2 || lc === 3;
    let off = 0;
    const need = n => { if (off + n > len) throw bad(); };
    const i32 = () => { need(4); const v = dv.getInt32(off, le); off += 4; return v; };
    const f64 = () => { need(8); const v = dv.getFloat64(off, le); off += 8; return v; };
    const bytes = n => { need(n); const b = u8.subarray(off, off + n); off += n; return b; };
    const i64 = () => { const lo = dv.getUint32(off + (le ? 0 : 4), le), hi = dv.getInt32(off + (le ? 4 : 0), le); off += 8; return hi * 4294967296 + lo; };

    off = 4; const product = bytes(60); off = 68;
    const caseSize = i32(), compression = i32(), weightIndex = i32(), nCases = i32(), bias = f64();
    off = 176;
    const slots = [], labelSets = [], ext = {};
    for (;;) {
      const rec = i32();
      if (rec === 2) {
        const type = i32(), hasLabel = i32(), nMiss = i32(), print = i32(); i32();
        const name = bytes(8); let label = null;
        if (hasLabel) { const n = i32(); label = bytes(n); off += (4 - n % 4) % 4; }
        const miss = []; for (let k = 0; k < Math.abs(nMiss); k++) miss.push(bytes(8));
        slots.push({ type, name, label, nMiss, miss, fmt: (print >> 16) & 0xff });
      } else if (rec === 3) {
        const n = i32(), pairs = [];
        for (let k = 0; k < n; k++) { const val = bytes(8); need(1); const ln = u8[off]; off += 1; const lab = bytes(ln); off += (8 - (ln + 1) % 8) % 8; pairs.push([val, lab]); }
        if (i32() !== 4) throw bad();
        const nv = i32(), idx = []; for (let k = 0; k < nv; k++) idx.push(i32() - 1);
        labelSets.push({ pairs, idx });
      } else if (rec === 6) { const n = i32(); bytes(n * 80); }
      else if (rec === 7) {
        const sub = i32(), size = i32(), count = i32(); need(size * count);
        (ext[sub] = ext[sub] || []).push({ size, count, data: u8.subarray(off, off + size * count), at: off }); off += size * count;
      } else if (rec === 999) { i32(); break; }
      else throw bad();
    }

    // codificación de texto: registro 20 (nombre) o registro 3 (página de códigos)
    let enc = 'windows-1252';
    if (ext[20]) enc = new TextDecoder('ascii').decode(ext[20][0].data).trim().toLowerCase();
    else if (ext[3] && ext[3][0].size === 4 && ext[3][0].count >= 8) enc = encodingOf(dv.getInt32(ext[3][0].at + 28, le));
    let td; try { td = new TextDecoder(enc); } catch (e) { td = new TextDecoder('windows-1252'); enc = 'windows-1252'; }
    const txt = b => td.decode(b);
    const trim = s => s.replace(/[\s\0]+$/, '');
    let sysmis = -Number.MAX_VALUE;
    if (ext[4] && ext[4][0].size === 8) sysmis = dv.getFloat64(ext[4][0].at, le);
    const num = b => new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, le);

    // variables (una por registro que no sea continuación de una cadena larga)
    const vars = [], bySlot = {};
    slots.forEach((s, k) => {
      if (s.type < 0) return;
      const v = { slot: k, short: trim(txt(s.name)).toUpperCase(), name: trim(txt(s.name)), label: s.label ? trim(txt(s.label)) : '', str: s.type > 0,
        width: s.type, nslots: s.type > 0 ? Math.ceil(s.type / 8) : 1, fmt: s.fmt, measure: 0, labels: new Map(), miss: [], range: null };
      if (v.str) v.miss = s.miss.map(b => trim(txt(b)));
      else if (s.nMiss > 0) v.miss = s.miss.map(num);
      else if (s.nMiss < 0) { v.range = [num(s.miss[0]), num(s.miss[1])]; if (s.nMiss === -3) v.miss = [num(s.miss[2])]; }
      bySlot[k] = v; vars.push(v);
    });
    labelSets.forEach(ls => ls.idx.forEach(k => { const v = bySlot[k]; if (!v) return;
      ls.pairs.forEach(([val, lab]) => v.labels.set(v.str ? trim(txt(val)) : num(val), trim(txt(lab)))); }));
    const kv = sub => (ext[sub] || []).flatMap(e => txt(e.data).split(/[\t\0]+/)).map(p => p.split('=')).filter(p => p.length >= 2);
    // nombres largos (registro 13) y cadenas muy largas (registro 14)
    kv(13).forEach(([s, l]) => { const v = vars.find(x => x.short === s.trim().toUpperCase()); if (v) v.name = l.trim(); });
    const vls = {}; kv(14).forEach(([s, w]) => { vls[s.trim().toUpperCase()] = parseInt(w, 10); });
    // medida (registro 11): 1 nominal, 2 ordinal, 3 escala
    if (ext[11]) {
      const e = ext[11][0], n = e.count, per = n % vars.length === 0 && [2, 3].includes(n / vars.length) ? n / vars.length : null;
      if (per) vars.forEach((v, k) => { v.measure = dv.getInt32(e.at + k * per * 4, le); });
    }
    const rd = (b, o) => new DataView(b.buffer, b.byteOffset + o, 4).getInt32(0, le);
    // etiquetas de valor de cadenas largas (registro 21)
    (ext[21] || []).forEach(e => { const b = e.data; let o = 0;
      while (o + 4 <= b.length) {
        const nl = rd(b, o); o += 4; const name = txt(b.subarray(o, o + nl)); o += nl; o += 4; const n = rd(b, o); o += 4;
        const v = vars.find(x => x.name === name || x.short === name.toUpperCase());
        for (let k = 0; k < n; k++) { const vl = rd(b, o); o += 4; const val = trim(txt(b.subarray(o, o + vl))); o += vl;
          const ll = rd(b, o); o += 4; const lab = trim(txt(b.subarray(o, o + ll))); o += ll; if (v) v.labels.set(val, lab); }
      } });
    // valores perdidos de cadenas largas (registro 22)
    (ext[22] || []).forEach(e => { const b = e.data; let o = 0;
      while (o + 4 <= b.length) {
        const nl = rd(b, o); o += 4; const name = txt(b.subarray(o, o + nl)); o += nl; const n = b[o]; o += 1; const vl = rd(b, o); o += 4;
        const v = vars.find(x => x.name === name || x.short === name.toUpperCase());
        for (let k = 0; k < n; k++) { if (v) v.miss.push(trim(txt(b.subarray(o, o + vl)))); o += vl; }
      } });

    // ---- datos ----
    const slotVar = [], slotPart = [];
    vars.forEach(v => { for (let p = 0; p < v.nslots; p++) { slotVar[v.slot + p] = v; slotPart[v.slot + p] = p; } });
    const nSlots = slots.length;
    if (caseSize > 0 && caseSize !== nSlots) throw bad();
    vars.forEach(v => { v.vals = []; if (v.str) v.buf = new Uint8Array(v.nslots * 8); });
    const SPACES = new Uint8Array(8).fill(32);
    let k = 0, cases = 0;
    const put = (x, b) => { // x: número (o null) para variables numéricas; b: 8 bytes en bruto
      const v = slotVar[k], p = slotPart[k];
      if (v) {
        if (!v.str) v.vals.push(b ? num(b) : x);
        else { v.buf.set(b || SPACES, p * 8); if (p === v.nslots - 1) v.vals.push(v.buf.slice(0, v.width)); }
      }
      if (++k === nSlots) { k = 0; cases++; }
    };
    const full = () => nCases >= 0 && cases >= nCases;
    const bytecode = (src, start) => {
      let p = start;
      outer: while (p + 8 <= src.length && !full()) {
        const cmd = src.subarray(p, p + 8); p += 8;
        for (let c = 0; c < 8 && !full(); c++) {
          const code = cmd[c];
          if (code === 0) continue;
          if (code === 252) break outer;
          if (code === 253) { if (p + 8 > src.length) break outer; put(null, src.subarray(p, p + 8)); p += 8; }
          else if (code === 254) put(null, SPACES);
          else if (code === 255) put(sysmis, null);
          else put(code - bias, null);
        }
      }
    };
    if (compression === 0) { let p = off; while (p + nSlots * 8 <= len && !full()) for (let s = 0; s < nSlots; s++, p += 8) put(null, u8.subarray(p, p + 8)); }
    else if (compression === 1) bytecode(u8, off);
    else if (compression === 2) {
      off += 8; const trailerOfs = i64(); off = trailerOfs + 16; i32(); const nBlocks = i32(), parts = [];
      for (let b = 0; b < nBlocks; b++) { i64(); const cofs = i64(); i32(); const csize = i32(); parts.push(await inflate(u8.subarray(cofs, cofs + csize))); }
      const all = new Uint8Array(parts.reduce((s, x) => s + x.length, 0)); let o = 0; parts.forEach(x => { all.set(x, o); o += x.length; });
      bytecode(all, 0);
    } else throw bad();

    // cadenas muy largas (> 255): SPSS las parte en ceil(ancho/252) variables-segmento de hasta 255 bytes que se vuelven a unir
    const out = [];
    for (let i = 0; i < vars.length; i++) {
      const v = vars[i], w = vls[v.short];
      if (v.str && w > 255) {
        const nseg = Math.ceil(w / 252), segs = vars.slice(i, i + nseg);
        v.vals = v.vals.map((_, r) => { const parts = segs.map(s => s.vals[r]);
          const all = new Uint8Array(parts.reduce((s, x) => s + x.length, 0)); let o = 0; parts.forEach(x => { all.set(x, o); o += x.length; }); return all; });
        i += nseg - 1;
      }
      if (v.str) v.vals = v.vals.map(b => trim(txt(b)));
      out.push(v);
    }
    const weight = weightIndex > 0 && bySlot[weightIndex - 1] ? bySlot[weightIndex - 1].name : null;
    return { vars: out, nCases: cases, encoding: enc, product: trim(txt(product)), compression, weight, sysmis };
  }

  const isMissing = (v, x) => {
    if (x === null) return true;
    if (v.str) return x === '' || v.miss.includes(x);
    return !isFinite(x) || x === v.sysmis || v.miss.includes(x) || (v.range && x >= v.range[0] && x <= v.range[1]);
  };
  const fmtDate = (x, withTime) => { const d = new Date((x - SPSS_EPOCH) * 1000);
    const s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return withTime ? `${s} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : s; };
  const fmtTime = x => { const s = Math.round(Math.abs(x)); return `${x < 0 ? '-' : ''}${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };

  // Convierte a la tabla de Tharp: { aoa, hints, version, app, notes }
  async function read(arrayBuffer) {
    const r = await parse(arrayBuffer);
    if (!r.vars.length) throw new Error('El archivo de SPSS no contiene variables.');
    const hints = {}, notes = []; let nMissUser = 0;
    const cols = r.vars.map(v => {
      v.sysmis = r.sysmis;
      const vals = v.vals.map(x => { const m = isMissing(v, x); if (m && x !== null && x !== '' && !(typeof x === 'number' && (!isFinite(x) || x === r.sysmis))) nMissUser++; return m ? null : x; });
      if (v.str) return { name: v.name, vals }; // el tipo de las variables de texto lo decide la detección automática (identificadores, texto libre…)
      if (DATE_FMT.has(v.fmt) || TIME_FMT.has(v.fmt)) {
        hints[v.name] = { type: 'ign', note: (TIME_FMT.has(v.fmt) ? 'Hora' : 'Fecha') + ' en SPSS: no se analiza' };
        return { name: v.name, vals: vals.map(x => (x === null ? null : TIME_FMT.has(v.fmt) ? fmtTime(x) : fmtDate(x, DATETIME_FMT.has(v.fmt)))) };
      }
      const valid = vals.filter(x => x !== null), distinct = new Set(valid), labeled = v.labels.size > 0 && valid.every(x => v.labels.has(x));
      const asLabels = () => vals.map(x => (x !== null && v.labels.has(x) ? v.labels.get(x) : x));
      // orden de las categorías: el de los códigos numéricos de las etiquetas (1 = …, 2 = …), como en SPSS
      const order = () => [...v.labels.entries()].sort((a, b) => (typeof a[0] === 'number' && typeof b[0] === 'number' ? a[0] - b[0] : String(a[0]).localeCompare(String(b[0])))).map(e => String(e[1]));
      if (v.measure === 1) { hints[v.name] = { type: 'cat', note: 'Nominal en SPSS', labels: true, order: order() }; return { name: v.name, vals: asLabels() }; }
      if (labeled && distinct.size <= 3) {
        hints[v.name] = { type: 'cat', note: `${{ 2: 'Ordinal', 3: 'Escala' }[v.measure] || 'Sin medida'} en SPSS, con ${distinct.size} valores etiquetados: tratada como categórica`, labels: true, order: order() };
        return { name: v.name, vals: asLabels() };
      }
      if (v.measure === 2) hints[v.name] = { type: 'num', note: 'Ordinal en SPSS: tratada como cuantitativa' };
      else if (v.measure === 3) hints[v.name] = { type: 'num', note: 'Escala en SPSS' };
      else if (labeled) { hints[v.name] = { type: 'cat', note: 'Con etiquetas de valor en SPSS', labels: true, order: order() }; return { name: v.name, vals: asLabels() }; }
      return { name: v.name, vals };
    });
    const aoa = [cols.map(c => c.name)];
    for (let i = 0; i < r.nCases; i++) aoa.push(cols.map(c => (c.vals[i] === undefined ? null : c.vals[i])));
    if (nMissUser) notes.push(`${nMissUser} valores definidos como perdidos por el usuario en SPSS se han tratado como perdidos.`);
    if (r.weight) notes.push(`El archivo tiene activada la ponderación por «${r.weight}»; Tharp no aplica ponderaciones: los análisis no están ponderados.`);
    return { aoa, hints, app: 'SPSS', version: 'SPSS' + (r.compression === 2 ? ' (.zsav)' : ' (.sav)'), notes };
  }

  const api = { read, parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TharpSav = api;
})(typeof window !== 'undefined' ? window : globalThis);
