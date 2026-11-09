/**
 * Absensi Guru - Sistem Absensi Pendidikan Islam At-Taqwa (PIA)
 * Mendukung presensi harian guru, pemantauan riwayat, dan persetujuan (ACC) oleh Admin.
 */

const API_BASE = '';
const CF_WORKER_API = 'https://absensi-pia.yumenoboken.workers.dev';

let currentUser = null;
let isAdmin = false;
let myHistory = [];
let allSubmissions = [];
let registeredTeachers = [];
let todayRecord = null;

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

async function callTeacherApi(endpoint, options = {}) {
  const isGitHubPages = window.location.hostname.includes('github.io');
  const token = getAuthToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 1. Coba ke server backend lokal (jika bukan GitHub Pages)
  if (!isGitHubPages) {
    try {
      const resp = await fetch(endpoint, { ...options, headers });
      const cType = resp.headers.get('content-type') || '';
      if (cType.includes('application/json')) {
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.detail || data.message || 'Permintaan gagal.');
        }
        return data;
      }
    } catch (err) {
      if (!(err instanceof TypeError) && !String(err.message).includes('JSON')) {
        throw err;
      }
    }
  }

  // 2. Coba ke Cloudflare Worker API
  try {
    const cfUrl = `${CF_WORKER_API}${endpoint}`;
    const cfResp = await fetch(cfUrl, { ...options, headers });
    const cfType = cfResp.headers.get('content-type') || '';
    if (cfType.includes('application/json')) {
      const cfData = await cfResp.json();
      if (!cfResp.ok) {
        throw new Error(cfData.detail || cfData.message || 'Permintaan gagal.');
      }
      return cfData;
    }
  } catch (err) {
    if (
      !(err instanceof TypeError) &&
      !String(err.message).includes('JSON') &&
      !String(err.message).includes('Failed to fetch')
    ) {
      throw err;
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
    const mySubmissions = db.submissions.filter(
      (s) => s.teacher_email.toLowerCase() === email
    );
    const todayRec = mySubmissions.find((s) => s.attendance_date === today) || null;

    return {
      success: true,
      is_admin: isAdmin,
      current_user: currentUser,
      today_record: todayRec,
      my_history: mySubmissions,
      all_submissions: isAdmin ? db.submissions : [],
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
      approval_status: 'Approved',
      approved_by: isAdmin ? (currentUser ? currentUser.full_name : 'Admin') : 'Sistem Otomatis',
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
      message: 'Absensi berhasil disimpan!',
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
      target.approved_by = currentUser ? currentUser.full_name : 'Admin';
      saveLocalTeacherDb(db);
    }
    return {
      success: true,
      message: decision === 'Approved' ? 'Presensi berhasil disetujui.' : 'Presensi ditolak.',
    };
  }

  if (endpoint === '/api/teacher-attendance/delete') {
    const body = options.body ? JSON.parse(options.body) : {};
    const attendanceId = Number(body.attendance_id);
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
    if (e.key === 'Escape') {
      toggleMenu(true);
    }
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
      const formTeacherNameEl = document.getElementById('formTeacherName');

      const userName = currentUser.full_name || currentUser.username || 'Pengguna PIA';
      const userEmail = currentUser.email || 'Pendidikan Islam At-Taqwa';

      if (nameEl) nameEl.textContent = userName;
      if (emailEl) emailEl.textContent = userEmail;
      if (mobileNameEl) mobileNameEl.textContent = userName;
      if (mobileEmailEl) mobileEmailEl.textContent = userEmail;

      if (formTeacherNameEl) {
        formTeacherNameEl.textContent = userName;
      }

      const userEmailLower = (currentUser.email || '').toLowerCase();
      isAdmin = userEmailLower === 'yumenoboken@gmail.com' || currentUser.role === 'admin';
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
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  document.getElementById('todayDateVal').textContent = formatDateIndo(record.attendance_date);

  const statusVal = document.getElementById('todayStatusVal');
  const code = record.status;
  const badgeClass = code === 'Hadir' ? 'status-pill-hadir' : code === 'Izin' ? 'status-pill-izin' : 'status-pill-sakit';
  statusVal.innerHTML = `<span class="status-pill ${badgeClass}">${code}</span>`;

  document.getElementById('todayNoteVal').textContent = record.note || '(Tidak ada catatan)';

  const approvalVal = document.getElementById('todayApprovalVal');
  const appStatus = record.approval_status || 'Pending';
  if (appStatus === 'Approved') {
    approvalVal.innerHTML = `<span class="badge-approved">✓ Disetujui (${record.approved_by || 'Admin'})</span>`;
  } else if (appStatus === 'Rejected') {
    approvalVal.innerHTML = `<span class="badge-rejected">✕ Ditolak</span>`;
  } else {
    approvalVal.innerHTML = `<span class="badge-pending">⏳ Menunggu Persetujuan Admin</span>`;
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

  // Isi dropdown guru untuk mode admin
  if (selectTeacherEl && registeredTeachers.length > 0) {
    const currentVal = selectTeacherEl.value;
    selectTeacherEl.innerHTML = `<option value="">-- Diri Sendiri (${currentUser ? currentUser.full_name : 'Admin'}) --</option>` +
      registeredTeachers
        .map((t) => `<option value="${t.id}" data-name="${t.name || t.full_name}" data-email="${t.email}">${t.name || t.full_name} (${t.email})</option>`)
        .join('');
    if (currentVal) selectTeacherEl.value = currentVal;

    if (!selectTeacherEl.dataset.hasNameListener) {
      selectTeacherEl.dataset.hasNameListener = 'true';
      selectTeacherEl.addEventListener('change', () => {
        const formTeacherNameEl = document.getElementById('formTeacherName');
        if (!formTeacherNameEl) return;
        if (selectTeacherEl.value) {
          const opt = selectTeacherEl.options[selectTeacherEl.selectedIndex];
          formTeacherNameEl.textContent = opt.getAttribute('data-name') || opt.textContent.split('(')[0].trim();
        } else {
          formTeacherNameEl.textContent = currentUser ? (currentUser.full_name || currentUser.username) : 'Guru';
        }
      });
    }
  }

  const pendingList = allSubmissions.filter((s) => (s.approval_status || 'Pending') === 'Pending');
  if (pendingCountEl) {
    pendingCountEl.textContent = `${pendingList.length} Pengajuan Menunggu ACC`;
    pendingCountEl.className = `badge-pending-count ${pendingList.length > 0 ? 'has-pending' : ''}`;
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

  tbody.innerHTML = allSubmissions
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
            <strong>${item.teacher_name || '-'}</strong>
            <small class="meta-sub">${item.teacher_email || ''}</small>
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
          <td class="cell-actions" data-label="Tindakan Admin">
            <div class="action-btn-group">
              <button
                type="button"
                class="btn-action-approve"
                data-id="${item.id}"
                data-name="${item.teacher_name}"
                title="Setujui presensi guru ini"
              >
                ✓ Setujui
              </button>
              <button
                type="button"
                class="btn-action-reject"
                data-id="${item.id}"
                data-name="${item.teacher_name}"
                title="Tolak presensi guru ini"
              >
                ✕ Tolak
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  // Event listener tombol Setujui
  tbody.querySelectorAll('.btn-action-approve').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      await handleApproveDecision(id, 'Approved', name);
    });
  });

  // Event listener tombol Tolak
  tbody.querySelectorAll('.btn-action-reject').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      await handleApproveDecision(id, 'Rejected', name);
    });
  });
}

async function handleApproveDecision(attendanceId, decision, teacherName) {
  try {
    const adminEmail = currentUser ? currentUser.email : 'yumenoboken@gmail.com';
    const res = await callTeacherApi('/api/teacher-attendance/approve', {
      method: 'POST',
      body: JSON.stringify({
        admin_email: adminEmail,
        attendance_id: attendanceId,
        decision: decision,
      }),
    });

    showBanner(
      decision === 'Approved'
        ? `Presensi "${teacherName}" telah DISETUJUI dan langsung tersinkron ke Dashboard.`
        : `Presensi "${teacherName}" telah DITOLAK.`,
      decision === 'Approved' ? 'success' : 'error'
    );

    // Refresh data
    await loadTeacherAttendanceData();
  } catch (err) {
    showBanner(`Gagal memproses persetujuan: ${err.message}`, 'error');
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
      todayRecord = data.today_record || null;
      myHistory = Array.isArray(data.my_history) ? data.my_history : [];
      allSubmissions = Array.isArray(data.all_submissions) ? data.all_submissions : [];
      registeredTeachers = Array.isArray(data.registered_users) ? data.registered_users : [];

      renderTodayCard(todayRecord);
      renderMyHistoryTable();
      renderAdminApprovalSection();
    }
  } catch (err) {
    console.warn('Gagal memuat overview absensi guru, menggunakan fallback:', err);
    // Gunakan fallback lokal
    const fallback = handleLocalFallback(`/api/teacher-attendance/overview?email=${encodeURIComponent(email)}&date=${today}`, {});
    todayRecord = fallback.today_record;
    myHistory = fallback.my_history;
    allSubmissions = fallback.all_submissions;
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

        // Langsung simpan ke localStorage pia_teacher_records agar sinkron instan di Dashboard
        try {
          const code = statusVal === 'Hadir' ? 'H' : statusVal === 'Izin' ? 'I' : 'S';
          const rawTRec = localStorage.getItem('pia_teacher_records');
          const tRecMap = rawTRec ? JSON.parse(rawTRec) : {};
          if (currentUser && currentUser.id) {
            tRecMap[`${currentUser.id}_${dateVal}`] = code;
          }
          if (targetEmail) {
            tRecMap[`${targetEmail.toLowerCase()}_${dateVal}`] = code;
          }
          localStorage.setItem('pia_teacher_records', JSON.stringify(tRecMap));
        } catch (_) {}

        showBanner(
          res.message || 'Presensi kehadiran berhasil dikirim dan tersinkron ke Dashboard!',
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

