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
  return `<table><thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Fase</th><th>Entrega estimada</th><th>Estado</th></tr></thead><tbody>
  ${rows.map(o => `<tr class="${diffDays(o.est_delivery, S.today) <= 7 ? 'urgent' : ''}" style="cursor:pointer" onclick="go('orders/${o.id}')">
   <td><b>#${o.id}</b> <span class="mini">${o.units} uds</span>${o.origin === 'admin' ? ' <span class="tag adm">MSH</span>' : ''}</td>
   <td><div class="cc">${shieldHTML(o)}${esc(o.client_name)}</div></td><td>${fmt(o.order_date)}</td>
   <td style="min-width:170px"><div class="mini" style="margin-bottom:5px">${esc(phName(o))}</div>${seg(o)}</td>
   <td>${prioPill(o)}</td><td><span class="st ${stKey(o.status)}">${esc(o.status)}</span></td></tr>`).join('')}</tbody></table>`;
};

/* ---------- histórico ---------- */
A.hist = async function () {
  const [orders] = await Promise.all([api('GET', '/api/orders?scope=delivered'), loadClients()]);
  A.delivered = orders;
  return { html: A.histHTML() };
};
A.histRows = function () {
  const q = A.histQ.trim().toLowerCase();
  return A.delivered.filter(o => (!A.histClient || String(o.client_id) === String(A.histClient)) &&
    (!q || ('#' + o.id + ' ' + o.client_name + ' ' + o.lines.map(l => l.product_name).join(' ')).toLowerCase().includes(q)))
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
  return `<table><thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Entregado</th><th>Documentos</th></tr></thead><tbody>
  ${rows.map(o => `<tr style="cursor:pointer" onclick="go('orders/${o.id}')"><td><b>#${o.id}</b> <span class="mini">${o.units} uds</span></td>
   <td><div class="cc">${shieldHTML(o)}${esc(o.client_name)}</div></td><td>${fmt(o.order_date)}</td><td>${fmt(o.delivered_at)}</td>
   <td>${['albaran', 'factura'].map(k => `<span class="pdf ${o.docs.some(d => d.kind === k) ? 'ok' : ''}">${k === 'albaran' ? 'Albarán' : 'Factura'}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table>`;
};

/* ---------- ficha de pedido ---------- */
A.detail = async function (id) {
  const o = await api('GET', '/api/orders/' + id);
  A.o = o;
  return { html: A.detailHTML(o), after: () => { PE.init(o.phases, o, { enable: true, onChange: () => { $('ph-save').disabled = false; } }); $('ph-edit').innerHTML = PE.html(); PE.mount(); } };
};
A.detailHTML = function (o) {
  const fin = o.status === 'Entregado';
  return `<span class="crumb" onclick="go('${fin ? 'hist' : 'orders'}')">← ${fin ? 'Histórico' : 'Pedidos'}</span>
  <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:18px"><div class="row" style="gap:16px">${crestHTML({ name: o.client_name, crest: o.client_crest, color: o.client_color }, true)}
   <div><h1>Pedido #${o.id}</h1><div class="sub" style="margin:6px 0 0">${esc(o.client_name)} · ${fmt(o.order_date)}${o.channel ? ' · ' + esc(o.channel) : ''}${o.origin === 'admin' ? ' · introducido por MSH' : ' · enviado por el cliente'}</div></div></div>
   <span class="st ${stKey(o.status)}" style="font-size:14px">${esc(o.status)}</span></div>
  <div class="panel"><div class="ph"><h2>Seguimiento</h2><span class="btnrow">
   <button class="btn ghost sm" onclick="A.adv(-1)" ${o.status === 'Recibido' && !o.cur ? 'disabled style="opacity:.4"' : ''}>← Fase anterior</button>
   <button class="btn amber sm" onclick="A.adv(1)" ${fin ? 'disabled style="opacity:.4"' : ''}>Avanzar fase →</button></span></div>
   <div class="pb">${gantt(o)}
   <div class="row" style="margin-top:16px"><span class="mini">Cambiar estado:</span>${STATUSES.map(s => `<button class="chip ${o.status === s ? 'on' : ''}" onclick="A.setStatus('${s}')">${s}</button>`).join('')}</div>
   <p class="hint" style="margin-bottom:0">Cada cambio avisa por correo al cliente.</p></div></div>
  <div class="grid2"><div>
   <div class="panel"><div class="ph"><h2>Artículos · ${o.units} uds</h2><span class="btnrow"><button class="btn ghost sm" onclick="go('edit/${o.id}')">Editar pedido</button></span></div><div class="pb">${linesHTML(o)}${o.notes ? `<p class="hint"><b>Notas:</b> ${esc(o.notes)}</p>` : ''}</div></div>
   <div class="panel"><div class="ph"><h2>Albarán y factura</h2></div><div class="pb">${A.docsHTML(o)}</div></div></div>
  <div><div class="panel"><div class="ph"><h2>Historial</h2></div><div class="pb">${o.log.map(l => `<div class="logline"><span class="t">${esc(l.at.slice(0, 16))}</span><span>${esc(l.what)}${l.by_user ? ' <span class="mini">· ' + esc(l.by_user) + '</span>' : ''}</span></div>`).join('')}</div></div>
   <div class="panel"><div class="ph"><h2>Zona delicada</h2></div><div class="pb"><button class="btn danger sm" onclick="A.delOrder()">Borrar pedido</button><p class="hint">Solo para pedidos duplicados o de prueba. Se borran también sus documentos.</p></div></div></div></div>
  <div class="panel"><div class="ph"><h2>Fases y plazos de este pedido</h2></div><div class="pb">
   <div class="field" style="max-width:240px"><label>Fecha del pedido</label><input type="date" id="ph-date" value="${o.order_date}" onchange="PE.s.base.order_date=this.value;PE.prev();$('ph-save').disabled=false"></div>
   <div id="ph-edit"></div><div class="btnrow" style="margin-top:14px"><button class="btn amber" id="ph-save" disabled onclick="A.savePhases()">Guardar fases</button>
   <button class="btn ghost" onclick="A.resetPhases()">Restaurar la plantilla general</button></div></div></div>`;
};
A.docsHTML = function (o) {
  const row = (k, label) => {
    const ds = o.docs.filter(d => d.kind === k);
    return `<div class="box"><h4>${label}</h4>${ds.map(d => `<div class="sumrow" style="padding:6px 0"><a href="/api/docs/${d.id}" style="color:var(--ink)">${esc(d.filename)}</a><button class="x" onclick="A.delDoc(${d.id})">Quitar</button></div>`).join('') || '<div class="mini" style="margin-bottom:8px">Sin subir</div>'}
    <input type="file" accept="application/pdf" id="file-${k}" onchange="A.upload('${k}')"></div>`;
  };
  return `<p class="hint" style="margin-top:0">Súbelos en PDF desde FactuSOL. El cliente los descarga desde su panel.</p>${row('albaran', 'Albarán')}${row('factura', 'Factura')}`;
};
A.reload = function () { route(); };
A.adv = async (dir) => safe(async () => { await api('POST', `/api/orders/${A.o.id}/advance`, { dir }); toast('Actualizado'); A.reload(); });
A.setStatus = async (st) => safe(async () => { await api('POST', `/api/orders/${A.o.id}/status`, { status: st }); toast('Estado: ' + st); A.reload(); });
A.delOrder = async () => { if (!confirm('¿Borrar el pedido #' + A.o.id + ' para siempre?')) return; await safe(async () => { await api('DELETE', '/api/orders/' + A.o.id); toast('Pedido borrado'); go('orders'); }); };
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
  return {
    html: `<h1>Nuevo pedido</h1><p class="sub">Introduce un pedido en nombre de un cliente, por ejemplo uno que llegó por correo o por teléfono.</p>
    <div class="panel"><div class="pb"><div class="grid2" style="gap:16px"><div class="field"><label>Cliente</label>${sel('n-client', clientOpts(false), A.nc, 'onchange="go(\'new/\'+this.value)"')}</div>
     <div class="field"><label>Fecha del pedido</label><input type="date" id="n-date" value="${S.today}"></div>
     <div class="field"><label>Cómo llegó</label>${sel('n-chan', ['Correo', 'Teléfono', 'WhatsApp', 'En persona', 'Otro'].map(x => [x, x]), 'Correo')}</div>
     <div class="field"><label>Notas (opcional)</label><input type="text" id="n-notes"></div></div></div></div>
    ${OF.html()}
    <div class="sendbar sticky"><div><p>Total</p><strong><span id="of-count">0</span> artículos</strong></div><button class="btn amber" onclick="A.sendNew()">Crear pedido</button></div>`
  };
};
A.sendNew = async () => safe(async () => {
  const lines = OF.collect();
  const o = await api('POST', '/api/orders', { client_id: A.nc, order_date: $('n-date').value, channel: $('n-chan').value, notes: $('n-notes').value, lines });
  toast('Pedido #' + o.id + ' creado'); go('orders/' + o.id);
});
A.editOrder = async function (id) {
  const o = await api('GET', '/api/orders/' + id);
  A.o = o;
  const cat = await api('GET', `/api/clients/${o.client_id}/catalog`);
  OF.init({ cat, admin: true, client: { allow_packs: 1, allow_products: 1, allow_free: 1 }, order: o });
  return {
    html: `<span class="crumb" onclick="go('orders/${o.id}')">← Pedido #${o.id}</span><h1>Editar pedido #${o.id}</h1><p class="sub">${esc(o.client_name)}. Los cambios no avisan al cliente.</p>
    <div class="panel"><div class="pb"><div class="grid2" style="gap:16px"><div class="field"><label>Fecha del pedido</label><input type="date" id="e-date" value="${o.order_date}"></div>
     <div class="field"><label>Cómo llegó</label><input type="text" id="e-chan" value="${esc(o.channel || '')}"></div></div>
     <div class="field"><label>Notas</label><textarea id="e-notes">${esc(o.notes || '')}</textarea></div></div></div>
    ${OF.html()}
    <div class="sendbar sticky"><div><p>Total</p><strong><span id="of-count">${OF.count()}</span> artículos</strong></div><button class="btn amber" onclick="A.saveEdit()">Guardar cambios</button></div>`
  };
};
A.saveEdit = async () => safe(async () => {
  const lines = OF.collect();
  await api('PUT', '/api/orders/' + A.o.id, { order_date: $('e-date').value, channel: $('e-chan').value, notes: $('e-notes').value, lines });
  toast('Pedido guardado'); go('orders/' + A.o.id);
});

/* ---------- clientes ---------- */
A.clientList = async function () {
  await loadClients();
  const cards = A.clients.map(c => `<div class="ccard" onclick="go('client/${c.id}')"><div class="row" style="gap:14px">${crestHTML(c, true)}<div><div style="font-family:var(--serif);font-size:21px">${esc(c.name)}</div>
    <div class="mini">${c.active ? '' : '<span class="pill-off">Desactivado · </span>'}${c.users_n} usuarios · ${c.active_orders} pedidos activos</div></div></div>
    <div class="row">${c.allow_packs ? '<span class="tag">Packs</span>' : ''}${c.allow_products ? '<span class="tag">Productos</span>' : ''}${c.allow_free ? '<span class="tag">Línea libre</span>' : ''}</div></div>`).join('');
  return `<h1>Clientes</h1><p class="sub">Cada cliente tiene su propio portal, su escudo, su catálogo y sus usuarios.</p>
  <div class="toolbar"><button class="btn amber" onclick="A.newClient()">+ Nuevo cliente</button></div>
  ${cards ? `<div class="cardgrid">${cards}</div>` : '<div class="empty panel">Aún no hay clientes. Crea el primero con el botón de arriba.</div>'}`;
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
  const users = await api('GET', `/api/clients/${id}/users`);
  A.c = c;
  return `<span class="crumb" onclick="go('clients')">← Clientes</span>
  <div class="row" style="gap:16px;margin-bottom:22px">${crestHTML(c, true)}<h1>${esc(c.name)}</h1></div>
  <div class="grid2"><div>
   <div class="panel"><div class="ph"><h2>Datos y portal</h2></div><div class="pb">
    <div class="field"><label>Nombre</label><input type="text" id="c-name" value="${esc(c.name)}"></div>
    <div class="field"><label>Color del escudo (si no hay imagen)</label><input type="color" id="c-color" value="${esc(c.color)}" style="width:60px;height:36px;padding:2px;border-radius:10px;background:var(--bg3);border:1px solid var(--line2)"></div>
    <div class="field"><label>Escudo o logotipo (PNG, JPG o WEBP, máx. 2 MB)</label><input type="file" id="c-crest" accept="image/png,image/jpeg,image/webp" onchange="A.crest()"></div>
    <div class="field"><label>Qué puede pedir este cliente</label>
     <label class="cfgbox"><input type="checkbox" id="c-packs" ${c.allow_packs ? 'checked' : ''}> Packs del catálogo</label>
     <label class="cfgbox" style="margin-top:6px"><input type="checkbox" id="c-prods" ${c.allow_products ? 'checked' : ''}> Productos sueltos del catálogo</label>
     <label class="cfgbox" style="margin-top:6px"><input type="checkbox" id="c-free" ${c.allow_free ? 'checked' : ''}> Líneas libres (fuera de catálogo)</label></div>
    <div class="field"><label class="cfgbox"><input type="checkbox" id="c-active" ${c.active ? 'checked' : ''}> Cliente activo (puede entrar y pedir)</label></div>
    <div class="btnrow"><button class="btn amber" onclick="A.saveClient()">Guardar</button><button class="btn ghost" onclick="go('catalog/${c.id}')">Editar su catálogo</button><button class="btn ghost" onclick="go('new/${c.id}')">Crear pedido</button></div></div></div>
   ${c.total_orders ? '' : `<div class="panel"><div class="ph"><h2>Zona delicada</h2></div><div class="pb"><button class="btn danger sm" onclick="A.delClient()">Borrar cliente</button><p class="hint">Solo se puede borrar un cliente sin pedidos.</p></div></div>`}</div>
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
  await api('PUT', '/api/clients/' + A.c.id, { name: $('c-name').value, color: $('c-color').value, allow_packs: $('c-packs').checked, allow_products: $('c-prods').checked, allow_free: $('c-free').checked, active: $('c-active').checked });
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
  const fin = cat.finishes.map(f => ({ id: kid(), name: f.name, asks_value: f.asks_value, value_label: f.value_label }));
  const prod = cat.products.map(p => ({ id: kid(), name: p.name, sizes: p.sizes, price: p.price == null ? '' : p.price, finishes: { ...p.finishes } }));
  const pack = cat.packs.map(p => ({ id: kid(), name: p.name, price: p.price == null ? '' : p.price, items: p.items.map(n => (prod.find(x => x.name === n) || {}).id).filter(Boolean) }));
  A.K = { fin, prod, pack, dirty: false };
  return { html: `<h1>Catálogo</h1><p class="sub">Lo que cada cliente puede pedir: acabados, productos y packs. Solo lo edita MSH.</p>
   <div class="toolbar">${sel('cat-client', clientOpts(false), A.catClient, 'onchange="go(\'catalog/\'+this.value)"')}<span class="grow"><button class="btn amber" id="cat-save" onclick="A.saveCat()" disabled>Guardar catálogo</button></span></div>
   <div id="cat-body">${A.catHTML()}</div>` };
};
A.dirty = () => { A.K.dirty = true; const b = $('cat-save'); if (b) b.disabled = false; };
A.catHTML = function () {
  const K = A.K;
  const finBox = `<div class="panel"><div class="ph"><h2>1. Acabados</h2></div><div class="pb">
   <p class="hint" style="margin-top:0">Lo que se le puede hacer a una prenda: escudo, dorsal, publicidad… Si el acabado pide un dato (el número del dorsal, unas iniciales), márcalo.</p>
   ${K.fin.map((f, i) => `<div class="row" style="margin-bottom:8px"><input type="text" style="min-width:200px" placeholder="Nombre del acabado" value="${esc(f.name)}" oninput="A.renFin(${i},this.value)" onchange="A.catRefresh()">
     <label class="cfgbox"><input type="checkbox" ${f.asks_value ? 'checked' : ''} onchange="A.K.fin[${i}].asks_value=this.checked;A.dirty();A.catRefresh()"> Pide un dato</label>
     ${f.asks_value ? `<input type="text" style="width:150px" placeholder="Qué dato (ej. Nº dorsal)" value="${esc(f.value_label)}" oninput="A.K.fin[${i}].value_label=this.value;A.dirty()">` : ''}
     <button class="x" onclick="A.rm('fin',${i})">✕</button></div>`).join('')}
   <button class="btn ghost sm" onclick="A.addFin()">+ Añadir acabado</button></div></div>`;
  const names = K.fin.filter(f => f.name.trim());
  const prodBox = `<div class="panel"><div class="ph"><h2>2. Productos</h2></div><div class="pb">
   <p class="hint" style="margin-top:0">Tallas separadas por comas. Para cada acabado: <b>No</b> (no se puede poner), <b>Fijo</b> (siempre lo lleva) u <b>Opcional</b> (el cliente decide).</p>
   ${K.prod.map((p, i) => `<div class="box"><div class="row" style="margin-bottom:10px"><input type="text" style="min-width:210px;flex:1" placeholder="Nombre del producto" value="${esc(p.name)}" oninput="A.K.prod[${i}].name=this.value;A.dirty()" onchange="A.catRefresh()">
     <input type="text" style="width:220px" placeholder="Tallas: S,M,L,XL" value="${esc(p.sizes)}" oninput="A.K.prod[${i}].sizes=this.value;A.dirty()">
     <input type="number" step="0.01" min="0" style="width:96px" placeholder="Precio €" value="${esc(p.price)}" oninput="A.K.prod[${i}].price=this.value;A.dirty()"><button class="x" onclick="A.rm('prod',${i})">✕</button></div>
     <div class="matrix">${names.map(f => `<label>${esc(f.name)}<select class="${p.finishes[f.name] === 'fixed' ? 'fix' : p.finishes[f.name] === 'optional' ? 'cfg' : ''}" onchange="A.setMode(${i},'${f.id}',this.value,this)">
       ${[['', 'No'], ['fixed', 'Fijo'], ['optional', 'Opcional']].map(m => `<option value="${m[0]}" ${(p.finishes[f.name] || '') === m[0] ? 'selected' : ''}>${m[1]}</option>`).join('')}</select></label>`).join('') || '<span class="mini">Añade acabados arriba para configurarlos aquí.</span>'}</div></div>`).join('')}
   <button class="btn ghost sm" onclick="A.addProd()">+ Añadir producto</button></div></div>`;
  const packBox = `<div class="panel"><div class="ph"><h2>3. Packs</h2></div><div class="pb">
   <p class="hint" style="margin-top:0">Un pack es un conjunto de productos. Al pedirlo, el cliente elige talla y acabados de cada uno.</p>
   ${K.pack.map((p, i) => `<div class="box"><div class="row" style="margin-bottom:10px"><input type="text" style="min-width:210px;flex:1" placeholder="Nombre del pack" value="${esc(p.name)}" oninput="A.K.pack[${i}].name=this.value;A.dirty()">
     <input type="number" step="0.01" min="0" style="width:96px" placeholder="Precio €" value="${esc(p.price)}" oninput="A.K.pack[${i}].price=this.value;A.dirty()"><button class="x" onclick="A.rm('pack',${i})">✕</button></div>
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
A.addFin = () => { A.K.fin.push({ id: kid(), name: '', asks_value: false, value_label: '' }); A.dirty(); A.catRefresh(); };
A.addProd = () => { A.K.prod.push({ id: kid(), name: '', sizes: '', price: '', finishes: {} }); A.dirty(); A.catRefresh(); };
A.addPack = () => { A.K.pack.push({ id: kid(), name: '', price: '', items: [] }); A.dirty(); A.catRefresh(); };
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
    finishes: K.fin.map(f => ({ name: f.name.trim(), asks_value: f.asks_value, value_label: f.value_label })),
    products: K.prod.map(p => ({ name: p.name.trim(), sizes: p.sizes, price: p.price, finishes: p.finishes })),
    packs: K.pack.map(p => ({ name: p.name.trim(), price: p.price, items: p.items.map(id => byId.get(id)).filter(Boolean) }))
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
    h = d.orders.length ? d.orders.map(o => `<div class="panel"><div class="ph"><h2>Pedido #${o.id} · ${esc(o.client_name)}</h2><span class="mini">${fmt(o.order_date)} · entrega ${fmt(o.est_delivery)}</span></div><div class="pb">${linesHTML(o)}</div></div>`).join('') : A.pEmpty();
  } else {
    const ids = A.pq.sel;
    h = `<div class="panel"><div class="ph"><h2>Elige los pedidos</h2></div><div class="pb"><div class="chips">${A.pbase.orders.map(o => `<label class="chip ${ids.includes(o.id) ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" hidden ${ids.includes(o.id) ? 'checked' : ''} onchange="A.pickOrder(${o.id},this.checked)">#${o.id} · ${esc(o.client_name)}</label>`).join('') || '<span class="mini">No hay pedidos.</span>'}</div></div></div>`;
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
  return `<h1>Ajustes</h1><p class="sub">Correo, administradores y tu contraseña.</p>
  <div class="grid2"><div>
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
  await api('PUT', '/api/settings', { smtp_host: $('s-host').value, smtp_port: $('s-port').value, smtp_user: $('s-user').value, smtp_pass: $('s-pass').value, smtp_from: $('s-from').value, notify_email: $('s-notify').value, public_url: $('s-url').value, brand_name: $('s-brand').value });
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
