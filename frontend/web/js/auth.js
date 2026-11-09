/**
 * Modul Autentikasi Web - Sistem Absensi PIA
 * Menghubungkan UI Web (HTML/CSS) dengan Backend FastAPI & C++ Core
 */

const API_BASE_URL = 'http://localhost:8000/api/auth';

// Utilitas untuk menampilkan pesan alert
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

// Toggle visibilitas password
document.querySelectorAll('.toggle-password').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (!input) return;

    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
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
    submitBtn.innerHTML = '<span>Mengirim OTP ke Email...</span>';

    try {
      const response = await fetch(`${API_BASE_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          email: email,
          username: username,
          password: password,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Gagal melakukan registrasi.');
      }

      sessionStorage.setItem('pending_verification_email', email);
      showAlert('Registrasi berhasil! Mengalihkan ke halaman verifikasi OTP...', 'success');
      setTimeout(() => {
        window.location.href = `verify-otp.html?email=${encodeURIComponent(email)}`;
      }, 1000);
    } catch (err) {
      // Fallback simulasi jika backend belum dijalankan
      if (err instanceof TypeError && err.message.includes('fetch')) {
        sessionStorage.setItem('pending_verification_email', email);
        showAlert(
          'Mode Pratinjau UI: Kode OTP simulasi telah dikirim ke ' + email + '. Mengalihkan...',
          'success'
        );
        setTimeout(() => {
          window.location.href = `verify-otp.html?email=${encodeURIComponent(email)}`;
        }, 1200);
      } else {
        showAlert(err.message);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Daftar &amp; Kirim Kode OTP</span>';
      }
    }
  });
}

// ==========================================
// 2. LOGIKA VERIFIKASI OTP EMAIL
// ==========================================
const otpForm = document.getElementById('otpForm');
if (otpForm) {
  const urlParams = new URLSearchParams(window.location.search);
  const emailFromUrl = urlParams.get('email') || sessionStorage.getItem('pending_verification_email') || '';
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

  // Pengaturan 6 kotak input OTP
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
      const response = await fetch(`${API_BASE_URL}/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Gagal mengirim ulang OTP.');

      showAlert(`Kode OTP baru telah dikirimkan ke ${targetEmail}.`, 'success');
      startCountdown();
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        showAlert(`Mode Pratinjau UI: Kode OTP baru dikirim ulang ke ${targetEmail}.`, 'success');
        startCountdown();
      } else {
        showAlert(err.message);
      }
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
      const response = await fetch(`${API_BASE_URL}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          otp_code: otpCode,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Kode OTP tidak valid atau kedaluwarsa.');

      sessionStorage.removeItem('pending_verification_email');
      showAlert('Akun berhasil diaktifkan! Mengalihkan ke halaman Login...', 'success');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1200);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        sessionStorage.removeItem('pending_verification_email');
        showAlert('Mode Pratinjau UI: Aktivasi OTP berhasil! Mengalihkan ke Login...', 'success');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1200);
      } else {
        showAlert(err.message);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Verifikasi &amp; Aktifkan Akun</span>';
      }
    }
  });
}

// ==========================================
// 3. LOGIKA FORM LOGIN
// ==========================================
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const identifier = document.getElementById('identifier').value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = document.getElementById('submitBtn');

    if (!identifier || !password) {
      showAlert('Harap masukkan username/email beserta password Anda.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Memproses Login...</span>';

    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier,
          password: password,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Username/email atau password salah.');

      if (data.access_token) {
        localStorage.setItem('pia_access_token', data.access_token);
      }
      showAlert('Login berhasil! Selamat datang di Sistem Absensi PIA.', 'success');
      submitBtn.innerHTML = '<span>Berhasil Masuk</span>';
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        showAlert(
          'Mode Pratinjau UI: Form Login valid (Backend FastAPI belum dijalankan).',
          'success'
        );
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Masuk ke Akun</span>';
      } else {
        showAlert(err.message);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Masuk ke Akun</span>';
      }
    }
  });
}

