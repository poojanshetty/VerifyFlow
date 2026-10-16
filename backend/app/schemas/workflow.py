from typing import Literal

from pydantic import BaseModel, Field, field_validator


class CaseCreate(BaseModel):
    applicant: str = Field(min_length=1, max_length=120)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=254)
    address: str = Field(default="", max_length=500)
    permanent_address: str = Field(default="", max_length=500)
    aadhaar_last4: str = Field(pattern=r"^\d{4}$")
    account_last4: str = Field(default="", pattern=r"^(\d{4})?$")
    account_count: int = Field(default=1, ge=0, le=50)
    other_loans: bool = False
    income: str = Field(default="", max_length=80)
    company: str = Field(default="", max_length=160)
    bank_credits: str = Field(default="", max_length=500)


class DecisionCreate(BaseModel):
    status: Literal["Approved", "Rejected"]
    comment: str = Field(min_length=3, max_length=2000)

    @field_validator("comment")
    @classmethod
    def require_nonblank_comment(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Comment must contain at least 3 non-whitespace characters")
        return value


class AssignmentCreate(BaseModel):
    worker_id: str = Field(min_length=1, max_length=120)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=120, pattern=r"^[a-zA-Z0-9_.@-]+$")
    password: str = Field(min_length=12, max_length=256)
    role: Literal["bank_client", "worker"]
    name: str = Field(min_length=1, max_length=120)
    aadhaar_last4: str = Field(default="", pattern=r"^(\d{4})?$")
    address: str = Field(default="", max_length=500)
    permanent_address: str = Field(default="", max_length=500)
    work_hours: str = Field(default="", max_length=80)


class UserUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=120, pattern=r"^[a-zA-Z0-9_.@-]+$")
    name: str = Field(min_length=1, max_length=120)
    aadhaar_last4: str = Field(default="", pattern=r"^(\d{4})?$")
    address: str = Field(default="", max_length=500)
    permanent_address: str = Field(default="", max_length=500)
    work_hours: str = Field(default="", max_length=80)


class UserPasswordReset(BaseModel):
    password: str = Field(min_length=12, max_length=256)


class CaseUpdate(CaseCreate):
    pass
