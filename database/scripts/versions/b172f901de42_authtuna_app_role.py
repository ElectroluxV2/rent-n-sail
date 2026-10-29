"""Configure an existing application role for AuthTuna.

Revision ID: b172f901de42
Revises: 7eac88f07b1d
"""

from alembic import op

revision = "b172f901de42"
down_revision = "7eac88f07b1d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(f"GRANT USAGE ON SCHEMA authtuna TO rent_n_sail_app")
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA authtuna TO rent_n_sail_app"
    )
    op.execute(
        f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA authtuna TO rent_n_sail_app"
    )
    op.execute(
        f"ALTER ROLE rent_n_sail_app IN DATABASE rent_n_sail SET search_path TO authtuna, public"
    )


def downgrade() -> None:
    raise RuntimeError(
        "Cannot automatically undo role grants or search_path without knowing their previous state"
    )
