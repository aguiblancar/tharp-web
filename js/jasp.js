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
      const emptyOf = json => { try { return (JSON.parse(json || '{}').strings) || []; } catch (e) { return []; } };
      const empty = emptyOf(ds.emptyValuesJson);
      const table = `DataSet_${ds.id}`;
      // El esquema cambia entre versiones: JASP 0.97 tiene Columns.hasLabels y una columna Column_N por variable;
      // JASP 0.19–0.95 no tiene hasLabels y guarda dos: Column_N_INT (código de etiqueta, INT_MIN = perdido) y Column_N_DBL (valor; texto «nan»/«inf» si no es número).
      const colInfo = new Set(q('PRAGMA table_info(Columns)').map(r => r.name));
      const dataCols = new Set(q(`PRAGMA table_info(${table})`).map(r => r.name));
      const cols = q(`SELECT id, name, columnType${colInfo.has('hasLabels') ? ', hasLabels' : ''}${colInfo.has('emptyValuesJson') ? ', emptyValuesJson' : ''} FROM Columns WHERE dataSet = ? ORDER BY colIdx`, [ds.id]);
      const split = c => !dataCols.has(`Column_${c.id}`) && dataCols.has(`Column_${c.id}_INT`);
      const rows = q(`SELECT ${cols.map(c => split(c) ? `Column_${c.id}_INT, Column_${c.id}_DBL` : `Column_${c.id}`).join(', ')} FROM ${table} ORDER BY rowNumber`);
      const INT_MIN = -2147483648;
      const out = cols.map(c => {
        const map = new Map(), emptySet = new Set(empty.concat(emptyOf(c.emptyValuesJson)).map(String));
        const hasLabels = 'hasLabels' in c ? !!c.hasLabels : true;
        const order = [];
        if (hasLabels) q('SELECT value, label, originalValueJson FROM Labels WHERE columnId = ? ORDER BY ordering, value', [c.id]).forEach(l => {
          let orig = null; try { orig = JSON.parse(l.originalValueJson); } catch (e) { orig = null; }
          const numeric = String(c.columnType).toLowerCase() === 'scale';
          let v = numeric ? (typeof orig === 'number' ? orig : asValue(l.label)) : (l.label !== '' && l.label !== null ? l.label : orig);
          if (v !== null && emptySet.has(String(v))) v = null;
          map.set(l.value, asValue(v)); if (v !== null) order.push(String(asValue(v)));
        });
        const clean = v => (v !== null && emptySet.has(String(v)) ? null : v);
        const vals = rows.map(r => {
          if (split(c)) {
            const code = r[`Column_${c.id}_INT`], dbl = r[`Column_${c.id}_DBL`];
            if (code !== null && code !== undefined && code !== INT_MIN && map.has(code)) return map.get(code);
            return typeof dbl === 'number' && isFinite(dbl) ? clean(dbl) : null;
          }
          const raw = r[`Column_${c.id}`]; if (raw === null || raw === undefined) return null;
          if (hasLabels && map.has(raw)) return map.get(raw); return clean(asValue(raw));
        });
        return { name: c.name, measure: c.columnType, vals, order };
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
      return { name: fl.name, measure: fl.measureType, vals: out, order: labels ? [...labels.values()].map(l => String(asValue(l))) : [] };
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
    const hints = {}; cols.forEach(c => { hints[c.name] = hintOf(c.measure, c.vals); if (c.order && c.order.length) hints[c.name].order = [...new Set(c.order)]; });
    return { aoa, hints, version };
  }
  root.TharpJasp = { read };
})(window);
