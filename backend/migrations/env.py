from alembic import context
from sqlalchemy import create_engine

from moe import models  # noqa: F401 - registers mapped tables for Alembic
from moe.config import Settings
from moe.db import Base

config = context.config
settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
url = settings.database_url
if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url)
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=Base.metadata, compare_type=True
        )
        with context.begin_transaction():
            context.run_migrations()
