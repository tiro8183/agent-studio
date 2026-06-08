from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import settings


def run_database_migrations() -> None:
    config = _alembic_config()
    command.upgrade(config, "head")


def _alembic_config() -> Config:
    backend_dir = Path(__file__).resolve().parents[2]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    return config
