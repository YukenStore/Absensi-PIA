import secrets
import time
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.cpp_bridge import cpp_core
from ..core.database import get_db
from ..models.user import OtpVerification, User
from ..schemas.auth import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    ResendOtpRequest,
    VerifyOtpRequest,
)
from ..services.email_service import send_otp_email

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _create_jwt_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.JWT_EXPIRE_MINUTES
    )
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "email": user.email,
        "exp": expire,
    }
    return jwt.encode(
        payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)):
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

    # 2. Cek apakah email atau username sudah terdaftar di database SQL
    existing_email = db.query(User).filter(User.email == email).first()
    if existing_email and existing_email.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alamat email sudah terdaftar dan aktif. Silakan langsung login.",
        )

    existing_username = (
        db.query(User).filter(User.username == username).first()
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
        # Perbarui data akun yang belum sempat diaktivasi
        existing_email.full_name = full_name
        existing_email.username = username
        existing_email.password_salt = salt
        existing_email.password_hash = password_hash
        user = existing_email
    else:
        user = User(
            full_name=full_name,
            email=email,
            username=username,
            password_salt=salt,
            password_hash=password_hash,
            is_active=False,
        )
        db.add(user)

    # 4. Generate 6 digit kode OTP menggunakan Shared Core C++
    otp_code = cpp_core.generate_otp(6)
    expires_at = int(time.time()) + settings.OTP_EXPIRE_SECONDS

    otp_entry = OtpVerification(
        email=email,
        otp_code=otp_code,
        expires_at=expires_at,
        is_used=False,
    )
    db.add(otp_entry)
    db.commit()
    db.refresh(user)

    # 5. Kirim kode OTP ke email pengguna
    send_otp_email(recipient_email=email, full_name=full_name, otp_code=otp_code)

    return AuthResponse(
        success=True,
        message=f"Registrasi berhasil! Kode OTP telah dikirim ke {email}.",
    )


@router.post("/verify-otp", response_model=AuthResponse)
def verify_otp_code(payload: VerifyOtpRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    input_otp = payload.otp_code.strip()

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Akun dengan alamat email tersebut tidak ditemukan.",
        )

    if user.is_active:
        return AuthResponse(
            success=True,
            message="Akun Anda sudah aktif. Silakan masuk.",
        )

    otp_record = (
        db.query(OtpVerification)
        .filter(
            OtpVerification.email == email,
            OtpVerification.is_used == False,  # noqa: E712
        )
        .order_by(OtpVerification.id.desc())
        .first()
    )

    if not otp_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tidak ada kode OTP aktif untuk email ini. Silakan minta kirim ulang OTP.",
        )

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

    otp_record.is_used = True
    user.is_active = True
    db.commit()

    return AuthResponse(
        success=True,
        message="Akun berhasil diaktifkan! Silakan login menggunakan akun Anda.",
    )


@router.post("/resend-otp", response_model=AuthResponse)
def resend_otp_code(payload: ResendOtpRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Akun dengan alamat email tersebut belum terdaftar.",
        )

    if user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Akun ini sudah aktif, tidak memerlukan kode OTP lagi.",
        )

    otp_code = cpp_core.generate_otp(6)
    expires_at = int(time.time()) + settings.OTP_EXPIRE_SECONDS

    otp_entry = OtpVerification(
        email=email,
        otp_code=otp_code,
        expires_at=expires_at,
        is_used=False,
    )
    db.add(otp_entry)
    db.commit()

    send_otp_email(
        recipient_email=email, full_name=user.full_name, otp_code=otp_code
    )

    return AuthResponse(
        success=True,
        message=f"Kode OTP baru telah dikirimkan ke {email}.",
    )


@router.post("/login", response_model=AuthResponse)
def login_user(payload: LoginRequest, db: Session = Depends(get_db)):
    identifier = payload.identifier.strip()
    password = payload.password

    user = (
        db.query(User)
        .filter(
            or_(
                User.username == identifier,
                User.email == identifier.lower(),
            )
        )
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username/email atau password tidak sesuai.",
        )

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
    return AuthResponse(
        success=True,
        message="Login berhasil!",
        access_token=token,
        user={
            "id": user.id,
            "full_name": user.full_name,
            "username": user.username,
            "email": user.email,
        },
    )
