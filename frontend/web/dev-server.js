const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 5173;
const PUBLIC_DIR = __dirname;
const DB_PATH = path.resolve(__dirname, '../../backend/absensi_pia.db');
const ENV_PATH = path.resolve(__dirname, '../../backend/.env');

// Membaca file backend/.env secara real-time (tanpa perlu restart server saat .env diedit)
function loadEnvConfig() {
  const config = {
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '465',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    SMTP_FROM_NAME: 'Sistem Absensi PIA',
    EMAIL_RELAY_URL: '',
  };

  if (fs.existsSync(ENV_PATH)) {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      config[key] = val;
    }
  }
  return config;
}

function buildOtpHtmlEmail(fullName, otpCode) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="color: #1e3a8a; margin-top: 0;">Aktivasi Akun Absensi PIA</h2>
      <p style="color: #334155; font-size: 15px; line-height: 1.5;">
        Halo <strong>${fullName}</strong>,<br><br>
        Terima kasih telah melakukan registrasi di <strong>Sistem Informasi Absensi &amp; Pembelajaran PIA</strong>.
        Masukkan 6 digit kode OTP berikut untuk mengaktifkan akun Anda:
      </p>
      <div style="background: #eff6ff; border: 1px dashed #2563eb; border-radius: 10px; padding: 16px; text-align: center; margin: 24px 0;">
        <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1d4ed8;">${otpCode}</span>
      </div>
      <p style="color: #64748b; font-size: 13px;">
        Kode ini berlaku selama <strong>5 menit</strong>. Jangan berikan kode rahasia ini kepada siapa pun.
      </p>
    </div>
  `.trim();
}

// Pengiriman Email Asli melalui SMTP Gmail (Port 465 SSL/TLS Native Node.js)
function sendViaGmailSmtp({ smtpUser, smtpPassword, fromName, toEmail, fullName, otpCode }) {
  return new Promise((resolve, reject) => {
    const cleanPass = smtpPassword.replace(/\s+/g, '');
    const subject = `[${otpCode}] Kode Aktivasi Akun Sistem Absensi PIA`;
    const htmlBody = buildOtpHtmlEmail(fullName, otpCode);

    const socket = tls.connect(
      {
        host: 'smtp.gmail.com',
        port: 465,
        servername: 'smtp.gmail.com',
        rejectUnauthorized: false,
        timeout: 15000,
      },
      () => {}
    );

    let step = 0;
    let buffer = '';

    const sendLine = (cmd) => {
      socket.write(cmd + '\r\n');
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line) continue;
        // Tunggu baris terakhir dari multi-line response (karakter ke-4 adalah spasi, bukan '-')
        if (line.length >= 4 && line[3] === '-') continue;

        const code = parseInt(line.slice(0, 3), 10);
        if (code >= 400) {
          socket.destroy();
          return reject(new Error(`SMTP Error (${code}): ${line}`));
        }

        if (step === 0 && code === 220) {
          step = 1;
          sendLine('EHLO absensi-pia.local');
        } else if (step === 1 && code === 250) {
          step = 2;
          sendLine('AUTH LOGIN');
        } else if (step === 2 && code === 334) {
          step = 3;
          sendLine(Buffer.from(smtpUser, 'utf8').toString('base64'));
        } else if (step === 3 && code === 334) {
          step = 4;
          sendLine(Buffer.from(cleanPass, 'utf8').toString('base64'));
        } else if (step === 4 && code === 235) {
          step = 5;
          sendLine(`MAIL FROM:<${smtpUser}>`);
        } else if (step === 5 && code === 250) {
          step = 6;
          sendLine(`RCPT TO:<${toEmail}>`);
        } else if (step === 6 && code === 250) {
          step = 7;
          sendLine('DATA');
        } else if (step === 7 && code === 354) {
          step = 8;
          const mimeMessage = [
            `From: "${fromName}" <${smtpUser}>`,
            `To: <${toEmail}>`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            '',
            htmlBody,
            '.',
          ].join('\r\n');
          sendLine(mimeMessage);
        } else if (step === 8 && code === 250) {
          step = 9;
          sendLine('QUIT');
          socket.end();
          return resolve(true);
        }
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Koneksi ke server SMTP Gmail timeout.'));
    });

    socket.on('error', (err) => {
      reject(err);
    });
  });
}

// Pengiriman Email Asli melalui Google Apps Script Relay URL (HTTPS)
function sendViaRelayWebhook(relayUrl, { toEmail, fullName, otpCode }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      to: toEmail,
      subject: `[${otpCode}] Kode Aktivasi Akun Sistem Absensi PIA`,
      htmlBody: buildOtpHtmlEmail(fullName, otpCode),
    });

    function postUrl(targetUrl, redirectCount = 0) {
      if (redirectCount > 5) return reject(new Error('Terlalu banyak redirect pada Relay URL.'));
      const u = new URL(targetUrl);
      const req = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: redirectCount > 0 ? 'GET' : 'POST',
          headers:
            redirectCount > 0
              ? {}
              : {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return postUrl(res.headers.location, redirectCount + 1);
          }
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(true);
            } else {
              reject(new Error(`Relay HTTP ${res.statusCode}: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      if (redirectCount === 0) req.write(payload);
      req.end();
    }

    postUrl(relayUrl);
  });
}

async function dispatchOtpEmail({ toEmail, fullName, otpCode }) {
  const env = loadEnvConfig();

  console.log('\n========================================================');
  console.log('  [OTP EMAIL SERVICE - SISTEM ABSENSI PIA]');
  console.log(`  Penerima : ${fullName} <${toEmail}>`);
  console.log(`  KODE OTP : ${otpCode} (Berlaku 5 menit)`);
  console.log('========================================================');

  // 1. Jika SMTP_USER & SMTP_PASSWORD diisi di backend/.env, kirim via SMTP Gmail asli
  if (env.SMTP_USER && env.SMTP_PASSWORD) {
    console.log(`  ➜ Mengirim email OTP asli ke ${toEmail} via SMTP Gmail (${env.SMTP_USER})...`);
    await sendViaGmailSmtp({
      smtpUser: env.SMTP_USER,
      smtpPassword: env.SMTP_PASSWORD,
      fromName: env.SMTP_FROM_NAME || 'Sistem Absensi PIA',
      toEmail,
      fullName,
      otpCode,
    });
    console.log(`  ✓ [SUKSES] Email OTP berhasil terkirim ke kotak masuk ${toEmail}!\n`);
    return { realEmailSent: true };
  }

  // 2. Jika EMAIL_RELAY_URL diisi di backend/.env, kirim via Google Apps Script Relay
  if (env.EMAIL_RELAY_URL) {
    console.log(`  ➜ Mengirim email OTP asli ke ${toEmail} via Email Relay...`);
    await sendViaRelayWebhook(env.EMAIL_RELAY_URL, { toEmail, fullName, otpCode });
    console.log(`  ✓ [SUKSES] Email OTP berhasil terkirim ke kotak masuk ${toEmail}!\n`);
    return { realEmailSent: true };
  }

  console.log('  [!] SMTP_PASSWORD belum diisi di backend/.env. Menggunakan mode pratinjau OTP.\n');
  return { realEmailSent: false };
}

// Inisialisasi Database SQLite (Skema 100% identik dengan Cloudflare D1 & Python Backend)
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS otp_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    is_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS custom_holidays (
    holiday_date TEXT PRIMARY KEY,
    is_holiday INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS teacher_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    teacher_name TEXT NOT NULL,
    teacher_email TEXT NOT NULL,
    attendance_date TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    approval_status TEXT NOT NULL DEFAULT 'Pending',
    approved_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, attendance_date)
  );
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS student_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    attendance_date TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(student_id, attendance_date)
  );
`);

// Pastikan kolom role & is_hidden tersedia pada tabel users dan akun yumenoboken@gmail.com menjadi Admin utama
try {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'guru';`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;`);
} catch (_) {}
try {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, full_name, email, username, password_hash, password_salt, is_active, role, is_hidden)
     VALUES (1, 'Yuken', 'yumenoboken@gmail.com', 'Yuken', 'd60a21f8dad3657f52d52c97d4ea9e5af62cb0df49ecb59e5d3d1010dd3dd126', '6b5c963375d89fa95bd982a8250df01d', 1, 'admin', 0)`
  ).run();
  db.exec(`UPDATE users SET role = 'admin', is_active = 1 WHERE lower(email) = 'yumenoboken@gmail.com';`);
} catch (_) {}

function hashPassword(password, salt) {
  let current = `${salt}:${password}:PIA_CORE_V1`;
  for (let i = 0; i < 1000; i++) {
    const digest = crypto.createHash('sha256').update(current, 'utf8').digest('hex');
    current = `${digest}:${salt}`;
  }
  return crypto.createHash('sha256').update(current, 'utf8').digest('hex');
}

function generateOtp(length = 6) {
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += crypto.randomInt(0, 10).toString();
  }
  return otp;
}

function createJwtToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: String(user.id),
      username: user.username,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 86400,
    })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', 'pia_default_secret_key_change_in_production_2026')
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Private-Network': 'true',
  });
  const jsonStr = JSON.stringify(payload, (key, value) =>
    typeof value === 'bigint' ? Number(value) : value
  );
  res.end(jsonStr);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Private-Network': 'true',
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname.startsWith('/api/auth/') && req.method === 'POST') {
    try {
      const body = await parseBody(req);

      if (pathname === '/api/auth/register') {
        const fullName = (body.full_name || '').trim();
        const email = (body.email || '').trim().toLowerCase();
        const username = (body.username || '').trim();
        const password = body.password || '';

        if (username.length < 4 || username.includes(' ')) {
          return sendJson(res, 400, {
            detail: 'Username minimal 4 karakter dan tidak boleh mengandung spasi.',
          });
        }
        if (!email.includes('@') || !email.split('@')[1]?.includes('.')) {
          return sendJson(res, 400, { detail: 'Format alamat email tidak valid.' });
        }
        if (password.length < 8) {
          return sendJson(res, 400, {
            detail: 'Password harus terdiri dari minimal 8 karakter.',
          });
        }

        const existingEmail = db
          .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
          .get(email);
        if (existingEmail && existingEmail.is_active) {
          return sendJson(res, 400, {
            detail: 'Alamat email sudah terdaftar dan aktif. Silakan langsung login.',
          });
        }

        const existingUser = db
          .prepare('SELECT * FROM users WHERE username = ? LIMIT 1')
          .get(username);
        if (existingUser && (!existingEmail || existingUser.id !== existingEmail.id)) {
          return sendJson(res, 400, {
            detail: 'Username sudah digunakan oleh pengguna lain.',
          });
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const pwHash = hashPassword(password, salt);

        if (existingEmail && !existingEmail.is_active) {
          db.prepare(
            'UPDATE users SET full_name = ?, username = ?, password_hash = ?, password_salt = ? WHERE id = ?'
          ).run(fullName, username, pwHash, salt, existingEmail.id);
        } else {
          db.prepare(
            'INSERT INTO users (full_name, email, username, password_hash, password_salt, is_active) VALUES (?, ?, ?, ?, ?, 0)'
          ).run(fullName, email, username, pwHash, salt);
        }

        const otpCode = generateOtp(6);
        const expiresAt = Math.floor(Date.now() / 1000) + 300;
        db.prepare(
          'INSERT INTO otp_verifications (email, otp_code, expires_at, is_used) VALUES (?, ?, ?, 0)'
        ).run(email, otpCode, expiresAt);

        const mailResult = await dispatchOtpEmail({
          toEmail: email,
          fullName,
          otpCode,
        });

        const responsePayload = {
          success: true,
          email_sent: mailResult.realEmailSent,
          message: mailResult.realEmailSent
            ? `Kode OTP 6 digit telah dikirimkan ke email ${email}. Silakan cek Inbox/Spam Anda.`
            : `Registrasi berhasil! (Isi SMTP_PASSWORD di backend/.env untuk mengirim ke email asli).`,
        };

        if (!mailResult.realEmailSent) {
          responsePayload.otp_preview = otpCode;
        }

        return sendJson(res, 201, responsePayload);
      }

      if (pathname === '/api/auth/verify-otp') {
        const email = (body.email || '').trim().toLowerCase();
        const inputOtp = (body.otp_code || '').trim();

        const user = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(email);
        if (!user) {
          return sendJson(res, 404, {
            detail: 'Akun dengan alamat email tersebut tidak ditemukan.',
          });
        }
        if (user.is_active) {
          return sendJson(res, 200, {
            success: true,
            message: 'Akun Anda sudah aktif. Silakan masuk.',
          });
        }

        const otpRow = db
          .prepare(
            'SELECT * FROM otp_verifications WHERE email = ? AND is_used = 0 ORDER BY id DESC LIMIT 1'
          )
          .get(email);
        if (!otpRow) {
          return sendJson(res, 400, {
            detail: 'Tidak ada kode OTP aktif untuk email ini. Silakan minta kirim ulang OTP.',
          });
        }

        const nowTs = Math.floor(Date.now() / 1000);
        if (nowTs > otpRow.expires_at) {
          return sendJson(res, 400, {
            detail: 'Kode OTP telah kedaluwarsa. Silakan klik Kirim Ulang OTP.',
          });
        }

        if (inputOtp !== otpRow.otp_code) {
          return sendJson(res, 400, {
            detail: 'Kode OTP yang dimasukkan tidak sesuai.',
          });
        }

        db.prepare('UPDATE otp_verifications SET is_used = 1 WHERE id = ?').run(otpRow.id);
        db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(user.id);

        return sendJson(res, 200, {
          success: true,
          message: 'Akun berhasil diaktifkan! Silakan login menggunakan akun Anda.',
        });
      }

      if (pathname === '/api/auth/resend-otp') {
        const email = (body.email || '').trim().toLowerCase();
        const user = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(email);
        if (!user) {
          return sendJson(res, 404, {
            detail: 'Akun dengan alamat email tersebut belum terdaftar.',
          });
        }
        if (user.is_active) {
          return sendJson(res, 400, {
            detail: 'Akun ini sudah aktif, tidak memerlukan kode OTP lagi.',
          });
        }

        const otpCode = generateOtp(6);
        const expiresAt = Math.floor(Date.now() / 1000) + 300;
        db.prepare(
          'INSERT INTO otp_verifications (email, otp_code, expires_at, is_used) VALUES (?, ?, ?, 0)'
        ).run(email, otpCode, expiresAt);

        const mailResult = await dispatchOtpEmail({
          toEmail: email,
          fullName: user.full_name,
          otpCode,
        });

        const responsePayload = {
          success: true,
          email_sent: mailResult.realEmailSent,
          message: mailResult.realEmailSent
            ? `Kode OTP baru telah dikirim ke kotak masuk ${email}.`
            : `Kode OTP baru telah dibuat untuk ${email}.`,
        };

        if (!mailResult.realEmailSent) {
          responsePayload.otp_preview = otpCode;
        }

        return sendJson(res, 200, responsePayload);
      }

      if (pathname === '/api/auth/login') {
        const identifier = (body.identifier || '').trim();
        const password = body.password || '';

        const user = db
          .prepare(
            'SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?) OR lower(full_name) = lower(?) LIMIT 1'
          )
          .get(identifier, identifier, identifier);

        if (!user) {
          return sendJson(res, 401, {
            detail: 'Username/email atau password tidak sesuai.',
          });
        }

        const computedHash = hashPassword(password, user.password_salt);
        if (computedHash !== user.password_hash) {
          return sendJson(res, 401, {
            detail: 'Username/email atau password tidak sesuai.',
          });
        }

        if (!user.is_active) {
          return sendJson(res, 403, {
            detail:
              'Akun Anda belum diaktifkan. Silakan verifikasi kode OTP yang dikirim ke email Anda.',
          });
        }

        const userRole =
          user.email.toLowerCase() === 'yumenoboken@gmail.com'
            ? 'admin'
            : user.role || 'guru';

        return sendJson(res, 200, {
          success: true,
          message: 'Login berhasil!',
          access_token: createJwtToken(user),
          user: {
            id: user.id,
            full_name: user.full_name,
            username: user.username,
            email: user.email,
            role: userRole,
          },
        });
      }
    } catch (err) {
      return sendJson(res, 500, { detail: `Gagal mengirim email OTP: ${err.message}` });
    }
  }

  // Endpoint Data Halaman Utama (Rekap & Hari Libur + Data Siswa & Guru Terdaftar)
  if (pathname === '/api/attendance/overview' && req.method === 'GET') {
    const rows = db.prepare('SELECT holiday_date, is_holiday FROM custom_holidays').all();
    const customHolidays = {};
    for (const r of rows) {
      customHolidays[r.holiday_date] = Boolean(r.is_holiday);
    }

    const studentRows = db
      .prepare('SELECT id, full_name, class_name, birth_date FROM students ORDER BY id ASC')
      .all();
    const students = studentRows.map((s) => ({
      id: s.id,
      name: s.full_name,
      class_name: s.class_name,
      birth_date: s.birth_date,
    }));

    const allActiveUsers = db
      .prepare(
        'SELECT id, full_name, email, username, role, is_hidden, is_active FROM users ORDER BY id ASC'
      )
      .all();
    const allTeachers = allActiveUsers.map((u) => ({
      id: u.id,
      name: u.full_name || u.username,
      email: u.email,
      username: u.username,
      role: u.email && u.email.toLowerCase() === 'yumenoboken@gmail.com' ? 'admin' : u.role || 'guru',
      is_hidden: Boolean(u.is_hidden),
      is_active: Boolean(u.is_active),
    }));
    const visibleTeachers = allTeachers.filter((t) => !t.is_hidden);

    const studentAttendanceRows = db
      .prepare('SELECT student_id, attendance_date, status FROM student_attendance')
      .all();
    const studentRecords = {};
    for (const row of studentAttendanceRows) {
      const code =
        row.status === 'Hadir'
          ? 'H'
          : row.status === 'Izin'
          ? 'I'
          : row.status === 'Sakit'
          ? 'S'
          : 'A';
      studentRecords[`${row.student_id}_${row.attendance_date}`] = code;
    }

    const approvedRows = db
      .prepare(
        "SELECT user_id, teacher_email, attendance_date, status FROM teacher_attendance WHERE approval_status != 'Rejected'"
      )
      .all();
    const teacherRecords = {};
    for (const row of approvedRows) {
      const code = row.status === 'Hadir' ? 'H' : row.status === 'Izin' ? 'I' : 'S';
      teacherRecords[`${row.user_id}_${row.attendance_date}`] = code;
      if (row.teacher_email) {
        teacherRecords[`${row.teacher_email.toLowerCase()}_${row.attendance_date}`] = code;
      }
    }

    return sendJson(res, 200, {
      success: true,
      custom_holidays: customHolidays,
      students: students,
      teachers: visibleTeachers,
      all_teachers: allTeachers,
      student_records: studentRecords,
      teacher_records: teacherRecords,
    });
  }

  // Endpoint Admin untuk menyembunyikan / menampilkan nama user di tabel Data Guru Dashboard
  if (pathname === '/api/teachers/toggle-hide' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const adminEmail = (body.admin_email || '').trim().toLowerCase();
      const targetUserId = Number(body.target_user_id);
      const isHidden = body.is_hidden ? 1 : 0;

      const adminUser = db
        .prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1')
        .get(adminEmail);
      const isAdmin =
        adminEmail === 'yumenoboken@gmail.com' ||
        (adminUser && adminUser.role === 'admin');

      if (!isAdmin) {
        return sendJson(res, 403, {
          detail: 'Hanya Admin yang dapat menyembunyikan/menampilkan nama user.',
        });
      }

      db.prepare('UPDATE users SET is_hidden = ? WHERE id = ?').run(isHidden, targetUserId);
      return sendJson(res, 200, {
        success: true,
        target_user_id: targetUserId,
        is_hidden: Boolean(isHidden),
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  // Endpoint Admin untuk mengubah peran (Admin / Guru)
  if (pathname === '/api/teachers/set-role' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const adminEmail = (body.admin_email || '').trim().toLowerCase();
      const targetUserId = Number(body.target_user_id);
      const newRole = (body.role || '').trim().toLowerCase() === 'admin' ? 'admin' : 'guru';

      const adminUser = db
        .prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1')
        .get(adminEmail);
      const isAdmin =
        adminEmail === 'yumenoboken@gmail.com' ||
        (adminUser && adminUser.role === 'admin');

      if (!isAdmin) {
        return sendJson(res, 403, {
          detail: 'Hanya Admin yang dapat mengubah peran akun.',
        });
      }

      const target = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(targetUserId);
      if (!target) {
        return sendJson(res, 404, { detail: 'Akun pengguna tidak ditemukan.' });
      }

      if (target.email && target.email.toLowerCase() === 'yumenoboken@gmail.com') {
        return sendJson(res, 400, { detail: 'Peran akun Super Admin utama tidak dapat diubah.' });
      }

      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, targetUserId);
      return sendJson(res, 200, {
        success: true,
        message: `Peran akun ${target.full_name} berhasil diubah menjadi ${newRole === 'admin' ? 'Admin' : 'Guru'}.`,
        role: newRole,
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  // Endpoint Admin untuk menghapus akun guru
  if (pathname === '/api/teachers/delete' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const adminEmail = (body.admin_email || '').trim().toLowerCase();
      const targetUserId = Number(body.target_user_id);

      const adminUser = db
        .prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1')
        .get(adminEmail);
      const isAdmin =
        adminEmail === 'yumenoboken@gmail.com' ||
        (adminUser && adminUser.role === 'admin');

      if (!isAdmin) {
        return sendJson(res, 403, {
          detail: 'Hanya Admin yang dapat menghapus akun pengguna.',
        });
      }

      const target = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(targetUserId);
      if (!target) {
        return sendJson(res, 404, { detail: 'Akun pengguna tidak ditemukan.' });
      }

      if (target.email && target.email.toLowerCase() === 'yumenoboken@gmail.com') {
        return sendJson(res, 400, { detail: 'Akun Super Admin utama tidak dapat dihapus.' });
      }

      // Hapus riwayat absensi dan akun pengguna
      db.prepare('DELETE FROM teacher_attendance WHERE user_id = ?').run(targetUserId);
      db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);

      return sendJson(res, 200, {
        success: true,
        message: `Akun ${target.full_name} dan seluruh riwayat presensinya berhasil dihapus.`,
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  // Endpoint Sinkronisasi Akun Guru Terdaftar
  if (pathname === '/api/teachers/sync' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const incomingTeachers = Array.isArray(body.teachers) ? body.teachers : [];
      for (const t of incomingTeachers) {
        const email = (t.email || '').trim().toLowerCase();
        const fullName = (t.name || t.full_name || t.username || '').trim();
        const username = (t.username || email.split('@')[0] || 'guru').trim();
        const role = email === 'yumenoboken@gmail.com' ? 'admin' : t.role || 'guru';
        if (!email || !fullName) continue;

        const exists = db
          .prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1')
          .get(email);
        if (!exists) {
          const salt = crypto.randomBytes(16).toString('hex');
          const pwHash = hashPassword('PiaDefault2026!', salt);
          db.prepare(
            'INSERT INTO users (full_name, email, username, password_hash, password_salt, is_active, role, is_hidden) VALUES (?, ?, ?, ?, ?, 1, ?, 0)'
          ).run(fullName, email, username, pwHash, salt, role);
        }
      }

      const allUsers = db
        .prepare(
          'SELECT id, full_name, email, username, role, is_hidden, is_active FROM users ORDER BY id ASC'
        )
        .all();
      const teachers = allUsers.map((u) => ({
        id: u.id,
        name: u.full_name || u.username,
        email: u.email,
        username: u.username,
        role: u.email && u.email.toLowerCase() === 'yumenoboken@gmail.com' ? 'admin' : u.role || 'guru',
        is_hidden: Boolean(u.is_hidden),
        is_active: Boolean(u.is_active),
      }));

      return sendJson(res, 200, {
        success: true,
        teachers: teachers.filter((t) => !t.is_hidden),
        all_teachers: teachers,
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  // ==========================================================
  // ENDPOINT API HALAMAN PENDAFTARAN SISWA (/api/students)
  // ==========================================================
  if (pathname === '/api/students' && req.method === 'GET') {
    const rows = db
      .prepare(
        'SELECT id, full_name, class_name, birth_date, created_by, created_at FROM students ORDER BY id ASC'
      )
      .all();
    return sendJson(res, 200, {
      success: true,
      students: rows,
    });
  }

  if (pathname === '/api/students' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const fullName = (body.full_name || '').trim();
      const className = (body.class_name || '').trim();
      const birthDate = (body.birth_date || '').trim();
      const createdBy = (body.created_by || '').trim();

      if (!fullName || !className || !birthDate) {
        return sendJson(res, 400, {
          detail: 'Nama siswa, kelas, dan tanggal lahir wajib diisi.',
        });
      }

      const info = db
        .prepare(
          'INSERT INTO students (full_name, class_name, birth_date, created_by) VALUES (?, ?, ?, ?)'
        )
        .run(fullName, className, birthDate, createdBy);

      const studentId = Number(info.lastInsertRowid);
      const newStudent = db
        .prepare('SELECT * FROM students WHERE id = ?')
        .get(studentId);

      return sendJson(res, 201, {
        success: true,
        message: `Data siswa "${fullName}" berhasil ditambahkan ke Dashboard!`,
        student: newStudent,
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  if (pathname === '/api/students/delete' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const studentId = Number(body.student_id);
      const fullName = (body.full_name || body.name || '').trim();
      const birthDate = (body.birth_date || '').trim();

      if (!studentId && !fullName) {
        return sendJson(res, 400, { detail: 'ID atau nama siswa tidak valid.' });
      }

      if (studentId) {
        db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
        try {
          db.prepare('DELETE FROM student_attendance WHERE student_id = ?').run(studentId);
        } catch (_) {}
      }

      if (fullName) {
        if (birthDate) {
          db.prepare(
            'DELETE FROM students WHERE lower(full_name) = lower(?) AND birth_date = ?'
          ).run(fullName, birthDate);
        } else {
          db.prepare('DELETE FROM students WHERE lower(full_name) = lower(?)').run(fullName);
        }
      }

      const rows = db
        .prepare(
          'SELECT id, full_name, class_name, birth_date, created_by, created_at FROM students ORDER BY id ASC'
        )
        .all();

      return sendJson(res, 200, {
        success: true,
        message: 'Data siswa berhasil dihapus dari database.',
        students: rows,
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  if (pathname === '/api/students/sync' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const clientStudents = Array.isArray(body.students) ? body.students : [];
      for (const s of clientStudents) {
        const fullName = (s.full_name || s.name || '').trim();
        const className = (s.class_name || '').trim();
        const birthDate = (s.birth_date || '').trim();
        const createdBy = (s.created_by || 'Guru PIA').trim();
        if (!fullName || !className || !birthDate) continue;

        const exists = db
          .prepare(
            'SELECT id FROM students WHERE lower(full_name) = lower(?) AND birth_date = ? LIMIT 1'
          )
          .get(fullName, birthDate);

        if (!exists) {
          db.prepare(
            'INSERT INTO students (full_name, class_name, birth_date, created_by) VALUES (?, ?, ?, ?)'
          ).run(fullName, className, birthDate, createdBy);
        }
      }

      const rows = db
        .prepare(
          'SELECT id, full_name, class_name, birth_date, created_by, created_at FROM students ORDER BY id ASC'
        )
        .all();
      return sendJson(res, 200, {
        success: true,
        students: rows,
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  if (pathname === '/api/attendance/toggle-holiday' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const dateStr = (body.holiday_date || '').trim();
      const isHol = body.is_holiday ? 1 : 0;
      if (dateStr) {
        db.prepare(
          `INSERT INTO custom_holidays (holiday_date, is_holiday, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(holiday_date) DO UPDATE SET is_holiday = excluded.is_holiday, updated_at = datetime('now')`
        ).run(dateStr, isHol);
      }
      return sendJson(res, 200, { success: true, holiday_date: dateStr, is_holiday: Boolean(isHol) });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  // ==========================================================
  // ENDPOINT API HALAMAN 3: ABSENSI SISWA
  // ==========================================================
  if (pathname === '/api/student-attendance' && req.method === 'GET') {
    const dateParam =
      (parsedUrl.searchParams.get('date') || '').trim() ||
      new Date().toISOString().slice(0, 10);

    const students = db
      .prepare(
        'SELECT id, full_name, class_name, birth_date, created_by FROM students ORDER BY id ASC'
      )
      .all();

    const attendanceRows = db
      .prepare(
        'SELECT student_id, attendance_date, status, note, recorded_by FROM student_attendance WHERE attendance_date = ?'
      )
      .all(dateParam);

    const attendanceMap = {};
    for (const row of attendanceRows) {
      attendanceMap[row.student_id] = {
        status: row.status,
        note: row.note || '',
        recorded_by: row.recorded_by || '',
      };
    }

    return sendJson(res, 200, {
      success: true,
      date: dateParam,
      students: students,
      attendance: attendanceMap,
    });
  }

  if (pathname === '/api/student-attendance/batch-save' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const dateStr =
        (body.attendance_date || '').trim() || new Date().toISOString().slice(0, 10);
      const records = Array.isArray(body.records) ? body.records : [];
      const recordedBy = (body.recorded_by || 'Guru PIA').trim();

      const insertStmt = db.prepare(`
        INSERT INTO student_attendance (student_id, attendance_date, status, note, recorded_by, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(student_id, attendance_date) DO UPDATE SET
          status = excluded.status,
          note = excluded.note,
          recorded_by = excluded.recorded_by,
          created_at = datetime('now')
      `);

      for (const rec of records) {
        const studentId = Number(rec.student_id);
        const status = (rec.status || 'Hadir').trim();
        const note = (rec.note || '').trim();
        if (!studentId || !['Hadir', 'Izin', 'Sakit', 'Alfa'].includes(status)) continue;
        insertStmt.run(studentId, dateStr, status, note, recordedBy);
      }

      return sendJson(res, 200, {
        success: true,
        message: `Presensi siswa untuk tanggal ${dateStr} berhasil disimpan dan tersinkron ke Dashboard!`,
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  // ==========================================================
  // ENDPOINT API HALAMAN 2: ABSENSI GURU & PANEL ACC ADMIN
  // ==========================================================
  if (pathname === '/api/teacher-attendance/data' && req.method === 'GET') {
    const emailParam = (parsedUrl.searchParams.get('email') || '').trim().toLowerCase();
    const dateParam =
      parsedUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);

    const currentUser = emailParam
      ? db.prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1').get(emailParam)
      : null;

    const isAdmin =
      emailParam === 'yumenoboken@gmail.com' ||
      (currentUser && currentUser.role === 'admin');

    const userId = currentUser ? currentUser.id : 0;
    const todayRecord = userId
      ? db
          .prepare(
            'SELECT * FROM teacher_attendance WHERE user_id = ? AND attendance_date = ? LIMIT 1'
          )
          .get(userId, dateParam)
      : null;

    const myHistory = userId
      ? db
          .prepare(
            'SELECT * FROM teacher_attendance WHERE user_id = ? ORDER BY attendance_date DESC, id DESC LIMIT 30'
          )
          .all(userId)
      : [];

    const allSubmissions = isAdmin
      ? db
          .prepare(
            'SELECT * FROM teacher_attendance ORDER BY CASE WHEN approval_status = \'Pending\' THEN 0 ELSE 1 END, attendance_date DESC, id DESC LIMIT 50'
          )
          .all()
      : [];

    const registeredUsers = isAdmin
      ? db
          .prepare(
            'SELECT id, full_name, username, email, role, created_at FROM users WHERE is_active = 1 ORDER BY id ASC'
          )
          .all()
      : [];

    return sendJson(res, 200, {
      success: true,
      is_admin: Boolean(isAdmin),
      current_user: currentUser
        ? {
            id: currentUser.id,
            full_name: currentUser.full_name,
            email: currentUser.email,
            username: currentUser.username,
            role: isAdmin ? 'admin' : 'guru',
          }
        : null,
      today_record: todayRecord || null,
      my_history: myHistory,
      all_submissions: allSubmissions,
      registered_users: registeredUsers,
    });
  }

  if (pathname === '/api/teacher-attendance/submit' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const status = (body.status || '').trim();
      const note = (body.note || '').trim();
      const dateStr =
        (body.attendance_date || '').trim() || new Date().toISOString().slice(0, 10);

      if (!['Hadir', 'Izin', 'Sakit'].includes(status)) {
        return sendJson(res, 400, { detail: 'Pilih status kehadiran (Hadir / Izin / Sakit).' });
      }

      if (['Izin', 'Sakit'].includes(status) && !note) {
        return sendJson(res, 400, { detail: `Keterangan wajib diisi ketika memilih status ${status}.` });
      }

      let user = db.prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1').get(email);
      if (!user) {
        const fullName = (body.name || email.split('@')[0] || 'Guru PIA').trim();
        const username = email.split('@')[0] || 'guru';
        const role = email === 'yumenoboken@gmail.com' ? 'admin' : 'guru';
        const info = db.prepare(
          'INSERT INTO users (full_name, email, username, password_hash, password_salt, is_active, role) VALUES (?, ?, ?, ?, ?, 1, ?)'
        ).run(fullName, email, username, 'auto_hash', 'auto_salt', role);
        user = { id: Number(info.lastInsertRowid), full_name: fullName, email: email, role: role };
      }

      const existing = db
        .prepare(
          'SELECT * FROM teacher_attendance WHERE user_id = ? AND attendance_date = ? LIMIT 1'
        )
        .get(user.id, dateStr);

      if (existing) {
        db.prepare(
          `UPDATE teacher_attendance
           SET status = ?, note = ?, approval_status = 'Approved', approved_by = 'Sistem Otomatis'
           WHERE id = ?`
        ).run(status, note, existing.id);

        return sendJson(res, 200, {
          success: true,
          message: 'Presensi berhasil diperbarui dan tersinkron ke Dashboard!',
        });
      }

      db.prepare(
        `INSERT INTO teacher_attendance
         (user_id, teacher_name, teacher_email, attendance_date, status, note, approval_status, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, 'Approved', 'Sistem Otomatis')`
      ).run(user.id, user.full_name, user.email, dateStr, status, note);

      return sendJson(res, 201, {
        success: true,
        message: 'Presensi kehadiran berhasil dikirim dan tersinkron ke Dashboard!',
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  if (pathname === '/api/teacher-attendance/approve' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const adminEmail = (body.admin_email || '').trim().toLowerCase();
      const attendanceId = Number(body.attendance_id);
      const decision = body.decision === 'Rejected' ? 'Rejected' : 'Approved';

      const adminUser = db
        .prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1')
        .get(adminEmail);
      const isAdmin =
        adminEmail === 'yumenoboken@gmail.com' ||
        (adminUser && adminUser.role === 'admin');

      if (!isAdmin) {
        return sendJson(res, 403, { detail: 'Hanya Admin yang dapat melakukan ACC absensi guru.' });
      }

      const adminName = adminUser ? adminUser.full_name : 'Admin';
      db.prepare(
        'UPDATE teacher_attendance SET approval_status = ?, approved_by = ? WHERE id = ?'
      ).run(decision, adminName, attendanceId);

      return sendJson(res, 200, {
        success: true,
        message:
          decision === 'Approved'
            ? 'Absensi guru berhasil di-ACC dan telah masuk ke Rekap Dashboard!'
            : 'Pengajuan absensi guru telah ditolak.',
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  if (pathname === '/api/teacher-attendance/set-role' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const adminEmail = (body.admin_email || '').trim().toLowerCase();
      const targetUserId = Number(body.target_user_id);
      const newRole = body.role === 'admin' ? 'admin' : 'guru';

      const adminUser = db
        .prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1')
        .get(adminEmail);
      const isAdmin =
        adminEmail === 'yumenoboken@gmail.com' ||
        (adminUser && adminUser.role === 'admin');

      if (!isAdmin) {
        return sendJson(res, 403, { detail: 'Hanya Admin yang dapat mengubah role pengguna.' });
      }

      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, targetUserId);
      return sendJson(res, 200, {
        success: true,
        message: `Role akun berhasil diubah menjadi ${newRole.toUpperCase()}.`,
      });
    } catch (err) {
      return sendJson(res, 500, { detail: err.message });
    }
  }

  if (pathname === '/' || pathname === '/login') {
    pathname = '/index.html';
  } else if (pathname === '/register') {
    pathname = '/register.html';
  } else if (pathname === '/verify-otp') {
    pathname = '/verify-otp.html';
  } else if (pathname === '/dashboard') {
    pathname = '/dashboard.html';
  } else if (pathname === '/pendaftaran') {
    pathname = '/pendaftaran.html';
  } else if (pathname === '/absensi-guru') {
    pathname = '/absensi-guru.html';
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 - Halaman Tidak Ditemukan</h1><p><a href="/">Kembali ke Login</a></p>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Server Error: ${err.code}`);
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n======================================================');
  console.log('  🚀 Absensi PIA - Fullstack Dev Server (UI + SQL + SMTP)');
  console.log('======================================================');
  console.log(`  ➜ Akses Lokal        : http://localhost:${PORT}/`);
  console.log(`  ➜ Akses Jaringan/LAN : http://0.0.0.0:${PORT}/`);
  console.log(`  ➜ Halaman Registrasi : http://localhost:${PORT}/register.html`);
  console.log(`  ➜ Halaman OTP Email  : http://localhost:${PORT}/verify-otp.html`);
  console.log(`  ➜ Konfigurasi SMTP   : ${ENV_PATH}`);
  console.log('======================================================\n');
});
