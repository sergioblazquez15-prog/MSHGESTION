'use strict';
/* ===== utilidades ===== */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { me: null, client: null, today: new Date().toLocaleDateString('sv-SE'), needsSetup: false };
const STATUSES = ['Recibido', 'Procesando', 'Listo para recoger', 'Entregado'];
const stKey = s => (s === 'Listo para recoger' ? 'Listo' : s);
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

async function api(method, url, body) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(url, opt);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
  if (res.status === 401 && S.me && !/\/api\/(login|setup)/.test(url)) {
    S.me = null; renderApp();
    throw new Error('Tu sesión ha caducado. Vuelve a entrar.');
  }
  if (!res.ok) throw new Error((data && data.error) || 'Error ' + res.status);
  return data;
}
const safe = async fn => { try { return await fn(); } catch (e) { toast(e.message, true); } };
function toast(msg, isErr) {
  const el = $('toast');
  el.textContent = msg;
  el.style.background = isErr ? '#e0697f' : '';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), isErr ? 5000 : 3200);
}

const fmt = d => {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return +dd + ' ' + MONTHS[+m - 1] + (y !== S.today.slice(0, 4) ? ' ' + y : '');
};
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
const diffDays = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5);
const money = n => (n == null || n === '' ? '' : Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
const initials = n => (String(n).split(/\s+/).filter(w => w.length > 2).map(w => w[0]).join('').slice(0, 3) || String(n).slice(0, 2)).toUpperCase();
const crestHTML = (c, lg) => {
  const name = c.name || c.client_name || '';
  const crest = c.crest || c.client_crest;
  const color = c.color || c.client_color || '#d4af37';
  return crest
    ? `<img class="crest ${lg ? 'lg' : ''}" src="/crests/${esc(crest)}" alt="">`
    : `<div class="crest ph ${lg ? 'lg' : ''}" style="background:${esc(color)}">${esc(initials(name))}</div>`;
};
const shieldHTML = o => {
  const crest = o.client_crest;
  return crest
    ? `<img class="shield" style="object-fit:cover" src="/crests/${esc(crest)}" alt="">`
    : `<div class="shield" style="background:${esc(o.client_color || '#d4af37')}">${esc(initials(o.client_name))}</div>`;
};

/* ===== iconos ===== */
const IC = {
  orders: '<path d="M9 3.5h6l1 2h3.5v15h-14v-15H8l1-2z"/><path d="M9 12h6M9 16h4"/>',
  hist: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5M12 7.5V12l3 2"/>',
  new: '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="M12 8v8M8 12h8"/>',
  clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18.5 14.3c1.9.8 3 2.7 3 5.7"/>',
  catalog: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  prod: '<path d="M3.5 20.5V9l6 4V9l6 4V4.5h5v16h-17z"/>',
  phases: '<rect x="3.5" y="5" width="17" height="15.5" rx="4"/><path d="M8 3v4M16 3v4M3.5 10.5h17"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'
};
const ico = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;

/* ===== arranque, acceso y navegación ===== */
const ADMIN_NAV = [['orders', 'Pedidos'], ['hist', 'Histórico'], ['new', 'Nuevo'], ['clients', 'Clientes'], ['catalog', 'Catálogo'], ['prod', 'Producción'], ['phases', 'Plazos'], ['settings', 'Ajustes']];
const CLIENT_NAV = [['new', 'Nuevo pedido'], ['mine', 'Mis pedidos']];
const NAV_ALIAS = { detail: 'orders', edit: 'orders', client: 'clients' };

async function boot() {
  window.addEventListener('hashchange', () => { if (S.me) route(); });
  await loadMe();
  renderApp();
}
async function loadMe() {
  const r = await fetch('/api/me', { credentials: 'same-origin' }).then(x => x.json());
  S.needsSetup = !!r.needsSetup;
  S.me = r.user || null;
  S.client = r.client || null;
  if (r.today) S.today = r.today;
}
function go(path) { if (location.hash === '#/' + path) route(); else location.hash = '#/' + path; }

function renderApp() {
  if (!S.me) return renderLogin();
  const admin = S.me.role === 'admin';
  const nav = admin ? ADMIN_NAV : CLIENT_NAV;
  const head = admin
    ? `<div class="brand">MSH <em>Pedidos</em></div>`
    : `<div style="display:flex;align-items:center;gap:14px">${crestHTML(S.client, true)}<div><div class="mini">Panel de pedidos</div><div class="clname">${esc(S.client.name)}</div></div></div>`;
  $('root').innerHTML = `<div class="shell">
    <div class="topbar">${head}<div class="who"><span>${esc(S.me.name || S.me.email)}</span> <button class="linkbtn" onclick="logout()">Salir</button></div></div>
    <nav class="topnav" id="topnav">${nav.map(n => `<a data-k="${n[0]}" onclick="go('${n[0]}')">${ico(n[0])}<span>${n[1]}</span><span class="badge" id="badge-${n[0]}" style="display:none"></span></a>`).join('')}</nav>
    <main id="main"></main></div>`;
  if (!location.hash || location.hash === '#') location.hash = '#/' + nav[0][0];
  else route();
}
async function logout() {
  await safe(() => api('POST', '/api/logout'));
  S.me = null; location.hash = ''; await loadMe(); renderApp();
}

async function route() {
  if (!S.me) return;
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const admin = S.me.role === 'admin';
  const views = admin ? ADMIN_VIEWS : CLIENT_VIEWS;
  const name = views[parts[0]] ? parts[0] : (admin ? 'orders' : 'new');
  const nav = NAV_ALIAS[name] || name;
  document.querySelectorAll('#topnav a').forEach(a => a.classList.toggle('on', a.dataset.k === nav));
  const main = $('main');
  try {
    const out = await views[name](parts.slice(1));
    if (location.hash.replace(/^#\/?/, '').split('/')[0] !== parts[0]) return;
    main.innerHTML = typeof out === 'string' ? out : out.html;
    if (out && out.after) out.after();
  } catch (e) {
    main.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

function renderLogin() {
  const setup = S.needsSetup;
  $('root').innerHTML = `<div class="login"><div class="card">
    <h1>MSH <em style="font-style:italic;color:var(--accent)">Pedidos</em></h1>
    <p class="sub">${setup ? 'Primera vez aquí. Crea el administrador de la aplicación.' : 'Entra con tu correo y contraseña.'}</p>
    <form onsubmit="return doLogin(event)">
      ${setup ? '<div class="field"><label>Tu nombre</label><input type="text" id="lg-name" autocomplete="name"></div>' : ''}
      <div class="field"><label>Correo</label><input type="text" id="lg-email" autocomplete="username" inputmode="email"></div>
      <div class="field"><label>Contraseña${setup ? ' (mínimo 8 caracteres)' : ''}</label><input type="password" id="lg-pass" autocomplete="${setup ? 'new-password' : 'current-password'}" style="width:100%;border:1px solid var(--line2);border-radius:14px;padding:9px 12px;font-size:14px;background:var(--bg3);color:var(--ink)"></div>
      <div class="err" id="lg-err"></div>
      <button class="btn amber full" type="submit">${setup ? 'Crear administrador y entrar' : 'Entrar'}</button>
    </form></div></div>`;
}
async function doLogin(ev) {
  ev.preventDefault();
  const email = $('lg-email').value.trim(), password = $('lg-pass').value;
  try {
    if (S.needsSetup) await api('POST', '/api/setup', { email, password, name: $('lg-name').value.trim() });
    else await api('POST', '/api/login', { email, password });
    location.hash = '';
    await loadMe();
    renderApp();
  } catch (e) { $('lg-err').textContent = e.message; }
  return false;
}

/* ===== fases y cronograma ===== */
const enabledPh = o => o.phases.filter(p => p.enabled);
const curIdx = o => {
  const n = enabledPh(o).length;
  return o.status === 'Entregado' ? n : Math.max(0, Math.min(o.cur || 0, n - 1));
};
const phName = o => {
  const en = enabledPh(o), c = curIdx(o);
  return c >= en.length ? 'Completado' : en[c].name + ' (' + (c + 1) + ' de ' + en.length + ')';
};
const estTotal = o => enabledPh(o).reduce((a, p) => a + (+p.max_days || 0), 0);
const estMin = o => enabledPh(o).reduce((a, p) => a + (+p.min_days || 0), 0);
const estDelivery = o => addDays(o.order_date, estTotal(o));

function seg(o) {
  const en = enabledPh(o), c = curIdx(o);
  return `<div class="seg">${en.map((p, i) => `<i style="--c:${esc(p.color)}" class="${i < c ? 'd' : i === c ? 'c' : ''}" title="${esc(p.name)}"></i>`).join('')}</div>`;
}

function gantt(o) {
  const en = enabledPh(o);
  if (!en.length) return '<div class="gt"><div class="empty">Este pedido no tiene fases activas.</div></div>';
  const tot = estTotal(o);
  const axis = Math.max(30, Math.ceil(tot / 5) * 5);
  const step = axis > 45 ? 10 : 5;
  const cur = curIdx(o);
  const pct = d => (d / axis * 100);
  const el = diffDays(S.today, o.order_date);
  const fin = o.status === 'Entregado';
  const showToday = !fin && el >= 0 && el <= axis;
  let ticks = '';
  for (let d = step; d <= axis; d += step) {
    if (showToday && Math.abs(pct(d) - pct(el)) < 7) continue;
    ticks += `<span style="left:${pct(d)}%">${d}</span>`;
  }
  const hoy = showToday ? `<span class="hoy" style="left:${pct(el)}%;${pct(el) > 80 ? 'transform:translateX(-100%)' : ''}">Hoy · día ${el}</span>` : '';
  const M = window.innerWidth < 900;
  const TW = M ? Math.max(200, window.innerWidth - 150) : 850;
  let off = 0;
  const rows = en.map((p, i) => {
    const w = +p.max_days || 0, left = pct(off), width = pct(w);
    off += w;
    const st = i < cur ? 'done' : i === cur ? 'cur' : 'pending';
    const days = (+p.min_days === +p.max_days ? p.max_days : p.min_days + '-' + p.max_days) + ' días';
    const tick = st === 'done' ? '✓ ' : '';
    const nm = esc(tick + p.name);
    const need = M ? ((tick + p.name).length * 9 + 40) : (((tick + p.name).length + days.length) * 10.5 + 52);
    const narrow = need / TW * 100 > width;
    const leftFree = left, rightFree = 100 - left - width;
    const side = rightFree >= leftFree ? 'r' : 'l';
    let bar, descSide;
    if (narrow) {
      bar = `<div class="gt-bar narrow ${st}" style="left:${left}%;width:${width}%"></div>`;
      const lab = M ? `<span>${nm}</span>` : `<span>${nm}</span><span>${days}</span>`;
      bar += side === 'r'
        ? `<div class="gt-out ${st}" style="left:calc(${left + width}% + 12px)">${lab}</div>`
        : `<div class="gt-out ${st}" style="right:calc(${100 - left}% + 12px)">${lab}</div>`;
      descSide = side === 'r' ? 'l' : 'r';
    } else {
      bar = `<div class="gt-bar ${st}" style="left:${left}%;width:${width}%" title="${days}"><span>${nm}</span>${M ? '' : `<span>${days}</span>`}</div>`;
      descSide = side;
    }
    const room = descSide === 'r' ? rightFree : leftFree;
    let desc = '';
    if (p.descr && room >= 24) {
      desc = descSide === 'r'
        ? `<div class="gt-desc" style="left:calc(${left + width}% + 16px);right:16px;text-align:right">${esc(p.descr)}</div>`
        : `<div class="gt-desc" style="left:16px;right:calc(${100 - left}% + 16px);text-align:left">${esc(p.descr)}</div>`;
    }
    const today = showToday ? `<div class="gt-today" style="left:${pct(el)}%"></div>` : '';
    return `<div class="gt-row" style="--c:${esc(p.color)}"><div class="gt-n">${String(i + 1).padStart(2, '0')}</div><div class="gt-track">${today}${desc}${bar}</div></div>`;
  }).join('');
  const ce = en[cur];
  const now = fin ? '<b>Pedido entregado</b>'
    : `Fase actual<br><b style="color:${esc(ce.color)}">${esc(ce.name)}</b>${ce.descr ? ' · ' + esc(ce.descr) : ''}`;
  const est = fin ? '' : `Entrega estimada<br><b>${fmt(addDays(o.order_date, estMin(o)))} – ${fmt(addDays(o.order_date, tot))}</b> · ${estMin(o)}–${tot} días`;
  return `<div class="gt"><div class="gt-axis"><div class="lbl">DÍAS</div><div class="ax">${ticks}${hoy}</div></div>${rows}
   <div class="gt-foot"><div class="est" style="text-align:left">${now}</div><div class="est">${est}</div></div></div>`;
}

/* ===== trozos comunes ===== */
function prioPill(o) {
  const d = diffDays(estDelivery(o), S.today);
  const c = d <= 7 ? 'p-high' : d <= 14 ? 'p-mid' : 'p-low';
  return `<span class="prio ${c}">${fmt(estDelivery(o))} · ${d < 0 ? 'hace ' + (-d) : d} días</span>`;
}
const finChips = fins => (fins || []).map(f =>
  `<span class="fin" ${f.fixed ? 'title="Incluido en el producto"' : ''}>${esc(f.name)}${f.value ? ': ' + esc(f.value) : ''}</span>`).join('');

function linesHTML(o) {
  const groups = new Map(), out = [];
  o.lines.forEach(l => {
    if (l.kind === 'pack') {
      const k = 'p' + l.group_no;
      if (!groups.has(k)) { groups.set(k, { name: l.pack_name, lines: [] }); out.push(groups.get(k)); }
      groups.get(k).lines.push(l);
    } else out.push(l);
  });
  return out.map(g => {
    if (g.lines) {
      return `<div class="box" style="padding:12px 16px"><div style="font-weight:600;margin-bottom:6px">${esc(g.name)} <span class="mini">× ${g.lines[0].qty}</span></div>
        ${g.lines.map(l => `<div class="sumrow" style="padding:7px 0"><span>${esc(l.product_name)} <span class="mini">${l.size ? '· talla ' + esc(l.size) : ''}</span></span><span>${finChips(l.finishes) || '<span class="mini">sin acabado</span>'}</span></div>`).join('')}</div>`;
    }
    return `<div class="sumrow"><span>${g.qty} × ${esc(g.product_name)} <span class="mini">${g.size ? '· talla ' + esc(g.size) : ''}${g.kind === 'free' ? ' · fuera de catálogo' : ''}</span></span><span>${finChips(g.finishes) || '<span class="mini">sin acabado</span>'}</span></div>`;
  }).join('');
}
const docLinks = o => (o.docs || []).map(d =>
  `<a href="/api/docs/${d.id}">${d.kind === 'factura' ? 'Factura' : 'Albarán'} · ${esc(d.filename)}</a>`).join('');
