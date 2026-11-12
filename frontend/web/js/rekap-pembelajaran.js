/**
 * Sistem Mutaba'ah & Rekap Pembelajaran Siswa
 * Pendidikan Islam At-Taqwa (PIA)
 * Khusus: Iqro (Jilid 1 - 6) & Hafalan Al-Qur'an Juz 30 (An-Naba' s/d An-Nas)
 */

const IQRO_CONFIG = {
  1: { name: 'Iqro 1', startPage: 1, endPage: 36, totalPages: 36 },
  2: { name: 'Iqro 2', startPage: 3, endPage: 32, totalPages: 30 },
  3: { name: 'Iqro 3', startPage: 3, endPage: 32, totalPages: 30 },
  4: { name: 'Iqro 4', startPage: 3, endPage: 32, totalPages: 30 },
  5: { name: 'Iqro 5', startPage: 3, endPage: 32, totalPages: 30 },
  6: { name: 'Iqro 6', startPage: 3, endPage: 32, totalPages: 30 },
};

const SURAH_JUZ_30 = [
  { no: 78, name: "An-Naba'", ayat: 40 },
  { no: 79, name: "An-Nazi'at", ayat: 46 },
  { no: 80, name: "'Abasa", ayat: 42 },
  { no: 81, name: "At-Takwir", ayat: 29 },
  { no: 82, name: "Al-Infitar", ayat: 19 },
  { no: 83, name: "Al-Muthaffifin", ayat: 36 },
  { no: 84, name: "Al-Insyiqaq", ayat: 25 },
  { no: 85, name: "Al-Buruj", ayat: 22 },
  { no: 86, name: "At-Tariq", ayat: 17 },
  { no: 87, name: "Al-A'la", ayat: 19 },
  { no: 88, name: "Al-Ghasyiyah", ayat: 26 },
  { no: 89, name: "Al-Fajr", ayat: 30 },
  { no: 90, name: "Al-Balad", ayat: 20 },
  { no: 91, name: "Asy-Syams", ayat: 15 },
  { no: 92, name: "Al-Lail", ayat: 21 },
  { no: 93, name: "Ad-Duha", ayat: 11 },
  { no: 94, name: "Al-Insyirah", ayat: 8 },
  { no: 95, name: "At-Tin", ayat: 8 },
  { no: 96, name: "Al-'Alaq", ayat: 19 },
  { no: 97, name: "Al-Qadr", ayat: 5 },
  { no: 98, name: "Al-Bayyinah", ayat: 8 },
  { no: 99, name: "Az-Zalzalah", ayat: 8 },
  { no: 100, name: "Al-'Adiyat", ayat: 11 },
  { no: 101, name: "Al-Qari'ah", ayat: 11 },
  { no: 102, name: "At-Takatsur", ayat: 8 },
  { no: 103, name: "Al-'Asr", ayat: 3 },
  { no: 104, name: "Al-Humazah", ayat: 9 },
  { no: 105, name: "Al-Fil", ayat: 5 },
  { no: 106, name: "Quraisy", ayat: 4 },
  { no: 107, name: "Al-Ma'un", ayat: 7 },
  { no: 108, name: "Al-Kautsar", ayat: 3 },
  { no: 109, name: "Al-Kafirun", ayat: 6 },
  { no: 110, name: "An-Nasr", ayat: 3 },
  { no: 111, name: "Al-Lahab", ayat: 5 },
  { no: 112, name: "Al-Ikhlas", ayat: 4 },
  { no: 113, name: "Al-Falaq", ayat: 5 },
  { no: 114, name: "An-Nas", ayat: 6 },
];

const API_BASES = window.location.hostname.includes('github.io')
  ? ['https://absensi-pia.yumenoboken.workers.dev', 'http://localhost:5173']
  : ['', 'http://localhost:5173', 'https://absensi-pia.yumenoboken.workers.dev'];

// State Aplikasi
let currentUser = null;
let studentsList = [];
let selectedStudentId = null;
let selectedStudent = null;
let currentIqroLevel = 1; // Level resmi siswa saat ini (1..6)
let viewedIqroLevel = 1;  // Level yang sedang dibuka di tab checklist
let progressMap = {};     // { [key: `${category}_${level}_${itemId}`]: { is_completed: 0|1, note: '' } }
let pendingSaveQueue = {};
let saveTimeout = null;
let quranFilterMode = 'all';
let quranSearchQuery = '';

// Helper API
async function callApi(path, options = {}) {
  for (const base of API_BASES) {
    try {
      const resp = await fetch(`${base}${path}`, options);
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.detail || data.message || 'Permintaan gagal.');
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showBanner(msg, type = 'success', duration = 5000) {
  const banner = document.getElementById('learningAlert');
  if (!banner) return;
  banner.className = `alert-banner ${type} show`;
  banner.textContent = msg;
  if (duration > 0) {
    setTimeout(() => {
      banner.classList.remove('show');
    }, duration);
  }
}

function showSaveStatus(indicatorId, text = 'Otomatis tersimpan ke database ✓') {
  const el = document.getElementById(indicatorId);
  if (!el) return;
  el.textContent = text;
  el.style.opacity = '1';
  setTimeout(() => {
    el.style.opacity = '0.7';
  }, 2500);
}

// Navigasi & Hamburger
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
}

function initHeaderAndAuth() {
  initHamburgerMenu();

  const nameEl = document.getElementById('activeUserName');
  const emailEl = document.getElementById('activeUserEmail');
  const dropdownNameEl = document.getElementById('dropdownUserName');
  const dropdownEmailEl = document.getElementById('dropdownUserEmail');
  const dropdownAvatarEl = document.getElementById('dropdownUserAvatar');
  const dropdownRoleEl = document.getElementById('dropdownUserRole');

  try {
    const rawUser = localStorage.getItem('pia_user') || localStorage.getItem('pia_current_user');
    if (rawUser) {
      currentUser = JSON.parse(rawUser);
      const userName = currentUser.full_name || currentUser.username || 'Pengguna PIA';
      const userEmail = currentUser.email || 'Pendidikan Islam At-Taqwa';
      const isAdmin = Boolean(
        (currentUser.email && currentUser.email.toLowerCase() === 'yumenoboken@gmail.com') ||
        currentUser.role === 'admin'
      );
      const initial = (userName.trim()[0] || 'U').toUpperCase();

      if (nameEl) nameEl.textContent = userName;
      if (emailEl) emailEl.textContent = userEmail;
      if (dropdownNameEl) dropdownNameEl.textContent = userName;
      if (dropdownEmailEl) dropdownEmailEl.textContent = userEmail;
      if (dropdownAvatarEl) dropdownAvatarEl.textContent = initial;
      if (dropdownRoleEl) dropdownRoleEl.textContent = isAdmin ? 'Administrator' : 'Guru';
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

// ============================================================
// DATA SISWA & MUTABA'AH
// ============================================================
async function loadStudents() {
  try {
    const raw = localStorage.getItem('pia_students_db');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) studentsList = parsed;
    }
  } catch (_) {}

  try {
    const res = await callApi('/api/students');
    if (res && Array.isArray(res.students) && res.students.length > 0) {
      studentsList = res.students;
      localStorage.setItem('pia_students_db', JSON.stringify(studentsList));
    }
  } catch (_) {}

  renderStudentDropdown();

  // Pilih siswa pertama secara otomatis jika belum ada yang dipilih
  if (!selectedStudentId && studentsList.length > 0) {
    selectStudent(studentsList[0].id);
  }
}

function renderStudentDropdown() {
  const selectEl = document.getElementById('studentSelect');
  if (!selectEl) return;

  if (studentsList.length === 0) {
    selectEl.innerHTML = '<option value="">Belum ada siswa terdaftar di Dashboard</option>';
    return;
  }

  selectEl.innerHTML =
    '<option value="">-- Pilih Siswa --</option>' +
    studentsList
      .map((s) => {
        const sName = s.full_name || s.name || 'Siswa';
        const sClass = s.class_name ? `(${s.class_name})` : '';
        const isSel = String(s.id) === String(selectedStudentId) ? 'selected' : '';
        return `<option value="${s.id}" ${isSel}>${escapeHtml(sName)} ${escapeHtml(sClass)}</option>`;
      })
      .join('');
}

async function selectStudent(studentId) {
  selectedStudentId = Number(studentId);
  selectedStudent = studentsList.find((s) => Number(s.id) === selectedStudentId) || null;

  const selectEl = document.getElementById('studentSelect');
  if (selectEl && String(selectEl.value) !== String(selectedStudentId)) {
    selectEl.value = String(selectedStudentId);
  }

  if (!selectedStudent) {
    document.getElementById('studentPreviewWrap').style.display = 'none';
    return;
  }

  renderStudentPreview();
  await loadStudentProgress(selectedStudentId);
}

function renderStudentPreview() {
  const wrap = document.getElementById('studentPreviewWrap');
  if (!wrap || !selectedStudent) return;
  wrap.style.display = 'flex';

  const sName = selectedStudent.full_name || selectedStudent.name || 'Siswa';
  const initial = (sName.trim()[0] || 'S').toUpperCase();

  document.getElementById('studentAvatar').textContent = initial;
  document.getElementById('studentNamePreview').textContent = sName;
  document.getElementById('studentClassPreview').textContent = selectedStudent.class_name || '-';

  updateSummaryBadges();
}

function updateSummaryBadges() {
  const iqroBadge = document.getElementById('studentIqroBadge');
  const hafalanBadge = document.getElementById('studentHafalanBadge');
  if (!iqroBadge || !hafalanBadge) return;

  // Hitung progres Iqro di level aktif
  const activeCfg = IQRO_CONFIG[currentIqroLevel] || IQRO_CONFIG[1];
  let iqroDoneCount = 0;
  for (let p = activeCfg.startPage; p <= activeCfg.endPage; p++) {
    const key = `iqro_Iqro ${currentIqroLevel}_hal_${p}`;
    if (progressMap[key] && progressMap[key].is_completed) iqroDoneCount++;
  }

  if (currentIqroLevel > 6) {
    iqroBadge.textContent = '🎓 Khatam Iqro 6';
  } else {
    iqroBadge.textContent = `📖 ${activeCfg.name} (${iqroDoneCount}/${activeCfg.totalPages})`;
  }

  // Hitung progres Hafalan
  let hafalanDoneCount = 0;
  for (const surah of SURAH_JUZ_30) {
    const key = `hafalan_Juz 30_surat_${surah.no}`;
    if (progressMap[key] && progressMap[key].is_completed) hafalanDoneCount++;
  }
  hafalanBadge.textContent = `🕌 Hafalan: ${hafalanDoneCount}/37`;
}

// ============================================================
// LOAD & SAVE PROGRES
// ============================================================
async function loadStudentProgress(studentId) {
  progressMap = {};

  // Muat cache lokal terlebih dahulu jika ada
  try {
    const cacheKey = `pia_progress_${studentId}`;
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        progressMap = parsed.progress || {};
        currentIqroLevel = parsed.current_iqro_level || 1;
        viewedIqroLevel = currentIqroLevel;
      }
    }
  } catch (_) {}

  // Ambil data resmi dari database backend
  try {
    const res = await callApi(`/api/learning-progress?student_id=${studentId}`);
    if (res && res.success) {
      currentIqroLevel = Number(res.current_iqro_level) || 1;
      viewedIqroLevel = Math.min(Math.max(currentIqroLevel, 1), 6);

      const newMap = {};
      for (const row of res.progress || []) {
        const key = `${row.category}_${row.level_name}_${row.item_id}`;
        newMap[key] = {
          is_completed: Number(row.is_completed) ? 1 : 0,
          note: row.note || '',
          item_label: row.item_label || '',
          updated_by: row.updated_by || '',
          updated_at: row.updated_at || '',
        };
      }
      progressMap = newMap;

      // Simpan ke cache lokal
      localStorage.setItem(
        `pia_progress_${studentId}`,
        JSON.stringify({
          current_iqro_level: currentIqroLevel,
          progress: progressMap,
        })
      );
    }
  } catch (err) {
    console.warn('Gagal memuat mutaba\'ah dari server:', err);
  }

  renderIqroStepper();
  renderIqroChecklist();
  renderIqroUnlockCard();
  renderQuranChecklist();
  updateSummaryBadges();
}

function queueSaveProgress(category, levelName, itemId, itemLabel, isCompleted, note) {
  const key = `${category}_${levelName}_${itemId}`;
  const itemObj = {
    category,
    level_name: levelName,
    item_id: String(itemId),
    item_label: String(itemLabel),
    is_completed: isCompleted ? 1 : 0,
    note: note || '',
  };

  progressMap[key] = {
    ...itemObj,
    updated_by: currentUser ? currentUser.full_name : 'Guru PIA',
    updated_at: new Date().toISOString(),
  };

  pendingSaveQueue[key] = itemObj;

  // Simpan ke cache lokal
  if (selectedStudentId) {
    localStorage.setItem(
      `pia_progress_${selectedStudentId}`,
      JSON.stringify({
        current_iqro_level: currentIqroLevel,
        progress: progressMap,
      })
    );
  }

  updateSummaryBadges();

  // Debounced auto-save ke backend server
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    flushSaveQueue();
  }, 450);
}

async function flushSaveQueue() {
  const itemsToSave = Object.values(pendingSaveQueue);
  if (itemsToSave.length === 0 || !selectedStudentId) return;

  pendingSaveQueue = {};

  try {
    await callApi('/api/learning-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: selectedStudentId,
        current_iqro_level: currentIqroLevel,
        items: itemsToSave,
        updated_by: currentUser ? currentUser.full_name : 'Guru PIA',
      }),
    });
    showSaveStatus('iqroSaveStatus');
    showSaveStatus('quranSaveStatus');
    loadOverviewData();
  } catch (err) {
    console.error('Gagal menyimpan mutaba\'ah ke server:', err);
  }
}

// ============================================================
// TAB 1: IQRO CHECKLIST & STEPPER
// ============================================================
function renderIqroStepper() {
  const container = document.getElementById('iqroStepper');
  if (!container) return;

  container.innerHTML = [1, 2, 3, 4, 5, 6]
    .map((lvl) => {
      const cfg = IQRO_CONFIG[lvl];
      let stateClass = '';
      let badgeIcon = '';

      if (lvl < currentIqroLevel) {
        stateClass = 'is-completed';
        badgeIcon = '✓';
      } else if (lvl === currentIqroLevel) {
        stateClass = 'is-active';
        badgeIcon = '⚡';
      } else {
        stateClass = 'is-locked';
        badgeIcon = '🔒';
      }

      const isViewSelected = lvl === viewedIqroLevel ? 'style="border-width: 2.5px; border-color: #1d4ed8;"' : '';

      return `
        <button
          type="button"
          class="iqro-step-pill ${stateClass}"
          data-step-level="${lvl}"
          ${isViewSelected}
          title="Buka Checklist ${cfg.name}"
        >
          <span>${badgeIcon}</span>
          <span>${cfg.name}</span>
          <span style="font-size: 0.72rem; opacity: 0.85;">(${cfg.startPage}-${cfg.endPage})</span>
        </button>
      `;
    })
    .join('');

  container.querySelectorAll('.iqro-step-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lvl = Number(btn.getAttribute('data-step-level'));
      viewedIqroLevel = lvl;
      renderIqroStepper();
      renderIqroChecklist();
      renderIqroUnlockCard();
    });
  });
}

function renderIqroChecklist() {
  const bodyEl = document.getElementById('iqroTableBody');
  const titleEl = document.getElementById('iqroDisplayTitle');
  const progTextEl = document.getElementById('iqroProgressText');
  const progFillEl = document.getElementById('iqroProgressFill');
  if (!bodyEl) return;

  const cfg = IQRO_CONFIG[viewedIqroLevel] || IQRO_CONFIG[1];
  if (titleEl) titleEl.textContent = `Progres ${cfg.name} (Halaman ${cfg.startPage} s/d ${cfg.endPage})`;

  let doneCount = 0;
  let rowsHtml = '';

  for (let page = cfg.startPage; page <= cfg.endPage; page++) {
    const key = `iqro_Iqro ${viewedIqroLevel}_hal_${page}`;
    const pData = progressMap[key] || { is_completed: 0, note: '' };
    const isDone = Boolean(pData.is_completed);
    if (isDone) doneCount++;

    const noteVal = pData.note || (isDone ? 'TUNTAS' : '');

    rowsHtml += `
      <tr class="${isDone ? 'is-done' : ''}" data-page="${page}">
        <td>
          <div class="mutabaah-item-name">
            <span>Halaman ${page}</span>
          </div>
        </td>
        <td class="mutabaah-check-cell">
          <input
            type="checkbox"
            class="mutabaah-checkbox iqro-chk"
            data-page="${page}"
            ${isDone ? 'checked' : ''}
            title="Tandai Halaman ${page} tuntas"
          />
        </td>
        <td class="mutabaah-note-cell">
          <input
            type="text"
            class="mutabaah-note-input iqro-note ${isDone ? 'is-tuntas' : ''}"
            data-page="${page}"
            value="${escapeHtml(noteVal)}"
            placeholder="TUNTAS / Catatan tajwid..."
          />
        </td>
      </tr>
    `;
  }

  bodyEl.innerHTML = rowsHtml;

  // Update Progress Bar
  const pct = Math.round((doneCount / cfg.totalPages) * 100);
  if (progTextEl) progTextEl.textContent = `${doneCount} dari ${cfg.totalPages} Halaman Selesai (${pct}%)`;
  if (progFillEl) progFillEl.style.width = `${pct}%`;

  // Pasang Event Listeners
  bodyEl.querySelectorAll('.iqro-chk').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const page = Number(chk.getAttribute('data-page'));
      const isChecked = chk.checked;
      const tr = chk.closest('tr');
      const noteInput = tr.querySelector('.iqro-note');

      if (isChecked) {
        tr.classList.add('is-done');
        if (noteInput && (!noteInput.value.trim() || noteInput.value.trim() === '-')) {
          noteInput.value = 'TUNTAS';
          noteInput.classList.add('is-tuntas');
        }
      } else {
        tr.classList.remove('is-done');
        if (noteInput && noteInput.value.trim() === 'TUNTAS') {
          noteInput.classList.remove('is-tuntas');
        }
      }

      queueSaveProgress(
        'iqro',
        `Iqro ${viewedIqroLevel}`,
        `hal_${page}`,
        `Halaman ${page}`,
        isChecked,
        noteInput ? noteInput.value.trim() : ''
      );

      // Hitung ulang progress bar & unlock card
      updateIqroProgressStats();
      renderIqroUnlockCard();
    });
  });

  bodyEl.querySelectorAll('.iqro-note').forEach((inp) => {
    inp.addEventListener('change', () => {
      const page = Number(inp.getAttribute('data-page'));
      const tr = inp.closest('tr');
      const chk = tr.querySelector('.iqro-chk');
      const val = inp.value.trim();

      if (val.toUpperCase() === 'TUNTAS') {
        inp.classList.add('is-tuntas');
      } else {
        inp.classList.remove('is-tuntas');
      }

      queueSaveProgress(
        'iqro',
        `Iqro ${viewedIqroLevel}`,
        `hal_${page}`,
        `Halaman ${page}`,
        chk ? chk.checked : false,
        val
      );
    });
  });
}

function updateIqroProgressStats() {
  const cfg = IQRO_CONFIG[viewedIqroLevel] || IQRO_CONFIG[1];
  let doneCount = 0;
  for (let page = cfg.startPage; page <= cfg.endPage; page++) {
    const key = `iqro_Iqro ${viewedIqroLevel}_hal_${page}`;
    if (progressMap[key] && progressMap[key].is_completed) doneCount++;
  }

  const pct = Math.round((doneCount / cfg.totalPages) * 100);
  const progTextEl = document.getElementById('iqroProgressText');
  const progFillEl = document.getElementById('iqroProgressFill');

  if (progTextEl) progTextEl.textContent = `${doneCount} dari ${cfg.totalPages} Halaman Selesai (${pct}%)`;
  if (progFillEl) progFillEl.style.width = `${pct}%`;
}

function renderIqroUnlockCard() {
  const card = document.getElementById('iqroUnlockCard');
  const btn = document.getElementById('btnUnlockNextIqro');
  const congrats = document.getElementById('unlockCongratsText');
  if (!card || !btn) return;

  const currentCfg = IQRO_CONFIG[currentIqroLevel] || IQRO_CONFIG[1];

  // Hitung jumlah halaman tuntas di level AKTIF siswa (bukan level yang hanya sedang dilihat)
  let activeDoneCount = 0;
  for (let page = currentCfg.startPage; page <= currentCfg.endPage; page++) {
    const key = `iqro_Iqro ${currentIqroLevel}_hal_${page}`;
    if (progressMap[key] && progressMap[key].is_completed) activeDoneCount++;
  }

  const remaining = currentCfg.totalPages - activeDoneCount;
  const isAllDone = remaining <= 0;

  if (currentIqroLevel >= 6) {
    if (isAllDone) {
      card.className = 'unlock-promotion-card is-ready';
      congrats.style.display = 'block';
      congrats.textContent = '🎓 Maa Syaa Allah! Siswa Telah Menyelesaikan Iqro 6!';
      btn.className = 'btn-unlock-level is-ready';
      btn.disabled = false;
      btn.innerHTML = '🌟 Lulus / Khatam Iqro &amp; Siap Masuk Al-Qur\'an';
    } else {
      card.className = 'unlock-promotion-card';
      congrats.style.display = 'none';
      btn.className = 'btn-unlock-level is-locked';
      btn.disabled = true;
      btn.innerHTML = `🔒 Selesaikan Semua Halaman Iqro 6 (${remaining} Halaman Tersisa)`;
    }
    return;
  }

  const nextLevel = currentIqroLevel + 1;

  if (isAllDone) {
    card.className = 'unlock-promotion-card is-ready';
    congrats.style.display = 'block';
    congrats.textContent = `🎉 Luar Biasa! Semua Halaman ${currentCfg.name} Telah Tuntas!`;
    btn.className = 'btn-unlock-level is-ready';
    btn.disabled = false;
    btn.innerHTML = `Buka &amp; Naik ke Iqro ${nextLevel} 🔓`;
  } else {
    card.className = 'unlock-promotion-card';
    congrats.style.display = 'none';
    btn.className = 'btn-unlock-level is-locked';
    btn.disabled = true;
    btn.innerHTML = `🔒 Selesaikan Semua Halaman untuk Membuka Iqro ${nextLevel} (${remaining} Halaman Tersisa)`;
  }
}

// ============================================================
// PROMOSI NAIK LEVEL IQRO
// ============================================================
async function advanceStudentLevel(targetLevel) {
  if (!selectedStudentId) return;
  const sName = selectedStudent ? (selectedStudent.full_name || selectedStudent.name) : 'Siswa';

  const confirmMsg =
    targetLevel > 6
      ? `Selamat! Yakin ingin menetapkan status "${sName}" telah KHATAM Iqro?`
      : `Alhamdulillah! Yakin ingin menaikkan "${sName}" ke Iqro ${targetLevel}?`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await callApi('/api/learning-progress/advance-level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: selectedStudentId,
        target_level: targetLevel,
        updated_by: currentUser ? currentUser.full_name : 'Guru PIA',
      }),
    });

    if (res && res.success) {
      currentIqroLevel = targetLevel;
      viewedIqroLevel = Math.min(targetLevel, 6);

      // Simpan ke cache lokal
      localStorage.setItem(
        `pia_progress_${selectedStudentId}`,
        JSON.stringify({
          current_iqro_level: currentIqroLevel,
          progress: progressMap,
        })
      );

      renderIqroStepper();
      renderIqroChecklist();
      renderIqroUnlockCard();
      updateSummaryBadges();
      loadOverviewData();

      showBanner(
        targetLevel > 6
          ? `Alhamdulillah! "${sName}" telah dinyatakan Khatam Iqro 6 dan siap masuk Al-Qur'an!`
          : `Alhamdulillah! "${sName}" berhasil naik ke Iqro ${targetLevel}!`,
        'success'
      );
    }
  } catch (err) {
    showBanner(err.message || 'Gagal menaikkan level siswa.', 'error');
  }
}

// ============================================================
// TAB 2: HAFALAN AL-QUR'AN (JUZ 30)
// ============================================================
function renderQuranChecklist() {
  const bodyEl = document.getElementById('quranTableBody');
  const progTextEl = document.getElementById('quranProgressText');
  const progFillEl = document.getElementById('quranProgressFill');
  const countDoneEl = document.getElementById('countDoneSurah');
  const countPendingEl = document.getElementById('countPendingSurah');
  if (!bodyEl) return;

  let doneCount = 0;
  let visibleSurahs = SURAH_JUZ_30;

  // Filter pencarian nama surat
  if (quranSearchQuery) {
    visibleSurahs = visibleSurahs.filter((s) =>
      s.name.toLowerCase().includes(quranSearchQuery.toLowerCase())
    );
  }

  // Hitung total tuntas keseluruhan (semua 37 surat)
  for (const s of SURAH_JUZ_30) {
    const key = `hafalan_Juz 30_surat_${s.no}`;
    if (progressMap[key] && progressMap[key].is_completed) doneCount++;
  }

  const pendingCount = 37 - doneCount;
  if (countDoneEl) countDoneEl.textContent = String(doneCount);
  if (countPendingEl) countPendingEl.textContent = String(pendingCount);

  // Filter status (all / done / pending)
  if (quranFilterMode === 'done') {
    visibleSurahs = visibleSurahs.filter((s) => {
      const key = `hafalan_Juz 30_surat_${s.no}`;
      return progressMap[key] && progressMap[key].is_completed;
    });
  } else if (quranFilterMode === 'pending') {
    visibleSurahs = visibleSurahs.filter((s) => {
      const key = `hafalan_Juz 30_surat_${s.no}`;
      return !progressMap[key] || !progressMap[key].is_completed;
    });
  }

  if (visibleSurahs.length === 0) {
    bodyEl.innerHTML = `
      <tr>
        <td colspan="3" style="text-align: center; padding: 24px; color: #94a3b8; font-weight: 500;">
          Tidak ada surat yang cocok dengan filter atau pencarian "${escapeHtml(quranSearchQuery)}".
        </td>
      </tr>
    `;
  } else {
    bodyEl.innerHTML = visibleSurahs
      .map((s) => {
        const key = `hafalan_Juz 30_surat_${s.no}`;
        const pData = progressMap[key] || { is_completed: 0, note: '' };
        const isDone = Boolean(pData.is_completed);
        const noteVal = pData.note || (isDone ? 'TUNTAS' : '');

        return `
          <tr class="${isDone ? 'is-done' : ''}" data-surah="${s.no}">
            <td>
              <div class="mutabaah-item-name">
                <span>${escapeHtml(s.name)}</span>
              </div>
              <div class="mutabaah-subtext">${s.ayat} Ayat</div>
            </td>
            <td class="mutabaah-check-cell">
              <input
                type="checkbox"
                class="mutabaah-checkbox quran-chk"
                data-surah="${s.no}"
                ${isDone ? 'checked' : ''}
                title="Tandai Surah ${s.name} tuntas"
              />
            </td>
            <td class="mutabaah-note-cell">
              <input
                type="text"
                class="mutabaah-note-input quran-note ${isDone ? 'is-tuntas' : ''}"
                data-surah="${s.no}"
                value="${escapeHtml(noteVal)}"
                placeholder="TUNTAS / Lancar (Mutqin)..."
              />
            </td>
          </tr>
        `;
      })
      .join('');
  }

  // Update progress bar
  const pct = Math.round((doneCount / 37) * 100);
  if (progTextEl) progTextEl.textContent = `${doneCount} dari 37 Surat Tuntas (${pct}%)`;
  if (progFillEl) progFillEl.style.width = `${pct}%`;

  // Pasang Event Listeners
  bodyEl.querySelectorAll('.quran-chk').forEach((chk) => {
    chk.addEventListener('change', () => {
      const surahNo = Number(chk.getAttribute('data-surah'));
      const surahObj = SURAH_JUZ_30.find((s) => s.no === surahNo);
      const isChecked = chk.checked;
      const tr = chk.closest('tr');
      const noteInput = tr.querySelector('.quran-note');

      if (isChecked) {
        tr.classList.add('is-done');
        if (noteInput && (!noteInput.value.trim() || noteInput.value.trim() === '-')) {
          noteInput.value = 'TUNTAS';
          noteInput.classList.add('is-tuntas');
        }
      } else {
        tr.classList.remove('is-done');
        if (noteInput && noteInput.value.trim() === 'TUNTAS') {
          noteInput.classList.remove('is-tuntas');
        }
      }

      queueSaveProgress(
        'hafalan',
        'Juz 30',
        `surat_${surahNo}`,
        surahObj ? surahObj.name : `Surat ${surahNo}`,
        isChecked,
        noteInput ? noteInput.value.trim() : ''
      );

      // Hitung ulang statistik hafalan
      updateQuranProgressStats();
    });
  });

  bodyEl.querySelectorAll('.quran-note').forEach((inp) => {
    inp.addEventListener('change', () => {
      const surahNo = Number(inp.getAttribute('data-surah'));
      const surahObj = SURAH_JUZ_30.find((s) => s.no === surahNo);
      const tr = inp.closest('tr');
      const chk = tr.querySelector('.quran-chk');
      const val = inp.value.trim();

      if (val.toUpperCase() === 'TUNTAS') {
        inp.classList.add('is-tuntas');
      } else {
        inp.classList.remove('is-tuntas');
      }

      queueSaveProgress(
        'hafalan',
        'Juz 30',
        `surat_${surahNo}`,
        surahObj ? surahObj.name : `Surat ${surahNo}`,
        chk ? chk.checked : false,
        val
      );
    });
  });
}

function updateQuranProgressStats() {
  let doneCount = 0;
  for (const s of SURAH_JUZ_30) {
    const key = `hafalan_Juz 30_surat_${s.no}`;
    if (progressMap[key] && progressMap[key].is_completed) doneCount++;
  }

  const pendingCount = 37 - doneCount;
  const countDoneEl = document.getElementById('countDoneSurah');
  const countPendingEl = document.getElementById('countPendingSurah');
  if (countDoneEl) countDoneEl.textContent = String(doneCount);
  if (countPendingEl) countPendingEl.textContent = String(pendingCount);

  const pct = Math.round((doneCount / 37) * 100);
  const progTextEl = document.getElementById('quranProgressText');
  const progFillEl = document.getElementById('quranProgressFill');
  if (progTextEl) progTextEl.textContent = `${doneCount} dari 37 Surat Tuntas (${pct}%)`;
  if (progFillEl) progFillEl.style.width = `${pct}%`;
}

// ============================================================
// BAGIAN BAWAH: REKAPITULASI PROGRES SELURUH SISWA (OVERVIEW KELAS)
// ============================================================
async function loadOverviewData() {
  const bodyEl = document.getElementById('overviewTableBody');
  if (!bodyEl) return;

  bodyEl.innerHTML = `
    <tr>
      <td colspan="7" style="text-align: center; padding: 24px; color: #64748b;">
        Memuat rekapitulasi progres seluruh siswa...
      </td>
    </tr>
  `;

  try {
    const res = await callApi('/api/learning-progress/overview');
    if (res && Array.isArray(res.students)) {
      renderOverviewList(res.students);
      return;
    }
  } catch (err) {
    console.warn('Gagal memuat overview dari server:', err);
  }

  // Fallback lokal jika server offline
  const fallbackList = studentsList.map((s) => {
    return {
      id: s.id,
      name: s.full_name || s.name,
      class_name: s.class_name,
      current_iqro_level: 1,
      current_iqro_completed: 0,
      hafalan_completed: 0,
    };
  });
  renderOverviewList(fallbackList);
}

function renderOverviewList(list) {
  const bodyEl = document.getElementById('overviewTableBody');
  if (!bodyEl) return;

  if (list.length === 0) {
    bodyEl.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 24px; color: #94a3b8;">
          Belum ada siswa yang terdaftar di sistem.
        </td>
      </tr>
    `;
    return;
  }

  // Hitung agregat statistik
  let khatamCount = 0;
  let totalSurahDone = 0;
  let totalLevels = 0;

  for (const s of list) {
    if (s.current_iqro_level > 6) khatamCount++;
    totalLevels += Math.min(s.current_iqro_level, 6);
    totalSurahDone += s.hafalan_completed || 0;
  }

  const avgLevel = list.length > 0 ? Math.round(totalLevels / list.length) : 1;

  document.getElementById('statTotalStudents').textContent = String(list.length);
  document.getElementById('statAvgIqro').textContent = `Iqro ${avgLevel}`;
  document.getElementById('statKhatamIqro').textContent = String(khatamCount);
  document.getElementById('statTotalSurahDone').textContent = String(totalSurahDone);

  bodyEl.innerHTML = list
    .map((s, idx) => {
      const curLvl = s.current_iqro_level || 1;
      const isKhatam = curLvl > 6;
      const cfg = IQRO_CONFIG[curLvl] || IQRO_CONFIG[1];
      const iqroDone = s.current_iqro_completed || 0;
      const hafalanDone = s.hafalan_completed || 0;

      const iqroTag = isKhatam
        ? '<span class="badge-progress-iqro" style="background: #ecfdf5; color: #059669; border-color: #a7f3d0;">🎓 Khatam Iqro</span>'
        : `<span class="badge-progress-iqro">📖 Iqro ${curLvl}</span>`;

      const iqroProgressPct = isKhatam
        ? '100% Selesai'
        : `${iqroDone} / ${cfg.totalPages} Halaman (${Math.round((iqroDone / cfg.totalPages) * 100)}%)`;

      const hafalanProgressPct = `${hafalanDone} / 37 Surat (${Math.round((hafalanDone / 37) * 100)}%)`;

      return `
        <tr>
          <td style="text-align: center; font-weight: 700; color: #64748b;">${idx + 1}</td>
          <td>
            <strong style="color: #0f172a; font-size: 0.93rem;">${escapeHtml(s.name)}</strong>
          </td>
          <td>
            <span class="student-class-tag">${escapeHtml(s.class_name || '-')}</span>
          </td>
          <td>${iqroTag}</td>
          <td style="font-weight: 600; font-size: 0.86rem; color: #334155;">${iqroProgressPct}</td>
          <td style="font-weight: 600; font-size: 0.86rem; color: #be185d;">${hafalanProgressPct}</td>
          <td>
            <button
              type="button"
              class="btn-tool-pill active btn-open-student-recap"
              data-id="${s.id}"
              style="padding: 4px 10px; font-size: 0.78rem;"
            >
              Buka Mutaba'ah →
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  bodyEl.querySelectorAll('.btn-open-student-recap').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sId = Number(btn.getAttribute('data-id'));
      await selectStudent(sId);
      switchTab('panelIqro');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// ============================================================
// MODAL ATUR LEVEL MANUAL
// ============================================================
function initManualLevelModal() {
  const modal = document.getElementById('modalManualLevel');
  const btnOpen = document.getElementById('btnManualLevel');
  const btnCancel = document.getElementById('btnCancelManualLevel');
  const btnConfirm = document.getElementById('btnConfirmManualLevel');
  const selectLvl = document.getElementById('selectManualIqroLevel');

  if (!modal || !btnOpen) return;

  btnOpen.addEventListener('click', () => {
    if (!selectedStudentId) {
      showBanner('Harap pilih siswa terlebih dahulu.', 'error');
      return;
    }
    if (selectLvl) selectLvl.value = String(currentIqroLevel);
    modal.showModal();
  });

  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      modal.close();
    });
  }

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      const newLvl = Number(selectLvl.value) || 1;
      modal.close();
      await advanceStudentLevel(newLvl);
    });
  }
}

// ============================================================
// TAB SWITCHING (IQRO & HAFALAN)
// ============================================================
function switchTab(targetPanelId) {
  document.querySelectorAll('.mutabaah-main-tabs .mutabaah-tab-btn').forEach((btn) => {
    if (btn.getAttribute('data-tab') === targetPanelId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.mutabaah-panel').forEach((panel) => {
    if (panel.id === targetPanelId) {
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  });
}

// ============================================================
// INISIALISASI HALAMAN
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initHeaderAndAuth();

  // Tab Listener
  document.querySelectorAll('.mutabaah-main-tabs .mutabaah-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panelId = btn.getAttribute('data-tab');
      switchTab(panelId);
    });
  });

  // Dropdown Pilih Siswa Listener
  const studentSelectEl = document.getElementById('studentSelect');
  if (studentSelectEl) {
    studentSelectEl.addEventListener('change', () => {
      const val = studentSelectEl.value;
      if (val) {
        selectStudent(val);
      }
    });
  }

  // Iqro Toolbar Buttons
  const btnCheckAllIqro = document.getElementById('btnCheckAllIqro');
  if (btnCheckAllIqro) {
    btnCheckAllIqro.addEventListener('click', () => {
      const cfg = IQRO_CONFIG[viewedIqroLevel] || IQRO_CONFIG[1];
      for (let p = cfg.startPage; p <= cfg.endPage; p++) {
        queueSaveProgress(
          'iqro',
          `Iqro ${viewedIqroLevel}`,
          `hal_${p}`,
          `Halaman ${p}`,
          true,
          'TUNTAS'
        );
      }
      renderIqroChecklist();
      renderIqroUnlockCard();
    });
  }

  const btnUncheckAllIqro = document.getElementById('btnUncheckAllIqro');
  if (btnUncheckAllIqro) {
    btnUncheckAllIqro.addEventListener('click', () => {
      if (!confirm(`Hapus semua tanda centang pada ${IQRO_CONFIG[viewedIqroLevel].name}?`)) return;
      const cfg = IQRO_CONFIG[viewedIqroLevel] || IQRO_CONFIG[1];
      for (let p = cfg.startPage; p <= cfg.endPage; p++) {
        queueSaveProgress(
          'iqro',
          `Iqro ${viewedIqroLevel}`,
          `hal_${p}`,
          `Halaman ${p}`,
          false,
          ''
        );
      }
      renderIqroChecklist();
      renderIqroUnlockCard();
    });
  }

  // Tombol Unlock Level Iqro Selanjutnya
  const btnUnlock = document.getElementById('btnUnlockNextIqro');
  if (btnUnlock) {
    btnUnlock.addEventListener('click', async () => {
      const nextLevel = currentIqroLevel + 1;
      await advanceStudentLevel(nextLevel);
    });
  }

  // Hafalan Toolbar Buttons & Search
  const quranSearchInput = document.getElementById('quranSearchInput');
  if (quranSearchInput) {
    quranSearchInput.addEventListener('input', (e) => {
      quranSearchQuery = e.target.value.trim();
      renderQuranChecklist();
    });
  }

  const quranFilterBtns = document.querySelectorAll('#panelQuran [data-quran-filter], #panelQuran [data-filter]');
  quranFilterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      quranFilterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      quranFilterMode = btn.getAttribute('data-quran-filter') || btn.getAttribute('data-filter') || 'all';
      renderQuranChecklist();
    });
  });

  // Tombol Refresh Overview
  const btnRefreshOverview = document.getElementById('btnRefreshOverview');
  if (btnRefreshOverview) {
    btnRefreshOverview.addEventListener('click', () => {
      loadOverviewData();
    });
  }

  initManualLevelModal();

  // Load Data Awal
  await loadStudents();
  loadOverviewData();
});
