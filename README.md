# VerifyFlow

VerifyFlow is a mobile-first case intake, assignment, and verification platform. Loan application review is its first workflow; the product is intended to expand to other structured review processes over time.

> **Prototype warning:** Do not use this build for real Aadhaar, banking, or customer data. It has not had a production security, privacy, or regulatory review.

## Current features

The implemented intake form and applicant data model are currently loan-specific. The account, case assignment, document storage, review decision, and history flows provide a starting point for other workflows, but new workflow forms and rules are not configurable yet.

- Administrator-created bank-client and worker accounts; there is no public registration.
- Bank clients can create and edit their undecided applications, attach PDF/JPEG/PNG documents, and see their own ticket status and review history.
- New cases are automatically assigned to the worker with the fewest open cases. Unassigned open cases are distributed when a worker is added or the API starts.
- Workers can see only cases assigned to their account and record an approval or rejection with a required comment.
- Administrators can view all cases and provisioned users, and reassign a case.
- Bank clients see completed ticket notifications in the app, including ticket number, decision, verifier, and comment. The dashboard refreshes while the user is signed in.

## Architecture

- `mobile/`: Expo / React Native app for Android and web preview.
- `backend/`: FastAPI API with SQLite for local development and PostgreSQL when `DATABASE_URL` is configured.
- Applicant profiles, worker profiles, document metadata and bytes, and review notes are encrypted at rest using AES-GCM. Passwords are salted and hashed.
- Access is enforced by the API: bank clients are scoped to their own cases, workers to assigned cases, and only administrators can provision accounts or assign work.
- The app does not call bank, Aadhaar, OCR, analytics, or push-notification providers. Notifications are in-app polling, not operating-system push notifications.

## Expanding to other workflows

Add future review processes as separate workflow types rather than mixing their fields into the loan form. A configurable workflow should define its intake fields, required documents, status transitions, assignment policy, reviewer actions, and data-retention rules. Keep the existing role checks and per-client/per-worker record scoping on the API for every workflow. The current prototype does not yet include this workflow-definition system; adding it is a planned development step, not an existing feature.

## Local demo setup

Requirements: Python 3.10+, Node.js 20+, and npm.

From the repository root, create a Python environment and install the backend dependencies:

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r backend/requirements.txt
```

Set development secrets in the same terminal that will run the API. Generate new keys for your own local database; retain the same keys whenever reopening that database. Replace the administrator password with a private value of at least 12 characters.

```sh
export VERIFYFLOW_DB_PATH="$PWD/backend/verifyflow.sqlite3"
export VERIFYFLOW_ENCRYPTION_KEY="$(python3 -c 'import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())')"
export VERIFYFLOW_TOKEN_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
export VERIFYFLOW_ADMIN_USERNAME="admin"
export VERIFYFLOW_ADMIN_PASSWORD="replace-with-a-private-password-of-12-or-more-characters"
```

For local development, SQLite is used by default. To connect to a hosted PostgreSQL database instead, set `DATABASE_URL` in the API server environment. Keep the connection URL, database password, encryption key, and token secret in the hosting provider's secret environment settings; never put them in the mobile app, source code, or GitHub. The Supabase publishable key is not used by this API.

Start the API on loopback only:

```sh
python3 -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8001
```

In a second terminal, start the mobile web preview:

```sh
cd mobile
npm install
EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:8001 npm run web
```

Open `http://localhost:8081`. Sign in with the administrator credentials set above, then use **Manage users** to provision worker and bank-client accounts. A local database is created at `backend/verifyflow.sqlite3`; it is ignored by Git. Losing the encryption key means the encrypted records cannot be recovered.

## Render and Supabase demo deployment

The API can be deployed as a Render Python web service using the repository root, build command `pip install -r backend/requirements.txt`, and start command `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`. Add `DATABASE_URL`, `VERIFYFLOW_ENCRYPTION_KEY`, `VERIFYFLOW_TOKEN_SECRET`, `VERIFYFLOW_ADMIN_USERNAME`, and `VERIFYFLOW_ADMIN_PASSWORD` as Render environment variables. Use Supabase's server-side PostgreSQL connection string for `DATABASE_URL` (prefer the pooler URI if the direct database host is not reachable from Render); require SSL. Do not use the publishable key as a database password.

After Render deploys, set the APK's `EXPO_PUBLIC_API_URL` to the Render HTTPS service URL. The existing local SQLite database and demo tickets are not automatically copied to Supabase. Render's free web service can sleep and has ephemeral local storage, so use PostgreSQL for demo persistence and synthetic records only. Free hosting is not production hosting.

## Android APK

The current project is not a client-ready APK. Before distributing one:

1. Deploy the API and database to an approved private environment with HTTPS. The default `127.0.0.1:8001` URL works only on the development computer.
2. Set `EXPO_PUBLIC_API_URL` to the API's reachable HTTPS base URL when building. The Android app rejects plain HTTP for non-local hosts.
3. Set a permanent unique Android application ID in `mobile/app.json`.
4. Build locally with a supported JDK and Android SDK, and sign the APK with a securely backed-up release key.

Expo cloud builds upload project source to Expo. To keep builds local, use the local Android toolchain instead. Never package `.env` files, database files, customer records, or signing keys in the APK or repository.

## Privacy and production readiness

Use synthetic data only until a security and privacy review is complete. Application-level encryption does not by itself guarantee confidentiality. A production deployment also needs managed encryption keys and rotation, HTTPS, MFA, rate limiting, audit-log retention, document malware scanning, encrypted backups, monitoring, access reviews, and an incident-response plan. Confirm applicable Indian privacy, UIDAI, and financial-sector requirements with the organization responsible for the data.

Full Aadhaar numbers are not accepted by the current form; it accepts only the last four digits. Uploaded documents may nevertheless contain full identifiers, so do not upload real documents to this prototype.

## Test

The focused backend workflow test can be run from the repository root:

```sh
PYTHONPATH=. python3 -m pytest backend/tests/test_workflow.py -q
```
