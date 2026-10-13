import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .storage import get_connection


bearer = HTTPBearer(auto_error=False)


def _secret() -> bytes:
    secret = os.environ.get("VERIFYFLOW_TOKEN_SECRET", "").encode("utf-8")
    if len(secret) < 32:
        raise RuntimeError("Set VERIFYFLOW_TOKEN_SECRET to a random value with at least 32 characters.")
    return secret


def _encode_segment(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def create_access_token(user_id: str) -> str:
    now = int(time.time())
    header = _encode_segment(b'{"alg":"HS256","typ":"JWT"}')
    payload = _encode_segment(json.dumps({"sub": user_id, "iat": now, "exp": now + 8 * 60 * 60}).encode("utf-8"))
    message = f"{header}.{payload}".encode("ascii")
    signature = _encode_segment(hmac.new(_secret(), message, hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def _decode_access_token(token: str) -> str:
    try:
        header, payload, signature = token.split(".")
        message = f"{header}.{payload}".encode("ascii")
        expected = _encode_segment(hmac.new(_secret(), message, hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid signature")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if claims["exp"] < time.time():
            raise ValueError("Expired token")
        return claims["sub"]
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=401, detail="Invalid or expired login session") from error


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    user_id = _decode_access_token(credentials.credentials)
    with get_connection() as connection:
        user = connection.execute("SELECT id, username, role FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    return dict(user)


def require_role(user: dict, *roles: str) -> None:
    if user["role"] not in roles:
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action")