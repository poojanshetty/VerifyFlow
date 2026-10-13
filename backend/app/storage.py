import base64
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


DEFAULT_DATABASE = Path(__file__).resolve().parents[1] / "verifyflow.sqlite3"


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    database_path = os.environ.get("VERIFYFLOW_DB_PATH", str(DEFAULT_DATABASE))
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'bank_client', 'worker')),
                profile BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY,
                reference TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                assignee TEXT NOT NULL DEFAULT 'Unassigned',
                assigned_worker_id TEXT REFERENCES users(id),
                bank_client_id TEXT REFERENCES users(id),
                details BLOB NOT NULL,
                review_note BLOB NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                metadata BLOB NOT NULL,
                content BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS decision_events (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                actor_id TEXT NOT NULL REFERENCES users(id),
                status TEXT NOT NULL,
                comment BLOB NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        case_columns = {row["name"] for row in connection.execute("PRAGMA table_info(cases)")}
        if "assigned_worker_id" not in case_columns:
            connection.execute("ALTER TABLE cases ADD COLUMN assigned_worker_id TEXT REFERENCES users(id)")
        if "bank_client_id" not in case_columns:
            connection.execute("ALTER TABLE cases ADD COLUMN bank_client_id TEXT REFERENCES users(id)")
        admin_username = os.environ.get("VERIFYFLOW_ADMIN_USERNAME")
        admin_password = os.environ.get("VERIFYFLOW_ADMIN_PASSWORD")
        if not admin_username or not admin_password:
            raise RuntimeError("Set VERIFYFLOW_ADMIN_USERNAME and VERIFYFLOW_ADMIN_PASSWORD before starting the API.")
        if connection.execute("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").fetchone() is None:
            import secrets

            admin_id = "admin-" + secrets.token_urlsafe(12)
            profile = encrypt_json({"name": "System administrator"}, f"user:{admin_id}:profile")
            connection.execute(
                "INSERT INTO users (id, username, password_hash, role, profile) VALUES (?, ?, ?, 'admin', ?)",
                (admin_id, admin_username, hash_password(admin_password), profile),
            )


def _cipher() -> AESGCM:
    encoded_key = os.environ.get("VERIFYFLOW_ENCRYPTION_KEY")
    if not encoded_key:
        raise RuntimeError("Set VERIFYFLOW_ENCRYPTION_KEY to a base64-encoded 32-byte key.")
    try:
        key = base64.urlsafe_b64decode(encoded_key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as error:
        raise RuntimeError("VERIFYFLOW_ENCRYPTION_KEY must be valid URL-safe base64.") from error
    if len(key) != 32:
        raise RuntimeError("VERIFYFLOW_ENCRYPTION_KEY must decode to exactly 32 bytes.")
    return AESGCM(key)


def encrypt_bytes(value: bytes, context: str) -> bytes:
    import secrets

    nonce = secrets.token_bytes(12)
    return nonce + _cipher().encrypt(nonce, value, context.encode("utf-8"))


def decrypt_bytes(value: bytes, context: str) -> bytes:
    return _cipher().decrypt(value[:12], value[12:], context.encode("utf-8"))


def encrypt_json(value: object, context: str) -> bytes:
    return encrypt_bytes(json.dumps(value, separators=(",", ":")).encode("utf-8"), context)


def decrypt_json(value: bytes, context: str) -> object:
    return json.loads(decrypt_bytes(value, context).decode("utf-8"))


def hash_password(password: str) -> str:
    import hashlib
    import secrets

    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return f"pbkdf2_sha256${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, encoded: str) -> bool:
    import hashlib
    import hmac

    try:
        algorithm, salt_text, digest_text = encoded.split("$", 2)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text)
        expected = base64.urlsafe_b64decode(digest_text)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return hmac.compare_digest(actual, expected)