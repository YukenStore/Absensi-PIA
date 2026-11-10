from typing import Any, Dict, List, Optional
from ..core.database import DatabaseClient, get_db

try:
    from fastapi import APIRouter, Depends, HTTPException, status  # type: ignore
    from pydantic import BaseModel  # type: ignore

    class StudentCreate(BaseModel):
        full_name: str
        class_name: str
        birth_date: str
        created_by: Optional[str] = "Guru PIA"

    class StudentDelete(BaseModel):
        student_id: Optional[int] = None
        full_name: Optional[str] = None
        birth_date: Optional[str] = None

    class StudentSync(BaseModel):
        students: List[Dict[str, Any]] = []

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
        HTTP_404_NOT_FOUND = 404
        HTTP_500_INTERNAL_SERVER_ERROR = 500

    status = _Status()  # type: ignore

    def Depends(dep: Any = None) -> Any:  # type: ignore
        return dep

    class APIRouter:  # type: ignore
        def __init__(self, **kwargs: Any) -> None:
            pass
        def get(self, *args: Any, **kwargs: Any):
            def decorator(fn: Any) -> Any: return fn
            return decorator
        def post(self, *args: Any, **kwargs: Any):
            def decorator(fn: Any) -> Any: return fn
            return decorator

    class BaseModel:  # type: ignore
        pass

    class StudentCreate:  # type: ignore
        pass
    class StudentDelete:  # type: ignore
        pass
    class StudentSync:  # type: ignore
        pass

router = APIRouter(tags=["Students & Attendance"])


@router.get("/api/students")
def get_students(db: DatabaseClient = Depends(get_db)):
    try:
        rows = db.execute(
            "SELECT id, full_name, class_name, birth_date, created_by, created_at FROM students ORDER BY id ASC"
        )
        return {"success": True, "students": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/students", status_code=201)
def add_student(payload: Dict[str, Any], db: DatabaseClient = Depends(get_db)):
    full_name = str(payload.get("full_name") or "").strip()
    class_name = str(payload.get("class_name") or "").strip()
    birth_date = str(payload.get("birth_date") or "").strip()
    created_by = str(payload.get("created_by") or "Guru PIA").strip()

    if not full_name or not class_name or not birth_date:
        raise HTTPException(
            status_code=400,
            detail="Nama siswa, kelas, dan tanggal lahir wajib diisi.",
        )

    try:
        db.execute(
            "INSERT INTO students (full_name, class_name, birth_date, created_by) VALUES (?, ?, ?, ?)",
            [full_name, class_name, birth_date, created_by],
        )
        new_row = db.fetch_one(
            "SELECT * FROM students WHERE lower(full_name) = lower(?) AND birth_date = ? ORDER BY id DESC LIMIT 1",
            [full_name, birth_date],
        )
        return {
            "success": True,
            "message": f"Data siswa '{full_name}' berhasil ditambahkan!",
            "student": new_row,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/students/delete")
def delete_student(payload: Dict[str, Any], db: DatabaseClient = Depends(get_db)):
    student_id = payload.get("student_id")
    full_name = str(payload.get("full_name") or payload.get("name") or "").strip()
    birth_date = str(payload.get("birth_date") or "").strip()

    if not student_id and not full_name:
        raise HTTPException(status_code=400, detail="ID atau nama siswa tidak valid.")

    try:
        if student_id:
            try:
                sid = int(student_id)
                db.execute("DELETE FROM students WHERE id = ?", [sid])
                try:
                    db.execute("DELETE FROM student_attendance WHERE student_id = ?", [sid])
                except Exception:
                    pass
            except (ValueError, TypeError):
                pass

        if full_name:
            if birth_date:
                db.execute(
                    "DELETE FROM students WHERE lower(full_name) = lower(?) AND birth_date = ?",
                    [full_name, birth_date],
                )
            else:
                db.execute(
                    "DELETE FROM students WHERE lower(full_name) = lower(?)",
                    [full_name],
                )

        rows = db.execute(
            "SELECT id, full_name, class_name, birth_date, created_by, created_at FROM students ORDER BY id ASC"
        )
        return {
            "success": True,
            "message": "Data siswa berhasil dihapus dari database.",
            "students": rows,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/students/sync")
def sync_students(payload: Dict[str, Any], db: DatabaseClient = Depends(get_db)):
    client_students = payload.get("students") or []
    if isinstance(client_students, list):
        for s in client_students:
            fname = str(s.get("full_name") or s.get("name") or "").strip()
            cname = str(s.get("class_name") or "").strip()
            bdate = str(s.get("birth_date") or "").strip()
            cby = str(s.get("created_by") or "Guru PIA").strip()
            if not fname or not cname or not bdate:
                continue

            exists = db.fetch_one(
                "SELECT id FROM students WHERE lower(full_name) = lower(?) AND birth_date = ? LIMIT 1",
                [fname, bdate],
            )
            if not exists:
                db.execute(
                    "INSERT INTO students (full_name, class_name, birth_date, created_by) VALUES (?, ?, ?, ?)",
                    [fname, cname, bdate, cby],
                )

    rows = db.execute(
        "SELECT id, full_name, class_name, birth_date, created_by, created_at FROM students ORDER BY id ASC"
    )
    return {"success": True, "students": rows}


@router.get("/api/attendance/overview")
def attendance_overview(db: DatabaseClient = Depends(get_db)):
    try:
        student_rows = db.execute(
            "SELECT id, full_name, class_name, birth_date FROM students ORDER BY id ASC"
        )
        students = [
            {
                "id": s["id"],
                "name": s["full_name"],
                "class_name": s["class_name"],
                "birth_date": s["birth_date"],
            }
            for s in student_rows
        ]

        user_rows = db.execute(
            "SELECT id, full_name, email, username, role, is_hidden, is_active FROM users ORDER BY id ASC"
        )
        all_teachers = [
            {
                "id": u["id"],
                "name": u["full_name"],
                "email": u["email"],
                "username": u["username"],
                "role": "admin" if u["email"].lower() == "yumenoboken@gmail.com" else (u.get("role") or "guru"),
                "is_hidden": bool(u.get("is_hidden", 0)),
                "is_active": bool(u.get("is_active", 1)),
            }
            for u in user_rows
        ]

        teacher_records = {}
        try:
            att_rows = db.execute(
                "SELECT user_id, teacher_email, attendance_date, status FROM teacher_attendance WHERE approval_status != 'Rejected'"
            )
            for r in att_rows:
                code = 'H' if r["status"] == 'Hadir' else ('I' if r["status"] == 'Izin' else 'S')
                teacher_records[f"{r['user_id']}_{r['attendance_date']}"] = code
                if r.get("teacher_email"):
                    teacher_records[f"{r['teacher_email'].lower()}_{r['attendance_date']}"] = code
        except Exception:
            pass

        return {
            "success": True,
            "students": students,
            "teachers": [t for t in all_teachers if not t["is_hidden"]],
            "all_teachers": all_teachers,
            "custom_holidays": {},
            "student_records": {},
            "teacher_records": teacher_records,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/teachers/sync")
def sync_teachers(payload: Dict[str, Any], db: DatabaseClient = Depends(get_db)):
    try:
        incoming_teachers = payload.get("teachers") or []
        for t in incoming_teachers:
            email = str(t.get("email") or "").strip().lower()
            name = str(t.get("name") or t.get("full_name") or t.get("username") or "").strip()
            username = str(t.get("username") or (email.split("@")[0] if "@" in email else "guru")).strip()
            role = "admin" if email == "yumenoboken@gmail.com" else str(t.get("role") or "guru")
            if not email or not name:
                continue

            exists = db.fetch_one("SELECT id FROM users WHERE lower(email) = ? LIMIT 1", [email])
            if not exists:
                db.execute(
                    "INSERT INTO users (full_name, email, username, password_hash, password_salt, is_active, role, is_hidden) VALUES (?, ?, ?, ?, ?, 1, ?, 0)",
                    [name, email, username, "synced_hash", "synced_salt", role],
                )

        user_rows = db.execute(
            "SELECT id, full_name, email, username, role, is_hidden, is_active FROM users ORDER BY id ASC"
        )
        teachers = [
            {
                "id": u["id"],
                "name": u["full_name"],
                "email": u["email"],
                "username": u["username"],
                "role": "admin" if u["email"].lower() == "yumenoboken@gmail.com" else (u.get("role") or "guru"),
                "is_hidden": bool(u.get("is_hidden", 0)),
                "is_active": bool(u.get("is_active", 1)),
            }
            for u in user_rows
        ]
        return {
            "success": True,
            "teachers": [t for t in teachers if not t["is_hidden"]],
            "all_teachers": teachers,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/learning-records")
def get_learning_records(db: DatabaseClient = Depends(get_db)):
    try:
        db.execute(
            """CREATE TABLE IF NOT EXISTS learning_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER,
                student_name TEXT NOT NULL,
                teacher_name TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL,
                materi TEXT NOT NULL,
                jilid TEXT NOT NULL DEFAULT '',
                halaman TEXT NOT NULL DEFAULT '',
                surat TEXT NOT NULL DEFAULT '',
                ayat TEXT NOT NULL DEFAULT '',
                doa TEXT NOT NULL DEFAULT '',
                predicate TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                record_date TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        rows = db.execute("SELECT * FROM learning_records ORDER BY record_date DESC, id DESC LIMIT 500")
        return {"success": True, "records": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/learning-records", status_code=201)
def add_learning_record(payload: Dict[str, Any], db: DatabaseClient = Depends(get_db)):
    student_id = payload.get("student_id")
    student_name = str(payload.get("student_name") or "").strip()
    teacher_name = str(payload.get("teacher_name") or "Guru PIA").strip()
    category = str(payload.get("category") or "Iqro").strip()
    materi = str(payload.get("materi") or "-").strip()
    jilid = str(payload.get("jilid") or "").strip()
    halaman = str(payload.get("halaman") or "").strip()
    surat = str(payload.get("surat") or "").strip()
    ayat = str(payload.get("ayat") or "").strip()
    doa = str(payload.get("doa") or "").strip()
    predicate = str(payload.get("predicate") or "Lancar").strip()
    note = str(payload.get("note") or "").strip()
    record_date = str(payload.get("record_date") or "").strip()

    if not student_name or not category or not materi:
        raise HTTPException(status_code=400, detail="Data santri, kategori, dan materi wajib diisi.")

    try:
        # Batasi 1 santri hanya dapat disimpan 1 kali rekap pembelajarannya dalam 1 hari
        existing = db.execute(
            "SELECT id, student_name, materi FROM learning_records WHERE (student_id = ? OR LOWER(student_name) = LOWER(?)) AND record_date = ? LIMIT 1",
            [student_id or 0, student_name, record_date],
        )
        if existing:
            existing_materi = existing[0].get("materi", "-") if isinstance(existing[0], dict) else "-"
            raise HTTPException(
                status_code=400,
                detail=f"Santri {student_name} sudah memiliki rekap pembelajaran ({existing_materi}) pada tanggal {record_date}. Satu santri hanya dapat dicatat 1 kali dalam 1 hari.",
            )

        db.execute(
            """INSERT INTO learning_records (
                student_id, student_name, teacher_name, category, materi, jilid, halaman, surat, ayat, doa, predicate, note, record_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [student_id, student_name, teacher_name, category, materi, jilid, halaman, surat, ayat, doa, predicate, note, record_date],
        )
        return {"success": True, "message": f"Capaian belajar {student_name} ({materi}) berhasil disimpan!"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/learning-records/delete")
def delete_learning_record(payload: Dict[str, Any], db: DatabaseClient = Depends(get_db)):
    record_id = payload.get("record_id")
    if not record_id:
        raise HTTPException(status_code=400, detail="ID catatan tidak valid.")
    try:
        db.execute("DELETE FROM learning_records WHERE id = ?", [int(record_id)])
        return {"success": True, "message": "Catatan pembelajaran berhasil dihapus."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


