from typing import Dict

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.openai_compatible import router as openai_compatible_router
from app.api.router import api_router
from app.config import settings
from app.db.session import initialize_database
from app.infrastructure.audit_middleware import AuditMiddleware
from app.services.runtime_adapter.state_store import close_runtime_state
from app.services.secret_codec import validate_secret_settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_secret_settings()
    initialize_database()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.runtime_dir.mkdir(parents=True, exist_ok=True)
    settings.runtime_state_dir.mkdir(parents=True, exist_ok=True)
    yield
    await close_runtime_state()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(AuditMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)
app.include_router(openai_compatible_router, prefix="/v1")


@app.get("/")
def root() -> Dict[str, str]:
    return {"name": settings.app_name, "status": "ok"}
