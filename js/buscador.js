/* Buscador de pruebas de tharp.es (copia literal de web/index.html) */
(function(){
  const box = document.getElementById('finderBox');
  const state = {};
  const history = [];

  // Árbol de decisión
  const Q = {
    goal: {t:'¿Qué quieres hacer con tus datos?', h:'Piensa en tu pregunta de investigación.', o:[
      ['compare','Comparar grupos','¿Hay diferencias entre grupos o momentos?'],
      ['relate','Relacionar variables','¿Están asociadas dos variables?'],
      ['predict','Predecir una variable','¿Qué variables explican o predicen un resultado?'],
      ['describe','Describir mis datos','Medias, frecuencias, distribución…']]},
    dv: {t:'¿Cómo es tu variable dependiente (la que mides)?', h:'Ej.: ansiedad, nota, satisfacción, aprobado/suspenso.', o:[
      ['quant','Cuantitativa','Puntuaciones, tiempos, edad, escalas con muchos valores'],
      ['ord','Ordinal','Categorías con orden: bajo / medio / alto, Likert de un ítem'],
      ['cat','Categórica','Categorías sin orden: sí/no, tipo de tratamiento']]},
    groups: {t:'¿Cuántos grupos o momentos comparas?', h:'Ej.: hombres/mujeres = 2; tres tratamientos = 3 o más.', o:[
      ['2','2 grupos o momentos',''],['3','3 o más','']]},
    design: {t:'¿Los grupos son independientes o relacionados?', h:'Relacionados = las mismas personas medidas varias veces (pre/post) o parejas emparejadas.', o:[
      ['ind','Independientes','Cada persona pertenece a un solo grupo'],
      ['rel','Relacionados','Las mismas personas en varios momentos o condiciones']]},
    vars: {t:'¿Qué tipo de variables quieres relacionar?', h:'', o:[
      ['qq','Las dos cuantitativas','Ej.: horas de estudio y nota'],
      ['oo','Al menos una es ordinal','Ej.: nivel de estudios y satisfacción'],
      ['cc','Las dos categóricas','Ej.: sexo y opción de voto']]},
    pdv: {t:'¿Cómo es la variable que quieres predecir?', h:'', o:[
      ['quant','Cuantitativa','Ej.: nota final, nivel de estrés'],
      ['bin','Dicotómica (2 categorías)','Ej.: aprueba/suspende, sí/no'],
      ['ord','Ordinal','Ej.: nivel bajo / medio / alto']]}
  };

  function next(){
    const s = state;
    if(!s.goal) return 'goal';
    if(s.goal==='describe') return null;
    if(s.goal==='compare'){
      if(!s.dv) return 'dv';
      if(!s.groups) return 'groups';
      if(!s.design) return 'design';
      return null;
    }
    if(s.goal==='relate'){ return s.vars ? null : 'vars'; }
    if(s.goal==='predict'){ return s.pdv ? null : 'pdv'; }
  }

  const DVN = {quant:'cuantitativa',ord:'ordinal',cat:'categórica'};
  function result(){
    const s = state; let r;
    const why = [];
    if(s.goal==='describe'){
      r = {name:'Estadísticos descriptivos', why:['Tu objetivo es describir la muestra, no contrastar una hipótesis'],
        assum:['Elegir la medida según el tipo de variable: media y DT para cuantitativas, mediana y rango intercuartílico si la distribución es asimétrica, frecuencias y porcentajes para categóricas'],
        alt:'Acompaña la descripción con histogramas, diagramas de caja o gráficos de barras.',
        code:'summary(datos)\npsych::describe(datos)'};
      return r;
    }
    if(s.goal==='compare'){
      why.push('Quieres comparar grupos o momentos');
      why.push('Variable dependiente '+DVN[s.dv]);
      why.push(s.groups==='2'?'Comparas 2 grupos o momentos':'Comparas 3 o más grupos o momentos');
      why.push(s.design==='ind'?'Los grupos son independientes':'Las medidas están relacionadas (mismas personas)');
      const k = s.dv+'|'+s.groups+'|'+s.design;
      const T = {
        'quant|2|ind':['Prueba t de muestras independientes',['Normalidad de la VD en cada grupo (o n ≥ 30 por grupo)','Homogeneidad de varianzas (Levene); si no se cumple, usa la corrección de Welch','Independencia de las observaciones'],'U de Mann-Whitney si no se cumple la normalidad con muestras pequeñas.','t.test(vd ~ grupo, data = datos, var.equal = FALSE)'],
        'quant|2|rel':['Prueba t de muestras relacionadas',['Normalidad de las diferencias entre las dos medidas','Las parejas de medidas corresponden a la misma persona'],'Prueba de rangos con signo de Wilcoxon si las diferencias no son normales.','t.test(datos$post, datos$pre, paired = TRUE)'],
        'quant|3|ind':['ANOVA de un factor',['Normalidad de la VD en cada grupo','Homogeneidad de varianzas (Levene); si no se cumple, usa el ANOVA de Welch','Independencia de las observaciones','Si es significativo, comparaciones post hoc (Tukey, Games-Howell)'],'Kruskal-Wallis si no se cumplen los supuestos.','modelo <- aov(vd ~ grupo, data = datos)\nsummary(modelo)\nTukeyHSD(modelo)'],
        'quant|3|rel':['ANOVA de medidas repetidas',['Normalidad en cada momento','Esfericidad (Mauchly); si no se cumple, corrección de Greenhouse-Geisser'],'Prueba de Friedman si no se cumplen los supuestos.','rstatix::anova_test(datos_largo, dv = vd, wid = id, within = momento)'],
        'ord|2|ind':['U de Mann-Whitney',['Observaciones independientes','VD al menos ordinal'],'Si la VD fuera cuantitativa y normal, la prueba t sería más potente.','wilcox.test(vd ~ grupo, data = datos)'],
        'ord|2|rel':['Prueba de rangos con signo de Wilcoxon',['Medidas emparejadas','VD al menos ordinal'],'Prueba de los signos si las diferencias no son simétricas.','wilcox.test(datos$post, datos$pre, paired = TRUE)'],
        'ord|3|ind':['Prueba H de Kruskal-Wallis',['Observaciones independientes','VD al menos ordinal','Si es significativa, comparaciones post hoc de Dunn'],'ANOVA de un factor si la VD es cuantitativa y se cumplen sus supuestos.','kruskal.test(vd ~ grupo, data = datos)'],
        'ord|3|rel':['Prueba de Friedman',['Las mismas personas en todas las condiciones','VD al menos ordinal'],'ANOVA de medidas repetidas si la VD es cuantitativa y se cumplen sus supuestos.','friedman.test(vd ~ momento | id, data = datos_largo)'],
        'cat|2|ind':['Chi-cuadrado de independencia',['Observaciones independientes','Frecuencias esperadas ≥ 5 en al menos el 80 % de las casillas'],'Prueba exacta de Fisher si las frecuencias esperadas son bajas.','chisq.test(table(datos$grupo, datos$vd))'],
        'cat|3|ind':['Chi-cuadrado de independencia',['Observaciones independientes','Frecuencias esperadas ≥ 5 en al menos el 80 % de las casillas','Analiza los residuos tipificados para ver dónde están las diferencias'],'Prueba exacta de Fisher (o simulación de Monte Carlo) si las frecuencias esperadas son bajas.','chisq.test(table(datos$grupo, datos$vd))'],
        'cat|2|rel':['Prueba de McNemar',['VD dicotómica medida dos veces en las mismas personas'],'Prueba binomial exacta si hay pocos casos discordantes.','mcnemar.test(table(datos$pre, datos$post))'],
        'cat|3|rel':['Q de Cochran',['VD dicotómica (sí/no) medida en las mismas personas en 3 o más momentos'],'Si la VD tiene más de dos categorías, considera modelos mixtos (GLMM).','DescTools::CochranQTest(respuesta ~ momento | id, data = datos_largo)']
      };
      const t = T[k];
      r = {name:t[0], why, assum:t[1], alt:t[2], code:t[3]};
      if(k==='cat|3|rel') r.warn = 'La Q de Cochran solo sirve si tu variable es dicotómica. Si tiene más categorías, consulta a un estadístico antes de continuar.';
      return r;
    }
    if(s.goal==='relate'){
      why.push('Quieres estudiar la asociación entre dos variables');
      if(s.vars==='qq'){ why.push('Las dos variables son cuantitativas');
        return {name:'Correlación de Pearson', why, assum:['Relación lineal (revisa el diagrama de dispersión)','Normalidad bivariada aproximada','Sin valores atípicos influyentes'], alt:'Correlación de Spearman si la relación no es lineal o hay atípicos.', code:'cor.test(datos$x, datos$y, method = "pearson")'}; }
      if(s.vars==='oo'){ why.push('Al menos una variable es ordinal');
        return {name:'Correlación de Spearman', why, assum:['Relación monótona (siempre crece o siempre decrece)','Variables al menos ordinales'], alt:'Tau-b de Kendall si hay muchos empates o la muestra es pequeña.', code:'cor.test(datos$x, datos$y, method = "spearman")'}; }
      why.push('Las dos variables son categóricas');
      return {name:'Chi-cuadrado + V de Cramér', why, assum:['Observaciones independientes','Frecuencias esperadas ≥ 5 en al menos el 80 % de las casillas'], alt:'Prueba exacta de Fisher en tablas 2×2 con frecuencias bajas.', code:'tabla <- table(datos$x, datos$y)\nchisq.test(tabla)\nrcompanion::cramerV(tabla)'};
    }
    if(s.goal==='predict'){
      why.push('Quieres explicar o predecir una variable a partir de otras');
      if(s.pdv==='quant'){ why.push('La variable resultado es cuantitativa');
        return {name:'Regresión lineal', why, assum:['Linealidad','Independencia de los residuos (Durbin-Watson)','Homocedasticidad','Normalidad de los residuos','Ausencia de multicolinealidad (VIF)'], alt:'Regresión robusta o transformaciones si los residuos no se comportan bien.', code:'modelo <- lm(vd ~ x1 + x2, data = datos)\nsummary(modelo)\nplot(modelo)'}; }
      if(s.pdv==='bin'){ why.push('La variable resultado es dicotómica');
        return {name:'Regresión logística binaria', why, assum:['Observaciones independientes','Linealidad entre los predictores continuos y el logit','Ausencia de multicolinealidad','Suficientes casos por predictor (orientativo: ≥ 10 eventos por predictor)'], alt:'Regresión logística penalizada (Firth) si hay pocos eventos.', code:'modelo <- glm(vd ~ x1 + x2, data = datos, family = binomial)\nsummary(modelo)\nexp(coef(modelo))'}; }
      why.push('La variable resultado es ordinal');
      return {name:'Regresión logística ordinal', why, assum:['Supuesto de odds proporcionales (prueba de Brant)','Ausencia de multicolinealidad'], alt:'Regresión multinomial si no se cumplen las odds proporcionales.', code:'modelo <- MASS::polr(vd ~ x1 + x2, data = datos, Hess = TRUE)\nsummary(modelo)', warn:'La regresión ordinal tiene supuestos delicados. Si no tienes claro cómo interpretarla, consulta a un estadístico.'};
    }
  }

  function esc(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
  function steps(){ const s=state; if(!s.goal) return 3; return {compare:4,relate:2,predict:2,describe:1}[s.goal]; }

  function render(){
    const key = next();
    const done = history.length;
    const pct = key ? Math.round(done/steps()*100) : 100;
    let html = '<div class="progress"><i style="width:'+pct+'%"></i></div>';
    if(key){
      const q = Q[key];
      html += '<div class="q"><h3>'+q.t+'</h3>'+(q.h?'<p class="hint">'+q.h+'</p>':'<p class="hint"></p>')+'<div class="opts">';
      q.o.forEach(o=>{ html += '<button class="opt" data-k="'+key+'" data-v="'+o[0]+'"><b>'+o[1]+'</b>'+(o[2]?'<small>'+o[2]+'</small>':'')+'</button>'; });
      html += '</div></div>';
      html += '<div class="finder-foot">'+(done?'<button class="link" id="back">Atrás</button>':'<span></span>')+'<span style="color:var(--soft);font-size:.9rem">Paso '+(done+1)+'</span></div>';
    } else {
      const r = result();
      try { window.umami && window.umami.track('buscador_resultado', { prueba: r.name }); } catch (e) { /* estadística opcional */ }
      // análisis que la app ya realiza (el resto se recomienda, pero se avisa de que aún no está disponible)
      r.inApp = ['Estadísticos descriptivos','Prueba t de muestras independientes','Prueba t de muestras relacionadas','ANOVA de un factor','U de Mann-Whitney','Prueba de rangos con signo de Wilcoxon','Prueba H de Kruskal-Wallis','Chi-cuadrado de independencia','Correlación de Pearson','Correlación de Spearman','Chi-cuadrado + V de Cramér','Regresión lineal','Regresión logística binaria','ANOVA de medidas repetidas','Prueba de Friedman','Prueba de McNemar','Q de Cochran','Regresión logística ordinal'].includes(r.name);
      html += '<div class="result"><h3>'+r.name+'</h3>';
      html += '<h4>Por qué</h4><ul>'+r.why.map(w=>'<li>'+w+'</li>').join('')+'</ul>';
      html += '<h4>Supuestos que debes comprobar</h4><ul>'+r.assum.map(w=>'<li>'+w+'</li>').join('')+'</ul>';
      html += '<h4>Alternativa</h4><div class="alt">'+r.alt+'</div>';
      html += '<h4>Código R</h4><pre>'+esc(r.code)+'</pre>';
      if(r.warn) html += '<div class="warn">⚠️ '+r.warn+'</div>';
      html += '<p style="color:var(--soft);font-size:.88rem;margin-top:18px">Es una orientación general según tu diseño. La decisión final depende de tu pregunta de investigación y de tus datos.</p>';
      const auto = ['U de Mann-Whitney','Prueba de rangos con signo de Wilcoxon','Prueba H de Kruskal-Wallis','Prueba de Friedman'].includes(r.name);
      if (r.inApp) html += '<div class="upsell"><div><strong>'+(auto ? 'Tharp hace esta comparación con tus datos' : 'Tharp hace este análisis con tus datos')+'</strong><br><span style="color:var(--soft)">'+(auto ? 'Ten en cuenta que Tharp elige entre la prueba paramétrica y esta alternativa no paramétrica según se cumplan o no los supuestos, no según el nivel de medida.' : 'Comprueba los supuestos, aplica la alternativa si hace falta y redacta los resultados.')+' Tus datos no salen de tu navegador.</span></div><a class="btn btn-dark" href="app.html">Analizar mis datos</a></div>';
      else html += '<div class="upsell"><div><strong>Este análisis todavía no está en Tharp</strong><br><span style="color:var(--soft)">Estamos trabajando en ello. Mientras tanto, puedes hacerlo en R con el código de arriba, o en JASP o SPSS.</span></div><a class="btn btn-line" href="mailto:info@tharp.es?subject=Quiero%20este%20an%C3%A1lisis%20en%20Tharp&body='+encodeURIComponent('Me gustaría poder hacer en Tharp: '+r.name)+'">Pedir este análisis</a></div>';
      html += '<div class="finder-foot"><button class="link" id="back">Atrás</button><button class="link" id="restart">Empezar de nuevo</button></div></div>';
    }
    box.innerHTML = html;
    box.querySelectorAll('.opt').forEach(b=>b.addEventListener('click',()=>{ state[b.dataset.k]=b.dataset.v; history.push(b.dataset.k); render(); }));
    const back = document.getElementById('back'); if(back) back.addEventListener('click',()=>{ const k=history.pop(); delete state[k]; render(); });
    const rs = document.getElementById('restart'); if(rs) rs.addEventListener('click',()=>{ Object.keys(state).forEach(k=>delete state[k]); history.length=0; render(); });
  }
  render();
})();
