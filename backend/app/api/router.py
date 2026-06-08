from fastapi import APIRouter, Depends

from app.api import agents, audits, auth, knowledge, llms, monitor, quality, runs, sessions, skills, test_cases, tools, uploads
from app.api.deps import require_write_access

api_router = APIRouter()
api_router.include_router(auth.router)
secured_dependencies = [Depends(require_write_access)]
api_router.include_router(agents.router, dependencies=secured_dependencies)
api_router.include_router(llms.router, dependencies=secured_dependencies)
api_router.include_router(sessions.router, dependencies=secured_dependencies)
api_router.include_router(runs.router, dependencies=secured_dependencies)
api_router.include_router(uploads.router, dependencies=secured_dependencies)
api_router.include_router(knowledge.router, dependencies=secured_dependencies)
api_router.include_router(skills.router, dependencies=secured_dependencies)
api_router.include_router(test_cases.router, dependencies=secured_dependencies)
api_router.include_router(tools.router, dependencies=secured_dependencies)
api_router.include_router(quality.router, dependencies=secured_dependencies)
api_router.include_router(monitor.router, dependencies=secured_dependencies)
api_router.include_router(audits.router)
