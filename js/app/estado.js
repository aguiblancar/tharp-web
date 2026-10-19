/* Tharp · aplicación · Estado de la sesión: datos cargados, variables, resultados y numeración de tablas y figuras */

const ST = {
  fileName: '',
  wb: null,
  sheet: '',
  headers: [],
  rows: [],
  vars: [],
  sections: [],
  log: [],
  defaults: null,
};

// Numeración de tablas y figuras de los resultados (se reinicia en cada ejecución)
const numeracion = { tabla: 0, figura: 0 };

export { ST, numeracion };
