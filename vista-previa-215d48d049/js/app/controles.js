/* Tharp · aplicación · Controles de formulario reutilizables (casillas de variables, opciones y desplegables) */
import { esc } from './graficos.js';

function chips(name, vars, checked) {
  return `<div class="chips">${vars.map(v => `<label><input type="checkbox" name="${name}" value="${esc(v.name)}"${checked(v) ? ' checked' : ''}>${esc(v.name)}</label>`).join('') || '<span class="muted small">No hay variables de este tipo.</span>'}</div>`;
}
const optChips = (name, opts) =>
  `<div class="chips">${opts.map(([v, l]) => `<label><input type="checkbox" name="${name}" value="${v}">${l}</label>`).join('')}</div>`;
function sel(id, vars, def) {
  return `<select id="${id}">${vars.map(v => `<option value="${esc(v.name)}"${v.name === def ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select>`;
}

export { chips, optChips, sel };
