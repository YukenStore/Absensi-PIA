from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.cpp_bridge import cpp_core
from app.core.database import Base, engine
from app.routers import auth

# Membuat tabel SQL secara otomatis (baik pada SQLite lokal maupun Supabase PostgreSQL)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=(
        "Backend FastAPI untuk Sistem Absensi PIA Cross-Platform "
        "dengan integrasi Shared Core C++ dan SQL (Supabase PostgreSQL / SQLite)."
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
        "cpp_core_native_loaded": cpp_core.is_native_loaded,
    }
