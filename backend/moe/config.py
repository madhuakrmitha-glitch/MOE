import os
from dataclasses import dataclass, field
from pathlib import Path


def flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes"}


@dataclass
class Settings:
    data_dir: Path = field(
        default_factory=lambda: Path(os.getenv("MOE_DATA_DIR", "./data"))
    )
    database_url: str = field(
        default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///./data/moe.db")
    )
    encryption_key: str = field(
        default_factory=lambda: os.getenv("MOE_ENCRYPTION_KEY", "")
    )
    production: bool = field(default_factory=lambda: flag("MOE_PRODUCTION"))
    allow_registration: bool = field(
        default_factory=lambda: flag("MOE_ALLOW_REGISTRATION")
    )
    cookie_secure: bool = field(default_factory=lambda: flag("MOE_COOKIE_SECURE"))
    origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            os.getenv(
                "MOE_ORIGINS",
                "http://localhost:5173,http://localhost:8000,http://127.0.0.1:5173,http://127.0.0.1:8000",
            ).split(",")
        )
    )
    provider_hosts: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            os.getenv(
                "MOE_PROVIDER_HOSTS",
                "api.openai.com,router.huggingface.co,localhost,127.0.0.1",
            ).split(",")
        )
    )
    http_hosts: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            os.getenv("MOE_HTTP_PROVIDER_HOSTS", "localhost,127.0.0.1").split(",")
        )
    )
    worker_enabled: bool = field(
        default_factory=lambda: flag("MOE_WORKER_ENABLED", True)
    )
    request_timeout: int = 90
    lease_seconds: int = 30
    max_run_seconds: int = 900
    session_seconds: int = 43200
    cookie_name: str = "moe_session"

    def validate(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if self.production and (not self.encryption_key or not self.cookie_secure):
            raise RuntimeError(
                "Production requires MOE_ENCRYPTION_KEY and MOE_COOKIE_SECURE=true"
            )
        if self.production and self.database_url.startswith("sqlite"):
            raise RuntimeError(
                "Production requires PostgreSQL; SQLite is for local development"
            )
