import logging
from pathlib import Path

from authtuna import init_app, init_settings
from fastapi import APIRouter, FastAPI
from scalar_fastapi import add_scalar_reference

init_settings(
    API_BASE_URL="http://localhost:5000",
    DEFAULT_DATABASE_URI=f"sqlite+aiosqlite:///{Path(__file__).with_name('authtuna_dev.db')}",
    WEBAUTHN_RP_ID="localhost",
    WEBAUTHN_RP_NAME="Rent n Sail",
    WEBAUTHN_ORIGIN="http://localhost:4200",
    FERNET_KEYS=["MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA="],
    SESSION_SECURE=False,
    MFA_ENABLED=False,
    PASSKEYS_ENABLED=True,
    UI_ENABLED=False,
    ADMIN_ROUTES_ENABLED=False,
    PASSWORDLESS_LOGIN_ENABLED=False,
    ONLY_MIDDLEWARE=True,
)

from auth.login.router import router as login_router  # noqa: I001, E402
from auth.register.router import router as register_router  # noqa: I001, E402

logger = logging.getLogger(__name__)

app = FastAPI()
init_app(app)
main_router = APIRouter()

main_router.include_router(register_router, prefix="/register")
main_router.include_router(login_router, prefix="/login")
app.include_router(main_router, prefix="/api")
add_scalar_reference(app)


@main_router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
