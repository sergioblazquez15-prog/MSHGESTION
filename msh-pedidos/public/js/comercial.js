'use strict';
/* ===== Comercial: clubes y empresas que aún no son clientes =====
   Semáforo: rojo = sin contactar, amarillo = contactado / negociando, verde = «Pasar a cliente» (pide datos y confirma). */
const CM = {
  kind: 'club', limit: 100, list: [], q: '', zone: '', stat: '', open: null, msg: null,
  KINDS: { club: ['Clubes', 'club'], empresa: ['Empresas', 'empresa'] },
  VIAS: [['llamada', 'Llamada'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['visita', 'Visita'], ['reunión', 'Reunión'], ['otro', 'Otro']],
  COL: { rojo: '#e5534b', amarillo: '#e3b341', verde: '#3fb27f' },
  LAB: { rojo: 'Sin contactar', amarillo: 'Contactado · negociando' },

  async view(rest) {
    if (rest && rest[0]) return CM.fichaView(+rest[0]);
    CM.list = await api('GET', '/api/prospects?kind=' + CM.kind);
    const counts = await CM.counts();
    return { html: `<h1>Comercial</h1><p class="sub">Clubes y empresas a los que queremos llegar. Cuando consigas traer uno, lo pasas a cliente y sale de aquí.</p>
      <div class="seg" style="margin-bottom:18px">${Object.keys(CM.KINDS).map(k => `<button class="${CM.kind === k ? 'on' : ''}" onclick="CM.setKind('${k}')">${CM.KINDS[k][0]} (${counts[k]})</button>`).join('')}</div>
      <div id="cm-root">${CM.listHTML()}</div>` };
  },
  async counts() {
    const other = CM.kind === 'club' ? 'empresa' : 'club';
    const o = await api('GET', '/api/prospects?kind=' + other);
    return { [CM.kind]: CM.list.length, [other]: o.length };
  },
  setKind(k) { CM.kind = k; CM.limit = 100; CM.q = ''; CM.zone = ''; CM.stat = ''; CM.msg = null; go('comercial'); },
  paint() { const r = $('cm-root'); if (r) r.innerHTML = CM.listHTML(); },
  dot(s) { return `<span class="cmdot" style="background:${CM.COL[s]}" title="${esc(CM.LAB[s])}"></span>`; },
  rows() {
    const q = CM.q.trim().toLowerCase();
    return CM.list.filter(p => (!CM.zone || p.zone === CM.zone) && (!CM.stat || p.status === CM.stat) &&
      (!q || [p.name, p.city, p.zone, p.category, p.phone, p.email, ...p.contacts.map(c => c.name + ' ' + c.email)].join(' ').toLowerCase().includes(q)));
  },
  listHTML() {
    const all = CM.list, rows = CM.rows(), zones = [...new Set(all.map(p => p.zone).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const n = s => all.filter(p => p.status === s).length;
    const kn = CM.KINDS[CM.kind][1];
    return `${CM.msg ? `<div class="notice" style="margin-bottom:14px">${CM.msg}</div>` : ''}
    <div class="panel"><div class="bar">
      <input type="text" placeholder="Buscar por nombre, ciudad, contacto…" value="${esc(CM.q)}" style="min-width:240px" oninput="CM.q=this.value;CM.limit=100;CM.paintTable()">
      ${sel('cm-zone', [['', 'Todas las zonas'], ...zones.map(z => [z, z])], CM.zone, 'onchange="CM.zone=this.value;CM.limit=100;CM.paintTable()"')}
      <span class="chiprow" style="margin:0"><button class="chip ${!CM.stat ? 'on' : ''}" onclick="CM.setStat('')">Todos (${all.length})</button>
        <button class="chip ${CM.stat === 'rojo' ? 'on' : ''}" onclick="CM.setStat('rojo')">${CM.dot('rojo')} Sin contactar (${n('rojo')})</button>
        <button class="chip ${CM.stat === 'amarillo' ? 'on' : ''}" onclick="CM.setStat('amarillo')">${CM.dot('amarillo')} Negociando (${n('amarillo')})</button></span>
      <span style="margin-left:auto" class="row"><button class="btn ghost sm" onclick="$('cm-file').click()">Importar Excel</button><input type="file" id="cm-file" hidden accept=".xlsx,.csv" onchange="CM.import(this)">
        <button class="btn amber sm" onclick="CM.add()">+ Añadir ${kn}</button></span></div>
      <p class="hint" style="margin:0 18px 10px">El Excel debe tener una primera fila con cabeceras (Nombre o ${kn === 'club' ? 'Club' : 'Empresa'}, Zona, Ciudad, Teléfono, Email, Presidente…). Los que ya estén en la lista no se duplican ni pierden su información: solo se rellenan los huecos.</p>
      <div id="cm-table" class="tblwrap">${CM.tableHTML(rows)}</div></div>`;
  },
  setStat(s) { CM.stat = s; CM.limit = 100; CM.paint(); },
  more() { CM.limit += 200; CM.paintTable(); },
  paintTable() { const t = $('cm-table'); if (t) t.innerHTML = CM.tableHTML(CM.rows()); },
  tableHTML(rows) {
    if (!rows.length) return `<div class="empty">${CM.list.length ? 'Nada con este filtro.' : 'Todavía no hay nada. Importa un Excel o añade el primero.'}</div>`;
    const total = rows.length; rows = rows.slice(0, CM.limit);
    return `<table><thead><tr><th style="width:34px"></th><th>Nombre</th><th>Zona</th><th>Ciudad</th><th>Contacto</th><th>Último contacto</th><th style="text-align:center">Contactado</th><th></th></tr></thead><tbody>
    ${rows.map(p => { const c = p.contacts[0]; return `<tr style="cursor:pointer" onclick="go('comercial/${p.id}')">
      <td>${CM.dot(p.status)}</td><td><b>${esc(p.name)}</b>${p.category ? `<div class="mini">${esc(p.category)}</div>` : ''}</td><td>${esc(p.zone)}</td><td>${esc(p.city)}</td>
      <td>${c ? esc(c.name) + (p.contacts.length > 1 ? ` <span class="mini">+${p.contacts.length - 1}</span>` : '') : ''}<div class="mini">${esc((c && c.phone) || p.phone)}${((c && c.email) || p.email) ? ' · ' + esc((c && c.email) || p.email) : ''}</div></td>
      <td>${p.last_contact ? fmt(p.last_contact) : '<span class="mini">—</span>'}</td>
      <td style="text-align:center" onclick="event.stopPropagation()"><input type="checkbox" ${p.status === 'amarillo' ? 'checked' : ''} onchange="CM.quick(${p.id},this.checked)" title="Marcar como contactado"></td>
      <td onclick="event.stopPropagation()"><button class="btn sm" style="background:#3fb27f;color:#0a0a0a;border:0" onclick="CM.convertForm(${p.id})">Pasar a cliente</button></td></tr>`; }).join('')}</tbody></table>${total > rows.length ? `<div style="text-align:center;padding:14px"><span class="mini">Mostrando ${rows.length} de ${total}</span> <button class="btn ghost sm" onclick="CM.more()">Mostrar más</button></div>` : `<div class="mini" style="padding:10px 18px">${total} en total</div>`}`;
  },
  async quick(id, on) {
    await safe(async () => { await api('PUT', '/api/prospects/' + id, { status: on ? 'amarillo' : 'rojo' }); const p = CM.list.find(x => x.id === id); if (p) p.status = on ? 'amarillo' : 'rojo'; CM.paint(); });
  },
  async add() {
    const name = prompt('Nombre del ' + CM.KINDS[CM.kind][1] + ':'); if (!name) return;
    await safe(async () => { const p = await api('POST', '/api/prospects', { kind: CM.kind, name }); go('comercial/' + p.id); });
  },
  async import(input) {
    const f = input.files[0]; if (!f) return;
    await safe(async () => {
      const fd = new FormData(); fd.append('file', f); fd.append('kind', CM.kind);
      const r = await api('POST', '/api/prospects/import', fd);
      CM.msg = `Importación hecha (${r.rows} filas): <b>${r.added}</b> nuevos, <b>${r.updated}</b> existentes completados, ${r.unchanged} sin cambios` + (r.already_client ? `, ${r.already_client} ya son clientes (omitidos)` : '') + (r.empty ? `, ${r.empty} sin nombre (omitidos)` : '') + '.';
      input.value = ''; go('comercial');
    });
  },

  /* ---------- ficha ---------- */
  async fichaView(id) {
    const p = await api('GET', '/api/prospects/' + id);
    CM.open = p; CM.conv = !!CM.wantConv; CM.wantConv = false;
    return { html: `<div id="cm-ficha">${CM.fichaHTML()}</div>` };
  },
  paintFicha() { const r = $('cm-ficha'); if (r) r.innerHTML = CM.fichaHTML(); },
  convertForm(id) { CM.wantConv = true; go('comercial/' + id); },
  field(id, label, val, extra) { return `<div class="field"><label>${label}</label><input type="text" id="${id}" value="${esc(val)}" ${extra || ''}></div>`; },
  fichaHTML() {
    const p = CM.open, kn = CM.KINDS[p.kind][1];
    const cs = [0, 1, 2].map(i => p.contacts[i] || { name: '', role: '', phone: '', email: '' });
    return `<span class="crumb" onclick="CM.kind='${p.kind}';go('comercial')">← Comercial</span>
    <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:18px"><div><h1>${esc(p.name)}</h1><div class="sub" style="margin:6px 0 0">${p.kind === 'club' ? 'Club' : 'Empresa'}${p.zone ? ' · zona ' + esc(p.zone) : ''}${p.city ? ' · ' + esc(p.city) : ''}</div></div>
      <span class="row" style="gap:10px"><span class="bill ${p.status === 'rojo' ? 'cmred' : 'cmyel'}">${CM.dot(p.status)} ${CM.LAB[p.status]}</span><button class="btn sm" style="background:#3fb27f;color:#0a0a0a;border:0" onclick="CM.toggleConv()">Pasar a cliente</button></span></div>
    <div id="cm-conv">${CM.conv ? CM.convHTML() : ''}</div>
    <div class="grid2"><div>
      <div class="panel"><div class="ph"><h2>Datos</h2></div><div class="pb">
        ${CM.field('f-name', 'Nombre', p.name)}${CM.field('f-zone', 'Zona (Centro, Norte, Sur, Este, Oeste…)', p.zone)}${CM.field('f-cat', p.kind === 'club' ? 'Deporte / categoría' : 'Sector / actividad', p.category)}
        ${CM.field('f-city', 'Ciudad', p.city)}${CM.field('f-addr', 'Dirección', p.address)}${CM.field('f-postal', 'Código postal', p.postal_code)}${CM.field('f-phone', 'Teléfono general', p.phone)}${CM.field('f-mail', 'Correo general', p.email)}${CM.field('f-web', 'Web', p.web)}
        <div class="field"><label>Notas</label><textarea id="f-notes" rows="3" style="width:100%">${esc(p.notes)}</textarea></div>
        <div class="field"><label>Estado</label><span class="chiprow" style="margin:0"><button class="chip ${p.status === 'rojo' ? 'on' : ''}" onclick="CM.setStatus('rojo')">${CM.dot('rojo')} Sin contactar</button><button class="chip ${p.status === 'amarillo' ? 'on' : ''}" onclick="CM.setStatus('amarillo')">${CM.dot('amarillo')} Contactado · negociando</button></span></div>
      </div></div>
      <div class="panel"><div class="ph"><h2>Personas de contacto</h2><span class="mini">hasta 3</span></div><div class="pb">
        ${cs.map((c, i) => `<div class="box" style="margin-bottom:10px"><div class="row"><input type="text" id="ct-n${i}" placeholder="Nombre" value="${esc(c.name)}" style="flex:1;min-width:140px"><input type="text" id="ct-r${i}" placeholder="Cargo" value="${esc(c.role)}" style="width:130px"></div>
          <div class="row" style="margin-top:8px"><input type="text" id="ct-p${i}" placeholder="Teléfono" value="${esc(c.phone)}" style="flex:1;min-width:120px"><input type="text" id="ct-e${i}" placeholder="Correo" value="${esc(c.email)}" style="flex:1;min-width:160px"></div></div>`).join('')}
      </div></div>
      <div class="btnrow" style="margin-bottom:18px"><button class="btn amber" onclick="CM.save()">Guardar datos y contactos</button><button class="btn danger sm" onclick="CM.del()">Borrar de la lista</button></div>
    </div><div>
      <div class="panel"><div class="ph"><h2>Historial de contactos</h2></div><div class="pb">
        <div class="row" style="align-items:flex-end"><div class="field" style="margin:0"><label>Fecha</label><input type="date" id="lg-at" value="${S.today}"></div>
          <div class="field" style="margin:0"><label>Cómo</label>${sel('lg-via', CM.VIAS, 'llamada')}</div></div>
        <div class="field" style="margin:10px 0"><label>Observaciones</label><textarea id="lg-notes" rows="3" style="width:100%" placeholder="Qué se habló, qué quedó pendiente…"></textarea></div>
        <button class="btn amber sm" onclick="CM.log()">Añadir al historial</button>
        <div style="margin-top:16px">${p.log.map(l => `<div class="logline"><span class="t">${esc(fmt(l.at))}</span><span><b>${esc((CM.VIAS.find(v => v[0] === l.via) || [0, l.via])[1])}</b>${l.notes ? ' · ' + esc(l.notes) : ''}${l.by_user ? ` <span class="mini">· ${esc(l.by_user)}</span>` : ''} <button class="x" onclick="CM.delLog(${l.id})">Quitar</button></span></div>`).join('') || '<div class="mini">Todavía no hay contactos anotados. Al anotar el primero, pasa a amarillo.</div>'}</div>
      </div></div>
    </div></div>`;
  },
  toggleConv() { CM.conv = !CM.conv; $('cm-conv').innerHTML = CM.conv ? CM.convHTML() : ''; if (CM.conv) $('cm-conv').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  convHTML() {
    const p = CM.open, c0 = p.contacts[0] || {};
    return `<div class="panel" style="border-color:#3fb27f"><div class="ph"><h2>Pasar a cliente</h2></div><div class="pb">
      <p class="hint" style="margin-top:0">Se crea el cliente con estos datos y esta ficha <b>desaparece de Comercial</b>. El historial de contactos se conserva en la ficha del cliente. Los datos con * son obligatorios.</p>
      <div class="grid2"><div>${CM.field('cv-name', 'Nombre del cliente *', p.name)}${CM.field('cv-tax', 'NIF / CIF *', '')}${CM.field('cv-addr', 'Dirección *', p.address)}${CM.field('cv-postal', 'Código postal *', p.postal_code)}</div>
      <div>${CM.field('cv-city', 'Población *', p.city)}${CM.field('cv-prov', 'Provincia *', '')}${CM.field('cv-fcode', 'Código de cliente en FactuSOL (si ya existe)', '', 'inputmode="numeric" maxlength="6"')}
        ${CM.field('cv-contact', 'Persona de contacto', c0.name || '')}</div></div>
      <label class="cfgbox" style="margin:6px 0 14px"><input type="checkbox" id="cv-ok"> Confirmo el traspaso: sale de Comercial y pasa a Clientes</label>
      <div class="btnrow"><button class="btn amber" onclick="CM.convert()">Pasar a cliente</button><button class="btn ghost" onclick="CM.toggleConv()">Cancelar</button></div></div></div>`;
  },
  read() {
    return { name: $('f-name').value, zone: $('f-zone').value, category: $('f-cat').value, city: $('f-city').value, address: $('f-addr').value, postal_code: $('f-postal').value, phone: $('f-phone').value, email: $('f-mail').value, web: $('f-web').value, notes: $('f-notes').value,
      contacts: [0, 1, 2].map(i => ({ name: $('ct-n' + i).value, role: $('ct-r' + i).value, phone: $('ct-p' + i).value, email: $('ct-e' + i).value })) };
  },
  async save() { await safe(async () => { CM.open = await api('PUT', '/api/prospects/' + CM.open.id, CM.read()); toast('Guardado'); CM.paintFicha(); }); },
  async setStatus(s) { await safe(async () => { CM.open = await api('PUT', '/api/prospects/' + CM.open.id, { ...CM.read(), status: s }); CM.paintFicha(); }); },
  async log() { await safe(async () => { await api('PUT', '/api/prospects/' + CM.open.id, CM.read()); CM.open = await api('POST', `/api/prospects/${CM.open.id}/log`, { at: $('lg-at').value, via: $('lg-via').value, notes: $('lg-notes').value }); toast('Contacto anotado'); CM.paintFicha(); }); },
  async delLog(lid) { await safe(async () => { CM.open = await api('DELETE', `/api/prospects/${CM.open.id}/log/${lid}`); CM.paintFicha(); }); },
  async del() { if (!confirm('¿Borrar «' + CM.open.name + '» de la lista con todo su historial?')) return; await safe(async () => { await api('DELETE', '/api/prospects/' + CM.open.id); toast('Borrado'); go('comercial'); }); },
  async convert() {
    const v = i => $(i).value.trim();
    if (!$('cv-ok').checked) return toast('Marca la casilla para confirmar el traspaso', true);
    if (!confirm('¿Pasar «' + v('cv-name') + '» a cliente? Desaparecerá de Comercial.')) return;
    await safe(async () => {
      const r = await api('POST', `/api/prospects/${CM.open.id}/convert`, { confirm: true, name: v('cv-name'), tax_id: v('cv-tax'), address: v('cv-addr'), postal_code: v('cv-postal'), city: v('cv-city'), province: v('cv-prov'), factusol_code: v('cv-fcode'), contact_name: v('cv-contact') });
      toast('Ya es cliente'); go('client/' + r.client_id);
    });
  }
};
(function () {
  const s = document.createElement('style');
  s.textContent = '.cmdot{display:inline-block;width:11px;height:11px;border-radius:50%;vertical-align:-1px}.bill.cmred{color:#f0908a;border-color:#7a2b27;background:rgba(229,83,75,.12)}.bill.cmyel{color:#e3b341;border-color:#6b5410;background:rgba(227,179,65,.12)}';
  document.head.appendChild(s);
})();
