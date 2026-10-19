/* Tharp · aplicación · Avisos y errores: una sola forma de comunicar los problemas a la persona.
   - Error de un paso concreto (archivo no válido, opción incorrecta): junto al control que lo provoca, con mostrarError.
   - Aviso general (nada seleccionado, una descarga que no se pudo generar): en la zona de avisos, sin bloquear la página.
   - Error inesperado (un fallo de Tharp): se registra en la consola con su causa y se explica sin detalles técnicos.
   Nunca se usa alert(): bloquea la página y los lectores de pantalla lo anuncian peor que una región con role="alert". */
import { esc } from './graficos-base.js';
import { $ } from './utilidades.js';

const CONTACTO = 'Si se repite, escríbenos a info@tharp.es.';

/** Problema de los datos o de las opciones elegidas, con un mensaje ya redactado para la persona (no es un fallo de Tharp) */
class ErrorDeUsuario extends Error {
  constructor(mensaje, opciones) {
    super(mensaje, opciones);
    this.name = 'ErrorDeUsuario';
  }
}

/** Muestra un error dentro de una zona de la página (selector o elemento); el texto se escapa */
function mostrarError(destino, mensaje) {
  const el = typeof destino === 'string' ? $(destino) : destino;
  if (el) el.innerHTML = `<div class="err" role="alert">${esc(String(mensaje))}</div>`;
}

/** Vacía la zona de error de un paso */
function limpiarError(destino) {
  const el = typeof destino === 'string' ? $(destino) : destino;
  if (el) el.innerHTML = '';
}

/**
 * Aviso no bloqueante en la zona de avisos (#avisos). Los informativos desaparecen solos; los de error, al cerrarlos.
 * @param {string} mensaje texto sin HTML
 * @param {'error' | 'info'} [tipo]
 */
function avisar(mensaje, tipo = 'error') {
  const zona = $('#avisos');
  if (!zona) return;
  const el = document.createElement('div');
  el.className = `aviso aviso-${tipo}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(String(mensaje))}</span><button type="button" aria-label="Cerrar aviso">×</button>`;
  el.querySelector('button').onclick = () => el.remove();
  zona.appendChild(el);
  if (tipo === 'info') setTimeout(() => el.remove(), 8000);
}

/** Error inesperado de Tharp: causa completa en la consola y explicación breve para la persona */
function errorInesperado(e, queFallo) {
  console.error(e);
  avisar(`${queFallo}. Recarga la página e inténtalo de nuevo. ${CONTACTO}`);
}

/** Captura los errores que no gestiona ningún paso, para que nunca fallen en silencio */
function capturarErroresGlobales() {
  window.addEventListener('error', ev => errorInesperado(ev.error || ev.message, 'Ha ocurrido un error inesperado'));
  window.addEventListener('unhandledrejection', ev => errorInesperado(ev.reason, 'Ha ocurrido un error inesperado'));
}

export { CONTACTO, ErrorDeUsuario, mostrarError, limpiarError, avisar, errorInesperado, capturarErroresGlobales };
