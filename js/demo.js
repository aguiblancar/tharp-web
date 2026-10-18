/* Datos de ejemplo de Tharp (324 participantes, 20 variables): los usan la aplicación y la portada. Generados con semilla fija. */
window.TharpDemo = (function () {
  function demoData() {
    let seed = 20261014; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const norm = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const clip = (v, a, b) => Math.max(a, Math.min(b, v)), r1 = v => Math.round(v * 10) / 10;
    const head = ['id', 'sexo', 'edad', 'grupo', 'curso', 'horas_sueno', 'ansiedad_pre', 'ansiedad_post', 'estres', 'autoestima', 'rendimiento', 'satisfaccion', 'fuma', 'ae1', 'ae2', 'ae3', 'ae4', 'ae5', 'ae6'], rows = [head];
    const grupos = ['Control', 'Mindfulness', 'Ejercicio'], efecto = { Control: 0.5, Mindfulness: 5, Ejercicio: 3 };
    for (let i = 1; i <= 324; i++) {
      const sexo = rnd() < .58 ? 'Mujer' : 'Hombre', grupo = grupos[(i - 1) % 3], curso = ['1º', '2º', '3º', '4º'][Math.floor(rnd() * 4)];
      const edad = Math.round(clip(18 + Math.abs(norm()) * 4.5 + (rnd() < .06 ? 10 : 0), 18, 45));
      const sueno = r1(clip(7 + norm(), 3.5, 10)), pre = r1(clip(25 + (sexo === 'Mujer' ? 2 : 0) + norm() * 6, 5, 50));
      const post = r1(clip(pre - efecto[grupo] + norm() * 4, 3, 50));
      const estres = r1(clip(20 + .5 * (pre - 25) - 1.6 * (sueno - 7) + norm() * 4, 0, 40));
      const autoest = r1(clip(30 - .35 * (post - 22) + norm() * 4.5, 10, 40));
      const rend = r1(clip(6.4 + .35 * (sueno - 7) - .07 * (estres - 20) + norm() * 1.2, 0, 10));
      const satis = Math.round(clip(3 + .25 * (rend - 6.4) + norm() * .9, 1, 5));
      const fuma = rnd() < (.08 + .012 * Math.max(0, estres - 12)) ? 'Sí' : 'No';
      const lat = (autoest - 29) / 5, item = (inv) => Math.round(clip(3 + (inv ? -1 : 1) * .9 * lat + norm() * .75, 1, 5));
      rows.push([i, sexo, edad, grupo, curso, rnd() < .03 ? null : sueno, pre, post, estres, rnd() < .02 ? null : autoest, rend, rnd() < .04 ? null : satis, fuma,
        item(), item(), item(), item(true), item(), item()]);
    }
    // seguimiento a los 3 meses, con un generador aparte para no alterar el resto de los datos de ejemplo
    let s2 = 31415; const rnd2 = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
    const n2 = () => { let u = 0; while (!u) u = rnd2(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd2()); };
    rows[0].push('ansiedad_seguimiento');
    for (let i = 1; i < rows.length; i++) { const post = rows[i][7], g = rows[i][3]; rows[i].push(rnd2() < .05 ? null : r1(clip(post + (g === 'Control' ? -.3 : .9) + n2() * 3.2, 3, 50))); }
    return rows;
  }
  return demoData;
})();
