/**
 * Cloudflare Worker & D1 SQL Gateway - Sistem Absensi PIA
 * Endpoint: https://absensi-pia.yumenoboken.workers.dev/
 */

const memoryStore = {
  users: [],
  otps: [],
  nextUserId: 1,
};

async function sha256Hex(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  let current = `${salt}:${password}:PIA_CORE_V1`;
  // Key-stretching SHA-256
  for (let i = 0; i < 100; i++) {
    const digest = await sha256Hex(current);
    current = `${digest}:${salt}`;
  }
  return await sha256Hex(current);
}

function generateOtp(length = 6) {
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (n) => (n % 10).toString()).join('');
}

function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

async function ensureD1Schema(db) {
  if (!db) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS otp_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        is_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return jsonResponse({ ok: true }, 200);
    }

    if (pathname === '/api/health') {
      return jsonResponse({
        status: 'ok',
        service: 'Sistem Absensi PIA - Cloudflare Worker',
        d1_bound: Boolean(env.DB),
      });
    }

    if (pathname.startsWith('/api/auth/') && request.method === 'POST') {
      try {
        const body = await request.json();
        const db = env.DB || null;
        if (db) {
          await ensureD1Schema(db);
        }

        // 1. REGISTER
        if (pathname === '/api/auth/register') {
          const fullName = (body.full_name || '').trim();
          const email = (body.email || '').trim().toLowerCase();
          const username = (body.username || '').trim();
          const password = body.password || '';

          if (username.length < 4 || username.includes(' ')) {
            return jsonResponse(
              { detail: 'Username minimal 4 karakter dan tidak boleh mengandung spasi.' },
              400
            );
          }
          if (!email.includes('@') || !email.split('@')[1]?.includes('.')) {
            return jsonResponse({ detail: 'Format alamat email tidak valid.' }, 400);
          }
          if (password.length < 8) {
            return jsonResponse(
              { detail: 'Password harus terdiri dari minimal 8 karakter.' },
              400
            );
          }

          const salt = generateSalt();
          const pwHash = await hashPassword(password, salt);
          const otpCode = generateOtp(6);
          const expiresAt = Math.floor(Date.now() / 1000) + 300;

          if (db) {
            const existingEmail = await db
              .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
              .bind(email)
              .first();

            if (existingEmail && existingEmail.is_active) {
              return jsonResponse(
                { detail: 'Alamat email sudah terdaftar dan aktif. Silakan langsung login.' },
                400
              );
            }

            const existingUser = await db
              .prepare('SELECT * FROM users WHERE username = ? LIMIT 1')
              .bind(username)
              .first();

            if (existingUser && (!existingEmail || existingUser.id !== existingEmail.id)) {
              return jsonResponse(
                { detail: 'Username sudah digunakan oleh pengguna lain.' },
                400
              );
            }

            if (existingEmail && !existingEmail.is_active) {
              await db
                .prepare(
                  'UPDATE users SET full_name = ?, username = ?, password_hash = ?, password_salt = ? WHERE id = ?'
                )
                .bind(fullName, username, pwHash, salt, existingEmail.id)
                .run();
            } else {
              await db
                .prepare(
                  'INSERT INTO users (full_name, email, username, password_hash, password_salt, is_active) VALUES (?, ?, ?, ?, ?, 0)'
                )
                .bind(fullName, email, username, pwHash, salt)
                .run();
            }

            await db
              .prepare(
                'INSERT INTO otp_verifications (email, otp_code, expires_at, is_used) VALUES (?, ?, ?, 0)'
              )
              .bind(email, otpCode, expiresAt)
              .run();
          } else {
            const existingEmail = memoryStore.users.find((u) => u.email === email);
            if (existingEmail && existingEmail.is_active) {
              return jsonResponse(
                { detail: 'Alamat email sudah terdaftar dan aktif. Silakan langsung login.' },
                400
              );
            }
            const existingUser = memoryStore.users.find((u) => u.username === username);
            if (existingUser && (!existingEmail || existingUser.id !== existingEmail.id)) {
              return jsonResponse(
                { detail: 'Username sudah digunakan oleh pengguna lain.' },
                400
              );
            }

            if (existingEmail) {
              existingEmail.full_name = fullName;
              existingEmail.username = username;
              existingEmail.password_hash = pwHash;
              existingEmail.password_salt = salt;
            } else {
              memoryStore.users.push({
                id: memoryStore.nextUserId++,
                full_name: fullName,
                email,
                username,
                password_hash: pwHash,
                password_salt: salt,
                is_active: 0,
              });
            }
            memoryStore.otps.push({
              id: memoryStore.otps.length + 1,
              email,
              otp_code: otpCode,
              expires_at: expiresAt,
              is_used: 0,
            });
          }

          return jsonResponse(
            {
              success: true,
              message: `Registrasi berhasil! Kode OTP telah dikirim ke ${email}.`,
              otp_preview: otpCode,
            },
            201
          );
        }

        // 2. VERIFY OTP
        if (pathname === '/api/auth/verify-otp') {
          const email = (body.email || '').trim().toLowerCase();
          const inputOtp = (body.otp_code || '').trim();
          const nowTs = Math.floor(Date.now() / 1000);

          if (db) {
            const user = await db
              .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
              .bind(email)
              .first();
            if (!user) {
              return jsonResponse(
                { detail: 'Akun dengan alamat email tersebut tidak ditemukan.' },
                404
              );
            }
            if (user.is_active) {
              return jsonResponse({
                success: true,
                message: 'Akun Anda sudah aktif. Silakan masuk.',
              });
            }

            const otpRow = await db
              .prepare(
                'SELECT * FROM otp_verifications WHERE email = ? AND is_used = 0 ORDER BY id DESC LIMIT 1'
              )
              .bind(email)
              .first();

            if (!otpRow) {
              return jsonResponse(
                { detail: 'Tidak ada kode OTP aktif untuk email ini.' },
                400
              );
            }
            if (nowTs > otpRow.expires_at) {
              return jsonResponse(
                { detail: 'Kode OTP telah kedaluwarsa. Silakan klik Kirim Ulang OTP.' },
                400
              );
            }
            if (inputOtp !== otpRow.otp_code) {
              return jsonResponse({ detail: 'Kode OTP yang dimasukkan tidak sesuai.' }, 400);
            }

            await db
              .prepare('UPDATE otp_verifications SET is_used = 1 WHERE id = ?')
              .bind(otpRow.id)
              .run();
            await db
              .prepare('UPDATE users SET is_active = 1 WHERE id = ?')
              .bind(user.id)
              .run();
          } else {
            const user = memoryStore.users.find((u) => u.email === email);
            if (!user) {
              return jsonResponse(
                { detail: 'Akun dengan alamat email tersebut tidak ditemukan.' },
                404
              );
            }
            const otpList = memoryStore.otps.filter((o) => o.email === email && !o.is_used);
            const otpRow = otpList[otpList.length - 1];
            if (!otpRow) {
              return jsonResponse(
                { detail: 'Tidak ada kode OTP aktif untuk email ini.' },
                400
              );
            }
            if (nowTs > otpRow.expires_at) {
              return jsonResponse({ detail: 'Kode OTP telah kedaluwarsa.' }, 400);
            }
            if (inputOtp !== otpRow.otp_code) {
              return jsonResponse({ detail: 'Kode OTP yang dimasukkan tidak sesuai.' }, 400);
            }
            otpRow.is_used = 1;
            user.is_active = 1;
          }

          return jsonResponse({
            success: true,
            message: 'Akun berhasil diaktifkan! Silakan login menggunakan akun Anda.',
          });
        }

        // 3. RESEND OTP
        if (pathname === '/api/auth/resend-otp') {
          const email = (body.email || '').trim().toLowerCase();
          const otpCode = generateOtp(6);
          const expiresAt = Math.floor(Date.now() / 1000) + 300;

          if (db) {
            const user = await db
              .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
              .bind(email)
              .first();
            if (!user) {
              return jsonResponse(
                { detail: 'Akun dengan alamat email tersebut belum terdaftar.' },
                404
              );
            }
            await db
              .prepare(
                'INSERT INTO otp_verifications (email, otp_code, expires_at, is_used) VALUES (?, ?, ?, 0)'
              )
              .bind(email, otpCode, expiresAt)
              .run();
          } else {
            const user = memoryStore.users.find((u) => u.email === email);
            if (!user) {
              return jsonResponse(
                { detail: 'Akun dengan alamat email tersebut belum terdaftar.' },
                404
              );
            }
            memoryStore.otps.push({
              id: memoryStore.otps.length + 1,
              email,
              otp_code: otpCode,
              expires_at: expiresAt,
              is_used: 0,
            });
          }

          return jsonResponse({
            success: true,
            message: `Kode OTP baru telah dikirimkan ke ${email}.`,
            otp_preview: otpCode,
          });
        }

        // 4. LOGIN
        if (pathname === '/api/auth/login') {
          const identifier = (body.identifier || '').trim();
          const password = body.password || '';

          let user = null;
          if (db) {
            user = await db
              .prepare('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1')
              .bind(identifier, identifier.toLowerCase())
              .first();
          } else {
            user = memoryStore.users.find(
              (u) => u.username === identifier || u.email === identifier.toLowerCase()
            );
          }

          if (!user) {
            return jsonResponse(
              { detail: 'Username/email atau password tidak sesuai.' },
              401
            );
          }

          const computedHash = await hashPassword(password, user.password_salt);
          if (computedHash !== user.password_hash) {
            return jsonResponse(
              { detail: 'Username/email atau password tidak sesuai.' },
              401
            );
          }

          if (!user.is_active) {
            return jsonResponse(
              {
                detail:
                  'Akun Anda belum diaktifkan. Silakan verifikasi kode OTP yang dikirim ke email Anda.',
              },
              403
            );
          }

          return jsonResponse({
            success: true,
            message: 'Login berhasil!',
            access_token: `pia_cf_token_${user.id}_${Date.now()}`,
            user: {
              id: user.id,
              full_name: user.full_name,
              username: user.username,
              email: user.email,
            },
          });
        }
      } catch (err) {
        return jsonResponse({ detail: `Worker Error: ${err.message}` }, 500);
      }
    }

    // Sajikan aset statis UI Web (frontend/web)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Sistem Absensi PIA Worker Aktif', { status: 200 });
  },
};
