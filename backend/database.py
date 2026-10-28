import os
from collections.abc import Iterator

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool


def get_session() -> Iterator[Session]:
    raw_url = os.environ.get("DATABASE_URL")
    if not raw_url:
        raise HTTPException(status_code=503, detail="Database is not configured")
    url = make_url(raw_url)
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg")
    engine = create_engine(url, poolclass=NullPool, pool_pre_ping=True)
    try:
        with Session(engine) as session:
            yield session
    finally:
        engine.dispose()
