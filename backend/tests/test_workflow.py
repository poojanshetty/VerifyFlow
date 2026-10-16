import base64
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "workflow.sqlite3"
    monkeypatch.setenv("VERIFYFLOW_DB_PATH", str(database_path))
    monkeypatch.setenv("VERIFYFLOW_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"v" * 32).decode("ascii"))
    monkeypatch.setenv("VERIFYFLOW_TOKEN_SECRET", "t" * 40)
    monkeypatch.setenv("VERIFYFLOW_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("VERIFYFLOW_ADMIN_PASSWORD", "Admin-passphrase-2026")
    with TestClient(app) as test_client:
        yield test_client


def login(client, username, password):
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_user(client, admin_headers, username, role, name):
    response = client.post(
        "/api/users",
        headers=admin_headers,
        json={
            "username": username,
            "password": "User-passphrase-2026",
            "role": role,
            "name": name,
            "aadhaar_last4": "9876",
            "address": "Current address",
            "permanent_address": "Permanent address",
            "work_hours": "09:00-17:00",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_case(client, headers, applicant):
    payload = case_payload(applicant)
    response = client.post("/api/cases", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def case_payload(applicant):
    return {
        "applicant": applicant,
        "phone": "+91 9000000000",
        "email": "applicant@example.test",
        "address": "Current address",
        "permanent_address": "Permanent address",
        "aadhaar_last4": "1234",
        "account_last4": "5678",
        "account_count": 2,
        "other_loans": True,
        "income": "1000000",
        "company": "Example Ltd",
        "bank_credits": "Monthly salary",
    }


def test_roles_scope_cases_and_client_sees_decision_history(client, tmp_path):
    assert client.get("/api/cases").status_code == 401
    admin_headers = login(client, "admin", "Admin-passphrase-2026")
    verifier = create_user(client, admin_headers, "mira", "worker", "Mira Shah")
    bank_one = create_user(client, admin_headers, "bank-one", "bank_client", "Bank One")
    bank_two = create_user(client, admin_headers, "bank-two", "bank_client", "Bank Two")
    forbidden_user = {
        "username": "unauthorized",
        "password": "User-passphrase-2026",
        "role": "worker",
        "name": "Unauthorized",
    }
    assert client.post("/api/users", headers=login(client, "bank-one", "User-passphrase-2026"), json=forbidden_user).status_code == 403

    bank_one_headers = login(client, "bank-one", "User-passphrase-2026")
    bank_two_headers = login(client, "bank-two", "User-passphrase-2026")
    verifier_headers = login(client, "mira", "User-passphrase-2026")
    first_case = create_case(client, bank_one_headers, "Test Applicant")
    second_case = create_case(client, bank_two_headers, "Other Applicant")

    assert client.get(f"/api/cases/{second_case['id']}", headers=bank_one_headers).status_code == 404
    assert client.patch(
        f"/api/cases/{first_case['id']}/assignment",
        headers=admin_headers,
        json={"worker_id": verifier["id"]},
    ).status_code == 200

    upload = client.post(
        f"/api/cases/{first_case['id']}/documents",
        headers=bank_one_headers,
        files={"files": ("statement.pdf", b"synthetic statement", "application/pdf")},
    )
    assert upload.status_code == 201
    document_id = upload.json()["documents"][0]["id"]
    assert client.get(
        f"/api/cases/{first_case['id']}/documents/{document_id}", headers=verifier_headers
    ).content == b"synthetic statement"
    assert {item["id"] for item in client.get("/api/cases", headers=verifier_headers).json()} == {first_case["id"], second_case["id"]}
    assert client.post("/api/cases", headers=verifier_headers, json=case_payload("Not allowed")).status_code == 403

    decision = client.post(
        f"/api/cases/{first_case['id']}/decision",
        headers=verifier_headers,
        json={"status": "Rejected", "comment": "Income documents did not match."},
    )
    assert decision.status_code == 200
    client_view = client.get(f"/api/cases/{first_case['id']}", headers=bank_one_headers).json()
    assert client_view["status"] == "Rejected"
    assert client_view["comment"] == "Income documents did not match."
    assert client_view["verification_history"][0]["verified_by"] == "Mira Shah"
    assert client.get("/api/summary", headers=bank_one_headers).json()["verified"] == 1

    update = client.patch(
        f"/api/users/{bank_two['id']}",
        headers=admin_headers,
        json={
            "username": "bank-two-renamed",
            "name": "Bank Two Updated",
            "aadhaar_last4": "",
            "address": "Updated address",
            "permanent_address": "Updated permanent address",
            "work_hours": "",
        },
    )
    assert update.status_code == 200, update.text
    assert update.json()["name"] == "Bank Two Updated"

    reset = client.post(
        f"/api/users/{bank_two['id']}/password",
        headers=admin_headers,
        json={"password": "Reset-passphrase-2026"},
    )
    assert reset.status_code == 200, reset.text
    assert client.post("/api/auth/login", json={"username": "bank-two-renamed", "password": "Reset-passphrase-2026"}).status_code == 200
    assert client.post("/api/auth/login", json={"username": "bank-two-renamed", "password": "User-passphrase-2026"}).status_code == 401
    assert client.delete(f"/api/users/{bank_two['id']}", headers=admin_headers).status_code == 409

    connection = sqlite3.connect(tmp_path / "workflow.sqlite3")
    stored_details = connection.execute("SELECT details FROM cases WHERE id = ?", (first_case["id"],)).fetchone()[0]
    connection.close()
    assert b"Test Applicant" not in stored_details