/**
 * Rekap Pembelajaran - Pendidikan Islam At-Taqwa (PIA)
 * Manajemen mutaba'ah perkembangan belajar Iqro, Al-Qur'an, Hafalan Surat Pendek, dan Doa Harian santri.
 */

const API_BASE = '';
const CF_WORKER_API = 'https://absensi-pia.yumenoboken.workers.dev';

let currentUser = null;
let isAdmin = false;
let registeredStudents = [];
let allLearningRecords = [];

function getLocalTodayIso() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let filterSelectedCategory = 'all';
let filterSelectedStudent = 'all';
let filterSelectedDate = getLocalTodayIso();

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
  const alertEl = document.getElementById('learningAlert');
  if (!alertEl) return;
  alertEl.textContent = message;
  alertEl.className = `alert-banner ${type}`;
  alertEl.style.display = 'block';
  alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => {
    alertEl.style.display = 'none';
  }, 4500);
}

async function callLearningApi(endpoint, options = {}) {
  const isGitHubPages = window.location.hostname.includes('github.io');
  const token = getAuthToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 1. Coba Server Lokal jika bukan di GitHub Pages
  if (!isGitHubPages) {
    try {
      const resp = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await resp.json();
        if (resp.ok && data && (data.success !== false || !data.detail)) {
          return data;
        }
      }
    } catch (_) {}
  }

  // 2. Coba ke Cloudflare Worker API
  try {
    const cfUrl = `${CF_WORKER_API}${endpoint}`;
    const cfResp = await fetch(cfUrl, { ...options, headers });
    const cfType = cfResp.headers.get('content-type') || '';
    if (cfType.includes('application/json')) {
      const cfData = await cfResp.json();
      if (cfResp.ok && cfData && (cfData.success !== false || !cfData.detail)) {
        return cfData;
      }
    }
  } catch (_) {}

  // 3. Fallback Penyimpanan Lokal Browser (Offline / Static GitHub Pages)
  return handleLocalFallback(endpoint, options);
}

function getLocalLearningDb() {
  try {
    const raw = localStorage.getItem('pia_learning_db');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.records)) {
        return parsed;
      }
    }
  } catch (_) {}
  return { records: [] };
}

function saveLocalLearningDb(db) {
  try {
    localStorage.setItem('pia_learning_db', JSON.stringify(db));
  } catch (_) {}
}

function handleLocalFallback(endpoint, options) {
  const db = getLocalLearningDb();

  if (endpoint.startsWith('/api/learning-records') && (!options.method || options.method === 'GET')) {
    return {
      success: true,
      records: db.records,
    };
  }

  if (endpoint === '/api/learning-records' && options.method === 'POST') {
    const body = options.body ? JSON.parse(options.body) : {};
    const newRecord = {
      id: Date.now(),
      student_id: body.student_id || null,
      student_name: body.student_name || 'Santri',
      teacher_name: body.teacher_name || (currentUser ? currentUser.full_name : 'Guru'),
      category: body.category || 'Iqro',
      materi: body.materi || '-',
      jilid: body.jilid || '',
      halaman: body.halaman || '',
      surat: body.surat || '',
      ayat: body.ayat || '',
      doa: body.doa || '',
      predicate: body.predicate || 'Lancar',
      note: body.note || '',
      record_date: body.record_date || getLocalTodayIso(),
      created_at: new Date().toISOString(),
    };
    db.records.unshift(newRecord);
    saveLocalLearningDb(db);
    return {
      success: true,
      message: `Capaian pembelajaran untuk ${newRecord.student_name} berhasil disimpan!`,
      record: newRecord,
    };
  }

  if (endpoint === '/api/learning-records/delete' && options.method === 'POST') {
    const body = options.body ? JSON.parse(options.body) : {};
    const targetId = Number(body.record_id);
    db.records = db.records.filter((r) => Number(r.id) !== targetId);
    saveLocalLearningDb(db);
    return {
      success: true,
      message: 'Catatan pembelajaran berhasil dihapus.',
    };
  }

  return { success: true };
}

function initHeaderAndAuth() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const navDropdown = document.getElementById('mainNavLinks');
  if (hamburgerBtn && navDropdown) {
    hamburgerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = navDropdown.classList.contains('is-open');
      navDropdown.classList.toggle('is-open', !isOpen);
      hamburgerBtn.classList.toggle('active', !isOpen);
      hamburgerBtn.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      if (!navDropdown.contains(e.target) && !hamburgerBtn.contains(e.target)) {
        navDropdown.classList.remove('is-open');
        hamburgerBtn.classList.remove('active');
        hamburgerBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  try {
    const rawUser = localStorage.getItem('pia_user') || localStorage.getItem('pia_current_user');
    if (rawUser) {
      currentUser = JSON.parse(rawUser);
      const nameEl = document.getElementById('activeUserName');
      const emailEl = document.getElementById('activeUserEmail');
      const dropdownNameEl = document.getElementById('dropdownUserName');
      const dropdownEmailEl = document.getElementById('dropdownUserEmail');
      const dropdownAvatarEl = document.getElementById('dropdownUserAvatar');
      const dropdownRoleEl = document.getElementById('dropdownUserRole');
      const teacherNameEl = document.getElementById('activeTeacherName');

      const userName = currentUser.full_name || currentUser.username || 'Guru PIA';
      const userEmail = currentUser.email || 'Pendidikan Islam At-Taqwa';
      const userEmailLower = (currentUser.email || '').toLowerCase();
      isAdmin = userEmailLower === 'yumenoboken@gmail.com' || currentUser.role === 'admin';
      const initial = (userName.trim()[0] || 'U').toUpperCase();

      if (nameEl) nameEl.textContent = userName;
      if (emailEl) emailEl.textContent = userEmail;
      if (dropdownNameEl) dropdownNameEl.textContent = userName;
      if (dropdownEmailEl) dropdownEmailEl.textContent = userEmail;
      if (dropdownAvatarEl) dropdownAvatarEl.textContent = initial;
      if (dropdownRoleEl) dropdownRoleEl.textContent = isAdmin ? 'Administrator' : 'Guru';
      if (teacherNameEl) teacherNameEl.textContent = userName;
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
}

async function loadStudents() {
  let students = [];
  try {
    const raw = localStorage.getItem('pia_students_db');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) students = parsed;
    }
  } catch (_) {}

  try {
    const res = await callLearningApi('/api/students');
    if (res && res.success && Array.isArray(res.students) && res.students.length > 0) {
      students = res.students;
    }
  } catch (_) {}

  registeredStudents = students;

  // Dropdown form input
  const selectEl = document.getElementById('studentSelect');
  if (selectEl) {
    if (registeredStudents.length === 0) {
      selectEl.innerHTML = '<option value="">-- Belum ada santri terdaftar --</option>';
    } else {
      selectEl.innerHTML =
        '<option value="">-- Pilih Nama Siswa --</option>' +
        registeredStudents
          .map((s) => `<option value="${s.id}" data-name="${s.full_name || s.name}">${s.full_name || s.name}</option>`)
          .join('');
    }
  }

  // Dropdown filter tabel
  const filterSelectEl = document.getElementById('filterStudent');
  if (filterSelectEl) {
    filterSelectEl.innerHTML =
      '<option value="all">Semua Siswa</option>' +
      registeredStudents
        .map((s) => `<option value="${s.id}">${s.full_name || s.name}</option>`)
        .join('');
  }
}

function initCategoryTabs() {
  const tabsContainer = document.getElementById('categoryTabs');
  const selectedCatInput = document.getElementById('selectedCategory');
  if (!tabsContainer || !selectedCatInput) return;

  const groups = {
    'Iqro': document.getElementById('fieldsIqro'),
    'Quran': document.getElementById('fieldsQuran'),
    'Hafalan Surat': document.getElementById('fieldsSurat'),
    'Hafalan Doa': document.getElementById('fieldsDoa'),
  };

  tabsContainer.querySelectorAll('.btn-category-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      tabsContainer.querySelectorAll('.btn-category-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const cat = tab.getAttribute('data-category');
      selectedCatInput.value = cat;

      Object.entries(groups).forEach(([key, el]) => {
        if (el) {
          el.style.display = key === cat ? 'block' : 'none';
        }
      });
    });
  });
}

function initFilterToolbar() {
  const filterCatEl = document.getElementById('filterCategory');
  const filterStudentEl = document.getElementById('filterStudent');
  const filterDateInput = document.getElementById('filterDate');
  const btnToday = document.getElementById('btnFilterToday');
  const btnAllDates = document.getElementById('btnFilterAllDates');

  if (filterDateInput) {
    filterDateInput.value = filterSelectedDate;
    filterDateInput.addEventListener('change', () => {
      filterSelectedDate = filterDateInput.value;
      updateToolbarActiveStates();
      renderLearningTable();
    });
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      filterSelectedDate = getLocalTodayIso();
      if (filterDateInput) filterDateInput.value = filterSelectedDate;
      updateToolbarActiveStates();
      renderLearningTable();
    });
  }

  if (btnAllDates) {
    btnAllDates.addEventListener('click', () => {
      filterSelectedDate = '';
      if (filterDateInput) filterDateInput.value = '';
      updateToolbarActiveStates();
      renderLearningTable();
    });
  }

  if (filterCatEl) {
    filterCatEl.addEventListener('change', () => {
      filterSelectedCategory = filterCatEl.value;
      renderLearningTable();
    });
  }

  if (filterStudentEl) {
    filterStudentEl.addEventListener('change', () => {
      filterSelectedStudent = filterStudentEl.value;
      renderLearningTable();
    });
  }
}

function updateToolbarActiveStates() {
  const btnToday = document.getElementById('btnFilterToday');
  const btnAllDates = document.getElementById('btnFilterAllDates');
  const todayStr = getLocalTodayIso();

  if (btnToday) {
    btnToday.classList.toggle('active', filterSelectedDate === todayStr);
  }
  if (btnAllDates) {
    btnAllDates.classList.toggle('active', !filterSelectedDate);
  }
}

async function loadLearningRecords() {
  try {
    const res = await callLearningApi('/api/learning-records');
    if (res && res.success && Array.isArray(res.records)) {
      allLearningRecords = res.records;
    } else {
      const fallback = handleLocalFallback('/api/learning-records', { method: 'GET' });
      allLearningRecords = fallback.records || [];
    }
  } catch (_) {
    const fallback = handleLocalFallback('/api/learning-records', { method: 'GET' });
    allLearningRecords = fallback.records || [];
  }

  renderLearningTable();
}

function renderLearningTable() {
  const tbody = document.getElementById('learningRecordsBody');
  const infoEl = document.getElementById('learningFilterInfo');

  // Hitung akumulasi statistik global (seluruh catatan)
  let totalIqro = 0;
  let totalQuran = 0;
  let totalHafalan = 0;

  for (const item of allLearningRecords) {
    if (item.category === 'Iqro') totalIqro++;
    else if (item.category === 'Quran') totalQuran++;
    else if (item.category === 'Hafalan Surat' || item.category === 'Hafalan Doa') totalHafalan++;
  }

  const statTotalEl = document.getElementById('statTotalSetoran');
  const statIqroEl = document.getElementById('statIqroCount');
  const statQuranEl = document.getElementById('statQuranCount');
  const statHafalanEl = document.getElementById('statHafalanCount');

  if (statTotalEl) statTotalEl.textContent = String(allLearningRecords.length);
  if (statIqroEl) statIqroEl.textContent = String(totalIqro);
  if (statQuranEl) statQuranEl.textContent = String(totalQuran);
  if (statHafalanEl) statHafalanEl.textContent = String(totalHafalan);

  // Filter daftar tampilan
  let filtered = [...allLearningRecords];

  if (filterSelectedCategory !== 'all') {
    filtered = filtered.filter((r) => r.category === filterSelectedCategory);
  }

  if (filterSelectedStudent !== 'all') {
    filtered = filtered.filter((r) => String(r.student_id) === String(filterSelectedStudent));
  }

  if (filterSelectedDate) {
    filtered = filtered.filter((r) => r.record_date === filterSelectedDate);
  }

  // Update ringkasan info toolbar
  if (infoEl) {
    const dateLabel = filterSelectedDate ? formatDateIndo(filterSelectedDate) : 'Semua Tanggal';
    infoEl.textContent = `Menampilkan: ${dateLabel} • Total ${filtered.length} catatan`;
  }

  if (!tbody) return;

  if (filtered.length === 0) {
    let emptyMsg = 'Belum ada data capaian pembelajaran.';
    if (filterSelectedDate) {
      emptyMsg = `Tidak ada catatan pembelajaran pada tanggal <strong>${formatDateIndo(filterSelectedDate)}</strong>. Silakan pilih tanggal lain atau klik <strong>Semua Tanggal</strong>.`;
    }
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8" class="empty-table-cell" style="padding: 32px 16px; color: var(--color-slate-500);">
          ${emptyMsg}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((item, idx) => {
      // Badge Kategori
      const catClass =
        item.category === 'Iqro'
          ? 'badge-cat-iqro'
          : item.category === 'Quran'
          ? 'badge-cat-quran'
          : item.category === 'Hafalan Surat'
          ? 'badge-cat-surat'
          : 'badge-cat-doa';

      const catIcon =
        item.category === 'Iqro'
          ? '📖 Iqro'
          : item.category === 'Quran'
          ? '📗 Al-Qur\'an'
          : item.category === 'Hafalan Surat'
          ? '🕌 Surat'
          : '🤲 Doa';

      // Badge Predikat
      const pred = item.predicate || 'Lancar';
      const predClass =
        pred.includes('Sangat') || pred.includes('Mutqin')
          ? 'badge-pred-sangat-lancar'
          : pred.includes('Lancar')
          ? 'badge-pred-lancar'
          : pred.includes('Cukup')
          ? 'badge-pred-cukup'
          : 'badge-pred-mengulang';

      return `
        <tr class="learning-record-item">
          <td class="cell-no" data-label="No">
            <span class="student-num-badge">${idx + 1}</span>
          </td>
          <td class="cell-name" data-label="Siswa">
            <strong class="student-name-text">${item.student_name}</strong>
          </td>
          <td class="cell-date" data-label="Tanggal">
            ${formatDateIndo(item.record_date)}
          </td>
          <td class="cell-cat" data-label="Kategori">
            <span class="badge-cat ${catClass}">${catIcon}</span>
          </td>
          <td class="cell-materi" data-label="Capaian / Materi">
            <strong>${item.materi}</strong>
          </td>
          <td class="cell-predicate" data-label="Kelancaran">
            <span class="badge-pred ${predClass}">${pred}</span>
          </td>
          <td class="cell-note" data-label="Catatan Guru">
            <span class="note-text">${item.note || '-'}</span>
            <small class="meta-sub" style="display:block; color:var(--text-muted); font-size:0.73rem; margin-top:2px;">
              Guru: ${item.teacher_name || 'Ustadz/ah'}
            </small>
          </td>
          <td class="cell-action" data-label="Aksi" style="text-align: center;">
            <button
              type="button"
              class="btn-action-delete btn-delete-learning"
              data-id="${item.id}"
              data-name="${item.student_name}"
              data-materi="${item.materi}"
              title="Hapus catatan ini"
              style="padding: 6px 10px; font-size: 0.76rem;"
            >
              🗑 Hapus
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  // Pasang listener tombol hapus
  tbody.querySelectorAll('.btn-delete-learning').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      const materi = btn.getAttribute('data-materi');
      const confirmed = window.confirm(
        `Apakah Anda yakin ingin menghapus catatan pembelajaran "${materi}" untuk ${name}?`
      );
      if (!confirmed) return;

      try {
        await callLearningApi('/api/learning-records/delete', {
          method: 'POST',
          body: JSON.stringify({ record_id: Number(id) }),
        });

        // Update memori lokal
        allLearningRecords = allLearningRecords.filter((r) => Number(r.id) !== Number(id));

        showBanner(`Catatan pembelajaran "${materi}" berhasil dihapus.`, 'success');
        renderLearningTable();
      } catch (err) {
        showBanner(`Gagal menghapus catatan: ${err.message}`, 'error');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initHeaderAndAuth();

  // Set default tanggal hari ini
  const dateInput = document.getElementById('recordDate');
  if (dateInput) {
    dateInput.value = getLocalTodayIso();
  }

  initCategoryTabs();
  initFilterToolbar();

  await loadStudents();
  await loadLearningRecords();

  // Form Submit
  const form = document.getElementById('learningRecordForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('submitLearningBtn');
      const studentSelect = document.getElementById('studentSelect');
      const dateVal = document.getElementById('recordDate').value;
      const category = document.getElementById('selectedCategory').value;
      const predicate = document.getElementById('predicateSelect').value;
      const noteVal = document.getElementById('learningNote').value.trim();

      if (!studentSelect || !studentSelect.value) {
        showBanner('Harap pilih nama santri terlebih dahulu.', 'error');
        return;
      }

      const selectedOpt = studentSelect.options[studentSelect.selectedIndex];
      const studentId = studentSelect.value;
      const studentName = selectedOpt.getAttribute('data-name') || selectedOpt.textContent;

      if (!dateVal) {
        showBanner('Harap tentukan tanggal pembelajaran.', 'error');
        return;
      }

      // Bangun string materi sesuai kategori
      let materiStr = '';
      let jilidVal = '';
      let halVal = '';
      let suratVal = '';
      let ayatVal = '';
      let doaVal = '';

      if (category === 'Iqro') {
        jilidVal = document.getElementById('iqroJilid').value;
        halVal = document.getElementById('iqroHalaman').value;
        if (!halVal) {
          showBanner('Harap isi nomor halaman Iqro.', 'error');
          document.getElementById('iqroHalaman').focus();
          return;
        }
        materiStr = `${jilidVal} Halaman ${halVal}`;
      } else if (category === 'Quran') {
        suratVal = document.getElementById('quranSurat').value.trim();
        ayatVal = document.getElementById('quranAyat').value.trim() || 'Ayat 1-selesai';
        if (!suratVal) {
          showBanner('Harap isi nama surat Al-Qur\'an.', 'error');
          document.getElementById('quranSurat').focus();
          return;
        }
        materiStr = `Surat ${suratVal} (${ayatVal})`;
      } else if (category === 'Hafalan Surat') {
        suratVal = document.getElementById('hafalanSurat').value;
        ayatVal = document.getElementById('hafalanSuratAyat').value.trim() || 'Full Surat';
        materiStr = `Surat ${suratVal} (${ayatVal})`;
      } else if (category === 'Hafalan Doa') {
        doaVal = document.getElementById('hafalanDoa').value;
        materiStr = doaVal;
      }

      const teacherName = currentUser ? (currentUser.full_name || currentUser.username) : 'Guru PIA';

      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan...';

      try {
        const payload = {
          student_id: Number(studentId),
          student_name: studentName,
          teacher_name: teacherName,
          category: category,
          materi: materiStr,
          jilid: jilidVal,
          halaman: halVal,
          surat: suratVal,
          ayat: ayatVal,
          doa: doaVal,
          predicate: predicate,
          note: noteVal,
          record_date: dateVal,
        };

        const res = await callLearningApi('/api/learning-records', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        showBanner(
          res.message || `Capaian belajar ${studentName} (${materiStr}) berhasil disimpan!`,
          'success'
        );

        // Reset fields
        if (category === 'Iqro') {
          document.getElementById('iqroHalaman').value = '';
        } else if (category === 'Quran') {
          document.getElementById('quranSurat').value = '';
          document.getElementById('quranAyat').value = '';
        }
        document.getElementById('learningNote').value = '';

        // Reload data
        await loadLearningRecords();
      } catch (err) {
        showBanner(`Gagal menyimpan capaian pembelajaran: ${err.message}`, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan Rekap Pembelajaran';
      }
    });
  }
});

