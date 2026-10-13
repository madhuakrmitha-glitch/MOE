from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from ..models import Agent, Connection
from ..providers.client import ProviderError, generate, validate_endpoint
from ..schemas import ConnectionInput, ConnectionTest
from ..security import audit, authenticated, authorize, database, public_connection

router = APIRouter(tags=["providers"])


def check_url(url, request):
    try:
        return validate_endpoint(url, request.app.state.settings)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None


@router.get("/workspaces/{workspace_id}/connections")
def connections(workspace_id: str, db=Depends(database), user=Depends(authenticated)):
    authorize(db, user, workspace_id)
    return [
        public_connection(row)
        for row in db.scalars(
            select(Connection).where(Connection.workspace_id == workspace_id)
        )
    ]


@router.post("/workspaces/{workspace_id}/connections", status_code=201)
def create(
    workspace_id: str,
    data: ConnectionInput,
    request: Request,
    db=Depends(database),
    user=Depends(authenticated),
):
    authorize(db, user, workspace_id, owner=True)
    values = data.model_dump(exclude={"api_key"})
    values["base_url"] = check_url(data.base_url, request)
    record = Connection(
        workspace_id=workspace_id,
        **values,
        encrypted_key=request.app.state.secrets.encrypt(data.api_key or ""),
    )
    db.add(record)
    db.flush()
    audit(db, workspace_id, user, "connection.created", record.id)
    db.commit()
    return public_connection(record)


@router.put("/connections/{connection_id}")
def edit(
    connection_id: str,
    data: ConnectionInput,
    request: Request,
    db=Depends(database),
    user=Depends(authenticated),
):
    record = db.get(Connection, connection_id)
    if not record:
        raise HTTPException(404, "Connection not found")
    authorize(db, user, record.workspace_id, owner=True)
    for key, value in data.model_dump(exclude={"api_key"}).items():
        setattr(record, key, value)
    record.base_url = check_url(data.base_url, request)
    # null preserves the old secret; an explicit empty string removes it.
    if data.api_key is not None:
        record.encrypted_key = request.app.state.secrets.encrypt(data.api_key)
    audit(db, record.workspace_id, user, "connection.updated", record.id)
    db.commit()
    return public_connection(record)


@router.delete("/connections/{connection_id}", status_code=204)
def remove(connection_id: str, db=Depends(database), user=Depends(authenticated)):
    record = db.get(Connection, connection_id)
    if not record:
        raise HTTPException(404, "Connection not found")
    authorize(db, user, record.workspace_id, owner=True)
    if db.scalar(select(Agent.id).where(Agent.connection_id == connection_id).limit(1)):
        raise HTTPException(
            409, "Remove this connection from agents before deleting it"
        )
    audit(db, record.workspace_id, user, "connection.deleted", record.id)
    db.delete(record)
    db.commit()


@router.post("/connections/{connection_id}/test")
async def test_connection(
    connection_id: str,
    data: ConnectionTest,
    request: Request,
    db=Depends(database),
    user=Depends(authenticated),
):
    record = db.get(Connection, connection_id)
    if not record:
        raise HTTPException(404, "Connection not found")
    authorize(db, user, record.workspace_id, owner=True)
    key = request.app.state.secrets.decrypt(record.encrypted_key)
    agent = {"model": data.model, "temperature": 0, "max_tokens": 32}
    try:
        async for _ in generate(
            record,
            agent,
            [{"role": "user", "content": "Reply with OK."}],
            key,
            request.app.state.settings,
        ):
            pass
    except ProviderError as error:
        raise HTTPException(502, str(error)) from None
    audit(db, record.workspace_id, user, "connection.tested", record.id)
    db.commit()
    return {"status": "ok"}
