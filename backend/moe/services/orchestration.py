import asyncio
import json
import logging
import time
import uuid
from types import SimpleNamespace

from sqlalchemy import func, select, update

from ..models import Connection, Message, Run, RunEvent
from ..providers.client import ProviderError, generate
from ..security import public_row

logger = logging.getLogger("moe.worker")
TERMINAL = {"completed", "completed_with_errors", "failed", "cancelled", "interrupted"}


def add_event(db, run_id, event_type, data):
    db.add(RunEvent(run_id=run_id, type=event_type, data=data))


def transcript_messages(snapshot, agent, history, extra=""):
    roster = ", ".join(f"{item['name']} ({item['id']})" for item in snapshot["agents"])
    system = f"Shared room instructions (apply to every participant):\n{snapshot['shared_prompt']}\n\nYou are {agent['name']}. Your individual instructions:\n{agent['system_prompt']}\n\nParticipants: {roster}. Respond only as yourself. Be specific about whose ideas you are responding to. Conversation mode: {snapshot['mode']}. {extra}"
    recent = history[-snapshot["context_messages"] :]
    # Bound context by characters as well as message count. Always retain the latest user task separately.
    while len(recent) > 1 and sum(len(item["content"]) for item in recent) > 100_000:
        recent = recent[1:]
    transcript = [
        {"speaker": item["name"], "content": item["content"][-100_000:]}
        for item in recent
    ]
    return [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": "Current user topic: "
            + snapshot.get("latest_user_text", "")
            + "\n\nConversation so far (messages from the user and participants):\n"
            + json.dumps(transcript, ensure_ascii=False)
            + "\n\nContribute your next message now.",
        },
    ]


class Runner:
    """Database-leased work. A cancelled or expired run is never silently replayed."""

    def __init__(self, sessions, secrets, settings):
        self.sessions, self.secrets, self.settings = sessions, secrets, settings
        self.slots = asyncio.Semaphore(4)
        self.loop_task = None

    def start(self):
        self.loop_task = asyncio.create_task(self.loop())

    async def stop(self):
        if self.loop_task:
            self.loop_task.cancel()
            try:
                await self.loop_task
            except asyncio.CancelledError:
                pass

    def claim(self):
        with self.sessions() as db:
            now = time.time()
            stale = list(
                db.scalars(
                    select(Run)
                    .where(
                        Run.status.in_(["running", "cancel_requested"]),
                        Run.lease_expires < now,
                    )
                    .with_for_update(skip_locked=True)
                )
            )
            for run in stale:
                self.recover_partial(db, run)
                run.status = (
                    "cancelled" if run.status == "cancel_requested" else "interrupted"
                )
                run.error = "Worker lease expired. Review partial replies before starting another run."
                run.finished_at = now
                add_event(
                    db, run.id, "terminal", {"status": run.status, "error": run.error}
                )
            db.commit()
            run = db.scalar(
                select(Run)
                .where(Run.status == "queued")
                .order_by(Run.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if not run:
                return None
            token = str(uuid.uuid4())
            changed = db.execute(
                update(Run)
                .where(Run.id == run.id, Run.status == "queued")
                .values(
                    status="running",
                    lease_token=token,
                    lease_expires=now + self.settings.lease_seconds,
                )
            ).rowcount
            if not changed:
                db.rollback()
                return None
            add_event(db, run.id, "status", {"status": "running"})
            db.commit()
            return run.id, token

    def recover_partial(self, db, run):
        pending = {}
        for event in db.scalars(
            select(RunEvent).where(RunEvent.run_id == run.id).order_by(RunEvent.id)
        ):
            data = event.data
            if event.type == "turn_started":
                pending[data["turn_id"]] = {**data, "text": ""}
            elif event.type == "delta" and data["turn_id"] in pending:
                pending[data["turn_id"]]["text"] += data["text"]
            elif event.type == "turn_finished":
                pending.pop(data["turn_id"], None)
        completed = set(
            db.scalars(select(Message.turn_id).where(Message.run_id == run.id))
        )
        sequence = (
            db.scalar(
                select(func.max(Message.sequence)).where(Message.room_id == run.room_id)
            )
            or 0
        )
        for turn_id, partial in pending.items():
            if turn_id in completed or not partial["text"]:
                continue
            agent = next(
                (
                    item
                    for item in run.snapshot["agents"]
                    if item["id"] == partial["agent_id"]
                ),
                None,
            )
            if not agent:
                continue
            sequence += 1
            message = Message(
                room_id=run.room_id,
                run_id=run.id,
                turn_id=turn_id,
                sequence=sequence,
                role="partial",
                agent_id=agent["id"],
                name=agent["name"],
                model=agent["model"],
                content=partial["text"],
            )
            db.add(message)
            db.flush()
            add_event(db, run.id, "message", public_row(message))

    async def loop(self):
        while True:
            try:
                claimed = await asyncio.to_thread(self.claim)
                if claimed:
                    await self.run_one(*claimed)
                else:
                    await asyncio.sleep(0.5)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("worker_iteration_failed")
                await asyncio.sleep(1)

    def emit(self, run_id, lease, kind, data):
        with self.sessions() as db:
            run = db.get(Run, run_id)
            if (
                not run
                or run.lease_token != lease
                or run.status not in {"running", "cancel_requested"}
            ):
                raise asyncio.CancelledError()
            add_event(db, run_id, kind, data)
            db.commit()

    def persist_message(
        self, run_id, lease, agent, content, role="agent", metrics=None, turn_id=None
    ):
        with self.sessions() as db:
            run = db.get(Run, run_id)
            if (
                not run
                or run.lease_token != lease
                or run.status not in {"running", "cancel_requested"}
            ):
                raise asyncio.CancelledError()
            sequence = (
                db.scalar(
                    select(func.max(Message.sequence)).where(
                        Message.room_id == run.room_id
                    )
                )
                or 0
            ) + 1
            message = Message(
                room_id=run.room_id,
                run_id=run_id,
                turn_id=turn_id,
                sequence=sequence,
                role=role,
                agent_id=agent["id"],
                name=agent["name"],
                model=agent["model"],
                content=content,
                **(metrics or {}),
            )
            db.add(message)
            db.flush()
            result = public_row(message)
            add_event(db, run_id, "message", result)
            db.commit()
            return result

    async def turn(self, run_id, lease, snapshot, agent, history, number):
        turn_id = str(uuid.uuid4())
        self.emit(
            run_id,
            lease,
            "turn_started",
            {
                "turn_id": turn_id,
                "agent_id": agent["id"],
                "name": agent["name"],
                "turn": number,
            },
        )
        content, buffer = "", ""
        metrics = {"input_tokens": None, "output_tokens": None}
        started, flushed = time.monotonic(), time.monotonic()
        try:
            with self.sessions() as db:
                stored = db.get(Connection, agent["connection_id"])
                if not stored:
                    raise ProviderError("Provider connection was removed")
                key = self.secrets.decrypt(stored.encrypted_key)
                connection = SimpleNamespace(
                    **snapshot["connections"][agent["connection_id"]]
                )
            async with self.slots:
                async for chunk in generate(
                    connection,
                    agent,
                    transcript_messages(snapshot, agent, history),
                    key,
                    self.settings,
                ):
                    content += chunk["text"]
                    buffer += chunk["text"]
                    for field in metrics:
                        if chunk.get(field) is not None:
                            metrics[field] = chunk[field]
                    if buffer and (
                        len(buffer) > 100 or time.monotonic() - flushed > 0.2
                    ):
                        self.emit(
                            run_id,
                            lease,
                            "delta",
                            {
                                "turn_id": turn_id,
                                "agent_id": agent["id"],
                                "text": buffer,
                            },
                        )
                        buffer, flushed = "", time.monotonic()
            if not content.strip():
                raise ProviderError(
                    "Model returned no visible text. Verify the model or increase the output limit."
                )
            metrics["latency_ms"] = round((time.monotonic() - started) * 1000)
            message = self.persist_message(
                run_id, lease, agent, content, metrics=metrics, turn_id=turn_id
            )
            self.emit(run_id, lease, "turn_finished", {"turn_id": turn_id})
            return message
        except asyncio.CancelledError:
            if content:
                self.persist_message(
                    run_id, lease, agent, content, role="partial", turn_id=turn_id
                )
            raise
        except Exception as error:
            if content:
                self.persist_message(
                    run_id, lease, agent, content, role="partial", turn_id=turn_id
                )
            safe = (
                str(error)
                if isinstance(error, ProviderError)
                else "Provider generation failed; check server logs with the run ID"
            )
            self.persist_message(
                run_id, lease, agent, safe, role="error", turn_id=turn_id
            )
            self.emit(
                run_id, lease, "turn_finished", {"turn_id": turn_id, "error": safe}
            )
            if snapshot["failure_policy"] == "stop":
                raise ProviderError(safe) from None
            return None

    async def choose_speaker(self, snapshot, history):
        moderator = next(
            agent
            for agent in snapshot["agents"]
            if agent["id"] == snapshot["moderator_id"]
        )
        with self.sessions() as db:
            stored = db.get(Connection, moderator["connection_id"])
            if not stored:
                raise ProviderError("Moderator connection is unavailable")
            key = self.secrets.decrypt(stored.encrypted_key)
        connection = SimpleNamespace(
            **snapshot["connections"][moderator["connection_id"]]
        )
        instruction = 'Act as the room moderator. Decide who should speak next based on the shared instructions and conversation. Return ONLY a JSON object: {"next_agent_id":"an enabled participant ID"}. Return {"next_agent_id":null} when the discussion is complete.'
        messages = transcript_messages(snapshot, moderator, history, instruction)
        output = ""
        decision_agent = {**moderator, "max_tokens": 256, "temperature": 0}
        async for chunk in generate(
            connection, decision_agent, messages, key, self.settings
        ):
            output += chunk["text"]
        try:
            output = output.strip()
            if output.startswith("```"):
                output = output.split("\n", 1)[1].rsplit("```", 1)[0]
            parsed = json.loads(output)
            selected = parsed["next_agent_id"]
        except (ValueError, KeyError, TypeError):
            raise ProviderError(
                "Moderator did not return a valid speaker decision"
            ) from None
        if selected is not None and selected not in {
            agent["id"] for agent in snapshot["agents"]
        }:
            raise ProviderError("Moderator selected an unavailable agent")
        return selected

    async def execute(self, run_id, lease):
        with self.sessions() as db:
            run = db.get(Run, run_id)
            snapshot = run.snapshot
            history = list(snapshot["history"])
        moderator_stopped = False
        agents = snapshot["agents"]
        target = snapshot.get("target_agent_id")
        if target:
            agents = [agent for agent in agents if agent["id"] == target]
        if snapshot["mode"] == "broadcast" or target:
            tasks = [
                asyncio.create_task(
                    self.turn(run_id, lease, snapshot, agent, history, index + 1)
                )
                for index, agent in enumerate(agents[: snapshot["max_turns"]])
            ]
            try:
                results = await asyncio.gather(*tasks)
            except BaseException:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                raise
            successes = sum(result is not None for result in results)
            attempted = len(results)
        else:
            successes, number, attempted = 0, 0, 0
            maximum = (
                min(len(agents) * snapshot["rounds"], snapshot["max_turns"])
                if snapshot["mode"] == "round_robin"
                else snapshot["max_turns"]
            )
            for index in range(maximum):
                if snapshot["mode"] == "moderated":
                    selected = await self.choose_speaker(snapshot, history)
                    self.emit(
                        run_id, lease, "moderator_decision", {"next_agent_id": selected}
                    )
                    if selected is None:
                        moderator_stopped = True
                        break
                    agent = next(agent for agent in agents if agent["id"] == selected)
                else:
                    agent = agents[index % len(agents)]
                number += 1
                attempted += 1
                message = await self.turn(
                    run_id, lease, snapshot, agent, history, number
                )
                if message:
                    history.append(message)
                    successes += 1
        if successes == 0 and not moderator_stopped:
            raise ProviderError("No agent produced a successful reply")
        return "completed_with_errors" if successes < attempted else "completed"

    async def watch(self, run_id, lease, task):
        heartbeat = 0
        while not task.done():
            await asyncio.sleep(0.5)
            with self.sessions() as db:
                run = db.get(Run, run_id)
                if not run or run.lease_token != lease or run.status != "running":
                    task.cancel()
                    return
                if time.time() - heartbeat > 5:
                    run.lease_expires = time.time() + self.settings.lease_seconds
                    db.commit()
                    heartbeat = time.time()

    async def run_one(self, run_id, lease):
        task = asyncio.create_task(self.execute(run_id, lease))
        watcher = asyncio.create_task(self.watch(run_id, lease, task))
        status, error = "completed", None
        shutting_down = False
        try:
            status = await asyncio.wait_for(task, timeout=self.settings.max_run_seconds)
        except asyncio.TimeoutError:
            status, error = (
                "failed",
                "Run exceeded the time limit. Partial messages were preserved.",
            )
        except asyncio.CancelledError:
            with self.sessions() as db:
                run = db.get(Run, run_id)
                status = (
                    "cancelled"
                    if run and run.status == "cancel_requested"
                    else "interrupted"
                )
            shutting_down = status == "interrupted"
            error = (
                "Stopped by user"
                if status == "cancelled"
                else "Worker stopped; review partial messages before retrying"
            )
        except Exception as exc:
            status = "failed"
            error = (
                str(exc)
                if isinstance(exc, ProviderError)
                else "Run failed; contact the operator with the run ID"
            )
            if not isinstance(exc, ProviderError):
                logger.exception("run_failed", extra={"run_id": run_id})
        finally:
            watcher.cancel()
            try:
                await watcher
            except asyncio.CancelledError:
                pass
            if not task.done():
                task.cancel()
            with self.sessions() as db:
                run = db.get(Run, run_id)
                if (
                    run
                    and run.lease_token == lease
                    and run.status in {"running", "cancel_requested"}
                ):
                    run.status, run.error, run.finished_at = status, error, time.time()
                    add_event(
                        db, run_id, "terminal", {"status": status, "error": error}
                    )
                    db.commit()
        if shutting_down:
            raise asyncio.CancelledError()
