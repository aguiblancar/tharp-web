/* Tharp · aplicación · Paso 3: tarjeta de cada análisis (casilla, descripción y opciones) */
import { esc } from './graficos.js';
import { levelsOf, normTxt, numOf } from './datos/variables.js';
import { ST } from './estado.js';
import { chips, optChips, sel } from './controles.js';

/** Tarjeta de un análisis: casilla, título, descripción y opciones */
const card = (id, on, title, desc, cfg, disabled) =>
  `<div class="an${on && !disabled ? ' on' : ''}" data-an="${id}"><label><input type="checkbox"${on && !disabled ? ' checked' : ''}${disabled ? ' disabled' : ''}><span><b>${title}</b><span class="muted small">${disabled ? disabled : desc}</span></span></label><div class="cfg">${cfg}</div></div>`;
function tarjetaDesc({ nums, cats, facs }) {
  return card(
    'desc',
    true,
    'Estadísticos descriptivos y gráficos',
    'Media, desviación típica, mediana, asimetría y frecuencias, con histogramas y gráficos de barras.',
    `<div class="field"><span>Variables</span>${chips('desc', nums.concat(cats), () => true)}</div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Dividir por grupos (opcional)</span><select id="descG"><option value="">No</option>${facs.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label>
     <label class="field"><span>Gráfico de distribución</span><select id="descPlot"><option value="box">Diagrama de caja</option><option value="violin">Violín</option><option value="rain">Nube de lluvia (densidad, caja y datos)</option></select></label></div>`
  );
}
function tarjetaMiss({ nums }) {
  const withNA = nums.filter(v => numOf(v).some(x => x === null));
  return card(
    'miss',
    false,
    'Análisis de valores perdidos (MCAR de Little)',
    'Cuántos datos faltan en cada variable, qué patrones siguen y si faltan completamente al azar (prueba MCAR de Little), con las medias y desviaciones estimadas por EM.',
    `<div class="field"><span>Variables cuantitativas</span>${chips('msV', nums, v => (withNA.length >= 2 ? withNA : nums).includes(v))}</div>`,
    nums.length < 2 ? 'Necesitas al menos dos variables cuantitativas.' : ''
  );
}
function tarjetaCorr({ nums, D }) {
  return card(
    'corr',
    nums.length >= 2,
    'Correlaciones',
    'Matriz de correlaciones con significación. Tharp elige Pearson o Spearman según la distribución.',
    `<div class="field"><span>Variables cuantitativas</span>${chips('corr', nums, v => (D.corr ? D.corr.includes(v.name) : nums.indexOf(v) < 8))}</div>
     <label class="field"><span>Método</span><select id="corrM"><option value="auto">Automático (recomendado)</option><option value="pearson">Pearson</option><option value="spearman">Spearman</option><option value="kendall">Tau-b de Kendall</option></select></label>
     <div class="field"><span>Controlar por (opcional: correlación parcial)</span>${chips('corrZ', nums, () => false)}</div>`,
    nums.length < 2 ? 'Necesitas al menos dos variables cuantitativas.' : ''
  );
}
function tarjetaComp({ nums, facs, pick, D }) {
  const dComp = D.comp || {};
  return card(
    'comp',
    nums.length >= 1 && facs.length >= 1,
    'Comparación entre grupos',
    'Prueba t, ANOVA o sus alternativas no paramétricas, con comprobación automática de supuestos y post hoc.',
    `<div class="field"><span>Variables dependientes (cuantitativas)</span>${chips('compY', nums, v => (dComp.y ? dComp.y.includes(v.name) : v === nums[0]))}</div>
     <label class="field"><span>Variable de agrupación</span>${sel('compG', facs, pick(dComp.g, facs[0] && facs[0].name))}</label>
     <label class="field"><span>Hipótesis (solo con 2 grupos)</span><select id="compAlt"><option value="two">Bilateral: los grupos difieren (recomendada)</option><option value="greater">Unilateral: el primer grupo puntúa más</option><option value="less">Unilateral: el primer grupo puntúa menos</option></select></label>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Comparaciones post hoc (3 o más grupos)</span><select id="compPH"><option value="auto">Automáticas: Tukey o Games-Howell según las varianzas (recomendado)</option><option value="tukey">Tukey HSD</option><option value="gh">Games-Howell</option><option value="bonferroni">Bonferroni</option><option value="holm">Holm</option><option value="sidak">Šidák</option><option value="scheffe">Scheffé</option><option value="snk">Student-Newman-Keuls (SNK)</option><option value="duncan">Duncan</option><option value="regwq">REGWQ (Ryan-Einot-Gabriel-Welsch)</option><option value="gt2">GT2 de Hochberg</option><option value="gabriel">Gabriel</option><option value="tamhane">T2 de Tamhane</option><option value="dunnett">Dunnett (frente a un grupo control)</option><option value="lsd">DMS de Fisher (sin corrección)</option></select></label>
     <label class="field" id="compCtrlW" style="display:none"><span>Grupo control</span><select id="compCtrl"></select></label>
     <label class="field"><span>Contrastes planificados (opcional)</span><select id="compCon"><option value="">Ninguno</option><option value="polynomial">Polinómicos: tendencia lineal, cuadrática…</option><option value="simple">Simples: cada grupo frente al primero</option><option value="repeated">Repetidos: cada grupo frente al siguiente</option><option value="helmert">Helmert: cada grupo frente a la media de los siguientes</option><option value="difference">Diferencia: cada grupo frente a la media de los anteriores</option><option value="deviation">Desviación: cada grupo frente a la media global</option></select></label></div>
     <div class="field"><span>Pruebas no paramétricas adicionales (opcional)</span>${optChips('compNP', [
       ['median', 'Prueba de la mediana'],
       ['ks', 'Kolmogorov-Smirnov (2 grupos)'],
       ['jt', 'Jonckheere-Terpstra (tendencia en el orden de los grupos)'],
     ])}</div>`,
    !(nums.length >= 1 && facs.length >= 1)
      ? 'Necesitas una variable cuantitativa y una categórica con 2 a 12 grupos.'
      : ''
  );
}
function tarjetaOne({ nums }) {
  return card(
    'one',
    false,
    'Comparación con un valor de referencia (una muestra)',
    '¿La media difiere de un valor fijo, como el punto medio de una escala o una norma publicada? Prueba t para una muestra o Wilcoxon, según la normalidad.',
    `<div class="field"><span>Variables (una prueba para cada una)</span>${chips('oY', nums, v => v === nums[0])}</div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Valor de referencia</span><input id="oMu" type="number" step="any" value="0" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:140px"></label>
     <label class="field"><span>Hipótesis</span><select id="oAlt"><option value="two">Bilateral: la media difiere (recomendada)</option><option value="greater">Unilateral: la media es mayor</option><option value="less">Unilateral: la media es menor</option></select></label></div>
     <div class="field"><span>Pruebas adicionales (opcional)</span>${optChips('oNP', [
       ['sign', 'Prueba de los signos (mediana frente al valor de referencia)'],
       ['runs', 'Prueba de rachas (aleatoriedad en el orden de los casos)'],
     ])}</div>`,
    nums.length < 1 ? 'Necesitas una variable cuantitativa.' : ''
  );
}
function tarjetaTost({ nums, facs }) {
  const fac2 = facs.filter(v => levelsOf(v).length === 2);
  return card(
    'tost',
    false,
    'Equivalencia (TOST)',
    'Para mostrar que dos medias son prácticamente iguales (un p > .05 no lo demuestra): dos pruebas t unilaterales frente a unos límites de equivalencia que fijas tú antes de ver los datos.',
    `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Diseño</span><select id="tDes"><option value="ind">Dos grupos independientes</option><option value="paired">Dos medidas de las mismas personas</option><option value="one">Una muestra frente a un valor</option></select></label>
     <label class="field"><span>Variable cuantitativa</span><select id="tY">${nums.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label>
     <label class="field"><span>Grupo (dos grupos)</span><select id="tG"><option value="">—</option>${fac2.map((v, k) => `<option value="${esc(v.name)}"${k === 0 ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
     <label class="field"><span>Segunda medida (relacionadas)</span><select id="tY2"><option value="">—</option>${nums.map((v, k) => `<option value="${esc(v.name)}"${k === 1 ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
     <label class="field"><span>Valor de referencia (una muestra)</span><input id="tMu" type="number" step="any" value="0" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:110px"></label></div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Límites expresados en</span><select id="tUnit"><option value="d">d de Cohen (tamaño del efecto)</option><option value="raw">Unidades de la variable</option></select></label>
     <label class="field"><span>Límite inferior</span><input id="tLow" type="number" step="any" value="-0.5" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:110px"></label><label class="field"><span>Límite superior</span><input id="tHigh" type="number" step="any" value="0.5" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:110px"></label></div>
     <p class="muted small">Los límites son la diferencia más pequeña que tendría importancia práctica en tu campo; justifícalos en el trabajo (estudios previos, criterio clínico…). Por defecto, ± 0.5 de d.</p>`,
    nums.length < 1 ? 'Necesitas una variable cuantitativa.' : ''
  );
}
function tarjetaPaired({ D, nums, facs, has }) {
  const dP = D.paired || {};
  const pDef = (dP.vars || []).filter(has);
  return card(
    'paired',
    !!D.paired && nums.length >= 2,
    'Comparación de medidas relacionadas (pre/post o varios momentos)',
    'Las mismas personas medidas dos o más veces: t relacionada o Wilcoxon (2 momentos); ANOVA de medidas repetidas o Friedman (3 o más). Con un factor entre sujetos (por ejemplo, control frente a tratamiento): ANOVA mixta.',
    `<div class="field"><span>Momentos o condiciones (en el orden de las columnas del archivo)</span>${chips('pM', nums, v => (pDef.length ? pDef.includes(v.name) : nums.indexOf(v) < 2))}</div>
     <label class="field"><span>Hipótesis (solo con 2 medidas y sin factor entre sujetos)</span><select id="pAlt"><option value="two">Bilateral: las medidas difieren (recomendada)</option><option value="greater">Unilateral: la segunda medida es mayor</option><option value="less">Unilateral: la segunda medida es menor</option></select></label>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Comparaciones tras Friedman (3 o más medidas)</span><select id="pFPH"><option value="wilcoxon">Wilcoxon por pares, corrección de Holm (recomendado)</option><option value="conover">Conover, corrección de Holm (como JASP)</option><option value="siegel">Dunn-Bonferroni sobre rangos medios (como SPSS)</option><option value="nemenyi">Nemenyi</option></select></label></div>
     <div class="field"><span>Opciones no paramétricas</span>${optChips('pNP', [
       ['force', 'Usar siempre la prueba no paramétrica (Wilcoxon o Friedman)'],
       ['sign', 'Añadir la prueba de los signos (2 medidas)'],
     ])}</div>
     <details style="margin:4px 0 10px"><summary class="small">Dos factores intrasujeto (opcional; por ejemplo, condición × momento)</summary>
       <p class="small muted" style="margin:6px 0">Marca arriba todas las columnas en este orden: el segundo factor cambia más rápido (A1·B1, A1·B2, …, A2·B1, A2·B2…), como en SPSS. El número de columnas debe ser niveles del factor 1 × niveles del factor 2.</p>
       <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor 1: nombre y niveles</span><span style="display:flex;gap:6px"><input id="pW1N" placeholder="p. ej., condición" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:150px"><input id="pW1K" type="number" min="2" placeholder="niveles" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:90px"></span></label>
       <label class="field"><span>Factor 2: nombre y niveles</span><span style="display:flex;gap:6px"><input id="pW2N" placeholder="p. ej., momento" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:150px"><input id="pW2K" type="number" min="2" placeholder="niveles" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:90px"></span></label></div></details>
     <label class="field"><span>Factor entre sujetos (opcional: ANOVA mixta)</span><select id="pB"><option value="">Ninguno</option>${facs.map(v => `<option value="${esc(v.name)}"${dP.between === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>`,
    nums.length < 2 ? 'Necesitas dos variables cuantitativas.' : ''
  );
}
function tarjetaChi({ facs, pick, D }) {
  const dC = D.chi || {};
  return card(
    'chi',
    facs.length >= 2,
    'Asociación entre variables categóricas',
    'Tabla de contingencia, chi-cuadrado (o Fisher) y V de Cramér.',
    `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable en filas</span>${sel('cA', facs, pick(dC.a, facs[0] && facs[0].name))}</label>
     <label class="field"><span>Variable en columnas</span>${sel('cB', facs, pick(dC.b, facs[1] && facs[1].name))}</label></div>
     <label class="field"><span>Estratificar por (opcional: Mantel-Haenszel, tablas 2×2)</span><select id="cS"><option value="">Ninguna</option>${facs.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label>`,
    facs.length < 2 ? 'Necesitas dos variables categóricas.' : ''
  );
}
function tarjetaProp({ cats }) {
  return card(
    'prop',
    false,
    'Proporciones: binomial y bondad de ajuste',
    '¿La proporción de una categoría difiere de un valor esperado (binomial exacta)? ¿Las frecuencias se ajustan a unas proporciones teóricas (χ² de bondad de ajuste)?',
    `<div class="field"><span>Variables categóricas (una prueba para cada una)</span>${chips('prV', cats, v => v === cats[0])}</div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Proporción esperada (2 categorías; de la segunda categoría)</span><input id="prP0" type="number" step="any" min="0" max="1" value="0.5" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:120px"></label>
     <label class="field"><span>Hipótesis (2 categorías)</span><select id="prAlt"><option value="two">Bilateral (recomendada)</option><option value="greater">Unilateral: mayor que la esperada</option><option value="less">Unilateral: menor que la esperada</option></select></label>
     <label class="field"><span>Proporciones esperadas (3 o más categorías, en su orden; vacío = iguales)</span><input id="prProbs" placeholder="p. ej., 0.5, 0.3, 0.2" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;width:240px"></label></div>`,
    !cats.length ? 'Necesitas una variable categórica.' : ''
  );
}
function tarjetaAgree({ nums, cats }) {
  return card(
    'agree',
    false,
    'Acuerdo entre jueces y fiabilidad test-retest (CCI y kappa)',
    'Puntuaciones de varios evaluadores o de dos aplicaciones del mismo test: coeficiente de correlación intraclase (cuantitativas) o kappa de Cohen y de Fleiss (categóricas).',
    `<div class="field"><span>Jueces o aplicaciones (una columna por juez o momento; todas cuantitativas o todas categóricas)</span>${chips('agV', nums.concat(cats), () => false)}</div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>CCI que se interpreta</span><select id="agM"><option value="ICC2">Dos factores, aleatorios, acuerdo absoluto (recomendado: jueces o momentos representativos)</option><option value="ICC3">Dos factores, mixtos, consistencia (solo estos jueces; importa el orden, no el valor exacto)</option><option value="ICC1">Un factor, aleatorios (cada sujeto valorado por jueces distintos)</option></select></label>
     <label class="field"><span>Unidad</span><select id="agU"><option value="single">Medida única (la puntuación de un juez)</option><option value="average">Promedio de los jueces (si usarás la media)</option></select></label>
     <label class="field"><span>Kappa de Cohen (categorías ordenadas)</span><select id="agW"><option value="none">Sin ponderar (categorías nominales)</option><option value="linear">Ponderada lineal</option><option value="quadratic">Ponderada cuadrática</option></select></label></div>`,
    nums.length + cats.length < 2 ? 'Necesitas al menos dos variables.' : ''
  );
}
function tarjetaRoc({ nums, cats }) {
  const bins2 = cats.filter(v => levelsOf(v).length === 2);
  return card(
    'roc',
    false,
    'Curva ROC (capacidad diagnóstica de una puntuación)',
    '¿Distingue una puntuación (test, escala, biomarcador) entre dos grupos, por ejemplo con y sin diagnóstico? Área bajo la curva, punto de corte óptimo, sensibilidad, especificidad y valores predictivos.',
    `<div class="field"><span>Puntuaciones (una curva para cada una)</span>${chips('rocX', nums, () => false)}</div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Estado real (2 categorías)</span>${sel('rocY', bins2, bins2[0] && bins2[0].name)}</label>
     <label class="field"><span>Categoría «positiva» (por ejemplo, con diagnóstico)</span><select id="rocPos"></select></label></div>`,
    !bins2.length || !nums.length
      ? 'Necesitas una puntuación cuantitativa y una variable con exactamente 2 categorías.'
      : ''
  );
}
function tarjetaReg({ D, nums, facs, pick }) {
  const dR = D.reg || {},
    regY = pick(dR.y, nums[0] && nums[0].name);
  return card(
    'reg',
    !!D.reg && nums.length >= 1,
    'Regresión lineal',
    'Coeficientes, β estandarizados, R², y diagnóstico completo: normalidad, homocedasticidad, multicolinealidad e influencia.',
    `<label class="field"><span>Variable dependiente</span>${sel('rY', nums, regY)}</label>
     <label class="field"><span>Método de entrada de los predictores</span><select id="rM">${[
       ['enter', 'Introducir: todos a la vez (recomendado)'],
       ['blocks', 'Jerárquica por bloques (Δ R²)'],
       ['stepwise', 'Por pasos (entrada p < .05, salida p > .10)'],
       ['forward', 'Hacia delante (entrada p < .05)'],
       ['backward', 'Hacia atrás (salida p > .10)'],
     ]
       .map(([k, l]) => `<option value="${k}"${(dR.method || 'enter') === k ? ' selected' : ''}>${l}</option>`)
       .join('')}</select></label>
     <div class="field"><span id="rXlab">${dR.method === 'blocks' ? 'Bloque 1 (predictores del primer modelo)' : 'Predictores'}</span>${chips('rX', nums.concat(facs), v => (dR.x ? dR.x.includes(v.name) : false))}</div>
     ${[2, 3].map(b => `<div class="field rblk" style="display:${dR.method === 'blocks' ? '' : 'none'}"><span>Bloque ${b} (se añaden al modelo anterior${b === 3 ? '; opcional' : ''})</span>${chips('rB' + b, nums.concat(facs), v => (dR['b' + b] || []).includes(v.name))}</div>`).join('')}`,
    nums.length < 1 ? 'Necesitas una variable cuantitativa como dependiente.' : ''
  );
}
function tarjetaCount({ nums, cats, facs }) {
  const cnts = nums.filter(v => {
    const x = numOf(v).filter(a => a !== null);
    return x.length && x.every(a => a >= 0 && Number.isInteger(a));
  });
  return card(
    'count',
    false,
    'Regresión para recuentos (Poisson o binomial negativa)',
    'Para variables dependientes que cuentan algo (número de visitas, síntomas, errores…): razones de tasas (IRR). Tharp comprueba la sobredispersión y elige entre Poisson y binomial negativa.',
    `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable dependiente (recuento)</span><select id="cntY">${cnts.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label>
     <label class="field"><span>Modelo</span><select id="cntF"><option value="auto">Automático (según la sobredispersión)</option><option value="poisson">Poisson</option><option value="negbin">Binomial negativa</option></select></label>
     <label class="field"><span>Exposición (opcional: tiempo, población…)</span><select id="cntO"><option value="">Ninguna</option>${nums.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label></div>
     <div class="field"><span>Predictores</span>${chips('cntX', nums.concat(cats), v => v === facs[0])}</div>`,
    !cnts.length ? 'Necesitas una variable de recuento (números enteros ≥ 0).' : ''
  );
}
function tarjetaSurv({ facs, nums, cats }) {
  const tvars = nums.filter(v => numOf(v).every(a => a === null || a >= 0)),
    evs = nums
      .filter(v => numOf(v).every(a => a === null || a === 0 || a === 1))
      .concat(cats.filter(v => levelsOf(v).length === 2));
  return card(
    'surv',
    false,
    'Análisis de supervivencia (Kaplan-Meier, log-rank y Cox)',
    'Tiempo hasta un evento (recaída, abandono, alta…) con casos que aún no lo han tenido (censurados): curvas de supervivencia, comparación de grupos y regresión de Cox (hazard ratios).',
    `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Tiempo de seguimiento</span><select id="svT">${tvars.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label>
     <label class="field"><span>Evento (qué valor indica que sí ocurrió)</span><select id="svE">${evs
       .map(v =>
         v.type === 'num'
           ? `<option value="${esc(v.name)}">${esc(v.name)} = 1</option>`
           : (lv => {
               const neg = l => /^(sin|no|ningun|ninguno|ninguna|vivo|viva|censurad)/i.test(normTxt(l)),
                 k = neg(lv[0]) && !neg(lv[1]) ? 1 : !neg(lv[0]) && neg(lv[1]) ? 0 : 1;
               return [k, 1 - k]
                 .map(j => `<option value="${esc(v.name + '\u0001' + lv[j])}">${esc(v.name)} = ${esc(lv[j])}</option>`)
                 .join('');
             })(levelsOf(v))
       )
       .join('')}</select></label>
     <label class="field"><span>Comparar grupos (opcional)</span><select id="svG"><option value="">No</option>${facs.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label></div>
     <div class="field"><span>Predictores para la regresión de Cox (opcional)</span>${chips('svX', nums.concat(cats), () => false)}</div>`,
    !tvars.length || !evs.length
      ? 'Necesitas una variable de tiempo (≥ 0) y otra que indique el evento (0/1 o dos categorías).'
      : ''
  );
}
function tarjetaMeta({ nums }) {
  const G1 = '[_.\\s-]?(1|e|exp|tx|trat|i)',
    G2 = '[_.\\s-]?(2|c|con|ctrl|control)';
  const MPAT = {
    M1: '^(m|mean|media|mu)' + G1 + '$',
    S1: '^(sd|s|dt|de)' + G1 + '$',
    N1: '^n' + G1 + '$',
    M2: '^(m|mean|media|mu)' + G2 + '$',
    S2: '^(sd|s|dt|de)' + G2 + '$',
    N2: '^n' + G2 + '$',
    A: '^(ev|eventos?|events?)' + G1 + '$|^ai$',
    B: '^(no[_.\\s-]?ev|no[_.\\s-]?eventos?|non[_.\\s-]?events?)' + G1 + '$|^bi$',
    C: '^(ev|eventos?|events?)' + G2 + '$|^ci$',
    D: '^(no[_.\\s-]?ev|no[_.\\s-]?eventos?|non[_.\\s-]?events?)' + G2 + '$|^di$',
    R: '^(r|ri|cor|correlaci[oó]n)$',
    N: '^(n|ni|n[_.\\s-]?total|tama[nñ]o)$',
    Y: '^(yi|g|d|es|te|efecto|effect|smd|hedges[_.\\s-]?g|cohen[_.\\s-]?d)$',
    E: '^(se|sei|ee|se[_.\\s-].+|ee[_.\\s-].+|error[_.\\s-]?t[ií]pico)$',
  };
  const mguess = Object.fromEntries(
    Object.entries(MPAT).map(([k, re]) => {
      const v = nums.find(v => new RegExp(re, 'i').test(v.name.trim()));
      return [k, v ? v.name : ''];
    })
  );
  const mtype =
    ['SMD', 'OR', 'COR', 'GEN'].find(T =>
      ({ SMD: ['M1', 'S1', 'N1', 'M2', 'S2', 'N2'], OR: ['A', 'B', 'C', 'D'], COR: ['R', 'N'], GEN: ['Y', 'E'] })[
        T
      ].every(k => mguess[k])
    ) || 'SMD';
  const mlab =
    (ST.vars.find(v => /^(estudio|study|autor|author|referencia|reference)/i.test(v.name.trim())) || {}).name || '';
  const msel = (id, lab) =>
    `<label class="field"><span>${lab}</span><select id="${id}"><option value="">— elige —</option>${nums.map(v => `<option value="${esc(v.name)}"${v.name === mguess[id.slice(2)] ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>`;
  return card(
    'meta',
    false,
    'Metaanálisis (una fila por estudio)',
    'Combina los resultados de varios estudios: efecto global con IC, heterogeneidad (Q, I², τ²), intervalo de predicción, prueba de Egger y gráficos de bosque y embudo.',
    `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Datos de cada estudio</span><select id="mtT">${[
      ['SMD', 'Medias, DT y n de dos grupos → g de Hedges'],
      ['MD', 'Medias, DT y n de dos grupos → diferencia de medias'],
      ['OR', 'Tabla 2×2 (eventos y no eventos en cada grupo) → odds ratio'],
      ['COR', 'Correlación y n → r'],
      ['GEN', 'Tamaño del efecto ya calculado y su error típico'],
    ]
      .map(([k, l]) => `<option value="${k}"${k === mtype ? ' selected' : ''}>${l}</option>`)
      .join('')}</select></label>
     <label class="field"><span>Modelo</span><select id="mtM"><option value="REML">Efectos aleatorios (REML, recomendado)</option><option value="DL">Efectos aleatorios (DerSimonian-Laird)</option><option value="FE">Efectos fijos</option></select></label>
     <label class="field"><span>Nombre del estudio (opcional)</span><select id="mtL"><option value="">Fila 1, 2, 3…</option>${ST.vars.map(v => `<option value="${esc(v.name)}"${v.name === mlab ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label></div>
     <p class="muted small">Medias y DT: grupo 1 (experimental) y grupo 2 (control). Tabla 2×2: eventos y no eventos del grupo 1 y del grupo 2. Correlación: r y n. Efecto ya calculado: el efecto y su error típico.</p>
     <div style="display:flex;gap:10px;flex-wrap:wrap">${msel('mtM1', 'Media 1')}${msel('mtS1', 'DT 1')}${msel('mtN1', 'n 1')}${msel('mtM2', 'Media 2')}${msel('mtS2', 'DT 2')}${msel('mtN2', 'n 2')}</div>
     <div style="display:flex;gap:10px;flex-wrap:wrap">${msel('mtA', 'Eventos 1')}${msel('mtB', 'No eventos 1')}${msel('mtC', 'Eventos 2')}${msel('mtD', 'No eventos 2')}${msel('mtR', 'r')}${msel('mtN', 'n')}${msel('mtY', 'Efecto')}${msel('mtE', 'Error típico')}</div>`,
    nums.length < 2 ? 'Necesitas al menos dos variables cuantitativas (una fila por estudio).' : ''
  );
}
function tarjetaLogit({ D, bins, pick, dL, nums, facs }) {
  return card(
    'logit',
    !!D.logit && bins.length >= 1,
    'Regresión logística binaria',
    'Para variables dependientes dicotómicas (sí/no): odds ratios, R² de Nagelkerke, Hosmer-Lemeshow y tabla de clasificación.',
    `<label class="field"><span>Variable dependiente (2 categorías)</span>${sel('lY', bins, pick(dL.y, bins[0] && bins[0].name))}</label>
     <div class="field"><span>Predictores</span>${chips('lX', nums.concat(facs), v => (dL.x ? dL.x.includes(v.name) : false))}</div>`,
    !bins.length ? 'Necesitas una variable categórica con exactamente 2 categorías.' : ''
  );
}
function tarjetaMlogit({ nums, facs, cats }) {
  const poly = cats.filter(v => {
    const k = levelsOf(v).length;
    return k >= 3 && k <= 10;
  });
  return card(
    'mlogit',
    false,
    'Regresión logística multinomial u ordinal',
    'Variable dependiente con 3 o más categorías: multinomial si no tienen orden (por ejemplo, tipo de tratamiento elegido) u ordinal de odds proporcionales si lo tienen (por ejemplo, leve, moderado, grave).',
    `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable dependiente (3 o más categorías)</span>${sel('mlY', poly, poly[0] && poly[0].name)}</label>
     <label class="field"><span>Modelo</span><select id="mlM"><option value="auto">Automático: ordinal si las categorías tienen orden, si no multinomial</option><option value="multinomial">Multinomial</option><option value="ordinal">Ordinal (odds proporcionales)</option></select></label></div>
     <div class="field"><span>Predictores</span>${chips('mlX', nums.concat(facs), () => false)}</div>`,
    !poly.length ? 'Necesitas una variable categórica con entre 3 y 10 categorías.' : ''
  );
}
function tarjetaManova({ nums, f6 }) {
  return card(
    'manova',
    false,
    'MANOVA (varias variables dependientes a la vez)',
    'Compara grupos en un conjunto de variables dependientes relacionadas a la vez (por ejemplo, las subescalas de un cuestionario): Pillai, Wilks, Hotelling y Roy, M de Box y ANOVA de seguimiento. Con covariables, MANCOVA.',
    `<div class="field"><span>Variables dependientes (2 o más)</span>${chips('mvY', nums, () => false)}</div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor</span>${sel('mvA', f6, f6[0] && f6[0].name)}</label>
     <label class="field"><span>Segundo factor (opcional)</span><select id="mvB"><option value="">Ninguno</option>${f6.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label></div>
     <div class="field"><span>Covariables (opcional: MANCOVA)</span>${chips('mvC', nums, () => false)}</div>`,
    nums.length < 2 || !f6.length ? 'Necesitas al menos dos variables cuantitativas y un factor con 2 a 6 grupos.' : ''
  );
}
function tarjetaFact({ D, nums, f6, pick, dF }) {
  return card(
    'fact',
    !!D.fact && nums.length >= 1 && f6.length >= 2,
    'ANOVA factorial (dos factores)',
    'Efectos principales e interacción con sumas de cuadrados de tipo III, η² parcial y gráfico de interacción.',
    `<div class="field"><span>Variables dependientes (un ANOVA para cada una)</span>${chips('fY', nums, v => v.name === pick(dF.y, nums[0] && nums[0].name))}</div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor 1</span>${sel('fA', f6, pick(dF.a, f6[0] && f6[0].name))}</label>
     <label class="field"><span>Factor 2</span>${sel('fB', f6, pick(dF.b, f6[1] && f6[1].name))}</label></div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Factor 3 (opcional)</span><select id="fC"><option value="">Ninguno</option>${f6.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label></div>
     <div class="field"><span>Covariables (opcional: ANCOVA factorial)</span>${chips('fCov', nums, () => false)}</div>`,
    !(nums.length >= 1 && f6.length >= 2)
      ? 'Necesitas una variable cuantitativa y dos categóricas de 2 a 6 niveles.'
      : ''
  );
}
function tarjetaAncova({ D, nums, facs, pick }) {
  const dA2 = D.ancova || {};
  return card(
    'ancova',
    !!D.ancova && nums.length >= 2 && facs.length >= 1,
    'ANCOVA (comparación de grupos controlando covariables)',
    'Compara grupos ajustando por una o más covariables (por ejemplo, la puntuación previa): medias ajustadas, homogeneidad de pendientes y comparaciones por pares.',
    `<label class="field"><span>Variable dependiente</span>${sel('acY', nums, pick(dA2.y, nums[0] && nums[0].name))}</label>
     <label class="field"><span>Factor (grupos)</span>${sel('acG', facs, pick(dA2.g, facs[0] && facs[0].name))}</label>
     <div class="field"><span>Covariables (cuantitativas)</span>${chips('acC', nums, v => (dA2.c ? dA2.c.includes(v.name) : false))}</div>`,
    !(nums.length >= 2 && facs.length >= 1)
      ? 'Necesitas una variable dependiente, un factor y al menos una covariable cuantitativa.'
      : ''
  );
}
function tarjetaBinrel({ bins }) {
  return card(
    'binrel',
    false, // desmarcado por defecto: solo se calcula si la persona lo elige
    'Cambio en variables sí/no (McNemar / Q de Cochran)',
    'Las mismas personas responden una pregunta dicotómica en dos o más momentos: McNemar (2) o Q de Cochran (3 o más).',
    `<div class="field"><span>Momentos (variables con las mismas dos categorías, en el orden de las columnas)</span>${chips('bR', bins, () => false)}</div>`,
    bins.length < 2
      ? 'Necesitas al menos dos variables categóricas con exactamente 2 categorías (por ejemplo, sí/no antes y después).'
      : ''
  );
}
function tarjetaMod({ D, nums, pick, dMo, xs, nmN }) {
  const defMoY = nmN(nums[0]),
    defMoX = nmN(xs.find(v => v.name !== defMoY)),
    defMoW = nmN(xs.find(v => v.name !== defMoY && v.name !== defMoX));
  return card(
    'mod',
    !!D.mod && nums.length >= 2,
    'Moderación (efecto de interacción)',
    '¿El efecto de X sobre Y depende de una tercera variable? Interacción, pendientes simples, región de Johnson-Neyman y gráfico (modelo 1 de PROCESS).',
    `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable dependiente (Y)</span>${sel('moY', nums, pick(dMo.y, defMoY))}</label>
     <label class="field"><span>Predictor (X)</span>${sel('moX', xs, pick(dMo.x, defMoX))}</label>
     <label class="field"><span>Moderador (W)</span>${sel('moW', xs, pick(dMo.w, defMoW))}</label></div>`,
    nums.length < 2
      ? 'Necesitas una variable dependiente cuantitativa, un predictor y un moderador (cuantitativos o de 2 categorías).'
      : ''
  );
}
function tarjetaMed({ D, nums, xs, pick, dMe, defMeX, defMeM, defMeY, nmN }) {
  return card(
    'med',
    !!D.med && nums.length >= 2,
    'Mediación (efecto indirecto)',
    '¿X influye en Y a través de un mediador M? Efectos a, b, c y c′ y efecto indirecto con intervalo bootstrap (modelo 4 de PROCESS).',
    `<div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Predictor (X)</span>${sel('meX', xs, pick(dMe.x, defMeX))}</label>
     <label class="field"><span>Mediador (M)</span>${sel('meM', nums, pick(dMe.m, defMeM))}</label>
     <label class="field"><span>Variable dependiente (Y)</span>${sel('meY', nums, pick(dMe.y, defMeY))}</label></div>
     <label class="field"><span>Modelo de PROCESS</span><select id="meMod">
       <option value="4">4 · Mediación simple (recomendado si tienes un mediador)</option><option value="4p">4 · Varios mediadores en paralelo</option><option value="6">6 · Mediadores en serie (X → M1 → M2 → Y)</option>
       <option value="7">7 · Mediación moderada: W modera X → M</option><option value="14">14 · Mediación moderada: W modera M → Y</option></select></label>
     <div class="field" id="meMW" style="display:none"><span>Mediadores adicionales (en serie, se encadenan después de M en el orden del archivo)</span>${chips('meM2', nums, () => false)}</div>
     <label class="field" id="meWW" style="display:none"><span>Moderador (W)</span>${sel('meW', xs, nmN(xs.find(v => v.name !== defMeY && v.name !== defMeM && v.name !== defMeX)))}</label>
     <div class="field"><span>Covariables (opcional)</span>${chips('meC', nums, () => false)}</div>`,
    nums.length < 2 ? 'Necesitas un predictor, un mediador cuantitativo y una variable dependiente cuantitativa.' : ''
  );
}
function tarjetaLmm({ D, nums, pick, facs }) {
  const dL2 = D.lmm || {},
    allV = ST.vars,
    gDef = (
      allV.find(v =>
        /^(id|participante|sujeto|caso|case|subject|grupo|clase|centro|escuela|colegio)$|(^id[_ ]|[_ ]id$)/i.test(
          v.name
        )
      ) ||
      allV[0] ||
      {}
    ).name;
  return card(
    'lmm',
    !!D.lmm && nums.length >= 1,
    'Modelo lineal mixto (datos longitudinales o anidados)',
    'Varias mediciones por persona, o personas dentro de grupos (alumnos en clases, pacientes en hospitales): efectos fijos con gl de Satterthwaite, efectos aleatorios, CCI y R² de Nakagawa.',
    `<p class="small muted" style="margin:0 0 10px">Los datos deben estar en <b>formato largo</b>: una fila por medición y una columna que identifique a la persona o al grupo.</p>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Variable dependiente</span>${sel('lmY', nums, pick(dL2.y, nums[0] && nums[0].name))}</label>
     <label class="field"><span>Agrupación (persona o grupo)</span>${sel('lmG', allV, pick(dL2.g, gDef))}</label>
     <label class="field"><span>Pendiente aleatoria (opcional)</span><select id="lmS"><option value="">Ninguna (solo intercepto aleatorio)</option>${nums.map(v => `<option value="${esc(v.name)}"${dL2.s === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label></div>
     <div class="field"><span>Efectos fijos (predictores)</span>${chips('lmX', nums.concat(facs), v => (dL2.x ? dL2.x.includes(v.name) : false))}</div>
     <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end"><label class="field"><span>Interacción (opcional): predictor A</span><select id="lmIA"><option value="">Sin interacción</option>${nums
       .concat(facs)
       .map(v => `<option value="${esc(v.name)}"${dL2.ia === v.name ? ' selected' : ''}>${esc(v.name)}</option>`)
       .join('')}</select></label>
     <label class="field"><span>× predictor B</span><select id="lmIB"><option value="">—</option>${nums
       .concat(facs)
       .map(v => `<option value="${esc(v.name)}"${dL2.ib === v.name ? ' selected' : ''}>${esc(v.name)}</option>`)
       .join('')}</select></label></div>`,
    nums.length < 1 ? 'Necesitas una variable dependiente cuantitativa.' : ''
  );
}
function tarjetaCfa({ D, nums, facs }) {
  const dCf = D.cfa || [];
  return card(
    'cfa',
    !!D.cfa && nums.length >= 3,
    'Análisis factorial confirmatorio',
    'Contrasta una estructura de factores definida de antemano: índices de ajuste (CFI, TLI, RMSEA, SRMR), cargas estandarizadas, correlaciones entre factores, fiabilidad (ω, AVE) y, si quieres, invarianza de medida entre grupos.',
    `<p class="small muted" style="margin:0 0 10px">Asigna cada ítem a un solo factor. Deja vacíos los factores que no uses.</p>` +
      [0, 1, 2, 3]
        .map(
          k =>
            `<div class="field" style="border-top:1px solid var(--line);padding-top:10px"><span>Factor ${k + 1}: <input id="cfN${k}" value="${esc((dCf[k] && dCf[k].name) || `Factor ${k + 1}`)}" style="font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:8px;width:200px"></span>${chips('cfI' + k, nums, v => !!(dCf[k] && dCf[k].items.includes(v.name)))}</div>`
        )
        .join('') +
      `<label class="field" style="border-top:1px solid var(--line);padding-top:10px"><span>Invarianza de medida entre grupos (opcional)</span><select id="cfG"><option value="">Sin comparación entre grupos</option>${facs.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('')}</select></label>`,
    nums.length < 3 ? 'Necesitas al menos tres ítems cuantitativos.' : ''
  );
}
function tarjetaEfa({ D, nums }) {
  const dE = D.efa || {};
  return card(
    'efa',
    !!D.efa && nums.length >= 3,
    'Análisis factorial exploratorio y componentes principales',
    'Estructura interna de un cuestionario: KMO, Bartlett, análisis paralelo, cargas, comunalidades y varianza explicada; ejes principales, MinRes, máxima verosimilitud o ACP, con siete rotaciones.',
    `<div class="field"><span>Ítems</span>${chips('eI', nums, v => (dE.items ? dE.items.includes(v.name) : false))}</div>
     <div style="display:flex;gap:14px;flex-wrap:wrap"><label class="field"><span>Número de factores</span><select id="eN"><option value="auto">Automático (análisis paralelo)</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(k => `<option value="${k}">${k}</option>`).join('')}</select></label>
     <label class="field"><span>Extracción</span><select id="eE"><option value="pa">Ejes principales (recomendada con ítems Likert)</option><option value="minres">Mínimos residuos (MinRes/ULS)</option><option value="ml">Máxima verosimilitud (con índices de ajuste)</option><option value="pca">Componentes principales (ACP)</option></select></label>
     <label class="field"><span>Rotación</span><select id="eR"><optgroup label="Oblicuas (factores correlacionados)"><option value="oblimin">Oblimin (recomendada)</option><option value="promax">Promax</option><option value="geomin">Geomin</option></optgroup><optgroup label="Ortogonales (factores independientes)"><option value="varimax">Varimax</option><option value="quartimax">Quartimax</option><option value="equamax">Equamax</option></optgroup><option value="none">Sin rotación</option></select></label></div>`,
    nums.length < 3 ? 'Necesitas al menos tres ítems cuantitativos.' : ''
  );
}
function tarjetaAlpha({ D, nums }) {
  const dA = D.alpha || {};
  return card(
    'alpha',
    !!D.alpha && nums.length >= 2,
    'Fiabilidad de una escala (alfa de Cronbach)',
    'Consistencia interna de un cuestionario: alfa, correlación ítem-total y alfa si se elimina cada ítem.',
    `<div class="field"><span>Ítems de la escala</span>${chips('aI', nums, v => (dA.items ? dA.items.includes(v.name) : false))}</div>
     <div class="field"><span>Ítems inversos (se recodifican)</span>${chips('aR', nums, v => (dA.rev ? dA.rev.includes(v.name) : false))}</div>`,
    nums.length < 2 ? 'Necesitas al menos dos ítems cuantitativos.' : ''
  );
}
/** Tarjetas en el orden en que se muestran */
const TARJETAS = [
  tarjetaDesc,
  tarjetaMiss,
  tarjetaCorr,
  tarjetaComp,
  tarjetaOne,
  tarjetaTost,
  tarjetaPaired,
  tarjetaChi,
  tarjetaProp,
  tarjetaAgree,
  tarjetaRoc,
  tarjetaReg,
  tarjetaCount,
  tarjetaSurv,
  tarjetaMeta,
  tarjetaLogit,
  tarjetaMlogit,
  tarjetaManova,
  tarjetaFact,
  tarjetaAncova,
  tarjetaBinrel,
  tarjetaMod,
  tarjetaMed,
  tarjetaLmm,
  tarjetaCfa,
  tarjetaEfa,
  tarjetaAlpha,
];

export { TARJETAS };
