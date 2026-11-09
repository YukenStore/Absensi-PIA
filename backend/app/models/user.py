from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class User:
    id: int
    full_name: str
    email: str
    username: str
    password_hash: str
    password_salt: str
    is_active: bool
    created_at: Optional[str] = None

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "User":
        return cls(
            id=int(row["id"]),
            full_name=str(row["full_name"]),
            email=str(row["email"]),
            username=str(row["username"]),
            password_hash=str(row["password_hash"]),
            password_salt=str(row["password_salt"]),
            is_active=bool(row["is_active"]),
            created_at=str(row.get("created_at", "")),
        )


@dataclass
class OtpVerification:
    id: int
    email: str
    otp_code: str
    expires_at: int
    is_used: bool
    created_at: Optional[str] = None

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "OtpVerification":
        return cls(
            id=int(row["id"]),
            otp_code=str(row["otp_code"]),
            email=str(row["email"]),
            expires_at=int(row["expires_at"]),
            is_used=bool(row["is_used"]),
            created_at=str(row.get("created_at", "")),
        )
