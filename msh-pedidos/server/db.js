const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'crests'), { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'msh.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// Transacciones: db.transaction(fn) devuelve una función que ejecuta fn dentro de BEGIN/COMMIT
db.transaction = fn => (...args) => {
  db.exec('BEGIN');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* ya cerrada */ } throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS clients(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#d4af37',
  crest TEXT,
  allow_packs INTEGER NOT NULL DEFAULT 1,
  allow_products INTEGER NOT NULL DEFAULT 0,
  allow_free INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  pass TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','client')),
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS finishes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  asks_value INTEGER NOT NULL DEFAULT 0,
  value_label TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(client_id, name)
);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sizes TEXT NOT NULL DEFAULT '',
  price REAL,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(client_id, name)
);
CREATE TABLE IF NOT EXISTS product_finishes(
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  finish_id INTEGER NOT NULL REFERENCES finishes(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('fixed','optional')),
  PRIMARY KEY(product_id, finish_id)
);
CREATE TABLE IF NOT EXISTS packs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(client_id, name)
);
CREATE TABLE IF NOT EXISTS pack_items(
  pack_id INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  origin TEXT NOT NULL CHECK(origin IN ('cliente','admin')),
  created_by INTEGER REFERENCES users(id),
  order_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'Recibido',
  cur INTEGER NOT NULL DEFAULT 0,
  channel TEXT,
  notes TEXT,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_lines(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK(kind IN ('pack','product','free')),
  group_no INTEGER NOT NULL DEFAULT 0,
  pack_name TEXT,
  product_name TEXT NOT NULL,
  size TEXT,
  qty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);
CREATE TABLE IF NOT EXISTS line_finishes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT,
  fixed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_phases(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL,
  name TEXT NOT NULL,
  min_days INTEGER NOT NULL DEFAULT 0,
  max_days INTEGER NOT NULL DEFAULT 0,
  descr TEXT,
  color TEXT NOT NULL DEFAULT '#d4af37',
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS phase_template(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sort INTEGER NOT NULL,
  name TEXT NOT NULL,
  min_days INTEGER NOT NULL DEFAULT 0,
  max_days INTEGER NOT NULL DEFAULT 0,
  descr TEXT,
  color TEXT NOT NULL DEFAULT '#d4af37'
);
CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('albaran','factura')),
  filename TEXT NOT NULL,
  stored TEXT NOT NULL,
  size INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS status_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  what TEXT NOT NULL,
  by_user TEXT
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS email_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  to_addr TEXT,
  subject TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
`);

// Plantilla de fases por defecto (editable desde "Plazos y fases"). No es ni cliente ni artículo.
if (db.prepare('SELECT COUNT(*) AS n FROM phase_template').get().n === 0) {
  const ins = db.prepare('INSERT INTO phase_template(sort,name,min_days,max_days,descr,color) VALUES (?,?,?,?,?,?)');
  [
    ['Pedido', 1, 5, 'Ejecución de pedido una vez realizado por el cliente', '#d4af37'],
    ['Tramitación', 4, 6, 'Tramitación y envío del pedido desde central', '#ffffff'],
    ['Destino', 10, 12, 'Recepción del pedido en destino', '#b8902a'],
    ['Acabado', 3, 5, 'Acabado y empaquetado para entrega personalizada', '#ecd9a0'],
    ['Entrega', 1, 2, 'Entrega al cliente', '#b5b5b5']
  ].forEach((p, i) => ins.run(i, ...p));
}

const getSetting = (k, d = '') => {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
  return r && r.value != null ? r.value : d;
};
const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v == null ? '' : String(v));

module.exports = { db, DATA, getSetting, setSetting };
