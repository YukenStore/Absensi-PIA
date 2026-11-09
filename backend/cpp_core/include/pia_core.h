#ifndef PIA_CORE_H
#define PIA_CORE_H

#ifdef _WIN32
  #ifdef PIA_CORE_EXPORTS
    #define PIA_API __declspec(dllexport)
  #else
    #define PIA_API __declspec(dllimport)
  #endif
#else
  #define PIA_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Menghasilkan kode OTP numerik acak sepanjang `length` digit (misal 6 digit).
 * Mengembalikan 1 jika berhasil, 0 jika gagal.
 */
PIA_API int pia_generate_otp(int length, char* out_buffer, int buffer_size);

/**
 * Memverifikasi kode OTP dengan perbandingan constant-time dan validasi kedaluwarsa.
 * Mengembalikan:
 *   1 = Kode OTP valid dan belum kedaluwarsa
 *   0 = Kode OTP tidak cocok
 *  -1 = Kode OTP sudah kedaluwarsa (current_timestamp > expiry_timestamp)
 */
PIA_API int pia_verify_otp(
    const char* input_otp,
    const char* stored_otp,
    long long expiry_timestamp,
    long long current_timestamp
);

/**
 * Melakukan hashing password menggunakan algoritma SHA-256 berlapis (iterated salted SHA-256)
 * murni di C++ sehingga portabel di semua platform (Backend Python & Mobile Flutter FFI).
 * Hasil berupa 64 karakter hex string (ditambah null-terminator).
 * Mengembalikan 1 jika berhasil, 0 jika buffer_size < 65.
 */
PIA_API int pia_hash_password(
    const char* password,
    const char* salt,
    char* out_hash,
    int buffer_size
);

/**
 * Memverifikasi apakah `password` + `salt` menghasilkan hash yang sama dengan `stored_hash`
 * menggunakan constant-time comparison untuk mencegah timing attack.
 * Mengembalikan 1 jika cocok, 0 jika tidak cocok.
 */
PIA_API int pia_verify_password(
    const char* password,
    const char* salt,
    const char* stored_hash
);

/**
 * Validasi format kredensial pendaftaran di sisi C++ Core:
 * Mengembalikan:
 *   1 = Valid
 *  -1 = Username tidak valid (kurang dari 4 karakter atau mengandung spasi)
 *  -2 = Format email tidak valid
 *  -3 = Password kurang dari 8 karakter
 */
PIA_API int pia_validate_credentials_format(
    const char* username,
    const char* email,
    const char* password
);

/**
 * Logika evaluasi status kehadiran (Absensi Guru / Siswa):
 * Mengembalikan:
 *   0 = Hadir Tepat Waktu
 *   1 = Terlambat (Masih dalam batas toleransi)
 *   2 = Terlambat (Melebihi batas toleransi)
 */
PIA_API int pia_evaluate_attendance_status(
    int checkin_hour,
    int checkin_minute,
    int schedule_hour,
    int schedule_minute,
    int tolerance_minutes
);

#ifdef __cplusplus
}
#endif

#endif // PIA_CORE_H

