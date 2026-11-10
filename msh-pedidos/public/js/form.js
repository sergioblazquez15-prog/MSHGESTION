'use strict';
/* ===== Formulario de pedido (cliente y administrador) =====
   Estado: packs[] (bloques con sus productos), prods[] (productos sueltos), free[] (líneas libres), legacy[] (líneas que ya no encajan en el catálogo). */
const OF = {
  s: null,

  init(o) {
    const cat = o.cat, admin = !!o.admin, c = o.client || {};
    const s = {
      cat, admin,
      perm: {
        packs: cat.packs.length > 0 && (admin || !!c.allow_packs),
        products: cat.products.length > 0 && (admin || !!c.allow_products),
        free: admin || !!c.allow_free
      },
      packs: [], prods: [], free: [], legacy: []
    };
    this.s = s;
    if (o.order) this.load(o.order);
    else if (s.perm.free && !s.perm.packs && !s.perm.products) s.free.push({ name: '', size: '', color: '', photo: '', qty: 1, price: '' });
  },

  prod(name) { return this.s.cat.products.find(p => p.name === name); },
  fin(name) { return this.s.cat.finishes.find(f => f.name === name) || { name, asks_value: false, value_label: '' }; },
  sizes(p) { return String(p.sizes || '').split(',').map(x => x.trim()).filter(Boolean); },

  newItem(name) {
    const p = this.prod(name);
    const fins = Object.keys(p.finishes).filter(n => p.finishes[n] === 'optional').map(n => {
      const f = this.fin(n);
      return { name: n, asks: !!f.asks_value, label: f.value_label || 'Dato', on: false, value: '', price: f.price == null ? '' : f.price };
    });
    return { product: name, size: '', color: '', fixed: Object.keys(p.finishes).filter(n => p.finishes[n] === 'fixed'), fins };
  },
  applyFinishes(item, saved) {
    (saved || []).forEach(sf => {
      const f = item.fins.find(x => x.name === sf.name);
      if (f && !sf.fixed) { f.on = true; f.value = sf.value || ''; if (this.s.admin) f.price = sf.price == null ? '' : sf.price; }
    });
  },

  load(order) {
    const s = this.s, groups = new Map();
    order.lines.forEach(l => {
      if (l.kind === 'pack') {
        const k = l.group_no;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(l);
      } else if (l.kind === 'product') {
        if (this.prod(l.product_name)) {
          const it = this.newItem(l.product_name); it.size = l.size || ''; it.color = l.color || ''; it.old = !l.color; this.applyFinishes(it, l.finishes);
          s.prods.push({ ...it, qty: l.qty, price: l.unit_price == null ? '' : l.unit_price });
        } else s.legacy.push(l);
      } else if (l.finishes && l.finishes.length) s.legacy.push(l);
      else s.free.push({ name: l.product_name, size: l.size || '', color: l.color || '', photo: l.photo || '', old: !l.color, qty: l.qty, price: l.unit_price == null ? '' : l.unit_price });
    });
    groups.forEach(lines => {
      const pk = s.cat.packs.find(p => p.name === lines[0].pack_name);
      if (!pk || lines.some(l => !this.prod(l.product_name))) { lines.forEach(l => s.legacy.push(l)); return; }
      s.packs.push({
        name: pk.name, qty: lines[0].qty, price: lines[0].pack_price == null ? '' : lines[0].pack_price,
        items: lines.map(l => { const it = this.newItem(l.product_name); it.size = l.size || ''; it.color = l.color || ''; it.old = !l.color; this.applyFinishes(it, l.finishes); return it; })
      });
    });
  },

  /* ---------- pintado ---------- */
  html() {
    const s = this.s;
    if (!s.perm.packs && !s.perm.products && !s.perm.free) {
      return '<div class="notice">Todavía no hay nada que puedas pedir desde aquí. Contacta con MSH.</div>';
    }
    return `<div id="of-body">${this.body()}</div>`;
  },
  body() {
    const s = this.s;
    let h = '';
    if (s.perm.packs) {
      h += `<div class="toolbar"><select id="of-packsel">${s.cat.packs.map(p => `<option>${esc(p.name)}</option>`).join('')}</select>
        <button type="button" class="btn amber" onclick="OF.addPack()">+ Añadir pack</button></div>`;
      h += s.packs.length ? s.packs.map((b, i) => this.packHTML(b, i)).join('') : '<div class="empty box">Aún no has añadido ningún pack.</div>';
    }
    if (s.perm.products) {
      h += `<div class="panel" style="margin-top:8px"><div class="ph"><h2>Productos sueltos</h2></div><div class="pb" style="padding-bottom:6px">
        <div class="toolbar"><select id="of-prodsel">${s.cat.products.map(p => `<option>${esc(p.name)}</option>`).join('')}</select>
        <button type="button" class="btn ghost sm" onclick="OF.addProd()">+ Añadir producto</button></div></div>
        ${s.prods.map((r, i) => this.prodHTML(r, i)).join('')}</div>`;
    }
    if (s.legacy.length) {
      h += `<div class="panel"><div class="ph"><h2>Líneas que ya no están en el catálogo</h2></div><div class="pb">
        <p class="hint">Se conservan tal cual. Puedes cambiar las unidades o quitarlas.</p>
        ${s.legacy.map((l, i) => `<div class="sumrow"><span>${l.pack_name ? esc(l.pack_name) + ' · ' : ''}${esc(l.product_name)} <span class="mini">${l.size ? '· talla ' + esc(l.size) : ''}</span> ${finChips(l.finishes)}</span>
        <span class="row"><input type="number" min="1" style="width:80px" value="${l.qty}" onchange="OF.s.legacy[${i}].qty=Math.max(1,+this.value||1);OF.upd()"><button type="button" class="x" onclick="OF.rmLegacy(${i})">✕</button></span></div>`).join('')}</div></div>`;
    }
    if (s.perm.free) {
      h += `<div class="panel"><div class="ph"><h2>Artículo fuera de catálogo</h2></div><div class="pb">
        <p class="hint" style="margin-top:0">Para algo que no está en la lista: escribe qué es, la talla, el color (obligatorio) y las unidades. Si quieres, añade una foto.</p>
        ${s.free.map((f, i) => `<div class="freeitem"><div class="free"><input type="text" placeholder="Descripción del artículo" value="${esc(f.name)}" oninput="OF.s.free[${i}].name=this.value">
          <input type="text" placeholder="Talla" value="${esc(f.size)}" oninput="OF.s.free[${i}].size=this.value">
          <input type="text" placeholder="Color (obligatorio)" value="${esc(f.color)}" oninput="OF.s.free[${i}].color=this.value">
          <input type="number" min="1" value="${f.qty}" onchange="OF.s.free[${i}].qty=Math.max(1,+this.value||1);OF.upd()">
          <button type="button" class="btn ghost sm" onclick="OF.dupFree(${i})" title="Copia esta línea justo debajo. Luego cambias la talla y las unidades.">Duplicar</button><button type="button" class="x" onclick="OF.rmFree(${i})" aria-label="Quitar">✕</button></div>
          <div class="freephoto">${s.admin ? `<span class="mini">Precio por unidad</span>${this.priceInput('OF.s.free[' + i + '].price', f.price)}` : ''}${thumb(f.photo, true)}<label class="btn ghost sm" for="ff-${i}">${f.photo ? 'Cambiar foto' : '📷 Añadir foto'}</label>
          <input type="file" id="ff-${i}" accept="image/*" hidden onchange="OF.freePhoto(${i},this)">${f.photo ? `<button type="button" class="x" onclick="OF.s.free[${i}].photo='';OF.redraw()">Quitar foto</button>` : ''}</div></div>`).join('')}
        <button type="button" class="btn ghost sm" onclick="OF.addFree()">+ Añadir línea</button></div></div>`;
    }
    if (s.admin) h += `<div class="totalbox"><div><span class="mini">Base imponible (precios sin IVA)</span><b id="of-total"></b><span class="mini" id="of-iva"></span></div><span class="mini" id="of-unpriced"></span></div>`;
    return h;
  },

  priceInput(path, val, ph) {
    return `<input type="number" class="price" min="0" step="0.01" inputmode="decimal" placeholder="${ph || 'Precio €'}" value="${val === '' || val == null ? '' : val}" oninput="${path}=this.value;OF.upd()">`;
  },

  itemFins(item, k, bi, ii) {
    const parts = item.fixed.map(n => `<span class="fixed" title="Viene incluido y no se puede quitar">${esc(n)}</span>`);
    item.fins.forEach((f, fi) => {
      parts.push(`<label class="cfgbox ${f.on ? 'on' : ''}"><input type="checkbox" ${f.on ? 'checked' : ''} onchange="OF.fon('${k}',${bi},${ii},${fi},this)"> ${esc(f.name)}
        ${f.asks ? `<input type="text" placeholder="${esc(f.label)}" value="${esc(f.value)}" oninput="OF.fval('${k}',${bi},${ii},${fi},this.value)">` : ''}${this.s.admin ? `<input type="number" class="price fprice" min="0" step="0.01" placeholder="+ €/ud" title="Suplemento por unidad" value="${f.price === '' || f.price == null ? '' : f.price}" oninput="OF.item('${k}',${bi},${ii}).fins[${fi}].price=this.value;OF.upd()">` : ''}</label>`);
    });
    return parts.length ? parts.join('') : '<span class="mini">Sin acabados</span>';
  },
  sizeSel(item, k, bi, ii) {
    const p = this.prod(item.product), sz = this.sizes(p);
    const color = `<input type="text" placeholder="Color (obligatorio)" value="${esc(item.color)}" oninput="OF.color('${k}',${bi},${ii},this.value)" style="width:100%;margin-top:6px">`;
    if (!sz.length) return '<span class="mini" style="padding-top:9px;display:block">Talla única</span>' + color;
    return `<select onchange="OF.size('${k}',${bi},${ii},this.value)"><option value="">Talla…</option>${sz.map(z => `<option ${z === item.size ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>` + color;
  },
  packHTML(b, i) {
    return `<div class="packbox"><div class="packhead"><div class="pn"><div class="packnum">${i + 1}</div><div><div style="font-weight:600;font-size:16px">${esc(b.name)}</div><div class="mini">${b.items.length} artículos por pack</div></div></div>
      <div class="row">${this.s.admin ? `<span class="mini">Precio del pack</span>${this.priceInput('OF.s.packs[' + i + '].price', b.price, '€ / pack')}` : ''}<span class="mini">Unidades</span><div class="stepper"><button type="button" onclick="OF.pqty(${i},-1)">−</button><input type="number" min="1" value="${b.qty}" onchange="OF.pset(${i},this.value)"><button type="button" onclick="OF.pqty(${i},1)">+</button></div></div></div>
      ${b.items.map((it, ii) => `<div class="itemrow"><div class="pname">${thumb((this.prod(it.product) || {}).photo)}${esc(it.product)}</div><div>${this.sizeSel(it, 'p', i, ii)}</div><div class="fins">${this.itemFins(it, 'p', i, ii)}</div></div>`).join('')}
      <div class="packfoot"><span class="mini">¿Otra talla u otro acabado? Duplica el pack y cámbialo.</span><span class="btnrow"><button type="button" class="btn ghost sm" onclick="OF.dup(${i})">Duplicar</button><button type="button" class="btn danger sm" onclick="OF.rmPack(${i})">Quitar</button></span></div></div>`;
  },
  prodHTML(r, i) {
    return `<div class="prodrow"><div style="font-weight:600">${thumb((this.prod(r.product) || {}).photo)}${esc(r.product)}</div><div>${this.sizeSel(r, 'q', i, 0)}</div>
      <div class="row"><input type="number" min="1" style="width:76px" value="${r.qty}" onchange="OF.s.prods[${i}].qty=Math.max(1,+this.value||1);OF.upd()"><button type="button" class="btn ghost sm" onclick="OF.dupProd(${i})" title="Copia esta línea justo debajo. Luego cambias la talla y las unidades.">Duplicar</button><button type="button" class="x" onclick="OF.rmProd(${i})" aria-label="Quitar">✕</button></div></div>
      ${this.s.admin ? `<div class="itemrow priceline"><span class="mini">Precio por unidad</span>${this.priceInput('OF.s.prods[' + i + '].price', r.price)}</div>` : ''}
      <div class="itemrow"><div class="fins">${this.itemFins(r, 'q', i, 0)}</div></div>`;
  },

  /* ---------- acciones ---------- */
  redraw() { const el = $('of-body'); if (el) el.innerHTML = this.body(); this.upd(); },
  upd() {
    const el = $('of-count'); if (el) el.textContent = this.count();
    if (this.s.admin) {
      const t = this.total(), a = $('of-total'), u = $('of-unpriced');
      if (a) a.textContent = money(t.total);
      const v = $('of-iva'); if (v) { const iva = Math.round(t.total * 21) / 100; v.innerHTML = 'IVA 21 %: ' + money(iva) + ' · <b style="display:inline;font-family:var(--sans);font-size:15px;color:var(--ink)">Total con IVA: ' + money(Math.round((t.total + iva) * 100) / 100) + '</b>'; }
      if (u) u.textContent = t.unpriced ? t.unpriced + (t.unpriced === 1 ? ' línea sin precio' : ' líneas sin precio') : '';
    }
  },
  total() {
    const s = this.s, n = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
    let total = 0, unpriced = 0;
    const fsum = it => it.fins.filter(f => f.on).reduce((a, f) => a + (n(f.price) || 0), 0);
    s.packs.forEach(b => {
      const p = n(b.price); if (p == null) unpriced++;
      total += b.qty * ((p || 0) + b.items.reduce((a, it) => a + fsum(it), 0));
    });
    s.prods.forEach(r => { const p = n(r.price); if (p == null) unpriced++; total += r.qty * ((p || 0) + fsum(r)); });
    s.free.filter(f => f.name.trim()).forEach(f => { const p = n(f.price); if (p == null) unpriced++; total += f.qty * (p || 0); });
    const seen = new Set();
    s.legacy.forEach(l => {
      const fs = (l.finishes || []).reduce((a, f) => a + (n(f.price) || 0), 0);
      if (l.kind === 'pack') {
        if (!seen.has(l.group_no)) { seen.add(l.group_no); if (n(l.pack_price) == null) unpriced++; total += l.qty * (n(l.pack_price) || 0); }
        total += l.qty * fs;
      } else { if (n(l.unit_price) == null) unpriced++; total += l.qty * ((n(l.unit_price) || 0) + fs); }
    });
    return { total: Math.round(total * 100) / 100, unpriced };
  },
  item(k, bi, ii) { return k === 'p' ? this.s.packs[bi].items[ii] : this.s.prods[bi]; },
  size(k, bi, ii, v) { this.item(k, bi, ii).size = v; },
  color(k, bi, ii, v) { this.item(k, bi, ii).color = v; },
  fon(k, bi, ii, fi, el) {
    const f = this.item(k, bi, ii).fins[fi];
    f.on = el.checked; el.closest('.cfgbox').classList.toggle('on', f.on);
    if (f.on) { const t = el.closest('.cfgbox').querySelector('input[type=text]'); if (t) t.focus(); }
  },
  fval(k, bi, ii, fi, v) { this.item(k, bi, ii).fins[fi].value = v; },
  addPack() {
    const name = $('of-packsel').value, pk = this.s.cat.packs.find(p => p.name === name);
    if (!pk) return;
    const items = pk.items.filter(n => this.prod(n)).map(n => this.newItem(n));
    if (!items.length) return toast('Este pack no tiene artículos. Revisa el catálogo.', true);
    this.s.packs.push({ name, qty: 1, items, price: pk.price == null ? '' : pk.price });
    this.redraw();
  },
  dup(i) { const c = JSON.parse(JSON.stringify(this.s.packs[i])); c.items.forEach(it => this.blankValues(it)); this.s.packs.splice(i + 1, 0, c); this.redraw(); },
  rmPack(i) { this.s.packs.splice(i, 1); this.redraw(); },
  pqty(i, d) { this.pset(i, this.s.packs[i].qty + d); },
  pset(i, v) { this.s.packs[i].qty = Math.max(1, parseInt(v, 10) || 1); this.redraw(); },
  addProd() {
    const name = $('of-prodsel').value;
    if (!this.prod(name)) return;
    this.s.prods.push({ ...this.newItem(name), qty: 1, price: this.prod(name).price == null ? '' : this.prod(name).price });
    this.redraw();
  },
  // Duplicar: se copia todo (talla, color, unidades, precio, acabados) salvo el dato del acabado (dorsal, iniciales…), que queda vacío
  blankValues(item) { item.fins.forEach(f => { f.value = ''; }); return item; },
  dupProd(i) { const c = this.blankValues(JSON.parse(JSON.stringify(this.s.prods[i]))); this.s.prods.splice(i + 1, 0, c); this.redraw(); },
  dupFree(i) { this.s.free.splice(i + 1, 0, JSON.parse(JSON.stringify(this.s.free[i]))); this.redraw(); },
  rmProd(i) { this.s.prods.splice(i, 1); this.redraw(); },
  addFree() { this.s.free.push({ name: '', size: '', color: '', photo: '', qty: 1, price: '' }); this.redraw(); },
  async freePhoto(i, input) {
    const f = input.files[0]; if (!f) return;
    try { toast('Subiendo foto…'); this.s.free[i].photo = await uploadPhoto(f); this.redraw(); toast('Foto añadida'); } catch (e) { toast(e.message, true); }
  },
  rmFree(i) { this.s.free.splice(i, 1); this.redraw(); },
  rmLegacy(i) { this.s.legacy.splice(i, 1); this.redraw(); },

  count() {
    const s = this.s;
    return s.packs.reduce((a, b) => a + b.qty * b.items.length, 0) + s.prods.reduce((a, r) => a + r.qty, 0)
      + s.free.filter(f => f.name.trim()).reduce((a, f) => a + f.qty, 0) + s.legacy.reduce((a, l) => a + l.qty, 0);
  },

  /* ---------- salida hacia la API ---------- */
  fins(item, label) {
    const out = item.fixed.map(n => ({ name: n, value: '', fixed: true }));
    item.fins.filter(f => f.on).forEach(f => {
      if (f.asks && !f.value.trim()) throw new Error('Falta «' + f.label + '» en ' + f.name + ' (' + label + ')');
      out.push(this.s.admin ? { name: f.name, value: f.asks ? f.value.trim() : '', fixed: false, price: f.price } : { name: f.name, value: f.asks ? f.value.trim() : '', fixed: false });
    });
    return out;
  },
  needSize(item, label) {
    if (this.sizes(this.prod(item.product)).length && !item.size) throw new Error('Elige la talla de «' + item.product + '»' + (label ? ' (' + label + ')' : ''));
    if (!String(item.color || '').trim() && !item.old) throw new Error('Indica el color de «' + item.product + '»' + (label ? ' (' + label + ')' : ''));
  },
  collect() {
    const s = this.s, out = [];
    const ad = s.admin;
    s.packs.forEach((b, i) => b.items.forEach(it => {
      const label = b.name + ', bloque ' + (i + 1);
      this.needSize(it, label);
      const row = { kind: 'pack', group_no: i + 1, pack_name: b.name, product_name: it.product, size: it.size, color: it.color.trim(), qty: b.qty, finishes: this.fins(it, label) };
      if (ad) row.pack_price = b.price;
      out.push(row);
    }));
    s.prods.forEach(r => {
      this.needSize(r, '');
      const row = { kind: 'product', group_no: 0, pack_name: null, product_name: r.product, size: r.size, color: r.color.trim(), qty: r.qty, finishes: this.fins(r, 'producto suelto') };
      if (ad) row.unit_price = r.price;
      out.push(row);
    });
    s.free.forEach(f => {
      if (!f.name.trim()) return;
      if (!f.color.trim() && !f.old) throw new Error('Indica el color de «' + f.name.trim() + '»');
      const row = { kind: 'free', group_no: 0, pack_name: null, product_name: f.name.trim(), size: f.size.trim(), color: f.color.trim(), photo: f.photo, qty: f.qty, finishes: [] };
      if (ad) row.unit_price = f.price;
      out.push(row);
    });
    s.legacy.forEach(l => out.push({
      kind: l.kind, group_no: l.kind === 'pack' ? 1000 + (l.group_no || 0) : 0, pack_name: l.pack_name, product_name: l.product_name,
      size: l.size, color: l.color || '', photo: l.photo || '', qty: l.qty, finishes: l.finishes,
      ...(ad ? { unit_price: l.unit_price, pack_price: l.pack_price } : {})
    }));
    if (!out.length) throw new Error('Añade al menos un artículo al pedido');
    return out;
  }
};
