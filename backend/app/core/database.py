import json
import sqlite3
import urllib.request
from typing import Any, Dict, List, Optional
from .config import settings


class DatabaseClient:
    """
    Klien SQL Hybrid untuk Cloudflare D1 SQL API & SQLite Lokal (bawaan Python).
    Menggunakan modul standar Python (`sqlite3` & `urllib.request`) sehingga
    bebas dari error import library eksternal dan 100% kompatibel dengan Cloudflare D1.
    """

    def __init__(self) -> None:
        self._init_schema()

    def _execute_cloudflare_d1(
        self, sql: str, params: Optional[List[Any]] = None
    ) -> List[Dict[str, Any]]:
        url = (
            f"https://api.cloudflare.com/client/v4/accounts/"
            f"{settings.CLOUDFLARE_ACCOUNT_ID}/d1/database/"
            f"{settings.CLOUDFLARE_D1_DATABASE_ID}/query"
        )
        payload = json.dumps({"sql": sql, "params": params or []}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Authorization": f"Bearer {settings.CLOUDFLARE_API_TOKEN}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            if not body.get("success"):
                raise RuntimeError(f"Cloudflare D1 Error: {body.get('errors')}")
            result_list = body.get("result", [])
            if result_list and isinstance(result_list, list):
                return result_list[0].get("results", [])
            return []

    def _execute_local_sqlite(
        self, sql: str, params: Optional[List[Any]] = None
    ) -> List[Dict[str, Any]]:
        conn = sqlite3.connect(settings.LOCAL_SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                cur = conn.execute(sql, params or [])
                rows = cur.fetchall()
                return [dict(row) for row in rows]
        finally:
            conn.close()

    def execute(
        self, sql: str, params: Optional[List[Any]] = None
    ) -> List[Dict[str, Any]]:
        if settings.use_cloudflare_d1:
            return self._execute_cloudflare_d1(sql, params)
        return self._execute_local_sqlite(sql, params)

    def fetch_one(
        self, sql: str, params: Optional[List[Any]] = None
    ) -> Optional[Dict[str, Any]]:
        rows = self.execute(sql, params)
        return rows[0] if rows else None

    def query_all(
        self, sql: str, params: Optional[List[Any]] = None
    ) -> List[Dict[str, Any]]:
        return self.execute(sql, params)

    def query_one(
        self, sql: str, params: Optional[List[Any]] = None
    ) -> Optional[Dict[str, Any]]:
        return self.fetch_one(sql, params)

    def _init_schema(self) -> None:
        users_table_sql = """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
        otp_table_sql = """
        CREATE TABLE IF NOT EXISTS otp_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            otp_code TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            is_used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
        students_table_sql = """
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            class_name TEXT NOT NULL,
            birth_date TEXT NOT NULL,
            parent_name TEXT NOT NULL DEFAULT '',
            parent_phone TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
        learning_progress_sql = """
        CREATE TABLE IF NOT EXISTS student_learning_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            level_name TEXT NOT NULL,
            item_id TEXT NOT NULL,
            item_label TEXT NOT NULL,
            is_completed INTEGER NOT NULL DEFAULT 0,
            note TEXT NOT NULL DEFAULT '',
            updated_by TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(student_id, category, level_name, item_id)
        );
        """
        learning_level_sql = """
        CREATE TABLE IF NOT EXISTS student_learning_level (
            student_id INTEGER PRIMARY KEY,
            current_iqro_level INTEGER NOT NULL DEFAULT 1,
            updated_by TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
        try:
            self.execute(users_table_sql)
            self.execute(otp_table_sql)
            self.execute(students_table_sql)
            self.execute(learning_progress_sql)
            self.execute(learning_level_sql)
            try:
                self.execute("ALTER TABLE students ADD COLUMN parent_name TEXT NOT NULL DEFAULT ''")
            except Exception:
                pass
            try:
                self.execute("ALTER TABLE students ADD COLUMN parent_phone TEXT NOT NULL DEFAULT ''")
            except Exception:
                pass
        except Exception as exc:
            print(f"[Database] Peringatan inisialisasi tabel: {exc}")


db_client = DatabaseClient()


def get_db() -> DatabaseClient:
    return db_client
