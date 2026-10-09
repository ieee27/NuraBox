/* =========================================================
   APP.JS - منطق الواجهة الأمامية (Frontend Logic)
   كل تفاعلات المستخدم هنا: عرض، نقرات، تحديث DOM
   ========================================================= */

const App = (() => {
  // ============ STATE ============
  let currentUser = null;
  let activePatientData = null;
  let currentLang = localStorage.getItem('nura_lang') || 'ar';
  let currentTheme = localStorage.getItem('nura_theme') || 'dark';
  let notifOpen = false;

  // ============ INIT ============
  function init() {
    // Apply theme and lang
    document.documentElement.setAttribute('data-theme', currentTheme);
    document.documentElement.setAttribute('dir', currentLang === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.lang = currentLang;
    updateDateDisplay();
    buildBoxesGrid();
    initChart();

    // ESP32 input
    document.getElementById('esp-ip-input').value = Api.esp32.getIp();

    // Try auto-login
    if (Api.getToken()) {
      Api.auth.me()
        .then(({ user }) => {
          currentUser = user;
          openApp();
        })
        .catch(() => {
          Api.setToken(null);
        });
    }

    // Local clock
    setInterval(() => {
      if (!Api.esp32.isEnabled() || !Api.esp32.isConnected()) {
        const el = document.getElementById('rtc-time');
        if (el) el.innerText = new Date().toTimeString().substring(0, 5);
      }
    }, 1000);

    // Poll ESP32 (لو مفعّل)
    setInterval(() => {
      if (Api.esp32.isEnabled() && currentUser?.role === 'patient') {
        syncFromEsp32();
      }
    }, 5000);
  }

  // ============ LANDING / AUTH ============
  function goToAuth() {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('auth-overlay').classList.remove('hidden');
  }
  function backToLanding() {
    document.getElementById('auth-overlay').classList.add('hidden');
    document.getElementById('landing-page').classList.remove('hidden');
  }
  function toggleAuthMode(mode) {
    document.getElementById('btn-tab-login').classList.toggle('active', mode === 'login');
    document.getElementById('btn-tab-register').classList.toggle('active', mode === 'register');
    document.getElementById('form-login').style.display = mode === 'login' ? 'block' : 'none';
    document.getElementById('form-register').style.display = mode === 'register' ? 'block' : 'none';
  }

  async function handleRegister(e) {
    e.preventDefault();
    try {
      const { token, user } = await Api.auth.register({
        fullname: document.getElementById('reg-fullname').value,
        age: Number(document.getElementById('reg-age').value),
        role: document.getElementById('reg-role').value,
        username: document.getElementById('reg-username').value.trim(),
        password: document.getElementById('reg-password').value,
      });
      Api.setToken(token);
      currentUser = user;
      alert('✅ تم إنشاء الحساب!');
      openApp();
    } catch (err) { alert('❌ ' + err.message); }
  }

  async function handleLogin(e) {
    e.preventDefault();
    try {
      const { token, user } = await Api.auth.login({
        username: document.getElementById('login-username').value.trim(),
        password: document.getElementById('login-password').value,
      });
      Api.setToken(token);
      currentUser = user;
      openApp();
    } catch (err) { alert('❌ ' + err.message); }
  }

  async function openApp() {
    document.getElementById('auth-overlay').classList.add('hidden');
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('app-header').style.display = 'flex';
    document.getElementById('app-container').style.display = 'block';
    document.getElementById('app-bottom-nav').style.display = 'flex';

    // Socket connection with handlers
    Api.connectSocket({
      onNotification: (n) => {
        if (!currentUser.notifications) currentUser.notifications = [];
        currentUser.notifications.unshift(n);
        updateNotificationsUI();
      },
      onMedicineUpdate: () => loadPatientMedsToUI(),
      onMedicineTaken: () => loadPatientMedsToUI(),
    });

    await initUserDashboard();
  }

  function logout() {
    if (!confirm('تسجيل الخروج؟')) return;
    Api.setToken(null);
    Api.disconnectSocket();
    currentUser = null;
    activePatientData = null;
    location.reload();
  }

  function resetData() {
    if (!confirm('مسح كافة البيانات المحلية؟ (لن يمس السيرفر)')) return;
    localStorage.clear();
    location.reload();
  }

  // ============ THEME / LANGUAGE ============
  function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    document.getElementById('theme-icon').innerText = currentTheme === 'dark' ? '🌙' : '☀';
    document.getElementById('stg-theme-switch').checked = currentTheme === 'dark';
    localStorage.setItem('nura_theme', currentTheme);
  }

  function toggleLanguage() {
    currentLang = currentLang === 'ar' ? 'en' : 'ar';
    document.documentElement.lang = currentLang;
    document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('lang-label').innerText = currentLang === 'ar' ? 'EN' : 'عربي';
    document.getElementById('stg-lang-text').innerText = currentLang === 'ar' ? 'العربية 🌐' : 'English 🌐';
    localStorage.setItem('nura_lang', currentLang);
    updateDateDisplay();
  }

  function updateDateDisplay() {
    const el = document.getElementById('current-date-display');
    if (!el) return;
    const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    el.innerText = new Date().toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US', opts);
  }

  // ============ NOTIFICATIONS ============
  function toggleNotifDropdown() {
    notifOpen = !notifOpen;
    document.getElementById('notif-dropdown').classList.toggle('show', notifOpen);
  }

  function updateNotificationsUI() {
    if (!currentUser?.notifications) return;
    const list = currentUser.notifications;
    document.getElementById('notif-count').innerText = list.length;
    const container = document.getElementById('notif-items-container');
    if (!list.length) {
      container.innerHTML = '<div class="notif-item">لا توجد إشعارات</div>';
      return;
    }
    container.innerHTML = list.map(n => `<div class="notif-item">🔔 ${n.text}</div>`).join('');
  }

  // ============ PAGE NAVIGATION ============
  function switchPage(pageId, navBtn) {
    document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('page-' + pageId).classList.add('active');
    if (navBtn) navBtn.classList.add('active');
  }

  // ============ USER DASHBOARD INIT ============
  async function initUserDashboard() {
    document.getElementById('user-display').innerText = currentUser.fullname;
    document.getElementById('stg-avatar-letter').innerText = currentUser.fullname.charAt(0);
    document.getElementById('stg-display-name').innerText = currentUser.fullname;
    document.getElementById('stg-username-text').innerText = `@${currentUser.username}`;
    document.getElementById('stg-role-badge').innerText = currentUser.role === 'doctor' ? 'حساب طبيب' : 'حساب مريض';
    updateNotificationsUI();

    if (currentUser.role === 'doctor') {
      document.getElementById('doctor-network-section').style.display = 'block';
      document.getElementById('patient-network-section').style.display = 'none';
      document.getElementById('patient-report-form').style.display = 'none';
      document.getElementById('doctor-report-review').style.display = 'block';
      await renderDoctorPatients();
      await renderDoctorReportsReview();
    } else {
      document.getElementById('doctor-network-section').style.display = 'none';
      document.getElementById('patient-network-section').style.display = 'block';
      document.getElementById('patient-report-form').style.display = 'block';
      document.getElementById('doctor-report-review').style.display = 'none';
      activePatientData = currentUser;
      await loadPatientMedsToUI();
      await renderPatientReportsHistory();
      await renderSchedulesUI();
      await renderPatientRequests();
      await renderPatientDoctors();
    }
    await updateNetworkStats();

    if (Api.esp32.isEnabled()) {
      const ok = await Api.esp32.testConnection();
      updateEspStatusUI(ok);
    }
  }

  // ============ MEDICINES / BOXES ============
  function buildBoxesGrid() {
    const grid = document.getElementById('boxes-grid');
    grid.innerHTML = '';
    for (let i = 1; i <= 4; i++) {
      grid.insertAdjacentHTML('beforeend', `
        <div class="box-card empty" id="box-${i}">
          <div class="box-top">
            <span class="box-title">📦 الخانة 0${i}</span>
            <span class="box-badge" id="badge-${i}">فارغ</span>
          </div>
          <div class="medicine-name" id="med-name-${i}">--</div>
          <div class="medicine-time" id="med-time-${i}">⏰ --:--</div>
          <button class="btn-take-dose" id="btn-dose-${i}" onclick="App.markDoseTaken(${i})">تأكيد أخذ الجرعة ✅</button>
        </div>
      `);
    }
  }

  async function loadPatientMedsToUI() {
    if (!activePatientData) return;
    let meds = [];
    try {
      meds = await Api.medicines.list(activePatientData.id !== currentUser.id ? activePatientData.id : undefined);
    } catch { meds = []; }

    activePatientData.meds = {};
    meds.forEach(m => activePatientData.meds[m.box] = m);

    let total = 0, taken = 0, nextTime = '--:--';
    for (let i = 1; i <= 4; i++) {
      const med = activePatientData.meds[i];
      const boxCard = document.getElementById(`box-${i}`);
      const nameEl = document.getElementById(`med-name-${i}`);
      const timeEl = document.getElementById(`med-time-${i}`);
      const badge = document.getElementById(`badge-${i}`);
      const btn = document.getElementById(`btn-dose-${i}`);

      if (med && med.name) {
        total++;
        nameEl.innerText = med.name;
        timeEl.innerText = `⏰ ${med.time || '--:--'}`;
        btn.style.display = 'block';
        if (med.taken) {
          taken++;
          boxCard.className = 'box-card taken';
          badge.innerText = 'تم الأخذ ✅';
          btn.className = 'btn-take-dose done';
          btn.innerText = 'تم أخذ الجرعة ✨';
          btn.disabled = true;
        } else {
          boxCard.className = 'box-card waiting';
          badge.innerText = 'في الانتظار';
          btn.className = 'btn-take-dose';
          btn.innerText = 'تأكيد أخذ الجرعة ✅';
          btn.disabled = false;
          if (nextTime === '--:--') nextTime = med.time;
        }
      } else {
        nameEl.innerText = '--';
        timeEl.innerText = '⏰ --:--';
        boxCard.className = 'box-card empty';
        badge.innerText = 'فارغ';
        btn.style.display = 'none';
      }
    }
    const rate = total ? Math.round((taken / total) * 100) : 0;
    document.getElementById('kpi-rate').innerText = `${rate}%`;
    document.getElementById('kpi-bar-fill').style.width = `${rate}%`;
    document.getElementById('next-dose-val').innerText = nextTime;
  }

  async function markDoseTaken(boxId) {
    try {
      await Api.medicines.markTaken(boxId);
      if (Api.esp32.isEnabled() && Api.esp32.isConnected()) {
        await Api.esp32.markTaken(boxId);
      }
      await loadPatientMedsToUI();
    } catch (err) { alert('❌ ' + err.message); }
  }

  // ============ SCHEDULES ============
  async function renderSchedulesUI() {
    if (!activePatientData) return;
    const container = document.getElementById('schedule-slots-container');
    container.innerHTML = '';

    let meds = [];
    try { meds = await Api.medicines.list(activePatientData.id !== currentUser.id ? activePatientData.id : undefined); } catch {}
    const byBox = {};
    meds.forEach(m => byBox[m.box] = m);

    let activeCount = 0, nextTime = '--:--';
    for (let i = 1; i <= 4; i++) {
      const med = byBox[i];
      const isSet = med && med.name;
      if (isSet) {
        activeCount++;
        if (nextTime === '--:--' && !med.taken) nextTime = med.time;
      }
      container.insertAdjacentHTML('beforeend', `
        <div class="sched-list-card ${isSet ? 'active-slot' : 'empty-slot'}">
          <div class="sched-info-main">
            <h4>📦 الخانة 0${i}: ${isSet ? med.name : 'غير مبرمجة'}</h4>
            <p>⏰ ${isSet ? med.time : '--:--'} • ${isSet ? (med.pills || 1) + ' قرص' : '--'}</p>
            ${isSet ? `<span class="sched-pill-tag">🔄 ${med.repeat || 'يومياً'}</span>` : ''}
          </div>
          <div class="sched-actions">
            <button class="btn-sched-action" onclick="App.selectBoxForEdit(${i})">✏️ تعديل</button>
            ${isSet ? `<button class="btn-sched-action btn-sched-del" onclick="App.clearBoxDirect(${i})">🗑</button>` : ''}
          </div>
        </div>
      `);
    }
    document.getElementById('sched-active-cnt').innerText = `${activeCount}/4`;
    document.getElementById('sched-next-time').innerText = nextTime;
    loadSelectedToForm();
  }

  function selectBoxForEdit(boxId) {
    document.getElementById('sched-box').value = boxId;
    loadSelectedToForm();
    document.getElementById('schedule-form-card').scrollIntoView({ behavior: 'smooth' });
  }

  function loadSelectedToForm() {
    const boxId = document.getElementById('sched-box').value;
    const med = activePatientData?.meds?.[boxId];
    if (med && med.name) {
      document.getElementById('sched-name').value = med.name;
      document.getElementById('sched-time').value = med.time;
      document.getElementById('sched-pills-count').value = med.pills || 1;
      document.getElementById('sched-repeat').value = med.repeat || 'يومياً';
    } else {
      document.getElementById('sched-name').value = '';
      document.getElementById('sched-time').value = '';
      document.getElementById('sched-pills-count').value = 1;
      document.getElementById('sched-repeat').value = 'يومياً';
    }
  }

  async function saveSchedule(e) {
    e.preventDefault();
    const payload = {
      box: Number(document.getElementById('sched-box').value),
      name: document.getElementById('sched-name').value.trim(),
      time: document.getElementById('sched-time').value,
      pills: Number(document.getElementById('sched-pills-count').value),
      repeat: document.getElementById('sched-repeat').value,
    };
    try {
      await Api.medicines.save(payload);
      if (Api.esp32.isEnabled() && Api.esp32.isConnected()) {
        await Api.esp32.saveMedicine(payload);
      }
      alert('✅ تم الحفظ');
      await renderSchedulesUI();
      await loadPatientMedsToUI();
    } catch (err) { alert('❌ ' + err.message); }
  }

  function clearSelectedBox() {
    clearBoxDirect(document.getElementById('sched-box').value);
  }

  async function clearBoxDirect(boxId) {
    if (!confirm(`تفريغ الخانة 0${boxId}؟`)) return;
    try {
      await Api.medicines.clear(boxId);
      if (Api.esp32.isEnabled() && Api.esp32.isConnected()) {
        await Api.esp32.clearMedicine(boxId);
      }
      await renderSchedulesUI();
      await loadPatientMedsToUI();
    } catch (err) { alert('❌ ' + err.message); }
  }

  // ============ REPORTS ============
  async function submitWeeklyReport(e) {
    e.preventDefault();
    try {
      await Api.reports.create({
        status: document.getElementById('report-health-status').value,
        problemMed: document.getElementById('report-problem-med').value,
        symptoms: document.getElementById('report-symptoms').value,
        notes: document.getElementById('report-notes').value,
      });
      alert('✅ تم إرسال التقرير');
      document.getElementById('report-symptoms').value = '';
      document.getElementById('report-notes').value = '';
      await renderPatientReportsHistory();
    } catch (err) { alert('❌ ' + err.message); }
  }

  async function renderPatientReportsHistory() {
    const container = document.getElementById('patient-report-history');
    let reports = [];
    try { reports = await Api.reports.my(); } catch {}
    if (!reports.length) {
      container.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">لا توجد تقارير.</p>';
      return;
    }
    container.innerHTML = reports.map(r => `
      <div class="report-history-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span style="font-size:13px;font-weight:800;color:var(--accent-blue);">📅 ${new Date(r.createdAt).toLocaleDateString('ar-EG')}</span>
          <span class="report-status-badge ${r.reviewed ? 'rep-badge-reviewed' : 'rep-badge-pending'}">
            ${r.reviewed ? 'تمت المراجعة ✅' : 'قيد المراجعة ⏳'}
          </span>
        </div>
        <div style="font-size:13px;line-height:1.6;">
          <div><strong>الحالة:</strong> ${r.status}</div>
          <div>⚠️ <strong>مشكلة:</strong> ${r.problemMed}</div>
          <div>🤒 <strong>أعراض:</strong> ${r.symptoms}</div>
          ${r.notes ? `<div>💬 ${r.notes}</div>` : ''}
        </div>
        ${r.doctorNote ? `<div class="doc-reply-box"><strong>🩺 توصية الطبيب:</strong> ${r.doctorNote}</div>` : ''}
      </div>
    `).join('');
  }

  async function renderDoctorReportsReview() {
    const container = document.getElementById('reports-list-container');
    let reports = [];
    try { reports = await Api.reports.doctor(); } catch {}
    if (!reports.length) {
      container.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">لا توجد تقارير.</p>';
      return;
    }
    container.innerHTML = reports.map(r => `
      <div class="net-card">
        <div style="border-bottom:1px solid var(--card-border);padding-bottom:10px;display:flex;justify-content:space-between;">
          <strong>👤 ${r.patientName || 'مريض'}</strong>
          <span style="color:var(--accent-blue);font-size:12px;">📅 ${new Date(r.createdAt).toLocaleDateString('ar-EG')}</span>
        </div>
        <div style="font-size:13px;line-height:1.6;">
          <div><strong>الحالة:</strong> ${r.status}</div>
          <div>⚠️ ${r.problemMed}</div>
          <div>🤒 ${r.symptoms}</div>
        </div>
        <div style="margin-top:10px;">
          <textarea id="reply-input-${r.id}" class="form-control" rows="2" placeholder="اكتب توصيتك...">${r.doctorNote || ''}</textarea>
          <button onclick="App.saveDoctorFeedback('${r.id}')" class="btn-action" style="padding:8px;font-size:13px;margin-top:8px;">إرسال التوصية 💬</button>
        </div>
      </div>
    `).join('');
  }

  async function saveDoctorFeedback(reportId) {
    const note = document.getElementById(`reply-input-${reportId}`).value.trim();
    if (!note) return alert('اكتب توصية');
    try {
      await Api.reports.addNote(reportId, note);
      alert('✅ تم الإرسال');
      await renderDoctorReportsReview();
    } catch (err) { alert('❌ ' + err.message); }
  }

  // ============ NETWORK ============
  async function updateNetworkStats() {
    if (currentUser.role === 'doctor') {
      try {
        const patients = await Api.network.myPatients();
        document.getElementById('net-count-linked').innerText = patients.length;
        document.getElementById('net-label-linked').innerText = 'مرضى مضافون';
      } catch {}
    } else {
      try {
        const doctors = await Api.network.myDoctors();
        document.getElementById('net-count-linked').innerText = doctors.length;
        document.getElementById('net-label-linked').innerText = 'أطباء متابعون';
        const reqs = await Api.network.pendingRequests();
        document.getElementById('net-count-pending').innerText = reqs.length;
      } catch {}
    }
  }

  async function sendPatientRequest(e) {
    e.preventDefault();
    const username = document.getElementById('target-patient-username').value.trim();
    try {
      await Api.network.sendRequest(username);
      alert('✅ تم إرسال الطلب');
      document.getElementById('target-patient-username').value = '';
      await updateNetworkStats();
    } catch (err) { alert('❌ ' + err.message); }
  }

  async function renderDoctorPatients() {
    const list = document.getElementById('doctor-patients-list');
    let patients = [];
    try { patients = await Api.network.myPatients(); } catch {}
    if (!patients.length) {
      list.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">لا يوجد مرضى.</p>';
      return;
    }
    list.innerHTML = patients.map(p => `
      <div class="net-card">
        <div class="net-card-header">
          <div class="net-user-info">
            <div class="net-avatar">${(p.patient?.fullname || '؟').charAt(0)}</div>
            <div class="net-user-details">
              <h4>${p.patient?.fullname || 'مريض'}</h4>
              <p>@${p.patient?.username || '--'} • ${p.patient?.age || '--'} سنة</p>
            </div>
          </div>
          <span class="net-status-badge status-active">مربوط</span>
        </div>
        <div class="net-actions">
          <button onclick="App.inspectPatient('${p.patientId}')" class="net-btn btn-primary-net">📊 التحكم</button>
          <button onclick="App.unlinkPatient('${p.id}')" class="net-btn btn-danger-net">إلغاء الربط</button>
        </div>
      </div>
    `).join('');
  }

  async function renderPatientDoctors() {
    const list = document.getElementById('patient-doctors-list');
    let doctors = [];
    try { doctors = await Api.network.myDoctors(); } catch {}
    if (!doctors.length) {
      list.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">لا يوجد أطباء.</p>';
      return;
    }
    list.innerHTML = doctors.map(d => `
      <div class="net-card">
        <div class="net-card-header">
          <div class="net-user-info">
            <div class="net-avatar" style="background:linear-gradient(135deg,#10b981,#0284c7);">د</div>
            <div class="net-user-details">
              <h4>د. ${d.doctor?.fullname || '--'}</h4>
              <p>طبيب معالج</p>
            </div>
          </div>
          <span class="net-status-badge status-active">نشط</span>
        </div>
        <div class="net-actions">
          <button onclick="App.unlinkPatient('${d.id}')" class="net-btn btn-danger-net">إلغاء الربط</button>
        </div>
      </div>
    `).join('');
  }

  async function renderPatientRequests() {
    const list = document.getElementById('patient-requests-list');
    let requests = [];
    try { requests = await Api.network.pendingRequests(); } catch {}
    if (!requests.length) {
      list.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">لا توجد طلبات.</p>';
      return;
    }
    list.innerHTML = requests.map(r => `
      <div class="net-card">
        <div class="net-card-header">
          <div class="net-user-info">
            <div class="net-avatar">🩺</div>
            <div class="net-user-details">
              <h4>د. ${r.doctor?.fullname || '--'}</h4>
              <p>طلب انضمام</p>
            </div>
          </div>
          <span class="net-status-badge status-pending">جديد</span>
        </div>
        <div class="net-actions">
          <button onclick="App.respondRequest('${r.id}','accept')" class="net-btn btn-primary-net">قبول</button>
          <button onclick="App.respondRequest('${r.id}','reject')" class="net-btn btn-danger-net">رفض</button>
        </div>
      </div>
    `).join('');
  }

  async function respondRequest(id, action) {
    try {
      await Api.network.respond(id, action);
      await renderPatientRequests();
      await renderPatientDoctors();
      await updateNetworkStats();
    } catch (err) { alert('❌ ' + err.message); }
  }

  async function unlinkPatient(linkId) {
    if (!confirm('إلغاء الربط؟')) return;
    try {
      await Api.network.removeLink(linkId);
      await renderDoctorPatients();
      await renderPatientDoctors();
      await updateNetworkStats();
    } catch (err) { alert('❌ ' + err.message); }
  }

  async function inspectPatient(patientId) {
    try {
      const { user } = await Api.request(`/auth/users/${patientId}`).catch(() => ({}));
      // لو ما عندك endpoint، احفظ بيانات المريض من الطلبات السابقة
      activePatientData = { id: patientId, fullname: 'المريض' };
      document.getElementById('patient-view-header').style.display = 'block';
      document.getElementById('viewing-patient-name').innerText = user?.fullname || patientId;
      await loadPatientMedsToUI();
      await renderSchedulesUI();
      switchPage('dashboard', document.querySelectorAll('.nav-item')[0]);
    } catch (err) { alert('❌ ' + err.message); }
  }

  // ============ SETTINGS ============
  async function changePassword(e) {
    e.preventDefault();
    const pass = document.getElementById('stg-new-pass').value;
    if (!pass) return;
    try {
      await Api.auth.updatePassword(pass);
      alert('✅ تم التغيير');
      document.getElementById('stg-new-pass').value = '';
    } catch (err) { alert('❌ ' + err.message); }
  }

  // ============ ESP32 HELPERS ============
  async function syncFromEsp32() {
    if (!Api.esp32.isEnabled() || !currentUser) return;
    const data = await Api.esp32.call('/api/status');
    if (!data) { updateEspStatusUI(false); return; }
    updateEspStatusUI(true);
    if (data.currentTime) {
      const el = document.getElementById('rtc-time');
      if (el) el.innerText = data.currentTime;
    }
    if (data.nextDose) {
      const el = document.getElementById('next-dose-val');
      if (el) el.innerText = data.nextDose;
    }
    if (data.compartments && activePatientData?.meds) {
      data.compartments.forEach((c, i) => {
        const box = i + 1;
        if (activePatientData.meds[box] && c.status === 'TAKEN') {
          activePatientData.meds[box].taken = true;
        }
      });
      loadPatientMedsToUI();
    }
  }

  function updateEspStatusUI(connected) {
    const el = document.getElementById('esp-status');
    if (!el) return;
    el.className = 'esp-status ' + (connected ? 'connected' : 'disconnected');
    el.innerText = connected ? '✅ متصل' : '❌ غير متصل';
    const pulse = document.getElementById('hw-pulse');
    const text = document.getElementById('hw-status-text');
    if (pulse) pulse.className = 'pulse-dot' + (connected ? '' : ' offline');
    if (text) text.innerText = connected
      ? 'العلبة الذكية متصلة (ESP32-WiFi)'
      : 'العلبة الذكية غير متصلة (وضع محلي)';
  }

  async function saveEspIp() {
    const ip = document.getElementById('esp-ip-input').value.trim();
    if (!ip) return alert('ادخل IP صحيح');
    Api.esp32.setIp(ip);
    alert('✅ تم حفظ IP: ' + ip);
    const ok = await Api.esp32.testConnection();
    updateEspStatusUI(ok);
  }

  async function testEspConnection() {
    const el = document.getElementById('esp-status');
    el.className = 'esp-status disconnected';
    el.innerText = 'جاري الاختبار...';
    const ok = await Api.esp32.testConnection();
    updateEspStatusUI(ok);
  }

  async function triggerBuzzerTest() {
    if (Api.esp32.isEnabled() && Api.esp32.isConnected()) {
      await Api.esp32.triggerBuzzer();
      alert('🔊 تم إرسال أمر التنبيه!');
      return;
    }
    alert('🔊 اختبار محلي (ESP32 غير متصل)');
  }

  async function syncHardwareTime() {
    if (Api.esp32.isEnabled() && Api.esp32.isConnected()) {
      await Api.esp32.syncTime();
      alert('⏱️ تمت المزامنة!');
      return;
    }
    alert('⏱️ مزامنة محلية');
  }

  // ============ CHART ============
  let chartInstance = null;
  function initChart() {
    const ctx = document.getElementById('adherenceChart')?.getContext('2d');
    if (!ctx) return;
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الخميس', 'اليوم'],
        datasets: [{
          label: '% الالتزام',
          data: [80, 100, 90, 85, 95, 100],
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.12)',
          fill: true, tension: 0.4,
          pointRadius: 4, pointBackgroundColor: '#38bdf8'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 100 } }
      }
    });
  }

  // ============ PUBLIC API ============
  return {
    init,
    goToAuth, backToLanding, toggleAuthMode,
    handleLogin, handleRegister, logout, resetData,
    toggleTheme, toggleLanguage,
    toggleNotifDropdown, updateNotificationsUI,
    switchPage,
    markDoseTaken,
    selectBoxForEdit, loadSelectedToForm, saveSchedule, clearSelectedBox, clearBoxDirect,
    submitWeeklyReport, saveDoctorFeedback,
    sendPatientRequest, respondRequest, unlinkPatient, inspectPatient,
    changePassword,
    saveEspIp, testEspConnection, triggerBuzzerTest, syncHardwareTime,
  };
})();

// ============ BOOTSTRAP ============
window.addEventListener('load', App.init);