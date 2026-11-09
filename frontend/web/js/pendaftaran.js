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
    // Sinkronkan siswa di browser dengan tabel SQL `students` di database
    const syncData = await callDatabaseApi('/api/students/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ students: studentsList }),
    });

    if (syncData && Array.isArray(syncData.students)) {
      studentsList = syncData.students;
      saveLocalStudents();
      renderStudentsTable();
      return;
    }

    const getData = await callDatabaseApi('/api/students');
    if (getData && Array.isArray(getData.students)) {
      studentsList = getData.students;
      saveLocalStudents();
      renderStudentsTable();
    }
  } catch (_) {}
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
      <tr>
        <td data-label="No">${idx + 1}</td>
        <td data-label="Nama Siswa" style="font-weight: 700; color: var(--secondary);">${s.full_name || s.name}</td>
        <td data-label="Kelas"><span class="student-class-tag" style="margin-left: 0;">${s.class_name || '-'}</span></td>
        <td data-label="Tanggal Lahir">${formatBirthDateId(s.birth_date)}</td>
        <td data-label="Didaftarkan Oleh">${s.created_by || 'Guru PIA'}</td>
        <td data-label="Aksi">
          <button type="button" class="btn-danger-sm" data-delete-id="${s.id}" data-name="${s.full_name || s.name}">
            Hapus
          </button>
        </td>
      </tr>
    `
    )
    .join('');

  bodyEl.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-delete-id'), 10);
      const name = btn.getAttribute('data-name');
      if (!confirm(`Hapus siswa "${name}" dari database dan Dashboard?`)) return;
      await deleteStudent(id);
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

async function deleteStudent(studentId) {
  studentsList = studentsList.filter((s) => Number(s.id) !== Number(studentId));
  saveLocalStudents();
  renderStudentsTable();

  try {
    await callDatabaseApi('/api/students/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId }),
    });
  } catch (_) {}

  showBanner('Data siswa berhasil dihapus dari database dan Dashboard.', 'success');
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
