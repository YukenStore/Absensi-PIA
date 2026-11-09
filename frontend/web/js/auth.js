/**
 * Modul Autentikasi Web - Sistem Absensi PIA
 * Mendukung Server Lokal (SQLite + SMTP Gmail), Cloudflare Worker, & GitHub Pages
 */

const API_BASE_URL = '/api/auth';
const CLOUDFLARE_API_URL = 'https://absensi-pia.yumenoboken.workers.dev/api/auth';

// =========================================================================
// ENGINE DATABASE LOKAL BROWSER & SINKRONISASI AKUN (UNTUK GITHUB PAGES)
// =========================================================================
const DEFAULT_SEEDED_USERS = [
  {
    id: 1,
    full_name: 'Yuken',
    email: 'yumenoboken@gmail.com',
    username: 'Yuken',
    password_hash: 'd60a21f8dad3657f52d52c97d4ea9e5af62cb0df49ecb59e5d3d1010dd3dd126',
    password_salt: '6b5c963375d89fa95bd982a8250df01d',
    role: 'admin',
    is_active: true,
  },
];

async function sha256HexBrowser(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPasswordPiaCore(password, salt) {
  let current = `${salt}:${password}:PIA_CORE_V1`;
  for (let i = 0; i < 1000; i++) {
    const digest = await sha256HexBrowser(current);
    current = `${digest}:${salt}`;
  }
  return await sha256HexBrowser(current);
}

function getStaticDb() {
  let db = { users: [], otps: [] };
  try {
    const raw = localStorage.getItem('pia_gh_pages_db');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.users)) {
        db = parsed;
      }
    }
  } catch (_) {}

  // Pastikan akun terdaftar dari database lokal tersinkronisasi di GitHub Pages
  let updated = false;
  for (const seedUser of DEFAULT_SEEDED_USERS) {
    const exists = db.users.find(
      (u) => u.email.toLowerCase() === seedUser.email.toLowerCase()
    );
    if (!exists) {
      db.users.push({ ...seedUser });
      updated = true;
    } else if (!exists.password_hash && !exists.password) {
      Object.assign(exists, seedUser);
      updated = true;
    }
  }
  if (updated) {
    saveStaticDb(db);
  }
  return db;
}

function saveStaticDb(dbObj) {
  try {
    localStorage.setItem('pia_gh_pages_db', JSON.stringify(dbObj));
  } catch (_) {}
}

async function handleStaticAuthFallback(endpoint, payload) {
  const db = getStaticDb();

  if (endpoint === '/register') {
    const fullName = (payload.full_name || '').trim();
    const email = (payload.email || '').trim().toLowerCase();
    const username = (payload.username || '').trim();
    const password = payload.password || '';

    const existingEmail = db.users.find((u) => u.email.toLowerCase() === email);
    if (existingEmail && existingEmail.is_active) {
      throw new Error('Alamat email sudah terdaftar dan aktif. Silakan langsung login.');
    }

    const existingUser = db.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );
    if (existingUser && (!existingEmail || existingUser.email.toLowerCase() !== email)) {
      throw new Error('Username sudah digunakan oleh pengguna lain.');
    }

    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const pwHash = await hashPasswordPiaCore(password, salt);

    if (existingEmail) {
      existingEmail.full_name = fullName;
      existingEmail.username = username;
      existingEmail.password_hash = pwHash;
      existingEmail.password_salt = salt;
      delete existingEmail.password;
    } else {
      db.users.push({
        id: db.users.length + 1,
        full_name: fullName,
        email,
        username,
        password_hash: pwHash,
        password_salt: salt,
        role: email === 'yumenoboken@gmail.com' ? 'admin' : 'guru',
        is_active: false,
      });
    }

    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    db.otps.push({
      email,
      otp_code: otpCode,
      expires_at: Date.now() + 300000,
      is_used: false,
    });
    saveStaticDb(db);

    return {
      success: true,
      message: `Registrasi berhasil! Kode OTP untuk ${email} telah dibuat.`,
      otp_preview: otpCode,
    };
  }

  if (endpoint === '/verify-otp') {
    const email = (payload.email || '').trim().toLowerCase();
    const otpCode = (payload.otp_code || '').trim();

    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user) {
      throw new Error('Akun dengan alamat email tersebut tidak ditemukan.');
    }
    const otpList = db.otps.filter((o) => o.email.toLowerCase() === email && !o.is_used);
    const latestOtp = otpList[otpList.length - 1];
    if (!latestOtp) {
      throw new Error('Tidak ada kode OTP aktif untuk email ini.');
    }
    if (Date.now() > latestOtp.expires_at) {
      throw new Error('Kode OTP telah kedaluwarsa. Silakan klik Kirim Ulang OTP.');
    }
    if (latestOtp.otp_code !== otpCode) {
      throw new Error('Kode OTP yang dimasukkan tidak sesuai.');
    }

    latestOtp.is_used = true;
    user.is_active = true;
    saveStaticDb(db);

    return {
      success: true,
      message: 'Akun berhasil diaktifkan! Silakan login menggunakan akun Anda.',
    };
  }

  if (endpoint === '/resend-otp') {
    const email = (payload.email || '').trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user) {
      throw new Error('Akun dengan alamat email tersebut belum terdaftar.');
    }
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    db.otps.push({
      email,
      otp_code: otpCode,
      expires_at: Date.now() + 300000,
      is_used: false,
    });
    saveStaticDb(db);

    return {
      success: true,
      message: `Kode OTP baru telah dibuat untuk ${email}.`,
      otp_preview: otpCode,
    };
  }

  if (endpoint === '/login') {
    const identifier = (payload.identifier || '').trim();
    const password = payload.password || '';

    const user = db.users.find(
      (u) =>
        u.username.toLowerCase() === identifier.toLowerCase() ||
        u.email.toLowerCase() === identifier.toLowerCase() ||
        u.full_name.toLowerCase() === identifier.toLowerCase()
    );

    if (!user) {
      throw new Error('Username/email atau password tidak sesuai.');
    }

    let passwordMatches = false;
    if (user.password_hash && user.password_salt) {
      const computed = await hashPasswordPiaCore(password, user.password_salt);
      passwordMatches = computed === user.password_hash;
    } else if (user.password) {
      passwordMatches = user.password === password;
    }

    if (!passwordMatches) {
      throw new Error('Username/email atau password tidak sesuai.');
    }
    if (!user.is_active) {
      throw new Error('Akun Anda belum diaktifkan. Silakan verifikasi kode OTP terlebih dahulu.');
    }

    const userRole =
      user.email.toLowerCase() === 'yumenoboken@gmail.com'
        ? 'admin'
        : user.role || 'guru';

    return {
      success: true,
      message: 'Login berhasil!',
      access_token: `gh_token_${user.id}_${Date.now()}`,
      user: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        email: user.email,
        role: userRole,
      },
    };
  }

  throw new Error('Endpoint tidak dikenali.');
}

async function callAuthApi(endpoint, payload) {
  const isGitHubPages = window.location.hostname.includes('github.io');

  if (!isGitHubPages) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (!response.ok) {
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

  // Coba melalui Cloudflare Worker API, atau gunakan fallback GitHub Pages
  try {
    const cfResp = await fetch(`${CLOUDFLARE_API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
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

  return handleStaticAuthFallback(endpoint, payload);
}

function showAlert(message, type = 'error') {
  const alertBox = document.getElementById('alertBox');
  if (!alertBox) return;

  alertBox.className = `alert alert-${type} show`;
  alertBox.textContent = message;
}

function hideAlert() {
  const alertBox = document.getElementById('alertBox');
  if (alertBox) {
    alertBox.className = 'alert';
    alertBox.textContent = '';
  }
}

// Toggle visibilitas password (mata terbuka <-> mata dicoret)
const EYE_OPEN_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`;

const EYE_OFF_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
`;

document.querySelectorAll('.toggle-password').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (!input) return;

    const showPassword = input.type === 'password';
    input.type = showPassword ? 'text' : 'password';
    btn.innerHTML = showPassword ? EYE_OFF_SVG : EYE_OPEN_SVG;
    btn.setAttribute(
      'aria-label',
      showPassword ? 'Sembunyikan Password' : 'Tampilkan Password'
    );
  });
});

// Indikator kekuatan password pada halaman registrasi
const passwordInput = document.getElementById('password');
const strengthText = document.getElementById('strengthText');
if (passwordInput && strengthText) {
  const bars = [
    document.getElementById('bar1'),
    document.getElementById('bar2'),
    document.getElementById('bar3'),
    document.getElementById('bar4'),
  ];

  passwordInput.addEventListener('input', () => {
    const val = passwordInput.value;
    let score = 0;

    if (val.length >= 8) score++;
    if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const colors = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'];
    const labels = ['Lemah', 'Cukup', 'Kuat', 'Sangat Kuat'];

    bars.forEach((bar, idx) => {
      if (idx < score) {
        bar.style.background = colors[score - 1];
      } else {
        bar.style.background = '#e2e8f0';
      }
    });

    strengthText.textContent = val.length === 0 ? 'Keamanan' : labels[Math.max(0, score - 1)];
  });
}

// ==========================================
// 1. LOGIKA FORM REGISTRASI
// ==========================================
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = document.getElementById('submitBtn');

    if (!fullName || !email || !username || !password) {
      showAlert('Harap lengkapi seluruh kolom pendaftaran.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showAlert('Format alamat email tidak valid.');
      return;
    }

    if (/\s/.test(username) || username.length < 4) {
      showAlert('Username minimal 4 karakter dan tidak boleh mengandung spasi.');
      return;
    }

    if (password.length < 8) {
      showAlert('Password harus terdiri dari minimal 8 karakter.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Memproses &amp; Mengirim OTP...</span>';

    try {
      const data = await callAuthApi('/register', {
        full_name: fullName,
        email: email,
        username: username,
        password: password,
      });

      sessionStorage.setItem('pending_verification_email', email);
      if (data.otp_preview) {
        sessionStorage.setItem('demo_otp_preview', data.otp_preview);
      } else {
        sessionStorage.removeItem('demo_otp_preview');
      }

      showAlert('Registrasi berhasil! Mengalihkan ke halaman verifikasi OTP...', 'success');
      setTimeout(() => {
        window.location.href = `verify-otp.html?email=${encodeURIComponent(email)}`;
      }, 900);
    } catch (err) {
      showAlert(err.message || 'Terjadi kesalahan saat menghubungi server.');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Daftar &amp; Kirim Kode OTP</span>';
    }
  });
}

// ==========================================
// 2. LOGIKA VERIFIKASI OTP EMAIL
// ==========================================
const otpForm = document.getElementById('otpForm');
if (otpForm) {
  const urlParams = new URLSearchParams(window.location.search);
  const emailFromUrl =
    urlParams.get('email') || sessionStorage.getItem('pending_verification_email') || '';
  const targetEmailBadge = document.getElementById('targetEmailBadge');
  const manualEmailGroup = document.getElementById('manualEmailGroup');
  const otpEmailInput = document.getElementById('otpEmail');

  if (emailFromUrl) {
    targetEmailBadge.textContent = emailFromUrl;
    if (otpEmailInput) otpEmailInput.value = emailFromUrl;
  } else {
    targetEmailBadge.textContent = 'Masukkan email Anda di bawah ini';
    if (manualEmailGroup) manualEmailGroup.style.display = 'block';
  }

  // Tampilkan status pengiriman OTP
  const otpPreview = sessionStorage.getItem('demo_otp_preview');
  if (otpPreview) {
    showAlert(
      `[Mode Uji Coba OTP] Kode OTP untuk aktivasi akun Anda adalah: ${otpPreview}`,
      'success'
    );
  } else if (emailFromUrl) {
    showAlert(
      `Kode OTP 6 digit telah dikirim ke kotak masuk ${emailFromUrl}. Silakan cek Inbox atau folder Spam.`,
      'success'
    );
  }

  const otpInputs = Array.from(document.querySelectorAll('.otp-input'));
  otpInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
      if (e.target.value && index < otpInputs.length - 1) {
        otpInputs[index + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        otpInputs[index - 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pastedData = (e.clipboardData || window.clipboardData)
        .getData('text')
        .replace(/[^0-9]/g, '')
        .slice(0, otpInputs.length);

      pastedData.split('').forEach((char, i) => {
        if (otpInputs[i]) otpInputs[i].value = char;
      });
      const focusIndex = Math.min(pastedData.length, otpInputs.length - 1);
      if (otpInputs[focusIndex]) otpInputs[focusIndex].focus();
    });
  });

  // Hitung mundur kirim ulang OTP (60 detik)
  let countdown = 60;
  const timerEl = document.getElementById('countdownTimer');
  const resendBtn = document.getElementById('resendOtpBtn');
  let timerInterval;

  function startCountdown() {
    countdown = 60;
    resendBtn.disabled = true;
    clearInterval(timerInterval);

    timerInterval = setInterval(() => {
      countdown--;
      const secs = String(countdown).padStart(2, '0');
      timerEl.textContent = `(00:${secs})`;

      if (countdown <= 0) {
        clearInterval(timerInterval);
        timerEl.textContent = '';
        resendBtn.disabled = false;
      }
    }, 1000);
  }

  startCountdown();

  resendBtn.addEventListener('click', async () => {
    hideAlert();
    const targetEmail = emailFromUrl || (otpEmailInput ? otpEmailInput.value.trim() : '');
    if (!targetEmail) {
      showAlert('Harap masukkan alamat email terlebih dahulu.');
      return;
    }

    try {
      const data = await callAuthApi('/resend-otp', { email: targetEmail });
      if (data.otp_preview) {
        sessionStorage.setItem('demo_otp_preview', data.otp_preview);
        showAlert(
          `Kode OTP baru telah dikirim! [Mode Uji Coba] Kode OTP baru Anda: ${data.otp_preview}`,
          'success'
        );
      } else {
        showAlert(`Kode OTP baru telah dikirimkan ke ${targetEmail}.`, 'success');
      }
      startCountdown();
    } catch (err) {
      showAlert(err.message);
    }
  });

  otpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const targetEmail = emailFromUrl || (otpEmailInput ? otpEmailInput.value.trim() : '');
    const otpCode = otpInputs.map((input) => input.value).join('');
    const submitBtn = document.getElementById('submitBtn');

    if (!targetEmail) {
      showAlert('Alamat email belum diisi.');
      return;
    }

    if (otpCode.length < 6) {
      showAlert('Harap masukkan 6 digit kode OTP secara lengkap.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Memverifikasi OTP...</span>';

    try {
      await callAuthApi('/verify-otp', {
        email: targetEmail,
        otp_code: otpCode,
      });

      sessionStorage.removeItem('pending_verification_email');
      sessionStorage.removeItem('demo_otp_preview');
      showAlert('Akun berhasil diaktifkan! Mengalihkan ke halaman Login...', 'success');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1200);
    } catch (err) {
      showAlert(err.message);
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Verifikasi &amp; Aktifkan Akun</span>';
    }
  });
}

// ==========================================
// 3. LOGIKA FORM LOGIN & FITUR "TETAP LOGIN"
// ==========================================
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  const identifierInput = document.getElementById('identifier');
  const identifierGroup = document.getElementById('identifierGroup');
  const rememberedBox = document.getElementById('rememberedUserBox');
  const rememberedNameEl = document.getElementById('rememberedUserName');
  const switchAccountBtn = document.getElementById('switchAccountBtn');
  const rememberMeCheckbox = document.getElementById('rememberMe');
  const loginSubtitle = document.getElementById('loginSubtitle');

  function applyRememberedUser() {
    try {
      const saved = localStorage.getItem('pia_remembered_user');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && parsed.identifier) {
        identifierInput.value = parsed.identifier;
        if (identifierGroup) identifierGroup.style.display = 'none';
        if (rememberedBox) rememberedBox.style.display = 'flex';
        if (rememberedNameEl) {
          rememberedNameEl.textContent = parsed.full_name
            ? `${parsed.full_name} (${parsed.identifier})`
            : parsed.identifier;
        }
        if (loginSubtitle) {
          loginSubtitle.textContent = 'Cukup masukkan password Anda untuk melanjutkan.';
        }
      }
    } catch (_) {}
  }

  applyRememberedUser();

  if (switchAccountBtn) {
    switchAccountBtn.addEventListener('click', () => {
      localStorage.removeItem('pia_remembered_user');
      identifierInput.value = '';
      if (identifierGroup) identifierGroup.style.display = 'block';
      if (rememberedBox) rememberedBox.style.display = 'none';
      if (loginSubtitle) {
        loginSubtitle.textContent =
          'Silakan masuk menggunakan nama/username atau email beserta password Anda.';
      }
      identifierInput.focus();
    });
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const identifier = identifierInput.value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = document.getElementById('submitBtn');

    if (!identifier || !password) {
      showAlert('Harap masukkan nama/username/email beserta password Anda.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Memproses Login...</span>';

    try {
      const data = await callAuthApi('/login', {
        identifier: identifier,
        password: password,
      });

      if (data.access_token) {
        localStorage.setItem('pia_access_token', data.access_token);
      }
      if (data.user) {
        localStorage.setItem('pia_user', JSON.stringify(data.user));
      }

      if (rememberMeCheckbox && rememberMeCheckbox.checked) {
        localStorage.setItem(
          'pia_remembered_user',
          JSON.stringify({
            identifier: data.user ? data.user.username : identifier,
            full_name: data.user ? data.user.full_name : '',
            email: data.user ? data.user.email : '',
          })
        );
      } else {
        localStorage.removeItem('pia_remembered_user');
      }

      const userName = data.user ? `${data.user.full_name}` : identifier;
      showAlert(`Login berhasil! Selamat datang, ${userName}. Mengalihkan...`, 'success');
      submitBtn.innerHTML = '<span>Berhasil Masuk ✓</span>';
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 600);
    } catch (err) {
      showAlert(err.message);
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Masuk ke Aplikasi</span>';
    }
  });
}
