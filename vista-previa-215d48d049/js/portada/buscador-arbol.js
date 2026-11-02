// Buscador de pruebas: árbol de decisión y recomendaciones (datos y lógica pura, sin DOM).
// Cada respuesta se guarda en un objeto de estado { goal, dv, groups, design, vars, pdv };
// la recomendación depende del camino recorrido.

/** Preguntas del árbol: texto, ayuda y opciones [valor, etiqueta, explicación] */
const PREGUNTAS = {
  goal: {
    t: '¿Qué quieres hacer con tus datos?',
    h: 'Piensa en tu pregunta de investigación.',
    o: [
      ['compare', 'Comparar grupos', '¿Hay diferencias entre grupos o momentos?'],
      ['relate', 'Relacionar variables', '¿Están asociadas dos variables?'],
      ['predict', 'Predecir una variable', '¿Qué variables explican o predicen un resultado?'],
      ['describe', 'Describir mis datos', 'Medias, frecuencias, distribución…'],
    ],
  },
  dv: {
    t: '¿Cómo es tu variable dependiente (la que mides)?',
    h: 'Ej.: ansiedad, nota, satisfacción, aprobado/suspenso.',
    o: [
      ['quant', 'Cuantitativa', 'Puntuaciones, tiempos, edad, escalas con muchos valores'],
      ['ord', 'Ordinal', 'Categorías con orden: bajo / medio / alto, Likert de un ítem'],
      ['cat', 'Categórica', 'Categorías sin orden: sí/no, tipo de tratamiento'],
    ],
  },
  groups: {
    t: '¿Cuántos grupos o momentos comparas?',
    h: 'Ej.: hombres/mujeres = 2; tres tratamientos = 3 o más.',
    o: [
      ['2', '2 grupos o momentos', ''],
      ['3', '3 o más', ''],
    ],
  },
  design: {
    t: '¿Los grupos son independientes o relacionados?',
    h: 'Relacionados = las mismas personas medidas varias veces (pre/post) o parejas emparejadas.',
    o: [
      ['ind', 'Independientes', 'Cada persona pertenece a un solo grupo'],
      ['rel', 'Relacionados', 'Las mismas personas en varios momentos o condiciones'],
    ],
  },
  vars: {
    t: '¿Qué tipo de variables quieres relacionar?',
    h: '',
    o: [
      ['qq', 'Las dos cuantitativas', 'Ej.: horas de estudio y nota'],
      ['oo', 'Al menos una es ordinal', 'Ej.: nivel de estudios y satisfacción'],
      ['cc', 'Las dos categóricas', 'Ej.: sexo y opción de voto'],
    ],
  },
  pdv: {
    t: '¿Cómo es la variable que quieres predecir?',
    h: '',
    o: [
      ['quant', 'Cuantitativa', 'Ej.: nota final, nivel de estrés'],
      ['bin', 'Dicotómica (2 categorías)', 'Ej.: aprueba/suspende, sí/no'],
      ['ord', 'Ordinal', 'Ej.: nivel bajo / medio / alto'],
    ],
  },
};

/** Preguntas que siguen a cada objetivo, en orden */
const ORDEN = { compare: ['dv', 'groups', 'design'], relate: ['vars'], predict: ['pdv'], describe: [] };

/** Motivo que aporta cada respuesta a la recomendación */
const MOTIVOS = {
  goal: {
    compare: 'Quieres comparar grupos o momentos',
    relate: 'Quieres estudiar la asociación entre dos variables',
    predict: 'Quieres explicar o predecir una variable a partir de otras',
    describe: 'Tu objetivo es describir la muestra, no contrastar una hipótesis',
  },
  dv: {
    quant: 'Variable dependiente cuantitativa',
    ord: 'Variable dependiente ordinal',
    cat: 'Variable dependiente categórica',
  },
  groups: { 2: 'Comparas 2 grupos o momentos', 3: 'Comparas 3 o más grupos o momentos' },
  design: { ind: 'Los grupos son independientes', rel: 'Las medidas están relacionadas (mismas personas)' },
  vars: {
    qq: 'Las dos variables son cuantitativas',
    oo: 'Al menos una variable es ordinal',
    cc: 'Las dos variables son categóricas',
  },
  pdv: {
    quant: 'La variable resultado es cuantitativa',
    bin: 'La variable resultado es dicotómica',
    ord: 'La variable resultado es ordinal',
  },
};

const FRECUENCIAS_ESPERADAS = 'Frecuencias esperadas ≥ 5 en al menos el 80 % de las casillas';

/** Recomendación para cada camino completo (clave: respuestas unidas por «|») */
const RECOMENDACIONES = {
  describe: {
    name: 'Estadísticos descriptivos',
    assum: [
      'Elegir la medida según el tipo de variable: media y DT para cuantitativas, mediana y rango intercuartílico si la distribución es asimétrica, frecuencias y porcentajes para categóricas',
    ],
    alt: 'Acompaña la descripción con histogramas, diagramas de caja o gráficos de barras.',
    code: 'summary(datos)\npsych::describe(datos)',
  },
  'compare|quant|2|ind': {
    name: 'Prueba t de muestras independientes',
    assum: [
      'Normalidad de la VD en cada grupo (o n ≥ 30 por grupo)',
      'Homogeneidad de varianzas (Levene); si no se cumple, usa la corrección de Welch',
      'Independencia de las observaciones',
    ],
    alt: 'U de Mann-Whitney si no se cumple la normalidad con muestras pequeñas.',
    code: 't.test(vd ~ grupo, data = datos, var.equal = FALSE)',
  },
  'compare|quant|2|rel': {
    name: 'Prueba t de muestras relacionadas',
    assum: [
      'Normalidad de las diferencias entre las dos medidas',
      'Las parejas de medidas corresponden a la misma persona',
    ],
    alt: 'Prueba de rangos con signo de Wilcoxon si las diferencias no son normales.',
    code: 't.test(datos$post, datos$pre, paired = TRUE)',
  },
  'compare|quant|3|ind': {
    name: 'ANOVA de un factor',
    assum: [
      'Normalidad de la VD en cada grupo',
      'Homogeneidad de varianzas (Levene); si no se cumple, usa el ANOVA de Welch',
      'Independencia de las observaciones',
      'Si es significativo, comparaciones post hoc (Tukey, Games-Howell)',
    ],
    alt: 'Kruskal-Wallis si no se cumplen los supuestos.',
    code: 'modelo <- aov(vd ~ grupo, data = datos)\nsummary(modelo)\nTukeyHSD(modelo)',
  },
  'compare|quant|3|rel': {
    name: 'ANOVA de medidas repetidas',
    assum: ['Normalidad en cada momento', 'Esfericidad (Mauchly); si no se cumple, corrección de Greenhouse-Geisser'],
    alt: 'Prueba de Friedman si no se cumplen los supuestos.',
    code: 'rstatix::anova_test(datos_largo, dv = vd, wid = id, within = momento)',
  },
  'compare|ord|2|ind': {
    name: 'U de Mann-Whitney',
    assum: ['Observaciones independientes', 'VD al menos ordinal'],
    alt: 'Si la VD fuera cuantitativa y normal, la prueba t sería más potente.',
    code: 'wilcox.test(vd ~ grupo, data = datos)',
  },
  'compare|ord|2|rel': {
    name: 'Prueba de rangos con signo de Wilcoxon',
    assum: ['Medidas emparejadas', 'VD al menos ordinal'],
    alt: 'Prueba de los signos si las diferencias no son simétricas.',
    code: 'wilcox.test(datos$post, datos$pre, paired = TRUE)',
  },
  'compare|ord|3|ind': {
    name: 'Prueba H de Kruskal-Wallis',
    assum: [
      'Observaciones independientes',
      'VD al menos ordinal',
      'Si es significativa, comparaciones post hoc de Dunn',
    ],
    alt: 'ANOVA de un factor si la VD es cuantitativa y se cumplen sus supuestos.',
    code: 'kruskal.test(vd ~ grupo, data = datos)',
  },
  'compare|ord|3|rel': {
    name: 'Prueba de Friedman',
    assum: ['Las mismas personas en todas las condiciones', 'VD al menos ordinal'],
    alt: 'ANOVA de medidas repetidas si la VD es cuantitativa y se cumplen sus supuestos.',
    code: 'friedman.test(vd ~ momento | id, data = datos_largo)',
  },
  'compare|cat|2|ind': {
    name: 'Chi-cuadrado de independencia',
    assum: ['Observaciones independientes', FRECUENCIAS_ESPERADAS],
    alt: 'Prueba exacta de Fisher si las frecuencias esperadas son bajas.',
    code: 'chisq.test(table(datos$grupo, datos$vd))',
  },
  'compare|cat|3|ind': {
    name: 'Chi-cuadrado de independencia',
    assum: [
      'Observaciones independientes',
      FRECUENCIAS_ESPERADAS,
      'Analiza los residuos tipificados para ver dónde están las diferencias',
    ],
    alt: 'Prueba exacta de Fisher (o simulación de Monte Carlo) si las frecuencias esperadas son bajas.',
    code: 'chisq.test(table(datos$grupo, datos$vd))',
  },
  'compare|cat|2|rel': {
    name: 'Prueba de McNemar',
    assum: ['VD dicotómica medida dos veces en las mismas personas'],
    alt: 'Prueba binomial exacta si hay pocos casos discordantes.',
    code: 'mcnemar.test(table(datos$pre, datos$post))',
  },
  'compare|cat|3|rel': {
    name: 'Q de Cochran',
    assum: ['VD dicotómica (sí/no) medida en las mismas personas en 3 o más momentos'],
    alt: 'Si la VD tiene más de dos categorías, considera modelos mixtos (GLMM).',
    code: 'DescTools::CochranQTest(respuesta ~ momento | id, data = datos_largo)',
    warn: 'La Q de Cochran solo sirve si tu variable es dicotómica. Si tiene más categorías, consulta a un estadístico antes de continuar.',
  },
  'relate|qq': {
    name: 'Correlación de Pearson',
    assum: [
      'Relación lineal (revisa el diagrama de dispersión)',
      'Normalidad bivariada aproximada',
      'Sin valores atípicos influyentes',
    ],
    alt: 'Correlación de Spearman si la relación no es lineal o hay atípicos.',
    code: 'cor.test(datos$x, datos$y, method = "pearson")',
  },
  'relate|oo': {
    name: 'Correlación de Spearman',
    assum: ['Relación monótona (siempre crece o siempre decrece)', 'Variables al menos ordinales'],
    alt: 'Tau-b de Kendall si hay muchos empates o la muestra es pequeña.',
    code: 'cor.test(datos$x, datos$y, method = "spearman")',
  },
  'relate|cc': {
    name: 'Chi-cuadrado + V de Cramér',
    assum: ['Observaciones independientes', FRECUENCIAS_ESPERADAS],
    alt: 'Prueba exacta de Fisher en tablas 2×2 con frecuencias bajas.',
    code: 'tabla <- table(datos$x, datos$y)\nchisq.test(tabla)\nrcompanion::cramerV(tabla)',
  },
  'predict|quant': {
    name: 'Regresión lineal',
    assum: [
      'Linealidad',
      'Independencia de los residuos (Durbin-Watson)',
      'Homocedasticidad',
      'Normalidad de los residuos',
      'Ausencia de multicolinealidad (VIF)',
    ],
    alt: 'Regresión robusta o transformaciones si los residuos no se comportan bien.',
    code: 'modelo <- lm(vd ~ x1 + x2, data = datos)\nsummary(modelo)\nplot(modelo)',
  },
  'predict|bin': {
    name: 'Regresión logística binaria',
    assum: [
      'Observaciones independientes',
      'Linealidad entre los predictores continuos y el logit',
      'Ausencia de multicolinealidad',
      'Suficientes casos por predictor (orientativo: ≥ 10 eventos por predictor)',
    ],
    alt: 'Regresión logística penalizada (Firth) si hay pocos eventos.',
    code: 'modelo <- glm(vd ~ x1 + x2, data = datos, family = binomial)\nsummary(modelo)\nexp(coef(modelo))',
  },
  'predict|ord': {
    name: 'Regresión logística ordinal',
    assum: ['Supuesto de odds proporcionales (prueba de Brant)', 'Ausencia de multicolinealidad'],
    alt: 'Regresión multinomial si no se cumplen las odds proporcionales.',
    code: 'modelo <- MASS::polr(vd ~ x1 + x2, data = datos, Hess = TRUE)\nsummary(modelo)',
    warn: 'La regresión ordinal tiene supuestos delicados. Si no tienes claro cómo interpretarla, consulta a un estadístico.',
  },
};

/** Recomendaciones que la aplicación ya realiza (del resto se avisa de que aún no están) */
const EN_LA_APP = new Set([
  'Estadísticos descriptivos',
  'Prueba t de muestras independientes',
  'Prueba t de muestras relacionadas',
  'ANOVA de un factor',
  'U de Mann-Whitney',
  'Prueba de rangos con signo de Wilcoxon',
  'Prueba H de Kruskal-Wallis',
  'Chi-cuadrado de independencia',
  'Correlación de Pearson',
  'Correlación de Spearman',
  'Chi-cuadrado + V de Cramér',
  'Regresión lineal',
  'Regresión logística binaria',
  'ANOVA de medidas repetidas',
  'Prueba de Friedman',
  'Prueba de McNemar',
  'Q de Cochran',
  'Regresión logística ordinal',
]);

/** Pruebas no paramétricas que Tharp aplica como alternativa según los supuestos, no según el nivel de medida */
const ALTERNATIVAS_AUTOMATICAS = new Set([
  'U de Mann-Whitney',
  'Prueba de rangos con signo de Wilcoxon',
  'Prueba H de Kruskal-Wallis',
  'Prueba de Friedman',
]);

/** Preguntas del camino elegido, en orden */
function camino(estado) {
  return estado.goal ? ['goal', ...ORDEN[estado.goal]] : ['goal'];
}

/** Siguiente pregunta sin responder, o null si el camino está completo */
function siguiente(estado) {
  return camino(estado).find(k => !estado[k]) || null;
}

/** Número total de pasos del camino (3 de referencia antes de elegir el objetivo) */
function pasos(estado) {
  return estado.goal ? camino(estado).length : 3;
}

/**
 * Recomendación para un camino completo.
 * @returns {{name: string, why: string[], assum: string[], alt: string, code: string, warn?: string,
 *   inApp: boolean, auto: boolean}}
 */
function recomendacion(estado) {
  const preguntas = camino(estado);
  const r = RECOMENDACIONES[preguntas.map(k => estado[k]).join('|')];
  return {
    ...r,
    why: preguntas.map(k => MOTIVOS[k][estado[k]]),
    inApp: EN_LA_APP.has(r.name),
    auto: ALTERNATIVAS_AUTOMATICAS.has(r.name),
  };
}

export { PREGUNTAS, RECOMENDACIONES, siguiente, pasos, recomendacion };
