import os

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:4200,https://frontend.localhost,"
            "https://rent-n-sail-frontend.vercel.app",
        ).split(",")
        if origin.strip()
    ],
    allow_origin_regex=os.environ.get(
        "CORS_ALLOWED_ORIGIN_REGEX",
        r"https://rent-n-sail-frontend-[a-z0-9-]+-rent-n-sail\.vercel\.app",
    ),
    allow_methods=["GET"],
    allow_headers=["Content-Type"],
)
api_router = APIRouter(prefix="/api")


@api_router.get("")
def read_root():
    return {"Hello": "World"}


@api_router.get("/health")
def health():
    return {"status": "ok"}


app.include_router(api_router)
