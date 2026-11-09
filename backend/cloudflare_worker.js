/**
 * Cloudflare Worker & D1 SQL Gateway - Sistem Absensi PIA
 * Endpoint: https://absensi-pia.yumenoboken.workers.dev/
 */

const memoryStore = {
  users: [
    {
      id: 1,
      full_name: 'Yuken',
      email: 'yumenoboken@gmail.com',
      username: 'Yuken',
      password_hash: 'd60a21f8dad3657f52d52c97d4ea9e5af62cb0df49ecb59e5d3d1010dd3dd126',
      password_salt: '6b5c963375d89fa95bd982a8250df01d',
      role: 'admin',
      is_hidden: 0,
      is_active: 1,
    },
  ],
  otps: [],
  students: [],
  customHolidays: {},
  nextUserId: 2,
  nextStudentId: 1,
};

async function sha256Hex(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  let current = `${salt}:${password}:PIA_CORE_V1`;
  // Key-stretching SHA-256 (1000 putaran identik dengan C++ Core & SQLite Lokal)
  for (let i = 0; i < 1000; i++) {
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

async function sendRealEmailFromWorker(env, { toEmail, fullName, otpCode }) {
  const subject = `[${otpCode}] Kode Aktivasi Akun Sistem Absensi PIA`;
  const htmlBody = buildOtpHtmlEmail(fullName, otpCode);

  if (env.EMAIL_RELAY_URL) {
    const resp = await fetch(env.EMAIL_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toEmail, subject, htmlBody }),
    });
    if (!resp.ok) {
      throw new Error(`Email Relay gagal (${resp.status})`);
    }
    return true;
  }
  return false;
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
        role TEXT NOT NULL DEFAULT 'guru',
        is_hidden INTEGER NOT NULL DEFAULT 0,
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

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        birth_date TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS custom_holidays (
        holiday_date TEXT PRIMARY KEY,
        is_holiday INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

          const emailSent = await sendRealEmailFromWorker(env, {
            toEmail: email,
            fullName,
            otpCode,
          });

          const responsePayload = {
            success: true,
            email_sent: emailSent,
            message: emailSent
              ? `Kode OTP 6 digit telah dikirimkan ke kotak masuk ${email}.`
              : `Registrasi berhasil! Kode OTP telah dibuat untuk ${email}.`,
          };
          if (!emailSent) {
            responsePayload.otp_preview = otpCode;
          }
          return jsonResponse(responsePayload, 201);
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

    // ENDPOINT DATA SISWA (PENDAFTARAN & SINKRONISASI DATABASE D1)
    if (pathname.startsWith('/api/students') || pathname.startsWith('/api/attendance') || pathname.startsWith('/api/teachers')) {
      try {
        const db = env.DB || null;
        if (db) {
          await ensureD1Schema(db);
        }

        if (pathname === '/api/students' && request.method === 'GET') {
          if (db) {
            const { results } = await db
              .prepare('SELECT id, full_name, class_name, birth_date, created_by, created_at FROM students ORDER BY id ASC')
              .all();
            return jsonResponse({ success: true, students: results || [] });
          }
          return jsonResponse({ success: true, students: memoryStore.students });
        }

        if (pathname === '/api/students' && request.method === 'POST') {
          const body = await request.json();
          const fullName = (body.full_name || '').trim();
          const className = (body.class_name || '').trim();
          const birthDate = (body.birth_date || '').trim();
          const createdBy = (body.created_by || 'Guru PIA').trim();

          if (!fullName || !className || !birthDate) {
            return jsonResponse({ detail: 'Nama siswa, kelas, dan tanggal lahir wajib diisi.' }, 400);
          }

          if (db) {
            await db
              .prepare('INSERT INTO students (full_name, class_name, birth_date, created_by) VALUES (?, ?, ?, ?)')
              .bind(fullName, className, birthDate, createdBy)
              .run();
            const newRow = await db
              .prepare('SELECT * FROM students ORDER BY id DESC LIMIT 1')
              .first();
            return jsonResponse({
              success: true,
              message: `Data siswa "${fullName}" berhasil disimpan ke Database!`,
              student: newRow,
            }, 201);
          }

          const newStudent = {
            id: memoryStore.nextStudentId++,
            full_name: fullName,
            class_name: className,
            birth_date: birthDate,
            created_by: createdBy,
            created_at: new Date().toISOString(),
          };
          memoryStore.students.push(newStudent);
          return jsonResponse({
            success: true,
            message: `Data siswa "${fullName}" berhasil disimpan!`,
            student: newStudent,
          }, 201);
        }

        if (pathname === '/api/students/delete' && request.method === 'POST') {
          const body = await request.json();
          const studentId = Number(body.student_id);
          if (db) {
            await db.prepare('DELETE FROM students WHERE id = ?').bind(studentId).run();
          } else {
            memoryStore.students = memoryStore.students.filter((s) => Number(s.id) !== studentId);
          }
          return jsonResponse({ success: true, message: 'Data siswa berhasil dihapus.' });
        }

        if (pathname === '/api/students/sync' && request.method === 'POST') {
          const body = await request.json();
          const clientStudents = Array.isArray(body.students) ? body.students : [];
          if (db) {
            for (const s of clientStudents) {
              const fullName = (s.full_name || s.name || '').trim();
              const className = (s.class_name || '').trim();
              const birthDate = (s.birth_date || '').trim();
              const createdBy = (s.created_by || 'Guru PIA').trim();
              if (!fullName || !className || !birthDate) continue;
              const existing = await db
                .prepare('SELECT id FROM students WHERE lower(full_name) = lower(?) AND birth_date = ? LIMIT 1')
                .bind(fullName, birthDate)
                .first();
              if (!existing) {
                await db
                  .prepare('INSERT INTO students (full_name, class_name, birth_date, created_by) VALUES (?, ?, ?, ?)')
                  .bind(fullName, className, birthDate, createdBy)
                  .run();
              }
            }
            const { results } = await db
              .prepare('SELECT id, full_name, class_name, birth_date, created_by, created_at FROM students ORDER BY id ASC')
              .all();
            return jsonResponse({ success: true, students: results || [] });
          }
          return jsonResponse({ success: true, students: memoryStore.students });
        }

        if (pathname === '/api/attendance/overview' && request.method === 'GET') {
          if (db) {
            const { results: stuRows } = await db
              .prepare('SELECT id, full_name, class_name, birth_date FROM students ORDER BY id ASC')
              .all();
            const { results: usrRows } = await db
              .prepare('SELECT id, full_name, email, username, role, is_hidden FROM users WHERE is_active = 1 ORDER BY id ASC')
              .all();
            const allTeachers = (usrRows || []).map((u) => ({
              id: u.id,
              name: u.full_name,
              email: u.email,
              username: u.username,
              role: u.email.toLowerCase() === 'yumenoboken@gmail.com' ? 'admin' : u.role || 'guru',
              is_hidden: Boolean(u.is_hidden),
            }));
            return jsonResponse({
              success: true,
              students: (stuRows || []).map((s) => ({
                id: s.id,
                name: s.full_name,
                class_name: s.class_name,
                birth_date: s.birth_date,
              })),
              teachers: allTeachers.filter((t) => !t.is_hidden),
              all_teachers: allTeachers,
              custom_holidays: {},
              student_records: {},
              teacher_records: {},
            });
          }

          const allTeachers = memoryStore.users
            .filter((u) => u.is_active)
            .map((u) => ({
              id: u.id,
              name: u.full_name,
              email: u.email,
              username: u.username,
              role: u.role || 'guru',
              is_hidden: Boolean(u.is_hidden),
            }));

          return jsonResponse({
            success: true,
            students: memoryStore.students.map((s) => ({
              id: s.id,
              name: s.full_name,
              class_name: s.class_name,
              birth_date: s.birth_date,
            })),
            teachers: allTeachers.filter((t) => !t.is_hidden),
            all_teachers: allTeachers,
            custom_holidays: memoryStore.customHolidays,
            student_records: {},
            teacher_records: {},
          });
        }
      } catch (err) {
        return jsonResponse({ detail: `Worker DB Error: ${err.message}` }, 500);
      }
    }

    // Sajikan aset statis UI Web (frontend/web)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Sistem Absensi PIA Worker Aktif', { status: 200 });
  },
};

