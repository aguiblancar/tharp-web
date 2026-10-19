/* Tharp · aplicación · Gráficos SVG de distribución: histograma, barras, cajas, nube de lluvia y Q-Q */
import S from '../motor/index.js';
import { maxOf, minOf } from './utilidades.js';
import { COL, esc, fmt, niceStep, svgOpen, ticks, trunc, vbar, yAxis } from './graficos-base.js';

function hbar(x0, y, w, h, fill, title) {
  const r = Math.min(4, h / 2, w),
    x1 = x0 + w;
  const d = `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
  return `<path d="${d}" fill="${fill}"><title>${esc(title)}</title></path>`;
}
function histogram(values, label) {
  const W = 360,
    H = 220,
    m = { l: 42, r: 12, t: 12, b: 34 },
    n = values.length;
  const uniq = [...new Set(values)].sort((a, b) => a - b);
  let bins;
  if (uniq.length <= 12)
    bins = uniq.map(v => ({ lo: v, hi: v, c: values.filter(x => x === v).length, discrete: true }));
  else {
    const min = uniq[0],
      max = uniq[uniq.length - 1],
      step = niceStep(max - min, Math.min(30, Math.ceil(Math.log2(n) + 1)));
    const start = Math.floor(min / step) * step;
    bins = [];
    for (let lo = start; lo <= max; lo += step) bins.push({ lo: +lo.toFixed(10), hi: +(lo + step).toFixed(10), c: 0 });
    values.forEach(v => {
      const k = Math.min(bins.length - 1, Math.floor((v - start) / step));
      bins[k].c++;
    });
  }
  const maxC = maxOf(bins.map(b => b.c)),
    yt = ticks(0, maxC, 4),
    yMax = yt[yt.length - 1];
  const pw = W - m.l - m.r,
    ph = H - m.t - m.b,
    sy = v => m.t + ph - (v / yMax) * ph,
    bw = pw / bins.length;
  let s = svgOpen(W, H, 'Histograma de ' + label) + yAxis(yt, sy, m.l, W - m.r);
  bins.forEach((b, i) => {
    const x = m.l + i * bw + 1,
      w = Math.max(1, bw - 2),
      rng = b.discrete ? fmt(b.lo) : `${fmt(b.lo)} – ${fmt(b.hi)}`;
    if (b.c) s += vbar(x, sy(b.c), w, sy(0), COL.s[0], `${rng}: ${b.c} casos`);
  });
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" stroke="${COL.axis}"/>`;
  if (bins[0].discrete)
    bins.forEach((b, i) => {
      if (bins.length <= 8 || i % 2 === 0)
        s += `<text x="${m.l + i * bw + bw / 2}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(b.lo)}</text>`;
    });
  else {
    const lo = bins[0].lo,
      hi = bins[bins.length - 1].hi,
      sx = v => m.l + ((v - lo) / (hi - lo)) * pw;
    ticks(lo, hi, 5)
      .filter(v => v >= lo && v <= hi)
      .forEach(
        v => (s += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(v)}</text>`)
      );
  }
  s += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(label, 40))}</text>`;
  return s + '</svg>';
}
function barsCat(levels, counts, label) {
  const rowH = 26,
    m = { l: 120, r: 60, t: 8, b: 8 },
    W = 360,
    H = m.t + m.b + rowH * levels.length;
  const max = maxOf(counts),
    total = counts.reduce((a, b) => a + b, 0),
    pw = W - m.l - m.r;
  let s = svgOpen(W, H, 'Frecuencias de ' + label);
  levels.forEach((lv, i) => {
    const y = m.t + i * rowH + 4,
      w = Math.max(1, (counts[i] / max) * pw),
      pct = ((counts[i] / total) * 100).toFixed(1);
    s += `<text x="${m.l - 8}" y="${y + 13}" text-anchor="end" fill="${COL.text}">${esc(trunc(lv, 16))}</text>`;
    s += hbar(m.l, y, w, rowH - 8, COL.s[0], `${lv}: ${counts[i]} (${pct} %)`);
    s += `<text x="${m.l + w + 6}" y="${y + 13}" fill="${COL.axis}">${counts[i]}</text>`;
  });
  return s + `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}" stroke="${COL.axis}"/></svg>`;
}
// diagrama de caja de Tukey: caja = cuartiles (tipo 7 de R), bigotes hasta el dato más extremo dentro de 1.5·RIC, atípicos como puntos
function boxplot(groups, label) {
  const q = (s, p) => {
    const h = (s.length - 1) * p,
      lo = Math.floor(h),
      hi = Math.min(lo + 1, s.length - 1);
    return s[lo] + (h - lo) * (s[hi] - s[lo]);
  };
  const st = groups.map(g => {
    const s = g.x.slice().sort((a, b) => a - b),
      q1 = q(s, 0.25),
      q3 = q(s, 0.75),
      md = q(s, 0.5),
      iqr = q3 - q1,
      lo = q1 - 1.5 * iqr,
      hi = q3 + 1.5 * iqr;
    const inn = s.filter(v => v >= lo && v <= hi);
    return {
      name: g.name,
      q1,
      q3,
      md,
      wlo: inn[0],
      whi: inn[inn.length - 1],
      out: s.filter(v => v < lo || v > hi),
      n: s.length,
    };
  });
  const all = groups.flatMap(g => g.x),
    yt = ticks(minOf(all), maxOf(all), 5),
    y0 = yt[0],
    y1 = yt[yt.length - 1];
  const W = Math.max(260, 70 + groups.length * 70),
    H = 240,
    m = { l: 46, r: 12, t: 12, b: 40 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b,
    sy = v => m.t + ph - ((v - y0) / (y1 - y0)) * ph,
    bw = pw / groups.length;
  let s = svgOpen(W, H, 'Diagrama de caja de ' + label) + yAxis(yt, sy, m.l, W - m.r);
  st.forEach((g, i) => {
    const cx = m.l + bw * (i + 0.5),
      w = Math.min(46, bw * 0.5),
      col = COL.s[i % COL.s.length];
    s +=
      `<line x1="${cx}" x2="${cx}" y1="${sy(g.whi)}" y2="${sy(g.q3)}" stroke="${COL.axis}"/><line x1="${cx}" x2="${cx}" y1="${sy(g.q1)}" y2="${sy(g.wlo)}" stroke="${COL.axis}"/>` +
      `<line x1="${cx - w / 4}" x2="${cx + w / 4}" y1="${sy(g.whi)}" y2="${sy(g.whi)}" stroke="${COL.axis}"/><line x1="${cx - w / 4}" x2="${cx + w / 4}" y1="${sy(g.wlo)}" y2="${sy(g.wlo)}" stroke="${COL.axis}"/>` +
      `<rect x="${cx - w / 2}" y="${sy(g.q3)}" width="${w}" height="${Math.max(1, sy(g.q1) - sy(g.q3))}" fill="${col}" fill-opacity=".25" stroke="${col}" rx="3"><title>${esc(g.name)}: Q1 = ${fmt(g.q1)}, Mdn = ${fmt(g.md)}, Q3 = ${fmt(g.q3)} (n = ${g.n})</title></rect>` +
      `<line x1="${cx - w / 2}" x2="${cx + w / 2}" y1="${sy(g.md)}" y2="${sy(g.md)}" stroke="${col}" stroke-width="2.5"/>` +
      g.out
        .map(
          v =>
            `<circle cx="${cx}" cy="${sy(v)}" r="3" fill="none" stroke="${COL.axis}"><title>Atípico: ${fmt(v)}</title></circle>`
        )
        .join('') +
      (groups.length > 1
        ? `<text x="${cx}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(g.name, 12))}</text>`
        : '');
  });
  s += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(label, 40))}</text>`;
  return s + '</svg>';
}
// nube de lluvia (raincloud) o violín por grupo: densidad, caja estrecha (Q1, mediana, Q3) y, en la nube, los puntos individuales
function raincloud(groups, label, kind = 'rain') {
  const st = groups.filter(g => g.x.length >= 2).map(g => ({ name: g.name, x: g.x, k: S.kde(g.x) }));
  if (!st.length) return '';
  const all = st.flatMap(g => g.x),
    yt = ticks(minOf(all), maxOf(all), 5),
    y0 = yt[0],
    y1 = yt[yt.length - 1];
  const W = Math.max(300, 70 + st.length * 110),
    H = 280,
    m = { l: 46, r: 12, t: 12, b: 40 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b,
    sy = v => m.t + ph - ((v - y0) / (y1 - y0)) * ph,
    bw = pw / st.length;
  const dmax = Math.max(...st.map(g => Math.max(...g.k.pts.map(p => p[1])))),
    MAXP = 800;
  let s =
    svgOpen(W, H, (kind === 'rain' ? 'Gráfico de nube de lluvia de ' : 'Gráfico de violín de ') + label) +
    yAxis(yt, sy, m.l, W - m.r);
  st.forEach((g, i) => {
    const col = COL.s[i % COL.s.length],
      half = Math.min(bw * 0.42, 60),
      cx = kind === 'rain' ? m.l + bw * i + bw * 0.42 : m.l + bw * (i + 0.5),
      sc = d => (d / dmax) * half;
    const P = g.k.pts,
      right = P.map(([y, d]) => `${kind === 'rain' ? cx - sc(d) : cx + sc(d)},${sy(y)}`);
    const path =
      kind === 'rain'
        ? `M${cx},${sy(P[0][0])} L${right.join(' L')} L${cx},${sy(P[P.length - 1][0])} Z`
        : `M${right.join(' L')} L${P.slice()
            .reverse()
            .map(([y, d]) => `${cx - sc(d)},${sy(y)}`)
            .join(' L')} Z`;
    s += `<path d="${path}" fill="${col}" fill-opacity=".28" stroke="${col}" stroke-width="1.2"><title>${esc(g.name)}: densidad (ancho de banda ${fmt(g.k.bw)}; n = ${g.k.n})</title></path>`;
    const bx = kind === 'rain' ? cx + 8 : cx,
      w = 9;
    s += `<rect x="${bx - w / 2}" y="${sy(g.k.q3)}" width="${w}" height="${Math.max(1, sy(g.k.q1) - sy(g.k.q3))}" fill="${COL.surface}" stroke="${COL.text}"><title>${esc(g.name)}: Q1 = ${fmt(g.k.q1)}, Mdn = ${fmt(g.k.md)}, Q3 = ${fmt(g.k.q3)}</title></rect><line x1="${bx - w / 2}" x2="${bx + w / 2}" y1="${sy(g.k.md)}" y2="${sy(g.k.md)}" stroke="${COL.text}" stroke-width="2"/>`;
    if (kind === 'rain') {
      const step = Math.max(1, Math.ceil(g.x.length / MAXP)),
        x0 = cx + 18,
        spread = Math.max(10, Math.min(bw * 0.4, 50));
      g.x.forEach((v, j) => {
        if (j % step) return;
        const h = Math.sin((j + 1) * 12.9898 + i * 78.233) * 43758.5453,
          jit = h - Math.floor(h);
        s += `<circle cx="${(x0 + jit * spread).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="2.2" fill="${col}" fill-opacity=".55"/>`;
      });
    }
    if (st.length > 1)
      s += `<text x="${m.l + bw * (i + 0.5)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(g.name, 14))}</text>`;
  });
  s += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" fill="${COL.axis}">${esc(trunc(label, 40))}</text>`;
  return s + '</svg>';
}
// gráfico Q-Q normal: cuantiles observados frente a los teóricos (posiciones de Blom, como qqnorm de R con n > 10)
function qqplot(values, label, ninv) {
  const s = values.slice().sort((a, b) => a - b),
    n = s.length,
    a = n <= 10 ? 3 / 8 : 0.5,
    th = s.map((_, i) => ninv((i + 1 - a) / (n + 1 - 2 * a)));
  const mean = s.reduce((x, y) => x + y, 0) / n,
    sd = Math.sqrt(s.reduce((x, y) => x + (y - mean) ** 2, 0) / (n - 1));
  const W = 300,
    H = 240,
    m = { l: 46, r: 12, t: 12, b: 40 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b;
  const xt = ticks(minOf(th), maxOf(th), 5),
    yt = ticks(s[0], s[n - 1], 5),
    sx = v => m.l + ((v - xt[0]) / (xt[xt.length - 1] - xt[0])) * pw,
    sy = v => m.t + ph - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * ph;
  let o = svgOpen(W, H, 'Gráfico Q-Q de ' + label) + yAxis(yt, sy, m.l, W - m.r);
  const x0 = xt[0],
    x1 = xt[xt.length - 1];
  o += `<line x1="${sx(x0)}" x2="${sx(x1)}" y1="${sy(mean + sd * x0)}" y2="${sy(mean + sd * x1)}" stroke="${COL.s[1]}" stroke-width="1.5"/>`;
  s.forEach((v, i) => {
    o += `<circle cx="${sx(th[i])}" cy="${sy(v)}" r="2.4" fill="${COL.s[0]}" fill-opacity=".7"/>`;
  });
  xt.forEach(v => {
    o += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="${COL.axis}">${fmt(v)}</text>`;
  });
  o += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" fill="${COL.axis}">Cuantil teórico normal</text>`;
  return o + '</svg>';
}

export { histogram, barsCat, boxplot, raincloud, qqplot };
