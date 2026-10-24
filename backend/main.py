from fastapi import APIRouter, FastAPI

app = FastAPI()
api_router = APIRouter(prefix="/api")


@api_router.get("")
def read_root():
    return {"Hello": "World"}


@api_router.get("/health")
def health():
    return {"status": "ok"}


app.include_router(api_router)