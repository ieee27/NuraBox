/* Nura Box - auth.js : login / register / session (plain-text passwords: known limitation) */
(function () {
  'use strict';
  const NB = (window.NB = window.NB || {});
  const S = NB.store;

  // in-memory copy so login still works when localStorage is blocked (private window, blocked site data)
  let memSession = '';
  function session() {
    if (memSession) return memSession;
    try { memSession = localStorage.getItem(NB.KEY.session) || ''; } catch (e) { /* storage blocked */ }
    return memSession;
  }
  function setSession(u) {
    memSession = u || '';
    try { if (u) localStorage.setItem(NB.KEY.session, u); else localStorage.removeItem(NB.KEY.session); } catch (e) { /* ignore */ }
  }

  const A = (NB.auth = {});

  A.me = () => S.user(session());

  A.login = function (username, password) {
    const u = S.user(String(username || '').trim());
    if (!u || u.pass !== String(password || '')) return { ok: false, key: 'err_login' };
    setSession(u.username);
    return { ok: true, user: u };
  };

  A.register = function (f) {
    const username = String(f.username || '').trim();
    const name = String(f.name || '').trim();
    const password = String(f.password || '');
    const role = f.role === 'doctor' ? 'doctor' : 'patient';
    if (name.length < 2 || name.length > 40) return { ok: false, key: 'err_name' };
    if (!NB.USER_RE.test(username)) return { ok: false, key: 'err_username' };
    if (password.length < 4 || password.length > 64) return { ok: false, key: 'err_password' };
    if (S.user(username)) return { ok: false, key: 'err_exists' };
    if (S.users.length >= NB.MAX_USERS) return { ok: false, key: 'err_max_users' };
    const u = { username, role, name, pass: password, meds: {}, doctors: [], pending: [], created: Math.floor(Date.now() / 1000) };
    S.users.push(u);
    S.saveUsers();
    setSession(username);
    return { ok: true, user: u };
  };

  A.logout = () => setSession('');

  // one-click demo accounts (REMOVE before public use: delete the #demo-box block in index.html and this function)
  A.demo = function (kind) {
    const need = ['pat1', 'doc1'].filter((n) => !S.user(n)).length;
    if (S.users.length + need > NB.MAX_USERS) return { ok: false, key: 'err_demo_full' };
    let changed = false;
    if (!S.user('pat1')) {
      S.users.push({ username: 'pat1', role: 'patient', name: 'Demo Patient', pass: 'demo',
        meds: { '1': { name: 'Panadol', time: '08:00' }, '2': { name: 'Vitamin D', time: '14:00' }, '3': { name: 'Omega 3', time: '21:00' } },
        doctors: ['doc1'], pending: [], created: Math.floor(Date.now() / 1000) });
      changed = true;
    }
    if (!S.user('doc1')) {
      S.users.push({ username: 'doc1', role: 'doctor', name: 'Demo Doctor', pass: 'demo', meds: {}, doctors: [], pending: [], created: Math.floor(Date.now() / 1000) });
      changed = true;
    }
    if (changed) S.saveUsers();
    return A.login(kind === 'doc1' ? 'doc1' : 'pat1', 'demo');
  };

  A.strength = function (p) {
    p = String(p || '');
    if (!p) return '';
    let s = 0;
    if (p.length >= 6) s++;
    if (p.length >= 10) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
    return s <= 1 ? 'pw_weak' : s === 2 ? 'pw_ok' : 'pw_strong';
  };
})();
