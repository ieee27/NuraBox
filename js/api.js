/* =========================================================
   API.JS - كل التعامل مع السيرفر (Backend) + Socket.IO + ESP32
   لو عايز تغيّر السيرفر أو تضيف API جديد، عدّل هنا بس
   ========================================================= */

const Api = (() => {
  // ============ CONFIG ============
  const API_BASE = localStorage.getItem('api_base') || 'http://localhost:5000/api';
  const WS_BASE  = localStorage.getItem('ws_base')  || 'http://localhost:5000';

  let TOKEN = localStorage.getItem('nura_token') || null;
  let socket = null;
  let espIp = localStorage.getItem('esp32_ip') || '192.168.1.50';
  let useEsp = localStorage.getItem('use_esp32') === 'true';
  let espConnected = false;

  // ============ TOKEN ============
  function setToken(t) {
    TOKEN = t;
    if (t) localStorage.setItem('nura_token', t);
    else localStorage.removeItem('nura_token');
  }
  function getToken() { return TOKEN; }

  // ============ HTTP REQUEST ============
  async function request(path, method = 'GET', body = null) {
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN && { Authorization: `Bearer ${TOKEN}` })
      },
      body: body ? JSON.stringify(body) : null
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `خطأ ${res.status}`);
    return data;
  }

  // ============ AUTH ============
  const auth = {
    register: (payload) => request('/auth/register', 'POST', payload),
    login: (payload) => request('/auth/login', 'POST', payload),
    me: () => request('/auth/me'),
    updatePassword: (newPassword) => request('/auth/password', 'PUT', { newPassword }),
  };

  // ============ MEDICINES ============
  const medicines = {
    list: (patientId) => request('/medicines' + (patientId ? `?patientId=${patientId}` : '')),
    save: (payload) => request('/medicines', 'POST', payload),
    markTaken: (box) => request(`/medicines/${box}/taken`, 'POST'),
    clear: (box) => request(`/medicines/${box}`, 'DELETE'),
  };

  // ============ REPORTS ============
  const reports = {
    create: (payload) => request('/reports', 'POST', payload),
    my: () => request('/reports/me'),
    doctor: () => request('/reports/doctor'),
    addNote: (id, note) => request(`/reports/${id}/note`, 'POST', { note }),
  };

  // ============ NETWORK ============
  const network = {
    sendRequest: (username) => request('/network/request', 'POST', { username }),
    myDoctors: () => request('/network/my-doctors'),
    myPatients: () => request('/network/my-patients'),
    pendingRequests: () => request('/network/requests'),
    respond: (id, action) => request(`/network/requests/${id}`, 'PUT', { action }),
    removeLink: (id) => request(`/network/link/${id}`, 'DELETE'),
  };

  // ============ SOCKET.IO ============
  function connectSocket(handlers = {}) {
    if (socket) socket.disconnect();
    if (!TOKEN) return;
    socket = io(WS_BASE, { auth: { token: TOKEN } });

    socket.on('connect', () => console.log('🔌 Socket connected'));
    socket.on('notification', (n) => handlers.onNotification?.(n));
    socket.on('medicine:updated', (m) => handlers.onMedicineUpdate?.(m));
    socket.on('medicine:taken', (m) => handlers.onMedicineTaken?.(m));
    return socket;
  }
  function disconnectSocket() {
    if (socket) { socket.disconnect(); socket = null; }
  }

  // ============ ESP32 ============
  const esp32 = {
    getIp: () => espIp,
    setIp: (ip) => {
      espIp = ip;
      useEsp = true;
      localStorage.setItem('esp32_ip', ip);
      localStorage.setItem('use_esp32', 'true');
    },
    isEnabled: () => useEsp,
    isConnected: () => espConnected,

    async call(path, method = 'GET', data = null, timeout = 3000) {
      if (!useEsp) return null;
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeout);
        const res = await fetch(`http://${espIp}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: data ? JSON.stringify(data) : null,
          signal: controller.signal
        });
        clearTimeout(tid);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) {
        espConnected = false;
        return null;
      }
    },

    async testConnection() {
      const result = await this.call('/api/status', 'GET', null, 5000);
      espConnected = !!result;
      return espConnected;
    },

    async saveIpAndTest(ip) {
      this.setIp(ip);
      return await this.testConnection();
    },

    async markTaken(box) {
      await this.call('/api/taken', 'POST', { box: Number(box) });
    },
    async saveMedicine(payload) {
      await this.call('/api/save', 'POST', payload);
    },
    async clearMedicine(box) {
      await this.call('/api/clear', 'POST', { box: Number(box) });
    },
    async triggerBuzzer() {
      await this.call('/api/buzzer', 'POST');
    },
    async syncTime() {
      await this.call('/api/sync', 'POST');
    },
  };

  // ============ EXPORT ============
  return {
    setToken, getToken, request,
    auth, medicines, reports, network,
    connectSocket, disconnectSocket,
    esp32,
  };
})();