'use strict';
/* ===== Portal del cliente ===== */
const C = { orders: [] };

const CLIENT_VIEWS = {
  async new() {
    if (!S.client.can_order) { location.hash = '#/mine'; return ''; }
    const cat = await api('GET', `/api/clients/${S.client.id}/catalog`);
    OF.init({ cat, admin: false, client: S.client });
    const empty = !OF.s.perm.packs && !OF.s.perm.products && !OF.s.perm.free;
    return {
      html: `<div class="cl-main"><h2>Nuevo pedido</h2><p class="sub">Elige lo que necesitas. Los acabados con candado vienen incluidos; los demás los eliges tú.</p>
      ${OF.html()}
      ${empty ? '' : `<div class="panel"><div class="pb"><div class="field"><label>Título o detalle del pedido (opcional)</label><input type="text" id="n-title" placeholder="Ej. Equipación sub-12"></div><div class="field" style="margin:0"><label>Notas para MSH (opcional)</label><textarea id="n-notes" placeholder="Fecha que necesitas, dudas, detalles…"></textarea></div></div></div>
      <div class="sendbar sticky"><div><p>Tu pedido</p><strong><span id="of-count">0</span> artículos</strong></div><button class="btn amber" id="send-btn" onclick="C.send()">Enviar pedido</button></div>`}</div>`
    };
  },
  async mine() {
    C.orders = await api('GET', '/api/orders');
    const act = C.orders.filter(o => o.status !== 'Entregado'), done = C.orders.filter(o => o.status === 'Entregado');
    return `<div class="cl-main"><h2>Mis pedidos</h2><p class="sub">Aquí ves cómo va cada pedido. Te avisamos por correo en cada cambio.</p>
    ${act.length ? act.map(C.card).join('') : `<div class="empty panel">No tienes pedidos en curso.${S.client.can_order ? `<br><br><button class="btn amber" onclick="go('new')">Hacer un pedido</button>` : ''}</div>`}
    ${done.length ? `<h3 style="font-family:var(--serif);font-weight:400;font-size:26px;margin:34px 0 14px">Entregados</h3>${done.map(C.card).join('')}` : ''}</div>`;
  }
};

C.card = function (o) {
  const fin = o.status === 'Entregado';
  const gantt_ = showsGantt(o);
  return `<div class="panel" id="o${o.id}"><div class="ph"><div><h2>${esc(ordTitle(o))}</h2><div class="mini" style="margin-top:4px">Hecho el ${fmt(o.order_date)} · ${o.units} artículos</div></div><span class="st ${stKey(o.status)}">${esc(o.status)}</span></div>
  <div class="pb">${fin ? `<div class="okbox">Entregado el ${fmt(o.delivered_at)}.</div>` : ''}
  ${gantt_ ? `<div class="mini" style="margin-bottom:10px">${fin ? '' : 'Fase actual: <b style="color:var(--ink)">' + esc(phName(o)) + '</b>'}</div>${gantt(o)}` : estadoBox(o)}
  <details class="lines" style="margin-top:14px"><summary>Ver qué incluye el pedido</summary><div style="margin-top:8px">${linesHTML(o)}${o.notes ? `<p class="hint"><b>Notas:</b> ${esc(o.notes)}</p>` : ''}</div></details>
  <div class="btnrow" style="margin-top:12px"><a class="btn ghost sm" style="text-decoration:none" target="_blank" href="/print.html?id=${o.id}">Exportar PDF</a></div>
  ${o.docs.length ? `<div class="docs" style="margin-top:12px"><div class="mini" style="margin-bottom:8px">Documentos</div>${docLinks(o)}</div>` : ''}</div></div>`;
};

C.send = async function () {
  const btn = $('send-btn');
  await safe(async () => {
    const lines = OF.collect();
    btn.disabled = true;
    try {
      const o = await api('POST', '/api/orders', { lines, notes: $('n-notes').value, title: $('n-title').value });
      toast(ordTitle(o) + ' enviado. ¡Gracias!');
      go('mine');
    } finally { btn.disabled = false; }
  });
};

window.addEventListener('resize', (() => {
  let t, w = window.innerWidth;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const m = x => x < 900;
      if (m(w) !== m(window.innerWidth) && S.me) { w = window.innerWidth; if (/^#\/(mine|orders\/\d+)/.test(location.hash)) route(); }
      w = window.innerWidth;
    }, 250);
  };
})());
