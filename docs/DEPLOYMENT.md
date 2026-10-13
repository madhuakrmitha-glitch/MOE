# Deployment and operations

## Production configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL using `postgresql+psycopg://...` |
| `MOE_ENCRYPTION_KEY` | Fernet key from your secret manager; required in production |
| `MOE_PRODUCTION=true` | Requires PostgreSQL, a supplied encryption key, and secure cookies |
| `MOE_COOKIE_SECURE=true` | HTTPS-only session cookies |
| `MOE_ORIGINS` | Exact comma-separated public web origins; no wildcard |
| `MOE_PROVIDER_HOSTS` | Exact trusted model endpoint hostnames |
| `MOE_HTTP_PROVIDER_HOSTS` | Hosts explicitly permitted over HTTP; minimize in production |
| `MOE_WORKER_ENABLED=false` | Disable embedded worker when using the worker service |
| `MOE_ALLOW_REGISTRATION=false` | First account bootstrap, then invitations |
| `MOE_FRONTEND_DIR` | Built frontend directory (Docker supplies this) |
| `MOE_DATA_DIR` | Local development files; production credentials use the supplied key |

Terminate HTTPS at a trusted reverse proxy. Preserve Host and SSE connections; disable SSE buffering and caching. Set a proxy read timeout above the 15-minute run limit and enforce request body limits (suggested 1 MB), sign-in rate limits, and concurrent connection limits. Expose `/health/live` and `/health/ready` to your orchestrator, rather than to public metrics systems with secrets.

The compose file binds the API to loopback by default. Put your reverse proxy in front of it or adapt the container network to your platform. `uvicorn --no-access-log` avoids recording invitation token paths. Application logs do not contain prompts or credentials. Configure a JSON log formatter at the hosting platform to retain request IDs, durations, status codes, and worker errors.

## Model endpoint setup

- OpenAI-compatible: supply the actual API base path, e.g. `https://api.openai.com/v1` or your compatible service's base path. Full `/chat/completions` URLs are also accepted.
- Hugging Face router: `https://router.huggingface.co/v1`, a supported Hub model ID, and a token with inference permissions.
- Dedicated Hugging Face endpoints: add the exact endpoint hostname to the allowlist and supply its `/v1` base path. The endpoint must expose OpenAI-compatible chat completions (e.g. TGI). Arbitrary task-specific inference payloads are not supported.
- Ollama: native `/api/chat`; local dev can use `http://localhost:11434`. Inside Docker use an explicitly allowed reachable host such as `host.docker.internal`. Configure Ollama binding and your host firewall appropriately.
- Reasoning models may require `max_completion_tokens` and may not accept temperature. Configure those compatibility options per connection. Streaming token usage can be requested when supported; absence of usage is not treated as zero usage.

Provider connection tests make a small paid request and use saved settings. Connections are workspace resources. Agents can point to distinct connections with distinct credentials; sharing a connection is optional.

## Migrations, scale, and recovery

Run `alembic upgrade head` once as a deployment job before starting API and worker processes. Do not use development auto-schema creation in production. The initial migration seeds first-account bootstrap state. Restrict first bootstrap access using your reverse proxy until the owner account is created.

Scale API instances independently of workers. Each worker processes one room run at a time; independent replies use up to four requests within that run. PostgreSQL is the source of truth and queue, so this version does not require Redis. More workers increase run concurrency. Workspace room runs cannot overlap. Run status and heartbeat expiry should be monitored; a ready API does not prove a worker is processing the queue.

Expired leases are interrupted rather than restarted automatically. Committed response deltas from an unfinished turn are recovered into an incomplete message; the last uncommitted buffer may be lost on an abrupt process kill. Review partial messages, then use **Use prompt again**. This creates a new run and may repeat completed model calls. Request retry before a stream emits text may also incur provider cost if the upstream accepted the request but the network failed; the application cannot guarantee exactly-once provider billing.

## Backup and retention

Back up PostgreSQL **and the encryption key**. Losing the key makes saved credentials unusable; losing database state loses rooms, events, and audit history. Keep versioned secrets in your secret manager and practice restore to a separate environment. Changing the key without re-encrypting existing records is not a supported rotation procedure; credential rotation inside a connection is supported.

Schedule `python -m moe.maintenance` daily. It prunes expired sessions, old authentication attempt buckets, expired invitations, and terminal run events older than 14 days. Conversation messages and audit entries are retained until room/workspace data removal or a separately defined organizational retention policy. Room deletion cascades room history. Establish your organization's retention and offboarding policies before public launch.

## Release gates

Before an organizational rollout: run CI against PostgreSQL, configure HTTPS and network egress controls, test your actual models and endpoint capabilities, test invitation flows, restore backups, review operational limits, and perform an independent security review. SSO/MFA, password recovery, email delivery, and compliance guarantees are not part of this implementation.
