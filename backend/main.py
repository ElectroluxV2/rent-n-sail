import os
import tempfile
from pathlib import Path
from typing import Annotated

import uvicorn
from authtuna import init_settings
from fastapi import APIRouter, Depends, FastAPI
from scalar_fastapi import add_scalar_reference
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from database import get_session
from models import Boat

DEFAULT_FRONTEND_ORIGIN = "https://frontend.localhost"

auth_database = Path(__file__).with_name("authtuna_dev.db")
if not os.access(auth_database.parent, os.W_OK):
    # Vercel functions have a read-only filesystem; each instance keeps its file in /tmp.
    auth_database = Path(tempfile.gettempdir(), auth_database.name)

auth_settings = init_settings(
    API_BASE_URL=os.getenv("API_BASE_URL", "http://localhost:8000"),
    DEFAULT_DATABASE_URI=os.getenv(
        "DEFAULT_DATABASE_URI", f"sqlite+aiosqlite:///{auth_database}"
    ),
    WEBAUTHN_RP_ID=os.getenv("WEBAUTHN_RP_ID", "frontend.localhost"),
    WEBAUTHN_RP_NAME="Rent n Sail",
    WEBAUTHN_ORIGIN=os.getenv("WEBAUTHN_ORIGIN", DEFAULT_FRONTEND_ORIGIN),
    FERNET_KEYS=os.getenv(
        "FERNET_KEYS", ["MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA="]
    ),
    SESSION_SAME_SITE="strict",
    SESSION_SECURE=True,
    MFA_ENABLED=False,
    PASSKEYS_ENABLED=True,
    UI_ENABLED=False,
    ADMIN_ROUTES_ENABLED=False,
    PASSWORDLESS_LOGIN_ENABLED=False,
    ONLY_MIDDLEWARE=True,
)

from auth.login.router import router as login_router  # noqa: I001, E402
from auth.register.router import router as register_router  # noqa: I001, E402
from authtuna.core import database as authtuna_database  # noqa: E402
from authtuna.middlewares import DatabaseSessionMiddleware  # noqa: E402

# AuthTuna attaches its SQLite PRAGMA listener to every SQLAlchemy engine, which breaks
# Postgres connections such as /boats; keep it on AuthTuna's own engine.
if sqlite_pragma := getattr(authtuna_database, "set_sqlite_pragma", None):
    event.remove(Engine, "connect", sqlite_pragma)
    event.listen(authtuna_database.engine.sync_engine, "connect", sqlite_pragma)

api_router = APIRouter()


@api_router.get("/")
def read_root():
    return {"Hello": "World 😸"}


@api_router.get("/health")
def health():
    return {"status": "ok"}


@api_router.get("/boats")
def boats(session: Annotated[Session, Depends(get_session)]):
    return [
        {"id": boat.id, "name": boat.name, "daily_rate": str(boat.daily_rate)}
        for boat in session.scalars(select(Boat).order_by(Boat.id))
    ]


api_router.include_router(register_router, prefix="/register")
api_router.include_router(login_router, prefix="/login")


def create_app():
    app = FastAPI()
    # The middlewares authtuna.init_app adds, but with a Strict, Secure session cookie.
    app.add_middleware(DatabaseSessionMiddleware)
    app.add_middleware(
        SessionMiddleware,
        secret_key=auth_settings.ENCRYPTION_PRIMARY_KEY.get_secret_value(),
        same_site="strict",
        https_only=True,
    )
    app.include_router(api_router)
    add_scalar_reference(app)
    return app


app = create_app()


if __name__ == "__main__":  # for debugging
    uvicorn.run(app, host="0.0.0.0", port=8000)
