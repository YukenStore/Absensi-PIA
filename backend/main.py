import sys
from pathlib import Path

# Pastikan direktori backend masuk ke sys.path
_BACKEND_DIR = str(Path(__file__).resolve().parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from app.core.config import settings
from app.core.cpp_bridge import cpp_core
from app.routers import auth

try:
    from fastapi import FastAPI  # type: ignore
    from fastapi.middleware.cors import CORSMiddleware  # type: ignore

    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        description=(
            "Backend FastAPI untuk Sistem Absensi PIA Cross-Platform "
            "dengan integrasi Shared Core C++ dan SQL (Cloudflare D1 / SQLite)."
        ),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)

    @app.get("/api/health", tags=["System"])
    def health_check():
        return {
            "status": "ok",
            "service": settings.PROJECT_NAME,
            "database_mode": (
                "Cloudflare D1 SQL"
                if settings.use_cloudflare_d1
                else "Local SQLite (D1 Compatible)"
            ),
            "cpp_core_native_loaded": cpp_core.is_native_loaded,
        }

except ImportError:
    app = None
