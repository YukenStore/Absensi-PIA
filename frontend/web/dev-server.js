const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 5173;
const PUBLIC_DIR = __dirname;
const DB_PATH = path.resolve(__dirname, '../../backend/absensi_pia.db');

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
`);

// Algoritma Hashing 1000-Putaran SHA-256 (Identik dengan C++ Core pia_hash_password)
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
  });
  res.end(JSON.stringify(payload));
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
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // ==========================================================
  // ENDPOINT API AUTENTIKASI END-TO-END (/api/auth/*)
  // ==========================================================
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

        console.log('\n========================================================');
        console.log('  [OTP EMAIL SERVICE - SISTEM ABSENSI PIA]');
        console.log(`  Penerima : ${fullName} <${email}>`);
        console.log(`  KODE OTP : ${otpCode} (Berlaku 5 menit)`);
        console.log('========================================================\n');

        return sendJson(res, 201, {
          success: true,
          message: `Registrasi berhasil! Kode OTP telah dikirim ke ${email}.`,
          otp_preview: otpCode,
        });
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

        console.log('\n========================================================');
        console.log('  [RESEND OTP - SISTEM ABSENSI PIA]');
        console.log(`  Penerima : ${user.full_name} <${email}>`);
        console.log(`  KODE OTP : ${otpCode} (Berlaku 5 menit)`);
        console.log('========================================================\n');

        return sendJson(res, 200, {
          success: true,
          message: `Kode OTP baru telah dikirimkan ke ${email}.`,
          otp_preview: otpCode,
        });
      }

      if (pathname === '/api/auth/login') {
        const identifier = (body.identifier || '').trim();
        const password = body.password || '';

        const user = db
          .prepare('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1')
          .get(identifier, identifier.toLowerCase());

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

        return sendJson(res, 200, {
          success: true,
          message: 'Login berhasil!',
          access_token: createJwtToken(user),
          user: {
            id: user.id,
            full_name: user.full_name,
            username: user.username,
            email: user.email,
          },
        });
      }
    } catch (err) {
      return sendJson(res, 500, { detail: `Server error: ${err.message}` });
    }
  }

  // ==========================================================
  // PENYAJIAN FILE STATIS UI WEB
  // ==========================================================
  if (pathname === '/' || pathname === '/login') {
    pathname = '/index.html';
  } else if (pathname === '/register') {
    pathname = '/register.html';
  } else if (pathname === '/verify-otp') {
    pathname = '/verify-otp.html';
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

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n======================================================');
  console.log('  🚀 Absensi PIA - Fullstack Dev Server (UI + SQL API)');
  console.log('======================================================');
  console.log(`  ➜ Halaman Login      : http://localhost:${PORT}/`);
  console.log(`  ➜ Halaman Registrasi : http://localhost:${PORT}/register.html`);
  console.log(`  ➜ Halaman OTP Email  : http://localhost:${PORT}/verify-otp.html`);
  console.log(`  ➜ Database SQL       : ${DB_PATH}`);
  console.log('======================================================\n');
});
