from conftest import PASSWORD, setup_room, signup
from fastapi.testclient import TestClient

from moe.models import Connection
from moe.security import hash_password, verify_password


def test_credentials_encrypted_and_never_serialized(client, app):
    workspace = signup(client)
    room, provider = setup_room(client, workspace)
    assert provider["has_key"]
    assert "private-test-key" not in str(provider)
    with app.state.sessions() as db:
        stored = db.get(Connection, provider["id"])
        assert stored.encrypted_key != "private-test-key"
        assert app.state.secrets.decrypt(stored.encrypted_key) == "private-test-key"
    listing = client.get(f"/api/workspaces/{workspace}/connections")
    assert (
        "encrypted_key" not in listing.text and "private-test-key" not in listing.text
    )
    payload = {
        "name": "Rotated",
        "kind": "openai",
        "base_url": provider["base_url"],
        "api_key": None,
    }
    assert client.put(f"/api/connections/{provider['id']}", json=payload).json()[
        "has_key"
    ]
    payload["api_key"] = ""
    assert not client.put(f"/api/connections/{provider['id']}", json=payload).json()[
        "has_key"
    ]


def test_auth_origin_and_workspace_isolation(client, app):
    workspace = signup(client)
    room, _ = setup_room(client, workspace)
    with TestClient(app, headers={"Origin": "http://testserver"}) as stranger:
        assert stranger.get(f"/api/rooms/{room['id']}").status_code == 401
        signup(stranger, "stranger@example.com")
        assert stranger.get(f"/api/rooms/{room['id']}").status_code == 404
        assert (
            stranger.get(f"/api/workspaces/{workspace}/connections").status_code == 404
        )
    assert (
        client.post(
            f"/api/workspaces/{workspace}/rooms",
            json={"title": "CSRF"},
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )


def test_invites_and_viewer_permissions(client, app):
    workspace = signup(client)
    room, _ = setup_room(client, workspace)
    invite = client.post(
        f"/api/workspaces/{workspace}/invites",
        json={"email": "viewer@example.com", "role": "viewer"},
    ).json()
    with TestClient(app, headers={"Origin": "http://testserver"}) as viewer:
        target = signup(viewer, "viewer@example.com", invite=invite["token"])
        assert target == workspace
        assert viewer.get(f"/api/rooms/{room['id']}").status_code == 200
        assert (
            viewer.post(
                f"/api/workspaces/{workspace}/rooms", json={"title": "Forbidden"}
            ).status_code
            == 403
        )
        assert (
            viewer.post(
                f"/api/rooms/{room['id']}/runs", json={"text": "Hi", "request_id": "1"}
            ).status_code
            == 403
        )
        assert viewer.get(f"/api/workspaces/{workspace}/audit").status_code == 403
        assert viewer.post(f"/api/invites/{invite['token']}/accept").status_code == 200
    owner = client.get("/api/auth/me").json()
    assert (
        client.patch(
            f"/api/workspaces/{workspace}/members/{owner['id']}",
            json={"role": "viewer"},
        ).status_code
        == 409
    )


def test_allowlist_and_optimistic_concurrency(client):
    workspace = signup(client)
    response = client.post(
        f"/api/workspaces/{workspace}/connections",
        json={"name": "Unsafe", "kind": "openai", "base_url": "http://169.254.169.254"},
    )
    assert response.status_code == 422
    room, _ = setup_room(client, workspace)
    fields = [
        "title",
        "revision",
        "shared_prompt",
        "mode",
        "rounds",
        "max_turns",
        "context_messages",
        "failure_policy",
        "moderator_id",
    ]
    update = {field: room[field] for field in fields}
    update["agents"] = []
    assert client.put(f"/api/rooms/{room['id']}", json=update).status_code == 200
    assert client.put(f"/api/rooms/{room['id']}", json=update).status_code == 409


def test_password_and_session_revocation(client):
    hashed = hash_password(PASSWORD)
    assert verify_password(PASSWORD, hashed) and not verify_password("wrong", hashed)
    signup(client)
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_production_registration_default_is_closed(client, app):
    app.state.settings.allow_registration = False
    signup(client)
    assert (
        client.post(
            "/api/auth/register",
            json={
                "email": "second@example.com",
                "password": PASSWORD,
                "name": "Second",
            },
        ).status_code
        == 403
    )
