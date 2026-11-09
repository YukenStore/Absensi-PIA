/**
 * Logika Halaman Utama (Rekap Absensi Siswa & Guru)
 * Sistem Informasi Pendidikan Islam At-Taqwa (PIA)
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

// Daftar Siswa & Guru Pendidikan Islam At-Taqwa (terhubung ke API / Database SQL)
let state = {
  students: [
    { id: 1, name: 'Ahmad Fauzan' },
    { id: 2, name: 'Aisyah Putri Azzahra' },
    { id: 3, name: 'Muhammad Rizky Pratama' },
    { id: 4, name: 'Siti Nurhaliza' },
    { id: 5, name: 'Zaidan Al-Farizi' },
    { id: 6, name: 'Khadijah Humaira' },
    { id: 7, name: 'Naufal Ramadhan' },
    { id: 8, name: 'Fatimah Az-Zahra' },
  ],
  teachers: [
    { id: 1, name: 'Ustadz H. Abdullah, S.Pd.I' },
    { id: 2, name: 'Ustadzah Siti Aminah, S.Ag' },
    { id: 3, name: 'Kak Fikri (Admin / Koordinator)' },
    { id: 4, name: 'Ustadz Muhammad Yusuf' },
    { id: 5, name: 'Ustadzah Nurul Hidayah' },
  ],
  // Map tanggal libur tambahan: { "YYYY-MM-DD": true }
  customHolidays: {},
  // Map absensi siswa: { "studentId_YYYY-MM-DD": "H" | "S" | "A" }
  studentRecords: {},
  // Map absensi guru: { "teacherId_YYYY-MM-DD": "H" | "S" | "A" }
  teacherRecords: {},
};

// Muat info user yang sedang login
function initUserHeader() {
  const nameEl = document.getElementById('activeUserName');
  const emailEl = document.getElementById('activeUserEmail');
  try {
    const rawUser = localStorage.getItem('pia_user');
    if (rawUser) {
      const user = JSON.parse(rawUser);
      if (user.full_name && nameEl) nameEl.textContent = user.full_name;
      if (user.email && emailEl) emailEl.textContent = user.email;
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
    await fetch('/api/attendance/toggle-holiday', {
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

// Buat data deterministik awal (agar tabel langsung terlihat lengkap & nyata)
function seedSampleAttendanceIfEmpty() {
  try {
    const savedHolidays = localStorage.getItem('pia_custom_holidays');
    if (savedHolidays) {
      state.customHolidays = JSON.parse(savedHolidays);
    }
  } catch (_) {}

  const yearsToSeed = [2025, 2026];
  for (const year of yearsToSeed) {
    for (let m = 0; m < 12; m++) {
      const days = getDaysInMonth(year, m);
      for (let d = 1; d <= days; d++) {
        const dow = new Date(year, m, d).getDay();
        if (dow === 6) continue; // Sabtu libur

        const dateKey = formatDateKey(year, m, d);

        // Siswa
        for (const s of state.students) {
          const key = `${s.id}_${dateKey}`;
          if (!state.studentRecords[key]) {
            const hash = (s.id * 31 + d * 17 + (m + 1) * 13 + year) % 20;
            if (hash === 0) state.studentRecords[key] = 'A'; // Alfa (Merah)
            else if (hash === 1 || hash === 2) state.studentRecords[key] = 'S'; // Sakit/Izin (Oranye)
            else state.studentRecords[key] = 'H'; // Hadir (Hijau)
          }
        }

        // Guru
        for (const t of state.teachers) {
          const key = `${t.id}_${dateKey}`;
          if (!state.teacherRecords[key]) {
            const hash = (t.id * 29 + d * 19 + (m + 1) * 7 + year) % 25;
            if (hash === 0) state.teacherRecords[key] = 'A';
            else if (hash === 1) state.teacherRecords[key] = 'S';
            else state.teacherRecords[key] = 'H';
          }
        }
      }
    }
  }
}

// Ambil data dari server SQL jika tersedia
async function loadServerOverview() {
  try {
    const resp = await fetch('/api/attendance/overview');
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.students && data.students.length > 0) state.students = data.students;
    if (data.teachers && data.teachers.length > 0) state.teachers = data.teachers;
    if (data.custom_holidays) {
      state.customHolidays = { ...state.customHolidays, ...data.custom_holidays };
    }
    if (data.student_records) {
      state.studentRecords = { ...state.studentRecords, ...data.student_records };
    }
    if (data.teacher_records) {
      state.teacherRecords = { ...state.teacherRecords, ...data.teacher_records };
    }
    renderAllViews();
  } catch (_) {}
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

  // Body Tabel
  let bodyHtml = '';
  peopleList.forEach((person, idx) => {
    bodyHtml += `<tr>
      <td class="sticky-no">${idx + 1}</td>
      <td class="sticky-col">${person.name}</td>`;

    for (let d = 1; d <= daysCount; d++) {
      const holiday = isHolidayDate(year, monthIndex, d);
      if (holiday) {
        bodyHtml += `<td class="cell-status cell-libur" title="Hari Libur">L</td>`;
        continue;
      }

      const dateKey = formatDateKey(year, monthIndex, d);
      const status = recordsMap[`${person.id}_${dateKey}`] || 'H';

      if (status === 'H') {
        bodyHtml += `<td class="cell-status cell-hadir" title="${person.name} - Tanggal ${d}: Hadir">H</td>`;
      } else if (status === 'S' || status === 'I') {
        bodyHtml += `<td class="cell-status cell-sakit" title="${person.name} - Tanggal ${d}: Sakit/Izin">${status}</td>`;
      } else {
        bodyHtml += `<td class="cell-status cell-alfa" title="${person.name} - Tanggal ${d}: Alfa">A</td>`;
      }
    }

    bodyHtml += `</tr>`;
  });

  bodyEl.innerHTML = bodyHtml;
}

// =========================================================================
// RENDER TABEL REKAP ABSENSI (TOTAL HADIR, SAKIT, ALFA, PERSENTASE)
// =========================================================================
function renderRecapTable({ bodyEl, peopleList, recordsMap, filterConfig }) {
  // Tentukan daftar (year, monthIndex) yang dihitung berdasarkan filterConfig
  const targetMonths = [];

  if (filterConfig.mode === 'all') {
    // Semua data dari awal sampai akhir (seluruh tahun & bulan yang ada)
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
    let totalSakit = 0;
    let totalAlfa = 0;
    let effectiveDays = 0;

    for (const { year, monthIndex } of targetMonths) {
      const daysCount = getDaysInMonth(year, monthIndex);
      for (let d = 1; d <= daysCount; d++) {
        if (isHolidayDate(year, monthIndex, d)) continue;
        effectiveDays++;
        const dateKey = formatDateKey(year, monthIndex, d);
        const st = recordsMap[`${person.id}_${dateKey}`] || 'H';
        if (st === 'H') totalHadir++;
        else if (st === 'S' || st === 'I') totalSakit++;
        else totalAlfa++;
      }
    }

    const percentage =
      effectiveDays > 0 ? Math.round((totalHadir * 100) / effectiveDays) : 0;

    rowsHtml += `
      <tr>
        <td>${idx + 1}</td>
        <td style="font-weight: 700; color: var(--secondary);">${person.name}</td>
        <td><span class="badge-count badge-hadir">${totalHadir}</span></td>
        <td><span class="badge-count badge-sakit">${totalSakit}</span></td>
        <td><span class="badge-count badge-alfa">${totalAlfa}</span></td>
        <td style="font-weight: 600;">${effectiveDays} Hari</td>
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

  renderDailyMatrix({
    headEl: document.getElementById('siswaDailyHead'),
    bodyEl: document.getElementById('siswaDailyBody'),
    peopleList: state.students,
    recordsMap: state.studentRecords,
    year: dailyYear,
    monthIndex: dailyMonth,
    personLabel: 'Nama Siswa',
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
  });
}

function renderGuruSection() {
  // Satu dropdown Bulan & Tahun di atas mengatur Tabel Harian sekaligus Rekap Absensi Guru
  const masterMonth = parseInt(document.getElementById('guruMasterMonth').value, 10);
  const masterYear = parseInt(document.getElementById('guruMasterYear').value, 10);
  const periodLabel = `${MONTH_NAMES[masterMonth]} ${masterYear}`;

  const dailyTitle = document.getElementById('guruDailyTitle');
  const recapTitle = document.getElementById('guruRecapTitle');
  if (dailyTitle) dailyTitle.textContent = `Tabel Harian Absensi Guru — ${periodLabel}`;
  if (recapTitle) recapTitle.textContent = `Rekap Absensi Guru — ${periodLabel}`;

  renderDailyMatrix({
    headEl: document.getElementById('guruDailyHead'),
    bodyEl: document.getElementById('guruDailyBody'),
    peopleList: state.teachers,
    recordsMap: state.teacherRecords,
    year: masterYear,
    monthIndex: masterMonth,
    personLabel: 'Nama Guru',
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
  seedSampleAttendanceIfEmpty();
  initMainTabsAndEvents();
  renderAllViews();
  loadServerOverview();
});

