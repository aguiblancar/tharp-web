/* Tharp · aplicación · Exportación a Word (docx) con tablas y figuras */
import { esc } from '../graficos.js';
import { ST } from '../estado.js';
import { citeTharp } from '../resultados/ejecutar.js';
import { $, download, slug, track } from '../utilidades.js';
import { avisar, errorInesperado } from '../avisos.js';

/** Dibuja un SVG en un lienzo a la escala indicada y devuelve el lienzo y su tamaño original */
function svgACanvas(svg, escala) {
  return new Promise((res, rej) => {
    const img = new Image(),
      url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/),
        w = +vb[1],
        h = +vb[2],
        c = document.createElement('canvas');
      c.width = w * escala;
      c.height = h * escala;
      const g = c.getContext('2d');
      g.scale(escala, escala);
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      res({ c, w, h });
    };
    img.onerror = rej;
    img.src = url;
  });
}
/** Descarga una figura en PNG (triple resolución) */
function svgToPng(svg, title) {
  svgACanvas(svg, 3).then(({ c }) => c.toBlob(b => download(slug(title) + '.png', b)));
}
/** PNG (doble resolución) de una figura para incrustarla en el Word */
function svgToPngBuffer(svg) {
  return svgACanvas(svg, 2).then(
    ({ c, w, h }) => new Promise((res, rej) => c.toBlob(b => b.arrayBuffer().then(buf => res({ buf, w, h }), rej)))
  );
}

// Word (.docx) real: tablas APA, cursivas estadísticas y gráficos incrustados. D es la librería docx (vendor).

/** Fragmentos de texto con formato (cursiva, negrita, subíndices…) a partir del HTML de la sección */
function runs(D, html, base = {}) {
  const out = [],
    el = document.createElement('div');
  el.innerHTML = html;
  (function walk(node, st) {
    node.childNodes.forEach(c => {
      if (c.nodeType === 3) {
        if (c.textContent) out.push(new D.TextRun(Object.assign({ text: c.textContent.replace(/\u00A0/g, ' ') }, st)));
        return;
      }
      const t = c.tagName,
        s2 = Object.assign({}, st);
      if (t === 'I' || t === 'EM') s2.italics = true;
      if (t === 'B' || t === 'STRONG') s2.bold = true;
      if (t === 'SUB') s2.subScript = true;
      if (t === 'SUP') s2.superScript = true;
      if (t === 'BR') {
        out.push(new D.TextRun({ break: 1 }));
        return;
      }
      walk(c, s2);
    });
  })(el, base);
  return out;
}
/** Párrafo con formato */
function parrafo(D, html, opt = {}) {
  return new D.Paragraph(
    Object.assign({ children: runs(D, html, opt.run || {}), spacing: { after: 120 } }, opt.p || {})
  );
}
function encabezado(D, nivel, texto, antes) {
  return new D.Paragraph({
    heading: D.HeadingLevel[nivel],
    children: [new D.TextRun(texto)],
    ...(antes ? { spacing: { before: antes } } : {}),
  });
}

const PAGINA = 9000; // ancho útil de la página en twips
/**
 * Ancho de cada columna según su contenido (los encabezados pueden partirse entre palabras) y tamaño de letra:
 * baja de 11 a 8 pt solo si la tabla no cabe en la página.
 */
function medidasTabla(head, body) {
  const plain = h =>
      h
        .replace(/<[^>]+>/g, '')
        .replace(/&[a-z]+;/g, 'x')
        .trim(),
    nc = head.length,
    len = new Array(nc).fill(3);
  head.forEach((h, i) => {
    len[i] = Math.max(
      len[i],
      ...plain(h)
        .split(/\s+/)
        .map(w => w.length)
    );
  });
  body.forEach(r => {
    if (r.length === nc)
      r.forEach((c, i) => {
        len[i] = Math.max(len[i], Math.min(28, plain(c).length));
      });
  });
  const need = sz => len.map(l => l * sz * 5 + 150), // ~0,5 em por carácter + márgenes de la celda (twips)
    fits = sz => need(sz).reduce((a, b) => a + b, 0) <= PAGINA;
  const size = [22, 20, 18].find(fits) || 16,
    nd = need(size),
    tot = nd.reduce((a, b) => a + b, 0);
  return { size, widths: nd.map(w => Math.round((w * PAGINA) / tot)) };
}
/** Tabla APA a partir de sus datos (resultados/piezas.js): título, encabezados, filas y nota */
function tablaAPA(D, t) {
  const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    LINE = sz => ({ style: D.BorderStyle.SINGLE, size: sz, color: '000000' });
  const head = t.head.map(String),
    body = t.rows.map(r => r.map(String));
  const { size, widths } = medidasTabla(head, body);
  const cell = (h, i, borders, last) =>
    new D.TableCell({
      borders,
      margins: { left: 60, right: 60 },
      width: widths[i] ? { size: widths[i], type: D.WidthType.DXA } : undefined,
      children: [
        new D.Paragraph({
          keepNext: !last,
          alignment: i === 0 ? D.AlignmentType.LEFT : D.AlignmentType.CENTER,
          children: runs(D, h.replace(/<span[^>]*>|<\/span>/g, ''), { size }),
        }),
      ],
    });
  const rows = [
    new D.TableRow({
      tableHeader: true,
      children: head.map((h, i) => cell(h, i, { top: LINE(12), bottom: LINE(8), left: NONE, right: NONE })),
    }),
    ...body.map((r, k) => {
      const ultima = k === body.length - 1;
      return new D.TableRow({
        cantSplit: true,
        children: r.map((c, i) =>
          cell(c, i, { top: NONE, bottom: ultima ? LINE(12) : NONE, left: NONE, right: NONE }, ultima)
        ),
      });
    }),
  ];
  const out = [
    parrafo(D, `<b>Tabla ${t.num}</b>`, { p: { keepNext: true, spacing: { before: 240, after: 0 } } }),
    parrafo(D, `<i>${esc(t.title)}</i>`, { p: { keepNext: true } }),
    new D.Table({
      rows,
      width: { size: PAGINA, type: D.WidthType.DXA },
      columnWidths: widths,
      borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    }),
  ];
  if (t.note)
    out.push(parrafo(D, `<i>Nota.</i> ${t.note}`, { run: { size: 20 }, p: { spacing: { before: 80, after: 200 } } }));
  return out;
}
/** Figura numerada: número, título, leyenda e imagen */
async function figura(D, c, num) {
  const { buf, w, h } = await svgToPngBuffer(c.svg),
    W = Math.min(560, w * (w > 400 ? 0.87 : 1.2)),
    Hh = (W * h) / w;
  const out = [
    parrafo(D, `<b>Figura ${num}</b>`, { p: { keepNext: true, spacing: { before: 240, after: 0 } } }),
    parrafo(D, `<i>${esc(c.title)}</i>`, { p: { keepNext: true } }),
  ];
  if (c.legend)
    out.push(parrafo(D, c.legend.replace(/<i[^>]*><\/i>/g, '■ '), { run: { size: 18 }, p: { keepNext: true } }));
  out.push(new D.Paragraph({ children: [new D.ImageRun({ data: buf, transformation: { width: W, height: Hh } })] }));
  return out;
}
/** Una sección de resultados: decisión, tablas, redacción, figuras, justificación y supuestos */
async function seccionDocx(D, s, figN) {
  const kids = [encabezado(D, 'HEADING_1', s.title, 360)];
  if (s.error) return { kids: [...kids, parrafo(D, esc(s.error))], figN };
  if (s.decision) kids.push(parrafo(D, s.decision));
  s.tables.forEach(t => kids.push(...tablaAPA(D, t)));
  kids.push(encabezado(D, 'HEADING_2', 'Redacción de resultados'));
  s.text.forEach(t => kids.push(parrafo(D, t)));
  for (const c of s.charts) kids.push(...(await figura(D, c, ++figN)));
  kids.push(encabezado(D, 'HEADING_2', 'Justificación y supuestos'));
  s.why.forEach(w => kids.push(parrafo(D, '• ' + w)));
  if (s.alt) kids.push(parrafo(D, '<b>Alternativa:</b> ' + s.alt));
  s.checks.forEach(c => kids.push(parrafo(D, { ok: '✓ ', no: '⚠ ', info: 'ℹ ' }[c.s] + c.t)));
  if (s.sens) kids.push(parrafo(D, s.sens));
  return { kids, figN };
}
/** Apartado final «Cómo citar Tharp» (APA 7) */
function comoCitar(D) {
  const c = citeTharp(),
    gris = { run: { color: '555555' } };
  return [
    encabezado(D, 'HEADING_1', 'Cómo citar Tharp', 360),
    parrafo(
      D,
      'Las normas APA (7.ª ed.) piden mencionar en el método el software con el que se hicieron los análisis y citarlo en las referencias.',
      gris
    ),
    parrafo(D, '<b>En el apartado de análisis de datos:</b> ' + c.method),
    parrafo(D, '<b>En la lista de referencias:</b>'),
    parrafo(D, c.refHtml, { p: { indent: { left: 720, hanging: 720 } } }),
    parrafo(
      D,
      'Si usas el script de R, cita también R y los paquetes empleados: citation() y citation("nombre_del_paquete") en R dan la referencia de cada uno.',
      gris
    ),
  ];
}
/** Documento completo: portada, registro de decisiones, secciones y cita */
async function documento(D) {
  const kids = [
    encabezado(D, 'TITLE', 'Resultados del análisis estadístico'),
    parrafo(
      D,
      `Generado con Tharp ${citeTharp().version} (tharp.es) el ${new Date().toLocaleDateString('es-ES')} a partir de «${esc(ST.fileName)}».`,
      { run: { color: '555555' } }
    ),
    encabezado(D, 'HEADING_1', 'Registro de decisiones'),
    ...ST.log.map((l, i) => parrafo(D, `${i + 1}. ${l}`)),
  ];
  let figN = 0;
  for (const s of ST.sections) {
    const r = await seccionDocx(D, s, figN);
    kids.push(...r.kids);
    figN = r.figN;
  }
  kids.push(...comoCitar(D));
  return new D.Document({
    creator: 'Tharp',
    title: 'Resultados del análisis estadístico',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{ children: kids }],
  });
}
/** Botón «Descargar Word» */
async function exportDocx() {
  const D = window.docx,
    btn = $('#dlWord'),
    label = btn.textContent;
  if (!D) {
    avisar('No se pudo cargar el generador de Word. Recarga la página e inténtalo de nuevo.');
    return;
  }
  btn.textContent = 'Generando…';
  btn.disabled = true;
  try {
    download('tharp_resultados.docx', await D.Packer.toBlob(await documento(D)));
    track('descarga_word');
  } catch (e) {
    errorInesperado(e, 'No se pudo generar el Word');
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}

export { svgToPng, svgToPngBuffer, exportDocx };
