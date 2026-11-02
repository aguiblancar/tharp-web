/* Tharp · motor estadístico · Piezas comunes de los modelos lineales generalizados (producto X'WX) */

// ---- Piezas comunes de los modelos lineales generalizados ----

/** X'WX: producto cruzado ponderado (matriz de información de los MLG) */
function xtwx(X, w) {
  const p = X[0].length,
    M = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < X.length; i++) {
    const xi = X[i];
    for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) M[a][c] += w[i] * xi[a] * xi[c];
  }
  return M;
}

export { xtwx };
