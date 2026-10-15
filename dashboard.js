/* Nura Box - dashboard.js : home page (boxes, timeline, next dose, chart) + local schedule engine */
(function () {
  'use strict';
  const NB = (window.NB = window.NB || {});
  const S = NB.store;
  const esc = NB.esc;
  const T = (k, v) => NB.T(k, v);
  NB.ui = NB.ui || { page: 'home', viewPatient: '' };

  const GRACE = 1800;                       // 30 min, same as firmware
  const RING_C = 2 * Math.PI * 20;
  const FRAC = { empty: 0, waiting: 0.25, due: 0.6, taken: 1, missed: 1, skipped: 0.5 };
  const bootDay = NB.todayStr();
  const bootSec = NB.secOfDay();

  const D = (NB.dash = {});
  let built = false, chart = null, lastSig = '';
  const $ = (id) => document.getElementById(id);

  function dueSec(t) {
    const m = /^(\d{2}):(\d{2})$/.exec(t || '');
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 : -1;
  }

  // ---------- which patient is on screen ----------
  D.target = function () {
    const me = NB.auth.me();
    if (!me) return null;
    if (me.role === 'patient') return me;
    const list = S.patientsOf(me.username);
    let p = list.find((u) => u.username === NB.ui.viewPatient);
    if (!p) { p = list[0] || null; NB.ui.viewPatient = p ? p.username : ''; }
    return p;
  };

  D.isLive = (user) => !!(user && (S.conn === 'online' || S.conn === 'remote') && S.status && S.status.boxes && S.status.owner === user.username);

  // ---------- state of one box ----------
  D.boxView = function (user, i) {
    const med = (user.meds || {})[String(i)];
    const v = { box: i, name: med ? med.name : '', time: med ? med.time : '', state: 'empty', live: false, open: false, ldr: null, needLog: false };
    if (!med) return v;
    if (D.isLive(user)) {
      const b = S.status.boxes[i - 1] || {};
      v.live = true; v.open = !!b.open; v.ldr = b.ldr;
      v.state = b.state && b.state !== 'empty' ? b.state : 'waiting';
      return v;
    }
    const today = NB.todayStr();
    const rec = S.doses(user.username, today).filter((r) => r.box === i).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    if (rec) { v.state = rec.status === 'taken' ? 'taken' : 'missed'; return v; }
    const d = dueSec(med.time), now = NB.secOfDay(), end = Math.min(d + GRACE, 86399);
    if (d < 0) { v.state = 'empty'; return v; }
    if (now < d) v.state = 'waiting';
    else if (now < end) v.state = 'due';
    else if (end <= (today === bootDay ? bootSec : 0)) v.state = 'skipped';   // window passed before this page opened: never log a false miss
    else { v.state = 'missed'; v.needLog = true; }
    return v;
  };

  D.views = (user) => [1, 2, 3, 4].map((i) => D.boxView(user, i));

  // local mode only: log a miss when the window ends while this page is open
  D.localTick = function () {
    const me = NB.auth.me();
    if (!me || me.role !== 'patient' || D.isLive(me)) return;
    D.views(me).forEach((v) => {
      if (v.needLog) S.addReport({ kind: 'dose', user: me.username, box: v.box, med: v.name, status: 'missed', source: 'web' });
    });
  };

  D.take = function (box) {
    const me = NB.auth.me();
    if (!me || me.role !== 'patient' || D.isLive(me)) return;
    const v = D.boxView(me, box);
    if (v.state !== 'due') return;
    S.addReport({ kind: 'dose', user: me.username, box, med: v.name, status: 'taken', source: 'web' });
    NB.toast(T('dose_logged'), 'ok');
  };

  // ---------- numbers ----------
  D.adherence = function (user) {
    const out = [];
    const loc = NB.lang() === 'ar' ? 'ar-EG' : 'en-US';
    for (let k = 6; k >= 0; k--) {
      const d = new Date(); d.setDate(d.getDate() - k);
      const date = NB.todayStr(d);
      const rs = S.doses(user.username, date);
      const t = rs.filter((r) => r.status === 'taken').length;
      const m = rs.filter((r) => r.status === 'missed').length;
      out.push({ label: d.toLocaleDateString(loc, { weekday: 'short' }), pct: t + m ? Math.round((100 * t) / (t + m)) : null, t, m });
    }
    return out;
  };

  function nextInfo(views) {
    const now = NB.secOfDay();
    const cand = views.filter((v) => v.state === 'due' || v.state === 'waiting').sort((a, b) => dueSec(a.time) - dueSec(b.time));
    if (!cand.length) return null;
    const v = cand.find((x) => x.state === 'due') || cand[0];
    return { v, diff: dueSec(v.time) - now };
  }
  function fmtCd(s) {
    if (s < 0) s = 0;
    return NB.pad(Math.floor(s / 3600)) + ':' + NB.pad(Math.floor((s % 3600) / 60)) + ':' + NB.pad(s % 60);
  }

  // ---------- render ----------
  function build() {
    if (chart) { try { chart.destroy(); } catch (e) { /* ignore */ } chart = null; lastSig = ''; }
    $('page-home').innerHTML =
      '<div id="h-picker"></div><div class="hero" id="h-hero"></div>' +
      '<div class="grid4" id="h-kpis" style="margin-bottom:16px"></div>' +
      '<div class="card" id="h-next"></div><div class="boxes" id="h-boxes"></div>' +
      '<div class="grid2"><div class="card"><h3 data-i18n="timeline"></h3><ul class="timeline" id="h-tl"></ul></div>' +
      '<div class="card"><h3 data-i18n="chart_title"></h3><div class="chart-box"><canvas id="h-chart"></canvas></div><div class="fallback-bars" id="h-bars" hidden></div><p class="empty-note" id="h-chart-empty" hidden data-i18n="chart_empty"></p></div></div>';
    NB.applyI18n($('page-home'));
    built = true;
  }

  function drawChart(adh) {
    const sig = NB.lang() + JSON.stringify(adh.map((a) => [a.label, a.pct]));
    if (sig === lastSig) return;
    lastSig = sig;
    const cv = $('h-chart'), bars = $('h-bars');
    const has = adh.some((a) => a.pct !== null);
    $('h-chart-empty').hidden = has;
    if (window.Chart) {
      cv.hidden = false; bars.hidden = true;
      if (!chart) {
        chart = new window.Chart(cv, {
          type: 'line',
          data: { labels: [], datasets: [{ label: '%', data: [], borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.15)', fill: true, tension: 0.35, spanGaps: false, pointRadius: 4, pointBackgroundColor: '#38bdf8' }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } } },
        });
      }
      chart.data.labels = adh.map((a) => a.label);
      chart.data.datasets[0].data = adh.map((a) => a.pct);
      chart.update();
    } else {
      // Chart.js failed to load (offline): simple CSS bars
      cv.hidden = true; bars.hidden = false;
      bars.innerHTML = adh.map((a) => '<div><i style="height:' + (a.pct || 0) * 1.7 + 'px"></i>' + (a.pct === null ? '-' : a.pct + '%') + '<br>' + esc(a.label) + '</div>').join('');
    }
  }

  D.render = function () {
    if (!NB.auth.me()) return;
    if (!built || !$('h-hero')) build();
    const me = NB.auth.me();
    const user = D.target();

    // doctor: patient picker
    const pk = $('h-picker');
    if (me.role === 'doctor') {
      const list = S.patientsOf(me.username);
      pk.innerHTML = list.length
        ? '<div class="card"><label class="fld" style="margin:0"><span>' + esc(T('pick_patient')) + '</span><select data-change="pick-patient">' +
          list.map((p) => '<option value="' + esc(p.username) + '"' + (user && p.username === user.username ? ' selected' : '') + '>' + esc(p.name) + ' (@' + esc(p.username) + ')</option>').join('') + '</select></label></div>'
        : '';
    } else pk.innerHTML = '';

    if (!user) {
      $('h-hero').innerHTML = '<div><h2>' + esc(T('hello', { name: me.name })) + '</h2><p class="muted">' + esc(T('no_patients')) + '</p></div>';
      ['h-kpis', 'h-next', 'h-boxes', 'h-tl'].forEach((id) => { $(id).innerHTML = ''; });
      $('h-next').hidden = true;
      drawChart(D.adherence({ username: '' }));
      return;
    }
    $('h-next').hidden = false;

    const views = D.views(user);
    const active = views.filter((v) => v.state !== 'empty');
    const taken = views.filter((v) => v.state === 'taken').length;
    const missed = views.filter((v) => v.state === 'missed').length;
    const h = new Date().getHours();
    const greet = T(h < 12 ? 'greet_morning' : h < 18 ? 'greet_afternoon' : 'greet_evening', { name: user.name });
    const pct = active.length ? Math.round((100 * taken) / active.length) : 0;
    $('h-hero').innerHTML = '<div><h2>' + esc(greet) + '</h2><p class="muted">' + esc(T('progress_today', { t: taken, n: active.length })) + '</p></div>' +
      '<div class="prog"><small>' + pct + '%</small><div class="bar"><i style="width:' + pct + '%"></i></div></div>';

    const adh = D.adherence(user);
    const tt = adh.reduce((s, a) => s + a.t, 0), mm = adh.reduce((s, a) => s + a.m, 0);
    const live = D.isLive(user);
    const devVal = live ? esc(S.status.synced ? S.status.time : T('not_synced')) : '&mdash;';
    const devSub = live ? 'RSSI ' + esc(S.status.rssi) + ' dBm' : esc(T(S.conn === 'online' || S.conn === 'remote' ? 'dev_other_owner' : 'conn_local'));
    $('h-kpis').innerHTML =
      '<div class="kpi"><small>' + esc(T('kpi_today')) + '</small><b>' + taken + '/' + active.length + '</b></div>' +
      '<div class="kpi"><small>' + esc(T('kpi_adherence')) + '</small><b>' + (tt + mm ? Math.round((100 * tt) / (tt + mm)) + '%' : '&mdash;') + '</b></div>' +
      '<div class="kpi"><small>' + esc(T('kpi_boxes')) + '</small><b>' + active.length + '/4</b>' + (missed ? '<small>' + esc(T('st_missed')) + ': ' + missed + '</small>' : '') + '</div>' +
      '<div class="kpi"><small>' + esc(T('kpi_device')) + '</small><b style="font-size:19px">' + devVal + '</b><small>' + devSub + '</small></div>';

    const nx = nextInfo(views);
    $('h-next').innerHTML = nx
      ? '<div class="next"><div><small>' + esc(T('next_dose')) + '</small><h3 style="margin:2px 0 0">' + esc(nx.v.name) + ' &middot; ' + esc(nx.v.time) + '</h3></div><div class="cd" id="h-cd">' + (nx.v.state === 'due' ? esc(T('due_now')) : fmtCd(nx.diff)) + '</div></div>'
      : '<div class="next"><div><small>' + esc(T('next_dose')) + '</small><h3 style="margin:2px 0 0">' + esc(T('next_none')) + '</h3></div></div>';

    const canTake = me.role === 'patient' && !live;
    $('h-boxes').innerHTML = views.map((v) => {
      const off = (RING_C * (1 - (FRAC[v.state] || 0))).toFixed(1);
      return '<article class="box s-' + v.state + '"><div class="ring"><svg viewBox="0 0 48 48"><circle class="ring-bg" cx="24" cy="24" r="20"/><circle class="ring-fg" cx="24" cy="24" r="20" stroke-dasharray="' + RING_C.toFixed(1) + '" stroke-dashoffset="' + off + '"/></svg><span class="ring-num">' + v.box + '</span></div>' +
        '<div class="box-body"><span class="badge">' + esc(T('st_' + v.state)) + '</span>' +
        (v.state === 'empty' ? '<h4 class="muted">' + esc(T('box_n', { n: v.box })) + '</h4>' : '<h4>' + esc(v.name) + '</h4><div class="time">' + esc(v.time) + '</div>') +
        (v.live ? '<div class="lid">' + esc(T(v.open ? 'lid_open' : 'lid_closed')) + ' &middot; LDR ' + esc(v.ldr) + '</div>' : '') +
        (canTake && v.state === 'due' ? '<button class="btn primary sm" style="margin-top:8px" data-action="take" data-box="' + v.box + '">' + esc(T('btn_take')) + '</button>' : '') +
        '</div></article>';
    }).join('');

    const tl = active.slice().sort((a, b) => dueSec(a.time) - dueSec(b.time));
    $('h-tl').innerHTML = tl.length
      ? tl.map((v) => '<li class="t-' + v.state + '"><span>' + esc(v.time) + ' &middot; ' + esc(v.name) + '</span><small>' + esc(T('st_' + v.state)) + '</small></li>').join('')
      : '<li class="muted">' + esc(T('timeline_empty')) + '</li>';

    drawChart(adh);
  };

  // once per second: countdown text only (no full re-render)
  D.tick = function () {
    D.localTick();
    const el = $('h-cd');
    const user = D.target();
    if (!el || !user) return;
    const nx = nextInfo(D.views(user));
    if (nx) el.textContent = nx.v.state === 'due' ? T('due_now') : fmtCd(nx.diff);
  };

  D.reset = () => { built = false; };
})();
