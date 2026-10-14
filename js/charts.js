/* Tharp — gráficos SVG (sin dependencias) */
(function (root) {
  'use strict';
  const COL = { s: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    axis: '#52514e', grid: '#e8e6e0', text: '#14202b', point: '#9aa6b1', surface: '#ffffff' };
  const FONT = "Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function niceStep(span, count) {
    const raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), e = raw / mag;
    return (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  }
  function ticks(min, max, count = 5) {
    if (!(max > min)) { min -= 1; max += 1; }
    const step = niceStep(max - min, count), lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }
  const fmt = v => { const a = Math.abs(v); return (a >= 1000 || Number.isInteger(v)) ? String(Math.round(v)) : String(+v.toFixed(a < 1 ? 3 : 2)); };
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const svgOpen = (W, H, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" font-family="${FONT}" font-size="12"><rect width="${W}" height="${H}" fill="${COL.surface}"/>`;
  function yAxis(t, sy, x0, x1) {
    return t.map(v => `<line x1="${x0}" x2="${x1}" y1="${sy(v)}" y2="${sy(v)}" stroke="${COL.grid}"/><text x="${x0 - 8}" y="${sy(v) + 4}" text-anchor="end" fill="${COL.axis}">${fmt(v)}</text>`).join('');
  }
  // barra vertical con extremo de datos redondeado (anclada en la base)
  function vbar(x, y, w, yb, fill, title) {
    const r = Math.min(4, w / 2, Math.max(0, yb - y));
    const d = `M${x},${yb}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${yb}Z`;
    return `<path d="${d}" fill="${fill}"><title>${esc(title)}</title></path>`;
  }
  function hbar(x0, y, w, h, fill, title) {
    const r = Math.min(4, h / 2, w), x1 = x0 + w;
    const d = `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
    return `<path d="${d}" fill="${fill}"><title>${esc(title)}</title></path>`;
  }

  function histogram(values, label) {
    const W = 360, H = 220, m = { l: 42, r: 12, t: 12, b: 34 }, n = values.length;
    const uniq = [...new Set(values)].sort((a, b) => a - b);
    let bins;
    if (uniq.length <= 12) bins = uniq.map(v => ({ lo: v, hi: v, c: values.filter(x => x === v).length, discrete: true }));
    else {
      const min = uniq[0], max = uniq[uniq.length - 1], step = niceStep(max - min, Math.min(30, Math.ceil(Math.log2(n) + 1)));
      const start = Math.floor(min / step) * step; bins = [];
      for (let lo = start; lo <= max; lo += step) bins.push({ lo: +lo.toFixed(10), hi: +(lo + step).toFixed(10), c: 0 });
      values.forEach(v => { const k = Math.min(bins.length - 1, Math.floor((v - start) / step)); bins[k].c++; });
    }
    const maxC = Math.max(...bins.map(b => b.c)), yt = ticks(0, maxC, 4), yMax = yt[yt.length - 1];
    const pw = W - m.l - m.r, ph = H - m.t - m.b, sy = v => m.t + ph - v / yMax * ph, bw = pw / bins.length;
    let s = svgOpen(W, H, 'Histograma de ' + label) + yAxis(yt, sy, m.l, W - m.r);
    bins.forEach((b, i) => {
      const x = m.l + i * bw + 1, w = Math.max(1, bw - 2), rng = b.discrete ? fmt(b.lo) : `${fmt(b.lo)} – ${fmt(b.hi)}`;
      if (b.c) s += vbar(x, sy(b.c), w, sy(0), COL.s[0], `${rng}: ${b.c} casos`);
    });
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" stroke="${COL.axis}"/>`;
    if (bins[0].discrete) bins.forEach((b, i) => { if (bins.length <= 8 || i % 2 === 0) s += `<text x="${m.l + i * bw + bw / 2}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(b.lo)}</text>`; });
    else {
      const lo = bins[0].lo, hi = bins[bins.length - 1].hi, sx = v => m.l + (v - lo) / (hi - lo) * pw;
      ticks(lo, hi, 5).filter(v => v >= lo && v <= hi).forEach(v => s += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(v)}</text>`);
    }
    s += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(label, 40))}</text>`;
    return s + '</svg>';
  }

  function barsCat(levels, counts, label) {
    const rowH = 26, m = { l: 120, r: 60, t: 8, b: 8 }, W = 360, H = m.t + m.b + rowH * levels.length;
    const max = Math.max(...counts), total = counts.reduce((a, b) => a + b, 0), pw = W - m.l - m.r;
    let s = svgOpen(W, H, 'Frecuencias de ' + label);
    levels.forEach((lv, i) => {
      const y = m.t + i * rowH + 4, w = Math.max(1, counts[i] / max * pw), pct = (counts[i] / total * 100).toFixed(1);
      s += `<text x="${m.l - 8}" y="${y + 13}" text-anchor="end" fill="${COL.text}">${esc(trunc(lv, 16))}</text>`;
      s += hbar(m.l, y, w, rowH - 8, COL.s[0], `${lv}: ${counts[i]} (${pct} %)`);
      s += `<text x="${m.l + w + 6}" y="${y + 13}" fill="${COL.axis}">${counts[i]}</text>`;
    });
    return s + `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}" stroke="${COL.axis}"/></svg>`;
  }

  // medias con IC 95 % sobre los datos individuales
  function meansCI(groups, ylabel, opts = {}) {
    const W = 640, H = 340, m = { l: 56, r: 16, t: 16, b: 48 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    let lo = Infinity, hi = -Infinity;
    groups.forEach(g => { if (opts.points !== false) g.x.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); }); lo = Math.min(lo, g.ci[0]); hi = Math.max(hi, g.ci[1]); });
    const yt = ticks(lo, hi, 5), y0 = yt[0], y1 = yt[yt.length - 1], sy = v => m.t + ph - (v - y0) / (y1 - y0) * ph;
    const band = pw / groups.length, cx = i => m.l + band * i + band / 2;
    let s = svgOpen(W, H, 'Medias e intervalos de confianza de ' + ylabel) + yAxis(yt, sy, m.l, W - m.r);
    if (opts.points !== false) groups.forEach((g, i) => {
      let seed = 7 + i * 101; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
      const spread = Math.min(band * 0.32, 60);
      g.x.forEach(v => s += `<circle cx="${(cx(i) + (rnd() - .5) * 2 * spread).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="2.5" fill="${COL.point}" fill-opacity=".45"/>`);
    });
    if (opts.connect) s += `<polyline points="${groups.map((g, i) => cx(i) + ',' + sy(g.mean)).join(' ')}" fill="none" stroke="${COL.s[0]}" stroke-width="2"/>`;
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
    const W = 640, H = 320, m = { l: 48, r: 12, t: 16, b: 44 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const yt = ticks(0, Math.max(...pct.flat()), 5), yMax = yt[yt.length - 1], sy = v => m.t + ph - v / yMax * ph;
    const band = pw / rowLv.length, inner = band * 0.8, bw = inner / colLv.length;
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
  const legend = items => `<div class="legend">${items.map((t, j) => `<span><i style="background:${COL.s[j]}"></i>${esc(t)}</span>`).join('')}</div>`;

  function scatter(x, y, xlabel, ylabel, opts = {}) {
    const W = 640, H = 340, m = { l: 56, r: 16, t: 16, b: 44 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xt = ticks(Math.min(...x), Math.max(...x), 6), yt = ticks(Math.min(...y), Math.max(...y), 5);
    const sx = v => m.l + (v - xt[0]) / (xt[xt.length - 1] - xt[0]) * pw, sy = v => m.t + ph - (v - yt[0]) / (yt[yt.length - 1] - yt[0]) * ph;
    let s = svgOpen(W, H, `${ylabel} frente a ${xlabel}`) + yAxis(yt, sy, m.l, W - m.r);
    xt.forEach(v => s += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(v)}</text>`);
    if (opts.zero && yt[0] < 0 && yt[yt.length - 1] > 0) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" stroke="${COL.axis}" stroke-dasharray="4 4"/>`;
    x.forEach((v, i) => s += `<circle cx="${sx(v).toFixed(1)}" cy="${sy(y[i]).toFixed(1)}" r="4" fill="${COL.s[0]}" fill-opacity=".55" stroke="${COL.surface}" stroke-width="1"><title>${fmt(v)}, ${fmt(y[i])}</title></circle>`);
    if (opts.line) { const [a, b] = opts.line, x0 = xt[0], x1 = xt[xt.length - 1];
      s += `<line x1="${sx(x0)}" x2="${sx(x1)}" y1="${sy(a + b * x0)}" y2="${sy(a + b * x1)}" stroke="${COL.s[1]}" stroke-width="2" clip-path="none"/>`; }
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${COL.axis}"/>`;
    s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(xlabel, 60))}</text>`;
    s += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">${esc(trunc(ylabel, 40))}</text>`;
    return s + '</svg>';
  }

  // gráfico de interacción: una línea por nivel de B a lo largo de los niveles de A
  function interaction(levelsA, series, ylabel) {
    const W = 640, H = 340, m = { l: 56, r: 16, t: 16, b: 48 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const all = series.flatMap(s => s.ci.flat()), yt = ticks(Math.min(...all), Math.max(...all), 5), y0 = yt[0], y1 = yt[yt.length - 1];
    const sy = v => m.t + ph - (v - y0) / (y1 - y0) * ph, band = pw / levelsA.length, off = j => (j - (series.length - 1) / 2) * 10;
    const cx = (i, j) => m.l + band * i + band / 2 + off(j);
    let s = svgOpen(W, H, 'Gráfico de interacción de ' + ylabel) + yAxis(yt, sy, m.l, W - m.r);
    series.forEach((se, j) => {
      s += `<polyline points="${se.means.map((v, i) => cx(i, j) + ',' + sy(v)).join(' ')}" fill="none" stroke="${COL.s[j]}" stroke-width="2"/>`;
      se.means.forEach((v, i) => { const x = cx(i, j);
        s += `<g><title>${esc(levelsA[i])} · ${esc(se.name)}: M = ${v.toFixed(2)}, IC 95 % [${se.ci[i][0].toFixed(2)}, ${se.ci[i][1].toFixed(2)}]</title><line x1="${x}" x2="${x}" y1="${sy(se.ci[i][0])}" y2="${sy(se.ci[i][1])}" stroke="${COL.s[j]}" stroke-width="2"/><circle cx="${x}" cy="${sy(v)}" r="5" fill="${COL.s[j]}" stroke="${COL.surface}" stroke-width="2"/></g>`; });
    });
    levelsA.forEach((l, i) => s += `<text x="${m.l + band * i + band / 2}" y="${H - m.b + 18}" text-anchor="middle" fill="${COL.text}">${esc(trunc(l, 22))}</text>`);
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${COL.axis}"/>`;
    s += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">${esc(trunc(ylabel, 40))}</text>`;
    return s + '</svg>';
  }

  // forest plot de odds ratios (escala logarítmica)
  function forest(labels, ors, cis) {
    const rowH = 30, m = { l: 210, r: 24, t: 14, b: 40 }, W = 640, H = m.t + m.b + rowH * labels.length, pw = W - m.l - m.r;
    const lo = Math.min(.5, ...cis.map(c => c[0])), hi = Math.max(2, ...cis.map(c => c[1]));
    const L0 = Math.log(lo), L1 = Math.log(hi), sx = v => m.l + (Math.log(v) - L0) / (L1 - L0) * pw;
    const cand = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].filter(v => v >= lo && v <= hi);
    let s = svgOpen(W, H, 'Odds ratios e intervalos de confianza');
    cand.forEach(v => s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${m.t}" y2="${H - m.b}" stroke="${v === 1 ? COL.axis : COL.grid}"${v === 1 ? ' stroke-dasharray="4 4"' : ''}/><text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${v}</text>`);
    labels.forEach((l, i) => { const y = m.t + i * rowH + rowH / 2, c = cis[i].map(v => Math.min(hi, Math.max(lo, v)));
      s += `<text x="${m.l - 10}" y="${y + 4}" text-anchor="end" fill="${COL.text}">${esc(trunc(l, 30))}</text>`;
      s += `<g><title>${esc(l)}: OR = ${ors[i].toFixed(2)}, IC 95 % [${cis[i][0].toFixed(2)}, ${cis[i][1].toFixed(2)}]</title><line x1="${sx(c[0])}" x2="${sx(c[1])}" y1="${y}" y2="${y}" stroke="${COL.text}" stroke-width="2"/><circle cx="${sx(Math.min(hi, Math.max(lo, ors[i])))}" cy="${y}" r="6" fill="${COL.s[0]}" stroke="${COL.surface}" stroke-width="2"/></g>`; });
    s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${COL.axis}">Odds ratio (escala logarítmica) · 1 = sin efecto</text>`;
    return s + '</svg>';
  }

  // gráfico de sedimentación: autovalores observados frente al percentil 95 del análisis paralelo
  function scree(obs, ref) {
    const W = 640, H = 320, m = { l: 48, r: 16, t: 16, b: 44 }, pw = W - m.l - m.r, ph = H - m.t - m.b, k = obs.length;
    const yt = ticks(0, Math.max(...obs, ...(ref || [0]), 1), 5), sx = i => m.l + (k === 1 ? pw / 2 : i / (k - 1) * pw), sy = v => m.t + ph - v / yt[yt.length - 1] * ph;
    let s = svgOpen(W, H, 'Gráfico de sedimentación') + yAxis(yt, sy, m.l, W - m.r);
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(1)}" y2="${sy(1)}" stroke="${COL.axis}" stroke-dasharray="2 4" stroke-opacity=".6"><title>Autovalor = 1</title></line>`;
    const path = (v, col, dash) => `<polyline points="${v.map((y, i) => sx(i).toFixed(1) + ',' + sy(y).toFixed(1)).join(' ')}" fill="none" stroke="${col}" stroke-width="2"${dash ? ' stroke-dasharray="6 5"' : ''}/>`;
    if (ref) { s += path(ref, COL.s[1], true); ref.forEach((y, i) => s += `<circle cx="${sx(i).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="3" fill="${COL.s[1]}"><title>Aleatorio (p95), ${i + 1}: ${fmt(y)}</title></circle>`); }
    s += path(obs, COL.s[0]); obs.forEach((y, i) => s += `<circle cx="${sx(i).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="4.5" fill="${COL.s[0]}" stroke="${COL.surface}" stroke-width="1.5"><title>Factor ${i + 1}: autovalor ${fmt(y)}</title></circle>`);
    obs.forEach((_, i) => { if (k <= 15 || i % 2 === 0) s += `<text x="${sx(i)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${i + 1}</text>`; });
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${COL.axis}"/>`;
    s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${COL.axis}">Factor</text><text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${COL.axis}">Autovalor</text>`;
    return s + '</svg>';
  }
  root.TharpCharts = { scree, histogram, barsCat, meansCI, groupedBars, scatter, interaction, forest, legend, COL, esc };
})(window);
