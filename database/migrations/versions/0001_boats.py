"""Create a sample boat inventory."""

import sqlalchemy as sa
from alembic import op

revision = "0001_boats"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    boats = op.create_table(
        "boats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("daily_rate", sa.Numeric(10, 2), nullable=False),
        sa.UniqueConstraint("name"),
        sa.CheckConstraint("daily_rate >= 0", name="positive_daily_rate"),
    )
    op.bulk_insert(boats, [{"name": "Demo sailboat", "daily_rate": 125}])


def downgrade():
    op.drop_table("boats")
