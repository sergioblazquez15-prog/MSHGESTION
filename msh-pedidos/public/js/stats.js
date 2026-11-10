'use strict';
/* ===== Estadísticas e informes =====
   Lo usan la pestaña «Informes» (interactiva) y /report.html (informe imprimible, sin controles).
   Colores categóricos validados con la guía de visualización (orden fijo, no se reasignan al filtrar). */
const ST = {
  data: null,
  static: false,
  light: false,                      // el informe imprimible usa los tonos para fondo claro
  CAT_DARK: ['#3987e5', '#d95926', '#199e70'],
  CAT_LIGHT: ['#2a78d6', '#eb6834', '#1baf7a'],
  f: { clients: new Set(), preset: 'year', from: '', to: '', status: 'all', measure: 'qty' },
  tbl: { cli: { q: '', key: 'total', dir: -1 }, prod: { q: '', key: 'qty', dir: -1 } },
  MES: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],

  col(i) { return (this.light ? this.CAT_LIGHT : this.CAT_DARK)[i]; },
  isQty() { return this.f.measure === 'qty'; },
  val(o) { return this.isQty() ? o.qty : o.amount; },
  num(n) { return Number(n || 0).toLocaleString('es-ES'); },
  eur(n) { return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }); },
  fmtV(n) { return this.isQty() ? this.num(n) + ' uds' : this.eur(n); },
  short(n) {
    if (this.isQty()) return Number(n).toLocaleString('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
    return Number(n).toLocaleString('es-ES', { notation: 'compact', maximumFractionDigits: 1 }) + ' €';
  },
  mlabel(m, full) { const [y, mo] = m.split('-'); return this.MES[+mo - 1] + (full ? ' ' + y : " '" + y.slice(2)); },
  sizeKey(s) {
    const order = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL'];
    const i = order.indexOf(String(s).toUpperCase());
    if (i >= 0) return [0, i, ''];
    const n = parseFloat(s);
    if (!isNaN(n)) return [1, n, ''];
    return [2, 0, String(s)];
  },
  sortSizes(obj) {
    return Object.keys(obj).sort((a, b) => {
      const x = this.sizeKey(a), y = this.sizeKey(b);
      return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
    }).map(k => [k, obj[k]]);
  },

  /* ---------- periodos ---------- */
  range() {
    const f = this.f, t = S.today, y = +t.slice(0, 4);
    if (f.preset === 'year') return [y + '-01-01', t];
    if (f.preset === 'prev') return [(y - 1) + '-01-01', (y - 1) + '-12-31'];
    if (f.preset === '12m') { const d = new Date(t + 'T12:00:00'); d.setMonth(d.getMonth() - 11); d.setDate(1); return [d.toLocaleDateString('sv-SE'), t]; }
    if (f.preset === 'custom') return [f.from, f.to];
    return ['', ''];
  },
  periodText() {
    const [a, b] = this.range();
    if (!a && !b) return 'Todo el histórico';
    return (a ? fmt(a) : 'inicio') + ' – ' + (b ? fmt(b) : 'hoy');
  },
  query() {
    const [a, b] = this.range(), p = new URLSearchParams();
    if (this.f.clients.size) p.set('clients', [...this.f.clients].join(','));
    if (a) p.set('from', a);
    if (b) p.set('to', b);
    if (this.f.status !== 'all') p.set('status', this.f.status);
    return p;
  },

  /* ---------- pantalla interactiva ---------- */
  async view() {
    await loadClients();
    return {
      html: `<h1>Estadísticas e informes</h1><p class="sub">Qué se ha pedido, por quién y cuándo. Elige clientes y periodo, y genera el informe en PDF cuando lo necesites.</p>
      <div class="panel stfilters"><div class="pb">
        <div class="stbar">
          <div class="field"><label>Clientes</label><details class="msel" id="st-msel"><summary id="st-mlabel"></summary><div class="mselbox" id="st-mbox"></div></details></div>
          <div class="field"><label>Periodo</label>${sel('st-preset', [['year', 'Este año'], ['prev', 'Año anterior'], ['12m', 'Últimos 12 meses'], ['all', 'Todo el histórico'], ['custom', 'Fechas concretas']], ST.f.preset, 'onchange="ST.setPreset(this.value)"')}</div>
          <div class="field" id="st-custom" style="display:none"><label>Desde / hasta</label><div class="row"><input type="date" id="st-from" onchange="ST.setDates()"><input type="date" id="st-to" onchange="ST.setDates()"></div></div>
          <div class="field"><label>Pedidos</label>${sel('st-status', [['all', 'Todos'], ['active', 'En curso'], ['delivered', 'Entregados']], ST.f.status, 'onchange="ST.f.status=this.value;ST.load()"')}</div>
          <div class="field"><label>Medir en</label><div class="seg" id="st-measure"><button class="on" onclick="ST.setMeasure('qty')">Unidades</button><button onclick="ST.setMeasure('amount')">Importe</button></div></div>
          <div class="field" style="align-self:end"><button class="btn amber" onclick="ST.report()">Generar informe PDF</button></div>
        </div></div></div>
      <div id="st-out"><div class="empty panel">Cargando…</div></div>`,
      after: () => { ST.drawClients(); ST.syncCustom(); ST.load(); }
    };
  },
  drawClients() {
    const box = $('st-mbox'); if (!box) return;
    box.innerHTML = `<div class="btnrow" style="margin-bottom:8px"><button class="btn ghost sm" onclick="ST.allClients()">Todos</button></div>` +
      A.clients.map(c => `<label class="cfgbox"><input type="checkbox" ${ST.f.clients.has(c.id) ? 'checked' : ''} onchange="ST.togClient(${c.id},this.checked)"> ${esc(c.name)}</label>`).join('');
    const n = ST.f.clients.size, l = $('st-mlabel');
    if (l) l.textContent = !n ? 'Todos los clientes' : n === 1 ? (A.clients.find(c => ST.f.clients.has(c.id)) || {}).name : n + ' clientes';
  },
  allClients() { ST.f.clients.clear(); ST.drawClients(); ST.load(); },
  togClient(id, on) { if (on) ST.f.clients.add(id); else ST.f.clients.delete(id); ST.drawClients(); clearTimeout(ST._t); ST._t = setTimeout(() => ST.load(), 250); },
  setPreset(v) { ST.f.preset = v; ST.syncCustom(); if (v !== 'custom') ST.load(); },
  syncCustom() {
    const c = $('st-custom'); if (!c) return;
    c.style.display = ST.f.preset === 'custom' ? '' : 'none';
    $('st-from').value = ST.f.from; $('st-to').value = ST.f.to;
  },
  setDates() { ST.f.from = $('st-from').value; ST.f.to = $('st-to').value; ST.load(); },
  setMeasure(m) {
    ST.f.measure = m;
    const b = $('st-measure'); if (b) [...b.children].forEach((x, i) => x.classList.toggle('on', (i === 0) === (m === 'qty')));
    ST.paint();
  },
  async load() {
    await safe(async () => {
      ST.data = await api('GET', '/api/stats?' + ST.query().toString());
      const b = $('st-measure'); if (b) [...b.children].forEach((x, i) => x.classList.toggle('on', (i === 0) === ST.isQty()));
      ST.paint();
    });
  },
  report() {
    const p = ST.query(); p.set('measure', ST.f.measure);
    window.open('/report.html?' + p.toString(), '_blank');
  },
  paint() {
    const out = $('st-out'); if (!out || !ST.data) return;
    out.innerHTML = ST.body(false);
    ST.paintTables();
  },

  /* ---------- cuerpo (común a pantalla e informe) ---------- */
  body(isStatic) {
    const d = this.data;
    if (!d.kpis.orders) return `<div class="empty panel">No hay pedidos con estos filtros. Cambia el periodo o los clientes.</div>`;
    const k = d.kpis;
    const tile = (lab, v, sub) => `<div class="kpi"><span>${lab}</span><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const warn = k.unpriced ? `<div class="notice" style="margin-bottom:14px">Hay ${k.unpriced} línea(s) sin precio. Los importes solo suman las que lo tienen.</div>` : '';
    return `${warn}<div class="kpis">${tile('Pedidos', this.num(k.orders))}${tile('Unidades', this.num(k.units))}${tile('Importe (sin IVA)', this.eur(k.amount))}${tile('Clientes', this.num(k.clients))}${tile('Importe medio por pedido', this.eur(k.avg_order))}</div>
    ${this.billing(isStatic)}
    <div class="stgrid">
      <div class="panel"><div class="ph"><h2>${this.isQty() ? 'Unidades' : 'Importe'} por mes</h2><div class="stleg">${d.categories.map((c, i) => `<span><i style="background:${this.col(i)}"></i>${esc(c)}</span>`).join('')}</div></div><div class="pb" style="position:relative" id="st-bars">${this.bars()}<div class="sttip" id="st-tip"></div></div>
        <details class="pb stalt"><summary>Ver como tabla</summary>${this.monthTable()}</details></div>
      <div class="panel"><div class="ph"><h2>Por tipo de pedido</h2></div><div class="pb" style="position:relative" id="st-donut">${this.donut()}</div></div>
    </div>
    <div class="panel"><div class="ph"><h2>Ventas por cliente</h2>${isStatic ? '' : `<div class="row"><input type="search" class="stsearch" placeholder="Buscar cliente…" oninput="ST.tbl.cli.q=this.value;ST.paintTables()"><button class="btn ghost sm" onclick="ST.csv('cli')">Exportar CSV</button></div>`}</div><div class="pb tblwrap" id="st-cli-body">${isStatic ? this.cliTable() : ''}</div></div>
    <div class="panel"><div class="ph"><h2>Ventas por producto</h2>${isStatic ? '' : `<div class="row"><input type="search" class="stsearch" placeholder="Buscar producto…" oninput="ST.tbl.prod.q=this.value;ST.paintTables()"><button class="btn ghost sm" onclick="ST.csv('prod')">Exportar CSV</button></div>`}</div><div class="pb tblwrap" id="st-prod-body">${isStatic ? this.prodTable() : ''}</div></div>`;
  },
  billing(isStatic) {
    const b = this.data.billing; if (!b) return '';
    const tot = b.invoiced + b.pending, pc = tot ? Math.round(b.invoiced / tot * 100) : 0;
    const row = c => `<tr><td class="nm">${esc(c.name)}</td><td class="r">${this.eur(c.invoiced)}</td><td class="r"><b>${this.eur(c.pending)}</b></td><td class="r">${c.pending_orders}</td></tr>`;
    const pend = b.pending_list.slice(0, isStatic ? 25 : 15).map(p => `<tr${isStatic ? '' : ` style="cursor:pointer" onclick="go('orders/${p.id}')"`}><td class="nm">Nº ${p.number}${p.title ? ' · ' + esc(p.title) : ''}</td><td>${esc(p.client)}</td><td>${esc(fmt(p.date))}</td><td class="r">${p.unpriced ? '<span class="mini">sin precio</span> ' : ''}${this.eur(p.amount)}</td></tr>`).join('');
    return `<div class="panel"><div class="ph"><h2>Facturación</h2><span class="mini">Importes sin IVA</span></div><div class="pb">
      <div class="kpis" style="grid-template-columns:repeat(3,1fr)"><div class="kpi"><span>Facturado (${b.invoiced_orders} pedidos)</span><b>${this.eur(b.invoiced)}</b></div><div class="kpi" style="border-color:#d4af37"><span>Pendiente de facturar (${b.pending_orders} pedidos)</span><b>${this.eur(b.pending)}</b></div><div class="kpi"><span>Ya facturado del total</span><b>${pc} %</b></div></div>
      <div style="height:12px;border-radius:999px;background:var(--st-grid);overflow:hidden;margin:2px 0 18px" role="img" aria-label="${pc} % facturado"><div style="height:100%;width:${pc}%;background:#d4af37"></div></div>
      <div class="stgrid"><div class="tblwrap"><table class="sttable"><thead><tr><th>Cliente</th><th class="r">Facturado</th><th class="r">Pendiente</th><th class="r">Pedidos pend.</th></tr></thead><tbody>${b.by_client.map(row).join('')}</tbody></table></div>
      <div class="tblwrap"><table class="sttable"><thead><tr><th>Pedido pendiente de facturar</th><th>Cliente</th><th>Fecha</th><th class="r">Importe</th></tr></thead><tbody>${pend || '<tr><td colspan="4" class="mini">Todo facturado.</td></tr>'}</tbody></table></div></div></div></div>`;
  },
  paintTables() {
    const a = $('st-cli-body'), b = $('st-prod-body');
    if (a && this.data) a.innerHTML = this.cliTable();
    if (b && this.data) b.innerHTML = this.prodTable();
  },

  /* ---------- gráfico de barras apiladas por mes ---------- */
  niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(x => n <= x + 1e-9) || 10) * p;
  },
  roundTop(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  },
  bars() {
    const d = this.data, M = d.monthly;
    const W = 760, H = 300, L = 52, R = 10, T = 12, B = 34, pw = W - L - R, ph = H - T - B;
    const tot = M.map(m => m.cats.reduce((a, c) => a + this.val(c), 0));
    const max = this.niceMax(Math.max(...tot, 0));
    const slot = pw / M.length, bw = Math.max(6, Math.min(46, slot * 0.62));
    const y = v => T + ph - (v / max) * ph;
    let g = '', ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = max * i / ticks, yy = y(v);
      g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="stgrid-l${i === 0 ? ' base' : ''}"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" class="sttxt">${this.short(v)}</text>`;
    }
    const step = Math.ceil(M.length / 12);
    M.forEach((m, i) => {
      const cx = L + slot * i + slot / 2, x = cx - bw / 2;
      let acc = 0;
      const vis = m.cats.map((c, ci) => ({ v: this.val(c), ci })).filter(s => s.v > 0);
      vis.forEach((s, si) => {
        const y1 = y(acc + s.v), y0 = y(acc), h = Math.max(1, y0 - y1 - (si > 0 ? 2 : 0));
        const top = si === vis.length - 1;
        g += top ? `<path d="${this.roundTop(x, y1, bw, h, 4)}" fill="${this.col(s.ci)}"/>` : `<rect x="${x}" y="${y1}" width="${bw}" height="${h}" fill="${this.col(s.ci)}"/>`;
        acc += s.v;
      });
      if (i % step === 0) g += `<text x="${cx}" y="${H - 12}" text-anchor="middle" class="sttxt">${this.mlabel(m.month)}</text>`;
      g += `<rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${ph + B - 8}" fill="transparent" ${this.static ? '' : `onmousemove="ST.tipBar(${i},event)" onmouseleave="ST.tipOff()"`}/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="stsvg" role="img" aria-label="${this.isQty() ? 'Unidades' : 'Importe'} por mes, apilado por tipo de pedido">${g}</svg>`;
  },
  tipBar(i, ev) {
    const m = this.data.monthly[i], tot = m.cats.reduce((a, c) => a + this.val(c), 0);
    this.tip(`<b>${this.mlabel(m.month, true)}</b>` + m.cats.map((c, ci) => `<div><i style="background:${this.col(ci)}"></i>${esc(c.cat)}<span>${this.fmtV(this.val(c))}</span></div>`).join('') + `<div class="tt"><span>Total</span><span>${this.fmtV(tot)}</span></div>`, ev, 'st-bars');
  },
  tip(html, ev, host) {
    const t = $('st-tip'), h = $(host); if (!t || !h) return;
    t.innerHTML = html; t.style.display = 'block';
    const r = h.getBoundingClientRect();
    let x = ev.clientX - r.left + 14, yy = ev.clientY - r.top + 10;
    if (x + t.offsetWidth > r.width - 4) x = ev.clientX - r.left - t.offsetWidth - 14;
    t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, yy) + 'px';
  },
  tipOff() { const t = $('st-tip'); if (t) t.style.display = 'none'; },
  monthTable() {
    const d = this.data;
    return `<div class="tblwrap"><table class="sttable"><thead><tr><th>Mes</th>${d.categories.map(c => `<th class="r">${esc(c)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>` +
      d.monthly.map(m => `<tr><td>${this.mlabel(m.month, true)}</td>${m.cats.map(c => `<td class="r">${this.val(c) ? this.fmtV(this.val(c)) : '–'}</td>`).join('')}<td class="r"><b>${this.fmtV(m.cats.reduce((a, c) => a + this.val(c), 0))}</b></td></tr>`).join('') + `</tbody></table></div>`;
  },

  /* ---------- donut ---------- */
  donut() {
    const d = this.data, cats = d.cats, total = cats.reduce((a, c) => a + this.val(c), 0);
    const R = 92, r = 60, cx = 110, cy = 110;
    let a0 = -Math.PI / 2, segs = '';
    const live = cats.map((c, i) => ({ c, i, v: this.val(c) })).filter(s => s.v > 0);
    live.forEach(s => {
      const ang = total ? s.v / total * Math.PI * 2 : 0;
      if (live.length === 1) {
        segs += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${this.col(s.i)}" stroke-width="${R - r}" ${this.static ? '' : `onmousemove="ST.tipDonut(${s.i},event)" onmouseleave="ST.tipOff()"`}/>`;
      } else {
        const a1 = a0 + ang, large = ang > Math.PI ? 1 : 0;
        const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
        const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r, a1), [x3, y3] = p(r, a0);
        segs += `<path d="M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${large} 0 ${x3},${y3}Z" fill="${this.col(s.i)}" class="stseg" ${this.static ? '' : `onmousemove="ST.tipDonut(${s.i},event)" onmouseleave="ST.tipOff()"`}/>`;
        a0 = a1;
      }
    });
    const center = `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="stbig">${this.isQty() ? this.num(total) : this.short(total)}</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" class="sttxt">${this.isQty() ? 'unidades' : 'importe'}</text>`;
    const legend = cats.map((c, i) => {
      const v = this.val(c), pct = total ? Math.round(v / total * 1000) / 10 : 0;
      return `<div class="dl"><i style="background:${this.col(i)}"></i><span class="dn">${esc(c.cat)}</span><span class="dv">${this.fmtV(v)}</span><span class="dp">${pct.toLocaleString('es-ES')} %</span></div>`;
    }).join('');
    return `<div class="donutbox"><svg viewBox="0 0 220 220" class="stdonut" role="img" aria-label="Reparto por tipo de pedido">${segs}${center}</svg><div class="dleg">${legend}</div></div>`;
  },
  tipDonut(i, ev) {
    const c = this.data.cats[i], total = this.data.cats.reduce((a, x) => a + this.val(x), 0);
    this.tip(`<b>${esc(c.cat)}</b><div><span>${this.num(c.qty)} uds</span><span>${this.eur(c.amount)}</span></div><div class="tt"><span>Parte del total</span><span>${total ? (Math.round(this.val(c) / total * 1000) / 10).toLocaleString('es-ES') : 0} %</span></div>`, ev, 'st-donut');
  },

  /* ---------- tablas ---------- */
  th(tbl, key, label, cls) {
    if (this.static) return `<th class="${cls || ''}">${label}</th>`;
    const t = this.tbl[tbl], on = t.key === key;
    return `<th class="${cls || ''} sortable ${on ? 'on' : ''}" onclick="ST.sort('${tbl}','${key}')">${label}${on ? (t.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
  },
  sort(tbl, key) {
    const t = this.tbl[tbl];
    if (t.key === key) t.dir = -t.dir; else { t.key = key; t.dir = key === 'name' ? 1 : -1; }
    this.paintTables();
  },
  cliRows() {
    const d = this.data, t = this.tbl.cli, q = t.q.trim().toLowerCase();
    const rows = d.clients.filter(c => !q || c.name.toLowerCase().includes(q)).map(c => ({
      ...c, total: this.val(c), cells: d.months.map(m => c.months[m] ? this.val(c.months[m]) : 0)
    }));
    const key = t.key;
    rows.sort((a, b) => {
      let x, y;
      if (key === 'name') return t.dir * a.name.localeCompare(b.name);
      if (key === 'total') { x = a.total; y = b.total; }
      else { const i = d.months.indexOf(key); x = a.cells[i]; y = b.cells[i]; }
      return t.dir * (x - y) || a.name.localeCompare(b.name);
    });
    return rows;
  },
  cliTable() {
    const d = this.data, rows = this.cliRows();
    if (!rows.length) return '<div class="empty">Ningún cliente coincide.</div>';
    const e0 = v => Number(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: this.static ? 0 : 2 });
    const cell = v => v ? (this.isQty() ? this.num(v) : e0(v)) : '<span class="z">–</span>';
    const sums = d.months.map((m, i) => rows.reduce((a, r) => a + r.cells[i], 0)), grand = rows.reduce((a, r) => a + r.total, 0);
    return `<table class="sttable"><thead><tr>${this.th('cli', 'name', 'Cliente')}${d.months.map(m => this.th('cli', m, this.mlabel(m), 'r')).join('')}${this.th('cli', 'total', 'Total', 'r')}</tr></thead><tbody>` +
      rows.map(r => `<tr><td class="nm">${esc(r.name)}</td>${r.cells.map(v => `<td class="r">${cell(v)}</td>`).join('')}<td class="r"><b>${this.isQty() ? this.num(r.total) : this.eur(r.total)}</b></td></tr>`).join('') +
      `</tbody><tfoot><tr><td>Total</td>${sums.map(v => `<td class="r">${cell(v)}</td>`).join('')}<td class="r">${this.isQty() ? this.num(grand) : this.eur(grand)}</td></tr></tfoot></table>`;
  },
  prodRows() {
    const t = this.tbl.prod, q = t.q.trim().toLowerCase();
    const rows = this.data.products.filter(p => !q || p.name.toLowerCase().includes(q));
    rows.sort((a, b) => {
      if (t.key === 'name') return t.dir * a.name.localeCompare(b.name);
      return t.dir * ((a[t.key] || 0) - (b[t.key] || 0)) || a.name.localeCompare(b.name);
    });
    return rows;
  },
  prodTable() {
    const rows = this.prodRows();
    if (!rows.length) return '<div class="empty">Ningún producto coincide.</div>';
    const tag = p => p.pack ? ' <span class="tag">Pack</span>' : p.free ? ' <span class="tag">Fuera de catálogo</span>' : '';
    const sizes = p => { const s = this.sortSizes(p.sizes); return p.pack || !s.length ? '<span class="z">–</span>' : s.map(([k, v]) => `<span class="sz"><b>${esc(k)}</b> ${this.num(v)}</span>`).join(''); };
    return `<table class="sttable"><thead><tr>${this.th('prod', 'name', 'Producto')}<th>Tallas</th>${this.th('prod', 'qty', 'Unidades', 'r')}${this.th('prod', 'amount', 'Importe', 'r')}${this.th('prod', 'orders', 'Pedidos', 'r')}</tr></thead><tbody>` +
      rows.map(p => `<tr><td class="nm">${esc(p.name)}${tag(p)}</td><td class="szs" title="${esc(this.sortSizes(p.sizes).map(([k, v]) => k + ': ' + v).join(' · '))}">${sizes(p)}</td><td class="r"><b>${this.num(p.qty)}</b></td><td class="r">${p.amount ? this.eur(p.amount) : '<span class="z">–</span>'}</td><td class="r">${this.num(p.orders)}</td></tr>`).join('') +
      `</tbody></table><p class="hint">Las prendas de un pack cuentan en unidades de su producto; el importe del pack aparece en su propia fila.</p>`;
  },

  /* ---------- CSV ---------- */
  csv(which) {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const d = this.data; let rows;
    if (which === 'cli') {
      rows = [['Cliente', ...d.months.map(m => this.mlabel(m, true)), 'Total (' + (this.isQty() ? 'uds' : '€') + ')']];
      this.cliRows().forEach(r => rows.push([r.name, ...r.cells, r.total]));
    } else {
      rows = [['Producto', 'Tipo', 'Tallas', 'Unidades', 'Importe (€)', 'Pedidos']];
      this.prodRows().forEach(p => rows.push([p.name, p.pack ? 'Pack' : p.free ? 'Fuera de catálogo' : 'Catálogo', p.pack ? '' : this.sortSizes(p.sizes).map(([k, v]) => k + ':' + v).join(' '), p.qty, p.amount, p.orders]));
    }
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (which === 'cli' ? 'ventas-por-cliente' : 'ventas-por-producto') + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
};

/* Estilos propios de la sección (usan las variables del tema; el informe las redefine en claro) */
(function () {
  const css = `
  :root{--st-ink:var(--ink,#f4f4f4);--st-soft:var(--soft,#a8a8a8);--st-grid:#2a2a2a;--st-base:#4a4a4a;--st-surface:var(--bg2,#121212);}
  .stfilters{overflow:visible;} .stbar{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;} .stbar .field{margin:0;min-width:150px;}
  .seg{display:inline-flex;border:1px solid var(--line2,#333);border-radius:999px;padding:3px;gap:2px;}
  .seg button{border:0;background:transparent;color:var(--soft,#a8a8a8);padding:7px 14px;border-radius:999px;font:inherit;font-size:13.5px;cursor:pointer;}
  .seg button.on{background:var(--accent,#d4af37);color:#111;font-weight:600;}
  .msel{position:relative;} .msel summary{list-style:none;cursor:pointer;border:1px solid var(--line2,#333);border-radius:12px;padding:10px 14px;min-width:200px;background:var(--bg3,#1a1a1a);}
  .msel summary::-webkit-details-marker{display:none;} .msel summary:after{content:'▾';float:right;color:var(--soft,#a8a8a8);}
  .mselbox{position:absolute;z-index:20;top:100%;left:0;margin-top:6px;min-width:260px;max-height:300px;overflow:auto;background:var(--bg2,#121212);border:1px solid var(--line2,#333);border-radius:14px;padding:12px 14px;box-shadow:0 14px 34px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:8px;}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px;}
  .kpi{border:1px solid var(--line,#242424);background:var(--bg2,#121212);border-radius:18px;padding:16px 18px;display:flex;flex-direction:column;gap:4px;}
  .kpi span{font-size:12.5px;color:var(--st-soft);} .kpi b{font-family:var(--serif,Georgia,serif);font-weight:400;font-size:28px;color:var(--st-ink);font-variant-numeric:tabular-nums;line-height:1.15;}
  .stgrid{display:grid;grid-template-columns:1.7fr 1fr;gap:16px;align-items:start;} .stgrid>.panel{margin:0 0 16px;}
  .stleg{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--st-soft);} .stleg span{display:inline-flex;align-items:center;gap:7px;} .stleg i,.dl i,.sttip i{width:10px;height:10px;border-radius:3px;display:inline-block;flex:none;}
  .stsvg{width:100%;height:auto;display:block;} .stgrid-l{stroke:var(--st-grid);stroke-width:1;} .stgrid-l.base{stroke:var(--st-base);}
  .sttxt{fill:var(--st-soft);font-size:11.5px;font-family:var(--sans,Inter,sans-serif);} .stbig{fill:var(--st-ink);font-size:26px;font-family:var(--serif,Georgia,serif);}
  .stseg{stroke:var(--st-surface);stroke-width:2;} .hit:hover{fill:rgba(255,255,255,.04);}
  .sttip{display:none;position:absolute;pointer-events:none;z-index:5;background:var(--bg3,#1a1a1a);border:1px solid var(--line2,#333);border-radius:12px;padding:10px 12px;font-size:12.5px;min-width:190px;box-shadow:0 10px 26px rgba(0,0,0,.5);color:var(--st-ink);}
  .sttip b{display:block;margin-bottom:6px;} .sttip div{display:flex;align-items:center;gap:7px;justify-content:space-between;padding:2px 0;} .sttip div span{margin-left:auto;font-variant-numeric:tabular-nums;} .sttip .tt{border-top:1px solid var(--line2,#333);margin-top:5px;padding-top:6px;font-weight:600;}
  .donutbox{display:flex;flex-direction:column;align-items:center;gap:14px;} .stdonut{width:100%;max-width:230px;height:auto;}
  .dleg{width:100%;display:flex;flex-direction:column;gap:7px;font-size:13.5px;} .dl{display:flex;align-items:center;gap:8px;} .dn{flex:1;color:var(--st-ink);} .dv{color:var(--st-soft);font-variant-numeric:tabular-nums;} .dp{width:56px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;color:var(--st-ink);}
  .stalt summary{cursor:pointer;color:var(--st-soft);font-size:13px;} .stalt{border-top:1px solid var(--line,#242424);}
  .stsearch{min-width:210px;padding:8px 12px;font-size:13.5px;background:var(--bg3,#1a1a1a);color:var(--st-ink);border:1px solid var(--line2,#333);border-radius:12px;}
  .tblwrap{overflow-x:auto;}
  .sttable{width:100%;border-collapse:collapse;font-size:13.5px;min-width:0;font-variant-numeric:tabular-nums;}
  .sttable th{font-weight:500;color:var(--st-soft);font-size:12.5px;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line2,#333);white-space:nowrap;}
  .sttable th.sortable{cursor:pointer;} .sttable th.sortable:hover,.sttable th.on{color:var(--accent,#d4af37);}
  .sttable td{padding:9px 10px;border-bottom:1px solid var(--line,#242424);color:var(--st-ink);} .sttable .r{text-align:right;white-space:nowrap;} .sttable .nm{font-weight:500;}
  .sttable tfoot td{font-weight:600;border-top:1px solid var(--line2,#333);border-bottom:0;} .z{color:var(--st-soft);opacity:.6;}
  .szs{max-width:360px;} .sz{display:inline-block;margin:0 10px 2px 0;color:var(--st-soft);white-space:nowrap;} .sz b{color:var(--st-ink);font-weight:600;}
  .tag{font-size:11px;border:1px solid var(--line2,#333);border-radius:999px;padding:2px 8px;color:var(--st-soft);margin-left:6px;white-space:nowrap;}
  @media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr);} .stgrid{grid-template-columns:1fr;}}
  `;
  const el = document.createElement('style'); el.textContent = css; document.head.appendChild(el);
})();
