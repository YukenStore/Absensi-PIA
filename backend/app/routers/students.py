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
            "SELECT id, full_name, email, username, role, is_hidden FROM users WHERE is_active = 1 ORDER BY id ASC"
        )
        all_teachers = [
            {
                "id": u["id"],
                "name": u["full_name"],
                "email": u["email"],
                "username": u["username"],
                "role": "admin" if u["email"].lower() == "yumenoboken@gmail.com" else (u.get("role") or "guru"),
                "is_hidden": bool(u.get("is_hidden", 0)),
            }
            for u in user_rows
        ]

        return {
            "success": True,
            "students": students,
            "teachers": [t for t in all_teachers if not t["is_hidden"]],
            "all_teachers": all_teachers,
            "custom_holidays": {},
            "student_records": {},
            "teacher_records": {},
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
