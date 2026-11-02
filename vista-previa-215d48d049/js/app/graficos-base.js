/* Tharp · aplicación · Gráficos SVG: colores, escalas, ejes y barras comunes a todos los gráficos */

const COL = {
  s: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  axis: '#52514e',
  grid: '#e8e6e0',
  text: '#14202b',
  point: '#9aa6b1',
  surface: '#ffffff',
};
const FONT = 'Instrument Sans, system-ui, -apple-system, Segoe UI, sans-serif';
const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function niceStep(span, count) {
  const raw = span / count,
    mag = Math.pow(10, Math.floor(Math.log10(raw))),
    e = raw / mag;
  return (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
}
function ticks(min, max, count = 5) {
  if (!(max > min)) {
    min -= 1;
    max += 1;
  }
  const step = niceStep(max - min, count),
    lo = Math.floor(min / step) * step,
    hi = Math.ceil(max / step) * step,
    out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}
const fmt = v => {
  const a = Math.abs(v);
  return a >= 1000 || Number.isInteger(v) ? String(Math.round(v)) : String(+v.toFixed(a < 1 ? 3 : 2));
};
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const svgOpen = (W, H, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" font-family="${FONT}" font-size="12"><rect width="${W}" height="${H}" fill="${COL.surface}"/>`;
function yAxis(t, sy, x0, x1) {
  return t
    .map(
      v =>
        `<line x1="${x0}" x2="${x1}" y1="${sy(v)}" y2="${sy(v)}" stroke="${COL.grid}"/><text x="${x0 - 8}" y="${sy(v) + 4}" text-anchor="end" fill="${COL.axis}">${fmt(v)}</text>`
    )
    .join('');
}
// barra vertical con extremo de datos redondeado (anclada en la base)
function vbar(x, y, w, yb, fill, title) {
  const r = Math.min(4, w / 2, Math.max(0, yb - y));
  const d = `M${x},${yb}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${yb}Z`;
  return `<path d="${d}" fill="${fill}"><title>${esc(title)}</title></path>`;
}

export { COL, esc, niceStep, ticks, fmt, trunc, svgOpen, yAxis, vbar };
