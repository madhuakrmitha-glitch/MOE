# MOE — Agent workspace

A full-stack web application for conversations between a user and individually configured AI agents. Agents can use different providers and models while following shared room instructions and their own system prompts.

## Features

- **Accounts and teams:** session-based sign-in, invitations, and owner/member/viewer roles.
- **Secure provider connections:** encrypted credentials, server-side requests, endpoint allowlists, and compatibility controls.
- **Provider support:** OpenAI-compatible APIs, native Ollama, Hugging Face Inference Providers and dedicated TGI endpoints exposing chat completions.
- **Agent configuration:** up to 16 agents, separate models and prompts, personas, enable/pause, ordering, duplication, temperature, and output limits.
- **Discussion patterns:** independent replies, round-robin, or a moderator choosing the next speaker. Target a message to one agent.
- **Reliable execution:** database-backed queue, worker leases, bounded turns/context/runtime, cancellation, partial-response preservation, safe retries, and idempotent submission.
- **Live conversations:** SSE response streaming with reconnect/replay, Markdown, message copying, paginated history, exports, usage and latency when reported.
- **Administration:** version-conflict detection, audit trail, readiness checks, database migrations, retention command, and CI.

## Start locally with Docker

1. Copy `.env.example` to `.env`. Choose a URL-safe PostgreSQL password and generate an encryption key:
   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
   Requires `cryptography` installed, or generate the key after the Python setup below. Keep this key; it is required to decrypt stored provider credentials.
2. Set `MOE_ENCRYPTION_KEY` and `POSTGRES_PASSWORD` in `.env`.
3. Run `docker compose up --build` and open **http://localhost:8000**.
4. Create the first owner account. Add model connections, create a room, and configure its agents.

Docker runs PostgreSQL, a migration job, the API/web server, and a separate worker. Registration is invitation-only after the first account. Workspace owners create invitations under **Team & access**.

## Develop locally

Requires Python 3.12+ and Node 22+.

```bash
python -m venv .venv
# Windows: use .venv\Scripts\python and activate via .venv\Scripts\activate
.venv/bin/pip install -e './backend[test]' -c backend/requirements.lock
cd frontend
npm ci
npm run dev
```

In another terminal, from `backend`:

```bash
../.venv/bin/alembic upgrade head
../.venv/bin/uvicorn moe.main:app --reload --host 127.0.0.1 --port 8000
```

Open **http://localhost:5173**. Vite proxies API traffic; the backend hosts a built frontend in deployments. Development uses SQLite and an embedded worker. Provider calls originate from the server, so browser provider CORS configuration is unnecessary. Set environment variables through your shell or deployment system; the backend does not implicitly load a `.env` file.

## Structure

```text
backend/
  moe/api/             HTTP routes, validation, authorization
  moe/providers/       Vendor transport and streaming adapters
  moe/services/        Durable orchestration and run lifecycle
  moe/models.py        Relational data model
  moe/security.py      Sessions, password hashing, encryption, access checks
  migrations/          Versioned database schema
  tests/               Access, provider, orchestration and browser fixtures
frontend/
  src/components/      Auth, conversations, providers, room settings, team
  src/hooks/           Live room state and SSE lifecycle
  src/api.ts           Typed HTTP boundary
  src/types.ts         Shared frontend domain types
  e2e/                 Browser workflow tests
  src/styles.css       Responsive design system and component styles
docs/                  Architecture, operations, capabilities and limits
```

## Verify changes

```bash
cd backend
../.venv/bin/python -m pytest -q
../.venv/bin/ruff check .
../.venv/bin/ruff format --check .
cd ../frontend
npm run build
npm run format:check
```

See [development and browser tests](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md), and [deployment](docs/DEPLOYMENT.md).

## Deployment scope

This is an enterprise-oriented foundation with implemented access control and durable orchestration. Public deployment requires HTTPS, production settings, a maintained endpoint allowlist, backups, and operational monitoring. SSO/MFA, automated email delivery/password recovery, attachment processing, formal compliance certification, and a dollar-based billing ledger are not implemented. See [capabilities and remaining gates](docs/CAPABILITIES.md).

The original browser-only prototype has been replaced. Its browser-local data is not automatically migrated; export it before switching if needed.
