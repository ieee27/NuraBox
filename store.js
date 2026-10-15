/* Nura Box - store.js : users / reports / localStorage + ESP32 sync */
(function () {
  'use strict';
  const NB = (window.NB = window.NB || {});
  const KEY = { users: 'nb_users', reports: 'nb_reports', session: 'nb_session', esp: 'nb_esp_url', dev: 'nb_dev_settings' };
  const MAX_USERS = 10, MAX_REPORTS = 200;
  const USER_RE = /^[A-Za-z0-9_.-]{3,20}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  // ---------- tiny utils ----------
  function jget(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota / private mode */ } }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  NB.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const pad = (n) => String(n).padStart(2, '0');
  NB.pad = pad;
  NB.todayStr = (d) => { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  NB.secOfDay = (d) => { d = d || new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };
  NB.USER_RE = USER_RE;
  NB.TIME_RE = TIME_RE;
  NB.MAX_USERS = MAX_USERS;
  NB.KEY = KEY;

  // ---------- tiny event bus ----------
  const bus = {};
  NB.on = (ev, fn) => { (bus[ev] = bus[ev] || []).push(fn); };
  NB.emit = (ev, a) => { (bus[ev] || []).forEach((fn) => { try { fn(a); } catch (e) { console.error(ev, e); } }); };

  // ---------- state ----------
  const S = (NB.store = {
    users: jget(KEY.users, []),
    reports: jget(KEY.reports, []),
    conn: 'local',          // local | online | offline
    base: '',               // '' = same origin (page served by ESP32)
    status: null,           // last GET /api/status
    blocked: false,         // https page cannot call http ESP32 (mixed content)
    failCount: 0,
    pendingUsers: false,
    pushing: false,
    devSettings: Object.assign({ volume: 60, brightness: 60, muted: false }, jget(KEY.dev, {})),
  });
  if (!Array.isArray(S.users)) S.users = [];
  if (!Array.isArray(S.reports)) S.reports = [];

  // ---------- HTTP ----------
  function normUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u.replace(/\/+$/, '');
  }
  S.espUrl = () => localStorage.getItem(KEY.esp) || '';
  S.setEspUrl = (u) => { try { if (u) localStorage.setItem(KEY.esp, normUrl(u)); else localStorage.removeItem(KEY.esp); } catch (e) { /* ignore */ } };

  S.api = async function (path, opt, timeout) {
    opt = opt || {};
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), timeout || 4000);
    try {
      const res = await fetch(S.base + path, {
        method: opt.method || 'GET',
        // text/plain keeps the POST "simple" (no CORS preflight); firmware parses the body as JSON anyway
        headers: opt.body ? { 'Content-Type': 'text/plain' } : undefined,
        body: opt.body ? JSON.stringify(opt.body) : undefined,
        signal: ctl.signal,
        cache: 'no-store',
      });
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) { const err = new Error((data && data.error) || 'HTTP ' + res.status); err.status = res.status; throw err; }
      return data;
    } finally { clearTimeout(tid); }
  };

  // ---------- connection detection ----------
  S.detect = async function () {
    S.blocked = false;
    const cands = [];
    const served = /^https?:$/.test(location.protocol) && location.hostname && !/\.github\.io$/i.test(location.hostname);
    if (served) cands.push('');
    const saved = normUrl(S.espUrl());
    if (saved) cands.push(saved);
    let tried = 0;
    for (const c of cands) {
      if (location.protocol === 'https:' && c.indexOf('http://') === 0) { S.blocked = true; continue; }
      tried++;
      S.base = c;
      try {
        const st = await S.api('/api/status', {}, 2500);
        if (st && typeof st === 'object' && st.boxes) {
          S.remoteDisconnect();               // LAN works: no need for the internet path
          S.status = st; S.conn = 'online'; S.failCount = 0; S.lanPossible = true;
          NB.emit('conn'); return S.conn;
        }
      } catch (e) { /* try next */ }
    }
    S.status = null;
    S.base = saved && !S.blocked ? saved : '';
    S.conn = (saved && tried > 0) ? 'offline' : 'local';
    S.lanPossible = tried > 0;
    NB.emit('conn');
    if (S.remoteCfg().host) S.remoteConnect();       // LAN unreachable: try the internet path (MQTT over WSS)
    return S.conn;
  };

  S.pullStatus = async function () {
    if (S.conn === 'remote') { S.remoteCheck(); return; }       // remote status is pushed by MQTT; only check freshness here
    if (S.conn === 'local' || !S.lanPossible) return;
    try {
      const st = await S.api('/api/status', {}, 2500);
      S.failCount = 0; S.status = st;
      if (S.conn !== 'online') { S.conn = 'online'; NB.emit('conn'); }
    } catch (e) {
      S.failCount++;
      if (S.failCount >= 2 && S.conn !== 'offline') { S.conn = 'offline'; S.status = null; NB.emit('conn'); }
    }
    NB.emit('status');
  };

  // ---------- validation ----------
  function cleanMeds(m) {
    const out = {};
    if (m && typeof m === 'object') {
      for (let i = 1; i <= 4; i++) {
        const e = m[i] || m[String(i)];
        if (e && typeof e.name === 'string' && e.name.trim() && TIME_RE.test(e.time || '')) {
          out[String(i)] = { name: e.name.trim().slice(0, 40), time: e.time };
        }
      }
    }
    return out;
  }
  function cleanNames(a) {
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && USER_RE.test(x)).slice(0, MAX_USERS) : [];
  }
  S.cleanUser = function (u) {
    if (!u || typeof u !== 'object') return null;
    if (typeof u.username !== 'string' || !USER_RE.test(u.username)) return null;
    if (u.role !== 'patient' && u.role !== 'doctor') return null;
    if (typeof u.pass !== 'string' || !u.pass) return null;
    return {
      username: u.username, role: u.role,
      name: String(u.name || u.username).slice(0, 40),
      pass: u.pass.slice(0, 64),
      meds: cleanMeds(u.meds),
      doctors: cleanNames(u.doctors),
      pending: cleanNames(u.pending),
      created: Number(u.created) || 0,
    };
  };
  const KINDS = ['report', 'reply', 'dose'];
  S.cleanReport = function (r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') return null;
    if (KINDS.indexOf(r.kind) < 0) return null;
    return r;
  };
  function validUsers(arr) {
    if (!Array.isArray(arr) || arr.length > MAX_USERS) return null;
    const out = []; const seen = {};
    for (const u of arr) { const c = S.cleanUser(u); if (!c || seen[c.username]) return null; seen[c.username] = 1; out.push(c); }
    return out;
  }

  // ---------- users ----------
  S.user = (name) => S.users.find((u) => u.username === name) || null;
  S.patientsOf = (doc) => S.users.filter((u) => u.role === 'patient' && (u.doctors || []).indexOf(doc) >= 0);
  S.doctorsOf = (pat) => (S.user(pat) ? S.user(pat).doctors : []).map(S.user).filter(Boolean);

  S.saveUsers = function () {
    jset(KEY.users, S.users);
    if (S.conn === 'online') { S.pendingUsers = true; clearTimeout(S._pt); S._pt = setTimeout(S.pushUsers, 300); }
    else if (S.conn === 'remote') { clearTimeout(S._rt); S._rt = setTimeout(pushRemoteMeds, 400); }   // remote: only the owner's medicines travel
    NB.emit('users');
  };

  S.pushUsers = async function () {
    if (S.pushing || S.conn !== 'online') return;
    S.pushing = true;
    try {
      await S.api('/api/users', { method: 'POST', body: S.users }, 6000);
      S.pendingUsers = false;
      S.pullStatus();     // the box may now follow a different owner: refresh status right away instead of waiting for the next poll
    } catch (e) {
      if (e.status === 409 || e.status === 400 || e.status === 413) { S.pendingUsers = false; NB.toast(e.message, 'err'); }
      /* network error: stay pending, tick() retries */
    } finally { S.pushing = false; }
  };

  S.pullUsers = async function () {
    if (S.conn !== 'online' || S.pendingUsers || S.pushing) return;
    try {
      const arr = await S.api('/api/users', {}, 5000);
      if (!Array.isArray(arr) || S.pendingUsers) return;
      if (arr.length === 0 && S.users.length > 0) { S.pendingUsers = true; S.pushUsers(); return; }   // ESP32 lost its data: restore from this browser
      const clean = validUsers(arr);
      if (!clean) return;
      if (JSON.stringify(clean) !== JSON.stringify(S.users)) { S.users = clean; jset(KEY.users, S.users); NB.emit('users'); }
    } catch (e) { /* offline handled by status poll */ }
  };

  // ---------- reports ----------
  function capReports() { if (S.reports.length > MAX_REPORTS) S.reports = S.reports.slice(-MAX_REPORTS); }
  S.addReport = async function (rec) {
    rec.id = rec.id || 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    rec.ts = rec.ts || Math.floor(Date.now() / 1000);
    rec.date = rec.date || NB.todayStr();
    const local = Object.assign({}, rec);
    if (S.conn === 'online') local._local = true;
    S.reports.push(local); capReports();
    jset(KEY.reports, S.reports);
    NB.emit('reports');
    if (S.conn === 'online') {
      try {
        await S.api('/api/report', { method: 'POST', body: rec }, 6000);
        delete local._local; jset(KEY.reports, S.reports);
      } catch (e) { /* stays _local, merged back on next pull; re-sent below */ }
    }
  };

  S.resendLocal = async function () {
    if (S.conn !== 'online') return;
    for (const r of S.reports.filter((x) => x._local)) {
      const body = Object.assign({}, r); delete body._local;
      try { await S.api('/api/report', { method: 'POST', body }, 6000); delete r._local; } catch (e) { break; }
    }
    jset(KEY.reports, S.reports);
  };

  S.pullReports = async function () {
    if (S.conn !== 'online') return;
    try {
      const arr = await S.api('/api/reports', {}, 6000);
      if (!Array.isArray(arr)) return;
      const remote = arr.map(S.cleanReport).filter(Boolean);
      const ids = {}; remote.forEach((r) => { ids[r.id] = 1; });
      const pending = S.reports.filter((r) => r._local && !ids[r.id]);
      const merged = remote.concat(pending).sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-MAX_REPORTS);
      if (JSON.stringify(merged) !== JSON.stringify(S.reports)) { S.reports = merged; jset(KEY.reports, S.reports); NB.emit('reports'); }
    } catch (e) { /* ignore */ }
  };

  S.doses = (user, date) => S.reports.filter((r) => r.kind === 'dose' && r.user === user && (!date || r.date === date));

  // ---------- device control (only when ESP32 online) ----------
  // every control goes over the LAN API when the page talks to the box directly, otherwise over MQTT
  const viaRemote = () => S.conn === 'remote';
  S.dev = {
    saveSettings: async (patch) => {
      Object.assign(S.devSettings, patch); jset(KEY.dev, S.devSettings);
      if (S.conn === 'online') return S.api('/api/settings', { method: 'POST', body: patch });
      if (viaRemote()) return S.remoteCmd(Object.assign({ cmd: 'settings' }, patch));
      return null;
    },
    test: (action, box) => (viaRemote() ? S.remoteCmd({ cmd: 'test', action, box }) : S.api('/api/test', { method: 'POST', body: { action, box } })),
    calibrate: () => (viaRemote() ? S.remoteCmd({ cmd: 'calibrate' }) : S.api('/api/calibrate', { method: 'POST', body: {} }, 6000)),
    setOwner: (owner) => (viaRemote() ? S.remoteCmd({ cmd: 'owner', owner }) : S.api('/api/device', { method: 'POST', body: { owner } })),
  };

  // ---------- remote access: MQTT over WSS (works from the HTTPS GitHub Pages site) ----------
  const REMOTE_KEY = 'nb_remote';
  S.remoteCfg = () => Object.assign({ host: '', port: 8884, user: '', pass: '', id: '' }, jget(REMOTE_KEY, {}));
  S.setRemoteCfg = (c) => jset(REMOTE_KEY, c);
  const R = (S.remote = { client: null, up: false, online: false, status: null, lastStatusAt: 0, pending: {} });
  const rTopic = (leaf) => 'nurabox/' + S.remoteCfg().id + '/' + leaf;

  // conn state machine: LAN always wins; 'remote' needs broker up + device "online"=1 + a status newer than 20 s
  function remoteState() {
    if (S.conn === 'online') return;
    const was = S.conn;
    const fresh = Date.now() - R.lastStatusAt < 20000;
    if (R.up && R.online && fresh && R.status) { S.status = R.status; S.conn = 'remote'; }
    else if (S.conn === 'remote') { S.conn = 'offline'; S.status = null; }
    if (S.conn !== was) NB.emit('conn');
  }
  S.remoteCheck = remoteState;

  function mergeRemoteReports(arr) {
    if (!Array.isArray(arr)) return;
    const have = {}; S.reports.forEach((r) => { have[r.id] = 1; });
    let added = 0;
    arr.map(S.cleanReport).filter(Boolean).forEach((r) => { if (!have[r.id]) { S.reports.push(r); added++; } });
    if (!added) return;
    S.reports.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    capReports(); jset(KEY.reports, S.reports); NB.emit('reports');
  }

  function onRemoteMsg(topic, payload) {
    let txt = '';
    try { txt = new TextDecoder().decode(payload); } catch (e) { return; }
    const leaf = topic.split('/').pop();
    if (leaf === 'online') { R.online = txt === '1'; remoteState(); return; }
    let data;
    try { data = JSON.parse(txt); } catch (e) { return; }
    if (leaf === 'status') {
      if (!data || !Array.isArray(data.boxes)) return;
      R.status = data; R.lastStatusAt = Date.now();
      if (S.conn === 'remote') { S.status = data; NB.emit('status'); } else remoteState();
    } else if (leaf === 'reports') {
      mergeRemoteReports(data);
    } else if (leaf === 'res' && data && R.pending[data.id]) {
      const p = R.pending[data.id]; delete R.pending[data.id]; clearTimeout(p.t);
      if (data.ok) p.ok(data); else p.err(new Error(data.error || 'failed'));
    }
  }

  S.remoteDisconnect = function () {
    if (R.client) { try { R.client.end(true); } catch (e) { /* ignore */ } R.client = null; }
    R.up = false; R.online = false; R.status = null; R.lastStatusAt = 0;
    if (S.conn === 'remote') { S.conn = 'offline'; S.status = null; NB.emit('conn'); }
  };

  S.remoteConnect = function () {
    const c = S.remoteCfg();
    S.remoteDisconnect();
    if (!c.host || !/^[0-9a-f]{8}$/.test(c.id) || !window.mqtt) return false;     // window.mqtt missing = CDN blocked / offline
    try {
      R.client = window.mqtt.connect('wss://' + c.host + ':' + (c.port || 8884) + '/mqtt', {
        username: c.user || undefined, password: c.pass || undefined,
        clientId: 'nbweb-' + Math.random().toString(16).slice(2, 10),
        reconnectPeriod: 5000, connectTimeout: 8000, clean: true,
      });
    } catch (e) { R.client = null; return false; }
    const cl = R.client;
    cl.on('connect', () => { R.up = true; cl.subscribe([rTopic('status'), rTopic('reports'), rTopic('online'), rTopic('res')], { qos: 1 }); });
    cl.on('close', () => { R.up = false; remoteState(); });
    cl.on('error', () => { R.up = false; remoteState(); });
    cl.on('message', onRemoteMsg);
    return true;
  };

  S.remoteCmd = function (cmd) {
    return new Promise((resolve, reject) => {
      if (!R.client || !R.up) { reject(new Error('remote down')); return; }
      const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const t = setTimeout(() => { delete R.pending[id]; reject(new Error('timeout')); }, 10000);
      R.pending[id] = { ok: resolve, err: reject, t };
      R.client.publish(rTopic('cmd'), JSON.stringify(Object.assign({ id }, cmd)), { qos: 1 }, (err) => {
        if (err) { clearTimeout(t); delete R.pending[id]; reject(err); }
      });
    });
  };

  function pushRemoteMeds() {
    const o = S.status && S.status.owner ? S.user(S.status.owner) : null;
    if (!o) return;
    S.remoteCmd({ cmd: 'meds', user: o.username, meds: o.meds || {} })
      .then(() => NB.toast(NB.T('dev_saved'), 'ok'))
      .catch((e) => NB.toast(NB.T('dev_fail') + ': ' + e.message, 'err'));
  }

  // ---------- backup ----------
  S.exportBackup = () => JSON.stringify({ app: 'nurabox', version: 1, exported: new Date().toISOString(), users: S.users, reports: S.reports.map((r) => { const c = Object.assign({}, r); delete c._local; return c; }) }, null, 2);

  S.importBackup = function (text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, key: 'import_err' }; }
    if (!data || data.app !== 'nurabox' || !Array.isArray(data.users) || !Array.isArray(data.reports)) return { ok: false, key: 'import_err' };
    const users = validUsers(data.users);
    if (!users) return { ok: false, key: 'import_err' };
    const reports = data.reports.map(S.cleanReport).filter(Boolean).slice(-MAX_REPORTS);
    S.users = users; S.reports = reports;
    jset(KEY.reports, S.reports);
    S.saveUsers();
    if (S.conn === 'online') S.reports.forEach((r) => { S.api('/api/report', { method: 'POST', body: r }).catch(() => {}); });
    NB.emit('reports');
    return { ok: true, key: 'import_ok' };
  };

  S.clearLocal = function () {
    try { Object.keys(KEY).forEach((k) => { if (k !== 'esp') localStorage.removeItem(KEY[k]); }); } catch (e) { /* ignore */ }
    S.users = []; S.reports = [];
  };
})();
