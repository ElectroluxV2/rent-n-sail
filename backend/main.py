import os
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_session
from models import Boat

api_router = APIRouter()
DEFAULT_FRONTEND_ORIGIN = "https://frontend.localhost"


@api_router.get("/")
def read_root():
    return {"Hello": "World"}


@api_router.get("/health")
def health():
    return {"status": "ok"}


@api_router.get("/boats")
def boats(session: Annotated[Session, Depends(get_session)]):
    return [
        {"id": boat.id, "name": boat.name, "daily_rate": str(boat.daily_rate)}
        for boat in session.scalars(select(Boat).order_by(Boat.id))
    ]


def create_app():
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            origin.strip()
            for origin in os.environ.get(
                "CORS_ALLOWED_ORIGINS", DEFAULT_FRONTEND_ORIGIN
            ).split(",")
            if origin.strip()
        ],
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )
    app.include_router(api_router)
    return app


app = create_app()
