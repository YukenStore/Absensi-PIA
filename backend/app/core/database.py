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
        try:
            self.execute(users_table_sql)
            self.execute(otp_table_sql)
        except Exception as exc:
            print(f"[Database] Peringatan inisialisasi tabel: {exc}")


db_client = DatabaseClient()


def get_db() -> DatabaseClient:
    return db_client
