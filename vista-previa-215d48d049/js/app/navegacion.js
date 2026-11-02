/* Tharp · aplicación · Navegación entre los pasos */
import { renderConfig } from './configuracion.js';
import { $, $$ } from './utilidades.js';
import demoData from '../comun/demo.js';

const DEMO_DEFAULTS = {
  comp: { y: ['ansiedad_post'], g: 'grupo' },
  paired: { vars: ['ansiedad_pre', 'ansiedad_post', 'ansiedad_seguimiento'] },
  chi: { a: 'sexo', b: 'fuma' },
  reg: { y: 'rendimiento', x: ['horas_sueno', 'estres', 'ansiedad_post'] },
  logit: { y: 'fuma', x: ['estres', 'sexo', 'edad'] },
  fact: { y: 'ansiedad_post', a: 'grupo', b: 'sexo' },
  alpha: { items: ['ae1', 'ae2', 'ae3', 'ae4', 'ae5', 'ae6'], rev: ['ae4'] },
  efa: { items: ['ae1', 'ae2', 'ae3', 'ae4', 'ae5', 'ae6'] },
  cfa: [{ name: 'Autoestima', items: ['ae1', 'ae2', 'ae3', 'ae4', 'ae5', 'ae6'] }],
  mod: { y: 'rendimiento', x: 'estres', w: 'horas_sueno' },
  med: { x: 'ansiedad_pre', m: 'ansiedad_post', y: 'autoestima' },
  ancova: { y: 'ansiedad_post', g: 'grupo', c: ['ansiedad_pre'] },
  corr: ['edad', 'horas_sueno', 'ansiedad_pre', 'ansiedad_post', 'estres', 'autoestima', 'rendimiento', 'satisfaccion'],
};
function show(n) {
  [1, 2, 3, 4].forEach(i => $('#s' + i).classList.toggle('hidden', i !== n));
  $$('#stepper div').forEach(d => {
    const s = +d.dataset.s;
    d.className = s === n ? 'on' : s < n ? 'done' : '';
  });
  if (n === 3) renderConfig();
  // sin desplazamiento animado si la persona ha pedido reducir el movimiento
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

export { demoData, DEMO_DEFAULTS, show };
