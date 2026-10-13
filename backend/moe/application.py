import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text

from .api import auth, connections, rooms, runs, workspaces
from .config import Settings
from .db import Base, make_database
from .models import Bootstrap
from .security import SecretStore
from .services.orchestration import Runner

logger = logging.getLogger("moe.http")


def create_app(settings=None):
    settings = settings or Settings()
    settings.validate()
    engine, sessions = make_database(settings.database_url)
    if not settings.production:
        Base.metadata.create_all(engine)
    with sessions() as db:
        if not db.get(Bootstrap, 1):
            db.add(Bootstrap(id=1, claimed=False))
            db.commit()
    secrets = SecretStore(settings)
    runner = Runner(sessions, secrets, settings)

    @asynccontextmanager
    async def lifespan(app):
        if settings.worker_enabled:
            runner.start()
        yield
        await runner.stop()
        engine.dispose()

    app = FastAPI(
        title="MOE API",
        version="0.2.0",
        lifespan=lifespan,
        docs_url=None if settings.production else "/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.settings, app.state.sessions, app.state.secrets, app.state.runner = (
        settings,
        sessions,
        secrets,
        runner,
    )

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        request_id = str(uuid.uuid4())
        started = time.monotonic()
        if request.method in {
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
        } and request.url.path.startswith("/api/"):
            if request.headers.get("origin") not in settings.origins:
                return JSONResponse(
                    {"detail": "Request origin is not allowed"}, status_code=403
                )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        if settings.production:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        logger.info(
            "http_request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path.split("/invites/")[0],
                "status": response.status_code,
                "duration_ms": round((time.monotonic() - started) * 1000),
            },
        )
        return response

    for router in (
        auth.router,
        workspaces.router,
        connections.router,
        rooms.router,
        runs.router,
    ):
        app.include_router(router, prefix="/api")

    @app.get("/health/live")
    def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready():
        with sessions() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ready"}

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    # Docker supplies an absolute frontend build directory.
    import os

    dist = Path(os.getenv("MOE_FRONTEND_DIR", str(dist)))
    if dist.exists():

        @app.get("/{path:path}", include_in_schema=False)
        def frontend(path: str):
            if path.startswith(("api/", "health/")):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            candidate = (dist / path).resolve()
            if candidate.is_relative_to(dist.resolve()) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app
