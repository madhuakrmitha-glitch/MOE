import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update

from ..models import Agent, Connection, Message, Room, Run
from ..schemas import RoomCreate, RoomInput
from ..security import audit, authenticated, authorize, database, public_row

router = APIRouter(tags=["rooms"])
ACTIVE = {"queued", "running", "cancel_requested"}


def get_room(db, user, room_id, write=False):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(404, "Room not found")
    authorize(db, user, room.workspace_id, write=write)
    return room


def room_detail(db, room):
    return {
        **public_row(room),
        "agents": [
            public_row(agent)
            for agent in db.scalars(
                select(Agent).where(Agent.room_id == room.id).order_by(Agent.position)
            )
        ],
        "messages": [
            public_row(message)
            for message in db.scalars(
                select(Message)
                .where(Message.room_id == room.id)
                .order_by(Message.sequence.desc())
                .limit(250)
            )
        ][::-1],
        "runs": [
            public_row(run, {"snapshot", "lease_token", "lease_expires"})
            for run in db.scalars(
                select(Run)
                .where(Run.room_id == room.id)
                .order_by(Run.created_at.desc())
                .limit(20)
            )
        ],
    }


@router.get("/workspaces/{workspace_id}/rooms")
def list_rooms(workspace_id: str, db=Depends(database), user=Depends(authenticated)):
    authorize(db, user, workspace_id)
    return [
        public_row(room)
        for room in db.scalars(
            select(Room)
            .where(Room.workspace_id == workspace_id)
            .order_by(Room.updated_at.desc())
        )
    ]


@router.post("/workspaces/{workspace_id}/rooms", status_code=201)
def create(
    workspace_id: str,
    data: RoomCreate,
    db=Depends(database),
    user=Depends(authenticated),
):
    authorize(db, user, workspace_id, write=True)
    room = Room(workspace_id=workspace_id, title=data.title)
    db.add(room)
    db.flush()
    audit(db, workspace_id, user, "room.created", room.id)
    db.commit()
    return room_detail(db, room)


@router.get("/rooms/{room_id}")
def detail(room_id: str, db=Depends(database), user=Depends(authenticated)):
    return room_detail(db, get_room(db, user, room_id))


@router.put("/rooms/{room_id}")
def edit(
    room_id: str, data: RoomInput, db=Depends(database), user=Depends(authenticated)
):
    room = get_room(db, user, room_id, write=True)
    connections = set(
        db.scalars(
            select(Connection.id).where(Connection.workspace_id == room.workspace_id)
        )
    )
    if any(agent.connection_id not in connections for agent in data.agents):
        raise HTTPException(422, "Agent references a connection outside this workspace")
    ids = [agent.id for agent in data.agents if agent.id]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "Agent IDs must be unique")
    existing = set(db.scalars(select(Agent.id).where(Agent.room_id == room_id)))
    for agent_id in ids:
        other = db.get(Agent, agent_id)
        if other and agent_id not in existing:
            raise HTTPException(422, "Agent belongs to another room")
    if data.mode == "moderated" and data.moderator_id not in [
        agent.id for agent in data.agents if agent.enabled
    ]:
        raise HTTPException(422, "Choose an enabled moderator agent")
    values = data.model_dump(exclude={"revision", "agents"})
    result = db.execute(
        update(Room)
        .where(Room.id == room_id, Room.revision == data.revision)
        .values(**values, revision=data.revision + 1, updated_at=time.time())
    )
    if not result.rowcount:
        db.rollback()
        raise HTTPException(
            409, "Room was changed by another user. Reload before saving."
        )
    # Update in place; existing agent identities survive configuration edits.
    for position, agent_input in enumerate(data.agents):
        agent = db.get(Agent, agent_input.id) if agent_input.id else None
        if not agent:
            agent = Agent(room_id=room_id, **agent_input.model_dump(exclude={"id"}))
            if agent_input.id:
                agent.id = agent_input.id
            db.add(agent)
        else:
            for key, value in agent_input.model_dump(exclude={"id"}).items():
                setattr(agent, key, value)
        agent.position = position
    keep = set(ids)
    # Newly created agents without IDs are not yet in `existing` and are retained.
    for agent_id in existing - keep:
        db.delete(db.get(Agent, agent_id))
    audit(db, room.workspace_id, user, "room.updated", room_id)
    db.commit()
    db.expire_all()
    return room_detail(db, db.get(Room, room_id))


@router.delete("/rooms/{room_id}", status_code=204)
def remove(room_id: str, db=Depends(database), user=Depends(authenticated)):
    room = get_room(db, user, room_id, write=True)
    if db.scalar(
        select(Run.id).where(Run.room_id == room_id, Run.status.in_(ACTIVE)).limit(1)
    ):
        raise HTTPException(409, "Stop the active run before deleting this room")
    audit(db, room.workspace_id, user, "room.deleted", room_id)
    db.delete(room)
    db.commit()


@router.get("/rooms/{room_id}/messages")
def history(
    room_id: str,
    before: int | None = None,
    db=Depends(database),
    user=Depends(authenticated),
):
    get_room(db, user, room_id)
    statement = select(Message).where(Message.room_id == room_id)
    if before is not None:
        statement = statement.where(Message.sequence < before)
    return [
        public_row(row)
        for row in db.scalars(statement.order_by(Message.sequence.desc()).limit(100))
    ][::-1]


@router.get("/rooms/{room_id}/export")
def export(room_id: str, db=Depends(database), user=Depends(authenticated)):
    room = get_room(db, user, room_id)
    result = room_detail(db, room)
    result["messages"] = [
        public_row(row)
        for row in db.scalars(
            select(Message).where(Message.room_id == room_id).order_by(Message.sequence)
        )
    ]
    return result
