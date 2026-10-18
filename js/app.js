/* Nura Box - app.js : boot, router, timers, event delegation */
(function () {
  'use strict';
  const NB = (window.NB = window.NB || {});
  const S = NB.store;
  const T = (k, v) => NB.T(k, v);
  const $ = (id) => document.getElementById(id);
  NB.ui = NB.ui || { page: 'home', viewPatient: '' };

  const PAGES = ['home', 'schedule', 'network', 'reports', 'settings'];
  const RENDER = {
    home: () => NB.dash.render(),
    schedule: () => NB.pages.renderSchedule(),
    network: () => NB.pages.renderNetwork(),
    reports: () => NB.pages.renderReports(),
    settings: () => NB.pages.renderSettings(),
  };

  // ---------- toasts ----------
  NB.toast = function (msg, type) {
    const box = $('toasts'); if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast ' + (type || '');
    d.textContent = msg;
    box.appendChild(d);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 3200);
  };

  // ---------- connection badge ----------
  function updateConn() {
    const b = $('conn-badge'); if (!b) return;
    let txt = T('conn_' + S.conn);
    if (S.conn === 'online' && S.status && S.status.ip) txt += ' · ' + (S.base ? S.base.replace(/^https?:\/\//, '') : S.status.ip);
    b.textContent = txt; b.title = txt;
    b.className = 'conn conn-' + S.conn;
  }

  // ---------- rendering (never clobber a field the user is typing in) ----------
  function typingIn(page) {
    const a = document.activeElement;
    return !!(a && page && page.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }
  function safeRender(name) {
    const el = $('page-' + name);
    if (!el || !el.classList.contains('active') || typingIn(el)) return;
    RENDER[name]();
  }
  function refreshActive() { if (NB.auth.me()) { safeRender(NB.ui.page); NB.pages.updateBadge(); } }

  NB.show = function (page) {
    if (PAGES.indexOf(page) < 0) page = 'home';
    NB.ui.page = page;
    PAGES.forEach((p) => $('page-' + p).classList.toggle('active', p === page));
    document.querySelectorAll('.bottom-nav button').forEach((b) => {
      const on = b.getAttribute('data-page') === page;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    RENDER[page]();
    window.scrollTo(0, 0);
  };

  NB.afterAuthChange = function () {
    const me = NB.auth.me();
    $('login-view').hidden = !!me;
    $('app-view').hidden = !me;
    if (me) { NB.dash.reset(); NB.pages.updateBadge(); NB.show(NB.ui.page); updateConn(); }
  };

  function renderAllLang() {
    NB.applyI18n();
    updateConn();
    if (NB.auth.me()) { NB.dash.reset(); NB.show(NB.ui.page); }
  }

  // ---------- login helpers ----------
  function formErr(id, key) {
    const e = $(id); e.textContent = key ? T(key) : '';
    if (key) { const c = $('login-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
  }

  // ---------- actions (click) ----------
  const ACTIONS = {
    lang: () => { NB.setLang(NB.lang() === 'ar' ? 'en' : 'ar'); renderAllLang(); },
    theme: () => { NB.setTheme(NB.theme() === 'dark' ? 'light' : 'dark'); if (NB.auth.me() && NB.ui.page === 'settings') NB.pages.renderSettings(); },
    'auth-tab': (el) => {
      const reg = el.getAttribute('data-tab') === 'register';
      $('tab-login').classList.toggle('active', !reg); $('tab-register').classList.toggle('active', reg);
      $('form-login').hidden = reg; $('form-register').hidden = !reg;
      formErr('login-err', ''); formErr('register-err', '');
    },
    'pw-toggle': (el) => { const i = el.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; },
    demo: (el) => {
      const r = NB.auth.demo(el.getAttribute('data-kind'));
      if (!r.ok) { formErr('login-err', r.key); return; }
      NB.ui.page = 'home'; NB.afterAuthChange();
    },
    logout: () => { NB.auth.logout(); NB.ui.page = 'home'; NB.ui.viewPatient = ''; NB.afterAuthChange(); },
    nav: (el) => NB.show(el.getAttribute('data-page')),
    take: (el) => NB.dash.take(parseInt(el.getAttribute('data-box'), 10)),
    'med-clear': (el) => NB.pages.clearMed(parseInt(el.getAttribute('data-box'), 10)),
    'req-accept': (el) => NB.pages.respond(el.getAttribute('data-user'), true),
    'req-reject': (el) => NB.pages.respond(el.getAttribute('data-user'), false),
    unlink: (el) => NB.pages.unlink(el.getAttribute('data-user')),
    'open-patient': (el) => { NB.ui.viewPatient = el.getAttribute('data-user'); NB.show('home'); },
    'dev-test': (el) => NB.pages.devTest(el.getAttribute('data-test')),
    'dev-calibrate': () => NB.pages.devCalibrate(),
    export: () => NB.pages.exportBackup(),
    import: () => { const f = $('import-file'); if (f) f.click(); },
    'clear-local': () => NB.pages.clearLocal(),
    'remote-off': () => NB.pages.remoteOff(),
  };

  // ---------- forms (submit) ----------
  const FORMS = {
    login: (f) => {
      const r = NB.auth.login(f.elements.username.value, f.elements.password.value);
      if (!r.ok) { formErr('login-err', r.key); return; }
      formErr('login-err', ''); f.reset(); NB.ui.page = 'home'; NB.afterAuthChange();
    },
    register: (f) => {
      const r = NB.auth.register({ name: f.elements.name.value, role: f.elements.role.value, username: f.elements.username.value, password: f.elements.password.value });
      if (!r.ok) { formErr('register-err', r.key); return; }
      formErr('register-err', ''); f.reset(); $('pw-hint').textContent = ''; NB.ui.page = 'home'; NB.afterAuthChange();
    },
    med: (f) => NB.pages.saveMed(f),
    addpatient: (f) => NB.pages.addPatient(f),
    report: (f) => NB.pages.sendReport(f),
    reply: (f) => NB.pages.sendReply(f),
    esp: (f) => NB.pages.saveEsp(f),
    remote: (f) => NB.pages.saveRemote(f),
    password: (f) => NB.pages.changePassword(f),
  };

  // ---------- change / input ----------
  const CHANGES = {
    'pick-patient': (el) => { NB.ui.viewPatient = el.value; NB.dash.render(); if (NB.ui.page !== 'home') RENDER[NB.ui.page](); },
    'dev-owner': (el) => NB.pages.devOwner(el),
    'dev-vol': (el) => NB.pages.devSlider('vol', el, true),
    'dev-bri': (el) => NB.pages.devSlider('bri', el, true),
    'dev-mute': (el) => NB.pages.devMute(el),
    'import-file': (el) => NB.pages.importBackup(el),
  };
  const INPUTS = {
    'pw-strength': (el) => {
      const k = NB.auth.strength(el.value); const h = $('pw-hint');
      h.textContent = k ? T(k) : ''; h.className = 'pw-hint ' + (k ? k.replace('pw_', '') : '');
    },
    'dev-vol': (el) => NB.pages.devSlider('vol', el, false),
    'dev-bri': (el) => NB.pages.devSlider('bri', el, false),
  };

  function bind() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const fn = ACTIONS[el.getAttribute('data-action')];
      if (fn) { if (el.tagName === 'A') e.preventDefault(); fn(el, e); }
    });
    document.addEventListener('submit', (e) => {
      const f = e.target.closest('[data-form]');
      if (!f) return;
      e.preventDefault();
      const fn = FORMS[f.getAttribute('data-form')];
      if (fn) fn(f);
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-change]');
      const fn = el && CHANGES[el.getAttribute('data-change')];
      if (fn) fn(el);
    });
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      const fn = el && INPUTS[el.getAttribute('data-input')];
      if (fn) fn(el);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });
    NB.on('users', () => { NB.pages.updateBadge(); refreshActive(); });
    NB.on('reports', refreshActive);
    NB.on('status', refreshActive);
    NB.on('conn', () => { updateConn(); if (NB.auth.me() && NB.ui.page === 'settings') safeRender('settings'); });
  }

  // ---------- timers ----------
  let n = 0;
  async function poll(force) {
    if (document.hidden && !force) return;
    if (S.conn === 'local') return;
    await S.pullStatus();
    if (S.conn !== 'online') return;
    if (S.pendingUsers && !S.pushing) S.pushUsers();
    S.resendLocal();
    if (force || n % 3 === 0) { S.pullUsers(); S.pullReports(); }   // 4 s status, ~12 s users/reports
  }

  function startTimers() {
    setInterval(() => { if (!document.hidden && NB.auth.me()) NB.dash.tick(); }, 1000);
    setInterval(() => { n++; poll(false); }, 4000);
  }

  // ---------- boot ----------
  async function boot() {
    NB.setTheme(NB.theme());
    NB.setLang(NB.lang());
    bind();
    NB.afterAuthChange();            // show something immediately (login or cached session)
    try {
      await S.detect();
      if (S.conn === 'online') await Promise.all([S.pullUsers(), S.pullReports()]);
    } catch (e) { console.error(e); }
    updateConn();
    NB.afterAuthChange();
    startTimers();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
