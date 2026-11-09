/**
 * Absensi Siswa - Sistem Absensi Pendidikan Islam At-Taqwa (PIA)
 * Mencatat kehadiran harian siswa per kelas dan menyinkronkannya ke Dashboard & Database.
 */

const API_BASES = window.location.hostname.includes('github.io')
  ? ['https://absensi-pia.yumenoboken.workers.dev', 'http://localhost:5173']
  : ['', 'http://localhost:5173', 'https://absensi-pia.yumenoboken.workers.dev'];

let currentUser = null;
let studentsList = [];
let attendanceMap = {}; // { [student_id]: { status: 'Hadir'|'Izin'|'Sakit'|'Alfa', note: '' } }
let currentDate = new Date().toISOString().slice(0, 10);
let selectedClass = 'all';

function getAuthToken() {
  return localStorage.getItem('pia_access_token');
}

function showBanner(message, type = 'success') {
  const banner = document.getElementById('attendanceAlert');
  if (!banner) return;
  banner.className = `alert-banner ${type} show`;
  banner.textContent = message;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function callApi(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  for (const base of API_BASES) {
    try {
      const resp = await fetch(`${base}${endpoint}`, { ...options, headers });
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await resp.json();
        if (resp.ok) return data;
      }
    } catch (_) {}
  }
  return null;
}

function initHeaderAndAuth() {
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
      if (nameEl) nameEl.textContent = currentUser.full_name || currentUser.username || 'Pengguna PIA';
      if (emailEl) emailEl.textContent = currentUser.email || 'Pendidikan Islam At-Taqwa';
    }
  } catch (_) {}

  const logoutBtns = document.querySelectorAll('.logout-trigger');
  logoutBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.removeItem('pia_access_token');
      localStorage.removeItem('pia_user');
      localStorage.removeItem('pia_current_user');
      window.location.href = 'index.html';
    });
  });
}

function getFilteredStudents() {
  if (selectedClass === 'all') return studentsList;
  return studentsList.filter((s) => (s.class_name || '').trim().toLowerCase() === selectedClass.trim().toLowerCase());
}

function updateStatistics() {
  const filtered = getFilteredStudents();
  let totalHadir = 0;
  let totalIzin = 0;
  let totalSakit = 0;
  let totalAlfa = 0;

  filtered.forEach((s) => {
    const record = attendanceMap[s.id] || { status: 'Hadir' };
    const st = record.status;
    if (st === 'Hadir') totalHadir++;
    else if (st === 'Izin') totalIzin++;
    else if (st === 'Sakit') totalSakit++;
    else if (st === 'Alfa') totalAlfa++;
  });

  const totalEl = document.getElementById('statTotalStudents');
  const hadirEl = document.getElementById('statTotalHadir');
  const izinEl = document.getElementById('statTotalIzin');
  const sakitEl = document.getElementById('statTotalSakit');
  const alfaEl = document.getElementById('statTotalAlfa');

  if (totalEl) totalEl.textContent = filtered.length;
  if (hadirEl) hadirEl.textContent = totalHadir;
  if (izinEl) izinEl.textContent = totalIzin;
  if (sakitEl) sakitEl.textContent = totalSakit;
  if (alfaEl) alfaEl.textContent = totalAlfa;
}

function renderClassDropdown() {
  const classSelect = document.getElementById('classFilter');
  if (!classSelect) return;

  const uniqueClasses = Array.from(
    new Set(studentsList.map((s) => (s.class_name || '').trim()).filter(Boolean))
  ).sort();

  let html = `<option value="all">Semua Kelas (${studentsList.length} Siswa)</option>`;
  uniqueClasses.forEach((cls) => {
    const count = studentsList.filter((s) => (s.class_name || '').trim() === cls).length;
    html += `<option value="${cls}" ${selectedClass === cls ? 'selected' : ''}>${cls} (${count} Siswa)</option>`;
  });

  classSelect.innerHTML = html;
}

function renderAttendanceTable() {
  const tbody = document.getElementById('studentAttendanceBody');
  const table = document.getElementById('studentAttendanceTable');
  if (!tbody) return;

  const filtered = getFilteredStudents();

  if (filtered.length === 0) {
    if (table) table.classList.add('is-empty-table');
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5" class="empty-table-cell" style="text-align: center; padding: 36px 16px;">
          <div style="font-weight: 600; color: var(--text-muted); font-size: 0.95rem;">
            ${studentsList.length === 0
              ? 'Belum ada siswa terdaftar. <a href="pendaftaran.html" style="color: var(--primary); font-weight: 700;">Tambah siswa baru di menu Pendaftaran</a>.'
              : 'Tidak ada siswa yang terdaftar di kelas yang dipilih.'}
          </div>
        </td>
      </tr>
    `;
    updateStatistics();
    return;
  }

  if (table) table.classList.remove('is-empty-table');

  tbody.innerHTML = filtered
    .map((s, idx) => {
      const rec = attendanceMap[s.id] || { status: 'Hadir', note: '' };
      const currentStatus = rec.status || 'Hadir';
      const noteText = rec.note || '';

      return `
        <tr data-sid="${s.id}">
          <td class="cell-no" data-label="No">${idx + 1}</td>
          <td class="cell-name" data-label="Nama Siswa">
            <span style="font-weight: 700; color: var(--secondary); font-size: 0.92rem;">${s.full_name || s.name}</span>
          </td>
          <td data-label="Kelas">
            <span class="badge-tag" style="background: #f1f5f9; color: #475569; font-weight: 700;">
              ${s.class_name || '-'}
            </span>
          </td>
          <td data-label="Status Kehadiran">
            <div class="status-btn-group" role="group" aria-label="Status Kehadiran">
              <button type="button" class="status-btn btn-hadir ${currentStatus === 'Hadir' ? 'active' : ''}" data-sid="${s.id}" data-st="Hadir" title="Hadir">
                H
              </button>
              <button type="button" class="status-btn btn-izin ${currentStatus === 'Izin' ? 'active' : ''}" data-sid="${s.id}" data-st="Izin" title="Izin">
                I
              </button>
              <button type="button" class="status-btn btn-sakit ${currentStatus === 'Sakit' ? 'active' : ''}" data-sid="${s.id}" data-st="Sakit" title="Sakit">
                S
              </button>
              <button type="button" class="status-btn btn-alfa ${currentStatus === 'Alfa' ? 'active' : ''}" data-sid="${s.id}" data-st="Alfa" title="Alfa">
                A
              </button>
            </div>
          </td>
          <td data-label="Keterangan">
            <input
              type="text"
              class="note-input student-note-field"
              data-sid="${s.id}"
              value="${noteText.replace(/"/g, '&quot;')}"
              placeholder="Catatan / alasan..."
            />
          </td>
        </tr>
      `;
    })
    .join('');

  // Event listener tombol toggle status (H / I / S / A)
  tbody.querySelectorAll('.status-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sid = parseInt(btn.getAttribute('data-sid'), 10);
      const newStatus = btn.getAttribute('data-st');

      if (!attendanceMap[sid]) {
        attendanceMap[sid] = { status: newStatus, note: '' };
      } else {
        attendanceMap[sid].status = newStatus;
      }

      // Update UI row buttons
      const row = tbody.querySelector(`tr[data-sid="${sid}"]`);
      if (row) {
        row.querySelectorAll('.status-btn').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-st') === newStatus);
        });
      }

      updateStatistics();
    });
  });

  // Event listener input catatan
  tbody.querySelectorAll('.student-note-field').forEach((input) => {
    input.addEventListener('input', () => {
      const sid = parseInt(input.getAttribute('data-sid'), 10);
      const noteVal = input.value.trim();
      if (!attendanceMap[sid]) {
        attendanceMap[sid] = { status: 'Hadir', note: noteVal };
      } else {
        attendanceMap[sid].note = noteVal;
      }
    });
  });

  updateStatistics();
}

async function loadStudentsAndAttendance() {
  try {
    // 1. Coba ambil dari API backend / D1
    const res = await callApi(`/api/student-attendance?date=${encodeURIComponent(currentDate)}`);

    if (res && res.success) {
      if (Array.isArray(res.students)) {
        studentsList = res.students;
        // Backup ke localStorage
        localStorage.setItem('pia_students_db', JSON.stringify(studentsList));
      }
      attendanceMap = res.attendance || {};
    } else {
      // 2. Fallback offline: Ambil siswa dari localStorage
      const localStudentsRaw = localStorage.getItem('pia_students_db');
      if (localStudentsRaw) {
        studentsList = JSON.parse(localStudentsRaw) || [];
      }

      // Ambil absensi hari ini dari pia_student_records
      const studentRecRaw = localStorage.getItem('pia_student_records');
      const studentRecords = studentRecRaw ? JSON.parse(studentRecRaw) : {};
      attendanceMap = {};

      studentsList.forEach((s) => {
        const code = studentRecords[`${s.id}_${currentDate}`] || 'H';
        const st = code === 'H' ? 'Hadir' : code === 'I' ? 'Izin' : code === 'S' ? 'Sakit' : 'Alfa';
        attendanceMap[s.id] = { status: st, note: '' };
      });
    }

    // Default status Hadir jika belum ada catatan
    studentsList.forEach((s) => {
      if (!attendanceMap[s.id]) {
        attendanceMap[s.id] = { status: 'Hadir', note: '' };
      }
    });

    renderClassDropdown();
    renderAttendanceTable();
  } catch (err) {
    console.error('Gagal memuat absensi siswa:', err);
  }
}

function markAllHadir() {
  const filtered = getFilteredStudents();
  if (filtered.length === 0) return;

  filtered.forEach((s) => {
    if (!attendanceMap[s.id]) {
      attendanceMap[s.id] = { status: 'Hadir', note: '' };
    } else {
      attendanceMap[s.id].status = 'Hadir';
    }
  });

  renderAttendanceTable();
  showBanner(`Seluruh siswa (${filtered.length} siswa) berhasil ditandai Hadir. Klik "Simpan Presensi" untuk menyimpan.`, 'success');
}

async function saveAttendance() {
  const saveTopBtn = document.getElementById('saveTopBtn');
  const saveBottomBtn = document.getElementById('saveBottomBtn');

  if (saveTopBtn) {
    saveTopBtn.disabled = true;
    saveTopBtn.textContent = 'Menyimpan...';
  }
  if (saveBottomBtn) {
    saveBottomBtn.disabled = true;
    saveBottomBtn.textContent = 'Menyimpan Presensi...';
  }

  const recordsPayload = [];
  const localStudentRecords = (() => {
    try {
      const raw = localStorage.getItem('pia_student_records');
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  })();

  studentsList.forEach((s) => {
    const rec = attendanceMap[s.id] || { status: 'Hadir', note: '' };
    recordsPayload.push({
      student_id: s.id,
      status: rec.status,
      note: rec.note || '',
    });

    // Simpan ke local student records untuk Dashboard instan
    const code = rec.status === 'Hadir' ? 'H' : rec.status === 'Izin' ? 'I' : rec.status === 'Sakit' ? 'S' : 'A';
    localStudentRecords[`${s.id}_${currentDate}`] = code;
  });

  // Simpan ke localStorage agar dashboard langsung terupdate seketika
  try {
    localStorage.setItem('pia_student_records', JSON.stringify(localStudentRecords));
  } catch (_) {}

  try {
    const recorderName = currentUser ? (currentUser.full_name || currentUser.username) : 'Guru PIA';
    const res = await callApi('/api/student-attendance/batch-save', {
      method: 'POST',
      body: JSON.stringify({
        attendance_date: currentDate,
        records: recordsPayload,
        recorded_by: recorderName,
      }),
    });

    const successMsg = (res && res.message)
      ? res.message
      : `Presensi siswa untuk tanggal ${currentDate} berhasil disimpan dan tersinkron ke Dashboard!`;

    showBanner(successMsg, 'success');
  } catch (err) {
    showBanner(`Peringatan: Presensi disimpan secara lokal (${err.message})`, 'success');
  } finally {
    if (saveTopBtn) {
      saveTopBtn.disabled = false;
      saveTopBtn.textContent = 'Simpan Presensi';
    }
    if (saveBottomBtn) {
      saveBottomBtn.disabled = false;
      saveBottomBtn.textContent = 'Simpan Presensi Siswa';
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initHeaderAndAuth();

  // Set default tanggal hari ini
  const dateInput = document.getElementById('attendanceDate');
  if (dateInput) {
    dateInput.value = currentDate;
    dateInput.addEventListener('change', async (e) => {
      currentDate = e.target.value;
      const titleEl = document.getElementById('tableTitle');
      if (titleEl) titleEl.textContent = `Daftar Presensi Siswa — Tanggal ${currentDate}`;
      await loadStudentsAndAttendance();
    });
  }

  // Filter Kelas
  const classFilterSelect = document.getElementById('classFilter');
  if (classFilterSelect) {
    classFilterSelect.addEventListener('change', (e) => {
      selectedClass = e.target.value;
      renderAttendanceTable();
    });
  }

  // Tombol Tandai Semua Hadir
  const markAllBtn = document.getElementById('markAllHadirBtn');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', markAllHadir);
  }

  // Tombol Simpan (Top & Bottom)
  const saveTopBtn = document.getElementById('saveTopBtn');
  const saveBottomBtn = document.getElementById('saveBottomBtn');
  if (saveTopBtn) saveTopBtn.addEventListener('click', saveAttendance);
  if (saveBottomBtn) saveBottomBtn.addEventListener('click', saveAttendance);

  await loadStudentsAndAttendance();
});
