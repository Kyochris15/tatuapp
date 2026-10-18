const API = '/api';
let socket = null;
let currentChatWith = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { location.href = '/views/login.html'; return null; }
  return res.json();
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function setUserUI(user) {
  const el = document.getElementById('user-display');
  if (el) el.textContent = user.username + ' (' + user.role + ')';
  const navAdmin = document.getElementById('nav-admin');
  const navArtist = document.getElementById('nav-artist');
  const navClient = document.getElementById('nav-client');
  if (navAdmin) navAdmin.classList.toggle('hidden', user.role !== 'admin');
  if (navArtist) navArtist.classList.toggle('hidden', user.role !== 'tattooist');
  if (navClient) navClient.classList.toggle('hidden', user.role !== 'customer');
}

async function loadMe() {
  const u = await api('/me');
  if (!u) return;
  setUserUI(u);
  if (u.role === 'customer') { loadClient(); loadMyAppointments(); }
  if (u.role === 'tattooist') loadArtist();
  if (u.role === 'admin') loadAdmin();
  initSocket(u.id);
}

function initSocket(userId) {
  if (socket) return;
  socket = io();
  socket.emit('join', userId);
  socket.on('new-message', (data) => {
    if (currentChatWith === data.from || currentChatWith === data.sender_id) loadMessages(currentChatWith);
    else {
      const b = document.getElementById('chat-badge');
      if (b) { b.textContent = '!'; b.classList.remove('hidden'); }
    }
  });
  socket.on('new-appointment', (data) => {
    alert('Nueva cita reservada para el ' + data.date + ' a las ' + data.time);
    if (location.pathname.endsWith('artist.html')) loadArtist();
  });
}

async function login() {
  const u = document.getElementById('login-user').value;
  const p = document.getElementById('login-pass').value;
  const r = await api('/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
  if (r && r.ok) location.href = '/views/client.html';
  else alert(r.error || 'Error');
}

async function register() {
  const u = document.getElementById('reg-user').value;
  const e = document.getElementById('reg-email').value;
  const p = document.getElementById('reg-pass').value;
  const role = document.getElementById('reg-role').value;
  const r = await api('/register', { method: 'POST', body: JSON.stringify({ username: u, email: e, password: p, role }) });
  if (r && r.ok) { alert('Registro exitoso. Inicia sesión.'); location.href = '/views/login.html'; }
  else alert(r.error || 'Error');
}

async function logout() { await api('/logout', { method: 'POST' }); location.href = '/views/login.html'; }

async function loadClient() {
  const tattooists = await api('/tattooists');
  const sel = document.getElementById('client-tattooist');
  if (sel) sel.innerHTML = '<option value="">Selecciona un tatuador</option>' + tattooists.map(t => `<option value="${t.id}">${t.username}</option>`).join('');
}

async function loadSlots() {
  const tid = document.getElementById('client-tattooist').value;
  const date = document.getElementById('client-date').value;
  if (!tid || !date) return;
  const slots = await api(`/available?tattooist_id=${tid}&date=${date}`);
  const cont = document.getElementById('slots-container');
  cont.innerHTML = '';
  slots.forEach(s => {
    const b = document.createElement('button');
    b.className = 'slot';
    b.textContent = s;
    b.onclick = () => {
      document.querySelectorAll('.slot').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      document.getElementById('selected-slot').value = s;
    };
    cont.appendChild(b);
  });
}

async function reserve() {
  const tid = document.getElementById('client-tattooist').value;
  const date = document.getElementById('client-date').value;
  const time = document.getElementById('selected-slot').value;
  if (!time) return alert('Selecciona una hora');
  const design = window.pendingDesign || null;
  const r = await api('/appointments', {
    method: 'POST',
    body: JSON.stringify({ tattooist_id: tid, date, time, design_data: design })
  });
  if (r && r.ok) {
    alert('¡Cita reservada! Espera la confirmación del tatuador.');
    document.getElementById('reserve-section').classList.add('hidden');
    loadMyAppointments();
  }
}

async function loadMyAppointments() {
  const appts = await api('/appointments');
  const mine = appts.filter(a => a.status !== 'cancelled');
  const cont = document.getElementById('my-appts');
  if (!cont) return;
  cont.innerHTML = mine.map(a => `
    <tr>
      <td>${a.date}</td><td>${a.time}</td><td>${a.tattooist_name}</td>
      <td>${a.status}</td><td>$${a.price ? a.price.toFixed(0) : '—'}</td>
    </tr>
  `).join('');
}

async function loadArtist() {
  const me = (await api('/me')).id;
  const rows = await api('/schedule');
  const tbody = document.getElementById('artist-schedule');
  if (tbody) tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.day_of_week}</td><td>${r.start_time}</td><td>${r.end_time}</td>
      <td><button class="btn danger" onclick="deleteSchedule(${r.id})">Eliminar</button></td>
    </tr>
  `).join('');
  const appts = await api('/appointments');
  const mine = appts.filter(a => a.tattooist_id == me);
  const atbody = document.getElementById('artist-appts');
  if (atbody) atbody.innerHTML = mine.map(a => `
    <tr>
      <td>${a.date}</td><td>${a.time}</td><td>${a.client_name}</td>
      <td>${a.status}</td>
      <td><input type="number" placeholder="Precio" value="${a.price || ''}" onchange="setPrice(${a.id}, this.value)"></td>
      <td>
        <button class="btn" onclick="confirmAppt(${a.id})">Confirmar</button>
        <button class="btn outline" onclick="cancelAppt(${a.id})">Cancelar</button>
      </td>
    </tr>
  `).join('');
}

async function addSchedule() {
  const day = document.getElementById('sched-day').value;
  const st = document.getElementById('sched-start').value;
  const et = document.getElementById('sched-end').value;
  await api('/schedule', { method: 'POST', body: JSON.stringify({ day_of_week: day, start_time: st, end_time: et }) });
  loadArtist();
}
async function deleteSchedule(id) { await api('/schedule/' + id, { method: 'DELETE' }); loadArtist(); }
async function confirmAppt(id) { await api('/appointments/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) }); loadArtist(); }
async function cancelAppt(id) { await api('/appointments/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }); loadArtist(); }
async function setPrice(id, price) { await api('/appointments/' + id, { method: 'PATCH', body: JSON.stringify({ price }) }); }

async function loadAdmin() {
  const users = await api('/users/all');
  const tbody = document.getElementById('admin-users');
  if (!tbody) return;
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${u.username}</td><td>${u.email}</td><td>${u.role}</td>
      <td><select onchange="changeRole(${u.id}, this.value)">
        <option value="customer" ${u.role === 'customer' ? 'selected' : ''}>Cliente</option>
        <option value="tattooist" ${u.role === 'tattooist' ? 'selected' : ''}>Tatuador</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
      </select></td>
      <td><button class="btn danger" onclick="delUser(${u.id})">Eliminar</button></td>
    </tr>
  `).join('');
}
async function changeRole(id, role) { await api('/users/' + id + '/role', { method: 'PATCH', body: JSON.stringify({ role }) }); loadAdmin(); }
async function delUser(id) { if (!confirm('¿Eliminar usuario?')) return; await api('/users/' + id, { method: 'DELETE' }); loadAdmin(); }

async function loadProfile() {
  const me = await api('/me');
  if (!me) return;
  const u = document.getElementById('p-username');
  const e = document.getElementById('p-email');
  const r = document.getElementById('p-role');
  if (u) u.value = me.username;
  if (e) e.value = me.email;
  if (r) r.textContent = me.role.charAt(0).toUpperCase() + me.role.slice(1);
}
async function saveProfile() {
  const me = await api('/me');
  const id = me.id;
  const username = document.getElementById('p-username').value;
  const email = document.getElementById('p-email').value;
  const password = document.getElementById('p-password').value;
  const r = await api('/users/' + id + '/profile', {
    method: 'PATCH',
    body: JSON.stringify({ username, email, password: password || null })
  });
  if (r && r.ok) { alert('Perfil actualizado'); loadProfile(); }
  else alert(r.error || 'Error');
}

window.initWeekSelector = function () {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const toISO = d => d.toISOString().split('T')[0];
  const elStart = document.getElementById('av-start');
  const elEnd = document.getElementById('av-end');
  if (elStart) elStart.value = toISO(monday);
  if (elEnd) elEnd.value = toISO(sunday);
};

window.loadTattooistsForAvailability = async function () {
  const list = await api('/tattooists');
  const sel = document.getElementById('av-tattooist');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecciona tatuador</option>' + list.map(t => `<option value="${t.id}">${t.username}</option>`).join('');
};

window.loadAvailability = async function () {
  const tid = document.getElementById('av-tattooist').value;
  const start = document.getElementById('av-start').value;
  const end = document.getElementById('av-end').value;
  if (!tid || !start || !end) return;
  const data = await api(`/availability/week?tattooist_id=${tid}&start=${start}&end=${end}`);
  renderAvailabilityGrid(data, tid);
};

window.__tattooists = [];

function renderAvailabilityGrid(data, tattooistId) {
  const container = document.getElementById('av-grid');
  if (!container) return;
  container.innerHTML = '';
  const titleEl = document.getElementById('av-title');
  const tatuadorName = (window.__tattooists || []).find(t => t.id == tattooistId)?.username || 'Tatuador';
  if (titleEl) titleEl.textContent = `Disponibilidad de ${tatuadorName}`;

  const startDate = new Date(document.getElementById('av-start').value);
  const endDate = new Date(document.getElementById('av-end').value);
  const dates = [];
  let d = new Date(startDate);
  while (d <= endDate) {
    dates.push(new Date(d));
    d = new Date(d.setDate(d.getDate() + 1));
  }

  const bookedMap = {};
  (data.appointments || []).forEach(a => {
    const key = `${a.date}|${a.time}`;
    if (!bookedMap[key]) bookedMap[key] = [];
    bookedMap[key].push(a);
  });

  const schedulesByDay = {};
  (data.schedules || []).forEach(s => { schedulesByDay[s.day_of_week] = s; });

  const grid = document.createElement('div');
  grid.className = 'av-grid';

  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const headerRow = document.createElement('div');
  headerRow.className = 'av-day-headers';
  headerRow.appendChild(document.createElement('div'));
  dates.forEach(date => {
    const div = document.createElement('div');
    div.className = 'av-day-header';
    div.textContent = dayNames[date.getDay()] + ' ' + date.getDate();
    headerRow.appendChild(div);
  });
  grid.appendChild(headerRow);

  for (let h = 7; h <= 22; h++) {
    const row = document.createElement('div');
    row.className = 'av-hour-row';
    const hourLabel = document.createElement('div');
    hourLabel.className = 'av-hour-label';
    hourLabel.textContent = h.toString().padStart(2, '0') + ':00';
    row.appendChild(hourLabel);
    const timeStr = h.toString().padStart(2, '0') + ':00';
    dates.forEach(date => {
      const cell = document.createElement('div');
      cell.className = 'av-cell';
      const dayOfWeek = date.getDay();
      const sched = schedulesByDay[dayOfWeek];
      const dateStr = date.toISOString().split('T')[0];
      const key = `${dateStr}|${timeStr}`;
      const booked = bookedMap[key];
      if (!sched) {
        cell.classList.add('av-closed');
        cell.title = 'Fuera de horario';
      } else {
        const [sh, sm] = sched.start_time.split(':').map(Number);
        const [eh, em] = sched.end_time.split(':').map(Number);
        const curMin = h * 60;
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        if (curMin < startMin || curMin >= endMin) {
          cell.classList.add('av-closed');
          cell.title = 'Fuera de horario';
        } else if (booked && booked.length > 0) {
          cell.classList.add('av-booked');
          const hasConfirmed = booked.some(b => b.status === 'confirmed');
          cell.classList.add(hasConfirmed ? 'confirmed' : 'pending');
          cell.title = 'Ocupado:\n' + booked.map(b => b.client_name + ' (' + b.status + ')').join('\n');
          cell.onclick = () => alert('Horario ocupado por:\n' + booked.map(b => b.client_name).join(', '));
        } else {
          cell.classList.add('av-available');
          cell.title = 'Disponible: ' + dateStr + ' ' + timeStr;
          cell.onclick = async () => {
            const me = await api('/me');
            if (me && me.role === 'customer') {
              if (confirm('¿Reservar esta hora para ' + dateStr + ' a las ' + timeStr + '?')) {
                location.href = `/views/client.html?tid=${tattooistId}&date=${dateStr}&time=${timeStr}`;
              }
            } else {
              alert('Disponible: ' + dateStr + ' ' + timeStr);
            }
          };
        }
      }
      row.appendChild(cell);
    });
    grid.appendChild(row);
  }
  container.appendChild(grid);
}

async function openChat(userId, name) {
  currentChatWith = userId;
  const title = document.getElementById('chat-title');
  if (title) title.textContent = 'Chat con ' + name;
  const panel = document.getElementById('chat-panel');
  if (panel) panel.classList.remove('hidden');
  const badge = document.getElementById('chat-badge');
  if (badge) badge.classList.add('hidden');
  loadMessages(userId);
}
async function loadMessages(userId) {
  const msgs = await api(`/messages?with=${userId}`);
  const box = document.getElementById('chat-box');
  const me = await api('/me');
  box.innerHTML = msgs.map(m => `
    <div class="msg-row"><div class="msg ${m.sender_id == me.id ? 'me' : 'them'}">${m.message}</div></div>
  `).join('');
  box.scrollTop = box.scrollHeight;
}
async function sendMessage() {
  const input = document.getElementById('chat-input');
  if (!input.value.trim()) return;
  await api('/messages', { method: 'POST', body: JSON.stringify({ receiver_id: currentChatWith, message: input.value }) });
  input.value = '';
  loadMessages(currentChatWith);
}
async function loadChatUsers() {
  const users = await api('/users');
  const list = document.getElementById('chat-users');
  if (!list) return;
  list.innerHTML = users.map(u => `<li><span class="btn outline" style="padding:4px 8px;font-size:12px" onclick="openChat(${u.id}, '${u.username}')">${u.username}</span></li>`).join('');
}

function sendDesignToReservation(design) {
  window.pendingDesign = design;
  const sec = document.getElementById('reserve-section');
  if (sec) {
    sec.classList.remove('hidden');
    sec.scrollIntoView({ behavior: 'smooth' });
  }
  alert('Diseño listo. Ahora elige fecha y hora y haz clic en Reservar.');
}

document.addEventListener('DOMContentLoaded', async () => {
  const token = document.cookie.split('; ').find(r => r.startsWith('connect.sid='));
  const publicPages = ['/views/login.html', '/views/register.html'];
  const isPublic = publicPages.includes(location.pathname);
  if (!token && !isPublic) { location.href = '/views/login.html'; return; }
  if (token) await loadMe();

  if (location.pathname.endsWith('client.html')) {
    loadClient(); loadMyAppointments();
    const url = new URLSearchParams(location.search);
    const tid = url.get('tid');
    const date = url.get('date');
    const time = url.get('time');
    if (tid) {
      document.getElementById('client-tattooist').value = tid;
      loadSlots();
    }
    if (date) {
      document.getElementById('client-date').value = date;
      setTimeout(() => { if (time) document.getElementById('selected-slot').value = time; }, 150);
    }
  }
  if (location.pathname.endsWith('artist.html')) loadArtist();
  if (location.pathname.endsWith('admin.html')) loadAdmin();
  if (location.pathname.endsWith('profile.html')) loadProfile();
  if (location.pathname.endsWith('calendar.html')) initCalendar();
  if (location.pathname.endsWith('availability.html')) {
    loadTattooistsForAvailability();
    initWeekSelector();
    loadAvailability();
    const u = await api('/me');
    if (u && u.role === 'tattooist') {
      document.getElementById('av-tattooist').value = u.id;
    }
    document.getElementById('av-tattooist').onchange = loadAvailability;
    document.getElementById('av-start').onchange = loadAvailability;
    document.getElementById('av-end').onchange = loadAvailability;
  }
  if (document.getElementById('chat-users')) loadChatUsers();
});

let calendar = null;
window.initCalendar = function () {
  const el = document.getElementById('calendar');
  if (!el || calendar) return;
  calendar = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    locale: 'es',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' },
    events: '/api/appointments/calendar',
    eventClick: (info) => {
      const { status, price } = info.event.extendedProps;
      alert(`Cita #${info.event.id}\nEstado: ${status}\nPrecio: $${price ? price.toFixed(0) : '—'}`);
    },
    height: 'auto'
  });
  calendar.render();
};
window.refetchCalendar = function () { if (calendar) calendar.refetchEvents(); };

window.saveProfile = saveProfile;
window.loadProfile = loadProfile;
