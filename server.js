import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { JSONFilePreset } from 'lowdb/node';
import { Server } from 'socket.io';
import http from 'http';
import { nanoid } from 'nanoid';

const SECRET = 'nura-secret-key';
const PORT = 5000;
const app = express();
app.use(cors());
app.use(express.json());

// ============ DATABASE (ملف JSON = بسيط جداً) ============
const db = await JSONFilePreset('db.json', {
  users: [],
  medicines: [],
  reports: [],
  connections: [],
  devices: []
});

// ============ AUTH MIDDLEWARE ============
const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    req.user = db.data.users.find(u => u.id === jwt.verify(token, SECRET).id);
    if (!req.user) throw new Error();
    next();
  } catch {
    res.status(401).json({ message: 'غير مصرح' });
  }
};

// ============ AUTH ROUTES ============
app.post('/api/auth/register', async (req, res) => {
  const { fullname, username, password, age, role } = req.body;
  if (db.data.users.find(u => u.username === username))
    return res.status(409).json({ message: 'اسم المستخدم موجود' });
  
  const user = {
    id: nanoid(),
    fullname, username, age, role: role || 'patient',
    password: await bcrypt.hash(password, 10),
    notifications: [],
    createdAt: new Date()
  };
  db.data.users.push(user);
  await db.write();
  
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = user;
  res.json({ token, user: safe });
});

app.post('/api/auth/login', async (req, res) => {
  const user = db.data.users.find(u => u.username === req.body.username);
  if (!user || !(await bcrypt.compare(req.body.password, user.password)))
    return res.status(401).json({ message: 'بيانات غلط' });
  
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = user;
  res.json({ token, user: safe });
});

app.get('/api/auth/me', auth, (req, res) => {
  const { password: _, ...safe } = req.user;
  res.json({ user: safe });
});

app.put('/api/auth/password', auth, async (req, res) => {
  req.user.password = await bcrypt.hash(req.body.newPassword, 10);
  await db.write();
  res.json({ ok: true });
});

// ============ MEDICINES ============
app.get('/api/medicines', auth, (req, res) => {
  const patientId = req.query.patientId || req.user.id;
  res.json(db.data.medicines.filter(m => m.patientId === patientId));
});

app.post('/api/medicines', auth, async (req, res) => {
  const patientId = req.body.patientId || req.user.id;
  const { box, name, time, pills, repeat } = req.body;
  
  let med = db.data.medicines.find(m => m.patientId === patientId && m.box === box);
  if (med) {
    Object.assign(med, { name, time, pills, repeat, taken: false });
  } else {
    med = { id: nanoid(), patientId, box, name, time, pills, repeat, taken: false };
    db.data.medicines.push(med);
  }
  await db.write();
  
  // بث للمتصفحات المفتوحة
  io.to(`patient:${patientId}`).emit('medicine:updated', med);
  res.json(med);
});

app.post('/api/medicines/:box/taken', auth, async (req, res) => {
  const med = db.data.medicines.find(m => m.patientId === req.user.id && m.box === +req.params.box);
  if (!med) return res.status(404).json({ message: 'غير موجود' });
  med.taken = true;
  med.takenAt = new Date();
  await db.write();
  io.to(`patient:${req.user.id}`).emit('medicine:taken', med);
  res.json(med);
});

app.delete('/api/medicines/:box', auth, async (req, res) => {
  db.data.medicines = db.data.medicines.filter(
    m => !(m.patientId === req.user.id && m.box === +req.params.box)
  );
  await db.write();
  res.json({ ok: true });
});

// ============ REPORTS ============
app.post('/api/reports', auth, async (req, res) => {
  const report = {
    id: nanoid(),
    patientId: req.user.id,
    patientName: req.user.fullname,
    ...req.body,
    reviewed: false,
    createdAt: new Date()
  };
  db.data.reports.push(report);
  await db.write();
  
  // إشعار للأطباء المرتبطين
  const doctors = db.data.connections
    .filter(c => c.patientId === req.user.id && c.status === 'accepted')
    .map(c => c.doctorId);
  
  for (const docId of doctors) {
    io.to(`user:${docId}`).emit('notification', { text: `${req.user.fullname} أرسل تقريراً` });
  }
  res.json(report);
});

app.get('/api/reports/me', auth, (req, res) => {
  res.json(db.data.reports.filter(r => r.patientId === req.user.id).reverse());
});

app.get('/api/reports/doctor', auth, (req, res) => {
  const myPatients = db.data.connections
    .filter(c => c.doctorId === req.user.id && c.status === 'accepted')
    .map(c => c.patientId);
  res.json(db.data.reports.filter(r => myPatients.includes(r.patientId)).reverse());
});

app.post('/api/reports/:id/note', auth, async (req, res) => {
  const report = db.data.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ message: 'غير موجود' });
  report.doctorNote = req.body.note;
  report.reviewed = true;
  await db.write();
  
  io.to(`user:${report.patientId}`).emit('notification', {
    text: `د. ${req.user.fullname} رد على تقريرك`
  });
  res.json(report);
});

// ============ NETWORK (Doctor <-> Patient) ============
app.post('/api/network/request', auth, async (req, res) => {
  const patient = db.data.users.find(u => u.username === req.body.username && u.role === 'patient');
  if (!patient) return res.status(404).json({ message: 'المريض غير موجود' });
  
  if (db.data.connections.find(c => c.doctorId === req.user.id && c.patientId === patient.id))
    return res.status(409).json({ message: 'الطلب موجود' });
  
  const conn = { id: nanoid(), doctorId: req.user.id, patientId: patient.id, status: 'pending' };
  db.data.connections.push(conn);
  await db.write();
  
  io.to(`user:${patient.id}`).emit('notification', { text: `د. ${req.user.fullname} يريد متابعتك` });
  res.json(conn);
});

app.get('/api/network/my-doctors', auth, (req, res) => {
  const links = db.data.connections.filter(c => c.patientId === req.user.id && c.status === 'accepted');
  res.json(links.map(l => ({
    ...l,
    doctor: db.data.users.find(u => u.id === l.doctorId)
  })));
});

app.get('/api/network/my-patients', auth, (req, res) => {
  const links = db.data.connections.filter(c => c.doctorId === req.user.id && c.status === 'accepted');
  res.json(links.map(l => ({
    ...l,
    patient: db.data.users.find(u => u.id === l.patientId)
  })));
});

app.get('/api/network/requests', auth, (req, res) => {
  const links = db.data.connections.filter(c => c.patientId === req.user.id && c.status === 'pending');
  res.json(links.map(l => ({
    ...l,
    doctor: db.data.users.find(u => u.id === l.doctorId)
  })));
});

app.put('/api/network/requests/:id', auth, async (req, res) => {
  const conn = db.data.connections.find(c => c.id === req.params.id && c.patientId === req.user.id);
  if (!conn) return res.status(404).json({ message: 'غير موجود' });
  conn.status = req.body.action === 'accept' ? 'accepted' : 'rejected';
  await db.write();
  res.json(conn);
});

app.delete('/api/network/link/:id', auth, async (req, res) => {
  db.data.connections = db.data.connections.filter(c => c.id !== req.params.id);
  await db.write();
  res.json({ ok: true });
});

// ============ ESP32 DEVICE ============
app.post('/api/device/register', async (req, res) => {
  const patient = db.data.users.find(u => u.username === req.body.patientUsername && u.role === 'patient');
  if (!patient) return res.status(404).json({ message: 'المريض غير موجود' });
  
  let dev = db.data.devices.find(d => d.deviceId === req.body.deviceId);
  if (dev) Object.assign(dev, { patientId: patient.id, online: true, lastSeen: new Date() });
  else db.data.devices.push({ id: nanoid(), deviceId: req.body.deviceId, patientId: patient.id, online: true, battery: 100, lastSeen: new Date() });
  await db.write();
  res.json({ ok: true });
});

app.get('/api/device/:deviceId/schedule', async (req, res) => {
  const dev = db.data.devices.find(d => d.deviceId === req.params.deviceId);
  if (!dev) return res.status(404).json({ message: 'الجهاز غير مسجل' });
  dev.online = true;
  dev.lastSeen = new Date();
  await db.write();
  res.json({
    currentTime: new Date().toISOString(),
    medicines: db.data.medicines.filter(m => m.patientId === dev.patientId)
  });
});

app.post('/api/device/:deviceId/taken', async (req, res) => {
  const dev = db.data.devices.find(d => d.deviceId === req.params.deviceId);
  if (!dev) return res.status(404).json({ message: 'غير مسجل' });
  
  const med = db.data.medicines.find(m => m.patientId === dev.patientId && m.box === req.body.box);
  if (med) {
    med.taken = true;
    med.takenAt = new Date();
    await db.write();
    io.to(`patient:${dev.patientId}`).emit('medicine:taken', med);
  }
  res.json({ ok: true });
});

app.post('/api/device/:deviceId/heartbeat', async (req, res) => {
  const dev = db.data.devices.find(d => d.deviceId === req.params.deviceId);
  if (dev) {
    dev.online = true;
    dev.lastSeen = new Date();
    dev.battery = req.body.battery ?? dev.battery;
    await db.write();
  }
  res.json({ ok: true });
});

// ============ SOCKET.IO ============
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.use((socket, next) => {
  try {
    const decoded = jwt.verify(socket.handshake.auth.token, SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.userId}`);
  socket.join(`patient:${socket.userId}`);
  console.log('🔌 connected:', socket.userId);
});

// ============ START ============
server.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));