"""Allow descriptive terminal run statuses on strict databases."""

import sqlalchemy as sa
from alembic import op

revision = "95ea4a060a44"
down_revision = "646db0d5bd46"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("runs") as batch:
        batch.alter_column(
            "status",
            existing_type=sa.String(20),
            type_=sa.String(32),
            existing_nullable=False,
        )


def downgrade():
    with op.batch_alter_table("runs") as batch:
        batch.alter_column(
            "status",
            existing_type=sa.String(32),
            type_=sa.String(20),
            existing_nullable=False,
        )
