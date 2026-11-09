from typing import Optional
from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: str = Field(..., min_length=5, max_length=150)
    username: str = Field(..., min_length=4, max_length=80)
    password: str = Field(..., min_length=8, max_length=128)


class VerifyOtpRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=150)
    otp_code: str = Field(..., min_length=6, max_length=6)


class ResendOtpRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=150)


class LoginRequest(BaseModel):
    identifier: str = Field(..., min_length=3, max_length=150)
    password: str = Field(..., min_length=1, max_length=128)


class AuthResponse(BaseModel):
    success: bool
    message: str
    access_token: Optional[str] = None
    user: Optional[dict] = None
