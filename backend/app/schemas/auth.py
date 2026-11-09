from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional

try:
    from pydantic import BaseModel  # type: ignore
except ImportError:
    class BaseModel:  # type: ignore
        def __init__(self, **kwargs: Any) -> None:
            for k, v in kwargs.items():
                setattr(self, k, v)

        def dict(self) -> Dict[str, Any]:
            return self.__dict__.copy()


class RegisterRequest(BaseModel):
    full_name: str = ""
    email: str = ""
    username: str = ""
    password: str = ""


class VerifyOtpRequest(BaseModel):
    email: str = ""
    otp_code: str = ""


class ResendOtpRequest(BaseModel):
    email: str = ""


class LoginRequest(BaseModel):
    identifier: str = ""
    password: str = ""


@dataclass
class AuthResponse:
    success: bool
    message: str
    access_token: Optional[str] = None
    user: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
