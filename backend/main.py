import os
from authtuna import init_settings, init_app
from fastapi import APIRouter, FastAPI
from scalar_fastapi import add_scalar_reference

DEFAULT_FRONTEND_ORIGIN = "https://frontend.localhost"


auth_settings = init_settings(
    API_BASE_URL=os.getenv("API_BASE_URL", "http://localhost:8000"),
    DEFAULT_DATABASE_URI=os.getenv("DATABASE_URL", "postgresql+asyncpg://rent_n_sail_app:test@localhost:5432/rent_n_sail"),
    AUTO_CREATE_DATABASE=False,
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

app = FastAPI()
init_app(app)
api_router = APIRouter()

app.include_router(api_router)
api_router.include_router(register_router, prefix="/register")
api_router.include_router(login_router, prefix="/login")
add_scalar_reference(app)

@api_router.get("/")
def read_root():
    return {"Hello": "World"}

@api_router.get("/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":  # for debugging
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
