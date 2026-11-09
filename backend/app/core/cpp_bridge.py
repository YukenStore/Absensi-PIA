import ctypes
import hashlib
import hmac
import os
import secrets
from pathlib import Path


class CppCoreBridge:
    """
    Jembatan Python (ctypes) ke Shared Library C++ (`backend/cpp_core`).
    Jika file library native (`pia_core.dll` / `libpia_core.so`) sudah dikompilasi,
    seluruh logika utama dijalankan langsung di C++. Jika belum dikompilasi,
    otomatis menggunakan algoritma identik agar server tetap berjalan lancar.
    """

    def __init__(self) -> None:
        self._lib = None
        self._load_native_library()

    def _load_native_library(self) -> None:
        cpp_dir = Path(__file__).resolve().parents[2] / "cpp_core"
        candidates = [
            cpp_dir / "pia_core.dll",
            cpp_dir / "libpia_core.so",
            cpp_dir / "libpia_core.dylib",
            cpp_dir / "build" / "pia_core.dll",
            cpp_dir / "build" / "libpia_core.so",
        ]

        for lib_path in candidates:
            if lib_path.exists():
                try:
                    lib = ctypes.CDLL(str(lib_path))

                    # pia_generate_otp(int length, char* out_buffer, int buffer_size)
                    lib.pia_generate_otp.argtypes = [
                        ctypes.c_int,
                        ctypes.c_char_p,
                        ctypes.c_int,
                    ]
                    lib.pia_generate_otp.restype = ctypes.c_int

                    # pia_verify_otp(const char* input, const char* stored, long long exp, long long cur)
                    lib.pia_verify_otp.argtypes = [
                        ctypes.c_char_p,
                        ctypes.c_char_p,
                        ctypes.c_longlong,
                        ctypes.c_longlong,
                    ]
                    lib.pia_verify_otp.restype = ctypes.c_int

                    # pia_hash_password(const char* pw, const char* salt, char* out, int size)
                    lib.pia_hash_password.argtypes = [
                        ctypes.c_char_p,
                        ctypes.c_char_p,
                        ctypes.c_char_p,
                        ctypes.c_int,
                    ]
                    lib.pia_hash_password.restype = ctypes.c_int

                    # pia_verify_password(const char* pw, const char* salt, const char* stored)
                    lib.pia_verify_password.argtypes = [
                        ctypes.c_char_p,
                        ctypes.c_char_p,
                        ctypes.c_char_p,
                    ]
                    lib.pia_verify_password.restype = ctypes.c_int

                    # pia_validate_credentials_format(const char* u, const char* e, const char* p)
                    lib.pia_validate_credentials_format.argtypes = [
                        ctypes.c_char_p,
                        ctypes.c_char_p,
                        ctypes.c_char_p,
                    ]
                    lib.pia_validate_credentials_format.restype = ctypes.c_int

                    # pia_evaluate_attendance_status(int, int, int, int, int)
                    lib.pia_evaluate_attendance_status.argtypes = [
                        ctypes.c_int,
                        ctypes.c_int,
                        ctypes.c_int,
                        ctypes.c_int,
                        ctypes.c_int,
                    ]
                    lib.pia_evaluate_attendance_status.restype = ctypes.c_int

                    self._lib = lib
                    print(f"[C++ Core] Berhasil memuat library native: {lib_path}")
                    return
                except Exception as exc:
                    print(f"[C++ Core] Gagal memuat {lib_path}: {exc}")

    @property
    def is_native_loaded(self) -> bool:
        return self._lib is not None

    def generate_otp(self, length: int = 6) -> str:
        if self._lib is not None:
            buf_size = length + 2
            buf = ctypes.create_string_buffer(buf_size)
            ok = self._lib.pia_generate_otp(length, buf, buf_size)
            if ok == 1:
                return buf.value.decode("utf-8")

        return "".join(str(secrets.randbelow(10)) for _ in range(length))

    def verify_otp(
        self,
        input_otp: str,
        stored_otp: str,
        expiry_timestamp: int,
        current_timestamp: int,
    ) -> int:
        if self._lib is not None:
            return int(
                self._lib.pia_verify_otp(
                    input_otp.encode("utf-8"),
                    stored_otp.encode("utf-8"),
                    int(expiry_timestamp),
                    int(current_timestamp),
                )
            )

        if current_timestamp > expiry_timestamp:
            return -1
        return 1 if hmac.compare_digest(input_otp, stored_otp) else 0

    @staticmethod
    def _fallback_stretched_hash(password: str, salt: str) -> str:
        current = f"{salt}:{password}:PIA_CORE_V1"
        for _ in range(1000):
            digest = hashlib.sha256(current.encode("utf-8")).hexdigest()
            current = f"{digest}:{salt}"
        return hashlib.sha256(current.encode("utf-8")).hexdigest()

    def hash_password(self, password: str, salt: str) -> str:
        if self._lib is not None:
            buf = ctypes.create_string_buffer(66)
            ok = self._lib.pia_hash_password(
                password.encode("utf-8"),
                salt.encode("utf-8"),
                buf,
                66,
            )
            if ok == 1:
                return buf.value.decode("utf-8")

        return self._fallback_stretched_hash(password, salt)

    def verify_password(self, password: str, salt: str, stored_hash: str) -> bool:
        if self._lib is not None:
            res = self._lib.pia_verify_password(
                password.encode("utf-8"),
                salt.encode("utf-8"),
                stored_hash.encode("utf-8"),
            )
            return res == 1

        computed = self._fallback_stretched_hash(password, salt)
        return hmac.compare_digest(computed, stored_hash)

    def validate_credentials_format(
        self, username: str, email: str, password: str
    ) -> int:
        if self._lib is not None:
            return int(
                self._lib.pia_validate_credentials_format(
                    username.encode("utf-8"),
                    email.encode("utf-8"),
                    password.encode("utf-8"),
                )
            )

        if len(username) < 4 or " " in username:
            return -1
        if "@" not in email or "." not in email.split("@")[-1]:
            return -2
        if len(password) < 8:
            return -3
        return 1

    def evaluate_attendance_status(
        self,
        checkin_hour: int,
        checkin_minute: int,
        schedule_hour: int,
        schedule_minute: int,
        tolerance_minutes: int = 15,
    ) -> int:
        if self._lib is not None:
            return int(
                self._lib.pia_evaluate_attendance_status(
                    checkin_hour,
                    checkin_minute,
                    schedule_hour,
                    schedule_minute,
                    tolerance_minutes,
                )
            )

        diff = (checkin_hour * 60 + checkin_minute) - (
            schedule_hour * 60 + schedule_minute
        )
        if diff <= 0:
            return 0
        if diff <= tolerance_minutes:
            return 1
        return 2


cpp_core = CppCoreBridge()
