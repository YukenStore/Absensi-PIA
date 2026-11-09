/**
 * Logika Halaman Pendaftaran Siswa
 * Sistem Informasi Pendidikan Islam At-Taqwa (PIA)
 * Terhubung Langsung ke Database SQL (SQLite Lokal & Cloudflare D1)
 */

const MONTH_NAMES_ID = [
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

const API_BASES = window.location.hostname.includes('github.io')
  ? ['http://localhost:5173', 'https://absensi-pia.yumenoboken.workers.dev']
  : ['', 'http://localhost:5173', 'https://absensi-pia.yumenoboken.workers.dev'];

let studentsList = [];
let currentUser = null;

async function callDatabaseApi(apiPath, options = {}) {
  for (const base of API_BASES) {
    try {
      const resp = await fetch(`${base}${apiPath}`, options);
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.detail || data.message || 'Permintaan database gagal.');
        }
        return data;
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
  }
  return null;
}

function initHeaderAndAuth() {
  const nameEl = document.getElementById('activeUserName');
  const emailEl = document.getElementById('activeUserEmail');
  try {
    const rawUser = localStorage.getItem('pia_user');
    if (rawUser) {
      currentUser = JSON.parse(rawUser);
      if (currentUser.full_name && nameEl) nameEl.textContent = currentUser.full_name;
      if (currentUser.email && emailEl) emailEl.textContent = currentUser.email;
    }
  } catch (_) {}

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

function showBanner(msg, type = 'success') {
  const banner = document.getElementById('pendaftaranAlert');
  if (!banner) return;
  banner.className = `alert-banner ${type} show`;
  banner.textContent = msg;
}

function formatBirthDateId(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return dateStr;
  return `${day} ${MONTH_NAMES_ID[monthIdx]} ${year}`;
}

function loadLocalStudents() {
  try {
    const raw = localStorage.getItem('pia_students_db');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        studentsList = parsed;
      }
    }
  } catch (_) {}
}

function saveLocalStudents() {
  try {
    localStorage.setItem('pia_students_db', JSON.stringify(studentsList));
  } catch (_) {}
}

async function fetchStudentsFromServer() {
  loadLocalStudents();
  renderStudentsTable();

  try {
    // Ambil data siswa resmi dari database backend (source of truth)
    const getData = await callDatabaseApi('/api/students');
    if (getData && Array.isArray(getData.students)) {
      studentsList = getData.students;
      saveLocalStudents();
      renderStudentsTable();
      return;
    }
  } catch (err) {
    console.warn('Gagal memuat siswa dari server, menggunakan cache lokal:', err);
  }
}

function renderStudentsTable() {
  const tableEl = document.getElementById('registeredStudentsTable');
  const bodyEl = document.getElementById('registeredStudentsBody');
  const countEl = document.getElementById('totalStudentsCount');
  if (countEl) countEl.textContent = String(studentsList.length);
  if (!bodyEl) return;

  if (studentsList.length === 0) {
    if (tableEl) tableEl.classList.add('is-empty-table');
    bodyEl.innerHTML = `
      <tr class="empty-row">
        <td colspan="6" class="empty-table-cell">
          Belum ada data siswa yang didaftarkan. Silakan isi formulir di atas untuk menambahkan siswa pertama.
        </td>
      </tr>
    `;
    return;
  }

  if (tableEl) tableEl.classList.remove('is-empty-table');

  bodyEl.innerHTML = studentsList
    .map(
      (s, idx) => `
      <tr class="student-card-item">
        <td class="cell-no" data-label="No">
          <span class="student-num-badge">${idx + 1}</span>
        </td>
        <td class="cell-name" data-label="Nama Siswa">
          <div class="student-main-info">
            <span class="student-name-val">${s.full_name || s.name}</span>
            <span class="student-class-tag">${s.class_name || '-'}</span>
          </div>
        </td>
        <td class="cell-class" data-label="Kelas">
          <span class="student-class-tag">${s.class_name || '-'}</span>
        </td>
        <td class="cell-birth" data-label="Tanggal Lahir">
          ${formatBirthDateId(s.birth_date)}
        </td>
        <td class="cell-creator" data-label="Didaftarkan Oleh">
          ${s.created_by || 'Guru PIA'}
        </td>
        <td class="cell-action" data-label="Aksi">
          <button
            type="button"
            class="btn-delete-student"
            data-delete-id="${s.id}"
            data-name="${s.full_name || s.name}"
            data-dob="${s.birth_date || ''}"
            title="Hapus data siswa ini"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 3px;">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Hapus
          </button>
        </td>
        <td class="cell-meta">
          <div class="student-meta-strip">
            <span class="meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; color: #94a3b8;">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              ${formatBirthDateId(s.birth_date)}
            </span>
            <span class="meta-dot">•</span>
            <span class="meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; color: #94a3b8;">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              ${s.created_by || 'Guru PIA'}
            </span>
          </div>
        </td>
      </tr>
    `
    )
    .join('');

  bodyEl.querySelectorAll('.btn-delete-student').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-delete-id'), 10);
      const name = btn.getAttribute('data-name');
      const dob = btn.getAttribute('data-dob') || '';
      if (!confirm(`Yakin ingin menghapus siswa "${name}" dari database dan Dashboard?`)) return;
      await deleteStudent(id, name, dob);
    });
  });
}

async function addStudent({ fullName, className, birthDate }) {
  const createdBy = currentUser ? currentUser.full_name : 'Guru PIA';

  // Simpan langsung ke tabel SQL `students` di database
  const dbRes = await callDatabaseApi('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: fullName,
      class_name: className,
      birth_date: birthDate,
      created_by: createdBy,
    }),
  });

  if (dbRes && dbRes.student) {
    studentsList.push(dbRes.student);
    saveLocalStudents();
    renderStudentsTable();
    return;
  }

  // Fallback apabila sedang offline
  const nextId =
    studentsList.length > 0
      ? Math.max(...studentsList.map((s) => Number(s.id) || 0)) + 1
      : 1;

  const newStudent = {
    id: nextId,
    full_name: fullName,
    class_name: className,
    birth_date: birthDate,
    created_by: createdBy,
    created_at: new Date().toISOString(),
  };

  studentsList.push(newStudent);
  saveLocalStudents();
  renderStudentsTable();
}

async function deleteStudent(studentId, fullName, birthDate) {
  // Update state lokal & cache terlebih dahulu
  studentsList = studentsList.filter(
    (s) =>
      Number(s.id) !== Number(studentId) &&
      (!fullName || (s.full_name || s.name).toLowerCase() !== fullName.toLowerCase())
  );
  saveLocalStudents();
  renderStudentsTable();

  try {
    const res = await callDatabaseApi('/api/students/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: studentId,
        full_name: fullName,
        birth_date: birthDate,
      }),
    });

    if (res && Array.isArray(res.students)) {
      studentsList = res.students;
      saveLocalStudents();
      renderStudentsTable();
    }
  } catch (err) {
    console.error('Error saat menghapus siswa dari database:', err);
  }

  showBanner(
    `Data siswa "${fullName || 'tersebut'}" berhasil dihapus dari database dan Dashboard.`,
    'success'
  );
}

document.addEventListener('DOMContentLoaded', () => {
  initHeaderAndAuth();
  fetchStudentsFromServer();

  const form = document.getElementById('pendaftaranForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('studentFullName').value.trim();
      const className = document.getElementById('studentClass').value.trim();
      const birthDate = document.getElementById('studentBirthDate').value.trim();
      const submitBtn = document.getElementById('submitStudentBtn');

      if (!fullName || !className || !birthDate) {
        showBanner('Harap lengkapi Nama Siswa, Kelas, dan Tanggal Lahir.', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan ke Database...';

      try {
        await addStudent({ fullName, className, birthDate });
        form.reset();
        showBanner(
          `Siswa "${fullName}" (${className}) berhasil disimpan ke Database dan telah masuk ke Dashboard!`,
          'success'
        );
      } catch (err) {
        showBanner(err.message || 'Gagal menyimpan data siswa ke database.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan & Tambahkan ke Dashboard';
      }
    });
  }
});
