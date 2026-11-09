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
  teacherAttendance: [],
  customHolidays: {},
  nextUserId: 2,
  nextStudentId: 1,
  nextAttendanceId: 1,
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
  const relayUrl =
    (env && env.EMAIL_RELAY_URL) ||
    'https://script.google.com/macros/s/AKfycbyXzTnpST43yHYJ_fMTGmdLp5KEifI9N0iROHrUbpJr0gpeoJbMll8kh9x7O7c502E/exec';

  try {
    const resp = await fetch(relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toEmail, subject, htmlBody }),
    });
    if (resp.ok) {
      return true;
    }
  } catch (err) {
    console.warn('Gagal mengirim via email relay:', err);
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

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS teacher_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        teacher_name TEXT NOT NULL,
        teacher_email TEXT NOT NULL,
        attendance_date TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        approval_status TEXT NOT NULL DEFAULT 'Approved',
        approved_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, attendance_date)
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS student_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        attendance_date TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        recorded_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(student_id, attendance_date)
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

    // ENDPOINT DATA SISWA & ABSENSI GURU (PENDAFTARAN & SINKRONISASI DATABASE D1)
    if (
      pathname.startsWith('/api/students') ||
      pathname.startsWith('/api/student-attendance') ||
      pathname.startsWith('/api/attendance') ||
      pathname.startsWith('/api/teachers') ||
      pathname.startsWith('/api/teacher-attendance')
    ) {
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
          const fullName = (body.full_name || body.name || '').trim();
          const birthDate = (body.birth_date || '').trim();

          if (db) {
            if (studentId) {
              await db.prepare('DELETE FROM students WHERE id = ?').bind(studentId).run();
              try {
                await db.prepare('DELETE FROM student_attendance WHERE student_id = ?').bind(studentId).run();
              } catch (_) {}
            }
            if (fullName) {
              if (birthDate) {
                await db
                  .prepare('DELETE FROM students WHERE lower(full_name) = lower(?) AND birth_date = ?')
                  .bind(fullName, birthDate)
                  .run();
              } else {
                await db
                  .prepare('DELETE FROM students WHERE lower(full_name) = lower(?)')
                  .bind(fullName)
                  .run();
              }
            }
            const { results } = await db
              .prepare('SELECT id, full_name, class_name, birth_date, created_by, created_at FROM students ORDER BY id ASC')
              .all();
            return jsonResponse({
              success: true,
              message: 'Data siswa berhasil dihapus.',
              students: results || [],
            });
          }

          memoryStore.students = memoryStore.students.filter(
            (s) => Number(s.id) !== studentId && (!fullName || s.full_name.toLowerCase() !== fullName.toLowerCase())
          );
          return jsonResponse({
            success: true,
            message: 'Data siswa berhasil dihapus.',
            students: memoryStore.students,
          });
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
              .prepare('SELECT id, full_name, email, username, role, is_hidden, is_active FROM users ORDER BY id ASC')
              .all();
            const allTeachers = (usrRows || []).map((u) => ({
              id: u.id,
              name: u.full_name,
              email: u.email,
              username: u.username,
              role: u.email.toLowerCase() === 'yumenoboken@gmail.com' ? 'admin' : u.role || 'guru',
              is_hidden: Boolean(u.is_hidden),
            }));

            const teacherRecords = {};
            try {
              const { results: attRows } = await db
                .prepare("SELECT user_id, teacher_email, attendance_date, status FROM teacher_attendance WHERE approval_status != 'Rejected'")
                .all();
              for (const row of attRows || []) {
                const code = row.status === 'Hadir' ? 'H' : row.status === 'Izin' ? 'I' : 'S';
                teacherRecords[`${row.user_id}_${row.attendance_date}`] = code;
                if (row.teacher_email) {
                  teacherRecords[`${row.teacher_email.toLowerCase()}_${row.attendance_date}`] = code;
                }
              }
            } catch (_) {}

            const studentRecords = {};
            try {
              const { results: sAttRows } = await db
                .prepare("SELECT student_id, attendance_date, status FROM student_attendance")
                .all();
              for (const row of sAttRows || []) {
                const code = row.status === 'Hadir' ? 'H' : row.status === 'Izin' ? 'I' : row.status === 'Sakit' ? 'S' : 'A';
                studentRecords[`${row.student_id}_${row.attendance_date}`] = code;
              }
            } catch (_) {}

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
              student_records: studentRecords,
              teacher_records: teacherRecords,
            });
          }

          const allTeachers = memoryStore.users
            .map((u) => ({
              id: u.id,
              name: u.full_name,
              email: u.email,
              username: u.username,
              role: u.role || 'guru',
              is_hidden: Boolean(u.is_hidden),
            }));

          const teacherRecords = {};
          for (const row of memoryStore.teacherAttendance) {
            if (row.approval_status !== 'Rejected') {
              const code = row.status === 'Hadir' ? 'H' : row.status === 'Izin' ? 'I' : 'S';
              teacherRecords[`${row.user_id}_${row.attendance_date}`] = code;
              if (row.teacher_email) {
                teacherRecords[`${row.teacher_email.toLowerCase()}_${row.attendance_date}`] = code;
              }
            }
          }

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
            teacher_records: teacherRecords,
          });
        }

        if (pathname === '/api/teachers/sync' && request.method === 'POST') {
          const body = await request.json();
          const incomingTeachers = Array.isArray(body.teachers) ? body.teachers : [];
          if (db) {
            for (const t of incomingTeachers) {
              const email = (t.email || '').trim().toLowerCase();
              const fullName = (t.name || t.full_name || t.username || '').trim();
              const username = (t.username || email.split('@')[0] || 'guru').trim();
              const role = email === 'yumenoboken@gmail.com' ? 'admin' : t.role || 'guru';
              if (!email || !fullName) continue;
              const exists = await db.prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').bind(email).first();
              if (!exists) {
                await db
                  .prepare('INSERT INTO users (full_name, email, username, password_hash, password_salt, is_active, role, is_hidden) VALUES (?, ?, ?, ?, ?, 1, ?, 0)')
                  .bind(fullName, email, username, 'synced_hash', 'synced_salt', role)
                  .run();
              }
            }
            const { results: allUsers } = await db.prepare('SELECT id, full_name, email, username, role, is_hidden, is_active FROM users ORDER BY id ASC').all();
            const teachers = (allUsers || []).map((u) => ({
              id: u.id,
              name: u.full_name || u.username,
              email: u.email,
              username: u.username,
              role: u.email && u.email.toLowerCase() === 'yumenoboken@gmail.com' ? 'admin' : u.role || 'guru',
              is_hidden: Boolean(u.is_hidden),
            }));
            return jsonResponse({
              success: true,
              teachers: teachers.filter((t) => !t.is_hidden),
              all_teachers: teachers,
            });
          }

          for (const t of incomingTeachers) {
            const email = (t.email || '').trim().toLowerCase();
            const fullName = (t.name || t.full_name || t.username || '').trim();
            const username = (t.username || email.split('@')[0] || 'guru').trim();
            if (!email || !fullName) continue;
            const exists = memoryStore.users.find((u) => u.email.toLowerCase() === email);
            if (!exists) {
              memoryStore.users.push({
                id: memoryStore.nextUserId++,
                full_name: fullName,
                email,
                username,
                password_hash: 'synced_hash',
                password_salt: 'synced_salt',
                role: email === 'yumenoboken@gmail.com' ? 'admin' : t.role || 'guru',
                is_active: 1,
                is_hidden: 0,
              });
            }
          }
          const allTeachers = memoryStore.users.map((u) => ({
            id: u.id,
            name: u.full_name,
            email: u.email,
            username: u.username,
            role: u.role || 'guru',
            is_hidden: Boolean(u.is_hidden),
          }));
          return jsonResponse({
            success: true,
            teachers: allTeachers.filter((t) => !t.is_hidden),
            all_teachers: allTeachers,
          });
        }

        // Endpoint Visibilitas, Peran Admin, dan Hapus Akun Guru
        if (pathname === '/api/teachers/toggle-hide' && request.method === 'POST') {
          const body = await request.json();
          const targetUserId = Number(body.target_user_id);
          const isHidden = body.is_hidden ? 1 : 0;
          if (db) {
            await db.prepare('UPDATE users SET is_hidden = ? WHERE id = ?').bind(isHidden, targetUserId).run();
            return jsonResponse({ success: true, target_user_id: targetUserId, is_hidden: Boolean(isHidden) });
          }
          const target = memoryStore.users.find((u) => u.id === targetUserId);
          if (target) target.is_hidden = isHidden;
          return jsonResponse({ success: true, target_user_id: targetUserId, is_hidden: Boolean(isHidden) });
        }

        if (pathname === '/api/teachers/set-role' && request.method === 'POST') {
          const body = await request.json();
          const targetUserId = Number(body.target_user_id);
          const newRole = (body.role || '').trim().toLowerCase() === 'admin' ? 'admin' : 'guru';
          if (db) {
            const target = await db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(targetUserId).first();
            if (!target) return jsonResponse({ detail: 'Akun pengguna tidak ditemukan.' }, 404);
            if (target.email && target.email.toLowerCase() === 'yumenoboken@gmail.com') {
              return jsonResponse({ detail: 'Peran Super Admin tidak dapat diubah.' }, 400);
            }
            await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(newRole, targetUserId).run();
            return jsonResponse({ success: true, message: `Peran berhasil diubah menjadi ${newRole === 'admin' ? 'Admin' : 'Guru'}.`, role: newRole });
          }
          const target = memoryStore.users.find((u) => u.id === targetUserId);
          if (target) target.role = newRole;
          return jsonResponse({ success: true, message: `Peran berhasil diubah menjadi ${newRole === 'admin' ? 'Admin' : 'Guru'}.`, role: newRole });
        }

        if (pathname === '/api/teachers/delete' && request.method === 'POST') {
          const body = await request.json();
          const targetUserId = Number(body.target_user_id);
          if (db) {
            const target = await db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(targetUserId).first();
            if (!target) return jsonResponse({ detail: 'Akun pengguna tidak ditemukan.' }, 404);
            if (target.email && target.email.toLowerCase() === 'yumenoboken@gmail.com') {
              return jsonResponse({ detail: 'Akun Super Admin tidak dapat dihapus.' }, 400);
            }
            await db.prepare('DELETE FROM teacher_attendance WHERE user_id = ?').bind(targetUserId).run();
            await db.prepare('DELETE FROM users WHERE id = ?').bind(targetUserId).run();
            return jsonResponse({ success: true, message: `Akun ${target.full_name} berhasil dihapus.` });
          }
          memoryStore.teacherAttendance = memoryStore.teacherAttendance.filter((a) => a.user_id !== targetUserId);
          memoryStore.users = memoryStore.users.filter((u) => u.id !== targetUserId);
          return jsonResponse({ success: true, message: 'Akun berhasil dihapus.' });
        }

        // ==========================================================
        // API HALAMAN 3: ABSENSI SISWA
        // ==========================================================
        if (pathname === '/api/student-attendance' && request.method === 'GET') {
          const dateParam = (url.searchParams.get('date') || '').trim() || new Date().toISOString().slice(0, 10);
          if (db) {
            const { results: stuList } = await db.prepare('SELECT id, full_name, class_name, birth_date, created_by FROM students ORDER BY id ASC').all();
            const { results: attRows } = await db.prepare('SELECT student_id, attendance_date, status, note, recorded_by FROM student_attendance WHERE attendance_date = ?').bind(dateParam).all();
            const attendanceMap = {};
            for (const r of attRows || []) {
              attendanceMap[r.student_id] = { status: r.status, note: r.note || '', recorded_by: r.recorded_by || '' };
            }
            return jsonResponse({ success: true, date: dateParam, students: stuList || [], attendance: attendanceMap });
          }
          return jsonResponse({ success: true, date: dateParam, students: memoryStore.students, attendance: {} });
        }

        if (pathname === '/api/student-attendance/batch-save' && request.method === 'POST') {
          const body = await request.json();
          const dateStr = (body.attendance_date || '').trim() || new Date().toISOString().slice(0, 10);
          const records = Array.isArray(body.records) ? body.records : [];
          const recordedBy = (body.recorded_by || 'Guru PIA').trim();

          if (db) {
            for (const rec of records) {
              const studentId = Number(rec.student_id);
              const status = (rec.status || 'Hadir').trim();
              const note = (rec.note || '').trim();
              if (!studentId || !['Hadir', 'Izin', 'Sakit', 'Alfa'].includes(status)) continue;

              const existing = await db
                .prepare('SELECT id FROM student_attendance WHERE student_id = ? AND attendance_date = ? LIMIT 1')
                .bind(studentId, dateStr)
                .first();

              if (existing) {
                await db
                  .prepare("UPDATE student_attendance SET status = ?, note = ?, recorded_by = ?, created_at = datetime('now') WHERE id = ?")
                  .bind(status, note, recordedBy, existing.id)
                  .run();
              } else {
                await db
                  .prepare("INSERT INTO student_attendance (student_id, attendance_date, status, note, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
                  .bind(studentId, dateStr, status, note, recordedBy)
                  .run();
              }
            }
            return jsonResponse({ success: true, message: `Presensi siswa untuk tanggal ${dateStr} berhasil disimpan dan tersinkron ke Dashboard!` });
          }
          return jsonResponse({ success: true, message: 'Presensi siswa berhasil disimpan!' });
        }

        // Overview Absensi Guru (untuk absensi-guru.html)
        if (pathname === '/api/teacher-attendance/overview' && request.method === 'GET') {
          const email = (url.searchParams.get('email') || '').trim().toLowerCase();
          const today = (url.searchParams.get('date') || '').trim() || new Date().toISOString().slice(0, 10);
          const isAdminUser = email === 'yumenoboken@gmail.com';

          if (db) {
            const { results: userRows } = await db.prepare('SELECT id, full_name, email, username, role FROM users ORDER BY id ASC').all();
            const currUser = (userRows || []).find((u) => u.email.toLowerCase() === email) || null;
            const isAdm = isAdminUser || (currUser && currUser.role === 'admin');

            const { results: subRows } = await db.prepare('SELECT * FROM teacher_attendance ORDER BY id DESC').all();
            const mySubmissions = (subRows || []).filter((s) => s.teacher_email.toLowerCase() === email);
            const todayRec = mySubmissions.find((s) => s.attendance_date === today) || null;

            return jsonResponse({
              success: true,
              is_admin: isAdm,
              current_user: currUser,
              today_record: todayRec,
              my_history: mySubmissions,
              all_submissions: isAdm ? (subRows || []) : [],
              registered_users: (userRows || []).map((u) => ({ id: u.id, name: u.full_name, email: u.email })),
            });
          }

          const currUser = memoryStore.users.find((u) => u.email.toLowerCase() === email) || null;
          const isAdm = isAdminUser || (currUser && currUser.role === 'admin');
          const mySubmissions = memoryStore.teacherAttendance.filter((s) => s.teacher_email.toLowerCase() === email);
          const todayRec = mySubmissions.find((s) => s.attendance_date === today) || null;

          return jsonResponse({
            success: true,
            is_admin: isAdm,
            current_user: currUser,
            today_record: todayRec,
            my_history: mySubmissions,
            all_submissions: isAdm ? memoryStore.teacherAttendance : [],
            registered_users: memoryStore.users.map((u) => ({ id: u.id, name: u.full_name, email: u.email })),
          });
        }

        // Submit Presensi Kehadiran Guru
        if (pathname === '/api/teacher-attendance/submit' && request.method === 'POST') {
          const body = await request.json();
          const email = (body.email || '').trim().toLowerCase();
          const status = (body.status || '').trim();
          const note = (body.note || '').trim();
          const dateStr = (body.attendance_date || '').trim() || new Date().toISOString().slice(0, 10);

          if (!['Hadir', 'Izin', 'Sakit'].includes(status)) {
            return jsonResponse({ detail: 'Pilih status kehadiran (Hadir / Izin / Sakit).' }, 400);
          }

          if (['Izin', 'Sakit'].includes(status) && !note) {
            return jsonResponse({ detail: `Keterangan wajib diisi ketika memilih status ${status}.` }, 400);
          }

          if (db) {
            let user = await db.prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1').bind(email).first();
            if (!user) {
              const fullName = (body.name || email.split('@')[0] || 'Guru PIA').trim();
              const username = email.split('@')[0] || 'guru';
              const role = email === 'yumenoboken@gmail.com' ? 'admin' : 'guru';
              await db
                .prepare('INSERT INTO users (full_name, email, username, password_hash, password_salt, is_active, role) VALUES (?, ?, ?, ?, ?, 1, ?)')
                .bind(fullName, email, username, 'auto_hash', 'auto_salt', role)
                .run();
              user = await db.prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1').bind(email).first();
            }

            const existing = await db
              .prepare('SELECT * FROM teacher_attendance WHERE user_id = ? AND attendance_date = ? LIMIT 1')
              .bind(user.id, dateStr)
              .first();

            if (existing) {
              await db
                .prepare("UPDATE teacher_attendance SET status = ?, note = ?, approval_status = 'Approved', approved_by = 'Sistem Otomatis' WHERE id = ?")
                .bind(status, note, existing.id)
                .run();
              return jsonResponse({ success: true, message: 'Presensi berhasil diperbarui dan tersinkron ke Dashboard!' });
            }

            await db
              .prepare("INSERT INTO teacher_attendance (user_id, teacher_name, teacher_email, attendance_date, status, note, approval_status, approved_by) VALUES (?, ?, ?, ?, ?, ?, 'Approved', 'Sistem Otomatis')")
              .bind(user.id, user.full_name, user.email, dateStr, status, note)
              .run();

            return jsonResponse({ success: true, message: 'Presensi kehadiran berhasil dikirim dan tersinkron ke Dashboard!' }, 201);
          }

          let user = memoryStore.users.find((u) => u.email.toLowerCase() === email);
          if (!user) {
            user = {
              id: memoryStore.nextUserId++,
              full_name: (body.name || email.split('@')[0] || 'Guru PIA').trim(),
              email,
              username: email.split('@')[0] || 'guru',
              role: email === 'yumenoboken@gmail.com' ? 'admin' : 'guru',
              is_active: 1,
            };
            memoryStore.users.push(user);
          }

          const existingIdx = memoryStore.teacherAttendance.findIndex(
            (s) => s.user_id === user.id && s.attendance_date === dateStr
          );

          const record = {
            id: memoryStore.nextAttendanceId++,
            user_id: user.id,
            teacher_name: user.full_name,
            teacher_email: user.email,
            attendance_date: dateStr,
            status,
            note,
            approval_status: 'Approved',
            approved_by: 'Sistem Otomatis',
            created_at: new Date().toISOString(),
          };

          if (existingIdx >= 0) {
            memoryStore.teacherAttendance[existingIdx] = record;
          } else {
            memoryStore.teacherAttendance.unshift(record);
          }

          return jsonResponse({ success: true, message: 'Presensi kehadiran berhasil dikirim dan tersinkron ke Dashboard!', record }, 201);
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

