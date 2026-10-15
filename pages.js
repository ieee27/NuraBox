/* Nura Box - pages.js : schedules, network, reports, settings, backup */
(function () {
  'use strict';
  const NB = (window.NB = window.NB || {});
  const S = NB.store;
  const esc = NB.esc;
  const T = (k, v) => NB.T(k, v);
  const $ = (id) => document.getElementById(id);
  NB.ui = NB.ui || { page: 'home', viewPatient: '' };
  const P = (NB.pages = {});

  const initial = (n) => esc(String(n || '?').trim().charAt(0).toUpperCase());
  const fmtDate = (ts) => new Date(ts * 1000).toLocaleString(NB.lang() === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  // ================= SCHEDULES =================
  P.renderSchedule = function () {
    const me = NB.auth.me(); const el = $('page-schedule');
    if (!me) return;
    const user = NB.dash.target();
    let h = '<h2 class="page-title">' + esc(T('sch_title')) + '</h2>';
    if (me.role === 'doctor') {
      const list = S.patientsOf(me.username);
      if (!list.length) { el.innerHTML = h + '<div class="card"><p class="empty-note">' + esc(T('no_patients')) + '</p></div>'; return; }
      h += '<div class="card"><label class="fld" style="margin:0"><span>' + esc(T('pick_patient')) + '</span><select data-change="pick-patient">' +
        list.map((p) => '<option value="' + esc(p.username) + '"' + (user && p.username === user.username ? ' selected' : '') + '>' + esc(p.name) + ' (@' + esc(p.username) + ')</option>').join('') + '</select></label></div>';
    }
    if (!user) { el.innerHTML = h; return; }
    const live = NB.dash.isLive(user);
    h += '<div class="card"><h3>' + esc(user.name) + (live ? '<small>' + esc(T('sch_synced')) + '</small>' : '') + '</h3>';
    for (let i = 1; i <= 4; i++) {
      const m = (user.meds || {})[String(i)] || { name: '', time: '' };
      h += '<form class="sched-row" data-form="med"><input type="hidden" name="box" value="' + i + '">' +
        '<span class="bn">' + esc(T('box_n', { n: i })) + '</span>' +
        '<input name="name" maxlength="40" placeholder="' + esc(T('f_medname')) + '" value="' + esc(m.name) + '">' +
        '<input name="time" type="time" value="' + esc(m.time) + '">' +
        '<span class="row"><button class="btn primary sm" type="submit">' + esc(T('btn_save')) + '</button>' +
        (m.name ? '<button class="btn danger sm" type="button" data-action="med-clear" data-box="' + i + '">' + esc(T('btn_clear')) + '</button>' : '') + '</span></form>';
    }
    el.innerHTML = h + '</div>';
  };

  P.saveMed = function (form) {
    const user = NB.dash.target(); if (!user) return;
    const box = parseInt(form.elements.box.value, 10);
    const name = form.elements.name.value.trim(), time = form.elements.time.value;
    if (!name || !NB.TIME_RE.test(time)) { NB.toast(T('err_med'), 'err'); return; }
    user.meds = user.meds || {};
    user.meds[String(box)] = { name: name.slice(0, 40), time };
    S.saveUsers(); NB.toast(T('saved'), 'ok');
    P.renderSchedule(); NB.dash.render();
  };

  P.clearMed = function (box) {
    const user = NB.dash.target(); if (!user || !user.meds) return;
    delete user.meds[String(box)];
    S.saveUsers(); NB.toast(T('cleared'), 'ok');
    P.renderSchedule(); NB.dash.render();
  };

  // ================= NETWORK =================
  P.renderNetwork = function () {
    const me = NB.auth.me(); const el = $('page-network');
    if (!me) return;
    let h = '<h2 class="page-title">' + esc(T('net_title')) + '</h2>';
    if (me.role === 'doctor') {
      h += '<div class="card"><h3>' + esc(T('add_patient')) + '</h3><form class="row" data-form="addpatient"><input class="grow" name="username" autocapitalize="off" placeholder="' + esc(T('f_patient_username')) + '" required><button class="btn primary" type="submit">' + esc(T('btn_send')) + '</button></form></div>';
      const pts = S.patientsOf(me.username);
      const pend = S.users.filter((u) => u.role === 'patient' && (u.pending || []).indexOf(me.username) >= 0);
      h += '<div class="card"><h3>' + esc(T('my_patients')) + '</h3>' +
        (pts.length ? pts.map((p) => '<div class="item"><div class="who"><span class="avatar">' + initial(p.name) + '</span><div><b>' + esc(p.name) + '</b><br><small>@' + esc(p.username) + '</small></div></div>' +
          '<div class="row"><button class="btn sm" data-action="open-patient" data-user="' + esc(p.username) + '">' + esc(T('btn_open')) + '</button><button class="btn danger sm" data-action="unlink" data-user="' + esc(p.username) + '">' + esc(T('btn_unlink')) + '</button></div></div>').join('') : '<p class="empty-note">' + esc(T('no_patients')) + '</p>') +
        (pend.length ? '<p class="muted" style="margin-top:10px">' + esc(T('awaiting')) + ': ' + pend.map((p) => '@' + esc(p.username)).join(', ') + '</p>' : '') + '</div>';
    } else {
      const reqs = (me.pending || []).map(S.user).filter(Boolean);
      h += '<div class="card"><h3>' + esc(T('pending_requests')) + '</h3>' +
        (reqs.length ? reqs.map((d) => '<div class="item"><div class="who"><span class="avatar">' + initial(d.name) + '</span><div><b>' + esc(T('doctor_prefix')) + ' ' + esc(d.name) + '</b><br><small>@' + esc(d.username) + '</small></div></div>' +
          '<div class="row"><button class="btn primary sm" data-action="req-accept" data-user="' + esc(d.username) + '">' + esc(T('btn_accept')) + '</button><button class="btn danger sm" data-action="req-reject" data-user="' + esc(d.username) + '">' + esc(T('btn_reject')) + '</button></div></div>').join('') : '<p class="empty-note">' + esc(T('no_requests')) + '</p>') + '</div>';
      const docs = S.doctorsOf(me.username);
      h += '<div class="card"><h3>' + esc(T('my_doctors')) + '</h3>' +
        (docs.length ? docs.map((d) => '<div class="item"><div class="who"><span class="avatar">' + initial(d.name) + '</span><div><b>' + esc(T('doctor_prefix')) + ' ' + esc(d.name) + '</b><br><small>@' + esc(d.username) + '</small></div></div>' +
          '<button class="btn danger sm" data-action="unlink" data-user="' + esc(d.username) + '">' + esc(T('btn_unlink')) + '</button></div>').join('') : '<p class="empty-note">' + esc(T('no_doctors')) + '</p>') + '</div>';
    }
    el.innerHTML = h;
    P.updateBadge();
  };

  P.updateBadge = function () {
    const me = NB.auth.me(); const b = $('nav-badge-network');
    const n = me && me.role === 'patient' ? (me.pending || []).length : 0;
    b.hidden = !n; b.textContent = n;
  };

  P.addPatient = function (form) {
    const me = NB.auth.me(); if (!me || me.role !== 'doctor') return;
    const uname = form.elements.username.value.trim();
    const p = S.user(uname);
    if (!p || p.role !== 'patient') { NB.toast(T('err_no_patient'), 'err'); return; }
    if ((p.doctors || []).indexOf(me.username) >= 0 || (p.pending || []).indexOf(me.username) >= 0) { NB.toast(T('err_already'), 'err'); return; }
    p.pending = (p.pending || []).concat(me.username);
    S.saveUsers(); form.reset(); NB.toast(T('req_sent'), 'ok'); P.renderNetwork();
  };

  P.respond = function (docName, accept) {
    const me = NB.auth.me(); if (!me) return;
    me.pending = (me.pending || []).filter((x) => x !== docName);
    if (accept && (me.doctors || []).indexOf(docName) < 0) me.doctors = (me.doctors || []).concat(docName);
    S.saveUsers(); NB.toast(T(accept ? 'accepted' : 'rejected'), 'ok'); P.renderNetwork();
  };

  P.unlink = function (other) {
    const me = NB.auth.me(); if (!me) return;
    const pat = me.role === 'patient' ? me : S.user(other);
    const doc = me.role === 'patient' ? other : me.username;
    if (!pat) return;
    pat.doctors = (pat.doctors || []).filter((x) => x !== doc);
    S.saveUsers(); NB.toast(T('unlinked'), 'ok'); P.renderNetwork(); NB.dash.render();
  };

  // ================= REPORTS =================
  function repCard(r, canReply) {
    const replies = S.reports.filter((x) => x.kind === 'reply' && x.ref === r.id);
    const prob = r.problemBox ? T('box_n', { n: r.problemBox }) : T('none');
    return '<div class="rep"><div class="row" style="justify-content:space-between"><b>' + esc(r.name || r.user) + '</b><small>' + esc(fmtDate(r.ts)) + '</small></div>' +
      '<p style="margin-top:6px">' + esc(T('feel_' + r.feel)) + ' &middot; ' + esc(T('rep_problem')) + ': ' + esc(prob) + '</p>' +
      '<p><b>' + esc(T('rep_symptoms')) + ':</b> ' + esc(r.symptoms) + '</p>' + (r.notes ? '<p class="muted">' + esc(r.notes) + '</p>' : '') +
      replies.map((x) => '<div class="reply"><b>' + esc(T('doctor_reply')) + ' (' + esc(x.doctorName || x.doctor) + '):</b> ' + esc(x.text) + '</div>').join('') +
      (canReply ? '<form class="row" style="margin-top:10px" data-form="reply"><input type="hidden" name="ref" value="' + esc(r.id) + '"><input class="grow" name="text" maxlength="300" placeholder="' + esc(T('rep_reply')) + '" required><button class="btn primary sm" type="submit">' + esc(T('btn_reply')) + '</button></form>' : '') + '</div>';
  }

  P.renderReports = function () {
    const me = NB.auth.me(); const el = $('page-reports');
    if (!me) return;
    let h = '<h2 class="page-title">' + esc(T('rep_title')) + '</h2>';
    if (me.role === 'patient') {
      h += '<div class="card"><form data-form="report">' +
        '<label class="fld"><span>' + esc(T('rep_feel')) + '</span><select name="feel"><option value="good">' + esc(T('feel_good')) + '</option><option value="ok">' + esc(T('feel_ok')) + '</option><option value="bad">' + esc(T('feel_bad')) + '</option></select></label>' +
        '<label class="fld"><span>' + esc(T('rep_problem')) + '</span><select name="problemBox"><option value="0">' + esc(T('none')) + '</option>' + [1, 2, 3, 4].map((i) => '<option value="' + i + '">' + esc(T('box_n', { n: i })) + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>' + esc(T('rep_symptoms')) + '</span><input name="symptoms" maxlength="120" required></label>' +
        '<label class="fld"><span>' + esc(T('rep_notes')) + '</span><textarea name="notes" rows="3" maxlength="300"></textarea></label>' +
        '<button class="btn primary" type="submit">' + esc(T('btn_send_report')) + '</button></form></div>';
      const mine = S.reports.filter((r) => r.kind === 'report' && r.user === me.username).sort((a, b) => b.ts - a.ts);
      h += '<div class="card"><h3>' + esc(T('rep_history')) + '</h3>' + (mine.length ? mine.map((r) => repCard(r, false)).join('') : '<p class="empty-note">' + esc(T('no_reports')) + '</p>') + '</div>';
    } else {
      const names = S.patientsOf(me.username).map((p) => p.username);
      const list = S.reports.filter((r) => r.kind === 'report' && names.indexOf(r.user) >= 0).sort((a, b) => b.ts - a.ts);
      h += '<div class="card"><h3>' + esc(T('rep_patient_reports')) + '</h3>' + (list.length ? list.map((r) => repCard(r, true)).join('') : '<p class="empty-note">' + esc(T('no_reports')) + '</p>') + '</div>';
    }
    el.innerHTML = h;
  };

  P.sendReport = function (form) {
    const me = NB.auth.me(); if (!me || me.role !== 'patient') return;
    const f = form.elements;
    const symptoms = f.symptoms.value.trim();
    if (!symptoms) return;
    S.addReport({ kind: 'report', user: me.username, name: me.name, feel: f.feel.value, problemBox: parseInt(f.problemBox.value, 10) || 0, symptoms: symptoms.slice(0, 120), notes: f.notes.value.trim().slice(0, 300) });
    NB.toast(T('rep_sent'), 'ok'); form.reset();
  };

  P.sendReply = function (form) {
    const me = NB.auth.me(); if (!me || me.role !== 'doctor') return;
    const text = form.elements.text.value.trim(); if (!text) return;
    const ref = form.elements.ref.value;
    const orig = S.reports.find((r) => r.id === ref);
    S.addReport({ kind: 'reply', ref, user: orig ? orig.user : '', doctor: me.username, doctorName: me.name, text: text.slice(0, 300) });
    NB.toast(T('reply_sent'), 'ok');
  };

  // ================= SETTINGS =================
  P.renderSettings = function () {
    const me = NB.auth.me(); const el = $('page-settings');
    if (!me) return;
    const lan = S.conn === 'online' && S.status;                                   // page talks to the box directly
    const online = (S.conn === 'online' || S.conn === 'remote') && S.status;      // box reachable (LAN or internet)
    const ds = online && S.status.settings ? S.status.settings : S.devSettings;
    let h = '<h2 class="page-title">' + esc(T('set_title')) + '</h2>';

    h += '<div class="card"><div class="who"><span class="avatar">' + initial(me.name) + '</span><div><b>' + esc(me.name) + '</b><br><small>@' + esc(me.username) + ' &middot; ' + esc(T('role_' + me.role)) + '</small></div></div></div>';

    h += '<div class="card"><h3>' + esc(T('set_appearance')) + '</h3><div class="row"><button class="btn" data-action="lang">' + esc(T('lang')) + ': ' + esc(T('lang_name')) + '</button><button class="btn" data-action="theme">' + esc(T('theme')) + ': ' + esc(T(NB.theme() === 'dark' ? 'theme_dark' : 'theme_light')) + '</button></div></div>';

    h += '<div class="card"><h3>' + esc(T('set_device')) + '</h3><form class="row" data-form="esp"><input class="grow" name="url" inputmode="url" autocapitalize="off" placeholder="http://192.168.1.50" value="' + esc(S.espUrl()) + '"><button class="btn primary" type="submit">' + esc(T('btn_save_test')) + '</button></form>' +
      '<p class="muted" style="margin-top:10px">' + esc(T('conn_' + S.conn)) + (online ? ' &middot; ' + esc(S.status.ip) + ' &middot; fw ' + esc(S.status.fw) : '') + '</p>' +
      (S.blocked ? '<p class="form-err" style="margin-top:6px">' + esc(T('esp_blocked_hint')) + '</p>' : '') + '</div>';

    const rc = S.remoteCfg();
    h += '<div class="card"><h3>' + esc(T('set_remote')) + '</h3><form data-form="remote">' +
      '<div class="row"><label class="fld grow"><span>' + esc(T('r_host')) + '</span><input name="host" autocapitalize="off" spellcheck="false" placeholder="xxxx.s1.eu.hivemq.cloud" value="' + esc(rc.host) + '"></label>' +
      '<label class="fld" style="width:110px"><span>' + esc(T('r_port')) + '</span><input name="port" inputmode="numeric" value="' + esc(rc.port) + '"></label></div>' +
      '<div class="row"><label class="fld grow"><span>' + esc(T('r_user')) + '</span><input name="user" autocapitalize="off" autocomplete="off" value="' + esc(rc.user) + '"></label>' +
      '<label class="fld grow"><span>' + esc(T('f_password')) + '</span><input name="pass" type="password" autocomplete="off" placeholder="' + (rc.pass ? '••••••' : '') + '"></label></div>' +
      '<label class="fld"><span>' + esc(T('r_id')) + '</span><input name="id" autocapitalize="off" spellcheck="false" maxlength="8" value="' + esc(lan && S.status.devId ? S.status.devId : rc.id) + '"></label>' +
      '<div class="row"><button class="btn primary" type="submit">' + esc(T(lan ? 'r_save_both' : 'r_save')) + '</button>' +
      (rc.host ? '<button class="btn danger" type="button" data-action="remote-off">' + esc(T('r_off')) + '</button>' : '') + '</div></form>' +
      '<p class="muted" style="margin-top:10px">' + esc(T('r_hint')) + '</p></div>';

    if (online) {
      const pts = S.users.filter((u) => u.role === 'patient');
      h += '<div class="card"><h3>' + esc(T('set_device_ctl')) + '</h3>' +
        '<label class="fld"><span>' + esc(T('dev_owner')) + '</span><select data-change="dev-owner"><option value="">' + esc(T('dev_owner_auto')) + '</option>' +
        pts.map((p) => '<option value="' + esc(p.username) + '"' + (S.status.ownerPinned && S.status.owner === p.username ? ' selected' : '') + '>' + esc(p.name) + ' (@' + esc(p.username) + ')</option>').join('') + '</select></label>' +
        '<label class="fld"><span>' + esc(T('volume')) + ': <b id="v-vol">' + ds.volume + '</b>%</span><input type="range" min="0" max="100" value="' + ds.volume + '" data-change="dev-vol" data-input="dev-vol"></label>' +
        '<label class="fld"><span>' + esc(T('brightness')) + ': <b id="v-bri">' + ds.brightness + '</b>%</span><input type="range" min="0" max="100" value="' + ds.brightness + '" data-change="dev-bri" data-input="dev-bri"></label>' +
        '<label class="switch-row fld"><input type="checkbox" data-change="dev-mute"' + (ds.muted ? ' checked' : '') + '><span style="margin:0">' + esc(T('muted')) + '</span></label>' +
        '<label class="fld"><span>' + esc(T('test_box')) + '</span><select id="test-box">' + [1, 2, 3, 4].map((i) => '<option value="' + i + '">' + esc(T('box_n', { n: i })) + '</option>').join('') + '</select></label>' +
        '<div class="row">' + ['leds', 'due', 'taken', 'missed', 'reset'].map((a) => '<button class="btn sm" data-action="dev-test" data-test="' + a + '">' + esc(T('test_' + a)) + '</button>').join('') +
        '<button class="btn sm" data-action="dev-calibrate">' + esc(T('calibrate')) + '</button></div>' +
        '<p class="muted" style="margin-top:10px">' + esc(T('calibrate_hint')) + '</p></div>';
    } else {
      h += '<div class="card"><h3>' + esc(T('set_device_ctl')) + '</h3><p class="empty-note">' + esc(T('dev_need_online')) + '</p></div>';
    }

    h += '<div class="card"><h3>' + esc(T('set_password')) + '</h3><form class="row" data-form="password"><input class="grow" name="pw" type="password" autocomplete="new-password" placeholder="' + esc(T('f_newpass')) + '" required><button class="btn primary" type="submit">' + esc(T('btn_save')) + '</button></form></div>';

    h += '<div class="card"><h3>' + esc(T('set_backup')) + '</h3><div class="row"><button class="btn" data-action="export">' + esc(T('export')) + '</button><button class="btn" data-action="import">' + esc(T('import')) + '</button>' +
      '<input type="file" id="import-file" accept="application/json,.json" hidden data-change="import-file"></div></div>';

    h += '<div class="card"><h3>' + esc(T('set_danger')) + '</h3><div class="row"><button class="btn danger" data-action="clear-local">' + esc(T('clear_local')) + '</button><button class="btn" data-action="logout">' + esc(T('logout')) + '</button></div></div>';
    el.innerHTML = h;
  };

  P.saveEsp = async function (form) {
    const url = form.elements.url.value.trim();
    S.setEspUrl(url);
    NB.toast('...', 'info');
    const c = await S.detect();
    NB.toast(T(c === 'online' ? 'esp_ok' : 'esp_fail'), c === 'online' ? 'ok' : 'err');
    if (c === 'online') { S.pullUsers(); S.pullReports(); }
    P.renderSettings(); NB.emit('conn');
  };

  // remote access: browser side (MQTT over WSS) + box side (MQTT over TLS) when the page is on the LAN
  P.saveRemote = async function (form) {
    const f = form.elements; const old = S.remoteCfg();
    const cfg = {
      host: f.host.value.trim().replace(/^[a-z]+:\/\//i, '').replace(/[:/].*$/, ''),
      port: parseInt(f.port.value, 10) || 8884,
      user: f.user.value.trim(),
      pass: f.pass.value || old.pass || '',
      id: f.id.value.trim().toLowerCase(),
    };
    if (!cfg.host || !/^[0-9a-f]{8}$/.test(cfg.id)) { NB.toast(T('r_err'), 'err'); return; }
    S.setRemoteCfg(cfg);
    if (S.conn === 'online') {
      try {
        await S.api('/api/remote', { method: 'POST', body: { host: cfg.host, user: cfg.user, pass: f.pass.value, enabled: true } }, 6000);
        NB.toast(T('r_box_saved'), 'ok');
      } catch (e) { NB.toast(T('dev_fail') + ': ' + e.message, 'err'); }
    } else if (!S.remoteConnect()) NB.toast(T('r_no_mqtt'), 'err');
    else NB.toast(T('saved'), 'ok');
    P.renderSettings();
  };

  P.remoteOff = async function () {
    S.setRemoteCfg({}); S.remoteDisconnect();
    if (S.conn === 'online') { try { await S.api('/api/remote', { method: 'POST', body: { host: '', enabled: false } }, 6000); } catch (e) { /* ignore */ } }
    NB.toast(T('saved'), 'ok'); P.renderSettings(); NB.emit('conn');
  };

  P.changePassword = function (form) {
    const me = NB.auth.me(); const pw = form.elements.pw.value;
    if (!me) return;
    if (pw.length < 4 || pw.length > 64) { NB.toast(T('err_password'), 'err'); return; }
    me.pass = pw; S.saveUsers(); form.reset(); NB.toast(T('pw_changed'), 'ok');
  };

  P.devTest = async function (action) {
    try { await S.dev.test(action, parseInt(($('test-box') || {}).value, 10) || 1); NB.toast(T('dev_sent'), 'ok'); S.pullStatus(); }
    catch (e) { NB.toast(T('dev_fail') + ': ' + e.message, 'err'); }
  };

  P.devCalibrate = async function () {
    try { await S.dev.calibrate(); NB.toast(T('calibrated'), 'ok'); S.pullStatus(); }
    catch (e) { NB.toast(T('dev_fail') + ': ' + e.message, 'err'); }
  };

  P.devOwner = async function (sel) {
    try { await S.dev.setOwner(sel.value); NB.toast(T('dev_saved'), 'ok'); S.pullStatus(); }
    catch (e) { NB.toast(T('dev_fail') + ': ' + e.message, 'err'); }
  };

  let slT = null;
  P.devSlider = function (kind, el, commit) {
    const lab = $(kind === 'vol' ? 'v-vol' : 'v-bri'); if (lab) lab.textContent = el.value;
    if (!commit) return;
    clearTimeout(slT);
    slT = setTimeout(() => {
      S.dev.saveSettings(kind === 'vol' ? { volume: +el.value } : { brightness: +el.value })
        .then(() => NB.toast(T('dev_saved'), 'ok')).catch((e) => NB.toast(T('dev_fail') + ': ' + e.message, 'err'));
    }, 200);
  };

  P.devMute = function (el) {
    S.dev.saveSettings({ muted: !!el.checked }).catch((e) => NB.toast(T('dev_fail') + ': ' + e.message, 'err'));
  };

  P.exportBackup = function () {
    const blob = new Blob([S.exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nurabox-backup-' + NB.todayStr() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  P.importBackup = function (input) {
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > 512 * 1024) { NB.toast(T('import_err'), 'err'); input.value = ''; return; }
    const rd = new FileReader();
    rd.onload = () => {
      if (!window.confirm(T('confirm_import'))) { input.value = ''; return; }
      const r = S.importBackup(String(rd.result));
      NB.toast(T(r.key), r.ok ? 'ok' : 'err');
      input.value = '';
      if (r.ok) NB.afterAuthChange();
    };
    rd.readAsText(f);
  };

  P.clearLocal = function () {
    if (!window.confirm(T('confirm_clear'))) return;
    NB.auth.logout(); S.clearLocal(); location.reload();
  };

  P.renderAll = function () {
    P.renderSchedule(); P.renderNetwork(); P.renderReports(); P.renderSettings();
  };
})();
