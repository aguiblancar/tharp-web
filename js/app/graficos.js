/* Tharp · aplicación · Gráficos SVG de los resultados (sin dependencias externas) */
import { maxOf, minOf } from './utilidades.js';
import { COL, esc, fmt, svgOpen, ticks, trunc, vbar, yAxis } from './graficos-base.js';
import { barsCat, boxplot, histogram, qqplot, raincloud } from './graficos-distribucion.js';

// medias con IC 95 % sobre los datos individuales
function meansCI(groups, ylabel, opts = {}) {
  const W = 640,
    H = 340,
    m = { l: 56, r: 16, t: 16, b: 48 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b;
  let lo = Infinity,
    hi = -Infinity;
  groups.forEach(g => {
    if (opts.points !== false)
      g.x.forEach(v => {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      });
    lo = Math.min(lo, g.ci[0]);
    hi = Math.max(hi, g.ci[1]);
  });
  const yt = ticks(lo, hi, 5),
    y0 = yt[0],
    y1 = yt[yt.length - 1],
    sy = v => m.t + ph - ((v - y0) / (y1 - y0)) * ph;
  const band = pw / groups.length,
    cx = i => m.l + band * i + band / 2;
  let s = svgOpen(W, H, 'Medias e intervalos de confianza de ' + ylabel) + yAxis(yt, sy, m.l, W - m.r);
  if (opts.points !== false)
    groups.forEach((g, i) => {
      let seed = 7 + i * 101;
      const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
      const spread = Math.min(band * 0.32, 60);
      g.x.forEach(
        v =>
          (s += `<circle cx="${(cx(i) + (rnd() - 0.5) * 2 * spread).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="2.5" fill="${COL.point}" fill-opacity=".45"/>`)
      );
    });
  if (opts.connect)
    s += `<polyline points="${groups.map((g, i) => cx(i) + ',' + sy(g.mean)).join(' ')}" fill="none" stroke="${COL.s[0]}" stroke-width="2"/>`;
  groups.forEach((g, i) => {
    const x = cx(i);
    s += `<g><title>${esc(g.name)}: M = ${g.mean.toFixed(2)}, IC 95 % [${g.ci[0].toFixed(2)}, ${g.ci[1].toFixed(2)}], n = ${g.x.length}</title>`;
    s += `<line x1="${x}" x2="${x}" y1="${sy(g.ci[0])}" y2="${sy(g.ci[1])}" stroke="${COL.text}" stroke-width="2"/>`;
    s += `<line x1="${x - 8}" x2="${x + 8}" y1="${sy(g.ci[0])}" y2="${sy(g.ci[0])}" stroke="${COL.text}" stroke-width="2"/><line x1="${x - 8}" x2="${x + 8}" y1="${sy(g.ci[1])}" y2="${sy(g.ci[1])}" stroke="${COL.text}" stroke-width="2"/>`;
    s += `<circle cx="${x}" cy="${sy(g.mean)}" r="6" fill="${COL.s[0]}" stroke="${COL.surface}" stroke-width="2"/></g>`;
    s += `<text x="${x}" y="${H - m.b + 18}" text-anchor="middle" fill="${COL.text}">${esc(trunc(g.name, 22))}</text>`;
  });
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${COL.axis}"/>`;
  s += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">${esc(trunc(ylabel, 40))}</text>`;
  return s + '</svg>';
}
// barras agrupadas: % de cada columna dentro de cada fila
function groupedBars(rowLv, colLv, pct) {
  const W = 640,
    H = 320,
    m = { l: 48, r: 12, t: 16, b: 44 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b;
  const yt = ticks(0, maxOf(pct.flat()), 5),
    yMax = yt[yt.length - 1],
    sy = v => m.t + ph - (v / yMax) * ph;
  const band = pw / rowLv.length,
    inner = band * 0.8,
    bw = inner / colLv.length;
  let s = svgOpen(W, H, 'Porcentajes por grupo') + yAxis(yt, sy, m.l, W - m.r);
  rowLv.forEach((r, i) => {
    colLv.forEach((c, j) => {
      const x = m.l + band * i + (band - inner) / 2 + j * bw + 1;
      s += vbar(x, sy(pct[i][j]), Math.max(1, bw - 2), sy(0), COL.s[j], `${r} · ${c}: ${pct[i][j].toFixed(1)} %`);
    });
    s += `<text x="${m.l + band * i + band / 2}" y="${H - m.b + 18}" text-anchor="middle" fill="${COL.text}">${esc(trunc(r, 22))}</text>`;
  });
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" stroke="${COL.axis}"/>`;
  s += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">% dentro de cada grupo</text>`;
  return s + '</svg>';
}
const legend = items =>
  `<div class="legend">${items.map((t, j) => `<span><i style="background:${COL.s[j]}"></i>${esc(t)}</span>`).join('')}</div>`;
function scatter(x, y, xlabel, ylabel, opts = {}) {
  const W = 640,
    H = 340,
    m = { l: 56, r: 16, t: 16, b: 44 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b;
  const xt = ticks(minOf(x), maxOf(x), 6),
    yt = ticks(minOf(y), maxOf(y), 5);
  const sx = v => m.l + ((v - xt[0]) / (xt[xt.length - 1] - xt[0])) * pw,
    sy = v => m.t + ph - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * ph;
  let s = svgOpen(W, H, `${ylabel} frente a ${xlabel}`) + yAxis(yt, sy, m.l, W - m.r);
  xt.forEach(
    v => (s += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(v)}</text>`)
  );
  if (opts.zero && yt[0] < 0 && yt[yt.length - 1] > 0)
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" stroke="${COL.axis}" stroke-dasharray="4 4"/>`;
  x.forEach(
    (v, i) =>
      (s += `<circle cx="${sx(v).toFixed(1)}" cy="${sy(y[i]).toFixed(1)}" r="4" fill="${COL.s[0]}" fill-opacity=".55" stroke="${COL.surface}" stroke-width="1"><title>${fmt(v)}, ${fmt(y[i])}</title></circle>`)
  );
  if (opts.line) {
    const [a, b] = opts.line,
      x0 = xt[0],
      x1 = xt[xt.length - 1];
    s += `<line x1="${sx(x0)}" x2="${sx(x1)}" y1="${sy(a + b * x0)}" y2="${sy(a + b * x1)}" stroke="${COL.s[1]}" stroke-width="2" clip-path="none"/>`;
  }
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${COL.axis}"/>`;
  s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(xlabel, 60))}</text>`;
  s += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">${esc(trunc(ylabel, 40))}</text>`;
  return s + '</svg>';
}
// gráfico de interacción: una línea por nivel de B a lo largo de los niveles de A
function interaction(levelsA, series, ylabel) {
  const W = 640,
    H = 340,
    m = { l: 56, r: 16, t: 16, b: 48 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b;
  const all = series.flatMap(s => s.ci.flat()),
    yt = ticks(minOf(all), maxOf(all), 5),
    y0 = yt[0],
    y1 = yt[yt.length - 1];
  const sy = v => m.t + ph - ((v - y0) / (y1 - y0)) * ph,
    band = pw / levelsA.length,
    off = j => (j - (series.length - 1) / 2) * 10;
  const cx = (i, j) => m.l + band * i + band / 2 + off(j);
  let s = svgOpen(W, H, 'Gráfico de interacción de ' + ylabel) + yAxis(yt, sy, m.l, W - m.r);
  series.forEach((se, j) => {
    s += `<polyline points="${se.means.map((v, i) => cx(i, j) + ',' + sy(v)).join(' ')}" fill="none" stroke="${COL.s[j]}" stroke-width="2"/>`;
    se.means.forEach((v, i) => {
      const x = cx(i, j);
      s += `<g><title>${esc(levelsA[i])} · ${esc(se.name)}: M = ${v.toFixed(2)}, IC 95 % [${se.ci[i][0].toFixed(2)}, ${se.ci[i][1].toFixed(2)}]</title><line x1="${x}" x2="${x}" y1="${sy(se.ci[i][0])}" y2="${sy(se.ci[i][1])}" stroke="${COL.s[j]}" stroke-width="2"/><circle cx="${x}" cy="${sy(v)}" r="5" fill="${COL.s[j]}" stroke="${COL.surface}" stroke-width="2"/></g>`;
    });
  });
  levelsA.forEach(
    (l, i) =>
      (s += `<text x="${m.l + band * i + band / 2}" y="${H - m.b + 18}" text-anchor="middle" fill="${COL.text}">${esc(trunc(l, 22))}</text>`)
  );
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${COL.axis}"/>`;
  s += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">${esc(trunc(ylabel, 40))}</text>`;
  return s + '</svg>';
}
// forest plot de odds ratios (escala logarítmica)
function forest(labels, ors, cis) {
  const rowH = 30,
    m = { l: 210, r: 24, t: 14, b: 40 },
    W = 640,
    H = m.t + m.b + rowH * labels.length,
    pw = W - m.l - m.r;
  const lo = Math.min(0.5, minOf(cis.map(c => c[0]))),
    hi = Math.max(2, maxOf(cis.map(c => c[1])));
  const L0 = Math.log(lo),
    L1 = Math.log(hi),
    sx = v => m.l + ((Math.log(v) - L0) / (L1 - L0)) * pw;
  const cand = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].filter(v => v >= lo && v <= hi);
  let s = svgOpen(W, H, 'Odds ratios e intervalos de confianza');
  cand.forEach(
    v =>
      (s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${m.t}" y2="${H - m.b}" stroke="${v === 1 ? COL.axis : COL.grid}"${v === 1 ? ' stroke-dasharray="4 4"' : ''}/><text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${v}</text>`)
  );
  labels.forEach((l, i) => {
    const y = m.t + i * rowH + rowH / 2,
      c = cis[i].map(v => Math.min(hi, Math.max(lo, v)));
    s += `<text x="${m.l - 10}" y="${y + 4}" text-anchor="end" fill="${COL.text}">${esc(trunc(l, 30))}</text>`;
    s += `<g><title>${esc(l)}: OR = ${ors[i].toFixed(2)}, IC 95 % [${cis[i][0].toFixed(2)}, ${cis[i][1].toFixed(2)}]</title><line x1="${sx(c[0])}" x2="${sx(c[1])}" y1="${y}" y2="${y}" stroke="${COL.text}" stroke-width="2"/><circle cx="${sx(Math.min(hi, Math.max(lo, ors[i])))}" cy="${y}" r="6" fill="${COL.s[0]}" stroke="${COL.surface}" stroke-width="2"/></g>`;
  });
  s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${COL.axis}">Odds ratio (escala logarítmica) · 1 = sin efecto</text>`;
  return s + '</svg>';
}
// bosque de un metaanálisis: efecto e IC de cada estudio (cuadrado proporcional al peso), diamante del efecto combinado e intervalo de predicción.
// Los valores van en la escala de análisis (log OR, z de Fisher…); back transforma las etiquetas del eje a la escala original
// marcas del eje en valores redondos de la escala original: 0.1, 0.2, 0.5, 1, 2, 5… para log ('log') y r redondas para z de Fisher ('tanh')
function scaleTicks(min, max, kind) {
  if (kind === 'log') {
    const e0 = Math.floor(Math.log10(Math.exp(min))) - 1,
      e1 = Math.ceil(Math.log10(Math.exp(max))) + 1;
    const pick = mults => {
      const c = [];
      for (let e = e0; e <= e1; e++) mults.forEach(k => c.push(Math.log(k * 10 ** e)));
      const ins = c.filter(v => v >= min - 1e-12 && v <= max + 1e-12);
      const below = c.filter(v => v < min - 1e-12),
        above = c.filter(v => v > max + 1e-12);
      return (below.length ? [below[below.length - 1]] : []).concat(ins, above.length ? [above[0]] : []);
    };
    const t = pick([1, 2, 5]);
    return t.length <= 9 ? t : pick([1]);
  }
  if (kind === 'tanh')
    return ticks(Math.tanh(min), Math.tanh(max), 6)
      .map(r => Math.atanh(Math.max(-0.99, Math.min(0.99, r))))
      .filter((v, i, a) => i === 0 || v > a[i - 1]);
  return ticks(min, max, 6);
}
function metaForest(rows, pooled, xlabel, back = v => v, ref = 0, kind = '') {
  const rowH = 24,
    m = { l: 190, r: 150, t: 14, b: 44 },
    W = 700,
    H = m.t + m.b + rowH * (rows.length + 2),
    pw = W - m.l - m.r;
  const all = rows
      .flatMap(r => [r.lo, r.hi])
      .concat([pooled.lo, pooled.hi])
      .concat(isFinite(pooled.pi[0]) ? pooled.pi : []),
    xt = scaleTicks(Math.min(ref, minOf(all)), Math.max(ref, maxOf(all)), kind);
  const sx = v => m.l + ((v - xt[0]) / (xt[xt.length - 1] - xt[0])) * pw,
    wmax = maxOf(rows.map(r => r.w)),
    fb = v => {
      const b = back(v);
      return Math.abs(b) >= 100 ? b.toFixed(0) : b.toFixed(2);
    };
  let s = svgOpen(W, H, 'Gráfico de bosque del metaanálisis');
  xt.forEach(v => {
    s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${m.t}" y2="${H - m.b}" stroke="${Math.abs(v - ref) < 1e-12 ? COL.axis : COL.grid}"${Math.abs(v - ref) < 1e-12 ? ' stroke-dasharray="4 4"' : ''}/><text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${esc(fmt(+back(v).toPrecision(6)))}</text>`;
  });
  rows.forEach((r, i) => {
    const y = m.t + i * rowH + rowH / 2,
      h = 4 + 8 * Math.sqrt(r.w / wmax);
    s += `<text x="${m.l - 10}" y="${y + 4}" text-anchor="end" fill="${COL.text}">${esc(trunc(r.label, 28))}</text><text x="${W - m.r + 8}" y="${y + 4}" fill="${COL.text}" font-size="11">${fb(r.y)} [${fb(r.lo)}, ${fb(r.hi)}]</text>`;
    s += `<g><title>${esc(r.label)}: ${fb(r.y)} [${fb(r.lo)}, ${fb(r.hi)}]; peso ${r.w.toFixed(1)} %</title><line x1="${sx(r.lo)}" x2="${sx(r.hi)}" y1="${y}" y2="${y}" stroke="${COL.text}" stroke-width="1.5"/><rect x="${sx(r.y) - h / 2}" y="${y - h / 2}" width="${h}" height="${h}" fill="${COL.s[0]}"/></g>`;
  });
  const yp = m.t + (rows.length + 0.8) * rowH;
  if (isFinite(pooled.pi[0]))
    s += `<line x1="${sx(pooled.pi[0])}" x2="${sx(pooled.pi[1])}" y1="${yp}" y2="${yp}" stroke="${COL.s[1]}" stroke-width="2"><title>Intervalo de predicción</title></line>`;
  s += `<path d="M${sx(pooled.lo)},${yp} L${sx(pooled.y)},${yp - 7} L${sx(pooled.hi)},${yp} L${sx(pooled.y)},${yp + 7} Z" fill="${COL.s[1]}"><title>Efecto combinado</title></path>`;
  s += `<text x="${m.l - 10}" y="${yp + 4}" text-anchor="end" fill="${COL.text}" font-weight="600">Combinado</text><text x="${W - m.r + 8}" y="${yp + 4}" fill="${COL.text}" font-size="11" font-weight="600">${fb(pooled.y)} [${fb(pooled.lo)}, ${fb(pooled.hi)}]</text>`;
  s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${COL.axis}">${esc(xlabel)}</text>`;
  return s + '</svg>';
}
// embudo: efecto de cada estudio frente a su error típico (eje invertido) con las líneas del efecto combinado ± 1.96 EE
function funnel(y, se, est, xlabel) {
  const W = 380,
    H = 280,
    m = { l: 50, r: 14, t: 12, b: 42 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b,
    smax = maxOf(se) * 1.05;
  const xt = ticks(Math.min(minOf(y), est - 1.96 * smax), Math.max(maxOf(y), est + 1.96 * smax), 5),
    yt = ticks(0, smax, 4);
  const sx = v => m.l + ((v - xt[0]) / (xt[xt.length - 1] - xt[0])) * pw,
    sy = v => m.t + (v / yt[yt.length - 1]) * ph;
  let s = svgOpen(W, H, 'Gráfico de embudo') + yAxis(yt, sy, m.l, W - m.r);
  xt.forEach(v => {
    s += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(v)}</text>`;
  });
  const S = yt[yt.length - 1];
  s += `<path d="M${sx(est - 1.96 * S)},${sy(S)} L${sx(est)},${sy(0)} L${sx(est + 1.96 * S)},${sy(S)}" fill="none" stroke="${COL.axis}" stroke-dasharray="4 3"/><line x1="${sx(est)}" x2="${sx(est)}" y1="${sy(0)}" y2="${sy(S)}" stroke="${COL.s[1]}"/>`;
  y.forEach((v, i) => {
    s += `<circle cx="${sx(v)}" cy="${sy(se[i])}" r="4" fill="${COL.s[0]}" fill-opacity=".75"/>`;
  });
  s += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(xlabel, 40))}</text><text transform="translate(12 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">Error típico</text>`;
  return s + '</svg>';
}
// gráfico de sedimentación: autovalores observados frente al percentil 95 del análisis paralelo
function scree(obs, ref) {
  const W = 640,
    H = 320,
    m = { l: 48, r: 16, t: 16, b: 44 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b,
    k = obs.length;
  const yt = ticks(0, Math.max(...obs, ...(ref || [0]), 1), 5),
    sx = i => m.l + (k === 1 ? pw / 2 : (i / (k - 1)) * pw),
    sy = v => m.t + ph - (v / yt[yt.length - 1]) * ph;
  let s = svgOpen(W, H, 'Gráfico de sedimentación') + yAxis(yt, sy, m.l, W - m.r);
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(1)}" y2="${sy(1)}" stroke="${COL.axis}" stroke-dasharray="2 4" stroke-opacity=".6"><title>Autovalor = 1</title></line>`;
  const path = (v, col, dash) =>
    `<polyline points="${v.map((y, i) => sx(i).toFixed(1) + ',' + sy(y).toFixed(1)).join(' ')}" fill="none" stroke="${col}" stroke-width="2"${dash ? ' stroke-dasharray="6 5"' : ''}/>`;
  if (ref) {
    s += path(ref, COL.s[1], true);
    ref.forEach(
      (y, i) =>
        (s += `<circle cx="${sx(i).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="3" fill="${COL.s[1]}"><title>Aleatorio (p95), ${i + 1}: ${fmt(y)}</title></circle>`)
    );
  }
  s += path(obs, COL.s[0]);
  obs.forEach(
    (y, i) =>
      (s += `<circle cx="${sx(i).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="4.5" fill="${COL.s[0]}" stroke="${COL.surface}" stroke-width="1.5"><title>Factor ${i + 1}: autovalor ${fmt(y)}</title></circle>`)
  );
  obs.forEach((_, i) => {
    if (k <= 15 || i % 2 === 0)
      s += `<text x="${sx(i)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${i + 1}</text>`;
  });
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${COL.axis}"/>`;
  s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${COL.axis}">Factor</text><text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">Autovalor</text>`;
  return s + '</svg>';
}
// diagrama de rutas de una mediación simple: X → M → Y, con el efecto directo c' (y el total c entre paréntesis)
function pathDiagram(xn, mn, yn, lab) {
  const W = 640,
    H = 260,
    box = (x, y, t) =>
      `<rect x="${x - 85}" y="${y - 24}" width="170" height="48" rx="10" fill="${COL.surface}" stroke="${COL.s[0]}" stroke-width="2"/><text x="${x}" y="${y + 5}" text-anchor="middle" fill="${COL.text}" font-weight="600">${esc(trunc(t, 20))}</text>`;
  const arrow = (x1, y1, x2, y2) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COL.axis}" stroke-width="2" marker-end="url(#ah)"/>`;
  let s =
    svgOpen(W, H, `Diagrama de mediación: ${xn}, ${mn} y ${yn}`) +
    `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${COL.axis}"/></marker></defs>`;
  s += arrow(175, 185, 245, 95) + arrow(395, 95, 465, 185) + arrow(185, 214, 455, 214);
  s += box(110, 210, xn) + box(320, 70, mn) + box(530, 210, yn);
  s += `<text x="190" y="128" text-anchor="end" fill="${COL.text}">${esc(lab.a)}</text><text x="450" y="128" fill="${COL.text}">${esc(lab.b)}</text><text x="320" y="246" text-anchor="middle" fill="${COL.text}">${esc(lab.c)}</text>`;
  return s + '</svg>';
}
// curva ROC: sensibilidad frente a 1 − especificidad, con la diagonal del azar y el punto de corte elegido
function rocCurve(curves, best) {
  const W = 300,
    H = 280,
    m = { l: 46, r: 14, t: 12, b: 42 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b,
    sx = v => m.l + v * pw,
    sy = v => m.t + (1 - v) * ph,
    t = [0, 0.25, 0.5, 0.75, 1];
  let s = svgOpen(W, H, 'Curva ROC') + yAxis(t, sy, m.l, W - m.r);
  t.forEach(v => {
    s += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(v)}</text>`;
  });
  s += `<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(1)}" y2="${sy(1)}" stroke="${COL.axis}" stroke-dasharray="4 3"/>`;
  curves.forEach((c, i) => {
    const pts = c.pts.map(q => [1 - q.sp, q.se]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    s += `<polyline fill="none" stroke="${COL.s[i % COL.s.length]}" stroke-width="2.2" points="${pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')}"><title>${esc(c.name)}: AUC = ${c.auc.toFixed(3)}</title></polyline>`;
  });
  if (best)
    s += `<circle cx="${sx(1 - best.sp)}" cy="${sy(best.se)}" r="5" fill="${COL.s[1]}"><title>Punto de corte óptimo</title></circle>`;
  s += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" fill="${COL.axis}">1 − especificidad</text><text transform="translate(12 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">Sensibilidad</text>`;
  return s + '</svg>';
}
// curvas de Kaplan-Meier: escalones de S(t) desde 1 y una marca (+) en cada tiempo censurado
function kmCurve(curves, xlabel) {
  const W = 420,
    H = 270,
    m = { l: 46, r: 14, t: 12, b: 42 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b;
  const tmax = maxOf(curves.map(c => maxOf(c.times.concat([0])))),
    xt = ticks(0, tmax || 1, 5),
    sx = v => m.l + (v / xt[xt.length - 1]) * pw,
    sy = v => m.t + (1 - v) * ph,
    yt = [0, 0.25, 0.5, 0.75, 1];
  let s = svgOpen(W, H, 'Curvas de supervivencia de Kaplan-Meier') + yAxis(yt, sy, m.l, W - m.r);
  xt.forEach(v => {
    s += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(v)}</text>`;
  });
  curves.forEach((c, i) => {
    const col = COL.s[i % COL.s.length];
    let d = `M${sx(0).toFixed(1)},${sy(1).toFixed(1)}`;
    c.rows.forEach(r => {
      d += ` H${sx(r.t).toFixed(1)} V${sy(r.surv).toFixed(1)}`;
    });
    d += ` H${sx(maxOf(c.times)).toFixed(1)}`;
    s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2"><title>${esc(c.name)}</title></path>`;
    c.cens.forEach(t => {
      const k = c.rows.filter(r => r.t <= t),
        y = k.length ? k[k.length - 1].surv : 1;
      s += `<path d="M${(sx(t) - 3).toFixed(1)},${sy(y).toFixed(1)} h6 M${sx(t).toFixed(1)},${(sy(y) - 3).toFixed(1)} v6" stroke="${col}" stroke-width="1.3"/>`;
    });
  });
  s += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(xlabel, 40))}</text><text transform="translate(12 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">Supervivencia</text>`;
  return s + '</svg>';
}
// gráfico de Bland-Altman: media de las dos medidas frente a su diferencia, con el sesgo y los límites de acuerdo
function blandAltmanPlot(mean, diff, bias, lo, hi, labX) {
  const W = 400,
    H = 250,
    m = { l: 46, r: 108, t: 12, b: 40 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b;
  const xt = ticks(minOf(mean), maxOf(mean), 5),
    yt = ticks(Math.min(lo, minOf(diff)), Math.max(hi, maxOf(diff)), 5);
  const sx = v => m.l + ((v - xt[0]) / (xt[xt.length - 1] - xt[0])) * pw,
    sy = v => m.t + ph - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * ph;
  let s = svgOpen(W, H, 'Gráfico de Bland-Altman') + yAxis(yt, sy, m.l, m.l + pw);
  xt.forEach(v => {
    s += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(v)}</text>`;
  });
  [
    [bias, 'Sesgo', COL.s[0], ''],
    [lo, '−1.96 DT', COL.s[1], '5 4'],
    [hi, '+1.96 DT', COL.s[1], '5 4'],
  ].forEach(([v, lab, col, dash]) => {
    s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${sy(v)}" y2="${sy(v)}" stroke="${col}" stroke-width="1.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/><text x="${m.l + pw + 4}" y="${sy(v) + 4}" fill="${col}" font-size="11">${lab}: ${fmt(v)}</text>`;
  });
  mean.forEach((v, i) => {
    s += `<circle cx="${sx(v)}" cy="${sy(diff[i])}" r="2.6" fill="${COL.s[0]}" fill-opacity=".6"/>`;
  });
  s += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(labX, 40))}</text>`;
  return s + '</svg>';
}
const CH = {
  raincloud,
  metaForest,
  funnel,
  kmCurve,
  pathDiagram,
  scree,
  histogram,
  boxplot,
  qqplot,
  rocCurve,
  blandAltmanPlot,
  barsCat,
  meansCI,
  groupedBars,
  scatter,
  interaction,
  forest,
  legend,
  COL,
  esc,
};

export { esc };
export default CH;
