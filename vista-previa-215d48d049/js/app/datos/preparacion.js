/* Tharp · aplicación · Preparación de datos: transformaciones reproducibles (también en R) */
import S from '../../motor/index.js';
import { esc } from '../graficos.js';
import { checkedVals } from '../configuracion.js';
import { chips } from '../controles.js';
import { toNum } from './lectura.js';
import { catOf, detect, levelsOf, numOf, renderVars, vByName } from './variables.js';
import { ST } from '../estado.js';
import { cmp, list, rq } from '../formato.js';
import { $, $$, maxOf, minOf } from '../utilidades.js';
import { mostrarError } from '../avisos.js';

// cada transformación crea una variable nueva (o filtra casos); se guardan en ST.tf y se pueden deshacer reconstruyendo desde ST.base
const TF_NAMES = {
  scale: 'Puntuación de escala',
  reverse: 'Ítem invertido',
  recode: 'Recodificación',
  cut: 'Grupos',
  diff: 'Diferencia',
  z: 'Puntuación z',
  filter: 'Filtro de casos',
};
const uniqueName = base => {
  let n = base.replace(/\s+/g, '_') || 'nueva',
    k = 2;
  while (ST.headers.includes(n)) n = `${base}_${k++}`;
  return n;
};
const colOf = name => {
  const v = vByName(name);
  return v ? v.raw : ST.rows.map(r => r[ST.headers.indexOf(name)]);
};
function addVar(name, values, hint) {
  const i = ST.headers.length;
  ST.headers.push(name);
  ST.rows.forEach((r, q) => r.push(values[q] === undefined ? null : values[q]));
  const v = detect(name, i, values, hint);
  v.derived = true;
  ST.vars.push(v);
  return v;
}
function refreshVars() {
  // tras filtrar: recalcula cada variable con las filas actuales, conservando lo que haya cambiado la persona
  ST.vars = ST.vars.map(v => {
    const nv = detect(
      v.name,
      v.i,
      ST.rows.map(r => r[v.i]),
      v.hint
    );
    if (v.type !== v.auto) nv.type = v.type;
    if (v.orderUser) {
      nv.order = v.order;
      nv.orderUser = true;
    }
    nv.derived = v.derived;
    return nv;
  });
}
function applyTf(t) {
  const P = t.p;
  if (t.type === 'filter') {
    const v = vByName(P.v),
      ok = x => {
        if (x === null || x === undefined) return false;
        if (P.op === '=' || P.op === '≠') {
          const eq = String(x) === String(P.val) || (toNum(x) !== null && toNum(x) === toNum(P.val));
          return P.op === '=' ? eq : !eq;
        }
        const a = toNum(x),
          b = toNum(P.val);
        if (a === null || b === null) return false;
        return P.op === '>' ? a > b : P.op === '≥' ? a >= b : P.op === '<' ? a < b : a <= b;
      };
    const before = ST.rows.length;
    ST.rows = ST.rows.filter(r => ok(r[v.i]));
    refreshVars();
    t.kept = ST.rows.length;
    t.removed = before - ST.rows.length;
    return;
  }
  let vals, hint;
  if (t.type === 'scale') {
    const cols = P.items.map(n => numOf(vByName(n))),
      k = cols.length,
      maxMiss = P.maxMiss || 0;
    vals = ST.rows.map((_, q) => {
      const xs = cols.map((c, j) => (c[q] === null ? null : P.rev.includes(P.items[j]) ? P.min + P.max - c[q] : c[q])),
        ok = xs.filter(x => x !== null);
      if (k - ok.length > maxMiss || !ok.length) return null;
      const m = ok.reduce((a, b) => a + b, 0) / ok.length;
      return P.method === 'mean' ? m : m * k;
    });
    hint = {
      type: 'num',
      note: `${P.method === 'mean' ? 'Media' : 'Suma'} de ${k} ítems${P.rev.length ? `, ${P.rev.length} invertidos` : ''}`,
    };
  } else if (t.type === 'reverse') {
    const c = numOf(vByName(P.v));
    vals = c.map(x => (x === null ? null : P.min + P.max - x));
    hint = { type: 'num', note: `${P.v} invertido (${P.min}–${P.max})` };
  } else if (t.type === 'recode') {
    const c = catOf(vByName(P.v));
    vals = c.map(x => (x === null ? null : P.map[x] === undefined ? x : P.map[x] === '' ? null : P.map[x]));
    const order = [];
    levelsOf(vByName(P.v)).forEach(l => {
      const nl = P.map[l] === undefined ? l : P.map[l];
      if (nl !== '' && !order.includes(nl)) order.push(nl);
    });
    hint = { type: 'cat', note: `Recodificación de ${P.v}`, order };
  } else if (t.type === 'cut') {
    const c = numOf(vByName(P.v)),
      labs = P.labels;
    vals = c.map(x => {
      if (x === null) return null;
      let g = P.breaks.findIndex(b => x <= b);
      if (g < 0) g = P.breaks.length;
      return labs[g];
    });
    hint = { type: 'cat', note: `Grupos de ${P.v}`, order: labs.slice() };
  } else if (t.type === 'diff') {
    const a = numOf(vByName(P.a)),
      b = numOf(vByName(P.b));
    vals = a.map((x, q) => (x === null || b[q] === null ? null : b[q] - x));
    hint = { type: 'num', note: `${P.b} − ${P.a}` };
  } else if (t.type === 'z') {
    const c = numOf(vByName(P.v)),
      ok = c.filter(x => x !== null),
      m = S.mean(ok),
      sd = S.sd(ok);
    vals = c.map(x => (x === null ? null : (x - m) / sd));
    hint = { type: 'num', note: `Puntuación z de ${P.v}` };
  }
  const v = addVar(t.name, vals, hint);
  t.created = v.name;
}
function rebuildTf() {
  const keep = new Set(ST.base.vars),
    baseVars = ST.vars.filter(v => keep.has(v.name));
  ST.headers = ST.base.headers.slice();
  ST.rows = ST.base.rows.map(r => r.slice());
  ST.vars = baseVars;
  refreshVars();
  ST.tf.forEach(applyTf);
}
// código R equivalente (se inserta tras leer los datos y antes de convertir las categóricas en factor)
function tfCode(t, isSav) {
  const P = t.p,
    col = n => `datos[[${rq(n)}]]`,
    numC = n => (isSav ? `as.numeric(haven::zap_labels(${col(n)}))` : `as.numeric(${col(n)})`),
    chrC = n => {
      const v = vByName(n);
      return isSav && v && v.labelled ? `as.character(haven::as_factor(${col(n)}))` : `as.character(${col(n)})`;
    };
  if (t.type === 'scale')
    return (
      `# ${TF_NAMES.scale}: ${t.name}\nX <- sapply(c(${P.items.map(rq).join(', ')}), function(v) ${isSav ? 'as.numeric(haven::zap_labels(datos[[v]]))' : 'as.numeric(datos[[v]])'})\n` +
      (P.rev.length
        ? `inv <- c(${P.rev.map(rq).join(', ')}); X[, inv] <- ${P.min + P.max} - X[, inv]  # ítems inversos (${P.min}–${P.max})\n`
        : '') +
      `${col(t.name)} <- ifelse(rowSums(is.na(X)) <= ${P.maxMiss || 0}, rowMeans(X, na.rm = TRUE)${P.method === 'mean' ? '' : ` * ${P.items.length}`}, NA)`
    );
  if (t.type === 'reverse')
    return `# ${TF_NAMES.reverse}: ${t.name}\n${col(t.name)} <- ${P.min + P.max} - ${numC(P.v)}`;
  if (t.type === 'recode')
    return `# ${TF_NAMES.recode}: ${t.name}\n${col(t.name)} <- unname(c(${Object.entries(P.map)
      .map(([a, b]) => `${rq(a)} = ${b === '' ? 'NA' : rq(b)}`)
      .join(', ')})[${chrC(P.v)}])`;
  if (t.type === 'cut')
    return `# ${TF_NAMES.cut}: ${t.name}\n${col(t.name)} <- as.character(cut(${numC(P.v)}, breaks = c(-Inf, ${P.breaks.map(b => +b.toFixed(10)).join(', ')}, Inf), labels = c(${P.labels.map(rq).join(', ')}), right = TRUE))`;
  if (t.type === 'diff') return `# ${TF_NAMES.diff}: ${t.name}\n${col(t.name)} <- ${numC(P.b)} - ${numC(P.a)}`;
  if (t.type === 'z') return `# ${TF_NAMES.z}: ${t.name}\n${col(t.name)} <- as.numeric(scale(${numC(P.v)}))`;
  if (t.type === 'filter') {
    const v = vByName(P.v),
      isNum = v && v.type === 'num' && toNum(P.val) !== null,
      op = { '=': '==', '≠': '!=', '≥': '>=', '≤': '<=' }[P.op] || P.op;
    return `# ${TF_NAMES.filter}: ${P.v} ${P.op} ${P.val}\ndatos <- datos[!is.na(${isNum ? numC(P.v) : chrC(P.v)}) & ${isNum ? numC(P.v) : chrC(P.v)} ${op} ${isNum ? +toNum(P.val) : rq(String(P.val))}, ]`;
  }
  return '';
}
function renderTf() {
  const list = $('#tfList');
  if (!list) return;
  list.innerHTML =
    ST.tf && ST.tf.length
      ? `<div style="margin-top:12px"><b class="small">Transformaciones aplicadas</b><ol class="small" style="margin:6px 0">${ST.tf
          .map(
            (t, q) =>
              `<li>${esc(t.desc)}${t.type === 'filter' ? ` — quedan ${t.kept} casos (${t.removed} excluidos)` : ''} <button class="btn btn-line btn-sm" data-tfdel="${q}" style="padding:0 8px;margin-left:6px">Deshacer</button></li>`
          )
          .join('')}</ol></div>`
      : '';
  $$('#tfList [data-tfdel]').forEach(
    b =>
      (b.onclick = () => {
        ST.tf.splice(+b.dataset.tfdel, 1);
        rebuildTf();
        renderTf();
        renderVars();
      })
  );
}
function tfForm() {
  const type = $('#tfType').value,
    F = $('#tfForm');
  $('#tfMsg').innerHTML = '';
  const nums = ST.vars.filter(v => v.type === 'num'),
    cats = ST.vars.filter(v => v.type === 'cat'),
    all = ST.vars.filter(v => v.type !== 'ign');
  const opt = vs => vs.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('');
  const inp = (id, ph, w = 160, val = '') =>
    `<input id="${id}" placeholder="${ph}" value="${esc(val)}" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:${w}px">`;
  const btn = '<p style="margin:10px 0 0"><button class="btn btn-dark btn-sm" id="tfAdd">Aplicar</button></p>';
  if (!type) {
    F.innerHTML = '';
    return;
  }
  if (type === 'scale')
    F.innerHTML = `<div class="field"><span>Ítems de la escala</span>${chips('tfI', nums, () => false)}</div><div class="field"><span>Ítems inversos (se invierten antes de sumar)</span>${chips('tfR', nums, () => false)}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., ansiedad_total')}</label><label class="field"><span>Cálculo</span><select id="tfM"><option value="sum">Suma</option><option value="mean">Media</option></select></label>
    <label class="field"><span>Mínimo y máximo de la escala de respuesta</span><span style="display:flex;gap:6px">${inp('tfMin', 'mín.', 70)}${inp('tfMax', 'máx.', 70)}</span></label>
    <label class="field"><span>Ítems sin responder permitidos</span>${inp('tfMiss', '0', 70, '0')}</label></div>
    <p class="small muted" style="margin:4px 0 0">Si permites ítems sin responder, la puntuación se calcula con la media de los respondidos (en la suma, prorrateada al número total de ítems). Si se supera el máximo, la puntuación queda como perdida.</p>${btn}`;
  else if (type === 'reverse')
    F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Ítem</span><select id="tfV">${opt(nums)}</select></label><label class="field"><span>Mínimo y máximo posibles</span><span style="display:flex;gap:6px">${inp('tfMin', 'mín.', 70)}${inp('tfMax', 'máx.', 70)}</span></label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., ae4_inv')}</label></div>${btn}`;
  else if (type === 'recode') {
    F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable</span><select id="tfV">${opt(cats.concat(nums.filter(v => new Set(v.raw.filter(x => x !== null).map(String)).size <= 15)))}</select></label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., estudios_3')}</label></div><div id="tfMap"></div>${btn}`;
    const fill = () => {
      const v = vByName($('#tfV').value),
        lv = v
          ? v.type === 'cat'
            ? levelsOf(v)
            : [...new Set(v.raw.filter(x => x !== null).map(String))].sort(cmp)
          : [];
      $('#tfMap').innerHTML =
        `<p class="small muted" style="margin:6px 0">Escribe la nueva categoría de cada valor. Pon el mismo nombre para agrupar; déjalo en blanco para tratarlo como perdido.</p>` +
        lv
          .map(
            (l, q) =>
              `<div style="display:flex;gap:8px;align-items:center;margin:3px 0"><span style="min-width:180px">${esc(l)} →</span><input data-map="${q}" data-from="${esc(l)}" value="${esc(l)}" style="font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:8px;width:200px"></div>`
          )
          .join('');
    };
    $('#tfV').onchange = fill;
    fill();
  } else if (type === 'cut')
    F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable cuantitativa</span><select id="tfV">${opt(nums)}</select></label><label class="field"><span>Método</span><select id="tfCM"><option value="median">Por la mediana (2 grupos)</option><option value="q">Por percentiles (grupos de igual tamaño)</option><option value="cuts">Por puntos de corte que yo indique</option></select></label>
    <label class="field"><span>Grupos (percentiles) o cortes</span>${inp('tfCuts', 'p. ej., 3   o bien   10, 20')}</label><label class="field"><span>Etiquetas (opcional)</span>${inp('tfL', 'p. ej., Bajo, Medio, Alto', 200)}</label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., ansiedad_grupo')}</label></div>
    <p class="small muted" style="margin:4px 0 0">Con puntos de corte, cada valor va al primer grupo cuyo corte sea mayor o igual (por ejemplo, con 10 y 20: ≤ 10, de 10 a 20, > 20). Dicotomizar una variable cuantitativa hace perder información: úsalo solo si está justificado (por ejemplo, un punto de corte clínico).</p>${btn}`;
  else if (type === 'diff')
    F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Primera (A, por ejemplo pre)</span><select id="tfA">${opt(nums)}</select></label><label class="field"><span>Segunda (B, por ejemplo post)</span><select id="tfB">${opt(nums)}</select></label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., cambio')}</label></div><p class="small muted" style="margin:4px 0 0">Se calcula B − A.</p>${btn}`;
  else if (type === 'z')
    F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable</span><select id="tfV">${opt(nums)}</select></label><label class="field"><span>Nombre</span>${inp('tfN', 'p. ej., estres_z')}</label></div>${btn}`;
  else if (type === 'filter') {
    F.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end"><label class="field"><span>Variable</span><select id="tfV">${opt(all)}</select></label><label class="field"><span>Condición</span><select id="tfOp"><option>=</option><option>≠</option><option>></option><option>≥</option><option><</option><option>≤</option></select></label><label class="field"><span>Valor</span><span id="tfValW"></span></label></div><p class="small muted" style="margin:4px 0 0">Se analizarán solo los casos que cumplan la condición. Los casos sin dato en la variable se excluyen.</p>${btn}`;
    const fill = () => {
      const v = vByName($('#tfV').value);
      $('#tfValW').innerHTML =
        v && v.type === 'cat'
          ? `<select id="tfVal">${levelsOf(v)
              .map(l => `<option>${esc(l)}</option>`)
              .join('')}</select>`
          : inp('tfVal', 'valor', 110);
    };
    $('#tfV').onchange = fill;
    fill();
  }
  // mínimo y máximo sugeridos a partir de los datos
  const sugg = () => {
    const ns = type === 'scale' ? checkedVals('tfI') : [$('#tfV') && $('#tfV').value];
    const xs = ns.filter(Boolean).flatMap(n => numOf(vByName(n)).filter(x => x !== null));
    if (xs.length && $('#tfMin') && $('#tfMax')) {
      $('#tfMin').value = minOf(xs);
      $('#tfMax').value = maxOf(xs);
    }
  };
  if (type === 'reverse') {
    $('#tfV').onchange = sugg;
    sugg();
  }
  if (type === 'scale') $$('input[name="tfI"]').forEach(b => b.addEventListener('change', sugg));
  $('#tfAdd').onclick = addTf;
}
// Lectura de los controles del formulario de transformaciones
const tfNum = id => parseFloat(String(($('#' + id) || {}).value || '').replace(',', '.'));
const fallo = error => ({ error });
/** Escala: suma o media de ítems, con ítems invertidos y máximo de ítems sin responder */
function tfEscala(type, nameIn) {
  const items = checkedVals('tfI'),
    rev = checkedVals('tfR').filter(r => items.includes(r)),
    mn = tfNum('tfMin'),
    mx = tfNum('tfMax'),
    miss = Math.max(0, Math.round(tfNum('tfMiss') || 0));
  if (items.length < 2) return fallo('Selecciona al menos dos ítems.');
  if (rev.length && !(isFinite(mn) && isFinite(mx) && mx > mn))
    return fallo('Indica el mínimo y el máximo de la escala de respuesta para invertir los ítems.');
  if (miss >= items.length) return fallo('Los ítems sin responder permitidos deben ser menos que el número de ítems.');
  const method = $('#tfM').value;
  const t = { type, name: uniqueName(nameIn || 'escala'), p: { items, rev, min: mn, max: mx, method, maxMiss: miss } };
  t.desc = `${t.name} = ${method === 'mean' ? 'media' : 'suma'} de ${list(items.map(esc))}${rev.length ? ` (invertidos: ${list(rev.map(esc))})` : ''}${miss ? `; se permiten ${miss} ítem${miss > 1 ? 's' : ''} sin responder` : ''}`;
  return t;
}

/** Ítem invertido (mínimo + máximo − valor) */
function tfInvertir(type, nameIn) {
  const v = $('#tfV').value,
    mn = tfNum('tfMin'),
    mx = tfNum('tfMax');
  if (!(isFinite(mn) && isFinite(mx) && mx > mn)) return fallo('Indica el mínimo y el máximo posibles del ítem.');
  const t = { type, name: uniqueName(nameIn || v + '_inv'), p: { v, min: mn, max: mx } };
  t.desc = `${t.name} = ${esc(v)} invertido (${mn} + ${mx} − valor)`;
  return t;
}

/** Recodificación de categorías */
function tfRecodificar(type, nameIn) {
  const v = $('#tfV').value,
    map = {};
  $$('#tfMap [data-map]').forEach(i => {
    map[i.dataset.from] = i.value.trim();
  });
  if (new Set(Object.values(map).filter(Boolean)).size < 1) return fallo('Indica al menos una categoría nueva.');
  const t = { type, name: uniqueName(nameIn || v + '_rec'), p: { v, map } };
  t.desc = `${t.name} = ${esc(v)} recodificada (${
    Object.entries(map)
      .filter(([a, b]) => a !== b)
      .map(([a, b]) => `${esc(a)} → ${b === '' ? 'perdido' : esc(b)}`)
      .join('; ') || 'sin cambios'
  })`;
  return t;
}

/** Grupos de una variable cuantitativa: mediana, percentiles o puntos de corte */
function tfAgrupar(type, nameIn) {
  const v = $('#tfV').value,
    m = $('#tfCM').value,
    x = numOf(vByName(v))
      .filter(q => q !== null)
      .sort((a, b) => a - b);
  let breaks;
  if (m === 'median') breaks = [S.quantile(x, 0.5)];
  else if (m === 'q') {
    const k = Math.round(tfNum('tfCuts'));
    if (!(k >= 2 && k <= 10)) return fallo('Indica cuántos grupos quieres (entre 2 y 10).');
    breaks = Array.from({ length: k - 1 }, (_, j) => S.quantile(x, (j + 1) / k));
  } else {
    breaks = String($('#tfCuts').value)
      .split(/[;\s]+|,\s+/)
      .map(q => parseFloat(q.replace(',', '.')))
      .filter(isFinite)
      .sort((a, b) => a - b);
    if (!breaks.length) return fallo('Escribe uno o más puntos de corte, separados por espacios o «; ».');
  }
  breaks = [...new Set(breaks)];
  const userL = String($('#tfL').value || '')
      .split(',')
      .map(q => q.trim())
      .filter(Boolean),
    G = breaks.length + 1;
  const fmt = b => String(+b.toFixed(4)),
    autoL =
      G === 2
        ? [`≤ ${fmt(breaks[0])}`, `> ${fmt(breaks[0])}`]
        : breaks
            .map((b, j) => (j === 0 ? `≤ ${fmt(b)}` : `${fmt(breaks[j - 1])}–${fmt(b)}`))
            .concat([`> ${fmt(breaks[breaks.length - 1])}`]);
  if (userL.length && userL.length !== G) return fallo(`Escribe ${G} etiquetas separadas por comas (o déjalo vacío).`);
  const t = { type, name: uniqueName(nameIn || v + '_grupo'), p: { v, breaks, labels: userL.length ? userL : autoL } };
  t.desc = `${t.name} = grupos de ${esc(v)} (${m === 'median' ? 'por la mediana' : m === 'q' ? 'por percentiles' : 'por puntos de corte'}: ${t.p.labels.map(esc).join(', ')})`;
  return t;
}

/** Diferencia entre dos variables */
function tfDiferencia(type, nameIn) {
  const a = $('#tfA').value,
    b = $('#tfB').value;
  if (a === b) return fallo('Elige dos variables distintas.');
  const t = { type, name: uniqueName(nameIn || `${b}_menos_${a}`), p: { a, b } };
  t.desc = `${t.name} = ${esc(b)} − ${esc(a)}`;
  return t;
}

/** Puntuación z */
function tfZ(type, nameIn) {
  const v = $('#tfV').value;
  const t = { type, name: uniqueName(nameIn || v + '_z'), p: { v } };
  t.desc = `${t.name} = puntuación z de ${esc(v)}`;
  return t;
}

/** Filtro de casos por una condición */
function tfFiltro(type) {
  const v = $('#tfV').value,
    op = $('#tfOp').value,
    val = String(($('#tfVal') || {}).value || '').trim();
  if (!val) return fallo('Indica el valor de la condición.');
  const vv = vByName(v);
  if (vv && vv.type === 'num' && op !== '=' && op !== '≠' && toNum(val) === null)
    return fallo('Para comparar con >, ≥, < o ≤, el valor debe ser numérico.');
  const t = { type, name: '', p: { v, op, val } };
  t.desc = `Filtro: solo los casos con ${esc(v)} ${op} ${esc(val)}`;
  return t;
}

// Constructor de cada tipo de transformación: devuelve la transformación o { error }
const TF_CONSTRUCTORES = {
  scale: tfEscala,
  reverse: tfInvertir,
  recode: tfRecodificar,
  cut: tfAgrupar,
  diff: tfDiferencia,
  z: tfZ,
  filter: tfFiltro,
};
function addTf() {
  const type = $('#tfType').value,
    msg = m => mostrarError('#tfMsg', m);
  const nameIn = (($('#tfN') || {}).value || '').trim();
  const construir = TF_CONSTRUCTORES[type];
  const t = construir ? construir(type, nameIn) : null;
  if (t && t.error) return msg(t.error);
  if (!t) return;
  ST.tf.push(t);
  applyTf(t);
  if (type === 'filter' && !ST.rows.length) {
    ST.tf.pop();
    rebuildTf();
    return msg('Ningún caso cumple esa condición: no se ha aplicado el filtro.');
  }
  renderTf();
  renderVars();
  $('#tfType').value = '';
  tfForm();
  $('#tfMsg').innerHTML =
    `<p class="small" style="color:var(--ok);margin:8px 0 0">✓ ${type === 'filter' ? `Filtro aplicado: quedan ${t.kept} casos.` : `Creada la variable «${esc(t.created)}».`}</p>`;
}

export { TF_NAMES, uniqueName, colOf, addVar, refreshVars, applyTf, rebuildTf, tfCode, renderTf, tfForm, addTf };
