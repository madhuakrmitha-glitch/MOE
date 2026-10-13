import secrets
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update

from ..models import Audit, Invitation, Membership, User, Workspace
from ..schemas import InviteInput, MembershipInput
from ..security import audit, authenticated, authorize, database, public_row, token_hash

router = APIRouter(tags=["workspaces"])


@router.get("/workspaces")
def workspaces(db=Depends(database), user=Depends(authenticated)):
    rows = db.execute(
        select(Workspace, Membership.role)
        .join(Membership, Workspace.id == Membership.workspace_id)
        .where(Membership.user_id == user.id)
    ).all()
    return [{**public_row(workspace), "role": role} for workspace, role in rows]


@router.get("/workspaces/{workspace_id}/members")
def members(workspace_id: str, db=Depends(database), user=Depends(authenticated)):
    authorize(db, user, workspace_id)
    rows = db.execute(
        select(User, Membership.role)
        .join(Membership, User.id == Membership.user_id)
        .where(Membership.workspace_id == workspace_id)
    ).all()
    return [
        {"id": person.id, "name": person.name, "email": person.email, "role": role}
        for person, role in rows
    ]


@router.post("/workspaces/{workspace_id}/invites", status_code=201)
def invite(
    workspace_id: str,
    data: InviteInput,
    db=Depends(database),
    user=Depends(authenticated),
):
    authorize(db, user, workspace_id, owner=True)
    raw = secrets.token_urlsafe(32)
    record = Invitation(
        workspace_id=workspace_id,
        token_hash=token_hash(raw),
        email=data.email,
        role=data.role,
        expires_at=time.time() + 86400 * 3,
    )
    db.add(record)
    db.flush()
    audit(db, workspace_id, user, "invitation.created", record.id)
    db.commit()
    return {"token": raw, "expires_at": record.expires_at}


@router.post("/invites/{token}/accept")
def accept(token: str, db=Depends(database), user=Depends(authenticated)):
    record = db.scalar(
        select(Invitation).where(
            Invitation.token_hash == token_hash(token),
            Invitation.expires_at > time.time(),
        )
    )
    if not record or record.email != user.email:
        raise HTTPException(400, "Invitation is invalid or belongs to another email")
    if record.used and db.get(Membership, (record.workspace_id, user.id)):
        return {"workspace_id": record.workspace_id}
    if not db.execute(
        update(Invitation)
        .where(Invitation.id == record.id, Invitation.used.is_(False))
        .values(used=True)
    ).rowcount:
        raise HTTPException(409, "Invitation already used")
    member = db.get(Membership, (record.workspace_id, user.id))
    if not member:
        db.add(
            Membership(
                workspace_id=record.workspace_id, user_id=user.id, role=record.role
            )
        )
    audit(db, record.workspace_id, user, "invitation.accepted", record.id)
    db.commit()
    return {"workspace_id": record.workspace_id}


@router.patch("/workspaces/{workspace_id}/members/{member_id}")
def change_role(
    workspace_id: str,
    member_id: str,
    data: MembershipInput,
    db=Depends(database),
    user=Depends(authenticated),
):
    authorize(db, user, workspace_id, owner=True)
    # Serialize role changes on the workspace, so two owners cannot demote one another concurrently.
    db.scalar(select(Workspace).where(Workspace.id == workspace_id).with_for_update())
    member = db.get(Membership, (workspace_id, member_id))
    if not member:
        raise HTTPException(404, "Member not found")
    owners = db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.workspace_id == workspace_id, Membership.role == "owner")
    )
    if member.role == "owner" and data.role != "owner" and owners <= 1:
        raise HTTPException(409, "Keep at least one workspace owner")
    member.role = data.role
    audit(db, workspace_id, user, "membership.role_changed", member_id)
    db.commit()
    return {"role": member.role}


@router.get("/workspaces/{workspace_id}/audit")
def audit_events(workspace_id: str, db=Depends(database), user=Depends(authenticated)):
    authorize(db, user, workspace_id, owner=True)
    return [
        public_row(row)
        for row in db.scalars(
            select(Audit)
            .where(Audit.workspace_id == workspace_id)
            .order_by(Audit.created_at.desc())
            .limit(100)
        )
    ]
