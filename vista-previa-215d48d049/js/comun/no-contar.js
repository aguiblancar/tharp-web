/* Tharp · ?no-contar excluye este navegador de las estadísticas (Umami); ?contar lo vuelve a incluir.
   Script clásico: se carga antes que el de Umami. Es la única excepción a app/avisos.js (confirmación con alert): se ejecuta
   antes que los módulos, en una dirección que solo usa la titular, y comun/ no puede importar otros módulos. */
try {
  const q = location.search;
  if (/[?&]no-contar(&|=|$)/.test(q)) {
    localStorage.setItem('umami.disabled', '1');
    alert('Listo: las visitas desde este navegador ya no se cuentan en las estadísticas.');
  } else if (/[?&]contar(&|=|$)/.test(q)) {
    localStorage.removeItem('umami.disabled');
    alert('Las visitas desde este navegador vuelven a contarse.');
  }
} catch (e) {}
