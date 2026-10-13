"""Run scheduled retention without removing conversation history or audit records."""

import time

from sqlalchemy import delete, select

from .config import Settings
from .db import make_database
from .models import Invitation, LoginAttempt, Run, RunEvent, Session
from .services.orchestration import TERMINAL


def prune():
    settings = Settings()
    engine, sessions = make_database(settings.database_url)
    now = time.time()
    with sessions() as db:
        db.execute(delete(Session).where(Session.expires_at < now))
        db.execute(delete(LoginAttempt).where(LoginAttempt.at < now - 86400))
        db.execute(delete(Invitation).where(Invitation.expires_at < now - 86400 * 7))
        old = select(Run.id).where(
            Run.status.in_(TERMINAL), Run.finished_at < now - 86400 * 14
        )
        db.execute(delete(RunEvent).where(RunEvent.run_id.in_(old)))
        db.commit()
    engine.dispose()


if __name__ == "__main__":
    prune()
