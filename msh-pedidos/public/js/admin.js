'use strict';
/* ===== Panel de administración ===== */
const A = { orders: [], clients: [], filter: 'todos', client: '', sort: 'prio', histClient: '', histQ: '', cat: null, catClient: null, prodSel: new Set() };

const ADMIN_VIEWS = {
  async orders(rest) { return rest[0] ? A.detail(+rest[0]) : A.list(); },
  async hist() { return A.hist(); },
  async new(rest) { return A.newOrder(rest[0]); },
  async detail(rest) { return A.detail(+rest[0]); },
  async edit(rest) { return A.editOrder(+rest[0]); },
  async clients() { return A.clientList(); },
  async client(rest) { return A.clientEdit(+rest[0]); },
  async catalog(rest) { return A.catalog(rest[0]); },
  async prod() { return A.production(); },
  async stats() { return ST.view(); },
  async tasks() { return TK.view(); },
  async comercial(rest) { return CM.view(rest); },
  async phases() { return A.template(); },
  async settings() { return A.settings(); }
};

const sel = (id, opts, cur, extra) => `<select id="${id}" ${extra || ''}>${opts.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(cur) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
const clientOpts = (all) => [...(all ? [['', 'Todos los clientes']] : []), ...A.clients.filter(c => c.active || all).map(c => [c.id, c.name])];
async function loadClients() { A.clients = await api('GET', '/api/clients'); }

/* ---------- listado de pedidos activos ---------- */
A.list = async function () {
  const [orders] = await Promise.all([api('GET', '/api/orders?scope=active'), loadClients()]);
  A.orders = orders;
  return { html: A.listHTML(), after: A.badge };
};
A.badge = function () {
  const b = $('badge-orders');
  const n = A.orders.filter(o => o.status === 'Recibido').length;
  if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
};
A.visible = function () {
  let rows = A.orders.slice();
  if (A.client) rows = rows.filter(o => String(o.client_id) === String(A.client));
  if (A.filter === 'sin') rows = rows.filter(o => o.status === 'Recibido');
  else if (A.filter !== 'todos') rows = rows.filter(o => stKey(o.status) === A.filter);
  rows.sort((a, b) => A.sort === 'prio' ? (a.est_delivery < b.est_delivery ? -1 : a.est_delivery > b.est_delivery ? 1 : a.id - b.id) : b.id - a.id);
  return rows;
};
A.listHTML = function () {
  const all = A.orders, urgent = all.filter(o => diffDays(o.est_delivery, S.today) <= 7).length;
  const cnt = s => all.filter(o => o.status === s).length;
  const chips = [['todos', 'Todos'], ['sin', 'Sin recepcionar'], ['Procesando', 'Procesando'], ['Listo', 'Listo para recoger']];
  return `<h1>Pedidos</h1><p class="sub">Los pedidos entregados pasan solos al histórico.</p>
  <div class="kpis"><div class="kpi"><div class="n">${all.length}</div><div class="l">Pedidos activos</div></div>
   <div class="kpi"><div class="n">${cnt('Recibido')}</div><div class="l">Sin recepcionar</div></div>
   <div class="kpi"><div class="n">${cnt('Procesando')}</div><div class="l">Procesando</div></div>
   <div class="kpi"><div class="n" style="color:${urgent ? 'var(--red)' : 'inherit'}">${urgent}</div><div class="l">Entrega en 7 días o menos</div></div></div>
  <div class="panel"><div class="bar"><div class="chips">${chips.map(c => `<button class="chip ${A.filter === c[0] ? 'on' : ''}" onclick="A.filter='${c[0]}';A.redrawList()">${c[1]}</button>`).join('')}</div>
   <span style="margin-left:auto" class="row">${sel('f-client', clientOpts(true), A.client, 'onchange="A.client=this.value;A.redrawList()"')}
   ${sel('f-sort', [['prio', 'Más urgentes primero'], ['new', 'Más recientes primero']], A.sort, 'onchange="A.sort=this.value;A.redrawList()"')}
   <button class="btn amber sm" onclick="go('new')">+ Nuevo pedido</button></span></div>
  <div id="tbl">${A.tableHTML()}</div></div>`;
};
A.redrawList = function () { $('main').innerHTML = A.listHTML(); };
A.tableHTML = function () {
  const rows = A.visible();
  if (!rows.length) return `<div class="empty">${A.orders.length ? 'No hay pedidos con este filtro.' : 'Todavía no hay pedidos. Cuando un cliente envíe uno, aparecerá aquí.'}</div>`;
  return `<div style="overflow-x:auto"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Fase</th><th>Entrega estimada</th><th>Estado</th><th class="r">Total</th><th class="r">Total con IVA</th><th>Facturación</th></tr></thead><tbody>
  ${rows.map(o => `<tr class="${diffDays(o.est_delivery, S.today) <= 7 ? 'urgent' : ''}" style="cursor:pointer" onclick="go('orders/${o.id}')">
   <td><b>#${o.number}</b>${o.title ? ' · ' + esc(o.title) : ''}<br><span class="mini">${o.units} uds</span>${o.origin === 'admin' ? ' <span class="tag adm">MSH</span>' : ''}</td>
   <td><div class="cc">${shieldHTML(o)}${esc(o.client_name)}</div></td><td style="white-space:nowrap">${fmt(o.order_date)}</td>
   <td style="min-width:170px"><div class="mini" style="margin-bottom:5px">${esc(phName(o))}</div>${seg(o)}</td>
   <td>${prioPill(o)}</td><td><span class="st ${stKey(o.status)}">${esc(o.status)}</span></td>${A.amountCells(o)}<td>${A.billPill(o, true)}</td></tr>`).join('')}</tbody>${A.sumRow(rows, 6)}</table></div>`;
};

/* ---------- albaranes de entrega ---------- */
A.deliveryPanel = o => `<div class="panel" id="dl-panel"><div class="ph"><h2>Albaranes de entrega</h2></div><div class="pb"><div class="mini">Cargando…</div></div></div>`;
A.dlLoad = async function () {
  const box = $('dl-panel'); if (!box) return;
  try { A.dl = await api('GET', `/api/orders/${A.o.id}/deliveries`); A.dl.draft = {}; box.innerHTML = A.dlHTML(); }
  catch (e) { box.querySelector('.pb').innerHTML = '<div class="mini">No se pudieron cargar los albaranes: ' + esc(e.message) + '</div>'; }
};
A.dlHTML = function () {
  const d = A.dl, items = d.items, pend = items.reduce((a, i) => a + i.pending, 0);
  const sz = i => [i.size ? 'talla ' + i.size : '', i.color].filter(Boolean).join(' · ');
  const grp = [], seen = new Map();
  items.forEach(i => {
    const k = i.kind === 'pack' ? 'p' + i.group_no : 'loose';
    if (!seen.has(k)) { seen.set(k, { title: i.kind === 'pack' ? i.pack_name : 'Productos sueltos', rows: [] }); grp.push(seen.get(k)); }
    seen.get(k).rows.push(i);
  });
  const row = i => { const n = items.indexOf(i); return `<tr><td>${esc(i.product_name)}${i.kind === 'free' ? ' <span class="mini">(fuera de catálogo)</span>' : ''}${i.detail ? `<div class="mini">${esc(i.detail)}</div>` : ''}<div class="mini">${esc(sz(i))}</div></td>
    <td class="r">${i.ordered}</td><td class="r">${i.delivered}</td><td class="r"><b>${i.pending}</b></td>
    <td class="r">${i.pending ? `<input type="number" class="dlq" min="0" max="${i.pending}" value="${A.dl.draft[i.key] || 0}" style="width:64px" onchange="A.dlSet(${n},this)">` : '<span class="pill-on">✓</span>'}</td></tr>`; };
  const prev = d.deliveries.map(x => `<div class="sumrow"><span><b>${esc(x.code)}</b> · ${fmt(x.delivered_at)} · ${x.units} uds${x.delivered_by ? ' · ' + esc(x.delivered_by) : ''}</span>
    <span class="btnrow"><a class="btn ghost sm" style="text-decoration:none" target="_blank" href="/albaran.html?id=${x.id}">Imprimir</a><button class="x" onclick="A.dlDel(${x.id},'${esc(x.code)}')">Eliminar</button></span></div>`).join('');
  return `<div class="ph"><h2>Albaranes de entrega</h2><span class="mini">Sin importes · parciales</span></div><div class="pb">
   <p class="hint" style="margin-top:0">Pon cuántas unidades entregas ahora de cada artículo. El albarán sale sin precios y con lo que queda pendiente.</p>
   ${pend ? `<div class="tblwrap"><table style="min-width:520px"><thead><tr><th style="min-width:200px">Artículo</th><th class="r">Pedidas</th><th class="r">Ya entregadas</th><th class="r">Pendientes</th><th class="r">Entregar ahora</th></tr></thead><tbody>
    ${grp.map(g => `<tr class="grp"><td colspan="5"><b>${esc(g.title)}</b></td></tr>${g.rows.map(row).join('')}`).join('')}</tbody></table></div>
   <div class="row" style="margin-top:12px;align-items:flex-end"><div class="field" style="margin:0"><label>Fecha de entrega</label><input type="date" id="dl-date" value="${S.today}"></div>
    <div class="field" style="margin:0;flex:1;min-width:180px"><label>Observaciones (opcional)</label><input type="text" id="dl-notes" style="width:100%"></div></div>
   <div class="btnrow" style="margin-top:12px"><button class="btn ghost" onclick="A.dlAll()">Entregar todo lo pendiente</button><button class="btn amber" onclick="A.dlCreate()">Crear albarán</button></div>`
   : '<div class="notice">Todo lo pedido ya está entregado en albaranes.</div>'}
   ${prev ? `<h4 style="margin:20px 0 6px">Albaranes ya creados</h4>${prev}` : ''}</div>`;
};
A.dlSet = (n, el) => { const i = A.dl.items[n]; let v = Math.max(0, Math.min(i.pending, parseInt(el.value, 10) || 0)); el.value = v; A.dl.draft[i.key] = v; };
A.dlAll = () => { A.dl.items.forEach(i => { A.dl.draft[i.key] = i.pending; }); const keep = [$('dl-date').value, $('dl-notes').value]; $('dl-panel').innerHTML = A.dlHTML(); $('dl-date').value = keep[0]; $('dl-notes').value = keep[1]; };
A.dlCreate = async () => safe(async () => {
  const lines = Object.keys(A.dl.draft).map(key => ({ key, qty: A.dl.draft[key] })).filter(l => l.qty > 0);
  if (!lines.length) throw new Error('Pon al menos una unidad en «Entregar ahora»');
  const r = await api('POST', `/api/orders/${A.o.id}/deliveries`, { lines, delivered_at: $('dl-date').value, notes: $('dl-notes').value });
  toast('Albarán creado'); window.open('/albaran.html?id=' + r.id, '_blank'); A.reload();
});
A.dlDel = async (id, code) => { if (!confirm('¿Eliminar el albarán ' + code + '? Sus unidades vuelven a quedar pendientes.')) return; await safe(async () => { await api('DELETE', '/api/deliveries/' + id); toast('Albarán eliminado'); A.reload(); }); };

/* ---------- exportar a FactuSOL ---------- */
A.factusolPanel = o => `<h4 style="margin:18px 0 8px">Pasar a FactuSOL</h4><div id="fs-box"><span class="mini">Comprobando…</span></div>`;
A.fsLoad = async function () {
  const box = $('fs-box'); if (!box) return;
  try {
    const r = await api('GET', `/api/orders/${A.o.id}/factusol`);
    const inv = r.invoice;
    box.innerHTML = `${r.issues.length ? `<div class="notice" style="margin-bottom:10px">${r.issues.map(esc).join('<br>')}</div>` : ''}
     <p class="hint" style="margin:0 0 10px">${inv ? 'Factura reservada: <b>' + esc(inv.code) + '</b>. Si vuelves a descargar, mantiene el mismo número.' : 'Al descargar se reserva el número <b>' + esc(r.next_code) + '</b>.'}</p>
     <div class="btnrow"><button class="btn amber sm" ${r.blocking ? 'disabled style="opacity:.5"' : ''} onclick="A.fsExport()">Descargar para FactuSOL (FAC + LFA)</button>${inv ? '<button class="btn ghost sm" onclick="A.fsRelease()">Anular número</button>' : ''}</div>`;
  } catch (e) { box.innerHTML = '<span class="mini">' + esc(e.message) + '</span>'; }
};
A.fsExport = async () => safe(async () => {
  const res = await fetch(`/api/orders/${A.o.id}/factusol`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  if (!res.ok) { let m = 'No se pudo exportar'; try { m = (await res.json()).error || m; } catch (e) { /* */ } throw new Error(m); }
  const blob = await res.blob(), code = res.headers.get('X-Invoice') || 'factura', warn = decodeURIComponent(res.headers.get('X-Warnings') || '');
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'factusol-' + code + '.zip';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(warn ? 'Descargado con avisos: ' + warn : 'Descargado: factura ' + code, !!warn);
  A.fsLoad();
});
A.fsRelease = async () => { if (!confirm('¿Anular el número reservado de este pedido? Solo se libera si fue el último.')) return; await safe(async () => { const r = await api('DELETE', `/api/orders/${A.o.id}/factusol`); toast(r.released ? 'Número liberado' : 'Anulado (el número no se reutiliza porque ya hay otro después)'); A.reload(); }); };

A.sumRow = (rows, span) => {
  const t = rows.reduce((a, o) => a + (o.total || 0), 0), ti = rows.reduce((a, o) => a + (o.total_iva || 0), 0);
  return `<tfoot><tr><td colspan="${span}" style="text-align:right"><b>Suma de los ${rows.length} pedidos mostrados</b></td><td class="r" style="white-space:nowrap">${money(t)}</td><td class="r" style="white-space:nowrap"><b>${money(ti)}</b></td><td colspan="2"></td></tr></tfoot>`;
};
A.amountCells = o => {
  const warn = o.unpriced ? ` <span class="mini" title="${o.unpriced} línea(s) sin precio: el total no es definitivo" style="color:var(--accent)">*</span>` : '';
  return `<td class="r" style="white-space:nowrap">${o.total == null ? '–' : money(o.total) + warn}</td><td class="r" style="white-space:nowrap"><b>${o.total_iva == null ? '–' : money(o.total_iva)}</b></td>`;
};
A.billPill = (o, short) => o.invoiced
  ? `<span class="bill ok">Facturado${!short && o.invoice_number ? ' · ' + esc(o.invoice_number) : ''}</span>`
  : `<span class="bill pend">${short ? 'Sin facturar' : 'Pendiente de facturar'}</span>`;

/* ---------- histórico ---------- */
A.hist = async function () {
  const [orders] = await Promise.all([api('GET', '/api/orders?scope=delivered'), loadClients()]);
  A.delivered = orders;
  return { html: A.histHTML() };
};
A.histRows = function () {
  const q = A.histQ.trim().toLowerCase();
  return A.delivered.filter(o => (!A.histClient || String(o.client_id) === String(A.histClient)) &&
    (!q || ('#' + o.number + ' ' + o.title + ' ' + o.client_name + ' ' + o.lines.map(l => l.product_name).join(' ')).toLowerCase().includes(q)))
    .sort((a, b) => (b.delivered_at || '').localeCompare(a.delivered_at || '') || b.id - a.id);
};
A.histHTML = function () {
  return `<h1>Histórico</h1><p class="sub">Pedidos entregados. No se borra nada.</p>
  <div class="panel"><div class="bar"><input type="text" id="hq" placeholder="Buscar por nº, cliente o artículo" value="${esc(A.histQ)}" style="min-width:260px" oninput="A.histQ=this.value;A.histRedraw()">
   <span style="margin-left:auto">${sel('hc', clientOpts(true), A.histClient, 'onchange="A.histClient=this.value;A.histRedraw()"')}</span></div><div id="htbl">${A.histTable()}</div></div>`;
};
A.histRedraw = function () { $('htbl').innerHTML = A.histTable(); };
A.histTable = function () {
  const rows = A.histRows();
  if (!rows.length) return '<div class="empty">No hay pedidos entregados con este filtro.</div>';
  return `<div style="overflow-x:auto"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Entregado</th><th class="r">Total</th><th class="r">Total con IVA</th><th>Facturación</th><th>Documentos</th></tr></thead><tbody>
  ${rows.map(o => `<tr style="cursor:pointer" onclick="go('orders/${o.id}')"><td><b>#${o.number}</b>${o.title ? ' · ' + esc(o.title) : ''} <span class="mini">${o.units} uds</span></td>
   <td><div class="cc">${shieldHTML(o)}${esc(o.client_name)}</div></td><td>${fmt(o.order_date)}</td><td>${fmt(o.delivered_at)}</td>${A.amountCells(o)}<td>${A.billPill(o, true)}</td>
   <td>${['albaran', 'factura'].map(k => `<span class="pdf ${o.docs.some(d => d.kind === k) ? 'ok' : ''}">${k === 'albaran' ? 'Albarán' : 'Factura'}</span>`).join(' ')}</td></tr>`).join('')}</tbody>${A.sumRow(rows, 4)}</table></div>`;
};

/* ---------- ficha de pedido ---------- */
A.detail = async function (id) {
  const o = await api('GET', '/api/orders/' + id);
  A.o = o;
  return { html: A.detailHTML(o), after: () => { PE.init(o.phases, o, { enable: true, onChange: () => { $('ph-save').disabled = false; } }); $('ph-edit').innerHTML = PE.html(); PE.mount(); A.dlLoad(); A.fsLoad(); } };
};
A.detailHTML = function (o) {
  const fin = o.status === 'Entregado';
  return `<span class="crumb" onclick="go('${fin ? 'hist' : 'orders'}')">← ${fin ? 'Histórico' : 'Pedidos'}</span>
  <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:18px"><div class="row" style="gap:16px">${crestHTML({ name: o.client_name, crest: o.client_crest, color: o.client_color }, true)}
   <div><h1>${esc(ordTitle(o))}</h1><div class="sub" style="margin:6px 0 0">${esc(o.client_name)} · ${fmt(o.order_date)}${o.channel ? ' · ' + esc(o.channel) : ''}${o.origin === 'admin' ? ' · introducido por MSH' : ' · enviado por el cliente'}</div></div></div>
   <span class="row" style="gap:10px">${A.billPill(o)}<span class="st ${stKey(o.status)}" style="font-size:14px">${esc(o.status)}</span></span></div>
  <div class="panel"><div class="ph"><h2>Datos del pedido</h2></div><div class="pb"><div class="row" style="align-items:flex-end">
   <div class="field" style="margin:0;width:120px"><label>Nº de pedido</label><input type="number" min="1" id="m-num" value="${o.number}" style="width:100%"></div>
   <div class="field" style="margin:0;flex:1;min-width:220px"><label>Título o detalle</label><input type="text" id="m-title" value="${esc(o.title || '')}" placeholder="Ej. Tallaje Encinas" style="width:100%"></div>
   <button class="btn amber" onclick="A.saveMeta()">Guardar</button><button class="btn ghost" onclick="go('edit/${o.id}')">Editar artículos y fecha</button></div></div></div>
  <div class="panel"><div class="ph"><h2>Seguimiento</h2><span class="btnrow"><a class="btn ghost sm" style="text-decoration:none" target="_blank" href="/print.html?id=${o.id}">Exportar PDF</a>
   <button class="btn ghost sm" onclick="A.adv(-1)" ${o.status === 'Recibido' && !o.cur ? 'disabled style="opacity:.4"' : ''}>← Fase anterior</button>
   <button class="btn amber sm" onclick="A.adv(1)" ${fin ? 'disabled style="opacity:.4"' : ''}>Avanzar fase →</button></span></div>
   <div class="pb">${gantt(o)}
   <div class="row" style="margin-top:16px"><span class="mini">Cambiar estado:</span>${STATUSES.map(s => `<button class="chip ${o.status === s ? 'on' : ''}" onclick="A.setStatus('${s}')">${s}</button>`).join('')}</div>
   <p class="hint" style="margin-bottom:0">Cada cambio avisa por correo al cliente.</p>
   <div class="row" style="margin-top:14px"><span class="mini">El cliente ve:</span><button class="chip ${o.client_view === 'estado' ? 'on' : ''}" onclick="A.setView('estado')">Solo el estado</button><button class="chip ${o.client_view === 'cronograma' ? 'on' : ''}" onclick="A.setView('cronograma')">El cronograma completo</button></div></div></div>
  <div class="grid2"><div>
   <div class="panel"><div class="ph"><h2>Artículos · ${o.units} uds</h2><span class="btnrow"><button class="btn ghost sm" onclick="go('edit/${o.id}')">Editar pedido</button></span></div><div class="pb">${linesHTML(o)}${o.notes ? `<p class="hint"><b>Notas:</b> ${esc(o.notes)}</p>` : ''}</div></div>
   ${A.deliveryPanel ? A.deliveryPanel(o) : ''}
   <div class="panel"><div class="ph"><h2>Documentos del pedido</h2></div><div class="pb">${A.docsHTML(o)}</div></div></div>
  <div><div class="panel"><div class="ph"><h2>Facturación</h2>${A.billPill(o)}</div><div class="pb">
    <p class="hint" style="margin-top:0">${o.invoiced ? 'Este pedido está facturado' + (o.invoiced_at ? ' desde el ' + fmt(o.invoiced_at) : '') + '.' : 'Se marca solo como facturado al subir la factura en PDF. También puedes marcarlo a mano.'}</p>
    <div class="btnrow"><button class="btn ${o.invoiced ? 'ghost' : 'amber'} sm" onclick="A.setInvoiced(${o.invoiced ? 'false' : 'true'})">${o.invoiced ? 'Marcar como pendiente de facturar' : 'Marcar como facturado'}</button></div>
    ${A.factusolPanel ? A.factusolPanel(o) : ''}</div></div>
   <div class="panel"><div class="ph"><h2>Historial</h2></div><div class="pb">${o.log.map(l => `<div class="logline"><span class="t">${esc(l.at.slice(0, 16))}</span><span>${esc(l.what)}${l.by_user ? ' <span class="mini">· ' + esc(l.by_user) + '</span>' : ''}</span></div>`).join('')}</div></div>
   <div class="panel"><div class="ph"><h2>Zona delicada</h2></div><div class="pb"><button class="btn danger sm" onclick="A.delOrder()">Borrar pedido</button><p class="hint">Solo para pedidos duplicados o de prueba. Se borran también sus documentos.</p></div></div></div></div>
  <div class="panel"><div class="ph"><h2>Fases y plazos de este pedido</h2></div><div class="pb">
   <div class="field" style="max-width:240px"><label>Fecha del pedido</label><input type="date" id="ph-date" value="${o.order_date}" onchange="PE.s.base.order_date=this.value;PE.prev();$('ph-save').disabled=false"></div>
   <div id="ph-edit"></div><div class="btnrow" style="margin-top:14px"><button class="btn amber" id="ph-save" disabled onclick="A.savePhases()">Guardar fases</button>
   <button class="btn ghost" onclick="A.resetPhases()">Restaurar la plantilla general</button></div></div></div>`;
};
A.docsHTML = function (o) {
  const row = (k, label, accept) => {
    const ds = o.docs.filter(d => d.kind === k);
    return `<div class="box"><h4>${label}</h4>${ds.map(d => `<div class="sumrow" style="padding:6px 0"><a href="/api/docs/${d.id}" style="color:var(--ink)">${esc(d.filename)}</a><button class="x" onclick="A.delDoc(${d.id})">Quitar</button></div>`).join('') || '<div class="mini" style="margin-bottom:8px">Sin subir</div>'}
    <input type="file" accept="${accept || 'application/pdf'}" id="file-${k}" onchange="A.upload('${k}')"></div>`;
  };
  return `<p class="hint" style="margin-top:0">El pedido inicial es solo para ti (foto, PDF o Excel) y el cliente no lo ve. El albarán y la factura van en PDF desde FactuSOL y el cliente los descarga desde su panel.</p>${row('pedido', 'Pedido inicial del cliente (para cotejar)', 'image/*,.pdf,.xls,.xlsx,.csv')}${row('albaran', 'Albarán')}${row('factura', 'Factura')}`;
};
A.reload = function () { route(); };
A.setInvoiced = async (on) => safe(async () => { await api('POST', `/api/orders/${A.o.id}/invoiced`, { invoiced: on }); toast(on ? 'Marcado como facturado' : 'Marcado como pendiente de facturar'); A.reload(); });
A.saveMeta = async () => safe(async () => {
  await api('POST', `/api/orders/${A.o.id}/meta`, { number: $('m-num').value, title: $('m-title').value });
  toast('Datos guardados'); A.reload();
});
A.setView = async (v) => safe(async () => { await api('POST', `/api/orders/${A.o.id}/view`, { client_view: v }); toast(v === 'estado' ? 'El cliente verá solo el estado' : 'El cliente verá el cronograma completo'); A.reload(); });
A.adv = async (dir) => safe(async () => { await api('POST', `/api/orders/${A.o.id}/advance`, { dir }); toast('Actualizado'); A.reload(); });
A.setStatus = async (st) => safe(async () => { await api('POST', `/api/orders/${A.o.id}/status`, { status: st }); toast('Estado: ' + st); A.reload(); });
A.delOrder = async () => { if (!confirm('¿Borrar el ' + ordTitle(A.o) + ' para siempre?')) return; await safe(async () => { await api('DELETE', '/api/orders/' + A.o.id); toast('Pedido borrado'); go('orders'); }); };
A.savePhases = async () => safe(async () => {
  const phases = PE.collect();
  await api('PUT', `/api/orders/${A.o.id}/phases`, { phases, order_date: $('ph-date').value });
  toast('Fases guardadas'); A.reload();
});
A.resetPhases = async () => {
  if (!confirm('Se sustituirán las fases de este pedido por las de la plantilla general. ¿Seguir?')) return;
  await safe(async () => {
    const tpl = await api('GET', '/api/phase-template');
    await api('PUT', `/api/orders/${A.o.id}/phases`, { phases: tpl.map(p => ({ ...p, enabled: true })), order_date: A.o.order_date });
    toast('Plantilla aplicada'); A.reload();
  });
};
A.upload = async (kind) => {
  const f = $('file-' + kind).files[0];
  if (!f) return;
  await safe(async () => {
    const fd = new FormData(); fd.append('kind', kind); fd.append('file', f);
    await api('POST', `/api/orders/${A.o.id}/docs`, fd);
    toast('Documento subido'); A.reload();
  });
};
A.delDoc = async (id) => { if (!confirm('¿Quitar este documento?')) return; await safe(async () => { await api('DELETE', '/api/docs/' + id); A.reload(); }); };

/* ---------- nuevo pedido / editar pedido ---------- */
A.newOrder = async function (clientId) {
  await loadClients();
  const act = A.clients.filter(c => c.active);
  if (!act.length) return `<h1>Nuevo pedido</h1><div class="notice">Primero crea un cliente en la pestaña <b>Clientes</b>.</div>`;
  A.nc = clientId ? +clientId : (A.nc && act.some(c => c.id === A.nc) ? A.nc : act[0].id);
  A.cat = await api('GET', `/api/clients/${A.nc}/catalog`);
  OF.init({ cat: A.cat, admin: true, client: A.clients.find(c => c.id === A.nc) });
  let nn = ''; try { nn = (await api('GET', '/api/next-number')).number; } catch (e) { nn = ''; }
  return {
    html: `<h1>Nuevo pedido</h1><p class="sub">Introduce un pedido en nombre de un cliente, por ejemplo uno que llegó por correo o por teléfono.</p>
    <div class="panel"><div class="pb"><div class="grid2" style="gap:16px"><div class="field"><label>Cliente</label>${sel('n-client', clientOpts(false), A.nc, 'onchange="go(\'new/\'+this.value)"')}</div>
     <div class="field"><label>Fecha del pedido</label><input type="date" id="n-date" value="${S.today}"></div>
     <div class="field"><label>Cómo llegó</label>${sel('n-chan', ['Correo', 'Teléfono', 'WhatsApp', 'En persona', 'Otro'].map(x => [x, x]), 'Correo')}</div>
     <div class="field"><label>Nº de pedido</label><input type="number" min="1" id="n-num" placeholder="Automático: ${nn}"></div>
     <div class="field"><label>Título o detalle (opcional)</label><input type="text" id="n-title" placeholder="Ej. Tallaje Encinas"></div>
     <div class="field"><label>El cliente podrá ver</label>${sel('n-view', [['estado', 'Solo el estado del pedido'], ['cronograma', 'El cronograma completo']], 'estado')}</div>
     <div class="field"><label>Notas (opcional)</label><input type="text" id="n-notes"></div></div>
     <div class="field"><label>Pedido inicial del cliente, para cotejar (foto, PDF o Excel; el cliente no lo ve)</label><input type="file" id="n-files" multiple accept="image/*,.pdf,.xls,.xlsx,.csv"></div></div></div>
    ${OF.html()}
    <div class="sendbar sticky"><div><p>Total</p><strong><span id="of-count">0</span> artículos</strong></div><button class="btn amber" onclick="A.sendNew()">Crear pedido</button></div>`,
    after: () => OF.upd()
  };
};
A.sendNew = async () => safe(async () => {
  const lines = OF.collect();
  const o = await api('POST', '/api/orders', { client_id: A.nc, order_date: $('n-date').value, channel: $('n-chan').value, notes: $('n-notes').value, number: $('n-num').value, title: $('n-title').value, client_view: $('n-view').value, lines });
  const files = [...$('n-files').files];
  let failed = 0;
  for (const f of files) {
    try { const fd = new FormData(); fd.append('kind', 'pedido'); fd.append('file', f); await api('POST', `/api/orders/${o.id}/docs`, fd); } catch (e) { failed++; }
  }
  toast(ordTitle(o) + ' creado' + (failed ? '. ' + failed + ' archivo(s) no se pudieron subir; súbelos desde el pedido.' : ''), !!failed);
  go('orders/' + o.id);
});
A.editOrder = async function (id) {
  const o = await api('GET', '/api/orders/' + id);
  A.o = o;
  const cat = await api('GET', `/api/clients/${o.client_id}/catalog`);
  OF.init({ cat, admin: true, client: { allow_packs: 1, allow_products: 1, allow_free: 1 }, order: o });
  return {
    html: `<span class="crumb" onclick="go('orders/${o.id}')">← ${esc(ordTitle(o))}</span><h1>Editar pedido</h1><p class="sub">${esc(o.client_name)}. Los cambios no avisan al cliente.</p>
    <div class="panel"><div class="pb"><div class="grid2" style="gap:16px"><div class="field"><label>Nº de pedido</label><input type="number" min="1" id="e-num" value="${o.number}"></div>
     <div class="field"><label>Título o detalle</label><input type="text" id="e-title" value="${esc(o.title || '')}" placeholder="Ej. Tallaje Encinas"></div>
     <div class="field"><label>Fecha del pedido</label><input type="date" id="e-date" value="${o.order_date}"></div>
     <div class="field"><label>Cómo llegó</label><input type="text" id="e-chan" value="${esc(o.channel || '')}"></div>
     <div class="field"><label>El cliente podrá ver</label>${sel('e-view', [['estado', 'Solo el estado del pedido'], ['cronograma', 'El cronograma completo']], o.client_view)}</div></div>
     <div class="field"><label>Notas</label><textarea id="e-notes">${esc(o.notes || '')}</textarea></div></div></div>
    ${OF.html()}
    <div class="sendbar sticky"><div><p>Total</p><strong><span id="of-count">${OF.count()}</span> artículos</strong></div><button class="btn amber" onclick="A.saveEdit()">Guardar cambios</button></div>`,
    after: () => OF.upd()
  };
};
A.saveEdit = async () => safe(async () => {
  const lines = OF.collect();
  await api('PUT', '/api/orders/' + A.o.id, { number: $('e-num').value, title: $('e-title').value, client_view: $('e-view').value, order_date: $('e-date').value, channel: $('e-chan').value, notes: $('e-notes').value, lines });
  toast('Pedido guardado'); go('orders/' + A.o.id);
});

/* ---------- clientes ---------- */
A.cSort = (() => { try { return localStorage.getItem('msh_csort') || 'manual'; } catch (e) { return 'manual'; } })();
A.sortedClients = function () {
  const a = A.clients.slice(), byName = (x, y) => x.name.localeCompare(y.name, 'es', { sensitivity: 'base' });
  const byDate = (x, y) => String(x.created_at).localeCompare(String(y.created_at)) || x.id - y.id;
  switch (A.cSort) {
    case 'az': return a.sort(byName);
    case 'za': return a.sort((x, y) => byName(y, x));
    case 'old': return a.sort(byDate);
    case 'new': return a.sort((x, y) => byDate(y, x));
    case 'active': return [...a.filter(c => c.active_orders > 0), ...a.filter(c => !(c.active_orders > 0))];
    default: return a;
  }
};
A.clientCards = function () {
  const list = A.sortedClients(), manual = A.cSort === 'manual';
  if (!list.length) return '<div class="empty panel">Aún no hay clientes. Crea el primero con el botón de arriba.</div>';
  return `<div class="cardgrid">${list.map((c, i) => `<div class="ccard" onclick="go('client/${c.id}')"><div class="row" style="gap:14px">${crestHTML(c, true)}<div><div style="font-family:var(--serif);font-size:21px">${esc(c.name)}</div>
    <div class="mini">${c.active ? '' : '<span class="pill-off">Desactivado · </span>'}${c.users_n} ${c.users_n === 1 ? 'usuario' : 'usuarios'} · ${c.active_orders} ${c.active_orders === 1 ? 'pedido activo' : 'pedidos activos'}</div></div></div>
    <div class="row">${c.can_order ? '' : '<span class="tag">Solo consulta</span>'}${c.can_order && c.allow_packs ? '<span class="tag">Packs</span>' : ''}${c.can_order && c.allow_products ? '<span class="tag">Productos</span>' : ''}${c.can_order && c.allow_free ? '<span class="tag">Línea libre</span>' : ''}</div>
    ${manual ? `<div class="arrows"><button class="x" ${i === 0 ? 'disabled style="opacity:.35"' : ''} onclick="event.stopPropagation();A.moveClient(${c.id},-1)" aria-label="Subir">◀ Antes</button><button class="x" ${i === list.length - 1 ? 'disabled style="opacity:.35"' : ''} onclick="event.stopPropagation();A.moveClient(${c.id},1)" aria-label="Bajar">Después ▶</button></div>` : ''}</div>`).join('')}</div>`;
};
A.setCSort = function (v) {
  A.cSort = v;
  try { localStorage.setItem('msh_csort', v); } catch (e) { /* no pasa nada */ }
  $('cl-cards').innerHTML = A.clientCards();
};
A.moveClient = async (id, d) => safe(async () => {
  const a = A.clients, i = a.findIndex(c => c.id === id), j = i + d;
  if (i < 0 || j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  $('cl-cards').innerHTML = A.clientCards();
  await api('PUT', '/api/client-order', { ids: a.map(c => c.id) });
});
A.clientList = async function () {
  await loadClients();
  const opts = [['manual', 'Mi orden (con flechas)'], ['az', 'Alfabético A → Z'], ['za', 'Alfabético Z → A'], ['old', 'Más antiguos primero'], ['new', 'Más recientes primero'], ['active', 'Con pedidos activos primero']];
  return `<h1>Clientes</h1><p class="sub">Cada cliente tiene su propio portal, su escudo, su catálogo y sus usuarios.</p>
  <div class="toolbar"><button class="btn amber" onclick="A.newClient()">+ Nuevo cliente</button>
   <span class="grow row"><span class="mini">Ordenar</span>${sel('cl-sort', opts, A.cSort, 'onchange="A.setCSort(this.value)"')}</span></div>
  <div id="cl-cards">${A.clientCards()}</div>`;
};
A.newClient = async () => {
  const name = prompt('Nombre del cliente (por ejemplo, el club):');
  if (!name || !name.trim()) return;
  await safe(async () => { const c = await api('POST', '/api/clients', { name: name.trim() }); go('client/' + c.id); });
};
A.clientEdit = async function (id) {
  await loadClients();
  const c = A.clients.find(x => x.id === id);
  if (!c) throw new Error('Cliente no encontrado');
  const [users, com] = await Promise.all([api('GET', `/api/clients/${id}/users`), api('GET', `/api/clients/${id}/commercial`)]);
  A.c = c;
  return `<span class="crumb" onclick="go('clients')">← Clientes</span>
  <div class="row" style="gap:16px;margin-bottom:22px">${crestHTML(c, true)}<h1>${esc(c.name)}</h1></div>
  <div class="grid2"><div>
   <div class="panel"><div class="ph"><h2>Datos y portal</h2></div><div class="pb">
    <div class="field"><label>Nombre</label><input type="text" id="c-name" value="${esc(c.name)}"></div>
    <div class="field"><label>Color del escudo (si no hay imagen)</label><input type="color" id="c-color" value="${esc(c.color)}" style="width:60px;height:36px;padding:2px;border-radius:10px;background:var(--bg3);border:1px solid var(--line2)"></div>
    <div class="field"><label>Escudo o logotipo (PNG, JPG o WEBP, máx. 2 MB)</label><input type="file" id="c-crest" accept="image/png,image/jpeg,image/webp" onchange="A.crest()"></div>
    <div class="field"><label class="cfgbox"><input type="checkbox" id="c-order" ${c.can_order ? 'checked' : ''}> Puede hacer pedidos desde su portal</label>
     <p class="hint" style="margin:6px 0 0">Si lo desmarcas, el cliente solo entra a ver sus pedidos. Lo que ve de cada uno (solo el estado o el cronograma completo) lo eliges en el propio pedido.</p></div>
    <div class="field"><label>Si puede pedir, qué puede pedir</label>
     <label class="cfgbox"><input type="checkbox" id="c-packs" ${c.allow_packs ? 'checked' : ''}> Packs del catálogo</label>
     <label class="cfgbox" style="margin-top:6px"><input type="checkbox" id="c-prods" ${c.allow_products ? 'checked' : ''}> Productos sueltos del catálogo</label>
     <label class="cfgbox" style="margin-top:6px"><input type="checkbox" id="c-free" ${c.allow_free ? 'checked' : ''}> Líneas libres (fuera de catálogo)</label></div>
    <div class="field"><label class="cfgbox"><input type="checkbox" id="c-active" ${c.active ? 'checked' : ''}> Cliente activo (puede entrar y pedir)</label></div>
    <h4 style="margin:18px 0 10px">Datos de facturación (FactuSOL)</h4>
    <p class="hint" style="margin-top:0">El código es el que tiene el cliente en FactuSOL (por ejemplo 7). Sin él no se puede exportar su factura. La dirección sale también en el albarán de entrega.</p>
    <div class="field"><label>Código de cliente en FactuSOL</label><input type="text" id="c-fcode" inputmode="numeric" maxlength="6" value="${esc(c.factusol_code)}" style="width:140px"></div>
    <div class="field"><label>NIF / CIF</label><input type="text" id="c-tax" value="${esc(c.tax_id)}"></div>
    <div class="field"><label>Dirección</label><input type="text" id="c-addr" value="${esc(c.address)}"></div>
    <div class="field"><label>Código postal</label><input type="text" id="c-postal" value="${esc(c.postal_code)}" style="width:140px"></div>
    <div class="field"><label>Población</label><input type="text" id="c-city" value="${esc(c.city)}"></div>
    <div class="field"><label>Provincia</label><input type="text" id="c-prov" value="${esc(c.province)}"></div>
    <div class="field"><label>Persona de contacto</label><input type="text" id="c-cname" value="${esc(c.contact_name)}"></div>
    <div class="field"><label>Teléfono</label><input type="text" id="c-phone" value="${esc(c.phone)}"></div>
    <div class="field"><label>Correo</label><input type="text" id="c-mail" value="${esc(c.email)}"></div>
    <div class="btnrow"><button class="btn amber" onclick="A.saveClient()">Guardar</button><button class="btn ghost" onclick="go('catalog/${c.id}')">Editar su catálogo</button><button class="btn ghost" onclick="go('new/${c.id}')">Crear pedido</button></div></div></div>
   ${c.total_orders ? '' : `<div class="panel"><div class="ph"><h2>Zona delicada</h2></div><div class="pb"><button class="btn danger sm" onclick="A.delClient()">Borrar cliente</button><p class="hint">Solo se puede borrar un cliente sin pedidos.</p></div></div>`}</div>
  ${com ? `<div class="panel"><div class="ph"><h2>Historial comercial</h2><span class="mini">Antes de ser cliente</span></div><div class="pb">${com.log.map(l => `<div class="logline"><span class="t">${esc(fmt(l.at))}</span><span><b>${esc(l.via)}</b>${l.notes ? ' · ' + esc(l.notes) : ''}${l.by_user ? ` <span class="mini">· ${esc(l.by_user)}</span>` : ''}</span></div>`).join('') || '<div class="mini">Sin contactos anotados.</div>'}</div></div>` : ''}
  <div class="panel"><div class="ph"><h2>Usuarios con acceso</h2></div><div class="pb">
   ${users.map(u => `<div class="sumrow"><span>${esc(u.email)}<br><span class="mini">${esc(u.name || '')} · ${u.active ? '<span class="pill-on">Activo</span>' : '<span class="pill-off">Desactivado</span>'}</span></span>
     <span class="btnrow"><button class="x" onclick="A.userPass(${u.id})">Nueva contraseña</button><button class="x" onclick="A.userToggle(${u.id},${u.active ? 0 : 1})">${u.active ? 'Desactivar' : 'Activar'}</button><button class="x" onclick="A.userDel(${u.id})">Borrar</button></span></div>`).join('') || '<div class="mini" style="margin-bottom:10px">Todavía no hay usuarios.</div>'}
   <h4 style="margin:18px 0 10px">Añadir usuario</h4>
   <div class="field"><label>Correo</label><input type="text" id="u-email" inputmode="email"></div>
   <div class="field"><label>Nombre (opcional)</label><input type="text" id="u-name"></div>
   <div class="field"><label>Contraseña (mínimo 8 caracteres)</label><input type="text" id="u-pass"></div>
   <button class="btn amber" onclick="A.addUser()">Crear usuario</button></div></div></div>`;
};
A.saveClient = async () => safe(async () => {
  await api('PUT', '/api/clients/' + A.c.id, { name: $('c-name').value, color: $('c-color').value, allow_packs: $('c-packs').checked, allow_products: $('c-prods').checked, allow_free: $('c-free').checked, can_order: $('c-order').checked, active: $('c-active').checked, factusol_code: $('c-fcode').value, tax_id: $('c-tax').value, address: $('c-addr').value, postal_code: $('c-postal').value, city: $('c-city').value, province: $('c-prov').value, contact_name: $('c-cname').value, phone: $('c-phone').value, email: $('c-mail').value });
  toast('Cliente guardado'); A.reload();
});
A.crest = async () => {
  const f = $('c-crest').files[0]; if (!f) return;
  await safe(async () => { const fd = new FormData(); fd.append('file', f); await api('POST', `/api/clients/${A.c.id}/crest`, fd); toast('Escudo actualizado'); A.reload(); });
};
A.delClient = async () => { if (!confirm('¿Borrar el cliente «' + A.c.name + '» y su catálogo?')) return; await safe(async () => { await api('DELETE', '/api/clients/' + A.c.id); go('clients'); }); };
A.addUser = async () => safe(async () => {
  await api('POST', `/api/clients/${A.c.id}/users`, { email: $('u-email').value, name: $('u-name').value, password: $('u-pass').value });
  toast('Usuario creado'); A.reload();
});
A.userPass = async (id) => { const p = prompt('Nueva contraseña (mínimo 8 caracteres):'); if (!p) return; await safe(async () => { await api('PUT', '/api/users/' + id, { password: p }); toast('Contraseña cambiada'); }); };
A.userToggle = async (id, active) => safe(async () => { await api('PUT', '/api/users/' + id, { active: !!active }); A.reload(); });
A.userDel = async (id) => { if (!confirm('¿Borrar este usuario?')) return; await safe(async () => { await api('DELETE', '/api/users/' + id); A.reload(); }); };

/* ---------- catálogo ---------- */
let _kid = 0;
const kid = () => ++_kid;
A.catalog = async function (clientId) {
  await loadClients();
  if (!A.clients.length) return `<h1>Catálogo</h1><div class="notice">Primero crea un cliente en la pestaña <b>Clientes</b>.</div>`;
  A.catClient = clientId ? +clientId : (A.catClient && A.clients.some(c => c.id === A.catClient) ? A.catClient : A.clients[0].id);
  const cat = await api('GET', `/api/clients/${A.catClient}/catalog`);
  // Estado editable con ids locales estables
  const fin = cat.finishes.map(f => ({ id: kid(), name: f.name, asks_value: f.asks_value, value_label: f.value_label, price: f.price == null ? '' : f.price, code: f.code || '' }));
  const prod = cat.products.map(p => ({ id: kid(), name: p.name, photo: p.photo || '', sizes: p.sizes, price: p.price == null ? '' : p.price, code: p.code || '', finishes: { ...p.finishes } }));
  const pack = cat.packs.map(p => ({ id: kid(), name: p.name, price: p.price == null ? '' : p.price, code: p.code || '', items: p.items.map(n => (prod.find(x => x.name === n) || {}).id).filter(Boolean) }));
  A.K = { fin, prod, pack, dirty: false };
  return { html: `<h1>Catálogo</h1><p class="sub">Lo que cada cliente puede pedir: acabados, productos y packs. Solo lo edita MSH.</p>
   <div class="toolbar">${sel('cat-client', clientOpts(false), A.catClient, 'onchange="go(\'catalog/\'+this.value)"')}<span class="grow"><button class="btn amber" id="cat-save" onclick="A.saveCat()" disabled>Guardar catálogo</button></span></div>
   <div id="cat-body">${A.catHTML()}</div>` };
};
A.dirty = () => { A.K.dirty = true; const b = $('cat-save'); if (b) b.disabled = false; };
A.catHTML = function () {
  const K = A.K;
  const finBox = `<div class="panel"><div class="ph"><h2>1. Acabados</h2></div><div class="pb">
   <p class="hint" style="margin-top:0">Lo que se le puede hacer a una prenda: escudo, dorsal, publicidad… Si el acabado pide un dato (el número del dorsal, unas iniciales), márcalo. El precio del acabado se suma por unidad solo cuando es opcional y se elige; los acabados fijos van incluidos en el precio del producto.</p>
   ${K.fin.map((f, i) => `<div class="row" style="margin-bottom:8px"><input type="text" style="min-width:200px" placeholder="Nombre del acabado" value="${esc(f.name)}" oninput="A.renFin(${i},this.value)" onchange="A.catRefresh()">
     <label class="cfgbox"><input type="checkbox" ${f.asks_value ? 'checked' : ''} onchange="A.K.fin[${i}].asks_value=this.checked;A.dirty();A.catRefresh()"> Pide un dato</label>
     ${f.asks_value ? `<input type="text" style="width:150px" placeholder="Qué dato (ej. Nº dorsal)" value="${esc(f.value_label)}" oninput="A.K.fin[${i}].value_label=this.value;A.dirty()">` : ''}
     <input type="number" step="0.01" min="0" style="width:120px" placeholder="+ € / ud" title="Suplemento por unidad cuando el acabado es opcional y se elige" value="${esc(f.price)}" oninput="A.K.fin[${i}].price=this.value;A.dirty()">
     <input type="text" style="width:110px" maxlength="13" placeholder="Código (auto)" title="Código de artículo en FactuSOL. Déjalo vacío y se genera solo." value="${esc(f.code)}" oninput="A.K.fin[${i}].code=this.value;A.dirty()">
     <button class="x" onclick="A.rm('fin',${i})">✕</button></div>`).join('')}
   <button class="btn ghost sm" onclick="A.addFin()">+ Añadir acabado</button></div></div>`;
  const names = K.fin.filter(f => f.name.trim());
  const prodBox = `<div class="panel"><div class="ph"><h2>2. Productos</h2></div><div class="pb">
   <p class="hint" style="margin-top:0">Tallas separadas por comas. Para cada acabado: <b>No</b> (no se puede poner), <b>Fijo</b> (siempre lo lleva) u <b>Opcional</b> (el cliente decide).</p>
   ${K.prod.map((p, i) => `<div class="box"><div class="row" style="margin-bottom:10px"><input type="text" style="min-width:210px;flex:1" placeholder="Nombre del producto" value="${esc(p.name)}" oninput="A.K.prod[${i}].name=this.value;A.dirty()" onchange="A.catRefresh()">
     <input type="text" style="width:220px" placeholder="Tallas: S,M,L,XL" value="${esc(p.sizes)}" oninput="A.K.prod[${i}].sizes=this.value;A.dirty()">
     <input type="number" step="0.01" min="0" style="width:96px" placeholder="Precio €" value="${esc(p.price)}" oninput="A.K.prod[${i}].price=this.value;A.dirty()">
     <input type="text" style="width:110px" maxlength="13" placeholder="Código (auto)" title="Código de artículo en FactuSOL. Déjalo vacío y se genera solo." value="${esc(p.code)}" oninput="A.K.prod[${i}].code=this.value;A.dirty()"><button class="x" onclick="A.rm('prod',${i})">✕</button></div>
     <div class="freephoto" style="margin-bottom:12px">${thumb(p.photo, true)}<label class="btn ghost sm" for="pp-${i}">${p.photo ? 'Cambiar foto' : '📷 Añadir foto del producto'}</label><input type="file" id="pp-${i}" accept="image/*" hidden onchange="A.prodPhoto(${i},this)">${p.photo ? `<button class="x" onclick="A.K.prod[${i}].photo='';A.dirty();A.catRefresh()">Quitar foto</button>` : ''}</div>
     <div class="matrix">${names.map(f => `<label>${esc(f.name)}<select class="${p.finishes[f.name] === 'fixed' ? 'fix' : p.finishes[f.name] === 'optional' ? 'cfg' : ''}" onchange="A.setMode(${i},'${f.id}',this.value,this)">
       ${[['', 'No'], ['fixed', 'Fijo'], ['optional', 'Opcional']].map(m => `<option value="${m[0]}" ${(p.finishes[f.name] || '') === m[0] ? 'selected' : ''}>${m[1]}</option>`).join('')}</select></label>`).join('') || '<span class="mini">Añade acabados arriba para configurarlos aquí.</span>'}</div></div>`).join('')}
   <button class="btn ghost sm" onclick="A.addProd()">+ Añadir producto</button></div></div>`;
  const packBox = `<div class="panel"><div class="ph"><h2>3. Packs</h2></div><div class="pb">
   <p class="hint" style="margin-top:0">Un pack es un conjunto de productos. Al pedirlo, el cliente elige talla y acabados de cada uno.</p>
   ${K.pack.map((p, i) => `<div class="box"><div class="row" style="margin-bottom:10px"><input type="text" style="min-width:210px;flex:1" placeholder="Nombre del pack" value="${esc(p.name)}" oninput="A.K.pack[${i}].name=this.value;A.dirty()">
     <input type="number" step="0.01" min="0" style="width:96px" placeholder="Precio €" value="${esc(p.price)}" oninput="A.K.pack[${i}].price=this.value;A.dirty()">
     <input type="text" style="width:110px" maxlength="13" placeholder="Código (auto)" title="Código de artículo en FactuSOL. Déjalo vacío y se genera solo." value="${esc(p.code)}" oninput="A.K.pack[${i}].code=this.value;A.dirty()"><button class="x" onclick="A.rm('pack',${i})">✕</button></div>
     ${K.prod.filter(x => x.name.trim()).length ? `<div class="chips">${K.prod.filter(x => x.name.trim()).map(x => `<label class="chip ${p.items.includes(x.id) ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" hidden ${p.items.includes(x.id) ? 'checked' : ''} onchange="A.togglePackItem(${i},${x.id},this.checked,this)">${esc(x.name)}</label>`).join('')}</div>` : '<span class="mini">Añade productos arriba.</span>'}</div>`).join('')}
   <button class="btn ghost sm" onclick="A.addPack()">+ Añadir pack</button></div></div>`;
  return finBox + prodBox + packBox;
};
A.catRefresh = function () { $('cat-body').innerHTML = A.catHTML(); };
A.renFin = (i, v) => {
  const old = A.K.fin[i].name;
  A.K.fin[i].name = v;
  A.K.prod.forEach(p => { if (old in p.finishes && old !== v) { p.finishes[v] = p.finishes[old]; delete p.finishes[old]; } });
  A.dirty();
};
A.addFin = () => { A.K.fin.push({ id: kid(), name: '', asks_value: false, value_label: '', price: '', code: '' }); A.dirty(); A.catRefresh(); };
A.addProd = () => { A.K.prod.push({ id: kid(), name: '', photo: '', sizes: '', price: '', code: '', finishes: {} }); A.dirty(); A.catRefresh(); };
A.addPack = () => { A.K.pack.push({ id: kid(), name: '', price: '', code: '', items: [] }); A.dirty(); A.catRefresh(); };
A.prodPhoto = async (i, input) => {
  const f = input.files[0]; if (!f) return;
  await safe(async () => { toast('Subiendo foto…'); A.K.prod[i].photo = await uploadPhoto(f); A.dirty(); A.catRefresh(); toast('Foto añadida. Pulsa «Guardar catálogo».'); });
};
A.rm = (k, i) => { A.K[k].splice(i, 1); A.dirty(); A.catRefresh(); };
A.setMode = (pi, fid, mode, el) => {
  const f = A.K.fin.find(x => String(x.id) === String(fid));
  if (mode) A.K.prod[pi].finishes[f.name] = mode; else delete A.K.prod[pi].finishes[f.name];
  el.className = mode === 'fixed' ? 'fix' : mode === 'optional' ? 'cfg' : '';
  A.dirty();
};
A.togglePackItem = (pi, prodId, on, el) => {
  const items = A.K.pack[pi].items, k = items.indexOf(prodId);
  if (on && k < 0) items.push(prodId); else if (!on && k >= 0) items.splice(k, 1);
  el.parentElement.classList.toggle('on', on); A.dirty();
};
A.saveCat = async () => safe(async () => {
  const K = A.K, byId = new Map(K.prod.map(p => [p.id, p.name.trim()]));
  const body = {
    finishes: K.fin.map(f => ({ name: f.name.trim(), asks_value: f.asks_value, value_label: f.value_label, price: f.price, code: f.code })),
    products: K.prod.map(p => ({ name: p.name.trim(), photo: p.photo, sizes: p.sizes, price: p.price, code: p.code, finishes: p.finishes })),
    packs: K.pack.map(p => ({ name: p.name.trim(), price: p.price, code: p.code, items: p.items.map(id => byId.get(id)).filter(Boolean) }))
  };
  await api('PUT', `/api/clients/${A.catClient}/catalog`, body);
  toast('Catálogo guardado'); A.reload();
});

/* ---------- producción ---------- */
A.production = async function () {
  await loadClients();
  A.pq = A.pq || { client: '', scope: 'active', tab: 'art', sel: [] };
  return { html: `<h1>Producción</h1><p class="sub">Lo que hay que preparar: por artículo, por acabado o por pedido. Sirve para pasar el trabajo al diseñador o al estampador.</p>
   <div class="toolbar">${sel('p-client', clientOpts(true), A.pq.client, 'onchange="A.pq.client=this.value;A.pq.sel=[];A.prodLoad()"')}
   ${sel('p-scope', [['active', 'Pedidos sin entregar'], ['all', 'Todos los pedidos']], A.pq.scope, 'onchange="A.pq.scope=this.value;A.pq.sel=[];A.prodLoad()"')}
   <span class="grow"><a class="btn ghost sm" id="p-csv" style="text-decoration:none;display:inline-block" href="#">Descargar CSV</a></span></div>
   <div class="tabs" id="p-tabs"></div><div id="p-body"><div class="empty">Cargando…</div></div>`, after: A.prodLoad };
};
A.prodQuery = function () {
  const q = new URLSearchParams();
  if (A.pq.client) q.set('client', A.pq.client);
  if (A.pq.tab === 'sel' && A.pq.sel.length) q.set('orders', A.pq.sel.join(','));
  else q.set('scope', A.pq.scope);
  return q.toString();
};
A.prodLoad = async function () {
  await safe(async () => {
    const base = new URLSearchParams(); if (A.pq.client) base.set('client', A.pq.client); base.set('scope', A.pq.scope);
    A.pbase = await api('GET', '/api/production?' + base.toString());
    A.pdata = A.pq.tab === 'sel' && A.pq.sel.length ? await api('GET', '/api/production?' + A.prodQuery()) : A.pbase;
    A.prodDraw();
  });
};
A.prodTab = (t) => { A.pq.tab = t; if (t === 'sel') A.prodLoad(); else { A.pdata = A.pbase; A.prodDraw(); } };
A.prodDraw = function () {
  const d = A.pdata, T = [['art', 'Por artículo'], ['fin', 'Por acabado'], ['ord', 'Por pedido'], ['sel', 'Varios pedidos']];
  $('p-tabs').innerHTML = T.map(t => `<button class="chip ${A.pq.tab === t[0] ? 'on' : ''}" onclick="A.prodTab('${t[0]}')">${t[1]}</button>`).join('');
  $('p-csv').href = '/api/production.csv?' + A.prodQuery();
  let h = '';
  if (A.pq.tab === 'art') {
    h = d.articles.length ? `<div class="panel"><table><thead><tr><th>Artículo</th><th>Talla</th><th>Unidades</th><th>Pedidos</th></tr></thead><tbody>${d.articles.map(a => `<tr><td>${esc(a.article)}</td><td>${esc(a.size) || '—'}</td><td><b>${a.qty}</b></td><td class="mini">${a.orders.map(x => '#' + x).join(' ')}</td></tr>`).join('')}</tbody></table></div>` : A.pEmpty();
  } else if (A.pq.tab === 'fin') {
    h = d.finishes.length ? d.finishes.map(f => `<div class="panel"><div class="ph"><h2>${esc(f.finish)}</h2><span class="tag">${f.qty} uds</span></div><div class="pb">
      <div class="chips" style="margin-bottom:${f.values.length ? 12 : 0}px">${f.by_product.map(p => `<span class="fin">${esc(p.product)} × ${p.qty}</span>`).join('')}</div>
      ${f.values.length ? `<table style="min-width:0"><thead><tr><th style="padding-left:0">Dato</th><th>Producto</th><th>Talla</th><th>Uds</th><th>Pedido</th></tr></thead><tbody>${f.values.map(v => `<tr><td style="padding-left:0"><b>${esc(v.value)}</b></td><td>${esc(v.product)}</td><td>${esc(v.size) || '—'}</td><td>${v.qty}</td><td>#${v.order_id}</td></tr>`).join('')}</tbody></table>` : ''}</div></div>`).join('') : A.pEmpty();
  } else if (A.pq.tab === 'ord') {
    h = d.orders.length ? d.orders.map(o => `<div class="panel"><div class="ph"><h2>${esc(ordTitle(o))} · ${esc(o.client_name)}</h2><span class="mini">${fmt(o.order_date)} · entrega ${fmt(o.est_delivery)}</span></div><div class="pb">${linesHTML(o)}</div></div>`).join('') : A.pEmpty();
  } else {
    const ids = A.pq.sel;
    h = `<div class="panel"><div class="ph"><h2>Elige los pedidos</h2></div><div class="pb"><div class="chips">${A.pbase.orders.map(o => `<label class="chip ${ids.includes(o.id) ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" hidden ${ids.includes(o.id) ? 'checked' : ''} onchange="A.pickOrder(${o.id},this.checked)">#${o.number}${o.title ? ' ' + esc(o.title) : ''} · ${esc(o.client_name)}</label>`).join('') || '<span class="mini">No hay pedidos.</span>'}</div></div></div>`;
    if (ids.length) {
      h += `<h3 style="font-family:var(--serif);font-weight:400;font-size:24px;margin:24px 0 12px">Resumen de ${ids.length} pedidos</h3>
      <div class="panel"><table><thead><tr><th>Artículo</th><th>Talla</th><th>Unidades</th></tr></thead><tbody>${d.articles.map(a => `<tr><td>${esc(a.article)}</td><td>${esc(a.size) || '—'}</td><td><b>${a.qty}</b></td></tr>`).join('')}</tbody></table></div>
      ${d.finishes.map(f => `<div class="panel"><div class="ph"><h2>${esc(f.finish)}</h2><span class="tag">${f.qty} uds</span></div><div class="pb"><div class="chips">${f.by_product.map(p => `<span class="fin">${esc(p.product)} × ${p.qty}</span>`).join('')}</div>${f.values.map(v => `<div class="sumrow"><span><b>${esc(v.value)}</b> · ${esc(v.product)} ${esc(v.size)}</span><span class="mini">#${v.order_id}</span></div>`).join('')}</div></div>`).join('')}`;
    }
  }
  $('p-body').innerHTML = h;
};
A.pEmpty = () => '<div class="empty panel">No hay nada que preparar con este filtro.</div>';
A.pickOrder = (id, on) => {
  const s = A.pq.sel, i = s.indexOf(id);
  if (on && i < 0) s.push(id); else if (!on && i >= 0) s.splice(i, 1);
  A.prodLoad();
};

/* ---------- plazos y fases (plantilla general) ---------- */
A.template = async function () {
  const tpl = await api('GET', '/api/phase-template');
  PE.init(tpl, { order_date: S.today, status: 'Recibido', cur: 0 }, { enable: false, onChange: () => { $('tpl-save').disabled = false; } });
  return { html: `<h1>Plazos y fases</h1><p class="sub">Las fases que se aplican a cada pedido nuevo. Después puedes cambiarlas pedido a pedido. Los pedidos que ya existen no cambian.</p>
   <div class="panel"><div class="pb">${PE.html()}<div class="btnrow" style="margin-top:14px"><button class="btn amber" id="tpl-save" disabled onclick="A.saveTemplate()">Guardar plantilla</button></div></div></div>`, after: () => PE.mount() };
};
A.saveTemplate = async () => safe(async () => {
  await api('PUT', '/api/phase-template', { phases: PE.collect() });
  toast('Plantilla guardada'); $('tpl-save').disabled = true;
});

/* ---------- ajustes ---------- */
A.settings = async function () {
  const [st, admins, mails] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/admins'), api('GET', '/api/emails')]);
  const f = (id, label, val, extra) => `<div class="field"><label>${label}</label><input type="text" id="${id}" value="${esc(val)}" ${extra || ''}></div>`;
  return `<h1>Ajustes</h1><p class="sub">Datos de empresa, facturación, correo, administradores y tu contraseña.</p>
  <div class="grid2"><div>
   <div class="panel"><div class="ph"><h2>Datos de la empresa</h2></div><div class="pb">
    <p class="hint" style="margin-top:0">Salen en la cabecera de los albaranes de entrega.</p>
    ${f('c-name', 'Razón social', st.company_name)}${f('c-cif', 'CIF', st.company_cif)}${f('c-addr', 'Dirección', st.company_address)}${f('c-postal', 'Código postal', st.company_postal)}${f('c-city', 'Población', st.company_city)}${f('c-phone', 'Teléfono (opcional)', st.company_phone)}${f('c-email', 'Correo (opcional)', st.company_email)}
    <h4 style="margin:18px 0 10px">Facturación (FactuSOL)</h4>
    ${f('i-doc', 'Tipo de documento / serie de la factura', st.invoice_doc_type)}${f('i-next', 'Siguiente número de factura', st.invoice_next)}${f('i-pay', 'Código de forma de pago en FactuSOL (opcional)', st.invoice_pay_code)}
    <div class="btnrow"><button class="btn amber" onclick="A.saveSettings()">Guardar</button><a class="btn ghost" style="text-decoration:none" href="/api/factusol/articles">Descargar códigos de artículo</a></div></div></div>
   <div class="panel"><div class="ph"><h2>Correo saliente</h2></div><div class="pb">
    <p class="hint" style="margin-top:0">Con esto la app avisa a los clientes en cada cambio. Usa los datos SMTP de tu proveedor de correo.</p>
    ${f('s-host', 'Servidor SMTP', st.smtp_host, 'placeholder="smtp.tuproveedor.com"')}${f('s-port', 'Puerto (587 o 465)', st.smtp_port)}${f('s-user', 'Usuario', st.smtp_user)}
    <div class="field"><label>Contraseña ${st.smtp_pass_set ? '(ya guardada; déjala vacía para no cambiarla)' : ''}</label><input type="text" id="s-pass" autocomplete="off" style="width:100%"></div>
    ${f('s-from', 'Remitente (ej. MSH Madrid &lt;pedidos@tudominio.com&gt;)', st.smtp_from)}
    ${f('s-notify', 'Avisarme a este correo cuando un cliente envíe un pedido', st.notify_email)}
    ${f('s-url', 'Dirección de la app (para el enlace de los correos)', st.public_url, 'placeholder="http://IP-del-servidor:3081"')}
    ${f('s-brand', 'Nombre que aparece en los correos', st.brand_name)}
    <div class="btnrow"><button class="btn amber" onclick="A.saveSettings()">Guardar</button></div>
    <h4 style="margin:22px 0 10px">Probar el envío</h4><div class="row"><input type="text" id="s-test" placeholder="Correo de destino" style="flex:1;min-width:200px"><button class="btn ghost" onclick="A.testMail()">Enviar prueba</button></div>
    <div id="s-testres" class="hint" style="margin-top:10px"></div></div></div>
   <div class="panel"><div class="ph"><h2>Últimos correos</h2></div><div class="pb">${mails.map(m => `<div class="logline"><span class="t">${esc(m.at.slice(0, 16))}</span><span>${m.ok ? '<span class="pill-on">✓</span>' : '<span class="pill-off">✕</span>'} ${esc(m.to_addr)} · ${esc(m.subject)}${m.error ? `<br><span class="mini" style="color:var(--red)">${esc(m.error)}</span>` : ''}</span></div>`).join('') || '<div class="mini">Todavía no se ha enviado ninguno.</div>'}</div></div></div>
  <div><div class="panel"><div class="ph"><h2>Administradores</h2></div><div class="pb">
    ${admins.map(a => `<div class="sumrow"><span>${esc(a.email)}<br><span class="mini">${esc(a.name || '')}</span></span><span class="mini">${a.active ? 'Activo' : 'Desactivado'}</span></div>`).join('')}
    <h4 style="margin:18px 0 10px">Añadir administrador</h4>${f('a-email', 'Correo', '')}${f('a-name', 'Nombre', '')}${f('a-pass', 'Contraseña (mínimo 8 caracteres)', '')}
    <button class="btn amber" onclick="A.addAdmin()">Crear administrador</button></div></div>
   <div class="panel"><div class="ph"><h2>Mi contraseña</h2></div><div class="pb">
    <div class="field"><label>Contraseña actual</label><input type="password" id="pw-cur" style="width:100%;border:1px solid var(--line2);border-radius:14px;padding:9px 12px;background:var(--bg3);color:var(--ink)"></div>
    <div class="field"><label>Nueva contraseña</label><input type="password" id="pw-new" style="width:100%;border:1px solid var(--line2);border-radius:14px;padding:9px 12px;background:var(--bg3);color:var(--ink)"></div>
    <button class="btn amber" onclick="changePassword()">Cambiar contraseña</button></div></div></div></div>`;
};
A.saveSettings = async () => safe(async () => {
  await api('PUT', '/api/settings', { smtp_host: $('s-host').value, smtp_port: $('s-port').value, smtp_user: $('s-user').value, smtp_pass: $('s-pass').value, smtp_from: $('s-from').value, notify_email: $('s-notify').value, public_url: $('s-url').value, brand_name: $('s-brand').value, company_name: $('c-name').value, company_cif: $('c-cif').value, company_address: $('c-addr').value, company_postal: $('c-postal').value, company_city: $('c-city').value, company_phone: $('c-phone').value, company_email: $('c-email').value, invoice_doc_type: $('i-doc').value, invoice_next: $('i-next').value, invoice_pay_code: $('i-pay').value });
  toast('Ajustes guardados'); A.reload();
});
A.testMail = async () => {
  const r = $('s-testres'); r.textContent = 'Enviando…';
  await safe(async () => {
    const out = await api('POST', '/api/settings/test-email', { to: $('s-test').value });
    r.innerHTML = out.ok ? '<span class="pill-on">Enviado. Revisa la bandeja de entrada.</span>' : '<span class="pill-off">No se pudo enviar: ' + esc(out.error || 'error desconocido') + '</span>';
  });
};
A.addAdmin = async () => safe(async () => {
  await api('POST', '/api/admins', { email: $('a-email').value, name: $('a-name').value, password: $('a-pass').value });
  toast('Administrador creado'); A.reload();
});
async function changePassword() {
  await safe(async () => {
    await api('POST', '/api/me/password', { current: $('pw-cur').value, next: $('pw-new').value });
    $('pw-cur').value = ''; $('pw-new').value = ''; toast('Contraseña cambiada');
  });
}
