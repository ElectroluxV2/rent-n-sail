import os

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

api_router = APIRouter(prefix="/api")


@api_router.get("")
def read_root():
    return {"Hello": "World"}


@api_router.get("/health")
def health():
    return {"status": "ok"}


def create_app():
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            origin.strip()
            for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")
            if origin.strip()
        ],
        allow_origin_regex=os.environ.get("CORS_ALLOWED_ORIGIN_REGEX"),
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )
    app.include_router(api_router)
    return app


app = create_app()
