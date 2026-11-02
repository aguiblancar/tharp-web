/* Tharp · portada: el análisis en vivo con los datos de ejemplo (gráfico, pasos y tabla APA), la tabla de validación
   contra R, el traspaso del archivo a la aplicación y los datos de versión del pie */
import S from '../motor/index.js';
import demoData from '../comun/demo.js';
import validacion from '../comun/validacion.js';
import TharpVersion from '../comun/version.js';

document.querySelectorAll('[data-tharp]').forEach(e => {
  if (TharpVersion[e.dataset.tharp]) e.textContent = TharpVersion[e.dataset.tharp];
});

(function () {
  const rows = demoData(),
    H = rows[0],
    R = rows.slice(1),
    col = n => R.map(r => r[H.indexOf(n)]);
  const neg = s => s.replace(/^-/, '−'),
    f = (x, d = 2) => neg(x.toFixed(d)),
    nz = s => neg(s.replace(/^(-?)0\./, '$1.')),
    pv = p => (p < 0.001 ? '< .001' : '= ' + nz(p.toFixed(3))),
    pc = p => (p < 0.001 ? '< .001' : nz(p.toFixed(3)));
  const ok = '<svg class="i"><use href="#i-ok"/></svg>';
  const narrow = matchMedia('(max-width: 560px)');
  const by = (y, g) => {
    const Y = col(y),
      G = col(g),
      lv = [...new Set(G)].sort();
    return { lv, groups: lv.map(l => Y.filter((v, i) => G[i] === l && v !== null)) };
  };
  const tbl = (cap, head, body) =>
    `<div class="tw"><table class="apa"><caption>${cap}</caption><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => (typeof c === 'object' ? `<td class="key">${c.v}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
  const sig = (p, yes, no) => (p < 0.05 ? yes : no);
  const normal = sw => sw.every(t => t.p >= 0.05);

  // cada pregunta: calculada con el motor de Tharp; lo que se dice depende de los resultados
  const Q = {
    anova() {
      const { lv, groups } = by('ansiedad_post', 'grupo'),
        a = S.anova(groups),
        tk = S.tukeyHSD(groups, a.msw, a.df2),
        lev = S.levene(groups),
        sw = groups.map(g => S.shapiro(g));
      const nOk = normal(sw),
        vOk = lev.p >= 0.05,
        pairs = tk.filter(c => c.padj < 0.05).map(c => `${lv[c.i]} y ${lv[c.j]}`),
        n = groups.reduce((t, g) => t + g.length, 0);
      return {
        xname: 'ansiedad_post',
        title: `ansiedad_post según grupo · ${n} casos`,
        series: lv.map((l, i) => ({ name: l, v: groups[i] })),
        chk: [
          ['Normalidad', `Shapiro-Wilk ${nOk ? ok : '✗'}`],
          ['Varianzas', `Levene ${vOk ? ok : '✗'}`],
          ['Prueba', nOk && vOk ? 'ANOVA + Tukey' : !nOk ? 'Kruskal-Wallis' : 'Welch + Games-Howell'],
          ['Efecto', `η² = ${nz(a.eta2.toFixed(3))}`],
        ],
        table: tbl(
          '<b>Tabla 1</b><i>ANOVA de un factor para ansiedad_post según el grupo</i>',
          ['Fuente', '<i>gl</i>', '<i>F</i>', '<i>p</i>', 'η²'],
          [
            ['Grupo', a.df1, { v: f(a.F) }, pc(a.p), nz(a.eta2.toFixed(3))],
            ['Error', a.df2, '', '', ''],
          ]
        ),
        text: `${sig(a.p, 'Se encontraron diferencias estadísticamente significativas', 'No se encontraron diferencias estadísticamente significativas')} en ansiedad_post según el grupo, <mark><i>F</i>(${a.df1}, ${a.df2}) = ${f(a.F)}, <i>p</i> ${pv(a.p)}, η² = ${nz(a.eta2.toFixed(3))}</mark>${pairs.length ? `. Las comparaciones de Tukey mostraron diferencias entre ${pairs.join(', ')}` : ''}.`,
      };
    },
    t() {
      const { lv, groups } = by('ansiedad_pre', 'sexo'),
        lev = S.levene(groups),
        eq = lev.p >= 0.05,
        r = S.tTestInd(groups[0], groups[1], eq),
        d = groups.map(g => S.describe(g)),
        sw = groups.map(g => S.shapiro(g));
      const nOk = normal(sw),
        dir = r.diff < 0 ? 'más bajas' : 'más altas',
        gl = Number.isInteger(r.df) ? r.df : f(r.df);
      return {
        xname: 'ansiedad_pre',
        title: `ansiedad_pre según sexo · ${groups[0].length + groups[1].length} casos`,
        series: lv.map((l, i) => ({ name: l, v: groups[i] })),
        chk: [
          ['Normalidad', `Shapiro-Wilk ${nOk ? ok : '✗'}`],
          ['Varianzas', `Levene ${eq ? ok : '✗'}`],
          ['Prueba', nOk ? (eq ? 't de Student' : 't de Welch') : 'Mann-Whitney'],
          ['Efecto', `<i>d</i> = ${f(r.d)}`],
        ],
        table: narrow.matches
          ? tbl(
              '<b>Tabla 1</b><i>Prueba t para muestras independientes</i>',
              ['Comparación', '<i>t</i>', '<i>gl</i>', '<i>p</i>', '<i>d</i>'],
              [[`${lv[0]} − ${lv[1]}`, { v: f(r.t) }, gl, pc(r.p), f(r.d)]]
            )
          : tbl(
              '<b>Tabla 1</b><i>Prueba t para muestras independientes</i>',
              ['Comparación', '<i>t</i>', '<i>gl</i>', '<i>p</i>', '<i>d</i>', 'IC&nbsp;95&nbsp;% (<i>d</i>)'],
              [[`${lv[0]} − ${lv[1]}`, { v: f(r.t) }, gl, pc(r.p), f(r.d), `[${f(r.dCI[0])}, ${f(r.dCI[1])}]`]]
            ),
        text: `${lv[0]} (<i>M</i> = ${f(d[0].mean)}, <i>DT</i> = ${f(d[0].sd)}) ${sig(r.p, `obtuvo puntuaciones significativamente ${dir} que`, 'no difirió significativamente de')} ${lv[1]} (<i>M</i> = ${f(d[1].mean)}, <i>DT</i> = ${f(d[1].sd)}), <mark><i>t</i>(${gl}) = ${f(r.t)}, <i>p</i> ${pv(r.p)}, <i>d</i> = ${f(r.d)}</mark>, IC&nbsp;95&nbsp;% [${f(r.dCI[0])}, ${f(r.dCI[1])}].`,
      };
    },
    rho() {
      const X = col('ansiedad_pre'),
        Y = col('ansiedad_post'),
        m = X.map((v, i) => v !== null && Y[i] !== null),
        x = X.filter((_, i) => m[i]),
        y = Y.filter((_, i) => m[i]);
      const sx = S.shapiro(x),
        sy = S.shapiro(y),
        nOk = sx.p >= 0.05 && sy.p >= 0.05,
        r = nOk ? S.pearson(x, y) : S.spearman(x, y),
        sym = nOk ? '<i>r</i>' : '<i>r</i><sub>s</sub>';
      const fuerza = Math.abs(r.r) >= 0.5 ? 'fuerte' : Math.abs(r.r) >= 0.3 ? 'moderada' : 'débil',
        signo = r.r > 0 ? 'positiva' : 'negativa';
      return {
        title: `ansiedad_pre y ansiedad_post · ${x.length} casos`,
        scatter: { x, y },
        chk: [
          ['Normalidad', `Shapiro-Wilk ${nOk ? ok : '✗'}`],
          ['Casos', `${x.length} pares`],
          ['Prueba', nOk ? 'Pearson' : 'Spearman'],
          ['Efecto', `${sym} = ${nz(r.r.toFixed(2))}`],
        ],
        table: tbl(
          `<b>Tabla 1</b><i>Correlación de ${nOk ? 'Pearson' : 'Spearman'}</i>`,
          ['Par', sym, '<i>gl</i>', '<i>p</i>'],
          [['ansiedad_pre y ansiedad_post', { v: nz(r.r.toFixed(2)) }, r.df, pc(r.p)]]
        ),
        text: `Las variables ansiedad_pre y ansiedad_post mostraron una correlación ${signo} ${fuerza}${sig(r.p, '', ' no significativa')}, <mark>${sym}(${r.df}) = ${nz(r.r.toFixed(2))}, <i>p</i> ${pv(r.p)}</mark>.`,
      };
    },
  };

  const $ = id => document.getElementById(id);
  const sonar = $('sonar'),
    chk = $('chk'),
    paper = $('paper'),
    qb = [...document.querySelectorAll('.qsel button')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0,
    timers = [],
    cur = 'rho',
    O = null;
  const nb = h => h.replace(/ (=|<|&lt;|>|&gt;) /g, '&nbsp;$1&nbsp;').replace(/(\([\d.]+|\[[−\d.]+), /g, '$1,&nbsp;');
  const TONES = ['#e6f0ef', '#8fd3c4', '#f0a58f'],
    MARKS = [0.25, 0.5, 0.75, 0.995];

  // los datos tal cual: cada caso es un sondeo; cada grupo, un perfil (densidad de núcleo gaussiano)
  function draw() {
    const W = sonar.clientWidth,
      H = sonar.clientHeight,
      top = O.series ? (W < 640 ? 38 : 30) : 22,
      bot = 46,
      px = 22,
      o = O;
    let g = '';
    const ticks = (a, b, X, name) => {
      const raw = (b - a) / 6,
        m = Math.pow(10, Math.floor(Math.log10(raw))),
        st = [1, 2, 5, 10].map(k => k * m).find(k => k >= raw);
      let t = '';
      for (let v = Math.ceil(a / st) * st; v <= b; v += st) {
        const x = X(v);
        if (x > W - px - 120) continue;
        t += `<line class="tk" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${H - 14}" y2="${H - 10}"/><text class="lab tick" text-anchor="middle" x="${x.toFixed(1)}" y="${H - 1}">${neg(String(+v.toFixed(1)))}</text>`;
      }
      return t + `<text class="lab tick" text-anchor="end" x="${W - px}" y="${H - 1}">${name}</text>`;
    };
    if (o.series) {
      const all = o.series.flatMap(s => s.v),
        lo = Math.min(...all),
        hi = Math.max(...all),
        span = hi - lo || 1,
        a = lo - span * 0.04,
        b = hi + span * 0.04;
      const X = v => px + ((v - a) / (b - a)) * (W - 2 * px),
        xs = Array.from({ length: 140 }, (_, i) => a + ((b - a) * i) / 139);
      const dens = o.series.map(s => {
        const d = S.describe(s.v),
          h = 1.06 * d.sd * Math.pow(s.v.length, -0.2);
        return xs.map(x => s.v.reduce((t, v) => t + Math.exp(-0.5 * ((x - v) / h) ** 2), 0) / (s.v.length * h));
      });
      const mx = Math.max(...dens.flat()),
        Yd = d => H - bot - (d / mx) * (H - top - bot);
      dens.forEach((d, k) => {
        const pts = d.map((y, i) => `${X(xs[i]).toFixed(1)},${Yd(y).toFixed(1)}`).join(' L');
        g += `<path class="ar" fill="${TONES[k]}" fill-opacity=".07" d="M${X(a).toFixed(1)},${H - bot} L${pts} L${X(b).toFixed(1)},${H - bot} Z"/><path class="cv" stroke="${TONES[k]}" d="M${pts}"/>`;
      });
      g += ticks(a, b, X, o.xname);
      o.series.forEach((s, k) => {
        const y0 = H - bot + 6 + k * 6;
        g += `<path class="rug" stroke="${TONES[k]}" stroke-opacity=".55" d="${s.v.map(v => `M${X(v).toFixed(1)},${y0}v4`).join('')}"/>`;
      });
      g += `<text class="lab sm" text-anchor="end" x="${W - px}" y="14" xml:space="preserve">${o.series.map((s, k) => `<tspan fill="${TONES[k]}">— ${s.name}</tspan>`).join('   ')}${W < 640 ? '' : '   · cada marca es un caso'}</text>`;
    } else {
      const { x, y } = o.scatter,
        ax = Math.min(...x),
        bx = Math.max(...x),
        ay = Math.min(...y),
        by2 = Math.max(...y);
      const X = v => px + 26 + ((v - ax) / (bx - ax)) * (W - 2 * px - 26),
        Y = v => H - bot + 14 - ((v - ay) / (by2 - ay)) * (H - top - bot + 8);
      g += x
        .map(
          (v, i) => `<circle class="pt" r="1.7" fill="${TONES[0]}" cx="${X(v).toFixed(1)}" cy="${Y(y[i]).toFixed(1)}"/>`
        )
        .join('');
      const mxv = x.reduce((t, v) => t + v, 0) / x.length,
        myv = y.reduce((t, v) => t + v, 0) / y.length;
      let sxy = 0,
        sxx = 0;
      x.forEach((v, i) => {
        sxy += (v - mxv) * (y[i] - myv);
        sxx += (v - mxv) ** 2;
      });
      const bb = sxy / sxx,
        aa = myv - bb * mxv;
      g +=
        `<path class="fit" d="M${X(ax).toFixed(1)},${Y(aa + bb * ax).toFixed(1)} L${X(bx).toFixed(1)},${Y(aa + bb * bx).toFixed(1)}"/>` +
        ticks(ax, bx, X, 'ansiedad_pre') +
        (() => {
          const raw = (by2 - ay) / 4,
            m = Math.pow(10, Math.floor(Math.log10(raw))),
            st = [1, 2, 5, 10].map(k => k * m).find(k => k >= raw);
          let t = '';
          for (let v = Math.ceil(ay / st) * st; v <= by2; v += st) {
            const y = Y(v);
            if (y < 10 || y > H - bot + 10) continue;
            t += `<text class="lab tick" x="${px}" y="${(y + 4).toFixed(1)}">${neg(String(+v.toFixed(1)))}</text>`;
          }
          return t;
        })() +
        `<text class="lab sm" x="${px + 30}" y="${top - 6}">Vertical: ansiedad_post${W < 640 ? '' : '. Cada punto es un caso'}</text>`;
    }
    const mk = '';
    sonar.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><clipPath id="sw"><rect id="swr" x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>${mk}<g clip-path="url(#sw)">${g}</g><line class="scan" id="scan" x1="-9" x2="-9" y1="8" y2="${H}" opacity="0"/></svg>`;
    $('leg').innerHTML = '';
  }

  function setChk(n) {
    [...chk.children].forEach((c, i) => {
      const on = i < n;
      c.classList.toggle('on', on);
      c.querySelector('b').innerHTML = on
        ? nb(O.chk[i][1])
        : ['comprobando…', 'comprobando…', 'eligiendo…', 'calculando…'][i];
    });
    sonar.querySelectorAll('.mk').forEach((l, i) => l.classList.toggle('on', i < n));
  }
  function finish() {
    setChk(4);
    paper.classList.add('on');
    $('instState').textContent = 'Listo · calculado en este navegador';
    const sw = $('swr'),
      sc = $('scan');
    if (sw) sw.setAttribute('width', sonar.clientWidth);
    if (sc) sc.setAttribute('opacity', 0);
    timers.push(setTimeout(() => paper.classList.add('end'), reduce ? 0 : 450));
  }
  function play() {
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    timers = [];
    paper.classList.remove('on', 'end');
    draw();
    if (reduce) {
      finish();
      return;
    }
    $('instState').textContent = 'Analizando…';
    setChk(0);
    const W = sonar.clientWidth,
      sw = $('swr'),
      sc = $('scan'),
      D = 2600,
      t0 = performance.now();
    sc.setAttribute('opacity', 1);
    const step = t => {
      const k = Math.min(1, (t - t0) / D),
        e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2,
        x = W * e;
      sw.setAttribute('width', x);
      sc.setAttribute('x1', x);
      sc.setAttribute('x2', x);
      setChk(MARKS.filter(m => e >= m).length);
      if (k < 1) raf = requestAnimationFrame(step);
      else finish();
    };
    raf = requestAnimationFrame(step);
  }
  function render(k) {
    O = Q[k]();
    cur = k;
    qb.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.q === k)));
    $('instTitle').textContent = O.title;
    chk.innerHTML = O.chk.map((c, i) => `<div><span>${i + 1} · ${c[0]}</span><b></b></div>`).join('');
    paper.innerHTML = O.table + `<p class="prose">${nb(O.text)}</p>`;
    play();
  }
  qb.forEach(b =>
    b.addEventListener('click', () => {
      render(b.dataset.q);
      try {
        window.umami && window.umami.track('portada_pregunta', { prueba: b.textContent });
      } catch (e) {
        /* estadística opcional */
      }
    })
  );
  $('replay').addEventListener('click', play);
  render('rho');
  let lastNarrow = narrow.matches,
    rz;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (narrow.matches !== lastNarrow) {
        lastNarrow = narrow.matches;
        render(cur);
      } else if (paper.classList.contains('on')) {
        draw();
        setChk(4);
        $('swr').setAttribute('width', sonar.clientWidth);
        $('scan').setAttribute('opacity', 0);
      }
    }, 150);
  });

  // tu propio archivo: se guarda en este navegador (IndexedDB) y la aplicación lo abre sin volver a elegirlo
  const APP = 'app.html';
  const handoff = fl =>
    new Promise(res => {
      try {
        const rq = indexedDB.open('tharp', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('traspaso');
        rq.onsuccess = () => {
          const tx = rq.result.transaction('traspaso', 'readwrite');
          tx.objectStore('traspaso').put(fl, 'archivo');
          tx.oncomplete = () => res(true);
          tx.onerror = () => res(false);
        };
        rq.onerror = () => res(false);
      } catch (e) {
        res(false);
      }
    });
  const drop = $('drop'),
    file = $('file'),
    msg = $('dropMsg');
  function take(fl) {
    if (!fl) return;
    try {
      window.umami && window.umami.track('portada_analizar', { via: 'archivo' });
    } catch (e) {
      /* estadística opcional */
    }
    msg.textContent = `Abriendo «${fl.name}» en Tharp. El archivo no sale de este navegador.`;
    handoff(fl).then(okk => {
      location.href = APP + (okk ? '#importar' : '');
    });
  }
  file.addEventListener('change', () => take(file.files[0]));
  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.remove('over');
    })
  );
  drop.addEventListener('drop', e => take(e.dataTransfer.files[0]));

  // variables reconocidas (datos de ejemplo)
  $('vars').innerHTML = ['grupo', 'sexo', 'ansiedad_pre', 'ansiedad_post', 'horas_sueno', 'satisfaccion']
    .map(n => {
      const v = col(n),
        num = typeof v.find(x => x !== null) === 'number',
        miss = v.filter(x => x === null).length;
      if (!num) {
        const lv = [...new Set(v.filter(x => x !== null))].sort();
        return `<tr><td>${n}</td><td><span class="pill">categórica</span></td><td>${lv.length} categorías: ${lv.join(', ')}</td></tr>`;
      }
      const d = S.describe(v.filter(x => x !== null));
      return `<tr><td>${n}</td><td><span class="pill q">cuantitativa</span></td><td>${nb(`<i>M</i> = ${f(d.mean)}, <i>DT</i> = ${f(d.sd)}`)}${miss ? `; ${miss}&nbsp;perdidos` : ''}</td></tr>`;
    })
    .join('');

  // registro de validación: datos reales de la batería contra R
  (V => {
    const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
    $('vrows').innerHTML = V.map(
      (o, i) =>
        `<tr class="${i >= 8 ? 'more' : ''}" ${i >= 8 ? 'hidden' : ''}><td>${o.a}</td><td class="pk">${o.r}</td><td class="num"><span class="okmark">${ok}${fmt(o.ok)} / ${fmt(o.n)}</span></td></tr>`
    ).join('');
    const btn = $('showall');
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      document.querySelectorAll('#vrows tr.more').forEach(t => {
        t.hidden = open;
      });
      btn.setAttribute('aria-expanded', String(!open));
      btn.textContent = open ? `Ver los ${V.length} análisis` : 'Ver solo los principales';
    });
  })(validacion);
})();
