# Development guide

## Changing features

1. Add/change validated request shapes in `backend/moe/schemas.py`.
2. Keep HTTP access checks in the relevant `api` resource. Use `authorize`/`get_room`/`get_run` for every workspace-scoped action.
3. Keep scheduling and durable state in `services/orchestration.py`; keep provider formats in `providers/client.py`.
4. Update typed frontend transport/domain fields and the relevant feature component.
5. Generate an Alembic revision for model changes, then inspect and test it against PostgreSQL.
6. Add tests for security or failure behavior introduced by the change.

Do not return ORM connection records directly: use `public_connection`, which removes ciphertext. Never add provider keys to run snapshots, logs, exports, local storage, or generated URLs.

## Formatting and checks

```bash
cd backend
../.venv/bin/ruff check . --fix
../.venv/bin/ruff format .
../.venv/bin/python -m pytest -q
cd ../frontend
npm run format
npm run build
```

Runtime packages are constrained in `backend/requirements.lock`, and frontend dependencies use `package-lock.json`. Commit dependency changes with their lock files.

## Browser workflow test

Build the frontend, then start the app with a fresh test data directory and the mock provider in separate terminals:

```bash
cd frontend
npm ci
npm run build
npx playwright install chromium
cd ../backend
MOE_DATA_DIR=../.e2e-data DATABASE_URL=sqlite:///../.e2e-data/moe.db MOE_ALLOW_REGISTRATION=true ../.venv/bin/uvicorn moe.main:app --host 127.0.0.1 --port 8000
```

```bash
python backend/tests/e2e_provider.py
```

```bash
cd frontend
npm run test:e2e
```

Tests create an account, add a native Ollama-compatible mock connection, configure a room, stream two agent turns, verify reported usage, reload persisted history, and check the mobile layout. They use no real model credentials. Use an isolated database; do not set open registration on an existing public deployment.

Set `MOE_TEST_DATABASE_URL` to an isolated PostgreSQL test database to run backend tests against it. Tests drop/recreate tables between cases: **never point this variable at a production database**.
