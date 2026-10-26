from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text


def test_upgrade_is_repeatable_and_downgrade_removes_sample_schema(
    tmp_path, monkeypatch
):
    url = f"sqlite:///{tmp_path / 'migration.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(Path(__file__).with_name("alembic.ini")))
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT name FROM boats")).scalar_one()
            == "Demo sailboat"
        )
        assert (
            connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            == "0001_boats"
        )
    command.downgrade(config, "base")
    assert "boats" not in inspect(engine).get_table_names()
    engine.dispose()
