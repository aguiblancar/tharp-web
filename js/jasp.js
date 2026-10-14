/* Tharp — lector de archivos .jasp (JASP 0.8–0.17: data.bin; JASP ≥ 0.18: internal.sqlite).
   Todo se procesa en el navegador. Las librerías se cargan solo al abrir un .jasp. */
(function (root) {
  'use strict';
  const JSZIP = 'vendor/jszip.min.js';
  const SQLBASE = 'vendor/';
  let SQL = null;
  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('No se pudo cargar el lector de JASP. Recarga la página e inténtalo de nuevo.')); document.head.appendChild(s);
  });
  // JASP: scale → cuantitativa; nominal → categórica; ordinal numérica → cuantitativa (editable)
  const hintOf = (measure, values) => {
    const m = String(measure || '').toLowerCase();
    if (m === 'scale' || m === 'continuous') return { type: 'num', note: 'Escala en JASP' };
    if (m === 'ordinal') return values.every(v => v === null || typeof v === 'number') ? { type: 'num', note: 'Ordinal en JASP: tratada como cuantitativa' } : { type: 'cat', note: 'Ordinal en JASP' };
    return { type: 'cat', note: 'Nominal en JASP' };
  };
  const asValue = v => { if (v === null || v === undefined) return null; if (typeof v === 'number') return v;
    const s = String(v); const n = Number(s); return s.trim() !== '' && isFinite(n) && /^-?[\d.]+(e-?\d+)?$/i.test(s.trim()) ? n : s; };

  async function readNew(zip) {
    if (!root.initSqlJs) await loadScript(SQLBASE + 'sql-wasm.js');
    if (!SQL) SQL = await root.initSqlJs({ locateFile: f => SQLBASE + f });
    const db = new SQL.Database(new Uint8Array(await zip.file('internal.sqlite').async('uint8array')));
    try {
      const q = (sql, p) => { const st = db.prepare(sql); if (p) st.bind(p); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
      const ds = q('SELECT id, emptyValuesJson FROM DataSets ORDER BY id LIMIT 1')[0];
      if (!ds) throw new Error('El archivo JASP no contiene datos.');
      let empty = []; try { empty = (JSON.parse(ds.emptyValuesJson || '{}').strings) || []; } catch (e) { /* sin valores vacíos propios */ }
      const cols = q('SELECT id, name, columnType, hasLabels FROM Columns WHERE dataSet = ? ORDER BY colIdx', [ds.id]);
      const table = `DataSet_${ds.id}`, emptySet = new Set(empty.map(String));
      const rows = q(`SELECT ${cols.map(c => `Column_${c.id}`).join(', ')} FROM ${table} ORDER BY rowNumber`);
      const out = cols.map(c => {
        const map = new Map();
        if (c.hasLabels) q('SELECT value, label, originalValueJson FROM Labels WHERE columnId = ?', [c.id]).forEach(l => {
          let orig = null; try { orig = JSON.parse(l.originalValueJson); } catch (e) { orig = null; }
          const numeric = String(c.columnType).toLowerCase() === 'scale';
          let v = numeric ? (typeof orig === 'number' ? orig : asValue(l.label)) : (l.label !== '' && l.label !== null ? l.label : orig);
          if (v !== null && emptySet.has(String(v))) v = null;
          map.set(l.value, asValue(v));
        });
        const vals = rows.map(r => { const raw = r[`Column_${c.id}`]; if (raw === null || raw === undefined) return null;
          if (c.hasLabels && map.has(raw)) return map.get(raw); const v = asValue(raw); return v !== null && emptySet.has(String(v)) ? null : v; });
        return { name: c.name, measure: c.columnType, vals };
      });
      return out;
    } finally { db.close(); }
  }

  async function readOld(zip) {
    const meta = JSON.parse(await zip.file('metadata.json').async('string'));
    const x = zip.file('xdata.json') ? JSON.parse(await zip.file('xdata.json').async('string')) : {};
    const buf = (await zip.file('data.bin').async('uint8array')).buffer, dv = new DataView(buf);
    const ds = meta.dataSet || {}, n = ds.rowCount || 0, empty = new Set((meta.emptyValues || []).map(String)); let off = 0;
    return (ds.fields || []).map(fl => {
      const vals = [], isNum = fl.type === 'number';
      for (let i = 0; i < n; i++) {
        if (isNum) { const v = dv.getFloat64(off, true); off += 8; vals.push(isFinite(v) ? v : null); }
        else { const v = dv.getInt32(off, true); off += 4; vals.push(v === -2147483648 ? null : v); }
      }
      const labels = x[fl.name] && x[fl.name].labels ? new Map(x[fl.name].labels.map(l => [l[0], l[1]])) : null;
      const out = vals.map(v => { if (v === null) return null; const m = labels && labels.has(v) ? asValue(labels.get(v)) : v; return m !== null && empty.has(String(m)) ? null : m; });
      return { name: fl.name, measure: fl.measureType, vals: out };
    });
  }

  // Devuelve { aoa, hints, version } con la primera fila = nombres de variables
  async function read(arrayBuffer) {
    if (!root.JSZip) await loadScript(JSZIP);
    let zip; try { zip = await root.JSZip.loadAsync(arrayBuffer); } catch (e) { throw new Error('El archivo no es un .jasp válido.'); }
    let cols, version;
    if (zip.file('internal.sqlite')) { cols = await readNew(zip); version = 'JASP 0.18 o posterior'; }
    else if (zip.file('metadata.json') && zip.file('data.bin')) { cols = await readOld(zip); version = 'JASP 0.8–0.17'; }
    else throw new Error('No se reconoce el formato de este archivo .jasp. Expórtalo desde JASP como CSV (Archivo → Exportar datos) y súbelo.');
    if (!cols.length) throw new Error('El archivo JASP no contiene variables.');
    const n = Math.max(...cols.map(c => c.vals.length)), aoa = [cols.map(c => c.name)];
    for (let i = 0; i < n; i++) aoa.push(cols.map(c => (c.vals[i] === undefined ? null : c.vals[i])));
    const hints = {}; cols.forEach(c => { hints[c.name] = hintOf(c.measure, c.vals); });
    return { aoa, hints, version };
  }
  root.TharpJasp = { read };
})(window);
