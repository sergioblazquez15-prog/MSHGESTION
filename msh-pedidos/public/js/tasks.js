'use strict';
/* ===== Tareas del día =====
   Lista de pendientes con responsable, fecha límite y semáforo. Al marcarlas con el check pasan al registro,
   que no se ve al abrir la lista (pestaña «Registro»). */
const TK = {
  tab: 'open', open: [], done: [], admins: [], who: '', q: '', editing: null,
  LEVEL: {
    red: { c: '#e5534b', t: t => t.days_left < 0 ? 'Vencida hace ' + (-t.days_left) + (t.days_left === -1 ? ' día' : ' días') : 'Hoy es el último día' },
    orange: { c: '#f0923b', t: () => 'Queda 1 día' },
    green: { c: '#3fb27f', t: t => 'Quedan ' + t.days_left + ' días' },
    none: { c: '#6b6b6b', t: () => 'Sin fecha límite' }
  },

  async view() {
    const [o, d, a] = await Promise.all([api('GET', '/api/tasks'), api('GET', '/api/tasks?scope=done'), api('GET', '/api/admins')]);
    TK.open = o; TK.done = d; TK.admins = a.filter(x => x.active !== 0);
    TK.editing = null;
    return { html: `<h1>Tareas</h1><p class="sub">Lo que hay que hacer hoy y esta semana. Marca el check al terminar: la tarea desaparece de la lista y queda guardada en el registro.</p><div id="tk-root">${TK.html()}</div>`, after: () => {} };
  },
  paint() { const r = $('tk-root'); if (r) r.innerHTML = TK.html(); },
  adminOpts(cur) {
    return `<option value="">Sin asignar</option>` + TK.admins.map(u => `<option value="${u.id}" ${String(u.id) === String(cur) ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('');
  },
  html() {
    const tabs = `<div class="seg" style="margin-bottom:18px"><button class="${TK.tab === 'open' ? 'on' : ''}" onclick="TK.setTab('open')">Pendientes (${TK.open.length})</button><button class="${TK.tab === 'done' ? 'on' : ''}" onclick="TK.setTab('done')">Registro de realizadas</button></div>`;
    return tabs + (TK.tab === 'open' ? TK.openHTML() : TK.doneHTML());
  },
  setTab(t) { TK.tab = t; TK.q = ''; TK.paint(); },

  /* ---------- pendientes ---------- */
  openHTML() {
    const who = TK.who;
    const rows = TK.open.filter(t => !who || (who === '0' ? !t.assignee_id : String(t.assignee_id) === who));
    const chips = `<div class="chiprow" style="margin:0 0 14px"><button class="chip ${!who ? 'on' : ''}" onclick="TK.setWho('')">Todas</button>${TK.admins.map(u => `<button class="chip ${who === String(u.id) ? 'on' : ''}" onclick="TK.setWho('${u.id}')">${esc(u.name || u.email)}</button>`).join('')}<button class="chip ${who === '0' ? 'on' : ''}" onclick="TK.setWho('0')">Sin asignar</button></div>`;
    return `<div class="panel"><div class="pb"><div class="tkform">
        <div class="field" style="flex:2;min-width:220px"><label>Nueva tarea</label><input type="text" id="tk-title" placeholder="Ej. Llamar a Club Atlético Norte por las tallas" onkeydown="if(event.key==='Enter')TK.add()"></div>
        <div class="field"><label>Responsable</label><select id="tk-who">${TK.adminOpts(S.me && S.me.id)}</select></div>
        <div class="field"><label>Fecha máxima</label><input type="date" id="tk-due"></div>
        <div class="field" style="align-self:end"><button class="btn amber" onclick="TK.add()">Añadir tarea</button></div>
      </div><div class="field" style="margin:10px 0 0"><input type="text" id="tk-notes" placeholder="Detalle (opcional)"></div></div></div>
      ${chips}
      ${rows.length ? rows.map(t => TK.editing === t.id ? TK.editHTML(t) : TK.card(t)).join('') : `<div class="empty panel">No hay tareas pendientes. ${TK.open.length ? 'Prueba con otro filtro.' : '¡Todo al día!'}</div>`}
      <div class="tklegend"><span><i style="background:${TK.LEVEL.green.c}"></i>Más de 1 día</span><span><i style="background:${TK.LEVEL.orange.c}"></i>Queda 1 día</span><span><i style="background:${TK.LEVEL.red.c}"></i>Último día o vencida</span></div>`;
  },
  setWho(v) { TK.who = v; TK.paint(); },
  card(t) {
    const L = TK.LEVEL[t.level];
    return `<div class="tkcard" style="--lv:${L.c}"><button class="tkcheck" title="Marcar como hecha" aria-label="Marcar como hecha" onclick="TK.finish(${t.id},this)"></button>
      <div class="tkmain"><div class="tktitle">${esc(t.title)}</div>${t.notes ? `<div class="mini">${esc(t.notes)}</div>` : ''}
      <div class="tkmeta"><span class="tkpill">${esc(L.t(t))}${t.due_date ? ' · ' + fmt(t.due_date) : ''}</span><span class="mini">${t.assignee_name ? 'Responsable: <b style="color:var(--ink)">' + esc(t.assignee_name) + '</b>' : 'Sin asignar'}</span></div></div>
      <div class="tkact"><button class="x" title="Editar" onclick="TK.edit(${t.id})">✎</button><button class="x" title="Borrar" onclick="TK.del(${t.id})">✕</button></div></div>`;
  },
  editHTML(t) {
    return `<div class="tkcard editing"><div class="tkmain"><div class="tkform">
      <div class="field" style="flex:2;min-width:220px"><label>Tarea</label><input type="text" id="te-title" value="${esc(t.title)}"></div>
      <div class="field"><label>Responsable</label><select id="te-who">${TK.adminOpts(t.assignee_id)}</select></div>
      <div class="field"><label>Fecha máxima</label><input type="date" id="te-due" value="${t.due_date || ''}"></div></div>
      <div class="field" style="margin:10px 0"><input type="text" id="te-notes" placeholder="Detalle (opcional)" value="${esc(t.notes)}"></div>
      <div class="btnrow"><button class="btn amber sm" onclick="TK.save(${t.id})">Guardar</button><button class="btn ghost sm" onclick="TK.edit(null)">Cancelar</button></div></div></div>`;
  },
  edit(id) { TK.editing = id; TK.paint(); },

  async add() {
    await safe(async () => {
      const title = $('tk-title').value.trim();
      if (!title) { $('tk-title').focus(); throw new Error('Escribe qué hay que hacer'); }
      await api('POST', '/api/tasks', { title, assignee_id: $('tk-who').value || null, due_date: $('tk-due').value || null, notes: $('tk-notes').value });
      TK.open = await api('GET', '/api/tasks'); TK.paint(); toast('Tarea añadida');
      setTimeout(() => { const i = $('tk-title'); if (i) i.focus(); }, 50);
    });
  },
  async save(id) {
    await safe(async () => {
      await api('PUT', '/api/tasks/' + id, { title: $('te-title').value, assignee_id: $('te-who').value || null, due_date: $('te-due').value || null, notes: $('te-notes').value });
      TK.editing = null; TK.open = await api('GET', '/api/tasks'); TK.paint(); toast('Tarea guardada');
    });
  },
  async finish(id, el) {
    if (el) el.classList.add('on');
    await safe(async () => {
      await api('POST', `/api/tasks/${id}/done`, { done: true });
      const [o, d] = await Promise.all([api('GET', '/api/tasks'), api('GET', '/api/tasks?scope=done')]);
      TK.open = o; TK.done = d; TK.paint(); toast('Hecha. Pasa al registro de realizadas.');
    });
  },
  async reopen(id) {
    await safe(async () => {
      await api('POST', `/api/tasks/${id}/done`, { done: false });
      const [o, d] = await Promise.all([api('GET', '/api/tasks'), api('GET', '/api/tasks?scope=done')]);
      TK.open = o; TK.done = d; TK.paint(); toast('Tarea devuelta a pendientes');
    });
  },
  async del(id) {
    if (!confirm('¿Borrar esta tarea? No se puede deshacer.')) return;
    await safe(async () => {
      await api('DELETE', '/api/tasks/' + id);
      TK.open = TK.open.filter(t => t.id !== id); TK.done = TK.done.filter(t => t.id !== id); TK.paint(); toast('Tarea borrada');
    });
  },

  /* ---------- registro ---------- */
  doneHTML() {
    const q = TK.q.trim().toLowerCase(), who = TK.who;
    const rows = TK.done.filter(t => (!q || (t.title + ' ' + t.notes + ' ' + t.assignee_name + ' ' + t.done_by).toLowerCase().includes(q)) && (!who || (who === '0' ? !t.assignee_id : String(t.assignee_id) === who)));
    const days = new Map();
    rows.forEach(t => { const d = (t.done_at || '').slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(t); });
    const chips = `<div class="chiprow" style="margin:0 0 14px"><button class="chip ${!who ? 'on' : ''}" onclick="TK.setWho('')">Todas</button>${TK.admins.map(u => `<button class="chip ${who === String(u.id) ? 'on' : ''}" onclick="TK.setWho('${u.id}')">${esc(u.name || u.email)}</button>`).join('')}</div>`;
    return `<div class="toolbar"><input type="search" class="stsearch" style="min-width:260px" placeholder="Buscar en el registro…" value="${esc(TK.q)}" oninput="TK.q=this.value;TK.paintLog()"><span class="mini">${TK.done.length} ${TK.done.length === 1 ? 'tarea realizada' : 'tareas realizadas'} en total</span></div>${chips}<div id="tk-log">${TK.logHTML(days)}</div>`;
  },
  paintLog() {
    const el = $('tk-log'); if (!el) return;
    const q = TK.q.trim().toLowerCase(), who = TK.who;
    const days = new Map();
    TK.done.filter(t => (!q || (t.title + ' ' + t.notes + ' ' + t.assignee_name + ' ' + t.done_by).toLowerCase().includes(q)) && (!who || (who === '0' ? !t.assignee_id : String(t.assignee_id) === who)))
      .forEach(t => { const d = (t.done_at || '').slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(t); });
    el.innerHTML = TK.logHTML(days);
  },
  logHTML(days) {
    if (!days.size) return '<div class="empty panel">Todavía no hay tareas realizadas que mostrar.</div>';
    return [...days].map(([d, list]) => `<div class="panel"><div class="ph"><h2>${d ? fmt(d) : 'Sin fecha'}</h2><span class="mini">${list.length} ${list.length === 1 ? 'tarea' : 'tareas'}</span></div><div class="pb" style="padding-top:4px;padding-bottom:6px">
      ${list.map(t => `<div class="tklog"><span class="tkok">✓</span><div class="tkmain"><div class="tktitle done">${esc(t.title)}</div>${t.notes ? `<div class="mini">${esc(t.notes)}</div>` : ''}
        <div class="mini">${t.assignee_name ? 'Responsable: ' + esc(t.assignee_name) + ' · ' : ''}Marcada por ${esc(t.done_by || '—')} a las ${esc((t.done_at || '').slice(11, 16))}${t.due_date ? ' · límite ' + fmt(t.due_date) : ''}</div></div>
        <div class="tkact"><button class="btn ghost sm" onclick="TK.reopen(${t.id})">Reabrir</button><button class="x" title="Borrar" onclick="TK.del(${t.id})">✕</button></div></div>`).join('')}</div></div>`).join('');
  }
};

(function () {
  const css = `
  .tkform{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;} .tkform .field{margin:0;min-width:150px;}
  .chiprow{display:flex;gap:8px;flex-wrap:wrap;} .chip{border:1px solid var(--line2,#333);background:transparent;color:var(--soft,#a8a8a8);border-radius:999px;padding:7px 14px;font:inherit;font-size:13.5px;cursor:pointer;}
  .chip.on{background:var(--accent,#d4af37);color:#111;border-color:var(--accent,#d4af37);font-weight:600;}
  .tkcard{display:flex;align-items:flex-start;gap:14px;background:var(--bg2,#121212);border:1px solid var(--line,#242424);border-left:5px solid var(--lv,#6b6b6b);border-radius:16px;padding:14px 16px;margin-bottom:10px;}
  .tkcard.editing{border-left-color:var(--accent,#d4af37);display:block;}
  .tkcheck{flex:none;width:28px;height:28px;border-radius:50%;border:2px solid var(--lv,#6b6b6b);background:transparent;cursor:pointer;margin-top:1px;position:relative;}
  .tkcheck:hover,.tkcheck.on{background:var(--lv,#6b6b6b);} .tkcheck:hover:after,.tkcheck.on:after{content:'✓';color:#111;font-weight:700;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;}
  .tkmain{flex:1;min-width:0;} .tktitle{font-size:16px;font-weight:500;} .tktitle.done{text-decoration:line-through;opacity:.7;}
  .tkmeta{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px;}
  .tkpill{font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;border:1px solid var(--lv);color:var(--ink,#f4f4f4);background:color-mix(in srgb,var(--lv) 18%,transparent);}
  .tkact{display:flex;gap:6px;align-items:center;flex:none;}
  .tklegend{display:flex;gap:18px;flex-wrap:wrap;margin-top:16px;font-size:12.5px;color:var(--soft,#a8a8a8);} .tklegend span{display:inline-flex;align-items:center;gap:7px;} .tklegend i{width:10px;height:10px;border-radius:50%;display:inline-block;}
  .tklog{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line,#242424);} .tklog:first-child{border-top:0;}
  .tkok{flex:none;width:24px;height:24px;border-radius:50%;background:#3fb27f;color:#111;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;margin-top:2px;}
  `;
  const el = document.createElement('style'); el.textContent = css; document.head.appendChild(el);
})();
