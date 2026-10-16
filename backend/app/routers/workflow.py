from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from ..schemas.workflow import (
    AssignmentCreate,
    CaseCreate,
    CaseUpdate,
    DecisionCreate,
    LoginRequest,
    UserCreate,
    UserPasswordReset,
    UserUpdate,
)
from ..security import create_access_token, current_user, require_role
from ..storage import decrypt_bytes, decrypt_json, encrypt_bytes, encrypt_json, get_connection, hash_password, verify_password


router = APIRouter(prefix="/api", tags=["workflow"])
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}


def _case_query(connection, case_id: str):
    return connection.execute(
        """SELECT cases.*, users.username AS verifier_name
           FROM cases LEFT JOIN users ON users.id = cases.assigned_worker_id
           WHERE cases.id = ?""",
        (case_id,),
    ).fetchone()


def _case_result(connection, row):
    case_id = row["id"]
    documents = connection.execute("SELECT id, metadata FROM documents WHERE case_id = ?", (case_id,)).fetchall()
    events = connection.execute(
        """SELECT decision_events.id, decision_events.status, decision_events.comment,
                  decision_events.created_at, users.id AS verifier_id, users.username, users.profile
           FROM decision_events JOIN users ON users.id = decision_events.actor_id
           WHERE decision_events.case_id = ? ORDER BY decision_events.created_at""",
        (case_id,),
    ).fetchall()
    history = [
        {
            "status": event["status"],
            "comment": decrypt_bytes(event["comment"], f"event:{event['id']}:comment").decode("utf-8"),
            "verified_by": decrypt_json(event["profile"], f"user:{event['verifier_id']}:profile").get("name", event["username"]),
            "created_at": event["created_at"],
        }
        for event in events
    ]
    return {
        "id": case_id,
        "reference": row["reference"],
        "status": row["status"],
        "assignee": row["verifier_name"] or "Unassigned",
        "assigned_worker_id": row["assigned_worker_id"],
        "details": decrypt_json(row["details"], f"case:{case_id}:details"),
        "comment": decrypt_bytes(row["review_note"], f"case:{case_id}:review").decode("utf-8"),
        "created_at": row["created_at"],
        "documents": [decrypt_json(document["metadata"], f"document:{document['id']}:metadata") for document in documents],
        "verification_history": history,
        "verified_by": history[-1]["verified_by"] if history else None,
    }


def _get_case(connection, case_id: str, user: dict):
    row = _case_query(connection, case_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Application not found")
    if user["role"] == "bank_client" and row["bank_client_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Application not found")
    if user["role"] == "worker" and row["assigned_worker_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Application not found")
    return row


def _assign_to_least_loaded_worker(connection, case_id: str) -> None:
    worker = connection.execute(
        """SELECT users.id, users.username
           FROM users
           LEFT JOIN cases ON cases.assigned_worker_id = users.id AND cases.status = 'In review'
           WHERE users.role = 'worker'
           GROUP BY users.id, users.username
           ORDER BY COUNT(cases.id), users.username, users.id
           LIMIT 1"""
    ).fetchone()
    if worker is not None:
        connection.execute(
            "UPDATE cases SET assigned_worker_id = ?, assignee = ? WHERE id = ? AND assigned_worker_id IS NULL",
            (worker["id"], worker["username"], case_id),
        )


def _assign_unassigned_cases(connection) -> None:
    cases = connection.execute(
        "SELECT id FROM cases WHERE assigned_worker_id IS NULL AND status = 'In review' ORDER BY created_at, id"
    ).fetchall()
    for row in cases:
        _assign_to_least_loaded_worker(connection, row["id"])


def assign_unassigned_cases_on_startup() -> None:
    with get_connection() as connection:
        _assign_unassigned_cases(connection)


@router.post("/auth/login")
def login(payload: LoginRequest):
    with get_connection() as connection:
        user = connection.execute("SELECT * FROM users WHERE username = ?", (payload.username,)).fetchone()
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Username or password is incorrect")
    user_info = {"id": user["id"], "username": user["username"], "role": user["role"]}
    return {"access_token": create_access_token(user["id"]), "token_type": "bearer", "user": user_info}


@router.get("/auth/me")
def get_me(user: dict = Depends(current_user)):
    return user


@router.post("/users", status_code=201)
def create_user(payload: UserCreate, admin: dict = Depends(current_user)):
    require_role(admin, "admin")
    user_id = str(uuid4())
    profile = payload.model_dump(exclude={"password", "username", "role"})
    with get_connection() as connection:
        try:
            connection.execute(
                "INSERT INTO users (id, username, password_hash, role, profile) VALUES (?, ?, ?, ?, ?)",
                (user_id, payload.username, hash_password(payload.password), payload.role, encrypt_json(profile, f"user:{user_id}:profile")),
            )
        except Exception as error:
            if "UNIQUE constraint failed" in str(error) or getattr(error, "sqlstate", None) == "23505":
                raise HTTPException(status_code=409, detail="Username is already in use") from error
            raise
        if payload.role == "worker":
            _assign_unassigned_cases(connection)
    return {"id": user_id, "username": payload.username, "role": payload.role, **profile}


@router.get("/users")
def list_users(admin: dict = Depends(current_user)):
    require_role(admin, "admin")
    with get_connection() as connection:
        rows = connection.execute("SELECT id, username, role, profile FROM users WHERE role != 'admin' ORDER BY username").fetchall()
        return [
            {"id": row["id"], "username": row["username"], "role": row["role"], **decrypt_json(row["profile"], f"user:{row['id']}:profile")}
            for row in rows
        ]


def _get_manageable_user(connection, user_id: str):
    row = connection.execute("SELECT * FROM users WHERE id = ? AND role != 'admin'", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return row


def _user_result(row):
    return {"id": row["id"], "username": row["username"], "role": row["role"], **decrypt_json(row["profile"], f"user:{row['id']}:profile")}


@router.patch("/users/{user_id}")
def update_user(user_id: str, payload: UserUpdate, admin: dict = Depends(current_user)):
    require_role(admin, "admin")
    profile = payload.model_dump(exclude={"username"})
    with get_connection() as connection:
        row = _get_manageable_user(connection, user_id)
        existing_username = connection.execute("SELECT 1 FROM users WHERE username = ? AND id != ?", (payload.username, user_id)).fetchone()
        if existing_username is not None:
            raise HTTPException(status_code=409, detail="Username is already in use")
        connection.execute(
            "UPDATE users SET username = ?, profile = ? WHERE id = ?",
            (payload.username, encrypt_json(profile, f"user:{user_id}:profile"), user_id),
        )
        if row["role"] == "worker":
            connection.execute("UPDATE cases SET assignee = ? WHERE assigned_worker_id = ?", (payload.username, user_id))
        updated = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user_result(updated)


@router.post("/users/{user_id}/password")
def reset_user_password(user_id: str, payload: UserPasswordReset, admin: dict = Depends(current_user)):
    require_role(admin, "admin")
    with get_connection() as connection:
        _get_manageable_user(connection, user_id)
        connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(payload.password), user_id))
    return {"message": "Password updated"}


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, admin: dict = Depends(current_user)):
    require_role(admin, "admin")
    with get_connection() as connection:
        row = _get_manageable_user(connection, user_id)
        linked_cases = connection.execute(
            "SELECT 1 FROM cases WHERE bank_client_id = ? OR assigned_worker_id = ? LIMIT 1",
            (user_id, user_id),
        ).fetchone()
        decision_history = connection.execute("SELECT 1 FROM decision_events WHERE actor_id = ? LIMIT 1", (user_id,)).fetchone()
        if linked_cases is not None or decision_history is not None:
            raise HTTPException(
                status_code=409,
                detail="This account is linked to case history. Reassign or archive its cases before deleting the account.",
            )
        connection.execute("DELETE FROM users WHERE id = ?", (row["id"],))


@router.get("/cases")
def list_cases(user: dict = Depends(current_user)):
    with get_connection() as connection:
        if user["role"] == "bank_client":
            rows = connection.execute("SELECT id FROM cases WHERE bank_client_id = ? ORDER BY created_at DESC", (user["id"],)).fetchall()
        elif user["role"] == "worker":
            rows = connection.execute("SELECT id FROM cases WHERE assigned_worker_id = ? ORDER BY created_at DESC", (user["id"],)).fetchall()
        else:
            rows = connection.execute("SELECT id FROM cases ORDER BY created_at DESC").fetchall()
        return [_case_result(connection, _case_query(connection, row["id"])) for row in rows]


@router.get("/summary")
def get_summary(user: dict = Depends(current_user)):
    with get_connection() as connection:
        if user["role"] == "bank_client":
            scope = "bank_client_id = ?"
        elif user["role"] == "worker":
            scope = "assigned_worker_id = ?"
        else:
            scope = "1 = 1"
        params = () if user["role"] == "admin" else (user["id"],)
        counts = connection.execute(
            f"""SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE status IN ('Approved', 'Rejected')) AS verified,
                       COUNT(*) FILTER (WHERE status = 'Approved') AS approved,
                       COUNT(*) FILTER (WHERE status = 'Rejected') AS rejected,
                       COUNT(*) FILTER (WHERE status = 'In review') AS in_review
                   FROM cases WHERE {scope}""",
            params,
        ).fetchone()
        return {key: counts[key] or 0 for key in ("total", "verified", "approved", "rejected", "in_review")}


@router.post("/cases", status_code=201)
def create_case(payload: CaseCreate, user: dict = Depends(current_user)):
    require_role(user, "bank_client")
    case_id = str(uuid4())
    reference = f"VF-{case_id[:8].upper()}"
    created_at = datetime.now(timezone.utc).isoformat()
    with get_connection() as connection:
        connection.execute(
            """INSERT INTO cases (
                   id, reference, status, assignee, assigned_worker_id, bank_client_id,
                   details, review_note, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                case_id,
                reference,
                "In review",
                "Unassigned",
                None,
                user["id"],
                encrypt_json(payload.model_dump(), f"case:{case_id}:details"),
                encrypt_bytes(b"", f"case:{case_id}:review"),
                created_at,
            ),
        )
        _assign_to_least_loaded_worker(connection, case_id)
        return _case_result(connection, _case_query(connection, case_id))


@router.get("/cases/{case_id}")
def get_case(case_id: str, user: dict = Depends(current_user)):
    with get_connection() as connection:
        return _case_result(connection, _get_case(connection, case_id, user))


@router.put("/cases/{case_id}")
def update_case(case_id: str, payload: CaseUpdate, user: dict = Depends(current_user)):
    require_role(user, "bank_client")
    with get_connection() as connection:
        row = _get_case(connection, case_id, user)
        if row["status"] in ("Approved", "Rejected"):
            raise HTTPException(status_code=409, detail="A decided application cannot be edited")
        connection.execute("UPDATE cases SET details = ?, status = 'In review' WHERE id = ?", (encrypt_json(payload.model_dump(), f"case:{case_id}:details"), case_id))
        return _case_result(connection, _case_query(connection, case_id))


@router.post("/cases/{case_id}/documents", status_code=201)
async def upload_documents(case_id: str, files: list[UploadFile] = File(...), user: dict = Depends(current_user)):
    require_role(user, "bank_client")
    if len(files) > 10:
        raise HTTPException(status_code=413, detail="Upload no more than 10 documents at once")
    with get_connection() as connection:
        row = _get_case(connection, case_id, user)
        if row["status"] in ("Approved", "Rejected"):
            raise HTTPException(status_code=409, detail="Documents cannot be added after a decision")
        saved = []
        for file in files:
            if file.content_type not in ALLOWED_CONTENT_TYPES:
                raise HTTPException(status_code=415, detail="Upload a PDF, JPEG, or PNG document")
            content = await file.read(MAX_UPLOAD_BYTES + 1)
            if not content or len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Each document must be between 1 byte and 10 MB")
            document_id = str(uuid4())
            metadata = {"id": document_id, "name": Path(file.filename or "document").name[:180], "content_type": file.content_type}
            connection.execute(
                "INSERT INTO documents (id, case_id, metadata, content) VALUES (?, ?, ?, ?)",
                (document_id, case_id, encrypt_json(metadata, f"document:{document_id}:metadata"), encrypt_bytes(content, f"document:{document_id}:content")),
            )
            saved.append(metadata)
        return {"documents": saved}


@router.get("/cases/{case_id}/documents/{document_id}")
def download_document(case_id: str, document_id: str, user: dict = Depends(current_user)):
    with get_connection() as connection:
        _get_case(connection, case_id, user)
        row = connection.execute("SELECT metadata, content FROM documents WHERE id = ? AND case_id = ?", (document_id, case_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Document not found")
        metadata = decrypt_json(row["metadata"], f"document:{document_id}:metadata")
        content = decrypt_bytes(row["content"], f"document:{document_id}:content")
    return StreamingResponse(BytesIO(content), media_type=metadata["content_type"], headers={"Content-Disposition": f"attachment; filename=\"{metadata['name']}\""})


@router.patch("/cases/{case_id}/assignment")
def assign_case(case_id: str, payload: AssignmentCreate, admin: dict = Depends(current_user)):
    require_role(admin, "admin")
    with get_connection() as connection:
        worker = connection.execute("SELECT id, username FROM users WHERE id = ? AND role = 'worker'", (payload.worker_id,)).fetchone()
        if worker is None:
            raise HTTPException(status_code=404, detail="Worker account not found")
        if _case_query(connection, case_id) is None:
            raise HTTPException(status_code=404, detail="Application not found")
        connection.execute("UPDATE cases SET assigned_worker_id = ?, assignee = ? WHERE id = ?", (worker["id"], worker["username"], case_id))
        return _case_result(connection, _case_query(connection, case_id))


@router.post("/cases/{case_id}/decision")
def record_decision(case_id: str, payload: DecisionCreate, user: dict = Depends(current_user)):
    require_role(user, "worker")
    with get_connection() as connection:
        row = _get_case(connection, case_id, user)
        if row["status"] != "In review":
            raise HTTPException(status_code=409, detail="This application already has a decision")
        created_at = datetime.now(timezone.utc).isoformat()
        event_id = str(uuid4())
        comment = payload.comment.strip()
        connection.execute(
            "UPDATE cases SET status = ?, review_note = ? WHERE id = ?",
            (payload.status, encrypt_bytes(comment.encode("utf-8"), f"case:{case_id}:review"), case_id),
        )
        connection.execute(
            "INSERT INTO decision_events (id, case_id, actor_id, status, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (event_id, case_id, user["id"], payload.status, encrypt_bytes(comment.encode("utf-8"), f"event:{event_id}:comment"), created_at),
        )
        return _case_result(connection, _case_query(connection, case_id))
