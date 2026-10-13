import hashlib
import hmac
import os
import secrets
import time

from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request

from .models import Audit, Membership, Session, User


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(value: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(value.encode(), salt=salt, n=16384, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(value: str, encoded: str) -> bool:
    try:
        _, salt, digest = encoded.split("$")
        actual = hashlib.scrypt(
            value.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1
        )
        return hmac.compare_digest(actual.hex(), digest)
    except (ValueError, TypeError):
        return False


class SecretStore:
    def __init__(self, settings):
        key = settings.encryption_key
        if not key:
            path = settings.data_dir / ".encryption-key"
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(fd, "wb") as file:
                    file.write(Fernet.generate_key())
            except FileExistsError:
                pass
            key = path.read_text().strip()
        self.cipher = Fernet(key.encode())

    def encrypt(self, value: str):
        return self.cipher.encrypt(value.encode()).decode() if value else ""

    def decrypt(self, value: str):
        return self.cipher.decrypt(value.encode()).decode() if value else ""


def database(request: Request):
    with request.app.state.sessions() as session:
        yield session


def authenticated(request: Request, db=Depends(database)):
    raw = request.cookies.get(request.app.state.settings.cookie_name)
    record = db.get(Session, token_hash(raw)) if raw else None
    if not record or record.expires_at < time.time():
        raise HTTPException(401, "Sign in to continue")
    user = db.get(User, record.user_id)
    if not user:
        raise HTTPException(401, "Invalid session")
    return user


def authorize(db, user, workspace_id, write=False, owner=False):
    member = db.get(Membership, (workspace_id, user.id))
    if not member:
        raise HTTPException(404, "Workspace not found")
    if owner and member.role != "owner":
        raise HTTPException(403, "Workspace owner access required")
    if write and member.role == "viewer":
        raise HTTPException(403, "Viewer access is read-only")
    return member


def audit(db, workspace_id, user, action, resource_id):
    db.add(
        Audit(
            workspace_id=workspace_id,
            actor_id=user.id,
            action=action,
            resource_id=resource_id,
        )
    )


def public_row(row, exclude=()):
    return {
        column.name: getattr(row, column.name)
        for column in row.__table__.columns
        if column.name not in exclude
    }


def public_connection(row):
    return {**public_row(row, {"encrypted_key"}), "has_key": bool(row.encrypted_key)}
