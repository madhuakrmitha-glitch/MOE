import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from ..models import (
    Bootstrap,
    Invitation,
    LoginAttempt,
    Membership,
    Session,
    User,
    Workspace,
)
from ..schemas import Credentials, Registration
from ..security import (
    authenticated,
    database,
    hash_password,
    token_hash,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["authentication"])
DUMMY_HASH = hash_password("unusable-dummy-password")


def throttle(db, request, email):
    # Database-backed across API replicas. Also enforce edge rate limits in production.
    ip = request.client.host if request.client else "unknown"
    bucket = token_hash(f"{ip}:{email}")
    ip_bucket = token_hash(f"ip:{ip}")
    count = db.scalar(
        select(func.count())
        .select_from(LoginAttempt)
        .where(LoginAttempt.bucket == bucket, LoginAttempt.at > time.time() - 600)
    )
    ip_count = db.scalar(
        select(func.count())
        .select_from(LoginAttempt)
        .where(LoginAttempt.bucket == ip_bucket, LoginAttempt.at > time.time() - 600)
    )
    if count >= 8 or ip_count >= 40:
        raise HTTPException(429, "Too many attempts. Try again in ten minutes.")
    db.execute(delete(LoginAttempt).where(LoginAttempt.at < time.time() - 86400))
    db.add(LoginAttempt(bucket=bucket))
    db.add(LoginAttempt(bucket=ip_bucket))
    db.commit()


def issue_session(request, response, db, user):
    settings = request.app.state.settings
    raw = secrets.token_urlsafe(32)
    db.add(
        Session(
            token_hash=token_hash(raw),
            user_id=user.id,
            expires_at=time.time() + settings.session_seconds,
        )
    )
    db.commit()
    response.set_cookie(
        settings.cookie_name,
        raw,
        max_age=settings.session_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    return {"id": user.id, "email": user.email, "name": user.name}


@router.get("/setup")
def setup(request: Request, db=Depends(database)):
    bootstrap = db.get(Bootstrap, 1)
    return {
        "bootstrap_available": not bootstrap.claimed,
        "registration_open": request.app.state.settings.allow_registration,
    }


@router.post("/register", status_code=201)
def register(
    data: Registration, request: Request, response: Response, db=Depends(database)
):
    throttle(db, request, data.email)
    invitation = None
    if data.invite_token:
        invitation = db.scalar(
            select(Invitation).where(
                Invitation.token_hash == token_hash(data.invite_token),
                Invitation.used.is_(False),
                Invitation.expires_at > time.time(),
            )
        )
        if not invitation or invitation.email != data.email:
            raise HTTPException(
                400, "Invitation is invalid, expired, or belongs to another email"
            )
    first = (
        db.execute(
            update(Bootstrap)
            .where(Bootstrap.id == 1, Bootstrap.claimed.is_(False))
            .values(claimed=True)
        ).rowcount
        == 1
    )
    if (
        not first
        and not invitation
        and not request.app.state.settings.allow_registration
    ):
        db.rollback()
        raise HTTPException(403, "Registration is invitation-only")
    user = User(
        email=data.email, name=data.name, password_hash=hash_password(data.password)
    )
    db.add(user)
    try:
        db.flush()
        if invitation:
            claimed = db.execute(
                update(Invitation)
                .where(Invitation.id == invitation.id, Invitation.used.is_(False))
                .values(used=True)
            ).rowcount
            if not claimed:
                raise HTTPException(409, "Invitation already used")
            db.add(
                Membership(
                    workspace_id=invitation.workspace_id,
                    user_id=user.id,
                    role=invitation.role,
                )
            )
        else:
            workspace = Workspace(name=f"{user.name}'s workspace")
            db.add(workspace)
            db.flush()
            db.add(Membership(workspace_id=workspace.id, user_id=user.id, role="owner"))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Account already exists") from None
    return issue_session(request, response, db, user)


@router.post("/login")
def login(
    data: Credentials, request: Request, response: Response, db=Depends(database)
):
    throttle(db, request, data.email)
    user = db.scalar(select(User).where(User.email == data.email))
    valid = verify_password(data.password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid:
        raise HTTPException(401, "Email or password is incorrect")
    return issue_session(request, response, db, user)


@router.get("/me")
def me(user=Depends(authenticated)):
    return {"id": user.id, "email": user.email, "name": user.name}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db=Depends(database)):
    raw = request.cookies.get(request.app.state.settings.cookie_name)
    if raw:
        db.execute(delete(Session).where(Session.token_hash == token_hash(raw)))
        db.commit()
    response.delete_cookie(request.app.state.settings.cookie_name, path="/")
