from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from main import create_app
from models import Base, Boat


def test_sample_database_is_read_through_the_backend(tmp_path):
    url = f"sqlite:///{tmp_path / 'boats.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            Boat.__table__.insert(), {"name": "Sample boat", "daily_rate": 125}
        )
    with (
        patch.dict("os.environ", {"DATABASE_URL": url}),
        TestClient(create_app()) as client,
    ):
        response = client.get("/boats")
    assert response.status_code == 200
    assert response.json() == [{"id": 1, "name": "Sample boat", "daily_rate": "125.00"}]
    engine.dispose()
