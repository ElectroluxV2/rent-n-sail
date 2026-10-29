"""authtuna

Revision ID: 986845c1cba6
Revises:
Create Date: 2026-10-29 22:50:52.357594

"""

import pathlib
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7eac88f07b1d"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE SCHEMA IF NOT EXISTS authtuna")

    sql = (pathlib.Path(__file__).parent / "sql" / "authtuna.sql").read_text()
    bind = op.get_bind()
    bind.connection.run_async(lambda connection: connection.execute(sql))


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP SCHEMA IF EXISTS authtuna CASCADE")
