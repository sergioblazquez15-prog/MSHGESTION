'use strict';
/* ===== Editor de fases (se usa en cada pedido y en la plantilla global) ===== */
const PE = {
  s: null,

  init(phases, base, opts) {
    this.s = {
      phases: phases.map(p => ({
        name: p.name, min_days: +p.min_days || 0, max_days: +p.max_days || 0, descr: p.descr || '', color: p.color || '#d4af37',
        enabled: p.enabled !== false
      })),
      base: base || { order_date: S.today, status: 'Recibido', cur: 0 },
      opts: opts || {}
    };
  },

  html() {
    return `<div id="pe">${this.inner()}</div>`;
  },
  inner() {
    const s = this.s, en = s.opts.enable;
    const rows = s.phases.map((p, i) => `<div class="edrow ${p.enabled ? '' : 'off'}">
      <div class="gt-n" style="--c:${esc(p.color)}">${String(i + 1).padStart(2, '0')}</div>
      ${en ? `<input type="checkbox" ${p.enabled ? 'checked' : ''} title="Fase activa en este pedido" onchange="PE.set(${i},'enabled',this.checked,true)">` : '<span></span>'}
      <input type="text" value="${esc(p.name)}" placeholder="Nombre" oninput="PE.set(${i},'name',this.value)">
      <input type="number" min="0" value="${p.min_days}" title="Días mínimos" oninput="PE.set(${i},'min_days',+this.value||0)">
      <input type="number" min="0" value="${p.max_days}" title="Días máximos" oninput="PE.set(${i},'max_days',+this.value||0)">
      <input type="text" value="${esc(p.descr)}" placeholder="Descripción (opcional)" oninput="PE.set(${i},'descr',this.value)">
      <input type="color" value="${esc(p.color)}" oninput="PE.set(${i},'color',this.value)">
      <span class="row" style="gap:3px;flex-wrap:nowrap"><button type="button" class="ib" onclick="PE.move(${i},-1)" aria-label="Subir">↑</button><button type="button" class="ib" onclick="PE.move(${i},1)" aria-label="Bajar">↓</button><button type="button" class="ib" onclick="PE.del(${i})" aria-label="Quitar">✕</button></span></div>`).join('');
    return `<div class="edrow edhead"><span>#</span><span>${en ? 'Act.' : ''}</span><span>Fase</span><span>Mín</span><span>Máx</span><span>Descripción</span><span>Color</span><span></span></div>
      ${rows}
      <div class="row" style="margin:14px 0"><button type="button" class="btn ghost sm" onclick="PE.add()">+ Añadir fase</button><span class="mini" id="pe-total"></span></div>
      <div id="pe-prev"></div>`;
  },
  mount() { this.prev(); },
  redraw() { const el = $('pe'); if (el) { el.innerHTML = this.inner(); this.prev(); } },

  base() { const b = this.s.base; return { order_date: b.order_date, status: b.status === 'Entregado' ? 'Entregado' : b.status, cur: b.cur, phases: this.s.phases }; },
  prev() {
    const el = $('pe-prev'); if (!el) return;
    const o = this.base(), en = this.s.phases.filter(p => p.enabled);
    const tot = en.reduce((a, p) => a + p.max_days, 0), mn = en.reduce((a, p) => a + p.min_days, 0);
    const t = $('pe-total'); if (t) t.textContent = en.length + ' fases activas · entre ' + mn + ' y ' + tot + ' días';
    el.innerHTML = gantt(o);
  },

  set(i, k, v, redraw) {
    this.s.phases[i][k] = v;
    if (this.s.opts.onChange) this.s.opts.onChange();
    if (redraw) this.redraw(); else this.prev();
  },
  move(i, d) {
    const a = this.s.phases, j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    if (this.s.opts.onChange) this.s.opts.onChange();
    this.redraw();
  },
  del(i) {
    if (this.s.phases.length <= 1) return toast('Debe quedar al menos una fase', true);
    this.s.phases.splice(i, 1);
    if (this.s.opts.onChange) this.s.opts.onChange();
    this.redraw();
  },
  add() {
    this.s.phases.push({ name: 'Nueva fase', min_days: 1, max_days: 2, descr: '', color: '#d4af37', enabled: true });
    if (this.s.opts.onChange) this.s.opts.onChange();
    this.redraw();
  },
  collect() {
    const ph = this.s.phases;
    if (ph.some(p => !p.name.trim())) throw new Error('Todas las fases necesitan un nombre');
    if (ph.some(p => p.min_days > p.max_days)) throw new Error('En alguna fase el mínimo de días es mayor que el máximo');
    if (!ph.some(p => p.enabled)) throw new Error('Deja al menos una fase activa');
    return ph.map(p => ({ ...p, name: p.name.trim() }));
  }
};
