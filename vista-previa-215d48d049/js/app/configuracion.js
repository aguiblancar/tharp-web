/* Tharp · aplicación · Paso 3: elección y configuración de los análisis */
import { esc } from './graficos.js';
import { byType, levelsOf, vByName } from './datos/variables.js';
import { ST } from './estado.js';
import { $, $$ } from './utilidades.js';
import { TARJETAS } from './tarjetas.js';

/** Variables y valores por defecto que comparten las tarjetas del paso 3 */
function contexto() {
  const nums = byType('num'),
    cats = byType('cat'),
    facs = cats.filter(v => {
      const k = levelsOf(v).length;
      return k >= 2 && k <= 12;
    });
  const D = ST.defaults || {};
  const has = n => vByName(n) && vByName(n).type !== 'ign';
  const pick = (cands, fallback) => (cands && has(cands) ? cands : fallback);
  const bins = cats.filter(v => levelsOf(v).length === 2),
    dL = D.logit || {};
  const f6 = facs.filter(v => levelsOf(v).length <= 6),
    dF = D.fact || {};
  const xs = nums.concat(bins),
    dMo = D.mod || {},
    dMe = D.med || {};
  const nmN = v => v && v.name,
    defMeY = nmN(nums[nums.length - 1]),
    defMeM = nmN(nums[nums.length - 2]),
    defMeX = nmN(xs.find(v => v.name !== defMeY && v.name !== defMeM));
  return { nums, cats, facs, D, has, pick, bins, dL, f6, dF, xs, dMo, dMe, nmN, defMeY, defMeM, defMeX };
}
/** Conecta los controles que dependen de otros (listas que se rellenan y opciones que se muestran u ocultan) */
function conectarControles() {
  const fillCtrl = () => {
    const g = $('#compG') && vByName($('#compG').value),
      c = $('#compCtrl');
    if (!g || !c) return;
    c.innerHTML = levelsOf(g)
      .map(l => `<option value="${esc(l)}">${esc(l)}</option>`)
      .join('');
  };
  if ($('#compG')) {
    $('#compG').addEventListener('change', fillCtrl);
    fillCtrl();
  }
  const fillPos = () => {
    const v = $('#rocY') && vByName($('#rocY').value),
      c = $('#rocPos');
    if (!v || !c) return;
    const lv = levelsOf(v);
    c.innerHTML = lv
      .map((l, q) => `<option value="${esc(l)}"${q === lv.length - 1 ? ' selected' : ''}>${esc(l)}</option>`)
      .join('');
  };
  if ($('#rocY')) {
    $('#rocY').addEventListener('change', fillPos);
    fillPos();
  }
  $$('.an>label input').forEach(i => (i.onchange = () => i.closest('.an').classList.toggle('on', i.checked)));
  const alCambiar = (id, fn) => {
    const el = $('#' + id);
    if (el) el.addEventListener('change', () => fn(el.value));
  };
  const mostrar = (sel, si) => $$(sel).forEach(e => (e.style.display = si ? '' : 'none'));
  alCambiar('compPH', v => mostrar('#compCtrlW', v === 'dunnett'));
  alCambiar('rM', v => {
    mostrar('.rblk', v === 'blocks');
    $('#rXlab').textContent = v === 'blocks' ? 'Bloque 1 (predictores del primer modelo)' : 'Predictores';
  });
  alCambiar('meMod', v => {
    mostrar('#meMW', v === '4p' || v === '6');
    mostrar('#meWW', v === '7' || v === '14');
  });
}
function renderConfig() {
  const c = contexto();
  $('#anList').innerHTML = TARJETAS.map(t => t(c)).join('');
  conectarControles();
}
const isOn = id => {
  const el = $(`.an[data-an="${id}"] > label input`);
  return el && el.checked;
};
const checkedVals = name => $$(`input[name="${name}"]:checked`).map(i => i.value);

export { renderConfig, isOn, checkedVals };
