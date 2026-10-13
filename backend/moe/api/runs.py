import asyncio
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from ..models import Agent, Connection, Message, Run, RunEvent
from ..schemas import RunInput
from ..security import audit, authenticated, database, public_row
from ..services.orchestration import TERMINAL, add_event
from .rooms import get_room

router = APIRouter(tags=["runs"])


def get_run(db, user, run_id, write=False):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    get_room(db, user, run.room_id, write=write)
    return run


@router.post("/rooms/{room_id}/runs", status_code=202)
def start(
    room_id: str, data: RunInput, db=Depends(database), user=Depends(authenticated)
):
    room = get_room(db, user, room_id, write=True)
    existing = db.scalar(
        select(Run).where(Run.room_id == room_id, Run.request_id == data.request_id)
    )
    if existing:
        return public_row(existing, {"snapshot", "lease_token", "lease_expires"})
    agents = list(
        db.scalars(
            select(Agent)
            .where(Agent.room_id == room_id, Agent.enabled.is_(True))
            .order_by(Agent.position)
        )
    )
    if not agents:
        raise HTTPException(
            422, "Configure and enable at least one agent before starting"
        )
    if data.target_agent_id and data.target_agent_id not in {
        agent.id for agent in agents
    }:
        raise HTTPException(422, "Target agent is unavailable")
    if room.mode == "moderated" and room.moderator_id not in {
        agent.id for agent in agents
    }:
        raise HTTPException(422, "Configure an enabled moderator")
    provider_ids = {agent.connection_id for agent in agents}
    providers = {
        row.id: public_row(row, {"encrypted_key", "workspace_id", "name", "created_at"})
        for row in db.scalars(
            select(Connection).where(
                Connection.id.in_(provider_ids),
                Connection.workspace_id == room.workspace_id,
            )
        )
    }
    if len(providers) != len(provider_ids):
        raise HTTPException(422, "An agent connection is unavailable")
    history = [
        public_row(message)
        for message in db.scalars(
            select(Message)
            .where(Message.room_id == room_id, Message.role.in_(["user", "agent"]))
            .order_by(Message.sequence.desc())
            .limit(room.context_messages)
        )
    ][::-1]
    history.append({"name": user.name, "content": data.text, "role": "user"})
    snapshot = {
        **public_row(room),
        "agents": [public_row(agent) for agent in agents],
        "connections": providers,
        "history": history,
        "target_agent_id": data.target_agent_id,
        "latest_user_text": data.text,
    }
    run = Run(
        room_id=room_id,
        user_id=user.id,
        request_id=data.request_id,
        input_text=data.text,
        snapshot=snapshot,
    )
    db.add(run)
    try:
        db.flush()
        sequence = (
            db.scalar(
                select(func.max(Message.sequence)).where(Message.room_id == room_id)
            )
            or 0
        ) + 1
        db.add(
            Message(
                room_id=room_id,
                run_id=run.id,
                sequence=sequence,
                role="user",
                name=user.name,
                content=data.text,
            )
        )
        room.updated_at = time.time()
        add_event(db, run.id, "status", {"status": "queued"})
        audit(db, room.workspace_id, user, "run.created", run.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(Run).where(Run.room_id == room_id, Run.request_id == data.request_id)
        )
        if existing:
            return public_row(existing, {"snapshot", "lease_token", "lease_expires"})
        raise HTTPException(409, "This room already has an active run") from None
    return public_row(run, {"snapshot", "lease_token", "lease_expires"})


@router.post("/runs/{run_id}/cancel")
def cancel(run_id: str, db=Depends(database), user=Depends(authenticated)):
    run = get_run(db, user, run_id, write=True)
    if run.status == "queued":
        run.status, run.finished_at = "cancelled", time.time()
        add_event(
            db,
            run_id,
            "terminal",
            {"status": "cancelled", "error": "Stopped before starting"},
        )
    elif run.status == "running":
        run.status = "cancel_requested"
    room = get_room(db, user, run.room_id)
    audit(db, room.workspace_id, user, "run.cancelled", run.id)
    db.commit()
    return {"status": run.status}


@router.get("/runs/{run_id}/events")
async def events(
    run_id: str,
    request: Request,
    after: int = 0,
    db=Depends(database),
    user=Depends(authenticated),
):
    run = get_run(db, user, run_id)
    workspace_id = get_room(db, user, run.room_id).workspace_id
    try:
        cursor = max(after, int(request.headers.get("last-event-id", "0")))
    except ValueError:
        raise HTTPException(400, "Invalid event cursor") from None
    user_id = user.id
    # Release the request dependency's read transaction before beginning a long-lived stream.
    db.rollback()

    async def stream():
        nonlocal cursor
        heartbeat = time.monotonic()
        while not await request.is_disconnected():
            with request.app.state.sessions() as session:
                from ..models import Membership, Session
                from ..security import token_hash

                cookie = request.cookies.get(request.app.state.settings.cookie_name, "")
                auth = session.get(Session, token_hash(cookie))
                if (
                    not auth
                    or auth.expires_at < time.time()
                    or not session.get(Membership, (workspace_id, user_id))
                ):
                    return
                rows = list(
                    session.scalars(
                        select(RunEvent)
                        .where(RunEvent.run_id == run_id, RunEvent.id > cursor)
                        .order_by(RunEvent.id)
                        .limit(100)
                    )
                )
                state = session.get(Run, run_id)
            for event in rows:
                cursor = event.id
                yield f"id: {event.id}\nevent: update\ndata: {json.dumps({'type': event.type, 'data': event.data})}\n\n"
            if state is None:
                return
            if state.status in TERMINAL and not rows:
                yield f"event: update\ndata: {json.dumps({'type': 'terminal', 'data': {'status': state.status, 'error': state.error}})}\n\n"
                return
            if time.monotonic() - heartbeat > 15:
                yield ": heartbeat\n\n"
                heartbeat = time.monotonic()
            await asyncio.sleep(0.2)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
