import os
import sys
from typing import Any, Dict, List, Optional

# Pastikan direktori backend masuk ke sys.path untuk mencegah error relative import
_current_dir = os.path.dirname(os.path.abspath(__file__))
_backend_dir = os.path.abspath(os.path.join(_current_dir, "..", ".."))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

try:
    from ..core.database import DatabaseClient, get_db
except (ImportError, ValueError):
    try:
        from app.core.database import DatabaseClient, get_db
    except (ImportError, ValueError):
        from backend.app.core.database import DatabaseClient, get_db

try:
    from fastapi import APIRouter, Depends, HTTPException, status  # type: ignore
    from pydantic import BaseModel  # type: ignore

    class StudentCreate(BaseModel):
        full_name: str
        class_name: str
        birth_date: str
        parent_name: Optional[str] = ""
        parent_phone: Optional[str] = ""
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
            "SELECT id, full_name, class_name, birth_date, parent_name, parent_phone, created_by, created_at FROM students ORDER BY id ASC"
        )
        return {"success": True, "students": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/students", status_code=201)
def add_student(payload: Dict[str, Any], db: DatabaseClient = Depends(get_db)):
    full_name = str(payload.get("full_name") or "").strip()
    class_name = str(payload.get("class_name") or "").strip()
    birth_date = str(payload.get("birth_date") or "").strip()
    parent_name = str(payload.get("parent_name") or "").strip()
    parent_phone = str(payload.get("parent_phone") or "").strip()
    created_by = str(payload.get("created_by") or "Guru PIA").strip()

    if not full_name or not class_name or not birth_date:
        raise HTTPException(
            status_code=400,
            detail="Nama siswa, kelas, dan tanggal lahir wajib diisi.",
        )

    try:
        db.execute(
            "INSERT INTO students (full_name, class_name, birth_date, parent_name, parent_phone, created_by) VALUES (?, ?, ?, ?, ?, ?)",
            [full_name, class_name, birth_date, parent_name, parent_phone, created_by],
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
            "SELECT id, full_name, class_name, birth_date, parent_name, parent_phone, created_by, created_at FROM students ORDER BY id ASC"
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
            parent_name = str(s.get("parent_name") or "").strip()
            parent_phone = str(s.get("parent_phone") or "").strip()
            cby = str(s.get("created_by") or "Guru PIA").strip()
            if not fname or not cname or not bdate:
                continue

            exists = db.fetch_one(
                "SELECT id FROM students WHERE lower(full_name) = lower(?) AND birth_date = ? LIMIT 1",
                [fname, bdate],
            )
            if not exists:
                db.execute(
                    "INSERT INTO students (full_name, class_name, birth_date, parent_name, parent_phone, created_by) VALUES (?, ?, ?, ?, ?, ?)",
                    [fname, cname, bdate, parent_name, parent_phone, cby],
                )

    rows = db.execute(
        "SELECT id, full_name, class_name, birth_date, parent_name, parent_phone, created_by, created_at FROM students ORDER BY id ASC"
    )
    return {"success": True, "students": rows}


@router.get("/api/attendance/overview")
def attendance_overview(db: DatabaseClient = Depends(get_db)):
    try:
        student_rows = db.execute(
            "SELECT id, full_name, class_name, birth_date, parent_name, parent_phone FROM students ORDER BY id ASC"
        )
        students = [
            {
                "id": s["id"],
                "name": s["full_name"],
                "class_name": s["class_name"],
                "birth_date": s["birth_date"],
                "parent_name": s.get("parent_name") or "",
                "parent_phone": s.get("parent_phone") or "",
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


# ==========================================
# MUTABA'AH PROGRES IQRO & HAFALAN QUR'AN
# ==========================================

@router.get("/api/learning-progress")
def get_learning_progress(student_id: Optional[int] = None, db: DatabaseClient = Depends(get_db)):
    try:
        if student_id:
            level_row = db.fetch_one("SELECT current_iqro_level FROM student_learning_level WHERE student_id = ?", [student_id])
            current_level = int(level_row["current_iqro_level"]) if level_row and level_row.get("current_iqro_level") else 1
            progress_rows = db.execute(
                "SELECT category, level_name, item_id, item_label, is_completed, note, updated_by, updated_at FROM student_learning_progress WHERE student_id = ?",
                [student_id]
            )
            return {
                "success": True,
                "student_id": student_id,
                "current_iqro_level": current_level,
                "progress": progress_rows or []
            }
        else:
            all_levels = db.execute("SELECT student_id, current_iqro_level FROM student_learning_level")
            all_progress = db.execute(
                "SELECT student_id, category, level_name, item_id, item_label, is_completed, note, updated_by, updated_at FROM student_learning_progress"
            )
            return {
                "success": True,
                "levels": all_levels or [],
                "progress": all_progress or []
            }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/learning-progress")
def save_learning_progress(payload: Dict[str, Any], db: DatabaseClient = Depends(get_db)):
    try:
        student_id = payload.get("student_id")
        if not student_id:
            raise HTTPException(status_code=400, detail="ID Santri wajib disertakan.")
        student_id = int(student_id)
        current_level = payload.get("current_iqro_level")
        items = payload.get("items", [])
        updated_by = (payload.get("updated_by") or "Guru PIA").strip()

        if current_level:
            db.execute("""
                INSERT INTO student_learning_level (student_id, current_iqro_level, updated_by, updated_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(student_id) DO UPDATE SET
                    current_iqro_level = excluded.current_iqro_level,
                    updated_by = excluded.updated_by,
                    updated_at = datetime('now')
            """, [student_id, int(current_level), updated_by])

        for item in items:
            category = (item.get("category") or "iqro").strip()
            level_name = (item.get("level_name") or "").strip()
            item_id = str(item.get("item_id") or "").strip()
            item_label = str(item.get("item_label") or item_id).strip()
            is_completed = 1 if item.get("is_completed") else 0
            note = (item.get("note") or "").strip()

            db.execute("""
                INSERT INTO student_learning_progress (student_id, category, level_name, item_id, item_label, is_completed, note, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(student_id, category, level_name, item_id) DO UPDATE SET
                    item_label = excluded.item_label,
                    is_completed = excluded.is_completed,
                    note = excluded.note,
                    updated_by = excluded.updated_by,
                    updated_at = datetime('now')
            """, [student_id, category, level_name, item_id, item_label, is_completed, note, updated_by])

        return {"success": True, "message": "Progres mutaba'ah berhasil disimpan."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/learning-progress/advance-level")
def advance_learning_level(payload: Dict[str, Any], db: DatabaseClient = Depends(get_db)):
    try:
        student_id = payload.get("student_id")
        target_level = int(payload.get("target_level") or 1)
        updated_by = (payload.get("updated_by") or "Guru PIA").strip()

        if not student_id:
            raise HTTPException(status_code=400, detail="ID Santri wajib disertakan.")
        student_id = int(student_id)

        db.execute("""
            INSERT INTO student_learning_level (student_id, current_iqro_level, updated_by, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(student_id) DO UPDATE SET
                current_iqro_level = excluded.current_iqro_level,
                updated_by = excluded.updated_by,
                updated_at = datetime('now')
        """, [student_id, target_level, updated_by])

        return {
            "success": True,
            "student_id": student_id,
            "current_iqro_level": target_level,
            "message": f"Berhasil naik ke Iqro {target_level}!"
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/learning-progress/overview")
def get_learning_overview(db: DatabaseClient = Depends(get_db)):
    try:
        students = db.execute("SELECT id, full_name, class_name FROM students ORDER BY id ASC")
        levels = db.execute("SELECT student_id, current_iqro_level, updated_at FROM student_learning_level")
        counts = db.execute("""
            SELECT student_id, category, level_name, COUNT(*) as completed_count
            FROM student_learning_progress
            WHERE is_completed = 1
            GROUP BY student_id, category, level_name
        """)

        level_map = {l["student_id"]: l["current_iqro_level"] for l in levels or []}
        count_map = {}
        for c in counts or []:
            sid = c["student_id"]
            if sid not in count_map:
                count_map[sid] = {"iqroByLevel": {}, "hafalan": 0}
            if c["category"] == "iqro":
                count_map[sid]["iqroByLevel"][c["level_name"]] = c["completed_count"]
            elif c["category"] == "hafalan":
                count_map[sid]["hafalan"] += c["completed_count"]

        overview_list = []
        for s in students or []:
            sid = s["id"]
            cur_lvl = level_map.get(sid, 1)
            c_data = count_map.get(sid, {"iqroByLevel": {}, "hafalan": 0})
            cur_lvl_name = f"Iqro {cur_lvl}"
            cur_lvl_completed = c_data["iqroByLevel"].get(cur_lvl_name, 0)
            overview_list.append({
                "id": sid,
                "name": s["full_name"],
                "class_name": s["class_name"],
                "current_iqro_level": cur_lvl,
                "current_iqro_completed": cur_lvl_completed,
                "hafalan_completed": c_data.get("hafalan", 0)
            })

        return {"success": True, "students": overview_list}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))



