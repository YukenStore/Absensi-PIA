/**
 * Absensi Siswa - Sistem Absensi Pendidikan Islam At-Taqwa (PIA)
 * Mencatat presensi siswa perorangan via dropdown nama siswa (sesuai Data Dashboard)
 * Tersinkronisasi penuh ke Database SQL & Matriks Dashboard.
 */

const API_BASES = window.location.hostname.includes('github.io')
  ? ['https://absensi-pia.yumenoboken.workers.dev', 'http://localhost:5173']
  : ['', 'http://localhost:5173', 'https://absensi-pia.yumenoboken.workers.dev'];

let currentUser = null;
let studentsList = [];
let attendanceByDate = {}; // { [date]: { [student_id]: { status, note, recorded_by } } }

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

      const userName = currentUser.full_name || currentUser.username || 'Pengguna PIA';
      const userEmail = currentUser.email || 'Pendidikan Islam At-Taqwa';

      if (nameEl) nameEl.textContent = userName;
      if (emailEl) emailEl.textContent = userEmail;
      if (mobileNameEl) mobileNameEl.textContent = userName;
      if (mobileEmailEl) mobileEmailEl.textContent = userEmail;
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

function loadLocalStudentsAndAttendance() {
  // 1. Muat siswa dari pia_students_db
  try {
    const raw = localStorage.getItem('pia_students_db');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        studentsList = parsed.map((s) => ({
          id: s.id,
          name: s.name || s.full_name,
          class_name: s.class_name || '',
          birth_date: s.birth_date || '',
        }));
      }
    }
  } catch (_) {}

  // 2. Muat riwayat presensi dari pia_student_records
  try {
    const rawRec = localStorage.getItem('pia_student_records');
    if (rawRec) {
      const parsed = JSON.parse(rawRec);
      if (parsed && typeof parsed === 'object') {
        attendanceByDate = parsed;
      }
    }
  } catch (_) {}
}

function renderStudentDropdown() {
  const selectEl = document.getElementById('studentSelect');
  if (!selectEl) return;

  if (studentsList.length === 0) {
    selectEl.innerHTML = '<option value="">Belum ada data siswa terdaftar di Dashboard</option>';
    return;
  }

  const currentVal = selectEl.value;
  selectEl.innerHTML =
    '<option value="">-- Pilih Nama Siswa --</option>' +
    studentsList
      .map(
        (s) =>
          `<option value="${s.id}" data-name="${s.name || s.full_name}" data-class="${s.class_name || ''}">${s.name || s.full_name} (${s.class_name || 'Tanpa Kelas'})</option>`
      )
      .join('');

  if (currentVal && studentsList.some((s) => String(s.id) === String(currentVal))) {
    selectEl.value = currentVal;
  }
}

function updateStudentRecordPreview() {
  const selectEl = document.getElementById('studentSelect');
  const dateInput = document.getElementById('attendanceDate');
  const classBadge = document.getElementById('studentClassBadge');
  const classText = document.getElementById('studentClassText');
  const recordedCard = document.getElementById('studentRecordedCard');
  const recordedStudentName = document.getElementById('recordedStudentName');
  const recordedDateVal = document.getElementById('recordedDateVal');
  const recordedStatusVal = document.getElementById('recordedStatusVal');
  const recordedNoteVal = document.getElementById('recordedNoteVal');
  const statusSelect = document.getElementById('studentStatus');
  const noteInput = document.getElementById('attendanceNote');
  const noteContainer = document.getElementById('attendanceNoteContainer');

  if (!selectEl || !dateInput) return;

  const studentId = selectEl.value;
  const dateVal = dateInput.value;

  if (!studentId) {
    if (classBadge) classBadge.style.display = 'none';
    if (recordedCard) recordedCard.style.display = 'none';
    return;
  }

  const selectedOpt = selectEl.options[selectEl.selectedIndex];
  const studentName = selectedOpt.getAttribute('data-name') || selectedOpt.textContent.split('(')[0].trim();
  const className = selectedOpt.getAttribute('data-class') || '';

  if (classBadge && classText) {
    classText.textContent = className ? `Kelas ${className}` : 'Siswa PIA';
    classBadge.style.display = 'inline-flex';
  }

  // Cek apakah ada record di tanggal ini
  const dateRecords = attendanceByDate[dateVal] || {};
  const existingRecord = dateRecords[studentId] || null;

  if (existingRecord && existingRecord.status) {
    if (recordedCard) {
      recordedCard.style.display = 'block';
      if (recordedStudentName) recordedStudentName.textContent = studentName;
      if (recordedDateVal) recordedDateVal.textContent = formatDateIndo(dateVal);
      if (recordedStatusVal) {
        recordedStatusVal.textContent = existingRecord.status;
        const colorClass =
          existingRecord.status === 'Hadir'
            ? 'color: #10b981;'
            : existingRecord.status === 'Izin'
            ? 'color: #2563eb;'
            : existingRecord.status === 'Sakit'
            ? 'color: #f59e0b;'
            : 'color: #ef4444;';
        recordedStatusVal.setAttribute('style', `font-weight: 800; ${colorClass}`);
      }
      if (recordedNoteVal) {
        recordedNoteVal.textContent = existingRecord.note || 'Tidak ada catatan.';
      }
    }

    if (statusSelect) {
      statusSelect.value = existingRecord.status;
    }
    if (noteInput) {
      noteInput.value = existingRecord.note || '';
    }

    if (noteContainer) {
      noteContainer.style.display =
        existingRecord.status === 'Hadir' ? 'none' : 'block';
    }
  } else {
    if (recordedCard) recordedCard.style.display = 'none';
    if (statusSelect && !statusSelect.dataset.userModified) {
      statusSelect.value = 'Hadir';
    }
    if (noteInput && !noteInput.dataset.userModified) {
      noteInput.value = '';
    }
    if (noteContainer) {
      const curSt = statusSelect ? statusSelect.value : 'Hadir';
      noteContainer.style.display = curSt === 'Hadir' ? 'none' : 'block';
    }
  }
}

async function fetchServerStudentsAndDate(dateStr) {
  try {
    const data = await callApi(`/api/student-attendance?date=${encodeURIComponent(dateStr)}`);
    if (data) {
      if (Array.isArray(data.students) && data.students.length > 0) {
        studentsList = data.students.map((s) => ({
          id: s.id,
          name: s.name || s.full_name,
          class_name: s.class_name || '',
          birth_date: s.birth_date || '',
        }));
        renderStudentDropdown();
      }

      if (data.attendance && typeof data.attendance === 'object') {
        if (!attendanceByDate[dateStr]) attendanceByDate[dateStr] = {};
        Object.assign(attendanceByDate[dateStr], data.attendance);
      }
      updateStudentRecordPreview();
    }
  } catch (_) {}

  // Fallback juga ke overview jika daftar siswa masih kosong
  if (studentsList.length === 0) {
    try {
      const overview = await callApi('/api/attendance/overview');
      if (overview && Array.isArray(overview.students)) {
        studentsList = overview.students.map((s) => ({
          id: s.id,
          name: s.name || s.full_name,
          class_name: s.class_name || '',
          birth_date: s.birth_date || '',
        }));
        renderStudentDropdown();
      }
    } catch (_) {}
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initHeaderAndAuth();
  loadLocalStudentsAndAttendance();

  const dateInput = document.getElementById('attendanceDate');
  const studentSelect = document.getElementById('studentSelect');
  const statusSelect = document.getElementById('studentStatus');
  const noteContainer = document.getElementById('attendanceNoteContainer');
  const noteInput = document.getElementById('attendanceNote');
  const noteRequiredStar = document.getElementById('noteRequiredStar');
  const noteFieldHint = document.getElementById('noteFieldHint');
  const form = document.getElementById('studentAttendanceForm');
  const submitBtn = document.getElementById('submitStudentAttendanceBtn');

  // Set tanggal default hari ini
  const todayStr = new Date().toISOString().slice(0, 10);
  if (dateInput) {
    dateInput.value = todayStr;
  }

  renderStudentDropdown();
  fetchServerStudentsAndDate(todayStr);

  if (studentSelect) {
    studentSelect.addEventListener('change', () => {
      if (statusSelect) delete statusSelect.dataset.userModified;
      if (noteInput) delete noteInput.dataset.userModified;
      updateStudentRecordPreview();
    });
  }

  if (dateInput) {
    dateInput.addEventListener('change', () => {
      const newDate = dateInput.value;
      if (newDate) {
        fetchServerStudentsAndDate(newDate);
      }
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      statusSelect.dataset.userModified = 'true';
      const st = statusSelect.value;
      if (st === 'Hadir') {
        if (noteContainer) noteContainer.style.display = 'none';
        if (noteInput) noteInput.required = false;
      } else {
        if (noteContainer) noteContainer.style.display = 'block';
        if (st === 'Izin' || st === 'Sakit') {
          if (noteRequiredStar) noteRequiredStar.style.display = 'inline';
          if (noteFieldHint) noteFieldHint.textContent = `Keterangan wajib diisi ketika memilih status "${st}".`;
          if (noteInput) noteInput.placeholder = `Jelaskan alasan atau surat keterangan ${st}...`;
        } else {
          // Alfa
          if (noteRequiredStar) noteRequiredStar.style.display = 'none';
          if (noteFieldHint) noteFieldHint.textContent = 'Keterangan opsional untuk status Alfa.';
          if (noteInput) noteInput.placeholder = 'Keterangan tambahan (opsional)...';
        }
      }
    });
  }

  if (noteInput) {
    noteInput.addEventListener('input', () => {
      noteInput.dataset.userModified = 'true';
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const studentId = studentSelect ? studentSelect.value : '';
      const dateVal = dateInput ? dateInput.value : '';
      const statusVal = statusSelect ? statusSelect.value : 'Hadir';
      const noteVal = noteInput ? noteInput.value.trim() : '';

      if (!studentId) {
        showBanner('Harap pilih nama siswa terlebih dahulu.', 'error');
        if (studentSelect) studentSelect.focus();
        return;
      }

      if (!dateVal) {
        showBanner('Harap tentukan tanggal presensi kehadiran.', 'error');
        if (dateInput) dateInput.focus();
        return;
      }

      if ((statusVal === 'Izin' || statusVal === 'Sakit') && !noteVal) {
        showBanner(`Keterangan wajib diisi ketika memilih status "${statusVal}".`, 'error');
        if (noteInput) noteInput.focus();
        return;
      }

      const selectedOpt = studentSelect.options[studentSelect.selectedIndex];
      const studentName = selectedOpt.getAttribute('data-name') || selectedOpt.textContent.split('(')[0].trim();
      const recordedBy = currentUser ? (currentUser.full_name || currentUser.username) : 'Guru PIA';

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Menyimpan Presensi...</span>';
      }

      try {
        // Simpan langsung melalui endpoint single atau batch
        const payload = {
          student_id: Number(studentId),
          attendance_date: dateVal,
          status: statusVal,
          note: noteVal,
          recorded_by: recordedBy,
          records: [
            {
              student_id: Number(studentId),
              status: statusVal,
              note: noteVal,
            },
          ],
        };

        let result = await callApi('/api/student-attendance', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (!result) {
          result = await callApi('/api/student-attendance/batch-save', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        }

        // Sinkronkan ke memory & localStorage pia_student_records
        if (!attendanceByDate[dateVal]) attendanceByDate[dateVal] = {};
        attendanceByDate[dateVal][studentId] = {
          status: statusVal,
          note: noteVal,
          recorded_by: recordedBy,
        };

        try {
          let recDb = {};
          const raw = localStorage.getItem('pia_student_records');
          if (raw) recDb = JSON.parse(raw) || {};
          if (!recDb[dateVal]) recDb[dateVal] = {};
          recDb[dateVal][studentId] = {
            status: statusVal,
            note: noteVal,
            recorded_by: recordedBy,
          };
          localStorage.setItem('pia_student_records', JSON.stringify(recDb));
        } catch (_) {}

        showBanner(`✓ Presensi untuk siswa "${studentName}" tanggal ${formatDateIndo(dateVal)} berhasil disimpan dan tersinkron ke Dashboard!`, 'success');
        updateStudentRecordPreview();
      } catch (err) {
        showBanner(`Gagal menyimpan presensi: ${err.message}`, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Kirim Presensi Kehadiran Siswa</span>';
        }
      }
    });
  }
});
