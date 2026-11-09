import os
from pathlib import Path


def _load_env_file() -> None:
    """Membaca file .env secara native tanpa membutuhkan library eksternal."""
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file()


class Settings:
    PROJECT_NAME: str = "Sistem Absensi PIA API"
    VERSION: str = "1.0.0"

    # Konfigurasi Cloudflare D1 SQL API
    CLOUDFLARE_ACCOUNT_ID: str = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
    CLOUDFLARE_D1_DATABASE_ID: str = os.getenv("CLOUDFLARE_D1_DATABASE_ID", "").strip()
    CLOUDFLARE_API_TOKEN: str = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()

    # Fallback SQLite lokal (kompatibel penuh dengan engine SQLite Cloudflare D1)
    LOCAL_SQLITE_PATH: str = os.getenv(
        "LOCAL_SQLITE_PATH",
        str(Path(__file__).resolve().parents[2] / "absensi_pia.db"),
    )

    JWT_SECRET_KEY: str = os.getenv(
        "JWT_SECRET_KEY", "pia_default_secret_key_change_in_production_2026"
    )
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

    # Konfigurasi SMTP Gmail untuk pengiriman OTP
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "").strip()
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "").strip()
    SMTP_FROM_NAME: str = os.getenv("SMTP_FROM_NAME", "Sistem Absensi PIA")

    OTP_EXPIRE_SECONDS: int = 300  # 5 menit

    @property
    def use_cloudflare_d1(self) -> bool:
        return bool(
            self.CLOUDFLARE_ACCOUNT_ID
            and self.CLOUDFLARE_D1_DATABASE_ID
            and self.CLOUDFLARE_API_TOKEN
        )


settings = Settings()
