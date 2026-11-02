// Envío de correo por SMTP sin dependencias (STARTTLS en 587, TLS directo en 465).
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');
const { db, getSetting } = require('./db');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function smtpConfig() {
  return {
    host: getSetting('smtp_host'),
    port: parseInt(getSetting('smtp_port', '587'), 10) || 587,
    user: getSetting('smtp_user'),
    pass: getSetting('smtp_pass'),
    from: getSetting('smtp_from') || getSetting('smtp_user')
  };
}

function log(to, subject, ok, error) {
  try {
    db.prepare('INSERT INTO email_log(to_addr,subject,ok,error) VALUES (?,?,?,?)').run(to, subject, ok ? 1 : 0, error || null);
  } catch (e) { /* el registro nunca debe romper nada */ }
}

class Conn {
  constructor(socket) {
    this.s = socket; this.buf = ''; this.waiters = []; this.err = null;
    socket.setEncoding('utf8');
    socket.on('data', d => { this.buf += d; this.flush(); });
    socket.on('error', e => { this.err = e; this.flush(); });
    socket.on('close', () => { this.err = this.err || new Error('Conexión cerrada por el servidor'); this.flush(); });
  }
  flush() {
    while (this.waiters.length) {
      const w = this.waiters[0];
      const lines = this.buf.split('\r\n');
      let end = -1;
      for (let i = 0; i < lines.length - 1; i++) { if (/^\d{3} /.test(lines[i])) { end = i; break; } }
      if (end >= 0) {
        const taken = lines.slice(0, end + 1);
        this.buf = lines.slice(end + 1).join('\r\n');
        this.waiters.shift();
        w.resolve({ code: parseInt(taken[end].slice(0, 3), 10), text: taken.join('\n') });
      } else if (this.err) { this.waiters.shift(); w.reject(this.err); }
      else break;
    }
  }
  read() { return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); this.flush(); }); }
  async cmd(line, expect) {
    this.s.write(line + '\r\n');
    const r = await this.read();
    if (expect && !expect.includes(r.code)) throw new Error('SMTP: ' + r.text.replace(/\n/g, ' ').slice(0, 200));
    return r;
  }
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = s => s.replace(/(.{76})/g, '$1\r\n');
const addr = s => { const m = /<([^>]+)>/.exec(s); return (m ? m[1] : s).trim(); };

function buildMessage({ from, to, subject, html }) {
  return [
    'From: ' + from, 'To: ' + to,
    'Subject: =?UTF-8?B?' + b64(subject) + '?=',
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@' + (os.hostname() || 'msh') + '>',
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    wrap76(b64(html))
  ].join('\r\n');
}

async function smtpSend(c, msg) {
  const secure = c.port === 465;
  const socket = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Tiempo de espera agotado al conectar con ' + c.host)), 20000);
    const s = secure ? tls.connect({ host: c.host, port: c.port, servername: c.host }) : net.connect({ host: c.host, port: c.port });
    s.once(secure ? 'secureConnect' : 'connect', () => { clearTimeout(t); resolve(s); });
    s.once('error', e => { clearTimeout(t); reject(e); });
  });
  let conn = new Conn(socket);
  const guard = setTimeout(() => socket.destroy(new Error('Tiempo de espera agotado')), 45000);
  try {
    let r = await conn.read();
    if (r.code !== 220) throw new Error('SMTP: ' + r.text);
    const name = os.hostname() || 'localhost';
    r = await conn.cmd('EHLO ' + name, [250]);
    if (!secure && /STARTTLS/i.test(r.text)) {
      await conn.cmd('STARTTLS', [220]);
      const t2 = tls.connect({ socket, host: c.host, servername: c.host });
      await new Promise((res2, rej2) => { t2.once('secureConnect', res2); t2.once('error', rej2); });
      conn = new Conn(t2);
      r = await conn.cmd('EHLO ' + name, [250]);
    }
    if (c.user) {
      if (/AUTH[^\n]*PLAIN/i.test(r.text)) await conn.cmd('AUTH PLAIN ' + Buffer.from('\0' + c.user + '\0' + c.pass).toString('base64'), [235]);
      else {
        await conn.cmd('AUTH LOGIN', [334]);
        await conn.cmd(b64(c.user), [334]);
        await conn.cmd(b64(c.pass), [235]);
      }
    }
    await conn.cmd('MAIL FROM:<' + addr(msg.from) + '>', [250]);
    await conn.cmd('RCPT TO:<' + addr(msg.to) + '>', [250, 251]);
    await conn.cmd('DATA', [354]);
    conn.s.write(buildMessage(msg) + '\r\n.\r\n');
    r = await conn.read();
    if (r.code !== 250) throw new Error('SMTP: ' + r.text);
    try { conn.s.write('QUIT\r\n'); } catch (e) { /* da igual */ }
  } finally {
    clearTimeout(guard);
    try { conn.s.end(); } catch (e) { /* da igual */ }
  }
}

async function send(to, subject, html) {
  if (!to) return false;
  const c = smtpConfig();
  if (!c.host) { log(to, subject, false, 'Correo no configurado (Ajustes > Correo)'); return false; }
  try {
    await smtpSend(c, { from: c.from || c.user, to, subject, html });
    log(to, subject, true);
    return true;
  } catch (e) {
    log(to, subject, false, String(e.message || e).slice(0, 300));
    return false;
  }
}

function layout(title, bodyHtml, linkUrl) {
  const brand = getSetting('brand_name', 'MSH Madrid');
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#0a0a0a;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#121212;border:1px solid #2a2a2a;border-radius:16px;padding:28px;color:#ffffff">
    <div style="color:#d4af37;font-size:13px;margin-bottom:10px">${esc(brand)}</div>
    <h2 style="font-weight:400;font-size:22px;margin:0 0 14px">${esc(title)}</h2>
    <div style="font-size:15px;line-height:1.5;color:#d8d8d8">${bodyHtml}</div>
    ${linkUrl ? `<p style="margin-top:22px"><a href="${esc(linkUrl)}" style="background:#d4af37;color:#0a0a0a;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:bold;font-size:14px">Ver mi pedido</a></p>` : ''}
  </div></div>`;
}

async function notifyClient(clientId, subject, title, bodyHtml) {
  const users = db.prepare("SELECT email FROM users WHERE client_id=? AND role='client' AND active=1").all(clientId);
  const url = getSetting('public_url');
  for (const u of users) await send(u.email, subject, layout(title, bodyHtml, url || null));
}
async function notifyAdmin(subject, title, bodyHtml) {
  const to = getSetting('notify_email');
  if (to) await send(to, subject, layout(title, bodyHtml, getSetting('public_url') || null));
}

module.exports = { send, layout, notifyClient, notifyAdmin, esc };
