/* Tharp · aplicación · Calculadora de potencia y tamaño muestral (como el paquete pwr de R y G*Power) */
import S from '../motor/index.js';
import { esc } from './graficos.js';
import { f, fmtNum, nz } from './formato.js';
import { $, $$, track } from './utilidades.js';
import { mostrarError } from './avisos.js';

const PW = {
  't-ind': {
    es: 'd de Cohen',
    pre: [0.2, 0.5, 0.8],
    n: 'n por grupo',
    help: 'd = diferencia de medias / desviación típica. Si los grupos tienen tamaños distintos, indica la razón n₂/n₁.',
  },
  't-paired': {
    es: 'd<sub>z</sub> de Cohen',
    pre: [0.2, 0.5, 0.8],
    n: 'n (pares)',
    help: 'd<sub>z</sub> = media de las diferencias / desviación típica de las diferencias.',
  },
  't-one': {
    es: 'd de Cohen',
    pre: [0.2, 0.5, 0.8],
    n: 'n',
    help: 'd = (media − valor de referencia) / desviación típica.',
  },
  anova: {
    es: 'f de Cohen',
    pre: [0.1, 0.25, 0.4],
    n: 'n por grupo',
    k: 'Grupos',
    help: 'f = desviación típica de las medias de grupo / desviación típica dentro de los grupos (η² = f² / (1 + f²)).',
  },
  r: {
    es: 'r (correlación esperada)',
    pre: [0.1, 0.3, 0.5],
    n: 'n',
    help: 'Correlación de Pearson que se espera encontrar.',
  },
  reg: {
    es: 'f² de Cohen',
    pre: [0.02, 0.15, 0.35],
    n: 'N total',
    k: 'Predictores',
    help: 'f² = R² / (1 − R²). Por ejemplo, R² = .13 equivale a f² = .15.',
  },
  chi: {
    es: 'w de Cohen',
    pre: [0.1, 0.3, 0.5],
    n: 'N total',
    k: 'Grados de libertad',
    help: 'w = √(χ²/N). gl = (filas − 1)·(columnas − 1) en una tabla de contingencia, o categorías − 1 en bondad de ajuste.',
  },
  p2: {
    es: 'h de Cohen',
    pre: [0.2, 0.5, 0.8],
    n: 'n por grupo',
    help: 'h = 2·arcsen(√p₁) − 2·arcsen(√p₂). Por ejemplo, 50 % frente a 30 % da h ≈ .41.',
  },
};
const pwUI = () => {
  const t = $('#pwTest').value,
    c = PW[t],
    mode = $('#pwMode').value;
  $('#pwEsLab').innerHTML = c.es;
  $('#pwNLab').textContent = c.n;
  $('#pwHelp').innerHTML = c.help;
  $('#pwPresets').innerHTML = c.pre
    .map(
      (v, i) =>
        `<button class="btn btn-line btn-sm" data-pv="${v}">${['pequeño', 'mediano', 'grande'][i]} (${v})</button>`
    )
    .join('');
  $$('#pwPresets [data-pv]').forEach(
    b =>
      (b.onclick = () => {
        $('#pwEs').value = b.dataset.pv;
      })
  );
  $('#pwKW').classList.toggle('hidden', !c.k);
  if (c.k) $('#pwKLab').textContent = c.k;
  if (t === 'chi' && +$('#pwK').value < 1) $('#pwK').value = 1;
  $('#pwRatioW').classList.toggle('hidden', t !== 't-ind');
  $('#pwAltW').classList.toggle('hidden', ['anova', 'reg', 'chi'].includes(t));
  $('#pwNW').classList.toggle('hidden', mode !== 'power');
  $('#pwPowW').classList.toggle('hidden', mode === 'power');
};
const showPow = on => {
  $('#sPow').classList.toggle('hidden', !on);
  $('#s1').classList.toggle('hidden', on);
  $('#stepper').classList.toggle('hidden', on);
  if (on) {
    pwUI();
    window.scrollTo({ top: 0 });
  }
};

/** Valores del formulario */
function leerFormulario() {
  const t = $('#pwTest').value,
    num = id => parseFloat(String($('#' + id).value).replace(',', '.'));
  return {
    t,
    es: num('pwEs'),
    alpha: num('pwAlpha'),
    target: num('pwPow'),
    k: Math.round(num('pwK')),
    ratio: num('pwRatio'),
    nIn: Math.round(num('pwN')),
    alt: ['anova', 'reg', 'chi'].includes(t) ? 'two' : $('#pwAlt').value,
    mode: $('#pwMode').value,
  };
}

/** Mensaje de error si los valores no son válidos, o null */
function validar({ t, es, alpha, target, k, mode }) {
  const c = PW[t];
  if (!(es > 0)) return 'El tamaño del efecto debe ser mayor que 0.';
  if (!(alpha > 0 && alpha < 1)) return 'α debe estar entre 0 y 1 (habitualmente .05).';
  if (mode === 'n' && !(target > 0 && target < 1))
    return 'La potencia deseada debe estar entre 0 y 1 (habitualmente .80 o .90).';
  if (c.k && !(k >= 1)) return `Indica ${c.k.toLowerCase()} (un número entero).`;
  if (t === 'anova' && k < 2) return 'El ANOVA necesita al menos 2 grupos.';
  if (t === 'r' && es >= 1) return 'La correlación debe ser menor que 1.';
  return null;
}

/** Prueba del motor (S.power / S.sampleSize) y sus argumentos */
function argumentosPrueba({ t, es, k, ratio, alpha, alt }) {
  const [test, args] = t.startsWith('t-')
    ? [
        't',
        {
          d: es,
          type: { 't-ind': 'ind', 't-paired': 'paired', 't-one': 'one' }[t],
          ratio: t === 't-ind' ? ratio || 1 : 1,
        },
      ]
    : t === 'anova'
      ? ['anova', { f: es, k }]
      : t === 'r'
        ? ['r', { r: es }]
        : t === 'reg'
          ? ['reg', { f2: es, u: k }]
          : t === 'chi'
            ? ['chi', { w: es, df: k }]
            : ['p2', { h: es }];
  return { test, args: Object.assign(args, { alpha, alt }), minN: t === 'reg' ? k + 2 : t === 'r' ? 4 : 2 };
}

/** Tamaño de cada grupo y texto del tamaño («n participantes por grupo…») */
function tamanos({ t, k, ratio }, n) {
  const perGroup = ['t-ind', 'anova', 'p2'].includes(t),
    n2 = t === 't-ind' ? Math.max(2, Math.round(n * (ratio || 1))) : n,
    total = t === 't-ind' ? n + n2 : t === 'anova' ? n * k : t === 'p2' ? 2 * n : n;
  const nTxt =
    t === 't-ind'
      ? n2 === n
        ? `${n} participantes por grupo (${total} en total)`
        : `${n} y ${n2} participantes en cada grupo (${total} en total)`
      : perGroup
        ? `${n} participantes por grupo (${total} en total)`
        : `${n} participantes`;
  return { n2, nTxt };
}

/** Redacción APA para el apartado de método */
function redaccion({ t, es, k, alpha, target, alt, mode }, nTxt, pw) {
  const testName = {
    't-ind': 'una prueba t para muestras independientes',
    't-paired': 'una prueba t para muestras relacionadas',
    't-one': 'una prueba t para una muestra',
    anova: `un ANOVA de un factor con ${k} grupos`,
    r: 'una correlación de Pearson',
    reg: `una regresión lineal múltiple con ${k} predictor${k > 1 ? 'es' : ''}`,
    chi: `una prueba χ² con ${k} grado${k > 1 ? 's' : ''} de libertad`,
    p2: 'una comparación de dos proporciones',
  }[t];
  const esTxt = `${PW[t].es.replace(/ de Cohen| \(correlación esperada\)/, '')} = ${t === 'r' ? nz(f(es)) : f(es)}`,
    sided = alt === 'two' ? '' : ' (unilateral)',
    A_ = nz(f(alpha)),
    P_ = nz(f(target)),
    PW_ = nz(f(pw, 3));
  return mode === 'n'
    ? `Se realizó un análisis de potencia a priori para ${testName}${sided}. Para detectar un efecto de ${esTxt} con un nivel de significación de α = ${A_} y una potencia de ${P_}, se necesitan ${nTxt}; con ese tamaño, la potencia alcanzada es de ${PW_}.`
    : `Se realizó un análisis de potencia para ${testName}${sided}. Con ${nTxt}, un nivel de significación de α = ${A_} y un efecto de ${esTxt}, la potencia es de ${PW_}${pw < 0.8 ? ', inferior al .80 recomendado habitualmente' : ''}.`;
}

/** Curva de potencia en función del tamaño muestral (SVG), con la potencia objetivo y el punto calculado */
function curvaPotencia({ test, args, minN }, n, pw, target, etiquetaN) {
  const nMax = Math.max(n * 2, minN + 10),
    pts = [];
  for (let q = 0; q <= 40; q++) {
    const nn = Math.max(minN, Math.round(minN + ((nMax - minN) * q) / 40));
    pts.push([nn, S.power(test, Object.assign({}, args, { n: nn }))]);
  }
  const W = 560,
    H = 230,
    X0 = 46,
    Y0 = 16,
    Wp = W - X0 - 14,
    Hp = H - Y0 - 34,
    sx = v => X0 + ((v - minN) / (nMax - minN)) * Wp,
    sy = v => Y0 + (1 - v) * Hp;
  return (
    `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px" role="img" aria-label="Curva de potencia">` +
    [0, 0.2, 0.4, 0.6, 0.8, 1]
      .map(
        v =>
          `<line x1="${X0}" x2="${X0 + Wp}" y1="${sy(v)}" y2="${sy(v)}" stroke="#e3e0d7"/><text x="${X0 - 6}" y="${sy(v) + 4}" text-anchor="end" font-size="11" fill="#5a6b7a">${v.toFixed(1)}</text>`
      )
      .join('') +
    `<line x1="${X0}" x2="${X0 + Wp}" y1="${sy(target || 0.8)}" y2="${sy(target || 0.8)}" stroke="#2bb3a6" stroke-dasharray="4 3"/>` +
    `<polyline fill="none" stroke="#0b2540" stroke-width="2.2" points="${pts.map(([a, b]) => `${sx(a).toFixed(1)},${sy(b).toFixed(1)}`).join(' ')}"/>` +
    `<circle cx="${sx(n)}" cy="${sy(pw)}" r="5" fill="#2bb3a6"/>` +
    [minN, Math.round((minN + nMax) / 2), nMax]
      .map(v => `<text x="${sx(v)}" y="${H - 14}" text-anchor="middle" font-size="11" fill="#5a6b7a">${v}</text>`)
      .join('') +
    `<text x="${X0 + Wp / 2}" y="${H - 1}" text-anchor="middle" font-size="11" fill="#5a6b7a">${esc(etiquetaN)}</text></svg>`
  );
}

/** Código R (paquete pwr) que reproduce el cálculo */
function codigoR({ t, es, k, ratio, alpha, target, alt, mode }, n, n2) {
  const rAlt = alt === 'two' ? '' : ', alternative = "greater"',
    rn_ = mode === 'n' ? '' : `n = ${n}, `,
    rp = mode === 'n' ? `, power = ${target}` : '';
  return {
    't-ind':
      (ratio || 1) !== 1
        ? `pwr::pwr.t2n.test(n1 = ${n}, n2 = ${n2}, d = ${es}, sig.level = ${alpha}${rAlt})`
        : `pwr::pwr.t.test(${rn_}d = ${es}, sig.level = ${alpha}${rp}, type = "two.sample"${rAlt})`,
    't-paired': `pwr::pwr.t.test(${rn_}d = ${es}, sig.level = ${alpha}${rp}, type = "paired"${rAlt})`,
    't-one': `pwr::pwr.t.test(${rn_}d = ${es}, sig.level = ${alpha}${rp}, type = "one.sample"${rAlt})`,
    anova: `pwr::pwr.anova.test(k = ${k}, ${rn_}f = ${es}, sig.level = ${alpha}${rp})`,
    r: `pwr::pwr.r.test(${rn_}r = ${es}, sig.level = ${alpha}${rp}${rAlt})`,
    reg: `pwr::pwr.f2.test(u = ${k}, ${mode === 'n' ? '' : `v = ${n - k - 1}, `}f2 = ${es}, sig.level = ${alpha}${rp})  # N = u + v + 1`,
    chi: `pwr::pwr.chisq.test(w = ${es}, ${mode === 'n' ? '' : `N = ${n}, `}df = ${k}, sig.level = ${alpha}${rp})`,
    p2: `pwr::pwr.2p.test(h = ${es}, ${rn_}sig.level = ${alpha}${rp}${rAlt})`,
  }[t];
}

/** Botón «Calcular»: valida, calcula la potencia o el tamaño y presenta el resultado */
function calcularPotencia() {
  const o = leerFormulario(),
    out = $('#pwOut'),
    err = m => mostrarError(out, m);
  const fallo = validar(o);
  if (fallo) return err(fallo);
  const prueba = argumentosPrueba(o),
    { test, args, minN } = prueba;
  const n = o.mode === 'n' ? S.sampleSize(test, args, o.target, minN) : o.nIn;
  if (!n || !(n >= minN))
    return err(
      o.mode === 'n'
        ? 'No se alcanza esa potencia con un tamaño razonable: revisa el tamaño del efecto.'
        : `El tamaño debe ser al menos ${minN}.`
    );
  const pw = S.power(test, Object.assign({}, args, { n })),
    { n2, nTxt } = tamanos(o, n),
    PW_ = nz(f(pw, 3));
  out.innerHTML = `<div class="res"><h2>${o.mode === 'n' ? 'Tamaño muestral necesario' : 'Potencia del estudio'}</h2>
    <p style="font-size:1.25rem;margin:8px 0">${o.mode === 'n' ? `<b>${nTxt.charAt(0).toUpperCase() + nTxt.slice(1)}</b>` : `<b>Potencia = ${PW_}</b>`}</p>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"><b>Redacción para el apartado de método</b><button class="btn btn-line btn-sm" id="pwCopy">Copiar texto</button></div>
    <div class="text" id="pwTxt"><p>${redaccion(o, nTxt, pw)}</p></div>
    <figure><figcaption><span>Potencia según el tamaño muestral (línea discontinua: potencia ${fmtNum(o.target || 0.8)})</span></figcaption>${curvaPotencia(prueba, n, pw, o.target, PW[o.t].n)}</figure>
    <p class="small muted">Prevé además las pérdidas: si esperas, por ejemplo, un 15 % de abandonos o cuestionarios incompletos, divide el tamaño entre 0.85. El tamaño del efecto debe justificarse con estudios previos o con el mínimo efecto de interés práctico, no elegirse para que salga un número cómodo.</p>
    <details><summary>Código R para reproducirlo</summary><pre>${esc(codigoR(o, n, n2))}</pre></details></div>`;
  $('#pwCopy').onclick = () =>
    navigator.clipboard.writeText($('#pwTxt').innerText).then(() => {
      $('#pwCopy').textContent = 'Copiado ✓';
      setTimeout(() => {
        $('#pwCopy').textContent = 'Copiar texto';
      }, 1500);
    });
  track('potencia', { prueba: o.t, modo: o.mode });
}

export { PW, pwUI, showPow, calcularPotencia };
