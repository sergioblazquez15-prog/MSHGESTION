'use strict';
/* Exportación de una factura a FactuSOL: FAC.xlsx (cabecera) + LFA.xlsx (líneas).
   Formato según la guía de importación de DELSOL (GIP.F.06.03). */
const { colName } = require('./xlsx');
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pad6 = n => String(n).padStart(6, '0');
const dmy = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
const cut = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// Cabeceras de la hoja LFA (31 columnas A–AE, tal como en el ejemplo de FactuSOL)
const LFA_HEAD = ['Tipo de documento', 'Número de documento', 'Posición de la línea', 'Artículo', 'Descripción', 'Cantidad', 'Porcentaje de descuento 1', 'Porcentaje de descuento 2', 'Porcentaje de descuento 3', 'Precio del artículo', 'Total', 'Tipo de IVA', 'Documento que creó la factura', 'Tipo de documento', 'Código del documento', 'Precio de costo', 'Bultos', 'Comisión del agente', 'Campo de uso interno', 'Ejercicio del que proviene la validación', 'Alto', 'Ancho', 'Fondo', 'Campo de uso interno', 'Campo de uso interno', 'IVA incluido en la línea', 'Precio IVA incluido', 'Total IVA incluido', 'Talla', 'Color', 'Imagen asociada'];

// Cabeceras de la hoja FAC (116 columnas A–DL)
const FAC = {};
const set = (c, t) => { FAC[c] = t; };
const idx = col => col.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
Object.entries({
  A: 'Tipo de documento', B: 'Número de documento', C: 'Referencia', D: 'Fecha de la factura', E: 'Estado', F: 'Código del agente', G: 'Código del proveedor',
  H: 'Código del cliente', I: 'Nombre del cliente', J: 'Domicilio del cliente', K: 'Población del cliente', L: 'Código postal del cliente', M: 'Provincia del cliente', N: 'NIF del cliente',
  O: 'Tipo de IVA', P: 'Recargo de equivalencia', Q: 'Teléfono del cliente', R: 'Importe neto 1', S: 'Importe neto 2', T: 'Importe neto 3',
  U: 'Porcentaje de descuento 1', V: 'Porcentaje de descuento 2', W: 'Porcentaje de descuento 3', X: 'Importe de descuento 2', Y: 'Importe de descuento 1', Z: 'Importe de descuento 3',
  AA: 'Porcentaje de pronto pago 1', AB: 'Porcentaje de pronto pago 2', AC: 'Porcentaje de pronto pago 3', AD: 'Importe de pronto pago 1', AE: 'Importe de pronto pago 2', AF: 'Importe de pronto pago 3',
  AG: 'Porcentaje de portes 1', AH: 'Porcentaje de portes 2', AI: 'Porcentaje de portes 3', AJ: 'Importe de portes 1', AK: 'Importe de portes 2', AL: 'Importe de portes 3',
  AM: 'Porcentaje de financiación 1', AN: 'Porcentaje de financiación 2', AO: 'Porcentaje de financiación 3', AP: 'Importe de financiación 1', AQ: 'Importe de financiación 2', AR: 'Importe de financiación 3',
  AS: 'Base imponible 1', AT: 'Base imponible 2', AU: 'Base imponible 3', AV: 'Porcentaje de IVA 1', AW: 'Porcentaje de IVA 2', AX: 'Porcentaje de IVA 3', AY: 'Importe de IVA 1', AZ: 'Importe de IVA 2', BA: 'Importe de IVA 3',
  BB: 'Porcentaje de recargo 1', BC: 'Porcentaje de recargo 2', BD: 'Porcentaje de recargo 3', BE: 'Importe de recargo 1', BF: 'Importe de recargo 2', BG: 'Importe de recargo 3',
  BH: 'Porcentaje de retención', BI: 'Importe de retención', BJ: 'Total', BK: 'Forma de pago', BL: 'Portes', BM: 'Texto de portes', BN: 'Observaciones 1', BO: 'Observaciones 2',
  BP: 'Código de la dirección de entrega', BQ: 'Enviado por', BR: 'Empaquetado por', BS: 'A la atención de', BT: 'Referencia', BU: 'Número de pedido del cliente', BV: 'Fecha del pedido del cliente',
  BW: 'Recibo', BX: 'Tipo de recibo', BY: 'Código del recibo', BZ: 'Traspasado a contabilidad', CA: 'Notas privadas', CB: 'Documentos externos', CC: 'Impreso', CD: 'Banco de domiciliación',
  CE: 'Hora de creación', CF: 'Comentarios después de las líneas', CG: 'Usuario que lo creó', CH: 'Último usuario que lo modificó', CI: 'Fax', CJ: 'Imagen', CK: 'Importe neto exento',
  CT: 'Base imponible exenta', CU: 'Enviado por e-mail', CV: 'Permisos / clave', CW: 'Cuenta bancaria del cliente (entidad)', CX: 'Cuenta bancaria del cliente (oficina)', CY: 'Cuenta bancaria del cliente (DC)', CZ: 'Cuenta bancaria del cliente (cuenta)', DA: 'Cuenta bancaria del cliente (país)',
  DB: 'Suplidos', DC: 'Régimen especial de caja', DD: 'Clave de operación', DE: 'Fecha de operación', DF: 'Tipo de retención', DG: 'IBAN', DH: 'BIC', DI: 'Departamento', DJ: 'Subdepartamento', DK: 'País del cliente', DL: 'E-mail del cliente'
}).forEach(([c, t]) => set(idx(c), t));
const FAC_N = idx('DL') + 1;
const FAC_HEAD = Array.from({ length: FAC_N }, (_, i) => FAC[i] || ('Campo ' + colName(i)));

/* build: o = pedido cargado, ctx = { client, docType, number, date, payCode, codes:{prod,pack,fin}(name->code), freeCode } */
function build(o, ctx) {
  const warnings = [];
  const lines = [];
  let pos = 0;
  const code = (map, name, what) => {
    const c = map.get(name);
    if (!c) { warnings.push(what + ' «' + name + '» no tiene código de artículo; se usa ' + ctx.freeCode); return ctx.freeCode; }
    return c;
  };
  const push = (art, desc, qty, price, size, color) => {
    pos++;
    const q = Number(qty) || 0, p = r2(price || 0);
    lines.push([ctx.docType, pad6(ctx.number), pos, cut(art, 13), cut(desc, 100), q, null, null, null, p, r2(q * p), 0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, cut(size, 20), cut(color, 20), null]);
  };
  const descr = (l) => cut([l.product_name, l.finishes.map(f => f.name + (f.value ? ' ' + f.value : '')).join(', ')].filter(Boolean).join(' · '), 100);
  const finLines = l => l.finishes.filter(f => f.price).forEach(f => push(code(ctx.codes.fin, f.name, 'El acabado'), cut(f.name + (f.value ? ' ' + f.value : ''), 100), l.qty, f.price, l.size, l.color));
  const seen = new Set();
  o.lines.forEach(l => {
    if (l.kind === 'pack') {
      if (!seen.has(l.group_no)) {
        seen.add(l.group_no);
        const grp = o.lines.filter(x => x.kind === 'pack' && x.group_no === l.group_no);
        push(code(ctx.codes.pack, l.pack_name, 'El pack'), l.pack_name, l.qty, l.pack_price, '', '');
        grp.forEach(g => {
          push(code(ctx.codes.prod, g.product_name, 'El producto'), descr(g), g.qty, 0, g.size, g.color);
          finLines(g);
        });
      }
    } else if (l.kind === 'product') {
      push(code(ctx.codes.prod, l.product_name, 'El producto'), descr(l), l.qty, l.unit_price, l.size, l.color);
      finLines(l);
    } else {
      push(ctx.freeCode, cut(l.product_name, 100), l.qty, l.unit_price, l.size, l.color);
    }
  });
  const base = r2(lines.reduce((a, r) => a + r[10], 0)), iva = r2(base * 0.21), total = r2(base + iva);
  const c = ctx.client;
  const fac = Array(FAC_N).fill(null);
  const put = (col, v) => { fac[idx(col)] = v; };
  put('A', ctx.docType); put('B', pad6(ctx.number)); put('C', cut('Pedido ' + o.number, 50)); put('D', dmy(ctx.date)); put('E', 0);
  put('H', Number(c.factusol_code) || null); put('I', cut(c.name, 50)); put('J', cut(c.address, 100)); put('K', cut(c.city, 30)); put('L', cut(c.postal_code, 10)); put('M', cut(c.province, 40)); put('N', cut(c.tax_id, 18));
  put('O', 0); put('P', 0); put('R', base); put('AS', base); put('AV', 21); put('AY', iva); put('BJ', total);
  if (ctx.payCode) put('BK', cut(ctx.payCode, 3));
  put('BN', cut('Pedido nº ' + o.number + (o.title ? ' · ' + o.title : ''), 100)); put('BT', cut('Pedido ' + o.number, 50)); put('BU', cut(String(o.number), 20)); put('BV', dmy(o.order_date));
  put('DD', 0); put('DE', dmy(ctx.date));
  return { facRows: [FAC_HEAD, fac], lfaRows: [LFA_HEAD, ...lines], base, iva, total, warnings, lineCount: lines.length };
}
module.exports = { build, FAC_HEAD, LFA_HEAD };
