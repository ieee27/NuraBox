/* Nura Box - i18n.js : translations + T() */
(function () {
  'use strict';
  const NB = (window.NB = window.NB || {});

  const D = {
    ar: {
      app_name: 'Nura Box', tagline: 'علبة أدوية ذكية: تنبيه بمواعيد الدواء، تتبّع الالتزام، وربط مباشر مع الطبيب.',
      lang: 'اللغة', lang_name: 'EN', theme: 'المظهر', theme_dark: 'داكن', theme_light: 'فاتح', logout: 'تسجيل الخروج',
      tab_login: 'تسجيل الدخول', tab_register: 'حساب جديد', f_username: 'اسم المستخدم', f_password: 'كلمة السر', f_name: 'الاسم الكامل', f_role: 'نوع الحساب',
      role_patient: 'مريض', role_doctor: 'طبيب', btn_login: 'دخول', btn_register: 'إنشاء الحساب', show_pw: 'إظهار/إخفاء كلمة السر',
      pw_weak: 'ضعيفة', pw_ok: 'متوسطة', pw_strong: 'قوية', demo_title: 'دخول تجريبي سريع (يُحذف قبل النشر)',
      err_login: 'اسم المستخدم أو كلمة السر غلط', err_username: 'اسم المستخدم 3-20 حرف (حروف إنجليزية وأرقام و _ . -)', err_password: 'كلمة السر لازم تكون 4 حروف على الأقل',
      err_name: 'اكتب الاسم (حرفين على الأقل)', err_exists: 'اسم المستخدم موجود بالفعل', err_max_users: 'وصلنا للحد الأقصى: 10 حسابات', err_demo_full: 'لا يوجد مكان لحسابات التجربة (الحد 10 حسابات)',
      nav_home: 'الرئيسية', nav_schedule: 'المواعيد', nav_network: 'الربط', nav_reports: 'التقارير', nav_settings: 'الإعدادات',
      conn_local: 'وضع محلي', conn_online: 'الجهاز متصل', conn_offline: 'الجهاز غير متصل', conn_remote: 'متصل عن بُعد (إنترنت)',
      set_remote: 'التحكم من أي مكان (MQTT)', r_host: 'عنوان الـbroker', r_port: 'منفذ WSS', r_user: 'اسم مستخدم الـbroker', r_id: 'معرّف العلبة (8 خانات)',
      r_save: 'حفظ في هذا المتصفح', r_save_both: 'حفظ في المتصفح وإرسال للعلبة', r_off: 'إيقاف', r_err: 'أدخل عنوان الـbroker ومعرّف العلبة (8 حروف/أرقام hex)',
      r_box_saved: 'تم إرسال إعدادات الاتصال للعلبة', r_no_mqtt: 'مكتبة MQTT لم تُحمَّل (تحقق من الإنترنت)',
      r_hint: 'افتح الموقع مرة من عنوان العلبة على الشبكة المحلية، احفظ الإعدادات هنا، ثم استخدم نفس الإعدادات من أي مكان. الحسابات تبقى في كل متصفح: استخدم التصدير والاستيراد لنقلها.',
      hello: 'أهلاً {name}', greet_morning: 'صباح الخير {name}', greet_afternoon: 'مساء الخير {name}', greet_evening: 'مساء النور {name}',
      progress_today: 'الجرعات اليوم: {t} من {n}', kpi_today: 'جرعات اليوم', kpi_adherence: 'الالتزام (7 أيام)', kpi_boxes: 'خانات نشطة', kpi_device: 'ساعة الجهاز',
      not_synced: 'غير متزامنة', dev_other_owner: 'الجهاز مربوط بحساب آخر', next_dose: 'الجرعة القادمة', next_none: 'لا توجد جرعات قادمة', due_now: 'حان الآن!',
      timeline: 'جدول اليوم', timeline_empty: 'لا توجد أدوية مبرمجة', chart_title: 'الالتزام آخر 7 أيام', chart_empty: 'لا توجد بيانات جرعات بعد.',
      st_empty: 'فارغة', st_waiting: 'في الانتظار', st_due: 'حان الموعد', st_taken: 'تم الأخذ', st_missed: 'فاتت', st_skipped: 'تم تجاوزها',
      lid_open: 'الغطاء مفتوح', lid_closed: 'الغطاء مغلق', btn_take: 'تأكيد أخذ الجرعة', dose_logged: 'تم تسجيل الجرعة',
      pick_patient: 'اختر المريض', no_patients: 'لا يوجد مرضى مرتبطون بعد.',
      sch_title: 'مواعيد الأدوية', sch_synced: 'متزامنة مع العلبة', box_n: 'الخانة {n}', f_medname: 'اسم الدواء', btn_save: 'حفظ', btn_clear: 'تفريغ',
      saved: 'تم الحفظ', cleared: 'تم التفريغ', err_med: 'اكتب اسم الدواء وحدد الوقت',
      net_title: 'شبكة الرعاية', add_patient: 'إضافة مريض', f_patient_username: 'اسم مستخدم المريض', btn_send: 'إرسال', req_sent: 'تم إرسال الطلب',
      err_no_patient: 'لا يوجد مريض بهذا الاسم', err_already: 'الطلب موجود أو المريض مرتبط بالفعل', pending_requests: 'طلبات المتابعة', no_requests: 'لا توجد طلبات.',
      my_doctors: 'الأطباء المتابعون', my_patients: 'مرضاي', no_doctors: 'لا يوجد أطباء مرتبطون.', btn_accept: 'قبول', btn_reject: 'رفض', btn_unlink: 'إلغاء الربط', btn_open: 'فتح',
      accepted: 'تم القبول', rejected: 'تم الرفض', unlinked: 'تم إلغاء الربط', doctor_prefix: 'د.', awaiting: 'في انتظار الرد',
      rep_title: 'التقارير', rep_feel: 'كيف كان شعورك؟', feel_good: 'ممتاز', feel_ok: 'متوسط', feel_bad: 'تعبان', rep_problem: 'دواء بيتعبك', none: 'لا يوجد',
      rep_symptoms: 'الأعراض', rep_notes: 'ملاحظات', btn_send_report: 'إرسال التقرير', rep_sent: 'تم إرسال التقرير', rep_history: 'سجل التقارير', no_reports: 'لا توجد تقارير.',
      rep_patient_reports: 'تقارير المرضى', rep_reply: 'اكتب توصيتك...', btn_reply: 'رد', reply_sent: 'تم إرسال الرد', doctor_reply: 'توصية الطبيب',
      set_title: 'الإعدادات', set_appearance: 'المظهر واللغة', set_device: 'الاتصال بالعلبة (ESP32)', btn_save_test: 'حفظ واختبار',
      esp_ok: 'تم الاتصال بالعلبة', esp_fail: 'تعذّر الاتصال بالعلبة', esp_blocked_hint: 'هذه الصفحة على HTTPS والمتصفح يمنع الاتصال بعنوان http. افتح الموقع من عنوان العلبة http://<IP> للتحكم الحي.',
      set_device_ctl: 'التحكم في العلبة', dev_need_online: 'يتطلب اتصال بالعلبة (افتح الموقع من عنوانها على نفس الشبكة).', dev_owner: 'الحساب الذي تتبعه العلبة', dev_owner_auto: 'تلقائي (أول مريض)',
      volume: 'مستوى الصوت', brightness: 'سطوع الإضاءة', muted: 'كتم الصوت', test_box: 'خانة الاختبار',
      test_leds: 'اختبار الأضواء', test_due: 'محاكاة موعد', test_taken: 'محاكاة أخذ', test_missed: 'محاكاة فوات', test_reset: 'إلغاء الاختبار',
      calibrate: 'معايرة الحساسات', calibrate_hint: 'أغلق كل الأغطية قبل المعايرة.', calibrated: 'تمت المعايرة', dev_sent: 'تم الإرسال', dev_saved: 'تم الحفظ على العلبة', dev_fail: 'فشل',
      set_password: 'تغيير كلمة السر', f_newpass: 'كلمة السر الجديدة', pw_changed: 'تم تغيير كلمة السر',
      set_backup: 'نسخة احتياطية', export: 'تصدير JSON', import: 'استيراد JSON', import_ok: 'تم الاستيراد', import_err: 'ملف غير صالح', confirm_import: 'سيتم استبدال كل الحسابات والتقارير. متابعة؟',
      set_danger: 'إجراءات', clear_local: 'مسح البيانات المحلية', confirm_clear: 'مسح كل البيانات المحلية في هذا المتصفح؟',
    },
    en: {
      app_name: 'Nura Box', tagline: 'A smart pill box: dose reminders, adherence tracking, and a direct link to your doctor.',
      lang: 'Language', lang_name: 'عربي', theme: 'Theme', theme_dark: 'Dark', theme_light: 'Light', logout: 'Log out',
      tab_login: 'Log in', tab_register: 'Sign up', f_username: 'Username', f_password: 'Password', f_name: 'Full name', f_role: 'Account type',
      role_patient: 'Patient', role_doctor: 'Doctor', btn_login: 'Log in', btn_register: 'Create account', show_pw: 'Show/hide password',
      pw_weak: 'Weak', pw_ok: 'Fair', pw_strong: 'Strong', demo_title: 'Quick demo login (remove before public use)',
      err_login: 'Wrong username or password', err_username: 'Username: 3-20 chars (letters, digits, _ . -)', err_password: 'Password must be at least 4 characters',
      err_name: 'Enter your name (2+ characters)', err_exists: 'That username is taken', err_max_users: 'Limit reached: 10 accounts', err_demo_full: 'No room for demo accounts (10-account limit)',
      nav_home: 'Home', nav_schedule: 'Schedule', nav_network: 'Network', nav_reports: 'Reports', nav_settings: 'Settings',
      conn_local: 'Local mode', conn_online: 'Device online', conn_offline: 'Device offline', conn_remote: 'Remote (internet)',
      set_remote: 'Control from anywhere (MQTT)', r_host: 'Broker host', r_port: 'WSS port', r_user: 'Broker username', r_id: 'Box ID (8 chars)',
      r_save: 'Save in this browser', r_save_both: 'Save in browser and send to the box', r_off: 'Disable', r_err: 'Enter the broker host and the 8-char hex box ID',
      r_box_saved: 'Connection settings sent to the box', r_no_mqtt: 'MQTT library did not load (check your internet)',
      r_hint: 'Open the site once from the box address on your LAN, save the settings here, then use the same settings from anywhere. Accounts stay per-browser: use Export/Import to move them.',
      hello: 'Hello {name}', greet_morning: 'Good morning {name}', greet_afternoon: 'Good afternoon {name}', greet_evening: 'Good evening {name}',
      progress_today: 'Doses today: {t} of {n}', kpi_today: 'Doses today', kpi_adherence: 'Adherence (7 days)', kpi_boxes: 'Active boxes', kpi_device: 'Device clock',
      not_synced: 'Not synced', dev_other_owner: 'Device follows another account', next_dose: 'Next dose', next_none: 'No upcoming doses', due_now: 'Due now!',
      timeline: "Today's timeline", timeline_empty: 'No medicines scheduled', chart_title: 'Adherence, last 7 days', chart_empty: 'No dose data yet.',
      st_empty: 'Empty', st_waiting: 'Waiting', st_due: 'Due', st_taken: 'Taken', st_missed: 'Missed', st_skipped: 'Skipped',
      lid_open: 'Lid open', lid_closed: 'Lid closed', btn_take: 'Mark as taken', dose_logged: 'Dose logged',
      pick_patient: 'Select patient', no_patients: 'No linked patients yet.',
      sch_title: 'Medicine schedule', sch_synced: 'synced with the box', box_n: 'Box {n}', f_medname: 'Medicine name', btn_save: 'Save', btn_clear: 'Clear',
      saved: 'Saved', cleared: 'Cleared', err_med: 'Enter a medicine name and a time',
      net_title: 'Care network', add_patient: 'Add a patient', f_patient_username: 'Patient username', btn_send: 'Send', req_sent: 'Request sent',
      err_no_patient: 'No patient with that username', err_already: 'Request exists or patient is already linked', pending_requests: 'Follow requests', no_requests: 'No requests.',
      my_doctors: 'My doctors', my_patients: 'My patients', no_doctors: 'No linked doctors.', btn_accept: 'Accept', btn_reject: 'Reject', btn_unlink: 'Unlink', btn_open: 'Open',
      accepted: 'Accepted', rejected: 'Rejected', unlinked: 'Unlinked', doctor_prefix: 'Dr.', awaiting: 'Awaiting reply',
      rep_title: 'Reports', rep_feel: 'How did you feel?', feel_good: 'Great', feel_ok: 'So-so', feel_bad: 'Unwell', rep_problem: 'Problem medicine', none: 'None',
      rep_symptoms: 'Symptoms', rep_notes: 'Notes', btn_send_report: 'Send report', rep_sent: 'Report sent', rep_history: 'Report history', no_reports: 'No reports.',
      rep_patient_reports: 'Patient reports', rep_reply: 'Write your advice...', btn_reply: 'Reply', reply_sent: 'Reply sent', doctor_reply: "Doctor's advice",
      set_title: 'Settings', set_appearance: 'Appearance & language', set_device: 'Box connection (ESP32)', btn_save_test: 'Save & test',
      esp_ok: 'Connected to the box', esp_fail: 'Could not reach the box', esp_blocked_hint: 'This page is HTTPS and the browser blocks http calls. Open the site from the box address http://<IP> for live control.',
      set_device_ctl: 'Box controls', dev_need_online: 'Needs a connection to the box (open the site from its address on the same network).', dev_owner: 'Account the box follows', dev_owner_auto: 'Automatic (first patient)',
      volume: 'Volume', brightness: 'LED brightness', muted: 'Mute', test_box: 'Test box',
      test_leds: 'Test LEDs', test_due: 'Simulate due', test_taken: 'Simulate taken', test_missed: 'Simulate missed', test_reset: 'Cancel test',
      calibrate: 'Calibrate sensors', calibrate_hint: 'Close every lid before calibrating.', calibrated: 'Calibrated', dev_sent: 'Sent', dev_saved: 'Saved on the box', dev_fail: 'Failed',
      set_password: 'Change password', f_newpass: 'New password', pw_changed: 'Password changed',
      set_backup: 'Backup', export: 'Export JSON', import: 'Import JSON', import_ok: 'Imported', import_err: 'Invalid file', confirm_import: 'This replaces all accounts and reports. Continue?',
      set_danger: 'Actions', clear_local: 'Clear local data', confirm_clear: 'Erase all local data in this browser?',
    },
  };
  NB.dict = D;

  let lang = 'ar';
  try { lang = localStorage.getItem('nb_lang') || 'ar'; } catch (e) { /* ignore */ }
  if (!D[lang]) lang = 'ar';
  let theme = 'dark';
  try { theme = localStorage.getItem('nb_theme') || 'dark'; } catch (e) { /* ignore */ }

  NB.lang = () => lang;
  NB.theme = () => theme;

  NB.T = function (k, vars) {
    let s = (D[lang] && D[lang][k]) || D.en[k] || k;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] == null ? '' : vars[n]));
    return s;
  };

  NB.applyI18n = function (root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = NB.T(e.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-ph]').forEach((e) => { e.setAttribute('placeholder', NB.T(e.getAttribute('data-i18n-ph'))); });
    root.querySelectorAll('[data-i18n-title]').forEach((e) => { e.setAttribute('title', NB.T(e.getAttribute('data-i18n-title'))); });
  };

  NB.setLang = function (l) {
    lang = D[l] ? l : 'ar';
    try { localStorage.setItem('nb_lang', lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    NB.applyI18n();
  };

  NB.setTheme = function (t) {
    theme = t === 'light' ? 'light' : 'dark';
    try { localStorage.setItem('nb_theme', theme); } catch (e) { /* ignore */ }
    document.documentElement.setAttribute('data-theme', theme);
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', theme === 'dark' ? '#0f172a' : '#eef4fb');
  };
})();
