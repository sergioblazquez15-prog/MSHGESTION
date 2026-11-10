'use strict';
/* Lector mínimo de .xlsx (primera hoja) y .csv sin dependencias. Devuelve filas de textos. */
const zlib = require('zlib');

function unzip(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('El archivo no es un Excel (.xlsx) válido');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const ln = buf.readUInt16LE(lo + 26), lx = buf.readUInt16LE(lo + 28), ds = lo + 30 + ln + lx;
    const raw = buf.subarray(ds, ds + csize);
    if (/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
const unesc = s => s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, g) => g[0] === '#' ? String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[g]));
const textOf = x => { let t = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(x))) t += unesc(m[1]); return t; };
const colIdx = ref => ref.replace(/\d+/g, '').split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;

function readXlsx(buf) {
  const z = unzip(buf);
  if (!z['xl/workbook.xml']) throw new Error('El archivo no es un Excel (.xlsx) válido');
  const shared = [];
  if (z['xl/sharedStrings.xml']) { const re = /<si>([\s\S]*?)<\/si>|<si\/>/g; let m; const x = z['xl/sharedStrings.xml'].toString('utf8'); while ((m = re.exec(x))) shared.push(m[1] ? textOf(m[1]) : ''); }
  // primera hoja según el libro
  let target = 'xl/worksheets/sheet1.xml';
  const wb = z['xl/workbook.xml'].toString('utf8'), rels = (z['xl/_rels/workbook.xml.rels'] || Buffer.alloc(0)).toString('utf8');
  const sh = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb);
  if (sh) { const rm = new RegExp('<Relationship\\b[^>]*Id="' + sh[1] + '"[^>]*>').exec(rels); const t = rm && /Target="([^"]+)"/.exec(rm[0]); if (t) target = t[1].startsWith('/') ? t[1].slice(1) : 'xl/' + t[1]; }
  const sx = z[target] || z['xl/worksheets/sheet1.xml'];
  if (!sx) throw new Error('No se encontró la hoja del Excel');
  const x = sx.toString('utf8'), rows = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g; let rm;
  while ((rm = rowRe.exec(x))) {
    const cells = []; const cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
    while ((cm = cre.exec(rm[1] || ''))) {
      const at = cm[1], body = cm[2] || '';
      const ref = /\br="([A-Z]+\d+)"/.exec(at), type = /\bt="([^"]+)"/.exec(at);
      const ci = ref ? colIdx(ref[1]) : cells.length;
      let v = '';
      if (type && type[1] === 'inlineStr') v = textOf(body);
      else { const vm = /<v>([\s\S]*?)<\/v>/.exec(body); if (vm) v = type && type[1] === 's' ? (shared[+vm[1]] || '') : unesc(vm[1]); }
      cells[ci] = String(v).trim();
    }
    rows.push(Array.from(cells, c => c || ''));
  }
  return rows;
}

function readCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const d = [';', ',', '\t'].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cur.trim()); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows;
}
module.exports = { readXlsx, readCsv };
