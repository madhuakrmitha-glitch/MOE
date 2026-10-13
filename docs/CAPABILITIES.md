# Capabilities and remaining rollout gates

## Implemented

| Area | Current behavior |
| --- | --- |
| Persistence | PostgreSQL deployments; SQLite development; Alembic migrations |
| Access | Session sign-in, invitations, workspace isolation, three roles |
| Credentials | Encryption at rest, write-only API key fields, secret replacement/removal |
| Agents | Individual providers/models/prompts, output limits, order and enabled state |
| Policies | Independent, round-robin, validated moderator, targeted reply |
| Reliability | Idempotent submission, single active run per room, durable queue, worker leases, cancellation |
| UX | Streaming and event replay, Markdown, pagination, exports, responsive workspace |
| Administration | Audit records, room revision conflicts, connection tests, readiness routes |
| Verification | Backend integration and adapter tests, browser workflow tests, lint/build CI |

## Explicit limits

- No enterprise SSO, MFA, SCIM, password reset, automated invitation email, or account recovery workflow.
- Invitations are generated as email-bound links; users share them through their own communication channel.
- No attachments, browser tools, image/video generation, RAG, or arbitrary agent tools.
- No cost accounting ledger or provider billing guarantee. Usage is shown only when returned; hard turn/output/runtime limits are enforced.
- Shared conversation context is bounded and may omit older messages. Long-term memory and summarization are not implemented.
- Room configuration snapshots are immutable within a run; an operator can still rotate the referenced connection's credentials.
- SQLite is a local development convenience, not a production concurrency target.
- Human users share workspace rooms; this is not a full WhatsApp-style messaging platform with presence, notifications, or delivery receipts.
- No formal compliance certification, external penetration test, or multi-region failover validation.

This implementation provides a maintainable foundation and critical application controls. Whether it is ready for your enterprise depends on your identity, network, data retention, and operational requirements.
