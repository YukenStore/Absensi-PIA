import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Dict

from ..core.config import settings
from ..core.cpp_bridge import cpp_core
from ..core.database import DatabaseClient, get_db
from ..models.user import OtpVerification, User
from ..schemas.auth import (
    LoginRequest,
    RegisterRequest,
    ResendOtpRequest,
    VerifyOtpRequest,
)
from ..services.email_service import send_otp_email

try:
    from fastapi import APIRouter, Depends, HTTPException, status  # type: ignore
except ImportError:
    class HTTPException(Exception):  # type: ignore
        def __init__(self, status_code: int, detail: str) -> None:
            self.status_code = status_code
            self.detail = detail
            super().__init__(detail)

    class _Status:
        HTTP_200_OK = 200
        HTTP_201_CREATED = 201
        HTTP_400_BAD_REQUEST = 400
        HTTP_401_UNAUTHORIZED = 401
        HTTP_403_FORBIDDEN = 403
        HTTP_404_NOT_FOUND = 404

    status = _Status()  # type: ignore

    def Depends(dep: Any = None) -> Any:  # type: ignore
        return dep

    class APIRouter:  # type: ignore
        def __init__(self, **kwargs: Any) -> None:
            pass

        def post(self, *args: Any, **kwargs: Any):
            def decorator(fn: Any) -> Any:
                return fn
            return decorator


router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _create_jwt_token(user: User) -> str:
    """Membuat token JWT HS256 menggunakan pustaka standar Python (hmac + hashlib)."""
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "email": user.email,
        "exp": int(time.time()) + (settings.JWT_EXPIRE_MINUTES * 60),
    }
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = hmac.new(
        settings.JWT_SECRET_KEY.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    return f"{header_b64}.{payload_b64}.{_b64url_encode(signature)}"


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register_user(
    payload: RegisterRequest, db: DatabaseClient = Depends(get_db)
) -> Dict[str, Any]:
    full_name = payload.full_name.strip()
    email = payload.email.strip().lower()
    username = payload.username.strip()
    password = payload.password

    # 1. Validasi format input menggunakan Shared Core C++
    validation_code = cpp_core.validate_credentials_format(
        username, email, password
    )
    if validation_code == -1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username minimal 4 karakter dan tidak boleh mengandung spasi.",
        )
    if validation_code == -2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format alamat email tidak valid.",
        )
    if validation_code == -3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password harus terdiri dari minimal 8 karakter.",
        )

    # 2. Cek apakah email atau username sudah terdaftar di database SQL (Cloudflare D1 / SQLite)
    existing_email_row = db.fetch_one(
        "SELECT * FROM users WHERE email = ? LIMIT 1", [email]
    )
    existing_email = (
        User.from_row(existing_email_row) if existing_email_row else None
    )
    if existing_email and existing_email.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alamat email sudah terdaftar dan aktif. Silakan langsung login.",
        )

    existing_username_row = db.fetch_one(
        "SELECT * FROM users WHERE username = ? LIMIT 1", [username]
    )
    existing_username = (
        User.from_row(existing_username_row) if existing_username_row else None
    )
    if existing_username and (
        not existing_email or existing_username.id != existing_email.id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username sudah digunakan oleh pengguna lain.",
        )

    # 3. Hashing password menggunakan Shared Core C++
    salt = secrets.token_hex(16)
    password_hash = cpp_core.hash_password(password, salt)

    if existing_email and not existing_email.is_active:
        db.execute(
            """
            UPDATE users
            SET full_name = ?, username = ?, password_hash = ?, password_salt = ?
            WHERE id = ?
            """,
            [full_name, username, password_hash, salt, existing_email.id],
        )
    else:
        db.execute(
            """
            INSERT INTO users (full_name, email, username, password_hash, password_salt, is_active)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            [full_name, email, username, password_hash, salt],
        )

    # 4. Generate 6 digit kode OTP menggunakan Shared Core C++
    otp_code = cpp_core.generate_otp(6)
    expires_at = int(time.time()) + settings.OTP_EXPIRE_SECONDS

    db.execute(
        """
        INSERT INTO otp_verifications (email, otp_code, expires_at, is_used)
        VALUES (?, ?, ?, 0)
        """,
        [email, otp_code, expires_at],
    )

    # 5. Kirim kode OTP ke email pengguna
    send_otp_email(recipient_email=email, full_name=full_name, otp_code=otp_code)

    return {
        "success": True,
        "message": f"Registrasi berhasil! Kode OTP telah dikirim ke {email}.",
    }


@router.post("/verify-otp")
def verify_otp_code(
    payload: VerifyOtpRequest, db: DatabaseClient = Depends(get_db)
) -> Dict[str, Any]:
    email = payload.email.strip().lower()
    input_otp = payload.otp_code.strip()

    user_row = db.fetch_one(
        "SELECT * FROM users WHERE email = ? LIMIT 1", [email]
    )
    if not user_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Akun dengan alamat email tersebut tidak ditemukan.",
        )

    user = User.from_row(user_row)
    if user.is_active:
        return {
            "success": True,
            "message": "Akun Anda sudah aktif. Silakan masuk.",
        }

    otp_row = db.fetch_one(
        """
        SELECT * FROM otp_verifications
        WHERE email = ? AND is_used = 0
        ORDER BY id DESC LIMIT 1
        """,
        [email],
    )
    if not otp_row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tidak ada kode OTP aktif untuk email ini. Silakan minta kirim ulang OTP.",
        )

    otp_record = OtpVerification.from_row(otp_row)

    # Verifikasi OTP & waktu kedaluwarsa menggunakan Shared Core C++
    current_ts = int(time.time())
    verify_status = cpp_core.verify_otp(
        input_otp=input_otp,
        stored_otp=otp_record.otp_code,
        expiry_timestamp=int(otp_record.expires_at),
        current_timestamp=current_ts,
    )

    if verify_status == -1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kode OTP telah kedaluwarsa. Silakan klik Kirim Ulang OTP.",
        )
    if verify_status != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kode OTP yang dimasukkan tidak sesuai.",
        )

    db.execute(
        "UPDATE otp_verifications SET is_used = 1 WHERE id = ?",
        [otp_record.id],
    )
    db.execute("UPDATE users SET is_active = 1 WHERE id = ?", [user.id])

    return {
        "success": True,
        "message": "Akun berhasil diaktifkan! Silakan login menggunakan akun Anda.",
    }


@router.post("/resend-otp")
def resend_otp_code(
    payload: ResendOtpRequest, db: DatabaseClient = Depends(get_db)
) -> Dict[str, Any]:
    email = payload.email.strip().lower()

    user_row = db.fetch_one(
        "SELECT * FROM users WHERE email = ? LIMIT 1", [email]
    )
    if not user_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Akun dengan alamat email tersebut belum terdaftar.",
        )

    user = User.from_row(user_row)
    if user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Akun ini sudah aktif, tidak memerlukan kode OTP lagi.",
        )

    otp_code = cpp_core.generate_otp(6)
    expires_at = int(time.time()) + settings.OTP_EXPIRE_SECONDS

    db.execute(
        """
        INSERT INTO otp_verifications (email, otp_code, expires_at, is_used)
        VALUES (?, ?, ?, 0)
        """,
        [email, otp_code, expires_at],
    )

    send_otp_email(
        recipient_email=email, full_name=user.full_name, otp_code=otp_code
    )

    return {
        "success": True,
        "message": f"Kode OTP baru telah dikirimkan ke {email}.",
    }


@router.post("/login")
def login_user(
    payload: LoginRequest, db: DatabaseClient = Depends(get_db)
) -> Dict[str, Any]:
    identifier = payload.identifier.strip()
    password = payload.password

    user_row = db.fetch_one(
        "SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1",
        [identifier, identifier.lower()],
    )
    if not user_row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username/email atau password tidak sesuai.",
        )

    user = User.from_row(user_row)

    # Verifikasi password menggunakan Shared Core C++
    is_valid_pw = cpp_core.verify_password(
        password=password,
        salt=user.password_salt,
        stored_hash=user.password_hash,
    )
    if not is_valid_pw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username/email atau password tidak sesuai.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun Anda belum diaktifkan. Silakan verifikasi kode OTP yang dikirim ke email Anda.",
        )

    token = _create_jwt_token(user)
    return {
        "success": True,
        "message": "Login berhasil!",
        "access_token": token,
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "username": user.username,
            "email": user.email,
        },
    }
