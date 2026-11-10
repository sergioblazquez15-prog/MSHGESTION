// Mini servidor HTTP sin dependencias: rutas, JSON, subida de archivos y archivos estáticos.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};

const httpError = (msg, status) => Object.assign(new Error(msg), { status });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(httpError('El contenido enviado es demasiado grande', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decorate(res) {
  res.status = c => { res.statusCode = c; return res; };
  res.set = (k, v) => { res.setHeader(k, v); return res; };
  res.json = obj => {
    const body = Buffer.from(JSON.stringify(obj));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', body.length);
    res.end(body);
  };
  res.send = (text, type) => {
    const body = Buffer.from(String(text));
    res.setHeader('Content-Type', type || 'text/plain; charset=utf-8');
    res.setHeader('Content-Length', body.length);
    res.end(body);
  };
  res.download = (file, name) => {
    fs.stat(file, (err, st) => {
      if (err) return res.status(404).json({ error: 'Archivo no encontrado' });
      const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', st.size);
      res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
      fs.createReadStream(file).pipe(res);
    });
  };
}

function createApp() {
  const routes = [], globals = [], statics = [];
  let errorHandler = (e, req, res) => res.status(e.status || 500).json({ error: e.message });
  const app = {};

  const compile = p => {
    const keys = [];
    const src = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z_]+)/g, (m, k) => { keys.push(k); return '([^/]+)'; });
    return { re: new RegExp('^' + src + '$'), keys };
  };
  ['get', 'post', 'put', 'delete'].forEach(m => {
    app[m] = (p, ...h) => routes.push({ m: m.toUpperCase(), ...compile(p), h });
  });
  app.use = fn => globals.push(fn);
  app.static = (prefix, dir, opts = {}) => statics.push({ prefix, dir, maxAge: opts.maxAge || 0 });
  app.onError = fn => { errorHandler = fn; };

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    for (const s of statics) {
      if (!(pathname === s.prefix || pathname.startsWith(s.prefix === '/' ? '/' : s.prefix + '/'))) continue;
      let rel = pathname.slice(s.prefix.length).replace(/^\/+/, '');
      if (!rel) rel = 'index.html';
      let file;
      try { file = path.join(s.dir, decodeURIComponent(rel)); } catch (e) { continue; }
      if (!file.startsWith(path.resolve(s.dir))) continue;
      let st;
      try { st = fs.statSync(file); } catch (e) { continue; }
      if (!st.isFile()) continue;
      res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Content-Length', st.size);
      res.setHeader('Cache-Control', s.maxAge ? 'public, max-age=' + s.maxAge : 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'HEAD') { res.end(); return true; }
      fs.createReadStream(file).pipe(res);
      return true;
    }
    return false;
  }

  app.listen = (port, host, cb) => {
    const server = http.createServer(async (req, res) => {
      decorate(res);
      const fail = e => { try { errorHandler(e, req, res); } catch (x) { res.statusCode = 500; res.end(); } };
      try {
        const url = new URL(req.url, 'http://x');
        req.path = url.pathname;
        req.query = Object.fromEntries(url.searchParams);
        req.ip = req.socket.remoteAddress;
        req.body = {};
        req.params = {};
        let route = null;
        for (const r of routes) {
          if (r.m !== req.method) continue;
          const m = r.re.exec(req.path);
          if (m) { route = r; r.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); }); break; }
        }
        if (!route) {
          if (serveStatic(req, res, req.path)) return;
          if (req.path.startsWith('/api')) return res.status(404).json({ error: 'No encontrado' });
          return res.status(404).send('No encontrado');
        }
        if (/json/i.test(req.headers['content-type'] || '') && req.method !== 'GET') {
          const buf = await readBody(req, 2 * 1024 * 1024);
          if (buf.length) {
            try { req.body = JSON.parse(buf.toString('utf8')); } catch (e) { throw httpError('JSON no válido', 400); }
          }
        }
        const handlers = [...globals, ...route.h];
        let i = 0;
        const next = err => {
          if (err) return fail(err);
          const h = handlers[i++];
          if (!h) return;
          try {
            const r = h(req, res, next);
            if (r && typeof r.then === 'function') r.catch(fail);
          } catch (e) { fail(e); }
        };
        next();
      } catch (e) { fail(e); }
    });
    server.listen(port, host, cb);
    return server;
  };
  return app;
}

// Subida de un archivo (multipart/form-data). Guarda el archivo y deja req.file y los campos de texto en req.body
function uploader({ dir, accept, limit, ext }) {
  return {
    single(field) {
      return async (req, res, next) => {
        try {
          const ct = req.headers['content-type'] || '';
          const mb = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
          if (!/multipart\/form-data/i.test(ct) || !mb) throw httpError('Formato de subida no válido', 400);
          const boundary = mb[1] || mb[2];
          const buf = await readBody(req, limit + 1024 * 1024);
          const delim = Buffer.from('--' + boundary);
          const body = {};
          let pos = buf.indexOf(delim);
          while (pos !== -1) {
            let start = pos + delim.length;
            if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
            if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
            const next = buf.indexOf(delim, start);
            if (next === -1) break;
            const part = buf.slice(start, next - 2);
            const he = part.indexOf('\r\n\r\n');
            if (he !== -1) {
              const head = part.slice(0, he).toString('utf8');
              const data = part.slice(he + 4);
              const name = (/name="([^"]*)"/i.exec(head) || [])[1];
              const fm = /filename="([^"]*)"/i.exec(head);
              if (fm) {
                if (name === field && data.length) {
                  if (data.length > limit) throw httpError('El archivo es demasiado grande', 400);
                  if (accept.test(fm[1])) {
                    const stored = crypto.randomBytes(14).toString('hex') + ext(fm[1]);
                    fs.writeFileSync(path.join(dir, stored), data);
                    req.file = { filename: stored, originalname: fm[1], size: data.length };
                  }
                }
              } else if (name) body[name] = data.toString('utf8');
            }
            pos = next;
          }
          req.body = body;
          next();
        } catch (e) { next(e); }
      };
    }
  };
}

module.exports = { createApp, uploader, httpError };
