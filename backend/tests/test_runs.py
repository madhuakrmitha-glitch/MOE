import asyncio
import json
import time

import pytest
from conftest import setup_room, signup

from moe.models import Run
from moe.providers.client import ProviderError


def start(client, room, request_id="test"):
    response = client.post(
        f"/api/rooms/{room['id']}/runs",
        json={"text": "What should we build?", "request_id": request_id},
    )
    assert response.status_code == 202, response.text
    return response.json()


def test_atomic_submission_and_idempotency(client, app):
    room, _ = setup_room(client, signup(client))
    first = start(client, room)
    assert start(client, room)["id"] == first["id"]
    assert (
        client.post(
            f"/api/rooms/{room['id']}/runs",
            json={"text": "Other", "request_id": "different"},
        ).status_code
        == 409
    )
    detail = client.get(f"/api/rooms/{room['id']}").json()
    assert len(detail["messages"]) == 1
    assert (
        client.post(f"/api/runs/{first['id']}/cancel").json()["status"] == "cancelled"
    )
    assert start(client, room, "next")["id"] != first["id"]


@pytest.mark.asyncio
async def test_round_robin_context_caps_metrics_and_events(client, app, monkeypatch):
    contexts = []

    async def fake(connection, agent, messages, key, settings):
        assert key == "private-test-key"
        contexts.append(messages[1]["content"])
        yield {
            "text": f"Reply from {agent['name']}",
            "input_tokens": 10,
            "output_tokens": 6,
            "done": True,
        }

    monkeypatch.setattr("moe.services.orchestration.generate", fake)
    room, _ = setup_room(client, signup(client), max_turns=3)
    run = start(client, room)
    claimed = app.state.runner.claim()
    assert claimed[0] == run["id"]
    assert app.state.runner.claim() is None
    await app.state.runner.run_one(*claimed)
    result = client.get(f"/api/rooms/{room['id']}").json()
    assert result["runs"][0]["status"] == "completed"
    replies = [m for m in result["messages"] if m["role"] == "agent"]
    assert len(replies) == 3 and replies[0]["output_tokens"] == 6
    assert "Reply from Agent 0" in contexts[1] and len(contexts) == 3
    events = client.get(f"/api/runs/{run['id']}/events")
    assert "event: update" in events.text and '"type": "terminal"' in events.text


@pytest.mark.asyncio
async def test_broadcast_uses_independent_context(client, app, monkeypatch):
    contexts = []

    async def fake(connection, agent, messages, key, settings):
        contexts.append(messages[1]["content"])
        await asyncio.sleep(0.01)
        yield {"text": agent["name"], "done": True}

    monkeypatch.setattr("moe.services.orchestration.generate", fake)
    room, _ = setup_room(client, signup(client), mode="broadcast")
    start(client, room)
    await app.state.runner.run_one(*app.state.runner.claim())
    assert contexts[0] == contexts[1]


@pytest.mark.asyncio
async def test_cancellation_preserves_partial_text(client, app, monkeypatch):
    started = asyncio.Event()

    async def slow(connection, agent, messages, key, settings):
        yield {"text": "Partial answer", "done": False}
        started.set()
        await asyncio.sleep(10)

    monkeypatch.setattr("moe.services.orchestration.generate", slow)
    room, _ = setup_room(client, signup(client), agents=1)
    run = start(client, room)
    task = asyncio.create_task(app.state.runner.run_one(*app.state.runner.claim()))
    await started.wait()
    client.post(f"/api/runs/{run['id']}/cancel")
    await asyncio.wait_for(task, 2)
    result = client.get(f"/api/rooms/{room['id']}").json()
    assert result["runs"][0]["status"] == "cancelled"
    assert any(
        m["role"] == "partial" and m["content"] == "Partial answer"
        for m in result["messages"]
    )


@pytest.mark.asyncio
async def test_failure_policy_and_no_success_status(client, app, monkeypatch):
    async def fail(*args):
        raise ProviderError("Credentials invalid")
        yield

    monkeypatch.setattr("moe.services.orchestration.generate", fail)
    room, _ = setup_room(client, signup(client), agents=2, failure_policy="stop")
    start(client, room)
    await app.state.runner.run_one(*app.state.runner.claim())
    result = client.get(f"/api/rooms/{room['id']}").json()
    assert result["runs"][0]["status"] == "failed"
    assert len([m for m in result["messages"] if m["role"] == "error"]) == 1


@pytest.mark.asyncio
async def test_moderator_rejects_unknown_speaker(client, app, monkeypatch):
    async def invalid(*args):
        yield {"text": json.dumps({"next_agent_id": "not-in-room"}), "done": True}

    monkeypatch.setattr("moe.services.orchestration.generate", invalid)
    room, _ = setup_room(client, signup(client), mode="moderated")
    start(client, room)
    await app.state.runner.run_one(*app.state.runner.claim())
    result = client.get(f"/api/rooms/{room['id']}").json()
    assert result["runs"][0]["status"] == "failed"
    assert "unavailable agent" in result["runs"][0]["error"]


def test_expired_worker_lease_is_interrupted_not_replayed(client, app):
    room, _ = setup_room(client, signup(client))
    run = start(client, room)
    app.state.runner.claim()
    with app.state.sessions() as db:
        row = db.get(Run, run["id"])
        row.lease_expires = time.time() - 1
        db.commit()
    assert app.state.runner.claim() is None
    with app.state.sessions() as db:
        assert db.get(Run, run["id"]).status == "interrupted"


@pytest.mark.asyncio
async def test_valid_moderator_stop_is_not_a_failure(client, app, monkeypatch):
    async def stop(*args):
        yield {"text": '{"next_agent_id":null}', "done": True}

    monkeypatch.setattr("moe.services.orchestration.generate", stop)
    room, _ = setup_room(client, signup(client), mode="moderated")
    start(client, room)
    await app.state.runner.run_one(*app.state.runner.claim())
    assert (
        client.get(f"/api/rooms/{room['id']}").json()["runs"][0]["status"]
        == "completed"
    )


def test_worker_crash_recovers_saved_deltas(client, app):
    from moe.models import RunEvent

    room, _ = setup_room(client, signup(client), agents=1)
    run = start(client, room)
    app.state.runner.claim()
    with app.state.sessions() as db:
        agent = room["agents"][0]
        db.add(
            RunEvent(
                run_id=run["id"],
                type="turn_started",
                data={
                    "turn_id": "crashed-turn",
                    "agent_id": agent["id"],
                    "name": agent["name"],
                },
            )
        )
        db.add(
            RunEvent(
                run_id=run["id"],
                type="delta",
                data={"turn_id": "crashed-turn", "text": "Durably saved partial text"},
            )
        )
        db.get(Run, run["id"]).lease_expires = time.time() - 1
        db.commit()
    app.state.runner.claim()
    detail = client.get(f"/api/rooms/{room['id']}").json()
    assert detail["runs"][0]["status"] == "interrupted"
    assert detail["messages"][-1]["content"] == "Durably saved partial text"
    assert detail["messages"][-1]["role"] == "partial"


@pytest.mark.asyncio
async def test_continue_policy_marks_mixed_results(client, app, monkeypatch):
    async def mixed(connection, agent, *args):
        if agent["name"] == "Agent 0":
            raise ProviderError("Unavailable")
        yield {"text": "Successful reply", "done": True}

    monkeypatch.setattr("moe.services.orchestration.generate", mixed)
    room, _ = setup_room(client, signup(client), mode="broadcast")
    start(client, room)
    await app.state.runner.run_one(*app.state.runner.claim())
    assert (
        client.get(f"/api/rooms/{room['id']}").json()["runs"][0]["status"]
        == "completed_with_errors"
    )
