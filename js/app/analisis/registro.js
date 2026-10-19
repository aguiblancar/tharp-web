/* Tharp · aplicación · Registro de análisis.
   Cada entrada declara un análisis del paso 3: su identificador (el de su tarjeta en configuracion.js), cuándo está
   disponible además de marcado (activo, opcional) y cómo lee sus opciones y añade sus secciones de resultados (ejecutar).
   El orden del registro es el orden de los resultados. Para añadir un análisis: ver CONTRIBUTING.md. */
import { runAncova } from './ancova.js';
import { runCfa } from './afc.js';
import { runEfa } from './afe.js';
import { runFactorial, runFactorialG } from './anova-factorial.js';
import { runMixed } from './anova-mixta.js';
import { runBinRel, runChi, runProp } from './categoricos.js';
import { addNPGroups, runCompare } from './comparar-grupos.js';
import { runCorrelations } from './correlaciones.js';
import { runDescriptives } from './descriptivos.js';
import { runTost } from './equivalencia.js';
import { runAgree, runAlpha } from './fiabilidad.js';
import { runLogistic, runPolyLogit } from './logistica.js';
import { runManova } from './manova.js';
import { runMediation, runProcess } from './mediacion.js';
import { runMeta } from './metaanalisis.js';
import { runLmm } from './modelos-mixtos.js';
import { runModeration } from './moderacion.js';
import { runMissing } from './perdidos.js';
import { runCount } from './recuento.js';
import { runRegression } from './regresion-lineal.js';
import { addSign, runPaired } from './relacionadas.js';
import { runRm2 } from './repetidas-factorial.js';
import { runRepeated } from './repetidas-un-factor.js';
import { runRoc } from './roc.js';
import { runSurv } from './supervivencia.js';
import { addNPOne, runOneSample } from './una-muestra.js';
import { checkedVals } from '../configuracion.js';
import { $ } from '../utilidades.js';
import { nuevaSeccion } from '../resultados/piezas.js';

/**
 * @typedef {import('../resultados/piezas.js').Seccion} Seccion
 * @typedef {{ id: string, activo?: () => boolean, ejecutar: (add: (s: Seccion) => void) => void }} Analisis
 */

/** @type {Analisis[]} */
const ANALISIS = [
  {
    id: 'desc',
    ejecutar(add) {
      const v = checkedVals('desc');
      if (v.length) add(runDescriptives(v, ($('#descG') || {}).value || '', ($('#descPlot') || {}).value || 'box'));
    },
  },
  {
    id: 'corr',
    ejecutar(add) {
      add(runCorrelations(checkedVals('corr'), $('#corrM').value, checkedVals('corrZ')));
    },
  },
  {
    id: 'comp',
    ejecutar(add) {
      const g = $('#compG') && $('#compG').value;
      checkedVals('compY').forEach(y =>
        add(
          addNPGroups(
            runCompare(y, g, ($('#compAlt') || {}).value || 'two', {
              ph: ($('#compPH') || {}).value || 'auto',
              ctrl: ($('#compCtrl') || {}).value || '',
              con: ($('#compCon') || {}).value || '',
            }),
            y,
            g,
            checkedVals('compNP')
          )
        )
      );
    },
  },
  {
    id: 'one',
    ejecutar(add) {
      const ys = checkedVals('oY'),
        mu = parseFloat(String(($('#oMu') || {}).value || '').replace(',', '.'));
      if (ys.length)
        ys.forEach(y =>
          add(
            addNPOne(
              runOneSample(y, mu, ($('#oAlt') || {}).value || 'two'),
              y,
              mu,
              ($('#oAlt') || {}).value || 'two',
              checkedVals('oNP')
            )
          )
        );
      else add(nuevaSeccion('Una muestra', { error: 'Selecciona al menos una variable.' }));
    },
  },
  {
    id: 'tost',
    ejecutar(add) {
      const num = id => parseFloat(String(($(id) || {}).value || '').replace(',', '.'));
      add(
        runTost({
          des: ($('#tDes') || {}).value || 'ind',
          y: ($('#tY') || {}).value,
          g: ($('#tG') || {}).value,
          y2: ($('#tY2') || {}).value,
          mu: num('#tMu'),
          unit: ($('#tUnit') || {}).value || 'd',
          low: num('#tLow'),
          high: num('#tHigh'),
        })
      );
    },
  },
  {
    id: 'prop',
    ejecutar(add) {
      const vs = checkedVals('prV'),
        p0 = parseFloat(String(($('#prP0') || {}).value || '0.5').replace(',', '.')),
        pr = String(($('#prProbs') || {}).value || '').trim();
      if (vs.length) vs.forEach(v => add(runProp(v, p0, ($('#prAlt') || {}).value || 'two', pr)));
      else add(nuevaSeccion('Proporciones', { error: 'Selecciona al menos una variable categórica.' }));
    },
  },
  {
    id: 'agree',
    ejecutar(add) {
      add(
        runAgree(checkedVals('agV'), {
          model: ($('#agM') || {}).value || 'ICC2',
          unit: ($('#agU') || {}).value || 'single',
          weight: ($('#agW') || {}).value || 'none',
        })
      );
    },
  },
  {
    id: 'roc',
    ejecutar(add) {
      add(runRoc(checkedVals('rocX'), ($('#rocY') || {}).value, ($('#rocPos') || {}).value));
    },
  },
  {
    id: 'paired',
    ejecutar(add) {
      if (+($('#pW1K') || {}).value >= 2 && +($('#pW2K') || {}).value >= 2) {
        const k1 = Math.round(+$('#pW1K').value),
          k2 = Math.round(+$('#pW2K').value);
        add(
          runRm2(
            checkedVals('pM'),
            [($('#pW1N').value || 'Factor 1').trim(), ($('#pW2N').value || 'Factor 2').trim()],
            [k1, k2],
            ($('#pB') || {}).value || ''
          )
        );
      } else {
        const m = checkedVals('pM'),
          gB = ($('#pB') || {}).value;
        add(
          m.length >= 2 && gB
            ? runMixed(m, gB)
            : m.length === 2
              ? addSign(
                  runPaired(m[0], m[1], ($('#pAlt') || {}).value || 'two', checkedVals('pNP').includes('force')),
                  m[0],
                  m[1],
                  ($('#pAlt') || {}).value || 'two',
                  checkedVals('pNP').includes('sign')
                )
              : m.length > 2
                ? runRepeated(m, {
                    ph: ($('#pFPH') || {}).value || 'wilcoxon',
                    force: checkedVals('pNP').includes('force'),
                  })
                : nuevaSeccion('Medidas relacionadas', { error: 'Selecciona al menos dos momentos o condiciones.' })
        );
      }
    },
  },
  {
    id: 'chi',
    ejecutar(add) {
      add(runChi($('#cA').value, $('#cB').value, ($('#cS') || {}).value || ''));
    },
  },
  {
    id: 'reg',
    ejecutar(add) {
      const meth = ($('#rM') || {}).value || 'enter';
      if (meth === 'blocks') {
        const bl = [checkedVals('rX'), checkedVals('rB2'), checkedVals('rB3')]
          .map((b, i, all) => b.filter(x => !all.slice(0, i).flat().includes(x)))
          .filter(b => b.length);
        add(runRegression($('#rY').value, bl.flat(), 'blocks', bl));
      } else add(runRegression($('#rY').value, checkedVals('rX'), meth));
    },
  },
  {
    id: 'manova',
    ejecutar(add) {
      add(
        runManova(
          checkedVals('mvY'),
          [($('#mvA') || {}).value, ($('#mvB') || {}).value].filter(Boolean),
          checkedVals('mvC')
        )
      );
    },
  },
  {
    id: 'mlogit',
    ejecutar(add) {
      add(runPolyLogit(($('#mlY') || {}).value, checkedVals('mlX'), ($('#mlM') || {}).value || 'auto'));
    },
  },
  {
    id: 'logit',
    ejecutar(add) {
      add(runLogistic($('#lY').value, checkedVals('lX')));
    },
  },
  {
    id: 'miss',
    ejecutar(add) {
      add(runMissing(checkedVals('msV')));
    },
  },
  {
    id: 'meta',
    ejecutar(add) {
      const g = id => ($(id) || {}).value || '';
      add(
        runMeta({
          type: g('#mtT') || 'SMD',
          method: g('#mtM') || 'REML',
          label: g('#mtL'),
          cols: Object.fromEntries(
            ['M1', 'S1', 'N1', 'M2', 'S2', 'N2', 'A', 'B', 'C', 'D', 'R', 'N', 'Y', 'E'].map(k => [k, g('#mt' + k)])
          ),
        })
      );
    },
  },
  {
    id: 'surv',
    ejecutar(add) {
      add(runSurv(($('#svT') || {}).value, ($('#svE') || {}).value, ($('#svG') || {}).value || '', checkedVals('svX')));
    },
  },
  {
    id: 'count',
    ejecutar(add) {
      add(
        runCount(
          ($('#cntY') || {}).value,
          checkedVals('cntX'),
          ($('#cntF') || {}).value || 'auto',
          ($('#cntO') || {}).value || ''
        )
      );
    },
  },
  {
    id: 'fact',
    ejecutar(add) {
      const ys = checkedVals('fY');
      const f3 = ($('#fC') || {}).value || '',
        cv = checkedVals('fCov');
      if (ys.length)
        ys.forEach(y =>
          add(
            f3 || cv.length
              ? runFactorialG(y, [$('#fA').value, $('#fB').value].concat(f3 ? [f3] : []), cv)
              : runFactorial(y, $('#fA').value, $('#fB').value)
          )
        );
      else add(nuevaSeccion('ANOVA factorial', { error: 'Selecciona al menos una variable dependiente.' }));
    },
  },
  {
    id: 'ancova',
    ejecutar(add) {
      add(runAncova($('#acY').value, $('#acG').value, checkedVals('acC')));
    },
  },
  {
    id: 'binrel',
    ejecutar(add) {
      add(runBinRel(checkedVals('bR')));
    },
  },
  {
    id: 'cfa',
    ejecutar(add) {
      add(
        runCfa(
          [0, 1, 2, 3]
            .map(k => ({ name: $('#cfN' + k).value.trim() || `Factor ${k + 1}`, items: checkedVals('cfI' + k) }))
            .filter(fc => fc.items.length),
          $('#cfG').value
        )
      );
    },
  },
  {
    id: 'lmm',
    ejecutar(add) {
      add(
        runLmm($('#lmY').value, checkedVals('lmX'), $('#lmG').value, $('#lmS').value, [
          $('#lmIA').value,
          $('#lmIB').value,
        ])
      );
    },
  },
  {
    id: 'mod',
    ejecutar(add) {
      add(runModeration($('#moY').value, $('#moX').value, $('#moW').value));
    },
  },
  {
    id: 'med',
    ejecutar(add) {
      const mo = ($('#meMod') || {}).value || '4',
        cvs = checkedVals('meC');
      if (mo === '4' && !cvs.length) add(runMediation($('#meY').value, $('#meX').value, $('#meM').value));
      else
        add(
          runProcess(
            mo,
            $('#meY').value,
            $('#meX').value,
            [$('#meM').value].concat(
              mo === '4p' || mo === '6' ? checkedVals('meM2').filter(m => m !== $('#meM').value) : []
            ),
            mo === '7' || mo === '14' ? $('#meW').value : '',
            cvs
          )
        );
    },
  },
  {
    id: 'efa',
    ejecutar(add) {
      add(runEfa(checkedVals('eI'), $('#eN').value, $('#eR').value, ($('#eE') || {}).value || 'pa'));
    },
  },
  {
    id: 'alpha',
    ejecutar(add) {
      add(runAlpha(checkedVals('aI'), checkedVals('aR')));
    },
  },
];

export { ANALISIS };
