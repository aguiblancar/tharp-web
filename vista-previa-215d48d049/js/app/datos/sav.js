/* Tharp · aplicación · Lector de archivos de SPSS (.sav sin comprimir o con compresión bytecode; .zsav con zlib).
   Sin dependencias: todo se procesa en el navegador. Formato documentado por GNU PSPP («System File Format»). */
import { ErrorDeUsuario } from '../avisos.js';
const DATE_FMT = new Set([20, 22, 23, 24, 28, 29, 30, 38, 39, 85]),
  DATETIME_FMT = new Set([22, 85]),
  TIME_FMT = new Set([21, 25, 40]);
const SPSS_EPOCH = 12219379200; // segundos entre 1582-10-14 (origen de SPSS) y 1970-01-01
const bad = () =>
  new ErrorDeUsuario(
    'El archivo .sav está dañado o no se reconoce. Guárdalo de nuevo desde SPSS o expórtalo como Excel/CSV.'
  );
const CODEPAGES = { 65001: 'utf-8', 20127: 'windows-1252', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5' };
const encodingOf = code =>
  CODEPAGES[code] ||
  (code >= 1250 && code <= 1258
    ? 'windows-' + code
    : code >= 28591 && code <= 28605
      ? 'iso-8859-' + (code - 28590)
      : 'windows-1252');
const pad = n => String(n).padStart(2, '0');

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined')
    throw new ErrorDeUsuario(
      'Tu navegador no puede leer archivos .zsav. Actualízalo o guarda el archivo en SPSS sin compresión ZSAV.'
    );
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Une varios bloques de bytes en uno */
function concatenar(parts) {
  const all = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let o = 0;
  parts.forEach(x => {
    all.set(x, o);
    o += x.length;
  });
  return all;
}

/** Lector secuencial del archivo: cursor y lectura de enteros, reales y bytes con el orden de bytes del archivo */
class Lector {
  constructor(arrayBuffer) {
    this.u8 = new Uint8Array(arrayBuffer);
    this.dv = new DataView(arrayBuffer);
    this.len = this.u8.length;
    this.off = 0;
    this.le = true;
  }
  need(n) {
    if (this.off + n > this.len) throw bad();
  }
  i32() {
    this.need(4);
    const v = this.dv.getInt32(this.off, this.le);
    this.off += 4;
    return v;
  }
  f64() {
    this.need(8);
    const v = this.dv.getFloat64(this.off, this.le);
    this.off += 8;
    return v;
  }
  bytes(n) {
    this.need(n);
    const b = this.u8.subarray(this.off, this.off + n);
    this.off += n;
    return b;
  }
  i64() {
    const lo = this.dv.getUint32(this.off + (this.le ? 0 : 4), this.le),
      hi = this.dv.getInt32(this.off + (this.le ? 4 : 0), this.le);
    this.off += 8;
    return hi * 4294967296 + lo;
  }
}

/** Cabecera (176 bytes): producto, tamaño del caso, compresión, ponderación, número de casos y sesgo */
function leerCabecera(r) {
  if (r.len < 176) throw bad();
  const magic = String.fromCharCode(...r.u8.subarray(0, 4));
  if (magic !== '$FL2' && magic !== '$FL3') throw new ErrorDeUsuario('El archivo no es un .sav de SPSS válido.');
  const lc = r.dv.getInt32(64, true);
  r.le = lc === 2 || lc === 3;
  r.off = 4;
  const product = r.bytes(60);
  r.off = 68;
  const h = { product, caseSize: r.i32(), compression: r.i32(), weightIndex: r.i32(), nCases: r.i32(), bias: r.f64() };
  r.off = 176;
  return h;
}

/** Registro 2: una variable (o la continuación de una cadena larga si su tipo es negativo) */
function leerRegistroVariable(r) {
  const type = r.i32(),
    hasLabel = r.i32(),
    nMiss = r.i32(),
    print = r.i32();
  r.i32();
  const name = r.bytes(8);
  let label = null;
  if (hasLabel) {
    const n = r.i32();
    label = r.bytes(n);
    r.off += (4 - (n % 4)) % 4;
  }
  const miss = [];
  for (let k = 0; k < Math.abs(nMiss); k++) miss.push(r.bytes(8));
  return { type, name, label, nMiss, miss, fmt: (print >> 16) & 0xff };
}

/** Registros 3 y 4: etiquetas de valor y variables a las que se aplican */
function leerEtiquetasDeValor(r) {
  const n = r.i32(),
    pairs = [];
  for (let k = 0; k < n; k++) {
    const val = r.bytes(8);
    r.need(1);
    const ln = r.u8[r.off];
    r.off += 1;
    const lab = r.bytes(ln);
    r.off += (8 - ((ln + 1) % 8)) % 8;
    pairs.push([val, lab]);
  }
  if (r.i32() !== 4) throw bad();
  const nv = r.i32(),
    idx = [];
  for (let k = 0; k < nv; k++) idx.push(r.i32() - 1);
  return { pairs, idx };
}

/** Diccionario: registros hasta el 999. Los registros 7 (extensiones) se guardan por subtipo para leerlos después */
function leerDiccionario(r) {
  const slots = [],
    labelSets = [],
    ext = {};
  for (;;) {
    const rec = r.i32();
    if (rec === 2) slots.push(leerRegistroVariable(r));
    else if (rec === 3) labelSets.push(leerEtiquetasDeValor(r));
    else if (rec === 6) r.bytes(r.i32() * 80);
    else if (rec === 7) {
      const sub = r.i32(),
        size = r.i32(),
        count = r.i32();
      r.need(size * count);
      (ext[sub] = ext[sub] || []).push({ size, count, data: r.u8.subarray(r.off, r.off + size * count), at: r.off });
      r.off += size * count;
    } else if (rec === 999) {
      r.i32();
      break;
    } else throw bad();
  }
  return { slots, labelSets, ext };
}

/** Codificación de texto (registro 20 por nombre o registro 3 por página de códigos) y funciones de decodificación */
function decodificacion(r, ext) {
  let enc = 'windows-1252';
  if (ext[20]) enc = new TextDecoder('ascii').decode(ext[20][0].data).trim().toLowerCase();
  else if (ext[3] && ext[3][0].size === 4 && ext[3][0].count >= 8)
    enc = encodingOf(r.dv.getInt32(ext[3][0].at + 28, r.le));
  let td;
  try {
    td = new TextDecoder(enc);
  } catch (e) {
    td = new TextDecoder('windows-1252');
    enc = 'windows-1252';
  }
  const le = r.le;
  return {
    enc,
    txt: b => td.decode(b),
    trim: s => s.replace(/[\s\0]+$/, ''),
    num: b => new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, le),
    rd: (b, o) => new DataView(b.buffer, b.byteOffset + o, 4).getInt32(0, le),
  };
}

/** Variables (una por registro que no sea continuación de una cadena larga), con sus perdidos y etiquetas */
function construirVariables(slots, labelSets, { txt, trim, num }) {
  const vars = [],
    bySlot = {};
  slots.forEach((s, k) => {
    if (s.type < 0) return;
    const v = {
      slot: k,
      short: trim(txt(s.name)).toUpperCase(),
      name: trim(txt(s.name)),
      label: s.label ? trim(txt(s.label)) : '',
      str: s.type > 0,
      width: s.type,
      nslots: s.type > 0 ? Math.ceil(s.type / 8) : 1,
      fmt: s.fmt,
      measure: 0,
      labels: new Map(),
      miss: [],
      range: null,
    };
    if (v.str) v.miss = s.miss.map(b => trim(txt(b)));
    else if (s.nMiss > 0) v.miss = s.miss.map(num);
    else if (s.nMiss < 0) {
      v.range = [num(s.miss[0]), num(s.miss[1])];
      if (s.nMiss === -3) v.miss = [num(s.miss[2])];
    }
    bySlot[k] = v;
    vars.push(v);
  });
  labelSets.forEach(ls =>
    ls.idx.forEach(k => {
      const v = bySlot[k];
      if (!v) return;
      ls.pairs.forEach(([val, lab]) => v.labels.set(v.str ? trim(txt(val)) : num(val), trim(txt(lab))));
    })
  );
  return { vars, bySlot };
}

/** Registros 13 (nombres largos) y 11 (medida: 1 nominal, 2 ordinal, 3 escala); devuelve los anchos del registro 14 */
function nombresYMedida(vars, ext, r, { txt }) {
  const kv = sub =>
    (ext[sub] || [])
      .flatMap(e => txt(e.data).split(/[\t\0]+/))
      .map(p => p.split('='))
      .filter(p => p.length >= 2);
  kv(13).forEach(([s, l]) => {
    const v = vars.find(x => x.short === s.trim().toUpperCase());
    if (v) v.name = l.trim();
  });
  const vls = {};
  kv(14).forEach(([s, w]) => {
    vls[s.trim().toUpperCase()] = parseInt(w, 10);
  });
  if (ext[11]) {
    const e = ext[11][0],
      n = e.count,
      per = n % vars.length === 0 && [2, 3].includes(n / vars.length) ? n / vars.length : null;
    if (per)
      vars.forEach((v, k) => {
        v.measure = r.dv.getInt32(e.at + k * per * 4, r.le);
      });
  }
  return vls;
}

/** Registros 21 (etiquetas de valor) y 22 (valores perdidos) de las cadenas largas */
function extensionesDeCadenas(vars, ext, { txt, trim, rd }) {
  const varDe = name => vars.find(x => x.name === name || x.short === name.toUpperCase());
  (ext[21] || []).forEach(e => {
    const b = e.data;
    let o = 0;
    while (o + 4 <= b.length) {
      const nl = rd(b, o);
      o += 4;
      const name = txt(b.subarray(o, o + nl));
      o += nl;
      o += 4;
      const n = rd(b, o);
      o += 4;
      const v = varDe(name);
      for (let k = 0; k < n; k++) {
        const vl = rd(b, o);
        o += 4;
        const val = trim(txt(b.subarray(o, o + vl)));
        o += vl;
        const ll = rd(b, o);
        o += 4;
        const lab = trim(txt(b.subarray(o, o + ll)));
        o += ll;
        if (v) v.labels.set(val, lab);
      }
    }
  });
  (ext[22] || []).forEach(e => {
    const b = e.data;
    let o = 0;
    while (o + 4 <= b.length) {
      const nl = rd(b, o);
      o += 4;
      const name = txt(b.subarray(o, o + nl));
      o += nl;
      const n = b[o];
      o += 1;
      const vl = rd(b, o);
      o += 4;
      const v = varDe(name);
      for (let k = 0; k < n; k++) {
        if (v) v.miss.push(trim(txt(b.subarray(o, o + vl))));
        o += vl;
      }
    }
  });
}

/**
 * Datos: reparte cada bloque de 8 bytes en su variable, sin comprimir (0), con compresión bytecode (1) o zlib (2, .zsav).
 * Devuelve el número de casos leídos.
 */
async function leerDatos(r, vars, nSlots, h, sysmis, { num }) {
  const slotVar = [],
    slotPart = [];
  vars.forEach(v => {
    for (let p = 0; p < v.nslots; p++) {
      slotVar[v.slot + p] = v;
      slotPart[v.slot + p] = p;
    }
  });
  if (h.caseSize > 0 && h.caseSize !== nSlots) throw bad();
  vars.forEach(v => {
    v.vals = [];
    if (v.str) v.buf = new Uint8Array(v.nslots * 8);
  });
  const SPACES = new Uint8Array(8).fill(32);
  let k = 0,
    cases = 0;
  const put = (x, b) => {
    // x: número (o null) para variables numéricas; b: 8 bytes en bruto
    const v = slotVar[k],
      p = slotPart[k];
    if (v) {
      if (!v.str) v.vals.push(b ? num(b) : x);
      else {
        v.buf.set(b || SPACES, p * 8);
        if (p === v.nslots - 1) v.vals.push(v.buf.slice(0, v.width));
      }
    }
    if (++k === nSlots) {
      k = 0;
      cases++;
    }
  };
  const full = () => h.nCases >= 0 && cases >= h.nCases;
  const bytecode = (src, start) => {
    let p = start;
    outer: while (p + 8 <= src.length && !full()) {
      const cmd = src.subarray(p, p + 8);
      p += 8;
      for (let c = 0; c < 8 && !full(); c++) {
        const code = cmd[c];
        if (code === 0) continue;
        if (code === 252) break outer;
        if (code === 253) {
          if (p + 8 > src.length) break outer;
          put(null, src.subarray(p, p + 8));
          p += 8;
        } else if (code === 254) put(null, SPACES);
        else if (code === 255) put(sysmis, null);
        else put(code - h.bias, null);
      }
    }
  };
  if (h.compression === 0) {
    let p = r.off;
    while (p + nSlots * 8 <= r.len && !full())
      for (let s = 0; s < nSlots; s++, p += 8) put(null, r.u8.subarray(p, p + 8));
  } else if (h.compression === 1) bytecode(r.u8, r.off);
  else if (h.compression === 2) bytecode(await bloquesZlib(r), 0);
  else throw bad();
  return cases;
}

/** .zsav: localiza los bloques zlib por el índice final y los descomprime en orden */
async function bloquesZlib(r) {
  r.off += 8;
  r.off = r.i64() + 16;
  r.i32();
  const nBlocks = r.i32(),
    parts = [];
  for (let b = 0; b < nBlocks; b++) {
    r.i64();
    const cofs = r.i64();
    r.i32();
    const csize = r.i32();
    parts.push(await inflate(r.u8.subarray(cofs, cofs + csize)));
  }
  return concatenar(parts);
}

/** Cadenas muy largas (> 255): SPSS las parte en ceil(ancho/252) variables-segmento de hasta 255 bytes que se vuelven a unir */
function unirSegmentos(vars, vls, { txt, trim }) {
  const out = [];
  for (let i = 0; i < vars.length; i++) {
    const v = vars[i],
      w = vls[v.short];
    if (v.str && w > 255) {
      const nseg = Math.ceil(w / 252),
        segs = vars.slice(i, i + nseg);
      v.vals = v.vals.map((_, row) => concatenar(segs.map(s => s.vals[row])));
      i += nseg - 1;
    }
    if (v.str) v.vals = v.vals.map(b => trim(txt(b)));
    out.push(v);
  }
  return out;
}

// Lee el diccionario y los datos. Devuelve las columnas «en bruto» (números, o bytes en las de texto) y sus metadatos.
async function parse(arrayBuffer) {
  const r = new Lector(arrayBuffer);
  const h = leerCabecera(r);
  const { slots, labelSets, ext } = leerDiccionario(r);
  const dec = decodificacion(r, ext);
  const sysmis = ext[4] && ext[4][0].size === 8 ? r.dv.getFloat64(ext[4][0].at, r.le) : -Number.MAX_VALUE;
  const { vars, bySlot } = construirVariables(slots, labelSets, dec);
  const vls = nombresYMedida(vars, ext, r, dec);
  extensionesDeCadenas(vars, ext, dec);
  const cases = await leerDatos(r, vars, slots.length, h, sysmis, dec);
  const weight = h.weightIndex > 0 && bySlot[h.weightIndex - 1] ? bySlot[h.weightIndex - 1].name : null;
  return {
    vars: unirSegmentos(vars, vls, dec),
    nCases: cases,
    encoding: dec.enc,
    product: dec.trim(dec.txt(h.product)),
    compression: h.compression,
    weight,
    sysmis,
  };
}

const isMissing = (v, x) => {
  if (x === null) return true;
  if (v.str) return x === '' || v.miss.includes(x);
  return !isFinite(x) || x === v.sysmis || v.miss.includes(x) || (v.range && x >= v.range[0] && x <= v.range[1]);
};
const fmtDate = (x, withTime) => {
  const d = new Date((x - SPSS_EPOCH) * 1000);
  const s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${s} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : s;
};
const fmtTime = x => {
  const s = Math.round(Math.abs(x));
  return `${x < 0 ? '-' : ''}${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

// Convierte a la tabla de Tharp: { aoa, hints, version, app, notes }
async function read(arrayBuffer) {
  const r = await parse(arrayBuffer);
  if (!r.vars.length) throw new ErrorDeUsuario('El archivo de SPSS no contiene variables.');
  const hints = {},
    notes = [];
  let nMissUser = 0;
  const cols = r.vars.map(v => {
    v.sysmis = r.sysmis;
    const vals = v.vals.map(x => {
      const m = isMissing(v, x);
      if (m && x !== null && x !== '' && !(typeof x === 'number' && (!isFinite(x) || x === r.sysmis))) nMissUser++;
      return m ? null : x;
    });
    if (v.str) return { name: v.name, vals }; // el tipo de las variables de texto lo decide la detección automática (identificadores, texto libre…)
    if (DATE_FMT.has(v.fmt) || TIME_FMT.has(v.fmt)) {
      hints[v.name] = { type: 'ign', note: (TIME_FMT.has(v.fmt) ? 'Hora' : 'Fecha') + ' en SPSS: no se analiza' };
      return {
        name: v.name,
        vals: vals.map(x =>
          x === null ? null : TIME_FMT.has(v.fmt) ? fmtTime(x) : fmtDate(x, DATETIME_FMT.has(v.fmt))
        ),
      };
    }
    const valid = vals.filter(x => x !== null),
      distinct = new Set(valid),
      labeled = v.labels.size > 0 && valid.every(x => v.labels.has(x));
    const asLabels = () => vals.map(x => (x !== null && v.labels.has(x) ? v.labels.get(x) : x));
    // orden de las categorías: el de los códigos numéricos de las etiquetas (1 = …, 2 = …), como en SPSS
    const order = () =>
      [...v.labels.entries()]
        .sort((a, b) =>
          typeof a[0] === 'number' && typeof b[0] === 'number' ? a[0] - b[0] : String(a[0]).localeCompare(String(b[0]))
        )
        .map(e => String(e[1]));
    if (v.measure === 1) {
      hints[v.name] = { type: 'cat', note: 'Nominal en SPSS', labels: true, order: order() };
      return { name: v.name, vals: asLabels() };
    }
    if (labeled && distinct.size <= 3) {
      hints[v.name] = {
        type: 'cat',
        note: `${{ 2: 'Ordinal', 3: 'Escala' }[v.measure] || 'Sin medida'} en SPSS, con ${distinct.size} valores etiquetados: tratada como categórica`,
        labels: true,
        order: order(),
      };
      return { name: v.name, vals: asLabels() };
    }
    if (v.measure === 2) hints[v.name] = { type: 'num', note: 'Ordinal en SPSS: tratada como cuantitativa' };
    else if (v.measure === 3) hints[v.name] = { type: 'num', note: 'Escala en SPSS' };
    else if (labeled) {
      hints[v.name] = { type: 'cat', note: 'Con etiquetas de valor en SPSS', labels: true, order: order() };
      return { name: v.name, vals: asLabels() };
    }
    return { name: v.name, vals };
  });
  const aoa = [cols.map(c => c.name)];
  for (let i = 0; i < r.nCases; i++) aoa.push(cols.map(c => (c.vals[i] === undefined ? null : c.vals[i])));
  if (nMissUser)
    notes.push(`${nMissUser} valores definidos como perdidos por el usuario en SPSS se han tratado como perdidos.`);
  if (r.weight)
    notes.push(
      `El archivo tiene activada la ponderación por «${r.weight}»; Tharp no aplica ponderaciones: los análisis no están ponderados.`
    );
  return { aoa, hints, app: 'SPSS', version: 'SPSS' + (r.compression === 2 ? ' (.zsav)' : ' (.sav)'), notes };
}

export { read, parse };
