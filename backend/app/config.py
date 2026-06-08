from pathlib import Path
from typing import List, Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"


class Settings(BaseSettings):
    app_name: str = "Agent Forge"
    env: Literal["development", "test", "staging", "production"] = "development"
    api_prefix: str = "/api"
    database_url: str = f"sqlite:///{DATA_DIR / 'agent-forge.db'}"
    upload_dir: Path = DATA_DIR / "uploads"
    upload_max_bytes: int = 2 * 1024 * 1024
    knowledge_upload_max_bytes: int = 2 * 1024 * 1024
    upload_quota_total_bytes: int = 512 * 1024 * 1024
    upload_allowed_content_types: List[str] = [
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/json",
        "application/x-yaml",
        "application/xml",
        "text/xml",
    ]
    knowledge_allowed_content_types: List[str] = [
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/json",
        "application/x-yaml",
        "application/xml",
        "text/xml",
    ]
    text_upload_extensions: List[str] = [".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".log"]
    runtime_dir: Path = DATA_DIR / "runtime"
    runtime_state_backend: Literal["postgres", "sqlite", "memory"] = "sqlite"
    runtime_state_dir: Path = DATA_DIR / "runtime" / "langgraph"
    runtime_state_postgres_url: str = ""
    egress_allowed_hosts: List[str] = []
    egress_blocked_hosts: List[str] = []
    egress_allow_private_networks: bool = False
    egress_allow_localhost: bool = False
    run_retention_days: int = 30
    run_retention_minimum: int = 200
    mcp_stdio_enabled: bool = False
    mcp_stdio_allowed_commands: List[str] = []
    mcp_stdio_allowed_cwd_roots: List[Path] = [DATA_DIR / "runtime" / "mcp"]
    cors_origins: List[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    bootstrap_email: str = "admin@ysten.com"
    bootstrap_password: str = "Yst@admin"
    bootstrap_org_name: str = "Agent Forge"
    access_token_ttl_hours: int = 24 * 7
    personal_api_token_default_ttl_days: int = 90
    personal_api_token_max_ttl_days: int = 365
    secret_key: str = "agent-forge-local-development-secret"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="AGENT_FORGE_")


settings = Settings()
