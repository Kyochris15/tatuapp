const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = new Database('./db/tatuapp.sqlite');
db.pragma('journal_mode = WAL');

app.use(express.json());
app.use(session({
  secret: 'tatuapp_secret_cambiar_en_produccion',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

fs.mkdirSync('./uploads', { recursive: true });
fs.mkdirSync('./db', { recursive: true });

const fsSql = fs.readFileSync(path.join(__dirname, 'init-db.sql'), 'utf8');
db.exec(fsSql);

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
  next();
};
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'No autorizado' });
  next();
};

app.post('/api/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Faltan datos' });
  if (!['customer', 'tattooist'].includes(role)) role = 'customer';
  const hash = await bcrypt.hash(password, 10);
  try {
    db.prepare('INSERT INTO users (username, email, password, role) VALUES (?,?,?,?)').run(username, email, hash, role);
    res.json({ ok: true, role });
  } catch (e) {
    res.status(400).json({ error: 'Usuario o correo ya existe' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Credenciales inválidas' });
  req.session.user = { id: user.id, username: user.username, role: user.role, email: user.email };
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json(req.session.user || null);
});

app.get('/api/tattooists', requireAuth, (req, res) => {
  const rows = db.prepare("SELECT id, username FROM users WHERE role = 'tattooist'").all();
  res.json(rows);
});

app.get('/api/schedule', requireAuth, requireRole('tattooist', 'admin'), (req, res) => {
  const id = req.session.user.role === 'admin' ? (req.query.tattooist_id || req.session.user.id) : req.session.user.id;
  const rows = db.prepare('SELECT * FROM schedules WHERE tattooist_id = ? ORDER BY day_of_week').all(id);
  res.json(rows);
});

app.post('/api/schedule', requireAuth, requireRole('tattooist', 'admin'), (req, res) => {
  const id = req.session.user.role === 'admin' ? req.body.tattooist_id : req.session.user.id;
  const { day_of_week, start_time, end_time } = req.body;
  db.prepare('INSERT INTO schedules (tattooist_id, day_of_week, start_time, end_time) VALUES (?,?,?,?)').run(id, day_of_week, start_time, end_time);
  res.json({ ok: true });
});

app.delete('/api/schedule/:id', requireAuth, requireRole('tattooist', 'admin'), (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/available', requireAuth, (req, res) => {
  const { tattooist_id, date } = req.query;
  if (!tattooist_id || !date) return res.status(400).json({ error: 'Faltan parámetros' });
  const day = new Date(date).getDay();
  const base = db.prepare('SELECT * FROM schedules WHERE tattooist_id = ? AND day_of_week = ? AND is_active = 1').get(tattooist_id, day);
  if (!base) return res.json([]);
  const ocupadas = db.prepare("SELECT time FROM appointments WHERE tattooist_id = ? AND date = ? AND status != 'cancelled'").all(tattooist_id, date);
  const ocupadasSet = new Set(ocupadas.map(o => o.time));
  const slots = [];
  let [sh, sm] = base.start_time.split(':').map(Number);
  let [eh, em] = base.end_time.split(':').map(Number);
  let cur = sh * 60 + sm;
  const end = eh * 60 + em;
  while (cur + 60 <= end) {
    const h = Math.floor(cur / 60).toString().padStart(2, '0');
    const m = (cur % 60).toString().padStart(2, '0');
    const t = `${h}:${m}`;
    if (!ocupadasSet.has(t)) slots.push(t);
    cur += 60;
  }
  res.json(slots);
});

app.get('/api/availability/week', requireAuth, (req, res) => {
  const { tattooist_id, start, end } = req.query;
  if (!tattooist_id || !start || !end) return res.status(400).json({ error: 'Faltan parámetros' });
  const schedules = db.prepare('SELECT * FROM schedules WHERE tattooist_id = ? AND is_active = 1').all(tattooist_id);
  const appointments = db.prepare(
    `SELECT a.*, u.username as client_name FROM appointments a JOIN users u ON a.client_id = u.id WHERE a.tattooist_id = ? AND a.date BETWEEN ? AND ? AND a.status != 'cancelled' ORDER BY a.date, a.time`
  ).all(tattooist_id, start, end);
  res.json({ schedules, appointments });
});

app.get('/api/appointments', requireAuth, (req, res) => {
  const user = req.session.user;
  let sql, params;
  if (user.role === 'customer') {
    sql = 'SELECT a.*, u.username as tattooist_name FROM appointments a JOIN users u ON a.tattooist_id = u.id WHERE a.client_id = ? ORDER BY a.date, a.time';
    params = [user.id];
  } else if (user.role === 'tattooist') {
    sql = 'SELECT a.*, u.username as client_name FROM appointments a JOIN users u ON a.client_id = u.id WHERE a.tattooist_id = ? ORDER BY a.date, a.time';
    params = [user.id];
  } else {
    sql = 'SELECT a.*, c.username as client_name, t.username as tattooist_name FROM appointments a JOIN users c ON a.client_id = c.id JOIN users t ON a.tattooist_id = t.id ORDER BY a.date, a.time';
    params = [];
  }
  res.json(db.prepare(sql).all(params));
});

app.post('/api/appointments', requireAuth, requireRole('customer'), (req, res) => {
  const client_id = req.session.user.id;
  const { tattooist_id, date, time, design_data } = req.body;
  if (!tattooist_id || !date || !time) return res.status(400).json({ error: 'Faltan datos' });
  const ya = db.prepare("SELECT id FROM appointments WHERE tattooist_id = ? AND date = ? AND time = ? AND status != 'cancelled'").get(tattooist_id, date, time);
  if (ya) return res.status(409).json({ error: 'Esa hora ya fue reservada' });
  const stmt = db.prepare('INSERT INTO appointments (client_id, tattooist_id, date, time, design_data, status) VALUES (?,?,?,?,?,\'pending\')');
  const info = stmt.run(client_id, tattooist_id, date, time, design_data ? JSON.stringify(design_data) : null);
  io.to(tattooist_id.toString()).emit('new-appointment', { appointmentId: info.lastInsertRowid, client_id, date, time });
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/appointments/:id', requireAuth, requireRole('tattooist', 'admin'), (req, res) => {
  const { status, price } = req.body;
  db.prepare('UPDATE appointments SET status = COALESCE(?, status), price = COALESCE(?, price) WHERE id = ?').run(status, price, req.params.id);
  res.json({ ok: true });
});

app.get('/api/appointments/calendar', requireAuth, (req, res) => {
  const user = req.session.user;
  let sql, params;
  if (user.role === 'customer') {
    sql = `SELECT a.id, a.date || 'T' || a.time || ':00' as start, a.date || 'T' || a.time || ':00' as end, a.status, a.price, u.username as title FROM appointments a JOIN users u ON a.tattooist_id = u.id WHERE a.client_id = ? AND a.status != 'cancelled'`;
    params = [user.id];
  } else if (user.role === 'tattooist') {
    sql = `SELECT a.id, a.date || 'T' || a.time || ':00' as start, a.date || 'T' || a.time || ':00' as end, a.status, a.price, u.username as title FROM appointments a JOIN users u ON a.client_id = u.id WHERE a.tattooist_id = ? AND a.status != 'cancelled'`;
    params = [user.id];
  } else {
    sql = `SELECT a.id, a.date || 'T' || a.time || ':00' as start, a.date || 'T' || a.time || ':00' as end, a.status, a.price, c.username || ' ↔ ' || t.username as title FROM appointments a JOIN users c ON a.client_id = c.id JOIN users t ON a.tattooist_id = t.id WHERE a.status != 'cancelled'`;
    params = [];
  }
  const rows = db.prepare(sql).all(params);
  const colorMap = { pending: '#ffb300', confirmed: '#0f0', cancelled: '#d33' };
  res.json(rows.map(r => ({
    id: r.id,
    title: r.title,
    start: r.start,
    end: r.end,
    backgroundColor: colorMap[r.status] || '#666',
    borderColor: colorMap[r.status] || '#666',
    extendedProps: { status: r.status, price: r.price }
  })));
});

app.get('/api/messages', requireAuth, (req, res) => {
  const { with: withUserId } = req.query;
  const me = req.session.user.id;
  if (!withUserId) return res.status(400).json({ error: 'Falta with' });
  const rows = db.prepare(`SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at ASC`).all(me, withUserId, withUserId, me);
  db.prepare('UPDATE messages SET read = 1 WHERE receiver_id = ? AND sender_id = ?').run(me, withUserId);
  res.json(rows);
});

app.post('/api/messages', requireAuth, (req, res) => {
  const { receiver_id, message } = req.body;
  const sender_id = req.session.user.id;
  if (!receiver_id || !message) return res.status(400).json({ error: 'Faltan datos' });
  db.prepare('INSERT INTO messages (sender_id, receiver_id, message) VALUES (?,?,?)').run(sender_id, receiver_id, message);
  io.to(receiver_id.toString()).emit('new-message', { from: sender_id, message, created_at: new Date() });
  io.to(sender_id.toString()).emit('new-message', { from: sender_id, message, created_at: new Date(), echo: true });
  res.json({ ok: true });
});

app.get('/api/users', requireAuth, requireRole('admin', 'tattooist'), (req, res) => {
  const me = req.session.user.id;
  let sql = 'SELECT id, username, role FROM users WHERE id != ?';
  if (req.session.user.role === 'tattooist') sql += " AND role IN ('admin','customer')";
  res.json(db.prepare(sql).all(me));
});

app.get('/api/users/all', requireAuth, requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT id, username, email, role, created_at FROM users ORDER BY role, username').all());
});

app.patch('/api/users/:id/role', requireAuth, requireRole('admin'), (req, res) => {
  const { role } = req.body;
  if (!['admin', 'tattooist', 'customer'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/users/:id/profile', requireAuth, async (req, res) => {
  const me = req.session.user;
  const targetId = parseInt(req.params.id);
  if (me.role !== 'admin' && me.id !== targetId) return res.status(403).json({ error: 'No puedes editar este perfil' });
  const { username, email, password } = req.body;
  const updates = [];
  const values = [];
  if (username) { updates.push('username = ?'); values.push(username); }
  if (email) { updates.push('email = ?'); values.push(email); }
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    updates.push('password = ?'); values.push(hash);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  values.push(targetId);
  try {
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Usuario o correo ya existe' });
  }
});

io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.userId = userId;
    socket.join(userId.toString());
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`\n🚀 TatuApp corriendo en http://localhost:${PORT}\n`));
