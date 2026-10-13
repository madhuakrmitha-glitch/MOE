import os

import pytest
from fastapi.testclient import TestClient

from moe.application import create_app
from moe.config import Settings

PASSWORD = "correct-horse-battery-staple"


@pytest.fixture
def app(tmp_path):
    url = os.getenv("MOE_TEST_DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    if not url.startswith("sqlite"):
        from moe.db import Base, make_database

        engine, _ = make_database(url)
        Base.metadata.drop_all(engine)
        engine.dispose()
    return create_app(
        Settings(
            data_dir=tmp_path,
            database_url=url,
            origins=("http://testserver",),
            allow_registration=True,
            worker_enabled=False,
        )
    )


@pytest.fixture
def client(app):
    with TestClient(app, headers={"Origin": "http://testserver"}) as client:
        yield client


def signup(client, email="owner@example.com", name="Owner", invite=None):
    response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": PASSWORD,
            "name": name,
            "invite_token": invite,
        },
    )
    assert response.status_code == 201, response.text
    return client.get("/api/workspaces").json()[0]["id"]


def setup_room(
    client,
    workspace,
    agents=2,
    mode="round_robin",
    rounds=2,
    max_turns=16,
    failure_policy="continue",
):
    import uuid

    provider = client.post(
        f"/api/workspaces/{workspace}/connections",
        json={
            "name": "Test provider",
            "kind": "openai",
            "base_url": "https://api.openai.com/v1",
            "api_key": "private-test-key",
        },
    ).json()
    room = client.post(
        f"/api/workspaces/{workspace}/rooms", json={"title": "Council"}
    ).json()
    data = {
        "title": "Council",
        "revision": room["revision"],
        "shared_prompt": "Discuss carefully",
        "mode": mode,
        "rounds": rounds,
        "max_turns": max_turns,
        "context_messages": 40,
        "failure_policy": failure_policy,
        "moderator_id": None,
        "agents": [
            {
                "id": str(uuid.uuid4()),
                "name": f"Agent {index}",
                "connection_id": provider["id"],
                "model": "test-model",
                "system_prompt": f"Persona {index}",
                "max_tokens": 128,
            }
            for index in range(agents)
        ],
    }
    if mode == "moderated":
        data["moderator_id"] = data["agents"][0]["id"]
    response = client.put(f"/api/rooms/{room['id']}", json=data)
    assert response.status_code == 200, response.text
    return response.json(), provider
