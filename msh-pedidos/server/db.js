const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'crests'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'photos'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });

const DBFILE = path.join(DATA, 'msh.db');
const existed = fs.existsSync(DBFILE);
const db = new DatabaseSync(DBFILE);
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
  kind TEXT NOT NULL CHECK(kind IN ('albaran','factura','pedido')),
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
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assignee_name TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  done_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);
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


/* ---------- Migraciones (conservan todos los datos existentes) ---------- */
const SCHEMA_VERSION = 7;
const ver = db.prepare('PRAGMA user_version').get().user_version;
if (ver < SCHEMA_VERSION) {
  if (existed && ver < SCHEMA_VERSION) {
    // Copia de seguridad automática antes de tocar una base de datos de una versión anterior
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(DBFILE, path.join(DATA, 'backups', 'msh-antes-de-v' + SCHEMA_VERSION + '-' + stamp + '.db'));
    } catch (e) { console.error('No se pudo hacer la copia de seguridad previa:', e.message); }
  }
  const hasCol = (t, c) => db.prepare('PRAGMA table_info(' + t + ')').all().some(x => x.name === c);
  const addCol = (t, c, def) => { if (!hasCol(t, c)) db.exec('ALTER TABLE ' + t + ' ADD COLUMN ' + c + ' ' + def); };
  db.transaction(() => {
    // v3: precios (nulos = sin precio puesto)
    addCol('finishes', 'price', 'REAL');
    addCol('order_lines', 'unit_price', 'REAL');
    addCol('order_lines', 'pack_price', 'REAL');
    addCol('line_finishes', 'price', 'REAL');
    addCol('orders', 'number', 'INTEGER');
    db.exec('UPDATE orders SET number=id WHERE number IS NULL');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number ON orders(number)');
    addCol('orders', 'title', "TEXT NOT NULL DEFAULT ''");
    addCol('orders', 'client_view', "TEXT NOT NULL DEFAULT 'cronograma'");   // pedidos ya existentes: el cliente sigue viendo el cronograma
    addCol('order_lines', 'color', "TEXT NOT NULL DEFAULT ''");
    addCol('order_lines', 'photo', "TEXT NOT NULL DEFAULT ''");
    addCol('products', 'photo', "TEXT NOT NULL DEFAULT ''");
    addCol('clients', 'can_order', 'INTEGER NOT NULL DEFAULT 1');             // clientes ya existentes: siguen pudiendo pedir
    addCol('clients', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE clients SET sort_order=id WHERE sort_order=0');
    // documentos: permitir el tipo "pedido" (pedido inicial para cotejar)
    const docSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='documents'").get() || {}).sql || '';
    if (!docSql.includes("'pedido'")) {
      db.exec(`CREATE TABLE documents_new(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('albaran','factura','pedido')),
        filename TEXT NOT NULL, stored TEXT NOT NULL, size INTEGER,
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now')));
        INSERT INTO documents_new(id,order_id,kind,filename,stored,size,uploaded_at) SELECT id,order_id,kind,filename,stored,size,uploaded_at FROM documents;
        DROP TABLE documents;
        ALTER TABLE documents_new RENAME TO documents;`);
    }
    // v4: facturación, albaranes de entrega parciales, códigos FactuSOL
    ['factusol_code','tax_id','address','postal_code','city','province'].forEach(c => addCol('clients', c, "TEXT NOT NULL DEFAULT ''"));
    ['products','packs','finishes'].forEach(t => addCol(t, 'code', "TEXT NOT NULL DEFAULT ''"));
    addCol('orders', 'invoiced', 'INTEGER NOT NULL DEFAULT 0');
    addCol('orders', 'invoiced_at', 'TEXT');
    addCol('orders', 'invoice_ref', "TEXT NOT NULL DEFAULT ''");
    db.exec(`CREATE TABLE IF NOT EXISTS deliveries(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      year INTEGER NOT NULL, seq INTEGER NOT NULL,
      delivered_at TEXT NOT NULL,
      delivered_by TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, seq));
    CREATE INDEX IF NOT EXISTS idx_deliv_order ON deliveries(order_id);
    CREATE TABLE IF NOT EXISTS delivery_lines(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
      line_key TEXT NOT NULL,
      kind TEXT NOT NULL, pack_name TEXT, group_no INTEGER NOT NULL DEFAULT 0,
      product_name TEXT NOT NULL, size TEXT, color TEXT,
      detail TEXT NOT NULL DEFAULT '',
      qty INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_dl_deliv ON delivery_lines(delivery_id);
    CREATE TABLE IF NOT EXISTS invoices(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      doc_type INTEGER NOT NULL DEFAULT 1,
      number INTEGER NOT NULL,
      invoice_date TEXT NOT NULL,
      base REAL NOT NULL DEFAULT 0, iva REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT NOT NULL DEFAULT '',
      UNIQUE(doc_type, number));
    CREATE INDEX IF NOT EXISTS idx_inv_order ON invoices(order_id);`);
    // códigos de artículo automáticos para lo que ya existe en el catálogo
    [['finishes', 'ACB'], ['products', 'PRD'], ['packs', 'PCK']].forEach(([t, pre]) => {
      let n = (db.prepare("SELECT value FROM settings WHERE key=?").get('codeseq_' + pre) || {}).value; n = parseInt(n, 10) || 0;
      db.prepare("SELECT id FROM " + t + " WHERE code='' ORDER BY id").all().forEach(r => {
        n++; db.prepare('UPDATE ' + t + ' SET code=? WHERE id=?').run(pre + String(n).padStart(5, '0'), r.id);
      });
      db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('codeseq_' + pre, String(n));
    });
    // pedidos que ya tienen factura subida pasan a facturados
    db.exec(`UPDATE orders SET invoiced=1, invoiced_at=COALESCE(invoiced_at,(SELECT MIN(uploaded_at) FROM documents d WHERE d.order_id=orders.id AND d.kind='factura'))
             WHERE invoiced=0 AND EXISTS(SELECT 1 FROM documents d WHERE d.order_id=orders.id AND d.kind='factura')`);
    const seed = (k, v) => db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
    seed('company_name', 'MSH MADRID 24 SL'); seed('company_cif', 'B19334150');
    seed('company_address', 'AVENIDA VALDEARGANDA 4'); seed('company_city', 'ARGANDA DEL REY');
    seed('company_postal', ''); seed('company_phone', ''); seed('company_email', '');
    seed('invoice_next', '207'); seed('invoice_doc_type', '1'); seed('invoice_pay_code', '');
    // v5: comercial (clubes y empresas), contactos e historial
    db.exec(`CREATE TABLE IF NOT EXISTS prospects(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('club','empresa')),
      name TEXT NOT NULL,
      norm TEXT NOT NULL,
      zone TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      web TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'rojo' CHECK(status IN ('rojo','amarillo')),
      last_contact TEXT,
      converted_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      converted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(kind, norm));
    CREATE INDEX IF NOT EXISTS idx_prosp_kind ON prospects(kind, converted_client_id);
    CREATE TABLE IF NOT EXISTS prospect_contacts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      sort INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS prospect_log(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      via TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      by_user TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS idx_plog ON prospect_log(prospect_id);`);
    ['contact_name', 'phone', 'email'].forEach(c => addCol('clients', c, "TEXT NOT NULL DEFAULT ''"));
    // v6: firma digital del albarán de entrega
    ['signature', 'signed_at', 'signed_name', 'signed_id', 'signed_by_user'].forEach(c => addCol('deliveries', c, "TEXT NOT NULL DEFAULT ''"));
    // v7: numeración de pedidos estilo FactuSOL (serie-número, p. ej. 1-000206)
    addCol('orders', 'series', 'INTEGER NOT NULL DEFAULT 1');
    db.exec('DROP INDEX IF EXISTS idx_orders_number');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_series_number ON orders(series, number)');
  })();
  db.exec('PRAGMA user_version = ' + SCHEMA_VERSION);
}

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
