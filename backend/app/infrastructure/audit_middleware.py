import time
from typing import Callable

from fastapi import Request, Response
from sqlmodel import Session
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.db.session import engine
from app.services.audit_service import record_audit


def _resource_from_path(path: str) -> tuple[str, str]:
    segments = [segment for segment in path.removeprefix(settings.api_prefix).split("/") if segment]
    if not segments:
        return "", ""
    resource_type = segments[0]
    resource_id = ""
    for segment in segments[1:]:
        if segment not in {"import", "openapi", "mcp", "discover", "versions", "restore", "publish", "deactivate", "check", "invoke"}:
            resource_id = segment
            break
    return resource_type, resource_id


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else ""


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        started = time.perf_counter()
        response = await call_next(request)
        if not self._should_audit(request):
            return response

        context = getattr(request.state, "audit_context", {}) or {}
        resource_type, resource_id = _resource_from_path(request.url.path)
        with Session(engine) as session:
            record_audit(
                session,
                action=f"{request.method.lower()}.{request.url.path.removeprefix(settings.api_prefix).strip('/')}",
                status="success" if response.status_code < 400 else "failed",
                org_id=context.get("org_id"),
                user_id=context.get("user_id"),
                resource_type=resource_type,
                resource_id=resource_id,
                ip=_client_ip(request),
                user_agent=request.headers.get("user-agent", ""),
                metadata={
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
        return response

    def _should_audit(self, request: Request) -> bool:
        if request.method in {"GET", "HEAD", "OPTIONS"}:
            return False
        if not request.url.path.startswith(settings.api_prefix):
            return False
        if request.url.path.startswith(f"{settings.api_prefix}/auth/login"):
            return False
        return True
