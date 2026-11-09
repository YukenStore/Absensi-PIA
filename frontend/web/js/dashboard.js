/**
 * Logika Halaman Utama (Dashboard Monitoring & Rekapitulasi Presensi)
 * Sistem Informasi Pendidikan Islam At-Taqwa (PIA)
 * Terhubung ke Database SQLite Lokal, Cloudflare Worker, & Sinkronisasi Browser
 */

const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const DAY_SHORT_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const AVAILABLE_YEARS = [2024, 2025, 2026, 2027];

const API_BASES = window.location.hostname.includes('github.io')
  ? ['https://absensi-pia.yumenoboken.workers.dev', 'http://localhost:5173']
  : ['', 'http://localhost:5173', 'https://absensi-pia.yumenoboken.workers.dev'];

async function callDatabaseApi(apiPath, options = {}) {
  for (const base of API_BASES) {
    try {
      const resp = await fetch(`${base}${apiPath}`, options);
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await resp.json();
        if (resp.ok) return data;
      }
    } catch (_) {}
  }
  return null;
}

// State bersih (Tanpa data dummy — 100% tersinkronisasi dari Pendaftaran Siswa & Registrasi Guru)
let state = {
  students: [],
  teachers: [],
  allTeachers: [],
  customHolidays: {},
  studentRecords: {},
  teacherRecords: {},
  currentUser: null,
  isAdmin: false,
};

function getCurrentUser() {
  try {
    const rawUser = localStorage.getItem('pia_user');
    if (rawUser) {
      return JSON.parse(rawUser);
    }
  } catch (_) {}
  return null;
}

function updateAdminUiVisibility() {
  const adminManageWrap = document.getElementById('adminManageTeachersWrap');
  const visibilityPanel = document.getElementById('adminTeacherVisibilityPanel');
  if (adminManageWrap) {
    adminManageWrap.style.display = state.isAdmin ? 'block' : 'none';
  }
  if (visibilityPanel && !state.isAdmin) {
    visibilityPanel.style.display = 'none';
  }
}

// Muat info user yang sedang login
function initUserHeader() {
  const nameEl = document.getElementById('activeUserName');
  const emailEl = document.getElementById('activeUserEmail');
  const user = getCurrentUser();
  state.currentUser = user;

  if (user) {
    if (user.full_name && nameEl) nameEl.textContent = user.full_name;
    if (user.email && emailEl) emailEl.textContent = user.email;
    state.isAdmin = Boolean(
      (user.email && user.email.toLowerCase() === 'yumenoboken@gmail.com') ||
      user.role === 'admin'
    );
  } else {
    state.isAdmin = false;
  }

  updateAdminUiVisibility();

  const toggleBtn = document.getElementById('toggleHideTeachersPanelBtn');
  const visibilityPanel = document.getElementById('adminTeacherVisibilityPanel');

  if (toggleBtn && visibilityPanel) {
    toggleBtn.addEventListener('click', () => {
      const isVisible = visibilityPanel.style.display !== 'none';
      visibilityPanel.style.display = isVisible ? 'none' : 'block';
      toggleBtn.textContent = isVisible
        ? 'Kelola / Sembunyikan Nama User'
        : 'Tutup Pengaturan Nama User';
    });
  }

  document.querySelectorAll('.logout-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.removeItem('pia_access_token');
      window.location.href = 'index.html';
    });
  });

  document.querySelectorAll('[data-coming-soon]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      alert(link.getAttribute('data-coming-soon'));
    });
  });
}

// Format YYYY-MM-DD
function formatDateKey(year, monthIndex, day) {
  const m = String(monthIndex + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Cek apakah suatu tanggal adalah hari libur (Sabtu otomatis libur + custom holiday)
function isHolidayDate(year, monthIndex, day) {
  const dateKey = formatDateKey(year, monthIndex, day);
  if (Object.prototype.hasOwnProperty.call(state.customHolidays, dateKey)) {
    return Boolean(state.customHolidays[dateKey]);
  }
  const dayOfWeek = new Date(year, monthIndex, day).getDay();
  return dayOfWeek === 6; // 6 = Hari Sabtu otomatis libur
}

// Toggle meliburkan / mengaktifkan tanggal tertentu saat header tanggal diklik
async function toggleHolidayDate(year, monthIndex, day) {
  const dateKey = formatDateKey(year, monthIndex, day);
  const currentlyHoliday = isHolidayDate(year, monthIndex, day);
  state.customHolidays[dateKey] = !currentlyHoliday;

  try {
    localStorage.setItem('pia_custom_holidays', JSON.stringify(state.customHolidays));
    await callDatabaseApi('/api/attendance/toggle-holiday', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holiday_date: dateKey,
        is_holiday: state.customHolidays[dateKey],
      }),
    });
  } catch (_) {}

  renderAllViews();
}

// Muat data fallback dari localStorage (untuk sinkronisasi GitHub Pages & Offline)
function loadLocalSyncedData() {
  // Bersihkan key data dummy lama jika masih ada
  try {
    const savedHolidays = localStorage.getItem('pia_custom_holidays');
    if (savedHolidays) {
      state.customHolidays = JSON.parse(savedHolidays);
    }
  } catch (_) {}

  // 1. Siswa dari Pendaftaran
  try {
    const rawStudents = localStorage.getItem('pia_students_db');
    if (rawStudents) {
      const parsedStudents = JSON.parse(rawStudents);
      if (Array.isArray(parsedStudents)) {
        state.students = parsedStudents.map((s) => ({
          id: s.id,
          name: s.full_name || s.name,
          class_name: s.class_name || '',
          birth_date: s.birth_date || '',
        }));
      }
    }
  } catch (_) {}

  // 2. Guru dari akun yang mendaftar (pia_gh_pages_db) + daftar nama yang disembunyikan
  let hiddenMap = {};
  try {
    const rawHidden = localStorage.getItem('pia_hidden_teachers');
    if (rawHidden) hiddenMap = JSON.parse(rawHidden) || {};
  } catch (_) {}

  try {
    const rawDb = localStorage.getItem('pia_gh_pages_db');
    let usersList = [];
    if (rawDb) {
      const parsed = JSON.parse(rawDb);
      if (parsed && Array.isArray(parsed.users)) {
        // Tampilkan semua akun yang mendaftar ke Absensi
        usersList = parsed.users;
      }
    }
    if (usersList.length === 0) {
      usersList = [
        {
          id: 1,
          full_name: 'Yuken',
          email: 'yumenoboken@gmail.com',
          username: 'Yuken',
          role: 'admin',
          is_active: true,
        },
      ];
    }

    state.allTeachers = usersList.map((u) => ({
      id: u.id,
      name: u.full_name || u.username,
      email: u.email,
      username: u.username,
      role: u.email && u.email.toLowerCase() === 'yumenoboken@gmail.com' ? 'admin' : u.role || 'guru',
      is_hidden: Boolean(hiddenMap[u.id] || u.is_hidden),
    }));
    state.teachers = state.allTeachers.filter((t) => !t.is_hidden);
  } catch (_) {}

  // 3. Rekap absensi riil dari penyimpanan lokal
  try {
    const rawStudentRec = localStorage.getItem('pia_student_records');
    if (rawStudentRec) state.studentRecords = JSON.parse(rawStudentRec) || {};
  } catch (_) {}

  try {
    const rawTeacherRec = localStorage.getItem('pia_teacher_records');
    if (rawTeacherRec) state.teacherRecords = JSON.parse(rawTeacherRec) || {};
  } catch (_) {}
}

// Ambil data dari server SQL jika tersedia dan sinkronkan dengan penyimpanan browser
async function loadServerOverview() {
  try {
    // 1. Kumpulkan akun guru dari penyimpanan browser untuk disinkronkan ke server SQL / Cloudflare D1
    let localTeachersToSync = [];
    try {
      const rawDb = localStorage.getItem('pia_gh_pages_db');
      if (rawDb) {
        const parsed = JSON.parse(rawDb);
        if (parsed && Array.isArray(parsed.users)) {
          localTeachersToSync = [...parsed.users];
        }
      }
    } catch (_) {}

    // Tambahkan juga akun yang saat ini sedang login di browser (pia_user / pia_current_user)
    try {
      const rawUser = localStorage.getItem('pia_user') || localStorage.getItem('pia_current_user');
      if (rawUser) {
        const u = JSON.parse(rawUser);
        if (u && (u.email || u.full_name)) {
          const email = (u.email || '').toLowerCase();
          if (!localTeachersToSync.some((t) => (t.email || '').toLowerCase() === email)) {
            localTeachersToSync.push({
              name: u.full_name || u.name || u.username,
              email: u.email,
              username: u.username || (email ? email.split('@')[0] : 'guru'),
              role: u.role || 'guru',
            });
          }
        }
      }
    } catch (_) {}

    // Sinkronkan akun guru lokal ke tabel SQL `users` jika ada akun terdaftar
    if (localTeachersToSync.length > 0) {
      await callDatabaseApi('/api/teachers/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teachers: localTeachersToSync }),
      });
    }

    const data = await callDatabaseApi('/api/attendance/overview');
    if (!data) return;

    if (Array.isArray(data.students)) {
      state.students = data.students;
      localStorage.setItem(
        'pia_students_db',
        JSON.stringify(
          data.students.map((s) => ({
            id: s.id,
            full_name: s.name,
            class_name: s.class_name,
            birth_date: s.birth_date,
          }))
        )
      );
    }

    // Ambil daftar nama guru yang disembunyikan
    let hiddenMap = {};
    try {
      const rawHidden = localStorage.getItem('pia_hidden_teachers');
      if (rawHidden) hiddenMap = JSON.parse(rawHidden) || {};
    } catch (_) {}

    // Gabungkan data guru dari server SQL dan akun yang terdaftar di browser
    const teacherMap = new Map();
    if (Array.isArray(data.all_teachers)) {
      data.all_teachers.forEach((t) => {
        const key = (t.email || t.username || '').toLowerCase();
        if (key) {
          teacherMap.set(key, {
            ...t,
            is_hidden: Boolean(hiddenMap[t.id] !== undefined ? hiddenMap[t.id] : t.is_hidden),
          });
        }
      });
    }

    localTeachersToSync.forEach((u) => {
      const key = (u.email || u.username || '').toLowerCase();
      if (key && !teacherMap.has(key)) {
        teacherMap.set(key, {
          id: u.id,
          name: u.full_name || u.username,
          email: u.email,
          username: u.username,
          role: u.role || 'guru',
          is_hidden: Boolean(hiddenMap[u.id] || u.is_hidden),
        });
      }
    });

    state.allTeachers = Array.from(teacherMap.values());
    state.teachers = state.allTeachers.filter((t) => !t.is_hidden);

    // Pastikan status admin user yang sedang login disinkronkan dari database
    if (state.currentUser) {
      const currentEmail = (state.currentUser.email || '').toLowerCase();
      const currentUsername = (state.currentUser.username || '').toLowerCase();
      const matchedTeacher = state.allTeachers.find(
        (t) =>
          (t.email && t.email.toLowerCase() === currentEmail) ||
          (t.username && t.username.toLowerCase() === currentUsername)
      );
      if (matchedTeacher) {
        state.currentUser.role = matchedTeacher.role;
        state.isAdmin = Boolean(
          matchedTeacher.role === 'admin' ||
          (matchedTeacher.email && matchedTeacher.email.toLowerCase() === 'yumenoboken@gmail.com')
        );
        try {
          localStorage.setItem('pia_user', JSON.stringify(state.currentUser));
        } catch (_) {}
      }
    }
    updateAdminUiVisibility();

    if (data.custom_holidays) {
      state.customHolidays = { ...state.customHolidays, ...data.custom_holidays };
      localStorage.setItem('pia_custom_holidays', JSON.stringify(state.customHolidays));
    }

    if (data.student_records) {
      state.studentRecords = data.student_records;
      localStorage.setItem('pia_student_records', JSON.stringify(state.studentRecords));
    }

    if (data.teacher_records) {
      state.teacherRecords = data.teacher_records;
      localStorage.setItem('pia_teacher_records', JSON.stringify(state.teacherRecords));
    }

    renderAllViews();
  } catch (_) {}
}

// =========================================================================
// FITUR KHUSUS ADMIN: SEMBUNYIKAN / TAMPILKAN NAMA USER DI TABEL GURU
// =========================================================================
async function toggleTeacherVisibility(userId, hideUser) {
  // Update state lokal & localStorage terlebih dahulu agar instan
  let hiddenMap = {};
  try {
    const raw = localStorage.getItem('pia_hidden_teachers');
    if (raw) hiddenMap = JSON.parse(raw) || {};
  } catch (_) {}

  if (hideUser) {
    hiddenMap[userId] = true;
  } else {
    delete hiddenMap[userId];
  }
  localStorage.setItem('pia_hidden_teachers', JSON.stringify(hiddenMap));

  state.allTeachers = state.allTeachers.map((t) =>
    t.id === userId ? { ...t, is_hidden: Boolean(hideUser) } : t
  );
  state.teachers = state.allTeachers.filter((t) => !t.is_hidden);

  // Sinkronkan juga ke pia_gh_pages_db jika ada
  try {
    const rawDb = localStorage.getItem('pia_gh_pages_db');
    if (rawDb) {
      const parsed = JSON.parse(rawDb);
      if (parsed && Array.isArray(parsed.users)) {
        const target = parsed.users.find((u) => u.id === userId);
        if (target) target.is_hidden = Boolean(hideUser);
        localStorage.setItem('pia_gh_pages_db', JSON.stringify(parsed));
      }
    }
  } catch (_) {}

  // Kirim ke server SQLite jika sedang berjalan di local/worker
  try {
    const adminEmail = state.currentUser ? state.currentUser.email : 'yumenoboken@gmail.com';
    await callDatabaseApi('/api/teachers/toggle-hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_email: adminEmail,
        target_user_id: userId,
        is_hidden: Boolean(hideUser),
      }),
    });
  } catch (_) {}

  renderAllViews();
}

async function changeTeacherRole(userId, newRole) {
  state.allTeachers = state.allTeachers.map((t) =>
    t.id === userId ? { ...t, role: newRole } : t
  );
  state.teachers = state.allTeachers.filter((t) => !t.is_hidden);

  try {
    const rawDb = localStorage.getItem('pia_gh_pages_db');
    if (rawDb) {
      const parsed = JSON.parse(rawDb);
      if (parsed && Array.isArray(parsed.users)) {
        const target = parsed.users.find((u) => u.id === userId);
        if (target) target.role = newRole;
        localStorage.setItem('pia_gh_pages_db', JSON.stringify(parsed));
      }
    }
  } catch (_) {}

  try {
    const adminEmail = state.currentUser ? state.currentUser.email : 'yumenoboken@gmail.com';
    await callDatabaseApi('/api/teachers/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_email: adminEmail,
        target_user_id: userId,
        role: newRole,
      }),
    });
  } catch (_) {}

  renderAllViews();
}

async function deleteTeacherAccount(userId, teacherName) {
  const confirmDelete = window.confirm(
    `Apakah Anda yakin ingin menghapus akun "${teacherName}"?\n\nSeluruh riwayat presensi akun guru ini juga akan dihapus permanen.`
  );
  if (!confirmDelete) return;

  state.allTeachers = state.allTeachers.filter((t) => t.id !== userId);
  state.teachers = state.allTeachers.filter((t) => !t.is_hidden);

  try {
    const rawDb = localStorage.getItem('pia_gh_pages_db');
    if (rawDb) {
      const parsed = JSON.parse(rawDb);
      if (parsed && Array.isArray(parsed.users)) {
        parsed.users = parsed.users.filter((u) => u.id !== userId);
        localStorage.setItem('pia_gh_pages_db', JSON.stringify(parsed));
      }
    }
  } catch (_) {}

  try {
    const adminEmail = state.currentUser ? state.currentUser.email : 'yumenoboken@gmail.com';
    await callDatabaseApi('/api/teachers/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_email: adminEmail,
        target_user_id: userId,
      }),
    });
  } catch (_) {}

  renderAllViews();
}

// Tutup menu dropdown titik tiga saat mengklik di luar menu
document.addEventListener('click', (e) => {
  if (!e.target.closest('.user-menu-dropdown-wrap')) {
    document.querySelectorAll('.user-action-dropdown-menu').forEach((m) => {
      m.style.display = 'none';
    });
    document.querySelectorAll('.btn-user-action-dots').forEach((b) => {
      b.classList.remove('active');
    });
  }
});

function renderAdminTeacherVisibilityPanel() {
  const listEl = document.getElementById('adminTeacherVisibilityList');
  const visibilityPanel = document.getElementById('adminTeacherVisibilityPanel');
  const adminManageWrap = document.getElementById('adminManageTeachersWrap');

  if (!state.isAdmin) {
    if (adminManageWrap) adminManageWrap.style.display = 'none';
    if (visibilityPanel) visibilityPanel.style.display = 'none';
    if (listEl) listEl.innerHTML = '';
    return;
  }
  if (adminManageWrap) adminManageWrap.style.display = 'block';
  if (!listEl) return;

  if (state.allTeachers.length === 0) {
    listEl.innerHTML = `<div class="empty-inline">Belum ada akun user terdaftar.</div>`;
    return;
  }

  listEl.innerHTML = state.allTeachers
    .map((u) => {
      const isSuperAdmin = u.email && u.email.toLowerCase() === 'yumenoboken@gmail.com';
      const roleBadge = u.role === 'admin'
        ? `<span class="badge-role role-admin">Admin</span>`
        : `<span class="badge-role role-guru">Guru</span>`;

      const statusBadge = u.is_hidden
        ? `<span class="vis-badge hidden">Disembunyikan</span>`
        : `<span class="vis-badge visible">Ditampilkan di Tabel</span>`;

      return `
        <div class="admin-user-toggle-item">
          <div class="user-info">
            <span class="u-name">${u.name}</span>
            <span class="u-email">${u.email || ''}</span>
            ${roleBadge}
            ${statusBadge}
          </div>
          <div class="user-actions">
            <div class="user-menu-dropdown-wrap">
              <button type="button" class="btn-user-action-dots" aria-label="Menu Aksi" data-uid="${u.id}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2"></circle>
                  <circle cx="12" cy="12" r="2"></circle>
                  <circle cx="12" cy="19" r="2"></circle>
                </svg>
              </button>
              <div class="user-action-dropdown-menu" id="menu-${u.id}" style="display: none;">
                <!-- Opsi 1: Atur Visibility -->
                <button type="button" class="dropdown-item action-toggle-visibility" data-uid="${u.id}" data-hide="${u.is_hidden ? 0 : 1}">
                  ${u.is_hidden
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Tampilkan di Tabel`
                    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Sembunyikan dari Tabel`}
                </button>

                <!-- Opsi 2: Jadikan Admin / Guru -->
                ${isSuperAdmin ? '' : `
                  <button type="button" class="dropdown-item action-toggle-role" data-uid="${u.id}" data-target-role="${u.role === 'admin' ? 'guru' : 'admin'}">
                    ${u.role === 'admin'
                      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Ubah Menjadi Guru`
                      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Jadikan Admin`}
                  </button>
                `}

                <!-- Opsi 3: Hapus Akun -->
                ${isSuperAdmin ? '' : `
                  <div class="dropdown-divider"></div>
                  <button type="button" class="dropdown-item text-danger action-delete-user" data-uid="${u.id}" data-name="${u.name}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Hapus Akun
                  </button>
                `}
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // Event listener tombol titik tiga
  listEl.querySelectorAll('.btn-user-action-dots').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = btn.getAttribute('data-uid');
      const menu = document.getElementById(`menu-${uid}`);

      // Tutup menu lain
      document.querySelectorAll('.user-action-dropdown-menu').forEach((m) => {
        if (m !== menu) m.style.display = 'none';
      });
      document.querySelectorAll('.btn-user-action-dots').forEach((b) => {
        if (b !== btn) b.classList.remove('active');
      });

      if (menu) {
        const isShown = menu.style.display === 'flex';
        menu.style.display = isShown ? 'none' : 'flex';
        btn.classList.toggle('active', !isShown);
      }
    });
  });

  // Event listener aksi: Toggle Visibility
  listEl.querySelectorAll('.action-toggle-visibility').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = parseInt(btn.getAttribute('data-uid'), 10);
      const shouldHide = btn.getAttribute('data-hide') === '1';
      toggleTeacherVisibility(uid, shouldHide);
    });
  });

  // Event listener aksi: Ganti Peran Admin/Guru
  listEl.querySelectorAll('.action-toggle-role').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = parseInt(btn.getAttribute('data-uid'), 10);
      const targetRole = btn.getAttribute('data-target-role');
      changeTeacherRole(uid, targetRole);
    });
  });

  // Event listener aksi: Hapus Akun
  listEl.querySelectorAll('.action-delete-user').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = parseInt(btn.getAttribute('data-uid'), 10);
      const name = btn.getAttribute('data-name');
      deleteTeacherAccount(uid, name);
    });
  });
}

// =========================================================================
// RENDER MATRIKS TABEL HARIAN (1 BULAN PENUH)
// =========================================================================
function renderDailyMatrix({
  headEl,
  bodyEl,
  peopleList,
  recordsMap,
  year,
  monthIndex,
  personLabel,
  emptyMessageHtml,
}) {
  const daysCount = getDaysInMonth(year, monthIndex);

  // Header Tabel (No, Nama, Tanggal 1..daysCount)
  let headHtml = `<tr>
    <th class="sticky-no">No</th>
    <th class="sticky-col">${personLabel}</th>`;

  for (let d = 1; d <= daysCount; d++) {
    const dow = new Date(year, monthIndex, d).getDay();
    const dayName = DAY_SHORT_NAMES[dow];
    const holiday = isHolidayDate(year, monthIndex, d);
    const holidayClass = holiday ? 'is-holiday' : '';
    const titleTip = holiday
      ? `Tanggal ${d} ${MONTH_NAMES[monthIndex]} ${year} (Libur) - Klik untuk mengaktifkan`
      : `Tanggal ${d} ${MONTH_NAMES[monthIndex]} ${year} - Klik untuk meliburkan`;

    headHtml += `
      <th class="th-day ${holidayClass}" data-year="${year}" data-month="${monthIndex}" data-day="${d}" title="${titleTip}">
        <span class="day-num">${d}</span>
        <span class="day-name">${holiday ? 'Libur' : dayName}</span>
      </th>`;
  }
  headHtml += `</tr>`;
  headEl.innerHTML = headHtml;

  // Pasang event klik pada setiap tanggal di header untuk fitur meliburkan hari
  headEl.querySelectorAll('.th-day').forEach((th) => {
    th.addEventListener('click', () => {
      const y = parseInt(th.getAttribute('data-year'), 10);
      const m = parseInt(th.getAttribute('data-month'), 10);
      const d = parseInt(th.getAttribute('data-day'), 10);
      toggleHolidayDate(y, m, d);
    });
  });

  // Jika belum ada data siswa / guru
  if (!peopleList || peopleList.length === 0) {
    bodyEl.innerHTML = `
      <tr>
        <td colspan="${daysCount + 2}" class="empty-table-cell">
          <div class="empty-sticky-banner">
            ${emptyMessageHtml || 'Belum ada data terdaftar.'}
          </div>
        </td>
      </tr>
    `;
    return;
  }

  // Body Tabel
  let bodyHtml = '';
  peopleList.forEach((person, idx) => {
    bodyHtml += `<tr>
      <td class="sticky-no">${idx + 1}</td>
      <td class="sticky-col">${person.name}</td>`;

    for (let d = 1; d <= daysCount; d++) {
      const holiday = isHolidayDate(year, monthIndex, d);
      if (holiday) {
        bodyHtml += `<td class="td-day is-holiday-col" title="Hari Libur"><span class="status-pill cell-libur">L</span></td>`;
        continue;
      }

      const dateKey = formatDateKey(year, monthIndex, d);
      const status =
        recordsMap[`${person.id}_${dateKey}`] ||
        (person.email && recordsMap[`${person.email.toLowerCase()}_${dateKey}`]);

      if (status === 'H') {
        bodyHtml += `<td class="td-day" title="${person.name} - Tanggal ${d}: Hadir"><span class="status-pill cell-hadir">H</span></td>`;
      } else if (status === 'I') {
        bodyHtml += `<td class="td-day" title="${person.name} - Tanggal ${d}: Izin"><span class="status-pill cell-izin">I</span></td>`;
      } else if (status === 'S') {
        bodyHtml += `<td class="td-day" title="${person.name} - Tanggal ${d}: Sakit"><span class="status-pill cell-sakit">S</span></td>`;
      } else if (status === 'A') {
        bodyHtml += `<td class="td-day" title="${person.name} - Tanggal ${d}: Alfa"><span class="status-pill cell-alfa">A</span></td>`;
      } else {
        bodyHtml += `<td class="td-day" title="${person.name} - Tanggal ${d}: Belum diisi"><span class="status-empty">-</span></td>`;
      }
    }

    bodyHtml += `</tr>`;
  });

  bodyEl.innerHTML = bodyHtml;
}

// =========================================================================
// RENDER TABEL REKAP ABSENSI (TOTAL HADIR, IZIN, SAKIT, ALFA, PERSENTASE)
// =========================================================================
function renderRecapTable({ bodyEl, peopleList, recordsMap, filterConfig, emptyMessageHtml }) {
  const tableEl = bodyEl ? bodyEl.closest('table') : null;
  if (!peopleList || peopleList.length === 0) {
    if (tableEl) tableEl.classList.add('is-empty-table');
    bodyEl.innerHTML = `
      <tr class="empty-row">
        <td colspan="7" class="empty-table-cell">
          <div class="empty-sticky-banner">
            ${emptyMessageHtml || 'Belum ada data terdaftar.'}
          </div>
        </td>
      </tr>
    `;
    return;
  }
  if (tableEl) tableEl.classList.remove('is-empty-table');

  const targetMonths = [];

  if (filterConfig.mode === 'all') {
    for (const y of [2025, 2026]) {
      for (let m = 0; m < 12; m++) {
        targetMonths.push({ year: y, monthIndex: m });
      }
    }
  } else if (filterConfig.mode === 'year') {
    for (let m = 0; m < 12; m++) {
      targetMonths.push({ year: filterConfig.year, monthIndex: m });
    }
  } else {
    targetMonths.push({ year: filterConfig.year, monthIndex: filterConfig.monthIndex });
  }

  let rowsHtml = '';
  peopleList.forEach((person, idx) => {
    let totalHadir = 0;
    let totalIzin = 0;
    let totalSakit = 0;
    let totalAlfa = 0;
    let effectiveDays = 0;

    for (const { year, monthIndex } of targetMonths) {
      const daysCount = getDaysInMonth(year, monthIndex);
      for (let d = 1; d <= daysCount; d++) {
        if (isHolidayDate(year, monthIndex, d)) continue;
        effectiveDays++;
        const dateKey = formatDateKey(year, monthIndex, d);
        const st =
          recordsMap[`${person.id}_${dateKey}`] ||
          (person.email && recordsMap[`${person.email.toLowerCase()}_${dateKey}`]);
        if (st === 'H') totalHadir++;
        else if (st === 'I') totalIzin++;
        else if (st === 'S') totalSakit++;
        else if (st === 'A') totalAlfa++;
      }
    }

    const percentage =
      effectiveDays > 0 ? Math.round((totalHadir * 100) / effectiveDays) : 0;

    rowsHtml += `
      <tr>
        <td>${idx + 1}</td>
        <td style="font-weight: 700; color: var(--secondary);">${person.name}</td>
        <td><span class="badge-count badge-hadir">${totalHadir}</span></td>
        <td><span class="badge-count badge-izin">${totalIzin}</span></td>
        <td><span class="badge-count badge-sakit">${totalSakit}</span></td>
        <td><span class="badge-count badge-alfa">${totalAlfa}</span></td>
        <td>
          <div class="progress-wrap">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${percentage}%;"></div>
            </div>
            <span class="progress-text">${percentage}%</span>
          </div>
        </td>
      </tr>
    `;
  });

  bodyEl.innerHTML = rowsHtml;
}

// =========================================================================
// INISIALISASI DROPDOWN & TAB UTAMA
// =========================================================================
function populateMonthYearSelects() {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = AVAILABLE_YEARS.includes(now.getFullYear())
    ? now.getFullYear()
    : 2026;

  const monthSelectIds = ['siswaDailyMonth', 'siswaRecapMonth', 'guruMasterMonth'];
  const yearSelectIds = ['siswaDailyYear', 'siswaRecapYear', 'guruMasterYear'];

  monthSelectIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = MONTH_NAMES.map(
      (name, idx) =>
        `<option value="${idx}" ${idx === currentMonth ? 'selected' : ''}>${name}</option>`
    ).join('');
  });

  yearSelectIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = AVAILABLE_YEARS.map(
      (yr) => `<option value="${yr}" ${yr === currentYear ? 'selected' : ''}>${yr}</option>`
    ).join('');
  });
}

function renderSiswaSection() {
  const dailyMonth = parseInt(document.getElementById('siswaDailyMonth').value, 10);
  const dailyYear = parseInt(document.getElementById('siswaDailyYear').value, 10);

  const emptyStudentMsg = `Belum ada data siswa terdaftar di Dashboard. Silakan tambahkan data siswa melalui menu <a href="pendaftaran.html" class="empty-table-link">Pendaftaran</a>.`;

  renderDailyMatrix({
    headEl: document.getElementById('siswaDailyHead'),
    bodyEl: document.getElementById('siswaDailyBody'),
    peopleList: state.students,
    recordsMap: state.studentRecords,
    year: dailyYear,
    monthIndex: dailyMonth,
    personLabel: 'Nama Siswa',
    emptyMessageHtml: emptyStudentMsg,
  });

  // Dropdown tersendiri untuk Rekap Absensi Siswa
  const recapMode = document.getElementById('siswaRecapMode').value;
  const monthWrap = document.getElementById('siswaRecapMonthWrap');
  const yearWrap = document.getElementById('siswaRecapYearWrap');

  if (recapMode === 'all') {
    monthWrap.style.display = 'none';
    yearWrap.style.display = 'none';
  } else if (recapMode === 'year') {
    monthWrap.style.display = 'none';
    yearWrap.style.display = 'flex';
  } else {
    monthWrap.style.display = 'flex';
    yearWrap.style.display = 'flex';
  }

  const recapMonth = parseInt(document.getElementById('siswaRecapMonth').value, 10);
  const recapYear = parseInt(document.getElementById('siswaRecapYear').value, 10);

  renderRecapTable({
    bodyEl: document.getElementById('siswaRecapBody'),
    peopleList: state.students,
    recordsMap: state.studentRecords,
    filterConfig: {
      mode: recapMode,
      year: recapYear,
      monthIndex: recapMonth,
    },
    emptyMessageHtml: emptyStudentMsg,
  });
}

function renderGuruSection() {
  const masterMonth = parseInt(document.getElementById('guruMasterMonth').value, 10);
  const masterYear = parseInt(document.getElementById('guruMasterYear').value, 10);
  const periodLabel = `${MONTH_NAMES[masterMonth]} ${masterYear}`;

  const dailyTitle = document.getElementById('guruDailyTitle');
  const recapTitle = document.getElementById('guruRecapTitle');
  if (dailyTitle) dailyTitle.textContent = `Tabel Harian Presensi Guru — ${periodLabel}`;
  if (recapTitle) recapTitle.textContent = `Rekap Absensi Guru — ${periodLabel}`;

  renderAdminTeacherVisibilityPanel();

  const emptyGuruMsg = `Belum ada nama guru yang ditampilkan pada tabel. ${
    state.isAdmin
      ? 'Klik tombol <strong>Kelola / Sembunyikan Nama User</strong> di atas untuk menampilkan akun guru.'
      : ''
  }`;

  renderDailyMatrix({
    headEl: document.getElementById('guruDailyHead'),
    bodyEl: document.getElementById('guruDailyBody'),
    peopleList: state.teachers,
    recordsMap: state.teacherRecords,
    year: masterYear,
    monthIndex: masterMonth,
    personLabel: 'Nama Guru',
    emptyMessageHtml: emptyGuruMsg,
  });

  renderRecapTable({
    bodyEl: document.getElementById('guruRecapBody'),
    peopleList: state.teachers,
    recordsMap: state.teacherRecords,
    filterConfig: {
      mode: 'month',
      year: masterYear,
      monthIndex: masterMonth,
    },
    emptyMessageHtml: emptyGuruMsg,
  });
}

function renderAllViews() {
  renderSiswaSection();
  renderGuruSection();
}

function initMainTabsAndEvents() {
  const tabButtons = document.querySelectorAll('.main-tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      tabButtons.forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      tabPanels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(targetId);
      if (panel) panel.classList.add('active');
    });
  });

  // Event perubahan dropdown Tab Siswa
  ['siswaDailyMonth', 'siswaDailyYear', 'siswaRecapMode', 'siswaRecapMonth', 'siswaRecapYear'].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', renderSiswaSection);
    }
  );

  // Event perubahan dropdown Master Tab Guru
  ['guruMasterMonth', 'guruMasterYear'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderGuruSection);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initUserHeader();
  populateMonthYearSelects();
  loadLocalSyncedData();
  initMainTabsAndEvents();
  renderAllViews();
  loadServerOverview();
});
