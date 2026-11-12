/**
 * Absensi Guru - Sistem Absensi Pendidikan Islam At-Taqwa (PIA)
 * Mendukung presensi harian guru, pemantauan riwayat, dan persetujuan (ACC) oleh Admin.
 */

const API_BASE = '';
const CF_WORKER_API = 'https://absensi-pia.yumenoboken.workers.dev';
let activeApiBase = (function () {
  try {
    return sessionStorage.getItem('pia_active_api_base');
  } catch (_) {
    return null;
  }
})();

function getSmartTeacherApiBases() {
  const isPortDev = window.location.port === '5173' || window.location.port === '8000';
  const candidates = [];
  if (activeApiBase) candidates.push(activeApiBase);

  if (isPortDev) {
    if (!candidates.includes('')) candidates.push('');
    if (!candidates.includes(CF_WORKER_API)) candidates.push(CF_WORKER_API);
  } else {
    if (!candidates.includes(CF_WORKER_API)) candidates.push(CF_WORKER_API);
    if (!candidates.includes('')) candidates.push('');
  }
  return candidates;
}

let currentUser = null;
function getLocalTodayIso() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let isAdmin = false;
let myHistory = [];
let allSubmissions = [];
let registeredTeachers = [];
let todayRecord = null;
let approvalFilterDate = getLocalTodayIso();
let approvalFilterStatus = 'all';

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function getAuthToken() {
  return localStorage.getItem('pia_access_token');
}

function formatDateIndo(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return dateStr;
  return `${day} ${MONTH_NAMES_ID[monthIdx]} ${year}`;
}

function normalizeRecord(item) {
  if (!item) return item;
  const isAuto = item.approved_by === 'Sistem Otomatis';
  const isPending = isAuto || !item.approval_status || item.approval_status === 'Pending';
  return {
    ...item,
    approval_status: isPending ? 'Pending' : item.approval_status,
    approved_by: isPending ? '' : (item.approved_by || ''),
  };
}

async function callTeacherApi(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const bases = getSmartTeacherApiBases();
  for (const base of bases) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const url = `${base}${endpoint}`;
      const resp = await fetch(url, { ...options, headers, signal: controller.signal });
      clearTimeout(timeoutId);

      const cType = resp.headers.get('content-type') || '';
      if (cType.includes('application/json')) {
        const data = await resp.json();
        if (resp.ok && data && (data.success !== false || !data.detail)) {
          if (base !== activeApiBase) {
            activeApiBase = base;
            try {
              sessionStorage.setItem('pia_active_api_base', base);
            } catch (_) {}
          }
          return data;
        }
        if (!resp.ok) {
          throw new Error(data.detail || data.message || 'Permintaan gagal.');
        }
      }
    } catch (err) {
      if (
        !(err instanceof TypeError) &&
        err.name !== 'AbortError' &&
        !String(err.message).includes('JSON') &&
        !String(err.message).includes('Failed to fetch') &&
        !String(err.message).includes('aborted')
      ) {
        throw err;
      }
    }
  }

  // 3. Fallback Penyimpanan Lokal Browser (Offline / Static GitHub Pages)
  return handleLocalFallback(endpoint, options);
}

function getLocalTeacherDb() {
  try {
    const raw = localStorage.getItem('pia_teacher_attendance_db');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.submissions)) {
        parsed.submissions = parsed.submissions.map(normalizeRecord);
        return parsed;
      }
    }
  } catch (_) {}
  return { submissions: [] };
}

function saveLocalTeacherDb(db) {
  try {
    localStorage.setItem('pia_teacher_attendance_db', JSON.stringify(db));
  } catch (_) {}
}

function handleLocalFallback(endpoint, options) {
  const db = getLocalTeacherDb();
  const email = (currentUser ? currentUser.email : '').toLowerCase();

  if (endpoint.startsWith('/api/teacher-attendance/overview')) {
    const today = new Date().toISOString().slice(0, 10);
    const mySubmissions = db.submissions
      .filter((s) => s.teacher_email.toLowerCase() === email)
      .map(normalizeRecord);
    const todayRec = mySubmissions.find((s) => s.attendance_date === today) || null;

    return {
      success: true,
      is_admin: isAdmin,
      current_user: currentUser,
      today_record: todayRec,
      my_history: mySubmissions,
      all_submissions: isAdmin ? db.submissions.map(normalizeRecord) : [],
      registered_users: [],
    };
  }

  if (endpoint === '/api/teacher-attendance/submit') {
    const body = options.body ? JSON.parse(options.body) : {};
    const dateStr = body.attendance_date || new Date().toISOString().slice(0, 10);
    const status = body.status || 'Hadir';
    const note = body.note || '';
    const teacherName = currentUser ? currentUser.full_name : 'Guru PIA';

    const existingIdx = db.submissions.findIndex(
      (s) => s.teacher_email.toLowerCase() === email && s.attendance_date === dateStr
    );

    const newRecord = {
      id: Date.now(),
      user_id: currentUser ? currentUser.id : 1,
      teacher_name: teacherName,
      teacher_email: email,
      attendance_date: dateStr,
      status: status,
      note: note,
      approval_status: 'Pending',
      approved_by: '',
      created_at: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      db.submissions[existingIdx] = newRecord;
    } else {
      db.submissions.unshift(newRecord);
    }
    saveLocalTeacherDb(db);

    return {
      success: true,
      message: 'Presensi kehadiran berhasil dikirim! Menunggu persetujuan (ACC) Admin.',
      record: newRecord,
    };
  }

  if (endpoint === '/api/teacher-attendance/approve') {
    const body = options.body ? JSON.parse(options.body) : {};
    const attendanceId = Number(body.attendance_id);
    const decision = body.decision === 'Rejected' ? 'Rejected' : 'Approved';

    const target = db.submissions.find((s) => Number(s.id) === attendanceId);
    if (target) {
      target.approval_status = decision;
      target.approved_by = currentUser ? (currentUser.full_name || currentUser.username) : 'Admin';
      saveLocalTeacherDb(db);

      // Sinkron ke pia_teacher_records jika Approved
      try {
        const rawTRec = localStorage.getItem('pia_teacher_records');
        const tRecMap = rawTRec ? JSON.parse(rawTRec) : {};
        const code = target.status === 'Hadir' ? 'H' : target.status === 'Izin' ? 'I' : 'S';
        if (decision === 'Approved') {
          if (target.user_id) tRecMap[`${target.user_id}_${target.attendance_date}`] = code;
          if (target.teacher_email) tRecMap[`${target.teacher_email.toLowerCase()}_${target.attendance_date}`] = code;
        } else {
          if (target.user_id) delete tRecMap[`${target.user_id}_${target.attendance_date}`];
          if (target.teacher_email) delete tRecMap[`${target.teacher_email.toLowerCase()}_${target.attendance_date}`];
        }
        localStorage.setItem('pia_teacher_records', JSON.stringify(tRecMap));
      } catch (_) {}
    }
    return {
      success: true,
      message: decision === 'Approved' ? 'Presensi dewan guru berhasil disetujui (ACC)!' : 'Pengajuan presensi guru telah ditolak.',
    };
  }

  if (endpoint === '/api/teacher-attendance/delete') {
    const body = options.body ? JSON.parse(options.body) : {};
    const attendanceId = Number(body.attendance_id);
    const target = db.submissions.find((s) => Number(s.id) === attendanceId);
    if (target) {
      try {
        const rawTRec = localStorage.getItem('pia_teacher_records');
        const tRecMap = rawTRec ? JSON.parse(rawTRec) : {};
        if (target.user_id) delete tRecMap[`${target.user_id}_${target.attendance_date}`];
        if (target.teacher_email) delete tRecMap[`${target.teacher_email.toLowerCase()}_${target.attendance_date}`];
        localStorage.setItem('pia_teacher_records', JSON.stringify(tRecMap));
      } catch (_) {}
    }
    db.submissions = db.submissions.filter((s) => Number(s.id) !== attendanceId);
    saveLocalTeacherDb(db);
    return { success: true, message: 'Presensi berhasil dihapus.' };
  }

  return { success: true };
}

function showBanner(msg, type = 'success') {
  const banner = document.getElementById('attendanceAlert');
  if (!banner) return;
  banner.className = `alert-banner ${type} show`;
  banner.textContent = msg;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initHamburgerMenu() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const navLinks = document.getElementById('mainNavLinks');
  if (!hamburgerBtn || !navLinks) return;

  const iconHamburger = hamburgerBtn.querySelector('.icon-hamburger');
  const iconClose = hamburgerBtn.querySelector('.icon-close');

  function toggleMenu(forceClose = false) {
    const shouldOpen = forceClose ? false : !navLinks.classList.contains('is-open');
    if (shouldOpen) {
      navLinks.classList.add('is-open');
      hamburgerBtn.classList.add('active');
      hamburgerBtn.setAttribute('aria-expanded', 'true');
      if (iconHamburger) iconHamburger.style.display = 'none';
      if (iconClose) iconClose.style.display = 'block';
    } else {
      navLinks.classList.remove('is-open');
      hamburgerBtn.classList.remove('active');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      if (iconHamburger) iconHamburger.style.display = 'block';
      if (iconClose) iconClose.style.display = 'none';
    }
  }

  hamburgerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  document.addEventListener('click', (e) => {
    if (!navLinks.contains(e.target) && !hamburgerBtn.contains(e.target)) {
      toggleMenu(true);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navLinks.classList.contains('is-open')) {
      toggleMenu(true);
    }
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      toggleMenu(true);
    });
  });
}

function initHeaderAndAuth() {
  initHamburgerMenu();

  const token = getAuthToken();
  const rawUser = localStorage.getItem('pia_user') || localStorage.getItem('pia_current_user');

  if (!token && !rawUser) {
    window.location.href = 'index.html';
    return;
  }

  try {
    if (rawUser) {
      currentUser = JSON.parse(rawUser);
      const nameEl = document.getElementById('activeUserName');
      const emailEl = document.getElementById('activeUserEmail');
      const mobileNameEl = document.getElementById('mobileUserName');
      const mobileEmailEl = document.getElementById('mobileUserEmail');
      const dropdownNameEl = document.getElementById('dropdownUserName');
      const dropdownEmailEl = document.getElementById('dropdownUserEmail');
      const dropdownAvatarEl = document.getElementById('dropdownUserAvatar');
      const dropdownRoleEl = document.getElementById('dropdownUserRole');
      const formTeacherNameEl = document.getElementById('formTeacherName');

      const userName = currentUser.full_name || currentUser.username || 'Pengguna PIA';
      const userEmail = currentUser.email || 'Pendidikan Islam At-Taqwa';
      const userEmailLower = (currentUser.email || '').toLowerCase();
      isAdmin = userEmailLower === 'yumenoboken@gmail.com' || currentUser.role === 'admin';
      const initial = (userName.trim()[0] || 'U').toUpperCase();

      if (nameEl) nameEl.textContent = userName;
      if (emailEl) emailEl.textContent = userEmail;
      if (mobileNameEl) mobileNameEl.textContent = userName;
      if (mobileEmailEl) mobileEmailEl.textContent = userEmail;
      if (dropdownNameEl) dropdownNameEl.textContent = userName;
      if (dropdownEmailEl) dropdownEmailEl.textContent = userEmail;
      if (dropdownAvatarEl) dropdownAvatarEl.textContent = initial;
      if (dropdownRoleEl) dropdownRoleEl.textContent = isAdmin ? 'Administrator' : 'Guru';

      if (formTeacherNameEl) {
        formTeacherNameEl.textContent = userName;
      }
    }
  } catch (_) {}

  document.querySelectorAll('.logout-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.removeItem('pia_access_token');
      localStorage.removeItem('pia_user');
      localStorage.removeItem('pia_current_user');
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

function renderTodayCard(record) {
  const card = document.getElementById('todayStatusCard');
  if (!card) return;

  if (!record) {
    const isSat = new Date().getDay() === 6;
    if (isSat) {
      card.style.display = 'block';
      card.className = 'today-status-card holiday';
      document.getElementById('todayDateVal').textContent = formatDateIndo(getLocalTodayIso());
      document.getElementById('todayStatusVal').innerHTML = '<span class="status-pill cell-libur" style="background:#f1f5f9;color:#64748b;font-weight:700;padding:4px 10px;border-radius:6px;">Hari Libur (Sabtu)</span>';
      document.getElementById('todayNoteVal').textContent = 'Hari ini adalah hari libur (Sabtu). Tidak ada jadwal belajar-mengajar.';
      document.getElementById('todayApprovalVal').textContent = '-';
      return;
    }

    card.style.display = 'block';
    card.className = 'today-status-card warning';
    document.getElementById('todayDateVal').textContent = formatDateIndo(getLocalTodayIso());
    document.getElementById('todayStatusVal').innerHTML = '<span class="status-pill cell-alfa" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;font-weight:700;padding:4px 10px;border-radius:6px;">Belum Mengisi (Otomatis Alfa)</span>';
    document.getElementById('todayNoteVal').textContent = 'Anda belum mengisi presensi hari ini. Harap segera kirim presensi di bawah untuk mencatat kehadiran.';
    document.getElementById('todayApprovalVal').innerHTML = '<span class="badge-pending" style="background:#fee2e2;color:#991b1b;font-weight:700;border:1px solid #fecaca;">⚠️ Wajib Isi Absensi</span>';
    return;
  }

  card.style.display = 'block';
  card.className = 'today-status-card';
  document.getElementById('todayDateVal').textContent = formatDateIndo(record.attendance_date);

  const statusVal = document.getElementById('todayStatusVal');
  const code = record.status;
  const badgeClass = code === 'Hadir' ? 'status-pill-hadir' : code === 'Izin' ? 'status-pill-izin' : code === 'Alfa' ? 'status-pill-alfa' : 'status-pill-sakit';
  statusVal.innerHTML = `<span class="status-pill ${badgeClass}">${code}</span>`;

  document.getElementById('todayNoteVal').textContent = record.note || '(Tidak ada catatan)';

  const approvalVal = document.getElementById('todayApprovalVal');
  const appStatus = record.approval_status || 'Pending';
  if (appStatus === 'Approved') {
    approvalVal.innerHTML = `<span class="badge-approved">✓ Disetujui (${record.approved_by || 'Admin'})</span>`;
  } else if (appStatus === 'Rejected') {
    approvalVal.innerHTML = `<span class="badge-rejected">✕ Ditolak (Alfa)</span>`;
  } else {
    approvalVal.innerHTML = `<span class="badge-pending">⏳ Menunggu ACC</span>`;
  }
}

function renderMyHistoryTable() {
  const table = document.getElementById('myHistoryTable');
  const tbody = document.getElementById('myHistoryBody');
  if (!tbody) return;

  // Hitung akumulasi
  let hadirCount = 0;
  let izinCount = 0;
  let sakitCount = 0;

  for (const item of myHistory) {
    if (item.status === 'Hadir') hadirCount++;
    else if (item.status === 'Izin') izinCount++;
    else if (item.status === 'Sakit') sakitCount++;
  }

  const statH = document.getElementById('statHadirCount');
  const statI = document.getElementById('statIzinCount');
  const statS = document.getElementById('statSakitCount');
  if (statH) statH.textContent = String(hadirCount);
  if (statI) statI.textContent = String(izinCount);
  if (statS) statS.textContent = String(sakitCount);

  if (myHistory.length === 0) {
    if (table) table.classList.add('is-empty-table');
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5" class="empty-table-cell">
          Belum ada riwayat kehadiran Anda. Silakan isi formulir kehadiran di sebelah kiri.
        </td>
      </tr>
    `;
    return;
  }

  if (table) table.classList.remove('is-empty-table');

  tbody.innerHTML = myHistory
    .map((item, idx) => {
      const code = item.status;
      const pillClass = code === 'Hadir' ? 'status-pill-hadir' : code === 'Izin' ? 'status-pill-izin' : 'status-pill-sakit';
      const appStatus = item.approval_status || 'Pending';
      const appClass = appStatus === 'Approved' ? 'badge-approved' : appStatus === 'Rejected' ? 'badge-rejected' : 'badge-pending';
      const appLabel = appStatus === 'Approved' ? '✓ Disetujui' : appStatus === 'Rejected' ? '✕ Ditolak' : '⏳ Menunggu ACC';

      return `
        <tr class="attendance-card-item">
          <td class="cell-no" data-label="No">
            <span class="student-num-badge">${idx + 1}</span>
          </td>
          <td class="cell-date" data-label="Tanggal">
            <strong>${formatDateIndo(item.attendance_date)}</strong>
          </td>
          <td class="cell-status" data-label="Status">
            <span class="status-pill ${pillClass}">${code}</span>
          </td>
          <td class="cell-note" data-label="Keterangan">
            <span class="note-text">${item.note || '-'}</span>
          </td>
          <td class="cell-approval" data-label="Status ACC">
            <span class="${appClass}">${appLabel}</span>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderAdminApprovalSection() {
  const section = document.getElementById('adminApprovalSection');
  const tbody = document.getElementById('adminApprovalBody');
  const pendingCountEl = document.getElementById('pendingBadgeCount');
  const selectTeacherWrap = document.getElementById('adminTeacherSelectWrap');
  const selectTeacherEl = document.getElementById('adminSelectTeacher');

  if (!isAdmin) {
    if (section) section.style.display = 'none';
    if (selectTeacherWrap) selectTeacherWrap.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';
  if (selectTeacherWrap) selectTeacherWrap.style.display = 'block';

  // Isi dropdown guru untuk mode admin (tanpa duplikasi akun)
  if (selectTeacherEl) {
    const currentVal = selectTeacherEl.value;
    const currentEmail = (currentUser && currentUser.email ? currentUser.email : '').toLowerCase();

    // Satukan daftar guru tanpa duplikasi (unique by email)
    const teachersList = [];
    const seenEmails = new Set();

    // 1. Akun pengguna yang login (Admin) ditaruh pertama
    if (currentUser && currentUser.email) {
      teachersList.push({
        id: currentUser.id || 'admin',
        name: currentUser.full_name || currentUser.username || 'Admin',
        email: currentUser.email,
      });
      seenEmails.add(currentEmail);
    }

    // 2. Tambahkan guru terdaftar lainnya tanpa memasukkan kembali akun yang sama
    for (const t of registeredTeachers) {
      const emailLower = (t.email || '').toLowerCase();
      if (emailLower && !seenEmails.has(emailLower)) {
        seenEmails.add(emailLower);
        teachersList.push({
          id: t.id,
          name: t.name || t.full_name || t.username || 'Guru',
          email: t.email,
        });
      }
    }

    // Bangun HTML options: Nama (email)
    selectTeacherEl.innerHTML = teachersList
      .map((t) => `<option value="${t.email}" data-id="${t.id}" data-name="${t.name}" data-email="${t.email}">${t.name} (${t.email})</option>`)
      .join('');

    // Pertahankan nilai yang sedang dipilih sebelumnya, atau default ke akun login
    if (currentVal && seenEmails.has(currentVal.toLowerCase())) {
      selectTeacherEl.value = currentVal;
    } else if (currentUser && currentUser.email) {
      selectTeacherEl.value = currentUser.email;
    }

    // Sinkronkan nama di badge form
    const formTeacherNameEl = document.getElementById('formTeacherName');
    if (formTeacherNameEl && selectTeacherEl.selectedIndex >= 0) {
      const opt = selectTeacherEl.options[selectTeacherEl.selectedIndex];
      if (opt) {
        formTeacherNameEl.textContent = opt.getAttribute('data-name') || opt.textContent.split('(')[0].trim();
      }
    }

    if (!selectTeacherEl.dataset.hasNameListener) {
      selectTeacherEl.dataset.hasNameListener = 'true';
      selectTeacherEl.addEventListener('change', () => {
        const nameEl = document.getElementById('formTeacherName');
        if (!nameEl) return;
        const opt = selectTeacherEl.options[selectTeacherEl.selectedIndex];
        if (opt) {
          nameEl.textContent = opt.getAttribute('data-name') || opt.textContent.split('(')[0].trim();
        }
      });
    }
  }

  const pendingList = allSubmissions.filter((s) => (s.approval_status || 'Pending') === 'Pending');
  if (pendingCountEl) {
    pendingCountEl.textContent = `${pendingList.length} Pengajuan Menunggu ACC`;
    pendingCountEl.className = `badge-pending-count ${pendingList.length > 0 ? 'has-pending' : ''}`;
  }

  // Pasang listener & sinkronisasi Toolbar Filter Tanggal & Status
  const filterDateInput = document.getElementById('approvalFilterDate');
  const btnFilterToday = document.getElementById('btnFilterToday');
  const btnFilterAllDates = document.getElementById('btnFilterAllDates');
  const filterStatusSelect = document.getElementById('approvalFilterStatus');
  const filterStatusInfo = document.getElementById('filterStatusInfo');
  const approvalToolbar = document.getElementById('approvalToolbar');

  if (approvalToolbar && !approvalToolbar.dataset.hasFilterListeners) {
    approvalToolbar.dataset.hasFilterListeners = 'true';

    if (filterDateInput) {
      filterDateInput.addEventListener('change', () => {
        approvalFilterDate = filterDateInput.value;
        renderAdminApprovalSection();
      });
    }

    if (btnFilterToday) {
      btnFilterToday.addEventListener('click', () => {
        const todayStr = getLocalTodayIso();
        approvalFilterDate = todayStr;
        if (filterDateInput) filterDateInput.value = todayStr;
        renderAdminApprovalSection();
      });
    }

    if (btnFilterAllDates) {
      btnFilterAllDates.addEventListener('click', () => {
        approvalFilterDate = '';
        if (filterDateInput) filterDateInput.value = '';
        renderAdminApprovalSection();
      });
    }

    if (filterStatusSelect) {
      filterStatusSelect.addEventListener('change', () => {
        approvalFilterStatus = filterStatusSelect.value;
        renderAdminApprovalSection();
      });
    }
  }

  // Sinkronkan nilai kontrol toolbar dengan state terkini
  if (filterDateInput) filterDateInput.value = approvalFilterDate;
  if (filterStatusSelect) filterStatusSelect.value = approvalFilterStatus;

  const todayStr = getLocalTodayIso();
  if (btnFilterToday) {
    if (approvalFilterDate === todayStr) {
      btnFilterToday.classList.add('active');
    } else {
      btnFilterToday.classList.remove('active');
    }
  }
  if (btnFilterAllDates) {
    if (!approvalFilterDate) {
      btnFilterAllDates.classList.add('active');
    } else {
      btnFilterAllDates.classList.remove('active');
    }
  }

  // Terapkan filter tanggal & status pada allSubmissions
  let filteredSubmissions = [...allSubmissions];

  if (approvalFilterDate) {
    filteredSubmissions = filteredSubmissions.filter((s) => s.attendance_date === approvalFilterDate);
  }

  if (approvalFilterStatus !== 'all') {
    filteredSubmissions = filteredSubmissions.filter((s) => (s.approval_status || 'Pending') === approvalFilterStatus);
  }

  // Update ringkasan informasi pada toolbar
  if (filterStatusInfo) {
    const dateLabel = approvalFilterDate ? formatDateIndo(approvalFilterDate) : 'Semua Tanggal';
    const statusLabel =
      approvalFilterStatus === 'Pending'
        ? ' (Menunggu ACC)'
        : approvalFilterStatus === 'Approved'
        ? ' (Disetujui)'
        : approvalFilterStatus === 'Rejected'
        ? ' (Ditolak)'
        : '';
    filterStatusInfo.textContent = `Menampilkan: ${dateLabel}${statusLabel} • Total ${filteredSubmissions.length} data`;
  }

  if (!tbody) return;

  if (allSubmissions.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7" class="empty-table-cell">
          Belum ada data pengajuan presensi dewan guru.
        </td>
      </tr>
    `;
    return;
  }

  if (filteredSubmissions.length === 0) {
    let emptyMsg = 'Tidak ada data presensi yang sesuai dengan filter yang dipilih.';
    if (approvalFilterDate && approvalFilterStatus !== 'all') {
      const statusText = approvalFilterStatus === 'Pending' ? 'Menunggu ACC' : approvalFilterStatus === 'Approved' ? 'Disetujui' : 'Ditolak';
      emptyMsg = `Tidak ada presensi berstatus <strong>${statusText}</strong> pada tanggal <strong>${formatDateIndo(approvalFilterDate)}</strong>.`;
    } else if (approvalFilterDate) {
      emptyMsg = `Tidak ada data presensi pada tanggal <strong>${formatDateIndo(approvalFilterDate)}</strong>. Silakan pilih tanggal lain atau klik <strong>Semua Tanggal</strong>.`;
    } else if (approvalFilterStatus !== 'all') {
      const statusText = approvalFilterStatus === 'Pending' ? 'Menunggu ACC' : approvalFilterStatus === 'Approved' ? 'Disetujui' : 'Ditolak';
      emptyMsg = `Tidak ada pengajuan presensi dengan status <strong>${statusText}</strong>.`;
    }

    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7" class="empty-table-cell" style="padding: 32px 16px; color: var(--color-slate-500);">
          ${emptyMsg}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredSubmissions
    .map((item, idx) => {
      const code = item.status;
      const pillClass = code === 'Hadir' ? 'status-pill-hadir' : code === 'Izin' ? 'status-pill-izin' : 'status-pill-sakit';
      const appStatus = item.approval_status || 'Pending';
      const appClass = appStatus === 'Approved' ? 'badge-approved' : appStatus === 'Rejected' ? 'badge-rejected' : 'badge-pending';
      const appLabel = appStatus === 'Approved' ? '✓ Disetujui' : appStatus === 'Rejected' ? '✕ Ditolak' : '⏳ Menunggu ACC';

      return `
        <tr class="attendance-card-item">
          <td class="cell-no" data-label="No">
            <span class="student-num-badge">${idx + 1}</span>
          </td>
          <td class="cell-name" data-label="Nama Guru">
            <div class="teacher-meta-stack">
              <strong class="teacher-name-strong">${item.teacher_name || '-'}</strong>
              <small class="meta-sub">${item.teacher_email || ''}</small>
            </div>
          </td>
          <td class="cell-date" data-label="Tanggal">
            ${formatDateIndo(item.attendance_date)}
          </td>
          <td class="cell-status" data-label="Status">
            <span class="status-pill ${pillClass}">${code}</span>
          </td>
          <td class="cell-note" data-label="Keterangan">
            <span class="note-text">${item.note || '-'}</span>
          </td>
          <td class="cell-approval" data-label="Status ACC">
            <span class="${appClass}">${appLabel}</span>
          </td>
          <td class="cell-actions" data-label="Tindakan">
            <div class="approval-action-menu-wrap">
              <button
                type="button"
                class="btn-approval-action-dots"
                data-id="${item.id}"
                aria-label="Menu Tindakan Admin"
                title="Pilihan tindakan admin"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2"></circle>
                  <circle cx="12" cy="12" r="2"></circle>
                  <circle cx="12" cy="19" r="2"></circle>
                </svg>
              </button>
              <div class="approval-action-dropdown" id="approval-menu-${item.id}" style="display: none;">
                <button
                  type="button"
                  class="dropdown-action-item item-approve"
                  data-id="${item.id}"
                  data-name="${item.teacher_name}"
                  ${appStatus === 'Approved' ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Setujui</span>
                </button>
                <button
                  type="button"
                  class="dropdown-action-item item-reject"
                  data-id="${item.id}"
                  data-name="${item.teacher_name}"
                  ${appStatus === 'Rejected' ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                  <span>Tolak</span>
                </button>
                <div class="approval-menu-divider"></div>
                <button
                  type="button"
                  class="dropdown-action-item item-delete text-danger"
                  data-id="${item.id}"
                  data-name="${item.teacher_name}"
                  data-date="${item.attendance_date}"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                  <span>Hapus</span>
                </button>
              </div>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  // Event listener tombol titik tiga untuk toggle dropdown menu
  tbody.querySelectorAll('.btn-approval-action-dots').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const menu = document.getElementById(`approval-menu-${id}`);

      // Tutup semua menu lainnya terlebih dahulu
      document.querySelectorAll('.approval-action-dropdown').forEach((m) => {
        if (m !== menu) m.style.display = 'none';
      });
      document.querySelectorAll('.btn-approval-action-dots').forEach((b) => {
        if (b !== btn) b.classList.remove('active');
      });

      if (!menu) return;

      const isShown = menu.style.display === 'flex';
      if (isShown) {
        menu.style.display = 'none';
        btn.classList.remove('active');
      } else {
        menu.style.display = 'flex';
        btn.classList.add('active');

        // Deteksi posisi jika terlalu dekat dengan batas bawah viewport
        const rect = menu.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 20) {
          menu.style.top = 'auto';
          menu.style.bottom = 'calc(100% + 4px)';
        } else {
          menu.style.top = 'calc(100% + 4px)';
          menu.style.bottom = 'auto';
        }
      }
    });
  });

  // Tutup menu dropdown jika user mengklik di luar area menu
  if (!window._hasApprovalMenuOutsideListener) {
    window._hasApprovalMenuOutsideListener = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.approval-action-menu-wrap')) {
        document.querySelectorAll('.approval-action-dropdown').forEach((m) => {
          m.style.display = 'none';
        });
        document.querySelectorAll('.btn-approval-action-dots').forEach((b) => {
          b.classList.remove('active');
        });
      }
    });
  }

  // Event listener tombol Setujui di dalam dropdown
  tbody.querySelectorAll('.item-approve').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      const menu = document.getElementById(`approval-menu-${id}`);
      if (menu) menu.style.display = 'none';
      await handleApproveDecision(id, 'Approved', name);
    });
  });

  // Event listener tombol Tolak di dalam dropdown
  tbody.querySelectorAll('.item-reject').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      const menu = document.getElementById(`approval-menu-${id}`);
      if (menu) menu.style.display = 'none';
      await handleApproveDecision(id, 'Rejected', name);
    });
  });

  // Event listener tombol Hapus (Khusus Admin) di dalam dropdown
  tbody.querySelectorAll('.item-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      const dateStr = btn.getAttribute('data-date');
      const menu = document.getElementById(`approval-menu-${id}`);
      if (menu) menu.style.display = 'none';
      await handleDeleteAttendance(id, name, dateStr);
    });
  });
}

async function handleApproveDecision(attendanceId, decision, teacherName) {
  try {
    const adminEmail = currentUser ? currentUser.email : 'yumenoboken@gmail.com';
    const numId = Number(attendanceId);

    // Cari target di allSubmissions & update lokal terlebih dahulu
    const target = allSubmissions.find((s) => Number(s.id) === numId);
    if (target) {
      target.approval_status = decision;
      target.approved_by = currentUser ? (currentUser.full_name || currentUser.username) : 'Admin';

      // 1. Sinkron ke pia_teacher_records untuk Dashboard
      try {
        const rawTRec = localStorage.getItem('pia_teacher_records');
        const tRecMap = rawTRec ? JSON.parse(rawTRec) : {};
        const code = target.status === 'Hadir' ? 'H' : target.status === 'Izin' ? 'I' : 'S';
        if (decision === 'Approved') {
          if (target.user_id) tRecMap[`${target.user_id}_${target.attendance_date}`] = code;
          if (target.teacher_email) tRecMap[`${target.teacher_email.toLowerCase()}_${target.attendance_date}`] = code;
        } else {
          if (target.user_id) delete tRecMap[`${target.user_id}_${target.attendance_date}`];
          if (target.teacher_email) delete tRecMap[`${target.teacher_email.toLowerCase()}_${target.attendance_date}`];
        }
        localStorage.setItem('pia_teacher_records', JSON.stringify(tRecMap));
      } catch (_) {}

      // 2. Update di pia_teacher_attendance_db
      try {
        const localDb = getLocalTeacherDb();
        const localItem = localDb.submissions.find((s) => Number(s.id) === numId);
        if (localItem) {
          localItem.approval_status = decision;
          localItem.approved_by = currentUser ? (currentUser.full_name || currentUser.username) : 'Admin';
          saveLocalTeacherDb(localDb);
        }
      } catch (_) {}
    }

    // 3. Kirim ke API server
    await callTeacherApi('/api/teacher-attendance/approve', {
      method: 'POST',
      body: JSON.stringify({
        admin_email: adminEmail,
        attendance_id: numId,
        decision: decision,
      }),
    });

    showBanner(
      decision === 'Approved'
        ? `Presensi "${teacherName}" telah DISETUJUI dan langsung tersambung ke Dashboard.`
        : `Presensi "${teacherName}" telah DITOLAK.`,
      decision === 'Approved' ? 'success' : 'error'
    );

    // Refresh data
    await loadTeacherAttendanceData();
  } catch (err) {
    showBanner(`Gagal memproses persetujuan: ${err.message}`, 'error');
  }
}

async function handleDeleteAttendance(attendanceId, teacherName, attendanceDate) {
  const formattedDate = formatDateIndo(attendanceDate);
  const confirmed = window.confirm(
    `Apakah Anda yakin ingin menghapus data presensi "${teacherName}" pada tanggal ${formattedDate}?\n\nData yang dihapus akan otomatis dibersihkan dari Dashboard.`
  );
  if (!confirmed) return;

  try {
    const adminEmail = currentUser ? currentUser.email : 'yumenoboken@gmail.com';
    const numId = Number(attendanceId);

    // Cari target
    const target = allSubmissions.find((s) => Number(s.id) === numId);
    if (target) {
      // 1. Bersihkan dari pia_teacher_records (agar terhapus dari Dashboard!)
      try {
        const rawTRec = localStorage.getItem('pia_teacher_records');
        const tRecMap = rawTRec ? JSON.parse(rawTRec) : {};
        if (target.user_id) delete tRecMap[`${target.user_id}_${target.attendance_date}`];
        if (target.teacher_email) delete tRecMap[`${target.teacher_email.toLowerCase()}_${target.attendance_date}`];
        localStorage.setItem('pia_teacher_records', JSON.stringify(tRecMap));
      } catch (_) {}

      // 2. Hapus dari pia_teacher_attendance_db
      try {
        const localDb = getLocalTeacherDb();
        localDb.submissions = localDb.submissions.filter((s) => Number(s.id) !== numId);
        saveLocalTeacherDb(localDb);
      } catch (_) {}
    }

    // 3. Kirim ke API server
    await callTeacherApi('/api/teacher-attendance/delete', {
      method: 'POST',
      body: JSON.stringify({
        admin_email: adminEmail,
        attendance_id: numId,
      }),
    });

    // 4. Update memory list lokal
    allSubmissions = allSubmissions.filter((s) => Number(s.id) !== numId);
    myHistory = myHistory.filter((s) => Number(s.id) !== numId);

    showBanner(`Data presensi "${teacherName}" berhasil dihapus dan disinkronkan ke Dashboard.`, 'success');

    // Refresh tampilan
    await loadTeacherAttendanceData();
  } catch (err) {
    showBanner(`Gagal menghapus data presensi: ${err.message}`, 'error');
  }
}

async function loadTeacherAttendanceData() {
  const email = currentUser ? currentUser.email : '';
  const today = new Date().toISOString().slice(0, 10);

  try {
    const data = await callTeacherApi(`/api/teacher-attendance/overview?email=${encodeURIComponent(email)}&date=${today}`);
    if (data && data.success) {
      if (typeof data.is_admin === 'boolean') {
        isAdmin = data.is_admin;
      }
      todayRecord = data.today_record ? normalizeRecord(data.today_record) : null;
      myHistory = Array.isArray(data.my_history) ? data.my_history.map(normalizeRecord) : [];
      allSubmissions = Array.isArray(data.all_submissions) ? data.all_submissions.map(normalizeRecord) : [];
      registeredTeachers = Array.isArray(data.registered_users) ? data.registered_users : [];

      renderTodayCard(todayRecord);
      renderMyHistoryTable();
      renderAdminApprovalSection();
    }
  } catch (err) {
    console.warn('Gagal memuat overview absensi guru, menggunakan fallback:', err);
    // Gunakan fallback lokal
    const fallback = handleLocalFallback(`/api/teacher-attendance/overview?email=${encodeURIComponent(email)}&date=${today}`, {});
    todayRecord = fallback.today_record ? normalizeRecord(fallback.today_record) : null;
    myHistory = Array.isArray(fallback.my_history) ? fallback.my_history.map(normalizeRecord) : [];
    allSubmissions = Array.isArray(fallback.all_submissions) ? fallback.all_submissions.map(normalizeRecord) : [];
    renderTodayCard(todayRecord);
    renderMyHistoryTable();
    renderAdminApprovalSection();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initHeaderAndAuth();

  // Set default tanggal hari ini
  const dateInput = document.getElementById('attendanceDate');
  if (dateInput) {
    const todayStr = new Date().toISOString().slice(0, 10);
    dateInput.value = todayStr;
    // Batasi agar tidak absen lebih dari 7 hari ke depan
    dateInput.max = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  }

  // Pengaturan dropdown status dan kontainer catatan kondisional
  const teacherStatusSelect = document.getElementById('teacherStatus');
  const noteContainer = document.getElementById('attendanceNoteContainer');
  const noteInput = document.getElementById('attendanceNote');

  function handleStatusChange() {
    if (!teacherStatusSelect || !noteContainer || !noteInput) return;
    const currentVal = teacherStatusSelect.value;
    if (currentVal === 'Izin' || currentVal === 'Sakit') {
      noteContainer.style.display = 'block';
      noteInput.required = true;
      if (currentVal === 'Izin') {
        noteInput.placeholder = 'Wajib diisi: sebutkan keperluan atau alasan izin...';
      } else {
        noteInput.placeholder = 'Wajib diisi: sebutkan kondisi sakit atau surat keterangan istirahat...';
      }
    } else {
      noteContainer.style.display = 'none';
      noteInput.required = false;
      noteInput.value = '';
    }
  }

  if (teacherStatusSelect) {
    teacherStatusSelect.addEventListener('change', handleStatusChange);
    handleStatusChange();
  }

  await loadTeacherAttendanceData();

  // Form Submit
  const form = document.getElementById('teacherAttendanceForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('submitAttendanceBtn');
      const dateVal = document.getElementById('attendanceDate').value;
      const statusSelect = document.getElementById('teacherStatus');
      const statusVal = statusSelect ? statusSelect.value : 'Hadir';
      const noteVal = noteInput ? noteInput.value.trim() : '';
      const adminSelectEl = document.getElementById('adminSelectTeacher');

      let targetEmail = currentUser ? currentUser.email : '';
      let targetName = currentUser ? currentUser.full_name : 'Guru PIA';

      // Jika admin memilih guru lain
      if (isAdmin && adminSelectEl && adminSelectEl.value) {
        const selectedOption = adminSelectEl.options[adminSelectEl.selectedIndex];
        targetEmail = selectedOption.getAttribute('data-email') || targetEmail;
        targetName = selectedOption.getAttribute('data-name') || targetName;
      }

      if (!dateVal || !statusVal) {
        showBanner('Harap lengkapi tanggal dan pilihan status kehadiran.', 'error');
        return;
      }

      // Validasi wajib isi keterangan untuk Izin dan Sakit
      if ((statusVal === 'Izin' || statusVal === 'Sakit') && !noteVal) {
        showBanner(`Keterangan wajib diisi ketika Anda memilih status "${statusVal}".`, 'error');
        if (noteInput) {
          noteInput.focus();
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan Presensi...';

      try {
        const res = await callTeacherApi('/api/teacher-attendance/submit', {
          method: 'POST',
          body: JSON.stringify({
            email: targetEmail,
            name: targetName,
            status: statusVal,
            note: noteVal,
            attendance_date: dateVal,
          }),
        });

        showBanner(
          res.message || 'Presensi kehadiran berhasil dikirim! Menunggu persetujuan (ACC) Admin.',
          'success'
        );

        // Reset note & reset tampilan
        if (noteInput) noteInput.value = '';
        if (teacherStatusSelect) {
          teacherStatusSelect.value = 'Hadir';
          handleStatusChange();
        }

        // Reload data tampilan
        await loadTeacherAttendanceData();
      } catch (err) {
        showBanner(`Gagal menyimpan presensi: ${err.message}`, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Presensi Kehadiran';
      }
    });
  }
});

