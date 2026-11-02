const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, DATA, getSetting, setSetting } = require('./db');
const auth = require('./auth');
const mail = require('./mail');

const { createApp, uploader } = require('./mini');
const app = createApp();
app.use(auth.sessionMiddleware);

const STATUSES = ['Recibido', 'Procesando', 'Listo para recoger', 'Entregado'];
const PORT = parseInt(process.env.PORT || '3081', 10);

/* ---------- utilidades ---------- */
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const addDays = (d, n) => {
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + n);
  return x.toLocaleDateString('sv-SE');
};
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const slugify = s =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cliente';
const clean = (s, n = 200) => String(s == null ? '' : s).trim().slice(0, n);
const isHex = c => /^#[0-9a-fA-F]{6}$/.test(String(c || ''));
const PHOTO_RE = /^[a-f0-9]{28}\.(png|jpe?g|webp)$/;
const validPhoto = f => (PHOTO_RE.test(String(f || '')) && fs.existsSync(path.join(DATA, 'photos', String(f)))) ? String(f) : '';
const orderRef = o => 'pedido ' + o.number + (o.title ? ' - ' + o.title : '');
const money = v => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const IVA = 0.21;
const r2 = n => Math.round(n * 100) / 100;
const nextNumber = () => (db.prepare('SELECT MAX(number) AS m FROM orders').get().m || 0) + 1;
function pickNumber(raw, selfId) {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 999999) throw bad('El número de pedido debe ser un entero mayor que 0');
  if (db.prepare('SELECT 1 FROM orders WHERE number=? AND id<>?').get(n, selfId || 0)) throw bad('Ya existe el pedido nº ' + n + '. Elige otro número.');
  return n;
}
const logStatus = (orderId, what, user) =>
  db.prepare('INSERT INTO status_log(order_id,what,by_user) VALUES (?,?,?)').run(orderId, what, user ? (user.name || user.email) : 'sistema');

/* ---------- carga de pedidos ---------- */
function loadOrder(id) {
  const o = db.prepare(
    `SELECT o.*, c.name AS client_name, c.slug AS client_slug, c.color AS client_color, c.crest AS client_crest
     FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.id=?`
  ).get(id);
  if (!o) return null;
  o.lines = db.prepare('SELECT * FROM order_lines WHERE order_id=? ORDER BY sort,id').all(id);
  const fin = db.prepare('SELECT * FROM line_finishes WHERE line_id IN (SELECT id FROM order_lines WHERE order_id=?)').all(id);
  o.lines.forEach(l => {
    l.finishes = fin.filter(f => f.line_id === l.id).map(f => ({ name: f.name, value: f.value || '', fixed: !!f.fixed, price: f.price }));
  });
  // importes: línea suelta = uds × (precio + acabados); pack = uds × precio del pack (una vez por bloque) + acabados
  const seenPack = new Set();
  let total = 0, unpriced = 0;
  o.lines.forEach(l => {
    const fsum = l.finishes.reduce((a, f) => a + (f.price || 0), 0);
    let base = 0, has;
    if (l.kind === 'pack') {
      const k = l.group_no;
      if (!seenPack.has(k)) { seenPack.add(k); base = (l.pack_price || 0); has = l.pack_price != null; if (!has) unpriced++; }
      l.amount = r2(l.qty * (base + fsum));
    } else {
      base = l.unit_price || 0; has = l.unit_price != null;
      if (!has) unpriced++;
      l.amount = r2(l.qty * (base + fsum));
    }
    total += l.amount;
  });
  o.total = r2(total);                 // base imponible (precios sin IVA)
  o.iva = r2(total * IVA);
  o.total_iva = r2(total + o.iva);
  o.unpriced = unpriced;
  o.phases = db.prepare(
    'SELECT id,sort,name,min_days,max_days,descr,color,enabled FROM order_phases WHERE order_id=? ORDER BY sort,id'
  ).all(id).map(p => ({ ...p, enabled: !!p.enabled }));
  o.docs = db.prepare('SELECT id,kind,filename,size,uploaded_at FROM documents WHERE order_id=? ORDER BY id').all(id);
  o.log = db.prepare('SELECT at,what,by_user FROM status_log WHERE order_id=? ORDER BY id DESC').all(id);
  const en = o.phases.filter(p => p.enabled);
  o.est_max = en.reduce((a, p) => a + p.max_days, 0);
  o.est_min = en.reduce((a, p) => a + p.min_days, 0);
  o.est_delivery = addDays(o.order_date, o.est_max);
  o.est_delivery_min = addDays(o.order_date, o.est_min);
  o.units = o.lines.reduce((a, l) => a + l.qty, 0);
  return o;
}
function present(user, o) {
  if (!user || user.role !== 'client') return o;
  const out = { ...o, docs: o.docs.filter(d => d.kind !== 'pedido'), log: [] };
  // los clientes no ven precios
  delete out.total; delete out.iva; delete out.total_iva; delete out.unpriced;
  out.lines = o.lines.map(l => {
    const { unit_price, pack_price, amount, ...rest } = l;
    return { ...rest, finishes: l.finishes.map(({ price, ...f }) => f) };
  });
  if (o.client_view !== 'cronograma') {
    out.phases = []; out.cur = 0;
    delete out.est_max; delete out.est_min; delete out.est_delivery; delete out.est_delivery_min;
  }
  return out;
}
const canSee = (user, o) => user && (user.role === 'admin' || user.client_id === o.client_id);

/* ---------- catálogo ---------- */
function catalogOf(clientId) {
  const finishes = db.prepare('SELECT id,name,asks_value,value_label,price FROM finishes WHERE client_id=? ORDER BY sort,id').all(clientId);
  const fById = new Map(finishes.map(f => [f.id, f]));
  const prods = db.prepare('SELECT id,name,sizes,price,photo FROM products WHERE client_id=? ORDER BY sort,id').all(clientId);
  const pf = db.prepare(
    'SELECT product_id,finish_id,mode FROM product_finishes WHERE product_id IN (SELECT id FROM products WHERE client_id=?)'
  ).all(clientId);
  const products = prods.map(p => {
    const fm = {};
    pf.filter(x => x.product_id === p.id).forEach(x => { const f = fById.get(x.finish_id); if (f) fm[f.name] = x.mode; });
    return { name: p.name, sizes: p.sizes, price: p.price, photo: p.photo || '', finishes: fm };
  });
  const pById = new Map(prods.map(p => [p.id, p.name]));
  const packRows = db.prepare('SELECT id,name,price FROM packs WHERE client_id=? ORDER BY sort,id').all(clientId);
  const items = db.prepare(
    'SELECT pack_id,product_id FROM pack_items WHERE pack_id IN (SELECT id FROM packs WHERE client_id=?) ORDER BY sort'
  ).all(clientId);
  const packs = packRows.map(p => ({
    name: p.name, price: p.price,
    items: items.filter(i => i.pack_id === p.id).map(i => pById.get(i.product_id)).filter(Boolean)
  }));
  return {
    finishes: finishes.map(f => ({ name: f.name, asks_value: !!f.asks_value, value_label: f.value_label || '', price: f.price })),
    products, packs
  };
}

/* ---------- líneas de pedido ---------- */
function cleanLines(raw, client, enforce, requireColor) {
  const cat = catalogOf(client.id);
  const prodMap = new Map(), photoMap = new Map();
  const packSet = new Set();
  const priceProd = new Map(), pricePack = new Map(), priceFin = new Map();
  cat.products.forEach(p => { prodMap.set(p.name, p.finishes); photoMap.set(p.name, p.photo); priceProd.set(p.name, p.price); });
  cat.packs.forEach(p => { packSet.add(p.name); pricePack.set(p.name, p.price); });
  cat.finishes.forEach(f => priceFin.set(f.name, f.price));
  const admin = !enforce;      // solo el administrador puede fijar o cambiar precios; al cliente se le aplican los del catálogo
  const pick = (obj, key, fallback) => (admin && obj && key in obj) ? money(obj[key]) : (fallback == null ? null : fallback);
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach(l => {
    const kind = ['pack', 'product', 'free'].includes(l.kind) ? l.kind : 'free';
    const name = clean(l.product_name);
    if (!name) return;
    const qty = Math.min(100000, Math.max(1, parseInt(l.qty, 10) || 1));
    let fins = (Array.isArray(l.finishes) ? l.finishes : [])
      .map(f => ({ name: clean(f.name, 100), value: clean(f.value), fixed: !!f.fixed, _raw: f })).filter(f => f.name);
    if (enforce) {
      if (kind === 'pack' && !client.allow_packs) throw bad('Este cliente no puede pedir packs');
      if (kind === 'product' && !client.allow_products) throw bad('Este cliente no puede pedir productos sueltos del catálogo');
      if (kind === 'free' && !client.allow_free) throw bad('Este cliente no puede añadir líneas libres');
      if (kind === 'free') fins = [];
      else {
        const fm = prodMap.get(name);
        if (!fm) throw bad('El producto «' + name + '» no está en el catálogo');
        if (kind === 'pack' && !packSet.has(clean(l.pack_name))) throw bad('El pack «' + clean(l.pack_name) + '» no está en el catálogo');
        const fixed = Object.keys(fm).filter(n => fm[n] === 'fixed').map(n => ({ name: n, value: '', fixed: true }));
        const optional = fins.filter(f => fm[f.name] === 'optional').map(f => ({ ...f, fixed: false }));
        fins = [...fixed, ...optional];
      }
    }
    // precios (instantánea en el momento de guardar)
    fins = fins.map(f => {
      return { name: f.name, value: f.value, fixed: f.fixed, price: f.fixed ? null : pick(f._raw, 'price', priceFin.get(f.name)) };
    });
    const unit_price = kind === 'pack' ? null : (kind === 'free' ? (admin ? money(l.unit_price) : null) : pick(l, 'unit_price', priceProd.get(name)));
    const pack_price = kind === 'pack' ? pick(l, 'pack_price', pricePack.get(clean(l.pack_name))) : null;
    const color = clean(l.color, 60);
    if (requireColor && !color) throw bad('Indica el color de «' + name + '»');
    const photo = kind === 'free' ? validPhoto(l.photo) : (photoMap.get(name) || validPhoto(l.photo));
    out.push({
      kind, color, photo, group_no: parseInt(l.group_no, 10) || 0,
      pack_name: kind === 'pack' ? clean(l.pack_name) : null,
      product_name: name, size: clean(l.size, 40), qty, finishes: fins, unit_price, pack_price
    });
  });
  if (!out.length) throw bad('El pedido no tiene ninguna línea');
  return out;
}
function writeLines(orderId, lines) {
  db.prepare('DELETE FROM order_lines WHERE order_id=?').run(orderId);
  const insL = db.prepare('INSERT INTO order_lines(order_id,sort,kind,group_no,pack_name,product_name,size,qty,color,photo,unit_price,pack_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const insF = db.prepare('INSERT INTO line_finishes(line_id,name,value,fixed,price) VALUES (?,?,?,?,?)');
  lines.forEach((l, i) => {
    const id = insL.run(orderId, i, l.kind, l.group_no, l.pack_name, l.product_name, l.size, l.qty, l.color || '', l.photo || '', l.unit_price == null ? null : l.unit_price, l.pack_price == null ? null : l.pack_price).lastInsertRowid;
    l.finishes.forEach(f => insF.run(id, f.name, f.value, f.fixed ? 1 : 0, f.price == null ? null : f.price));
  });
}
function writePhases(orderId, phases) {
  db.prepare('DELETE FROM order_phases WHERE order_id=?').run(orderId);
  const ins = db.prepare('INSERT INTO order_phases(order_id,sort,name,min_days,max_days,descr,color,enabled) VALUES (?,?,?,?,?,?,?,?)');
  phases.forEach((p, i) => ins.run(
    orderId, i, clean(p.name, 80) || 'Fase',
    Math.max(0, parseInt(p.min_days, 10) || 0), Math.max(0, parseInt(p.max_days, 10) || 0),
    clean(p.descr, 300), isHex(p.color) ? p.color : '#d4af37', p.enabled === false ? 0 : 1
  ));
}

/* ---------- avisos por email ---------- */
function linesSummaryHtml(o) {
  return `<p style="color:#a8a8a8;font-size:13px">${o.units} unidades · entrega estimada ${mail.esc(o.est_delivery)}</p>`;
}
function curPhase(o) {
  const en = o.phases.filter(p => p.enabled);
  if (o.status === 'Entregado') return null;
  return en[Math.max(0, Math.min(o.cur, en.length - 1))] || null;
}
async function mailProgress(o) {
  const ph = o.client_view === 'cronograma' ? curPhase(o) : null;   // si solo ve el estado, no se le cuentan las fases
  const ref = orderRef(o);
  let title, subject;
  if (o.status === 'Entregado') {
    title = 'Tu ' + ref + ' ha sido entregado';
    subject = 'Pedido ' + o.number + ' entregado';
  } else if (o.status === 'Listo para recoger') {
    title = 'Tu ' + ref + ' está listo para recoger';
    subject = 'Pedido ' + o.number + ' listo para recoger';
  } else if (ph) {
    title = 'Tu ' + ref + ' avanza: ' + ph.name;
    subject = 'Pedido ' + o.number + ' · ' + ph.name;
  } else {
    title = 'Tu ' + ref + ': ' + o.status;
    subject = 'Pedido ' + o.number + ' · ' + o.status;
  }
  const body = (ph && o.status !== 'Entregado' ? `<p>${mail.esc(ph.descr || '')}</p>` : '') + (o.client_view === 'cronograma' ? linesSummaryHtml(o) : `<p style="color:#a8a8a8;font-size:13px">${o.units} unidades</p>`);
  await mail.notifyClient(o.client_id, subject, title, body);
}

/* ---------- creación de pedidos ---------- */
function createOrder({ client, origin, user, order_date, channel, notes, lines, number, title, client_view }) {
  const tpl = db.prepare('SELECT * FROM phase_template ORDER BY sort,id').all();
  const tx = db.transaction(() => {
    const id = db.prepare(
      'INSERT INTO orders(client_id,origin,created_by,order_date,channel,notes,number,title,client_view) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(client.id, origin, user.id, order_date, clean(channel, 60), clean(notes, 2000), number || nextNumber(), clean(title, 120), client_view === 'cronograma' ? 'cronograma' : 'estado').lastInsertRowid;
    writeLines(id, lines);
    writePhases(id, tpl.map(p => ({ ...p, enabled: true })));
    logStatus(id, origin === 'admin' ? 'Pedido introducido por MSH' : 'Pedido recibido', user);
    return id;
  });
  return tx();
}

/* ---------- acceso ---------- */
app.get('/api/me', (req, res) => {
  const needsSetup = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n === 0;
  if (!req.user) return res.json({ user: null, needsSetup });
  const out = { user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role }, today: todayStr() };
  if (req.user.role === 'client') {
    out.client = db.prepare('SELECT id,name,slug,color,crest,allow_packs,allow_products,allow_free,can_order FROM clients WHERE id=?').get(req.user.client_id);
  }
  res.json(out);
});

app.post('/api/setup', (req, res) => {
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n;
  if (n > 0) throw bad('Ya hay un administrador creado', 403);
  const email = clean(req.body.email, 120).toLowerCase();
  const pw = String(req.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Escribe un correo válido');
  if (pw.length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
  const id = db.prepare("INSERT INTO users(email,name,pass,role) VALUES (?,?,?, 'admin')")
    .run(email, clean(req.body.name, 80) || 'Administrador', auth.hashPassword(pw)).lastInsertRowid;
  auth.startSession(res, id);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const key = req.ip + '|' + email;
  if (auth.tooManyAttempts(key)) throw bad('Demasiados intentos. Espera unos minutos.', 429);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !u.active || !auth.verifyPassword(req.body.password, u.pass)) {
    auth.noteAttempt(key);
    throw bad('Correo o contraseña incorrectos', 401);
  }
  auth.startSession(res, u.id);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { auth.endSession(req, res); res.json({ ok: true }); });

app.post('/api/me/password', auth.requireUser, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!auth.verifyPassword(req.body.current, u.pass)) throw bad('La contraseña actual no es correcta');
  if (String(req.body.next || '').length < 8) throw bad('La nueva contraseña debe tener al menos 8 caracteres');
  db.prepare('UPDATE users SET pass=? WHERE id=?').run(auth.hashPassword(req.body.next), u.id);
  res.json({ ok: true });
});

/* ---------- clientes (admin) ---------- */
const crestUpload = uploader({
  dir: path.join(DATA, 'crests'), limit: 2 * 1024 * 1024, accept: /\.(png|jpe?g|webp)$/i,
  ext: n => path.extname(n).toLowerCase()
});
const docUpload = uploader({
  dir: path.join(DATA, 'uploads'), limit: 20 * 1024 * 1024, accept: /\.(pdf|png|jpe?g|webp|xlsx?|csv)$/i,
  ext: n => path.extname(n).toLowerCase()
});
const photoUpload = uploader({
  dir: path.join(DATA, 'photos'), limit: 8 * 1024 * 1024, accept: /\.(png|jpe?g|webp)$/i, ext: n => path.extname(n).toLowerCase().replace('.jpeg', '.jpg')
});

app.get('/api/clients', auth.requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT c.*,
      (SELECT COUNT(*) FROM users u WHERE u.client_id=c.id AND u.role='client') AS users_n,
      (SELECT COUNT(*) FROM orders o WHERE o.client_id=c.id AND o.status<>'Entregado') AS active_orders,
      (SELECT COUNT(*) FROM orders o WHERE o.client_id=c.id) AS total_orders
     FROM clients c ORDER BY c.sort_order, c.id`
  ).all();
  res.json(rows);
});
app.post('/api/clients', auth.requireAdmin, (req, res) => {
  const name = clean(req.body.name, 120);
  if (!name) throw bad('Escribe el nombre del cliente');
  let slug = slugify(req.body.slug || name), base = slug, i = 2;
  while (db.prepare('SELECT 1 FROM clients WHERE slug=?').get(slug)) slug = base + '-' + i++;
  const so = (db.prepare('SELECT MAX(sort_order) AS m FROM clients').get().m || 0) + 1;
  const id = db.prepare('INSERT INTO clients(name,slug,color,allow_packs,allow_products,allow_free,can_order,sort_order) VALUES (?,?,?,?,?,?,?,?)').run(
    name, slug, isHex(req.body.color) ? req.body.color : '#d4af37',
    req.body.allow_packs === false ? 0 : 1, req.body.allow_products ? 1 : 0, req.body.allow_free === false ? 0 : 1,
    req.body.can_order ? 1 : 0, so   // un cliente nuevo solo puede ver el estado hasta que MSH le deje pedir
  ).lastInsertRowid;
  res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(id));
});
app.put('/api/clients/:id', auth.requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!c) throw bad('Cliente no encontrado', 404);
  const b = req.body;
  db.prepare('UPDATE clients SET name=?,color=?,allow_packs=?,allow_products=?,allow_free=?,active=?,can_order=? WHERE id=?').run(
    clean(b.name, 120) || c.name, isHex(b.color) ? b.color : c.color,
    b.allow_packs ? 1 : 0, b.allow_products ? 1 : 0, b.allow_free ? 1 : 0, b.active === false ? 0 : 1,
    b.can_order === undefined ? c.can_order : (b.can_order ? 1 : 0), c.id
  );
  res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(c.id));
});
app.put('/api/client-order', auth.requireAdmin, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  db.transaction(() => {
    const up = db.prepare('UPDATE clients SET sort_order=? WHERE id=?');
    ids.forEach((id, i) => up.run(i + 1, id));
  })();
  res.json({ ok: true });
});
app.post('/api/clients/:id/crest', auth.requireAdmin, crestUpload.single('file'), (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!c) throw bad('Cliente no encontrado', 404);
  if (!req.file) throw bad('Sube una imagen PNG, JPG o WEBP (máximo 2 MB)');
  if (c.crest) fs.unlink(path.join(DATA, 'crests', c.crest), () => {});
  db.prepare('UPDATE clients SET crest=? WHERE id=?').run(req.file.filename, c.id);
  res.json({ crest: req.file.filename });
});
app.delete('/api/clients/:id', auth.requireAdmin, (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE client_id=?').get(req.params.id).n;
  if (n > 0) throw bad('Este cliente tiene pedidos. Desactívalo en vez de borrarlo para no perder el histórico.');
  db.prepare('DELETE FROM clients WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* usuarios de cliente */
app.get('/api/clients/:id/users', auth.requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT id,email,name,active FROM users WHERE client_id=? AND role='client' ORDER BY id").all(req.params.id));
});
app.post('/api/clients/:id/users', auth.requireAdmin, (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Escribe un correo válido');
  if (String(req.body.password || '').length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw bad('Ya existe un usuario con ese correo');
  const id = db.prepare("INSERT INTO users(email,name,pass,role,client_id) VALUES (?,?,?, 'client', ?)")
    .run(email, clean(req.body.name, 80), auth.hashPassword(req.body.password), req.params.id).lastInsertRowid;
  res.json({ id });
});
app.put('/api/users/:id', auth.requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw bad('Usuario no encontrado', 404);
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
    db.prepare('UPDATE users SET pass=? WHERE id=?').run(auth.hashPassword(req.body.password), u.id);
  }
  if (req.body.active != null) {
    if (u.id === req.user.id) throw bad('No puedes desactivarte a ti mismo');
    db.prepare('UPDATE users SET active=? WHERE id=?').run(req.body.active ? 1 : 0, u.id);
  }
  if (req.body.name != null) db.prepare('UPDATE users SET name=? WHERE id=?').run(clean(req.body.name, 80), u.id);
  res.json({ ok: true });
});
app.delete('/api/users/:id', auth.requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) throw bad('No puedes borrarte a ti mismo');
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admins', auth.requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT id,email,name,active FROM users WHERE role='admin' ORDER BY id").all());
});
app.post('/api/admins', auth.requireAdmin, (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Escribe un correo válido');
  if (String(req.body.password || '').length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw bad('Ya existe un usuario con ese correo');
  db.prepare("INSERT INTO users(email,name,pass,role) VALUES (?,?,?, 'admin')")
    .run(email, clean(req.body.name, 80) || 'Administrador', auth.hashPassword(req.body.password));
  res.json({ ok: true });
});

/* ---------- catálogo ---------- */
app.get('/api/clients/:id/catalog', auth.requireUser, (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'admin' && req.user.client_id !== id) throw bad('No permitido', 403);
  const cat = catalogOf(id);
  if (req.user.role !== 'admin') {
    cat.finishes.forEach(f => { delete f.price; });
    cat.products.forEach(p => { delete p.price; });
    cat.packs.forEach(p => { delete p.price; });
  }
  res.json(cat);
});
app.put('/api/clients/:id/catalog', auth.requireAdmin, (req, res) => {
  const cid = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM clients WHERE id=?').get(cid)) throw bad('Cliente no encontrado', 404);
  const b = req.body || {};
  const finishes = (b.finishes || []).map(f => ({
    name: clean(f.name, 100), asks_value: f.asks_value ? 1 : 0, value_label: clean(f.value_label, 60), price: money(f.price)
  })).filter(f => f.name);
  const products = (b.products || []).map(p => ({
    name: clean(p.name, 150),
    sizes: String(p.sizes || '').split(',').map(s => s.trim()).filter(Boolean).join(','),
    price: money(p.price),
    photo: validPhoto(p.photo), finishes: p.finishes || {}
  })).filter(p => p.name);
  const packs = (b.packs || []).map(p => ({
    name: clean(p.name, 150),
    price: money(p.price),
    items: Array.isArray(p.items) ? p.items : []
  })).filter(p => p.name);
  const dup = arr => arr.find((x, i) => arr.findIndex(y => y.name.toLowerCase() === x.name.toLowerCase()) !== i);
  let d;
  if ((d = dup(finishes))) throw bad('Acabado repetido: ' + d.name);
  if ((d = dup(products))) throw bad('Producto repetido: ' + d.name);
  if ((d = dup(packs))) throw bad('Pack repetido: ' + d.name);

  db.transaction(() => {
    db.prepare('DELETE FROM packs WHERE client_id=?').run(cid);
    db.prepare('DELETE FROM products WHERE client_id=?').run(cid);
    db.prepare('DELETE FROM finishes WHERE client_id=?').run(cid);
    const fId = new Map(), pId = new Map();
    const insF = db.prepare('INSERT INTO finishes(client_id,name,asks_value,value_label,sort,price) VALUES (?,?,?,?,?,?)');
    finishes.forEach((f, i) => fId.set(f.name, insF.run(cid, f.name, f.asks_value, f.value_label, i, f.price).lastInsertRowid));
    const insP = db.prepare('INSERT INTO products(client_id,name,sizes,price,sort,photo) VALUES (?,?,?,?,?,?)');
    const insPF = db.prepare('INSERT INTO product_finishes(product_id,finish_id,mode) VALUES (?,?,?)');
    products.forEach((p, i) => {
      const id = insP.run(cid, p.name, p.sizes, p.price, i, p.photo).lastInsertRowid;
      pId.set(p.name, id);
      Object.keys(p.finishes).forEach(fn => {
        const mode = p.finishes[fn];
        if ((mode === 'fixed' || mode === 'optional') && fId.has(fn)) insPF.run(id, fId.get(fn), mode);
      });
    });
    const insK = db.prepare('INSERT INTO packs(client_id,name,price,sort) VALUES (?,?,?,?)');
    const insKI = db.prepare('INSERT INTO pack_items(pack_id,product_id,sort) VALUES (?,?,?)');
    packs.forEach((p, i) => {
      const id = insK.run(cid, p.name, p.price, i).lastInsertRowid;
      p.items.forEach((pn, j) => { if (pId.has(pn)) insKI.run(id, pId.get(pn), j); });
    });
  })();
  res.json(catalogOf(cid));
});

/* ---------- plantilla de fases ---------- */
app.get('/api/phase-template', auth.requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT name,min_days,max_days,descr,color FROM phase_template ORDER BY sort,id').all());
});
app.put('/api/phase-template', auth.requireAdmin, (req, res) => {
  const list = Array.isArray(req.body.phases) ? req.body.phases : [];
  if (!list.length) throw bad('Debe haber al menos una fase');
  db.transaction(() => {
    db.prepare('DELETE FROM phase_template').run();
    const ins = db.prepare('INSERT INTO phase_template(sort,name,min_days,max_days,descr,color) VALUES (?,?,?,?,?,?)');
    list.forEach((p, i) => ins.run(
      i, clean(p.name, 80) || 'Fase', Math.max(0, parseInt(p.min_days, 10) || 0), Math.max(0, parseInt(p.max_days, 10) || 0),
      clean(p.descr, 300), isHex(p.color) ? p.color : '#d4af37'
    ));
  })();
  res.json({ ok: true });
});

/* ---------- pedidos ---------- */
app.get('/api/orders', auth.requireUser, (req, res) => {
  const where = [], params = [];
  if (req.user.role === 'client') { where.push('client_id=?'); params.push(req.user.client_id); }
  else if (req.query.client) { where.push('client_id=?'); params.push(Number(req.query.client)); }
  if (req.query.scope === 'active') where.push("status<>'Entregado'");
  if (req.query.scope === 'delivered') where.push("status='Entregado'");
  const rows = db.prepare('SELECT id FROM orders' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC').all(...params);
  res.json(rows.map(r => present(req.user, loadOrder(r.id))));
});
app.get('/api/orders/:id', auth.requireUser, (req, res) => {
  const o = loadOrder(Number(req.params.id));
  if (!o || !canSee(req.user, o)) throw bad('Pedido no encontrado', 404);
  res.json(present(req.user, o));
});

app.get('/api/next-number', auth.requireAdmin, (req, res) => res.json({ number: nextNumber() }));

app.post('/api/orders', auth.requireUser, wrap(async (req, res) => {
  const b = req.body || {};
  let client, origin, order_date, number = null, client_view = 'estado';
  if (req.user.role === 'client') {
    client = db.prepare('SELECT * FROM clients WHERE id=? AND active=1').get(req.user.client_id);
    if (client && !client.can_order) throw bad('Tu cuenta solo puede consultar pedidos. Para hacer uno, contacta con MSH.', 403);
    origin = 'cliente';
    order_date = todayStr();
  } else {
    client = db.prepare('SELECT * FROM clients WHERE id=?').get(Number(b.client_id));
    origin = 'admin';
    order_date = isDate(b.order_date) ? b.order_date : todayStr();
    number = pickNumber(b.number);
    client_view = b.client_view === 'cronograma' ? 'cronograma' : 'estado';
  }
  if (!client) throw bad('Cliente no encontrado', 404);
  const lines = cleanLines(b.lines, client, req.user.role === 'client', true);
  const id = createOrder({ client, origin, user: req.user, order_date, channel: b.channel, notes: b.notes, lines, number, title: b.title, client_view });
  const o = loadOrder(id);
  if (origin === 'cliente') {
    await mail.notifyAdmin('Nuevo ' + orderRef(o) + ' de ' + client.name, 'Nuevo ' + orderRef(o) + ' de ' + client.name,
      `<p>${o.units} unidades en ${o.lines.length} líneas.</p>`);
  } else {
    await mail.notifyClient(client.id, 'Hemos registrado tu ' + orderRef(o), 'Hemos registrado tu ' + orderRef(o),
      `<p>Lo hemos introducido con fecha ${mail.esc(order_date)}.</p>` + (client_view === 'cronograma' ? linesSummaryHtml(o) : ''));
  }
  res.json(present(req.user, o));
}));

// Edición de un pedido ya enviado: solo administradores
app.put('/api/orders/:id', auth.requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw bad('Pedido no encontrado', 404);
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(o.client_id);
  const lines = cleanLines(req.body.lines, client, false, false);
  const number = pickNumber(req.body.number, o.id) || o.number;
  const view = req.body.client_view === 'cronograma' ? 'cronograma' : req.body.client_view === 'estado' ? 'estado' : o.client_view;
  db.transaction(() => {
    writeLines(o.id, lines);
    db.prepare('UPDATE orders SET order_date=?,channel=?,notes=?,number=?,title=?,client_view=?,updated_at=datetime(\'now\') WHERE id=?').run(
      isDate(req.body.order_date) ? req.body.order_date : o.order_date, clean(req.body.channel, 60), clean(req.body.notes, 2000),
      number, req.body.title == null ? o.title : clean(req.body.title, 120), view, o.id
    );
    logStatus(o.id, 'Pedido modificado por MSH', req.user);
  })();
  res.json(loadOrder(o.id));
});

app.post('/api/orders/:id/meta', auth.requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw bad('Pedido no encontrado', 404);
  const number = pickNumber(req.body.number, o.id) || o.number;
  const title = clean(req.body.title, 120);
  db.prepare("UPDATE orders SET number=?,title=?,updated_at=datetime('now') WHERE id=?").run(number, title, o.id);
  logStatus(o.id, 'Datos del pedido: nº ' + number + (title ? ' · ' + title : ''), req.user);
  res.json(loadOrder(o.id));
});
app.post('/api/orders/:id/view', auth.requireAdmin, (req, res) => {
  const o = db.prepare('SELECT id FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw bad('Pedido no encontrado', 404);
  const v = req.body.client_view === 'cronograma' ? 'cronograma' : 'estado';
  db.prepare("UPDATE orders SET client_view=?,updated_at=datetime('now') WHERE id=?").run(v, o.id);
  logStatus(o.id, 'El cliente ve: ' + (v === 'cronograma' ? 'el cronograma completo' : 'solo el estado'), req.user);
  res.json(loadOrder(o.id));
});
app.put('/api/orders/:id/phases', auth.requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw bad('Pedido no encontrado', 404);
  const phases = Array.isArray(req.body.phases) ? req.body.phases : [];
  if (!phases.some(p => p.enabled !== false)) throw bad('Deja al menos una fase activa');
  db.transaction(() => {
    writePhases(o.id, phases);
    const n = phases.filter(p => p.enabled !== false).length;
    const cur = o.status === 'Entregado' ? n : Math.min(o.cur, n - 1);
    const od = isDate(req.body.order_date) ? req.body.order_date : o.order_date;
    db.prepare("UPDATE orders SET cur=?,order_date=?,updated_at=datetime('now') WHERE id=?").run(cur, od, o.id);
    logStatus(o.id, 'Fases o plazos modificados', req.user);
  })();
  res.json(loadOrder(o.id));
});

app.post('/api/orders/:id/status', auth.requireAdmin, wrap(async (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw bad('Pedido no encontrado', 404);
  const st = req.body.status;
  if (!STATUSES.includes(st)) throw bad('Estado no válido');
  if (st === o.status) return res.json(loadOrder(o.id));
  const n = db.prepare('SELECT COUNT(*) AS n FROM order_phases WHERE order_id=? AND enabled=1').get(o.id).n;
  let cur = o.cur;
  if (st === 'Entregado') cur = n;
  else if (o.status === 'Entregado') cur = Math.max(0, n - 1);
  db.transaction(() => {
    db.prepare("UPDATE orders SET status=?,cur=?,delivered_at=?,updated_at=datetime('now') WHERE id=?")
      .run(st, cur, st === 'Entregado' ? todayStr() : null, o.id);
    logStatus(o.id, 'Estado: ' + o.status + ' → ' + st, req.user);
  })();
  const out = loadOrder(o.id);
  await mailProgress(out);
  res.json(out);
}));

app.post('/api/orders/:id/advance', auth.requireAdmin, wrap(async (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw bad('Pedido no encontrado', 404);
  const phases = db.prepare('SELECT name FROM order_phases WHERE order_id=? AND enabled=1 ORDER BY sort,id').all(o.id);
  const n = phases.length;
  const dir = Number(req.body.dir) < 0 ? -1 : 1;
  let status = o.status, cur = o.cur, delivered = o.delivered_at, what;
  if (dir > 0) {
    if (o.status === 'Entregado') throw bad('El pedido ya está entregado');
    cur = o.cur + 1;
    if (cur >= n) { cur = n; status = 'Entregado'; delivered = todayStr(); what = 'Pedido completado → Entregado'; }
    else { if (status === 'Recibido') status = 'Procesando'; what = 'Fase: ' + phases[cur].name; }
  } else if (o.status === 'Entregado') {
    status = 'Procesando'; cur = Math.max(0, n - 1); delivered = null; what = 'Pedido reabierto · fase: ' + phases[cur].name;
  } else {
    cur = Math.max(0, o.cur - 1); what = 'Fase: ' + phases[cur].name;
  }
  db.transaction(() => {
    db.prepare("UPDATE orders SET status=?,cur=?,delivered_at=?,updated_at=datetime('now') WHERE id=?").run(status, cur, delivered, o.id);
    logStatus(o.id, what, req.user);
  })();
  const out = loadOrder(o.id);
  if (dir > 0 && (out.status !== o.status || out.client_view === 'cronograma')) await mailProgress(out);
  res.json(out);
}));

app.delete('/api/orders/:id', auth.requireAdmin, (req, res) => {
  const docs = db.prepare('SELECT stored FROM documents WHERE order_id=?').all(req.params.id);
  db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id);
  docs.forEach(d => fs.unlink(path.join(DATA, 'uploads', d.stored), () => {}));
  res.json({ ok: true });
});

/* ---------- documentos (albarán y factura) ---------- */
app.post('/api/orders/:id/docs', auth.requireAdmin, docUpload.single('file'), (req, res) => {
  const o = db.prepare('SELECT id FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw bad('Pedido no encontrado', 404);
  const kind = ['factura', 'pedido'].includes(req.body.kind) ? req.body.kind : 'albaran';
  if (!req.file) throw bad(kind === 'pedido' ? 'Sube una foto, un PDF o un Excel (máximo 20 MB)' : 'Sube un archivo PDF (máximo 20 MB)');
  if (kind !== 'pedido' && !/\.pdf$/i.test(req.file.filename)) {
    fs.unlink(path.join(DATA, 'uploads', req.file.filename), () => {});
    throw bad('El albarán y la factura tienen que ser PDF');
  }
  db.prepare('INSERT INTO documents(order_id,kind,filename,stored,size) VALUES (?,?,?,?,?)')
    .run(o.id, kind, clean(req.file.originalname, 200), req.file.filename, req.file.size);
  logStatus(o.id, (kind === 'factura' ? 'Factura' : kind === 'pedido' ? 'Pedido inicial' : 'Albarán') + ' subido', req.user);
  res.json(loadOrder(o.id));
});
app.get('/api/docs/:id', auth.requireUser, (req, res) => {
  const d = db.prepare('SELECT d.*,o.client_id FROM documents d JOIN orders o ON o.id=d.order_id WHERE d.id=?').get(req.params.id);
  if (!d || (req.user.role !== 'admin' && (req.user.client_id !== d.client_id || d.kind === 'pedido'))) throw bad('Documento no encontrado', 404);
  res.download(path.join(DATA, 'uploads', d.stored), d.filename);
});
app.delete('/api/docs/:id', auth.requireAdmin, (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
  if (d) {
    db.prepare('DELETE FROM documents WHERE id=?').run(d.id);
    fs.unlink(path.join(DATA, 'uploads', d.stored), () => {});
  }
  res.json({ ok: true });
});

/* ---------- fotos (productos y líneas libres) ---------- */
app.post('/api/photos', auth.requireUser, photoUpload.single('file'), (req, res) => {
  if (req.user.role === 'client') {
    const c = db.prepare('SELECT can_order FROM clients WHERE id=?').get(req.user.client_id);
    if (!c || !c.can_order) { if (req.file) fs.unlink(path.join(DATA, 'photos', req.file.filename), () => {}); throw bad('No permitido', 403); }
  }
  if (!req.file) throw bad('Sube una imagen PNG, JPG o WEBP (máximo 8 MB)');
  res.json({ photo: req.file.filename });
});

/* ---------- producción ---------- */
function productionData(q) {
  const where = [], params = [];
  const ids = String(q.orders || '').split(',').map(Number).filter(Boolean);
  if (ids.length) { where.push('id IN (' + ids.map(() => '?').join(',') + ')'); params.push(...ids); }
  else if (q.scope !== 'all') where.push("status<>'Entregado'");
  if (q.client) { where.push('client_id=?'); params.push(Number(q.client)); }
  const rows = db.prepare('SELECT id FROM orders' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id').all(...params);
  const orders = rows.map(r => loadOrder(r.id));
  const art = new Map(), fin = new Map();
  orders.forEach(o => o.lines.forEach(l => {
    const label = (l.kind === 'free' ? 'Línea libre: ' : '') + l.product_name + (l.color ? ' · ' + l.color : '');
    const key = label + '|' + (l.size || '');
    const a = art.get(key) || { article: label, size: l.size || '', qty: 0, orders: new Set() };
    a.qty += l.qty; a.orders.add(o.number); art.set(key, a);
    l.finishes.forEach(f => {
      const x = fin.get(f.name) || { finish: f.name, qty: 0, by_product: new Map(), values: [] };
      x.qty += l.qty;
      x.by_product.set(l.product_name, (x.by_product.get(l.product_name) || 0) + l.qty);
      if (f.value) x.values.push({ order_id: o.number, product: l.product_name, size: l.size, qty: l.qty, value: f.value });
      fin.set(f.name, x);
    });
  }));
  return {
    orders: orders.map(o => ({
      id: o.id, number: o.number, title: o.title, client_id: o.client_id, client_name: o.client_name, order_date: o.order_date, status: o.status,
      est_delivery: o.est_delivery, lines: o.lines
    })),
    articles: [...art.values()].map(a => ({ ...a, orders: [...a.orders] })).sort((a, b) => a.article.localeCompare(b.article) || a.size.localeCompare(b.size)),
    finishes: [...fin.values()].map(f => ({ ...f, by_product: [...f.by_product].map(([product, qty]) => ({ product, qty })) }))
      .sort((a, b) => b.qty - a.qty)
  };
}
app.get('/api/production', auth.requireAdmin, (req, res) => res.json(productionData(req.query)));
app.get('/api/production.csv', auth.requireAdmin, (req, res) => {
  const d = productionData(req.query);
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['RESUMEN POR ARTÍCULO'], ['Artículo', 'Talla', 'Unidades', 'Pedidos']];
  d.articles.forEach(a => rows.push([a.article, a.size, a.qty, a.orders.map(x => '#' + x).join(' ')]));
  rows.push([], ['RESUMEN POR ACABADO'], ['Acabado', 'Unidades', 'Detalle por producto']);
  d.finishes.forEach(f => rows.push([f.finish, f.qty, f.by_product.map(p => p.product + ' x' + p.qty).join(' | ')]));
  rows.push([], ['DETALLE DE ACABADOS CON DATO (dorsales, iniciales...)'], ['Acabado', 'Dato', 'Producto', 'Talla', 'Unidades', 'Pedido']);
  d.finishes.forEach(f => f.values.forEach(v => rows.push([f.finish, v.value, v.product, v.size, v.qty, '#' + v.order_id])));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="produccion.csv"');
  res.send('﻿' + rows.map(r => r.map(q).join(';')).join('\r\n'));
});

/* ---------- estadísticas e informes ---------- */
const CATS = ['Packs', 'Productos', 'Fuera de catálogo'];
function statsData(q) {
  const ids = String(q.clients || '').split(',').map(Number).filter(Boolean);
  const from = isDate(q.from) ? q.from : '', to = isDate(q.to) ? q.to : '';
  const where = [], params = [];
  if (ids.length) { where.push('client_id IN (' + ids.map(() => '?').join(',') + ')'); params.push(...ids); }
  if (from) { where.push('order_date>=?'); params.push(from); }
  if (to) { where.push('order_date<=?'); params.push(to); }
  if (q.status === 'active') where.push("status<>'Entregado'");
  if (q.status === 'delivered') where.push("status='Entregado'");
  const rows = db.prepare('SELECT id FROM orders' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY order_date,id').all(...params);
  const orders = rows.map(r => loadOrder(r.id));

  const zero = () => ({ qty: 0, amount: 0 });
  const add = (t, qty, amount) => { t.qty += qty; t.amount = r2(t.amount + amount); };
  const monthSet = new Set();
  const byMonthCat = new Map();     // 'YYYY-MM' -> { cat -> {qty,amount} }
  const byCat = new Map(CATS.map(c => [c, zero()]));
  const byClient = new Map();
  const byProduct = new Map();
  let units = 0, amount = 0, unpriced = 0;
  const clientsSeen = new Set();

  orders.forEach(o => {
    const m = o.order_date.slice(0, 7);
    monthSet.add(m);
    clientsSeen.add(o.client_id);
    unpriced += o.unpriced;
    const cl = byClient.get(o.client_id) || { id: o.client_id, name: o.client_name, orders: 0, qty: 0, amount: 0, months: {} };
    cl.orders++; byClient.set(o.client_id, cl);
    if (!byMonthCat.has(m)) byMonthCat.set(m, new Map(CATS.map(c => [c, zero()])));
    const mc = byMonthCat.get(m);
    const packSeen = new Set();
    o.lines.forEach(l => {
      const cat = l.kind === 'pack' ? 'Packs' : l.kind === 'free' ? 'Fuera de catálogo' : 'Productos';
      add(mc.get(cat), l.qty, l.amount); add(byCat.get(cat), l.qty, l.amount);
      units += l.qty; amount = r2(amount + l.amount);
      cl.qty += l.qty; cl.amount = r2(cl.amount + l.amount);
      const cm = cl.months[m] || (cl.months[m] = zero()); add(cm, l.qty, l.amount);
      // por producto (las prendas de un pack cuentan en unidades; el importe del pack va en su propia fila)
      const key = (l.kind === 'free' ? 'F|' : 'P|') + l.product_name;
      const pr = byProduct.get(key) || { name: l.product_name, free: l.kind === 'free', qty: 0, amount: 0, orders: new Set(), sizes: {} };
      pr.qty += l.qty;
      pr.amount = r2(pr.amount + (l.kind === 'pack' ? r2(l.qty * l.finishes.reduce((a, f) => a + (f.price || 0), 0)) : l.amount));
      pr.orders.add(o.id);
      const sz = l.size || 'Única';
      pr.sizes[sz] = (pr.sizes[sz] || 0) + l.qty;
      byProduct.set(key, pr);
      if (l.kind === 'pack' && !packSeen.has(l.group_no)) {
        packSeen.add(l.group_no);
        const pk = 'K|' + l.pack_name;
        const x = byProduct.get(pk) || { name: l.pack_name, pack: true, qty: 0, amount: 0, orders: new Set(), sizes: {} };
        x.qty += l.qty; x.amount = r2(x.amount + r2(l.qty * (l.pack_price || 0))); x.orders.add(o.id);
        byProduct.set(pk, x);
      }
    });
  });

  // meses consecutivos, sin huecos
  let months = [...monthSet].sort();
  if (months.length) {
    const out = []; let [y, mo] = months[0].split('-').map(Number); const [ey, em] = months[months.length - 1].split('-').map(Number);
    while (y < ey || (y === ey && mo <= em)) { out.push(y + '-' + String(mo).padStart(2, '0')); mo++; if (mo > 12) { mo = 1; y++; } }
    months = out;
  }
  const monthly = months.map(m => {
    const mc = byMonthCat.get(m);
    return { month: m, cats: CATS.map(c => ({ cat: c, ...(mc ? mc.get(c) : zero()) })) };
  });
  return {
    categories: CATS,
    kpis: { orders: orders.length, units, amount, clients: clientsSeen.size, avg_order: orders.length ? r2(amount / orders.length) : 0, unpriced },
    months, monthly,
    cats: CATS.map(c => ({ cat: c, ...byCat.get(c) })),
    clients: [...byClient.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)),
    products: [...byProduct.values()].map(p => ({ ...p, orders: p.orders.size })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)),
    filter: { clients: ids, from, to, status: q.status || 'all' }
  };
}
app.get('/api/stats', auth.requireAdmin, (req, res) => res.json(statsData(req.query)));

/* ---------- ajustes ---------- */
app.get('/api/settings', auth.requireAdmin, (req, res) => {
  res.json({
    brand_name: getSetting('brand_name', 'MSH Madrid'),
    public_url: getSetting('public_url'),
    notify_email: getSetting('notify_email'),
    smtp_host: getSetting('smtp_host'),
    smtp_port: getSetting('smtp_port', '587'),
    smtp_user: getSetting('smtp_user'),
    smtp_from: getSetting('smtp_from'),
    smtp_pass_set: !!getSetting('smtp_pass')
  });
});
app.put('/api/settings', auth.requireAdmin, (req, res) => {
  const b = req.body || {};
  ['brand_name', 'public_url', 'notify_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_from'].forEach(k => {
    if (b[k] != null) setSetting(k, clean(b[k], 200));
  });
  if (b.smtp_pass) setSetting('smtp_pass', String(b.smtp_pass));
  res.json({ ok: true });
});
app.post('/api/settings/test-email', auth.requireAdmin, wrap(async (req, res) => {
  const to = clean(req.body.to, 120);
  if (!to) throw bad('Escribe un correo de destino');
  const ok = await mail.send(to, 'Prueba de correo · MSH Pedidos', mail.layout('Funciona', '<p>Este es un correo de prueba de la app de pedidos.</p>'));
  const last = db.prepare('SELECT error FROM email_log ORDER BY id DESC LIMIT 1').get();
  res.json({ ok, error: ok ? null : (last && last.error) });
}));
app.get('/api/emails', auth.requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT at,to_addr,subject,ok,error FROM email_log ORDER BY id DESC LIMIT 40').all());
});

/* ---------- estáticos y errores ---------- */
app.static('/crests', path.join(DATA, 'crests'), { maxAge: 604800 });
app.static('/photos', path.join(DATA, 'photos'), { maxAge: 604800 });
app.static('/', path.join(__dirname, '..', 'public'));
app.get('/healthz', (req, res) => res.send('ok'));
app.onError((err, req, res) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno del servidor' });
});

app.listen(PORT, '0.0.0.0', () => console.log('MSH Pedidos escuchando en el puerto ' + PORT));
