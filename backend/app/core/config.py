import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    PROJECT_NAME: str = "Sistem Absensi PIA API"
    VERSION: str = "1.0.0"

    # Mendukung koneksi SQL Supabase (PostgreSQL) maupun SQLite lokal
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./absensi_pia.db")

    # Jika URL diawali postgres:// (format lama Heroku/Supabase), sesuaikan ke postgresql:// untuk SQLAlchemy
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

    JWT_SECRET_KEY: str = os.getenv(
        "JWT_SECRET_KEY", "pia_default_secret_key_change_in_production_2026"
    )
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

    # Konfigurasi SMTP Gmail untuk pengiriman OTP
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "").strip()
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "").strip()
    SMTP_FROM_NAME: str = os.getenv("SMTP_FROM_NAME", "Sistem Absensi PIA")

    OTP_EXPIRE_SECONDS: int = 300  # 5 menit


settings = Settings()
