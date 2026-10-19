/* Tharp · aplicación · Detección y edición de variables (tipo, orden de categorías) */
import { esc } from '../graficos.js';
import S from '../../motor/index.js';
import { loadSheet, toNum } from './lectura.js';
import { ST } from '../estado.js';
import { cmp, f } from '../formato.js';
import { $, $$ } from '../utilidades.js';

// escalas ordinales habituales (español e inglés); se usa la primera en la que encajan todas las categorías presentes
const ORD_SCALES = [
  [
    'nunca',
    'casi nunca',
    'rara vez',
    'pocas veces',
    'a veces',
    'algunas veces',
    'a menudo',
    'frecuentemente',
    'muchas veces',
    'bastantes veces',
    'casi siempre',
    'siempre',
  ],
  [
    'totalmente en desacuerdo',
    'muy en desacuerdo',
    'en desacuerdo',
    'algo en desacuerdo',
    'ni de acuerdo ni en desacuerdo',
    'neutral',
    'indiferente',
    'algo de acuerdo',
    'de acuerdo',
    'muy de acuerdo',
    'totalmente de acuerdo',
  ],
  ['nada', 'muy poco', 'poco', 'algo', 'regular', 'bastante', 'mucho', 'muchisimo'],
  [
    'muy bajo',
    'muy baja',
    'bajo',
    'baja',
    'medio bajo',
    'media baja',
    'medio',
    'media',
    'medio alto',
    'media alta',
    'alto',
    'alta',
    'muy alto',
    'muy alta',
  ],
  ['inferior', 'bajo', 'baja', 'medio', 'media', 'superior', 'alto', 'alta'],
  [
    'ninguno',
    'ninguna',
    'leve',
    'ligero',
    'ligera',
    'moderado',
    'moderada',
    'grave',
    'severo',
    'severa',
    'muy grave',
    'extremo',
    'extrema',
  ],
  [
    'muy malo',
    'muy mala',
    'malo',
    'mala',
    'regular',
    'normal',
    'aceptable',
    'bueno',
    'buena',
    'muy bueno',
    'muy buena',
    'excelente',
  ],
  [
    'muy insatisfecho',
    'muy insatisfecha',
    'insatisfecho',
    'insatisfecha',
    'neutral',
    'satisfecho',
    'satisfecha',
    'muy satisfecho',
    'muy satisfecha',
  ],
  [
    'sin estudios',
    'primaria',
    'estudios primarios',
    'eso',
    'secundaria',
    'estudios secundarios',
    'secundaria o fp medio',
    'bachillerato',
    'fp',
    'fp medio',
    'fp grado medio',
    'fp superior',
    'fp grado superior',
    'fp superior o universitarios',
    'universitarios',
    'universitaria',
    'grado',
    'master',
    'máster',
    'doctorado',
  ],
  ['pre', 'pretest', 'antes', 'post', 'postest', 'despues', 'seguimiento'],
  ['never', 'rarely', 'sometimes', 'often', 'always'],
  ['strongly disagree', 'disagree', 'neutral', 'agree', 'strongly agree'],
  ['none', 'mild', 'moderate', 'severe'],
  ['low', 'medium', 'high'],
];
const normTxt = t =>
  String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
function knownOrder(levels) {
  if (levels.length < 2 || levels.length > 12) return null;
  const nl = levels.map(normTxt);
  for (const sc of ORD_SCALES) {
    const sn = sc.map(normTxt);
    if (nl.every(l => sn.includes(l)))
      return levels.slice().sort((a, b) => sn.indexOf(normTxt(a)) - sn.indexOf(normTxt(b)));
  }
  return null;
}
function detect(name, i, raw, hint) {
  const valid = raw.filter(v => v !== null),
    v = { name, i, raw, hint, valid: valid.length, missing: raw.length - valid.length, note: [] };
  const nums = valid.map(toNum),
    okN = nums.filter(x => x !== null),
    uniq = new Set(valid.map(String)).size;
  v.nonNum = valid.length - okN.length;
  const isId =
    /^(id|n|n[ºo°]|num|numero|número|código|codigo|code|participante|sujeto|caso|case)$|(^id[_ ]|[_ ]id$)/i.test(name);
  if (!valid.length) {
    v.type = 'ign';
    v.note.push('Vacía');
  } else if (okN.length / valid.length >= 0.95) {
    classifyNumeric({ okN, isId, name, v });
  } else {
    if (uniq === valid.length && valid.length > 10) {
      v.type = 'ign';
      v.note.push(isId ? 'Identificador' : 'Texto con valores únicos');
    } else if (uniq > 30) {
      v.type = 'ign';
      v.note.push('Texto libre (' + uniq + ' valores distintos)');
    } else v.type = 'cat';
  }
  if (hint && valid.length) {
    applyFileHint({ valid, hint, isId, v, okN });
  }
  // una variable con el mismo valor en todos los casos no aporta información: se ignora y se explica (la persona puede cambiarla)
  if (valid.length && valid.every(x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x))) {
    v.type = 'ign';
    v.note = ['Fecha (no se analiza)'];
  }
  if (valid.length && uniq === 1 && v.type !== 'ign') {
    v.type = 'ign';
    v.note = [`Constante: vale ${String(valid[0]).slice(0, 20)} en todos los casos`];
  }
  v.labelled = !!(hint && hint.labels);
  v.auto = v.type;
  // orden de las categorías: el de las etiquetas del archivo de origen o el de una escala ordinal reconocida
  const present = [...new Set(valid.map(String))];
  if (hint && hint.order) v.order = hint.order.map(String).filter(l => present.includes(l));
  else {
    const o = knownOrder(present);
    if (o) {
      v.order = o;
      v.orderNote = 'Orden de escala ordinal reconocido';
    }
  }
  return v;
}

/** Columna numérica: identificador, códigos categóricos o cuantitativa (avisa si parece Likert) */
function classifyNumeric({ okN, isId, name, v }) {
  const ints = okN.every(Number.isInteger),
    u = new Set(okN).size;
  // «n» suele ser un tamaño muestral: solo es identificador si sus valores son consecutivos (1, 2, 3…)
  const consec = (() => {
    const so = okN.slice().sort((x, y) => x - y);
    return so.every((x, j) => j === 0 || x === so[j - 1] + 1);
  })();
  if (isId && u === okN.length && (!/^n$/i.test(name) || consec)) {
    v.type = 'ign';
    v.note.push('Identificador');
  } else if (ints && u <= 3) {
    v.type = 'cat';
    v.note.push('Códigos numéricos con ' + u + ' valores: tratada como categórica');
  } else {
    v.type = 'num';
    if (ints && u <= 7) v.note.push('Pocos valores: ¿escala ordinal (Likert)?');
  }
  if (v.nonNum) v.note.push(v.nonNum + ' valores no numéricos se tratarán como perdidos');
}

/** Tipo y nota que trae el archivo de origen (SPSS o JASP), salvo los identificadores */
function applyFileHint({ valid, hint, isId, v, okN }) {
  const uniqAll = new Set(valid.map(String)).size;
  if (hint.type === 'cat' && isId && uniqAll === valid.length) {
    v.type = 'ign';
    v.note = ['Identificador'];
  } else {
    v.type = hint.type === 'num' && okN.length / valid.length < 0.95 ? 'cat' : hint.type;
    v.note = [hint.note].concat(
      v.nonNum && v.type === 'num' ? [v.nonNum + ' valores no numéricos se tratarán como perdidos'] : []
    );
  }
}
const numOf = v => v._num || (v._num = v.raw.map(toNum));
const catOf = v => v.raw.map(x => (x === null ? null : String(x)));
// orden de las categorías: el de la variable (etiquetas de SPSS/JASP, escala ordinal reconocida o el que elija la persona);
// si no hay, numérico o alfabético. ordOf limita el orden a los valores presentes en un subconjunto de casos
const ordOf = (v, present) => {
  const pr = [...new Set(present.filter(x => x !== null && x !== undefined).map(String))];
  if (!v || !v.order) return pr.sort(cmp);
  return v.order.filter(l => pr.includes(l)).concat(pr.filter(l => !v.order.includes(l)).sort(cmp));
};
const levelsOf = v => ordOf(v, catOf(v));
const byType = t => ST.vars.filter(v => v.type === t);
const vByName = n => ST.vars.find(v => v.name === n);
function renderVars() {
  const n = ST.rows.length,
    k = ST.vars.length;
  $('#detTitle').textContent = `Hemos detectado ${k} variables y ${n} participantes.`;
  const nNum = byType('num').length,
    nCat = byType('cat').length,
    nIgn = byType('ign').length,
    nMiss = ST.vars.filter(v => v.type !== 'ign' && v.missing).length;
  $('#detSummary').innerHTML =
    `<span><b>${nNum}</b>cuantitativas</span><span><b>${nCat}</b>categóricas</span>` +
    (nIgn ? `<span><b>${nIgn}</b>ignoradas</span>` : '') +
    (nMiss ? `<span><b>${nMiss}</b>con valores perdidos</span>` : '') +
    `<span class="muted">${esc(ST.fileName)}${ST.sheet ? ' · hoja «' + esc(ST.sheet) + '»' : ''}${ST.source ? ' · ' + esc(ST.source) + ' (tipos y etiquetas importados)' : ''}</span>`;
  $('#sheetSel').innerHTML =
    ST.wb && ST.wb.SheetNames.length > 1
      ? `<label class="field"><span>Hoja</span><select id="sheet">${ST.wb.SheetNames.map(s => `<option${s === ST.sheet ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>`
      : '';
  if ($('#sheet'))
    $('#sheet').onchange = e => {
      try {
        loadSheet(ST.fileName, e.target.value);
      } catch (er) {
        alert(er.message);
      }
    };
  let h =
    '<thead><tr><th>Variable</th><th>Tipo</th><th>Válidos</th><th>Perdidos</th><th>Resumen</th><th>Notas</th></tr></thead><tbody>';
  ST.vars.forEach((v, idx) => {
    let sum = '';
    if (v.type === 'num') {
      const x = numOf(v).filter(a => a !== null);
      if (x.length) {
        const d = S.describe(x);
        sum = `<i>M</i> = ${f(d.mean)} · <i>DT</i> = ${f(d.sd)} · rango ${+d.min.toFixed(3)}–${+d.max.toFixed(3)}`;
      }
    } else if (v.type === 'cat') {
      const lv = levelsOf(v),
        c = catOf(v);
      sum =
        `${lv.length} categorías: ` +
        lv
          .slice(0, 4)
          .map(l => `${esc(l)} (${c.filter(x => x === l).length})`)
          .join(', ') +
        (lv.length > 4 ? '…' : '');
      if (lv.length >= 2 && lv.length <= 30)
        sum += ` <button class="btn btn-line btn-sm" data-ord="${idx}" style="padding:2px 10px;margin-left:6px">Orden</button>`;
      if (ST.ordOpen === idx)
        sum +=
          `<div class="ordEd" style="margin-top:8px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#fff"><div class="muted small" style="margin-bottom:6px">Orden de las categorías (la primera es la de referencia en las regresiones; importa en tablas, gráficos, kappa ponderada y tendencias):</div>` +
          lv
            .map(
              (l, q) =>
                `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><button class="btn btn-line btn-sm" data-up="${q}" ${q === 0 ? 'disabled' : ''} style="padding:0 8px">↑</button><button class="btn btn-line btn-sm" data-dn="${q}" ${q === lv.length - 1 ? 'disabled' : ''} style="padding:0 8px">↓</button><span>${q + 1}. ${esc(l)}</span></div>`
            )
            .join('') +
          `<button class="btn btn-line btn-sm" data-ordclose="1" style="margin-top:6px">Hecho</button></div>`;
    }
    h += `<tr><td><b>${esc(v.name)}</b></td><td><select data-v="${idx}"><option value="num"${v.type === 'num' ? ' selected' : ''}>Cuantitativa</option><option value="cat"${v.type === 'cat' ? ' selected' : ''}>Categórica</option><option value="ign"${v.type === 'ign' ? ' selected' : ''}>Ignorar</option></select></td>
      <td>${v.valid}</td><td>${v.missing ? `<span class="pill warn">${v.missing}</span>` : '0'}</td><td class="small">${sum}</td><td>${v.note.map(t => `<span class="pill">${esc(t)}</span>`).join('')}${v.type === 'cat' && v.orderUser ? '<span class="pill">Orden elegido por ti</span>' : v.type === 'cat' && v.orderNote ? `<span class="pill">${esc(v.orderNote)}</span>` : ''}${v.type !== v.auto ? '<span class="pill">Cambiado por ti</span>' : ''}</td></tr>`;
  });
  $('#varTable').innerHTML = h + '</tbody>';
  $$('#varTable select').forEach(
    s =>
      (s.onchange = () => {
        ST.vars[+s.dataset.v].type = s.value;
        renderVars();
      })
  );
  $$('#varTable [data-ord]').forEach(
    b =>
      (b.onclick = () => {
        ST.ordOpen = ST.ordOpen === +b.dataset.ord ? null : +b.dataset.ord;
        renderVars();
      })
  );
  $$('#varTable [data-ordclose]').forEach(
    b =>
      (b.onclick = () => {
        ST.ordOpen = null;
        renderVars();
      })
  );
  const move = (q, d) => {
    const v = ST.vars[ST.ordOpen],
      lv = levelsOf(v);
    [lv[q], lv[q + d]] = [lv[q + d], lv[q]];
    v.order = lv;
    v.orderUser = true;
    renderVars();
  };
  $$('#varTable [data-up]').forEach(b => (b.onclick = () => move(+b.dataset.up, -1)));
  $$('#varTable [data-dn]').forEach(b => (b.onclick = () => move(+b.dataset.dn, 1)));
}

export { ORD_SCALES, normTxt, knownOrder, detect, numOf, catOf, ordOf, levelsOf, byType, vByName, renderVars };
